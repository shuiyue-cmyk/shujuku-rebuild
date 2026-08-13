/**
 * tests/service/runtime/template-vars/sql-query-var.test.ts
 * ORM 查询构建器 + 值替换 + 条件求值 单元测试
 *
 * 策略：用真实 SqliteEngine 作为后端，mock getStorageProvider 返回一个
 * 包装了真实引擎的 provider，这样 ORM 查询能真正执行 SQL。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { SqliteEngine } from '../../../../src/data/sqlite/sqlite-engine';

// ═══════════════════════════════════════════════════════════════
// Mock 设置（必须在 import 被测模块之前）
// ═══════════════════════════════════════════════════════════════

// mock log 函数
vi.mock('../../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

// 真实引擎实例（在 mock 中使用）
let _engine: SqliteEngine;

// mock storage-mode
vi.mock('../../../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => true),
  isNativeMode: vi.fn(() => false),
  getCurrentStorageMode: vi.fn(() => 'sqlite'),
}));

// mock table-storage-strategy
vi.mock('../../../../src/service/table/table-storage-strategy', () => ({
  isStorageRuntimeReadyForSyncRead_ACU: vi.fn(() => true),
  getStorageRuntimeHealth_ACU: vi.fn(() => ({
    status: 'ready',
    expectedMode: 'sqlite',
    activeMode: 'sqlite',
    loadToken: 1,
  })),
  getActiveStorageProvider: vi.fn(() => null),
  getStorageProvider: vi.fn(() => ({
    mode: 'sqlite' as const,
    executeQuery: (sql: string, params?: any[], options?: { suppressErrorLog?: boolean }) => {
      const result = _engine.query(sql, params, options);
      return {
        columns: result.columns,
        values: result.values,
        rowCount: result.values.length,
      };
    },
    executeMutation: (sql: string, params?: any[]) => {
      const result = _engine.run(sql, params);
      return { changes: result.changes, errors: [] };
    },
  })),
}));

// mock name-mapper（使用真实 NameMapper 但通过 mock 控制全局实例）
import { NameMapper } from '../../../../src/service/runtime/template-vars/name-mapper';

const INVENTORY_DDL = `CREATE TABLE inventory ( -- 背包物品表
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL, -- 物品名称
  quantity INTEGER DEFAULT 1, -- 数量
  category TEXT -- 类别
);`;

const CHARACTERS_DDL = `CREATE TABLE characters ( -- 重要人物表
  row_id INTEGER PRIMARY KEY, -- 行号
  char_name TEXT NOT NULL, -- 姓名
  age INTEGER, -- 年龄
  status TEXT DEFAULT '存活' -- 状态
);`;

const INVESTIGATOR_DDL = `CREATE TABLE diaochayuanjuesekabiao ( -- 调查员角色卡表
  row_id INTEGER PRIMARY KEY, -- 行号
  STR TEXT,
  DEX TEXT,
  name TEXT -- 姓名
);`;

// DDL 原始名、sheet key、uid 与显示名均不同，故意不在 DDL 首行添加显示名注释。
// 旧 NameMapper 无法识别该表，只有运行时共享 resolver 能安全绑定到 zabiao。
const MISC_DDL = `CREATE TABLE legacy_misc (
  row_id INTEGER PRIMARY KEY, -- 行号
  old_title TEXT, -- 名称
  old_description TEXT -- 描述
);`;

const MISC_TABLE_DATA = {
  mate: { type: 'acu', version: 1 },
  sheet_misc: {
    uid: 'misc_uid',
    name: '杂表',
    sourceData: { ddl: MISC_DDL },
    content: [['row_id', '名称', '描述'], ['1', '已探索地点概览', '这里是描述']],
  },
};

let _mapper: NameMapper;
let _mapperStatus: { ready: boolean; tableCount: number; binding: 'unbound' | 'empty_schema' | 'bound' } = {
  ready: true,
  tableCount: 2,
  binding: 'bound',
};

vi.mock('../../../../src/service/runtime/template-vars/name-mapper', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../src/service/runtime/template-vars/name-mapper')>();
  return {
    ...original,
    getNameMapper: vi.fn(() => _mapper),
    getGlobalNameMapperStatus_ACU: vi.fn(() => _mapperStatus),
  };
});

// 现在 import 被测模块
import {
  TableQueryBuilder,
  evaluateOrmExpression,
  evaluateRawSqlExpression,
  replaceDbSqlVariables,
  evaluateDbCondition,
  evaluateSqlCondition,
} from '../../../../src/service/runtime/template-vars/sql-query-var';
import { _set_currentJsonTableData_ACU } from '../../../../src/service/runtime/state-manager';
import { renderAgentReadOnlyQueryTemplates_ACU } from '../../../../src/service/runtime/template-vars/agent-read-only-template-render';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../../../src/shared/utils';

// ═══════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════
describe('sql-query-var', () => {
  beforeEach(() => {
    vi.mocked(logWarn_ACU).mockClear();
    vi.mocked(logError_ACU).mockClear();
    vi.mocked(logDebug_ACU).mockClear();
    _mapperStatus = { ready: true, tableCount: 2, binding: 'bound' };
  });

  afterEach(() => {
    _set_currentJsonTableData_ACU(null);
  });

  beforeAll(async () => {
    // 初始化真实引擎
    _engine = new SqliteEngine();
    await _engine.init();

    // 建表
    _engine.run(INVENTORY_DDL);
    _engine.run(CHARACTERS_DDL);
    _engine.run(INVESTIGATOR_DDL);
    _engine.run("INSERT INTO diaochayuanjuesekabiao VALUES (1, '65', '70', '阿卡姆');");

    // 灌入测试数据
    _engine.runBatch([
      "INSERT INTO inventory VALUES (1, '铁剑', 3, '武器');",
      "INSERT INTO inventory VALUES (2, '治疗药水', 5, '消耗品');",
      "INSERT INTO inventory VALUES (3, '魔法书', 1, '道具');",
      "INSERT INTO characters VALUES (1, '角色A', 25, '存活');",
      "INSERT INTO characters VALUES (2, '角色B', 30, '死亡');",
      "INSERT INTO characters VALUES (3, '角色C', 20, '存活');",
    ]);
    _engine.run('CREATE TABLE jiyaobiao (row_id INTEGER PRIMARY KEY, content TEXT);');
    _engine.run("INSERT INTO jiyaobiao VALUES (1, '记录A');");
    _engine.run('CREATE TABLE zabiao (row_id INTEGER PRIMARY KEY, old_title TEXT, old_description TEXT);');
    _engine.run("INSERT INTO zabiao VALUES (1, '已探索地点概览', '这里是描述');");

    // 构建 NameMapper
    const ddlMap = new Map<string, string>();
    ddlMap.set('inventory', INVENTORY_DDL);
    ddlMap.set('characters', CHARACTERS_DDL);
    ddlMap.set('diaochayuanjuesekabiao', INVESTIGATOR_DDL);
    _mapper = NameMapper.fromDDLs(ddlMap);
  });

  afterAll(() => {
    _set_currentJsonTableData_ACU(null);
    _engine.dispose();
  });

  // ═══════════════════════════════════════════════════════════════
  // TableQueryBuilder
  // ═══════════════════════════════════════════════════════════════
  describe('TableQueryBuilder', () => {
    describe('get', () => {
      it('获取单个值', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const result = builder.where('物品名称', '铁剑').get('数量');
        expect(result).toBe(3);
      });

      it('无匹配返回 null', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const result = builder.where('物品名称', '不存在').get('数量');
        expect(result).toBeNull();
      });
    });

    describe('运行时共享别名解析', () => {
      beforeEach(() => {
        _set_currentJsonTableData_ACU(MISC_TABLE_DATA as any);
      });

      it('显示表名和显示列名在旧 NameMapper 无法识别时仍读取正确行', () => {
        expect(new TableQueryBuilder('杂表')
          .where('名称', '已探索地点概览')
          .get('描述'))
          .toBe('这里是描述');
      });

      it.each(['legacy_misc', 'sheet_misc', 'misc_uid', 'zabiao'])(
        '支持表标识符形态 %s',
        tableName => {
          expect(new TableQueryBuilder(tableName)
            .where('名称', '已探索地点概览')
            .get('描述'))
            .toBe('这里是描述');
        },
      );

      it('ORM 表达式、模板变量和条件求值共享同一结果', () => {
        const expression = "db.杂表.where('名称', '已探索地点概览').get('描述')";

        expect(evaluateOrmExpression(expression)).toBe('这里是描述');
        expect(replaceDbSqlVariables(`{[${expression}]}`)).toBe('这里是描述');
        expect(evaluateDbCondition("db.杂表.where('名称', '已探索地点概览').exists()")).toBe(true);
      });

      it('Agent ORM renderer 复用相同的只读解析路径', () => {
        expect(renderAgentReadOnlyQueryTemplates_ACU(
          "{[db.杂表.where('名称', '已探索地点概览').get('描述')]}",
        )).toMatchObject({ content: '这里是描述', executedCount: 1, rejectedCount: 0 });
      });
    });

    describe('first', () => {
      it('获取单行对象', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const result = builder.where('姓名', '角色A').first();
        expect(result).not.toBeNull();
        expect(result!.char_name).toBe('角色A');
        expect(result!.age).toBe(25);
      });

      it('无匹配返回 null', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const result = builder.where('姓名', '不存在').first();
        expect(result).toBeNull();
      });
    });

    describe('list', () => {
      it('获取某列的值列表', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const result = builder.list('物品名称');
        expect(result).toEqual(['铁剑', '治疗药水', '魔法书']);
      });

      it('带条件过滤', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const result = builder.where('状态', '存活').list('姓名');
        expect(result).toContain('角色A');
        expect(result).toContain('角色C');
        expect(result).not.toContain('角色B');
      });
    });

    describe('all', () => {
      it('获取所有行', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const result = builder.all();
        expect(result).toHaveLength(3);
        expect(result[0]).toHaveProperty('item_name');
      });
    });

    describe('count', () => {
      it('计数', () => {
        const builder = new TableQueryBuilder('背包物品表');
        expect(builder.count()).toBe(3);
      });

      it('带条件计数', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.where('状态', '存活').count()).toBe(2);
      });
    });

    describe('sum', () => {
      it('求和', () => {
        const builder = new TableQueryBuilder('背包物品表');
        expect(builder.sum('数量')).toBe(9); // 3 + 5 + 1
      });
    });

    describe('exists', () => {
      it('存在返回 true', () => {
        const builder = new TableQueryBuilder('背包物品表');
        expect(builder.where('物品名称', '铁剑').exists()).toBe(true);
      });

      it('不存在返回 false', () => {
        const builder = new TableQueryBuilder('背包物品表');
        expect(builder.where('物品名称', '不存在').exists()).toBe(false);
      });
    });

    describe('where 操作符', () => {
      it('大于', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.where('年龄', '>', 25).count()).toBe(1); // 角色B(30)
      });

      it('大于等于', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.where('年龄', '>=', 25).count()).toBe(2); // 角色A(25) + 角色B(30)
      });

      it('null 值转为 IS NULL', () => {
        // 先插入一条 null 数据
        _engine.run("INSERT INTO inventory VALUES (99, 'test_null', 1, NULL);");
        const builder = new TableQueryBuilder('背包物品表');
        const result = builder.where('类别', null).count();
        expect(result).toBe(1);
        // 清理
        _engine.run('DELETE FROM inventory WHERE row_id = 99;');
      });

      it('小于', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.where('年龄', '<', 25).count()).toBe(1); // 角色C(20)
      });

      it('小于等于', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.where('年龄', '<=', 25).count()).toBe(2); // 角色A(25) + 角色C(20)
      });

      it('不等于', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.where('状态', '!=', '死亡').count()).toBe(2); // 角色A + 角色C
      });

      it('IS NOT NULL（!= null）', () => {
        _engine.run("INSERT INTO inventory VALUES (98, 'test_not_null', 1, NULL);");
        const builder = new TableQueryBuilder('背包物品表');
        // 有 category 的行：铁剑(武器)、治疗药水(消耗品)、魔法书(道具) = 3
        const result = builder.where('类别', '!=', null).count();
        expect(result).toBe(3);
        _engine.run('DELETE FROM inventory WHERE row_id = 98;');
      });
    });

    describe('orderBy', () => {
      it('升序排列', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const result = builder.orderBy('年龄', 'ASC').list('姓名');
        expect(result[0]).toBe('角色C'); // 20
        expect(result[2]).toBe('角色B'); // 30
      });

      it('降序排列', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const result = builder.orderBy('年龄', 'DESC').list('姓名');
        expect(result[0]).toBe('角色B'); // 30
      });
    });

    describe('多条件链式 where', () => {
      it('两个 where 生成 AND 条件', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const result = builder.where('状态', '存活').where('年龄', '>', 22).list('姓名');
        expect(result).toEqual(['角色A']); // 角色A(25,存活)，角色C(20,存活)被年龄>22过滤
      });

      it('三个 where 链式调用', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const result = builder
          .where('类别', '!=', '道具')
          .where('数量', '>', 1)
          .where('数量', '<', 10)
          .list('物品名称');
        expect(result).toContain('铁剑');     // 武器, 3
        expect(result).toContain('治疗药水'); // 消耗品, 5
        expect(result).not.toContain('魔法书'); // 道具, 被第一个条件过滤
      });

      it('toSQL 包含多个 AND 条件', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const sql = builder.where('状态', '存活').where('年龄', '>', 20).toSQL();
        expect(sql).toContain('AND');
        expect(sql).toContain("status = '存活'");
        expect(sql).toContain('age > 20');
      });
    });

    describe('escapeParam 单引号转义', () => {
      it('where 值包含单引号时正确转义', () => {
        // 插入包含单引号的数据
        _engine.run("INSERT INTO characters VALUES (99, 'O''Brien', 35, '存活');");
        const builder = new TableQueryBuilder('重要人物表');
        const result = builder.where('姓名', "O'Brien").first();
        expect(result).not.toBeNull();
        expect(result!.char_name).toBe("O'Brien");
        expect(result!.age).toBe(35);
        // 清理
        _engine.run('DELETE FROM characters WHERE row_id = 99;');
      });

      it('toSQL 中单引号被正确转义', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const sql = builder.where('姓名', "It's").toSQL();
        expect(sql).toContain("It''s");
      });
    });

    describe('limit', () => {
      it('限制返回行数', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const result = builder.limit(2).all();
        expect(result).toHaveLength(2);
      });
    });

    describe('toSQL', () => {
      it('生成 SQL 语句', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const sql = builder.where('物品名称', '铁剑').toSQL();
        expect(sql).toContain('SELECT * FROM inventory');
        expect(sql).toContain("WHERE item_name = '铁剑'");
      });

      it('无注释 ASCII 物理列的 ORM 条件保持原始 SQL 列名', () => {
        const sql = new TableQueryBuilder('调查员角色卡表').where('STR', '65').toSQL();
        expect(sql).toBe("SELECT * FROM diaochayuanjuesekabiao WHERE STR = '65'");
      });
    });

    // ═══ 上一轮新增方法测试 ═══

    describe('avg', () => {
      it('求平均值', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const result = builder.avg('年龄');
        expect(result).toBe(25); // (25 + 30 + 20) / 3 = 25
      });

      it('带条件求平均值', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const result = builder.where('状态', '存活').avg('年龄');
        expect(result).toBe(22.5); // (25 + 20) / 2 = 22.5
      });

      it('空结果返回 0', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.where('姓名', '不存在').avg('年龄')).toBe(0);
      });
    });

    describe('max (聚合)', () => {
      it('求最大值', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.max('年龄')).toBe(30);
      });

      it('带条件求最大值', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.where('状态', '存活').max('年龄')).toBe(25);
      });

      it('空结果返回 0', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.where('姓名', '不存在').max('年龄')).toBe(0);
      });
    });

    describe('min (聚合)', () => {
      it('求最小值', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.min('年龄')).toBe(20);
      });

      it('带条件求最小值', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.where('状态', '存活').min('年龄')).toBe(20);
      });

      it('空结果返回 0', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.where('姓名', '不存在').min('年龄')).toBe(0);
      });
    });

    describe('orWhere', () => {
      it('OR 条件查询', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const result = builder.where('姓名', '角色A').orWhere('姓名', '角色C').list('姓名');
        expect(result).toContain('角色A');
        expect(result).toContain('角色C');
        expect(result).not.toContain('角色B');
      });

      it('toSQL 包含 OR', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const sql = builder.where('状态', '存活').orWhere('年龄', '>', 28).toSQL();
        expect(sql).toContain('OR');
      });

      it('多个 OR 分支', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const result = builder
          .where('物品名称', '铁剑')
          .orWhere('物品名称', '魔法书')
          .orWhere('物品名称', '治疗药水')
          .count();
        expect(result).toBe(3);
      });
    });

    describe('whereIn', () => {
      it('IN 查询', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const result = builder.whereIn('物品名称', ['铁剑', '魔法书']).list('物品名称');
        expect(result).toContain('铁剑');
        expect(result).toContain('魔法书');
        expect(result).not.toContain('治疗药水');
      });

      it('空数组返回 0 行', () => {
        const builder = new TableQueryBuilder('背包物品表');
        expect(builder.whereIn('物品名称', []).count()).toBe(0);
      });
    });

    describe('whereNotIn', () => {
      it('NOT IN 查询', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const result = builder.whereNotIn('物品名称', ['铁剑', '魔法书']).list('物品名称');
        expect(result).toEqual(['治疗药水']);
      });

      it('空数组返回所有行', () => {
        const builder = new TableQueryBuilder('背包物品表');
        expect(builder.whereNotIn('物品名称', []).count()).toBe(3);
      });
    });

    describe('whereNull / whereNotNull', () => {
      beforeEach(() => {
        _engine.run("INSERT INTO inventory VALUES (97, 'null_test', 1, NULL);");
      });
      afterEach(() => {
        _engine.run('DELETE FROM inventory WHERE row_id = 97;');
      });

      it('whereNull 查询 NULL 值', () => {
        const builder = new TableQueryBuilder('背包物品表');
        expect(builder.whereNull('类别').count()).toBe(1);
      });

      it('whereNotNull 查询非 NULL 值', () => {
        const builder = new TableQueryBuilder('背包物品表');
        expect(builder.whereNotNull('类别').count()).toBe(3); // 铁剑、治疗药水、魔法书
      });
    });

    describe('whereLike', () => {
      it('模糊匹配（前缀）', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const result = builder.whereLike('物品名称', '治疗%').list('物品名称');
        expect(result).toEqual(['治疗药水']);
      });

      it('模糊匹配（包含）', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const result = builder.whereLike('物品名称', '%剑%').list('物品名称');
        expect(result).toContain('铁剑');
      });

      it('无匹配返回空', () => {
        const builder = new TableQueryBuilder('背包物品表');
        expect(builder.whereLike('物品名称', '%不存在%').count()).toBe(0);
      });
    });

    describe('whereBetween', () => {
      it('范围查询', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const result = builder.whereBetween('年龄', 20, 25).list('姓名');
        expect(result).toContain('角色A'); // 25
        expect(result).toContain('角色C'); // 20
        expect(result).not.toContain('角色B'); // 30
      });

      it('min > max 时自动交换', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const result = builder.whereBetween('年龄', 25, 20).list('姓名');
        expect(result).toContain('角色A');
        expect(result).toContain('角色C');
      });
    });

    describe('groupBy', () => {
      it('分组计数', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const result = builder.groupBy('状态').all();
        expect(result.length).toBeGreaterThanOrEqual(2); // 存活、死亡
      });
    });

    describe('having', () => {
      it('分组后过滤', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const sql = builder.groupBy('状态').having('COUNT(*) > 1').toSQL();
        expect(sql).toContain('GROUP BY');
        expect(sql).toContain('HAVING COUNT(*) > 1');
      });

      it('having 配合 groupBy 实际执行', () => {
        const builder = new TableQueryBuilder('重要人物表');
        // 存活有2人，死亡有1人，HAVING COUNT(*) > 1 应只返回存活
        const result = builder.groupBy('状态').having('COUNT(*) > 1').all();
        expect(result).toHaveLength(1);
      });
    });

    describe('distinct', () => {
      it('去重查询', () => {
        const builder = new TableQueryBuilder('重要人物表');
        const result = builder.distinct().list('状态');
        expect(result).toContain('存活');
        expect(result).toContain('死亡');
        expect(result).toHaveLength(2);
      });

      it('toSQL 包含 DISTINCT', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const sql = builder.distinct().toSQL();
        expect(sql).toContain('SELECT DISTINCT');
      });
    });

    describe('offset', () => {
      it('偏移查询', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const all = builder.orderBy('物品名称', 'ASC').list('物品名称');
        const withOffset = new TableQueryBuilder('背包物品表')
          .orderBy('物品名称', 'ASC').limit(2).offset(1).list('物品名称');
        expect(withOffset).toHaveLength(2);
        expect(withOffset[0]).toBe(all[1]);
      });

      it('offset 无 limit 时自动添加 LIMIT -1', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const sql = builder.offset(2).toSQL();
        expect(sql).toContain('LIMIT -1');
        expect(sql).toContain('OFFSET 2');
      });

      it('负数 offset 被设为 0', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const sql = builder.offset(-5).toSQL();
        expect(sql).toContain('OFFSET 0');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // evaluateOrmExpression
  // ═══════════════════════════════════════════════════════════════
  describe('evaluateOrmExpression', () => {
    it('执行 ORM 表达式', () => {
      const result = evaluateOrmExpression("db.背包物品表.where('物品名称', '铁剑').get('数量')");
      expect(result).toBe('3');
    });

    it('空表达式返回空字符串', () => {
      expect(evaluateOrmExpression('')).toBe('');
    });

    it('无效表达式返回空字符串（不抛出）', () => {
      expect(evaluateOrmExpression('invalid.syntax.here')).toBe('');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // evaluateRawSqlExpression
  // ═══════════════════════════════════════════════════════════════
  describe('evaluateRawSqlExpression', () => {
    it('执行原生 SQL（带 sql 前缀和引号）', () => {
      const result = evaluateRawSqlExpression('sql "SELECT quantity FROM inventory WHERE item_name = \'铁剑\'"');
      expect(result).toBe('3');
    });

    it('支持中文名翻译', () => {
      const result = evaluateRawSqlExpression('sql "SELECT 数量 FROM 背包物品表 WHERE 物品名称 = \'铁剑\'"');
      expect(result).toBe('3');
    });

    it('兼容 DDL 原始表名与显示列名到拼音物理标识符', () => {
      _set_currentJsonTableData_ACU({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'sheet_0',
          name: '纪要表',
          sourceData: { ddl: 'CREATE TABLE chronicle (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  content TEXT -- 内容\n);' },
          content: [['row_id', '内容'], ['1', '记录A']],
        },
      } as any);

      expect(evaluateRawSqlExpression('sql "SELECT 内容 FROM chronicle"')).toBe('记录A');
      expect(evaluateSqlCondition("SELECT 1 FROM chronicle WHERE 内容 = '记录A'")).toBe(true);
      _set_currentJsonTableData_ACU(null);
    });

    it('保留派生查询输出列名，不把外层引用重新翻译为实体列', () => {
      const result = evaluateRawSqlExpression(
        'sql "SELECT 姓名 FROM (SELECT char_name AS 姓名 FROM characters) AS people_view ORDER BY 姓名"',
      );

      expect(result).toBe('角色A\n角色B\n角色C');
    });

    it('多行单列结果用换行分隔', () => {
      const result = evaluateRawSqlExpression('sql "SELECT item_name FROM inventory"');
      expect(result).toContain('铁剑');
      expect(result).toContain('治疗药水');
      expect(result).toContain('魔法书');
      expect(result).toContain('\n');
      expect(result).not.toContain('铁剑, 治疗药水');
    });

    it('多行单列内容里的逗号保留为内容，不作为记录分隔符', () => {
      const result = evaluateRawSqlExpression('sql "SELECT item_name || \',含逗号\' FROM inventory LIMIT 2"');
      expect(result).toBe('铁剑,含逗号\n治疗药水,含逗号');
    });

    it('空 SQL 返回空字符串', () => {
      expect(evaluateRawSqlExpression('sql ""')).toBe('');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // replaceDbSqlVariables
  // ═══════════════════════════════════════════════════════════════
  describe('replaceDbSqlVariables', () => {
    it('替换 {[db...]} 模板变量', () => {
      const content = "你有 {[db.背包物品表.where('物品名称', '铁剑').get('数量')]} 把铁剑";
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('你有 3 把铁剑');
    });

    it('替换 {[sql "..."]} 模板变量', () => {
      const content = '总数量: {[sql "SELECT SUM(quantity) FROM inventory"]}';
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('总数量: 9');
    });

    it('混合替换', () => {
      const content = "{[db.背包物品表.count()]} 种物品, 总数 {[sql \"SELECT SUM(quantity) FROM inventory\"]}";
      const result = replaceDbSqlVariables(content);
      expect(result).toContain('3 种物品');
      expect(result).toContain('总数 9');
    });

    it('无模板变量的文本原样返回', () => {
      const content = '这是普通文本，没有模板变量';
      expect(replaceDbSqlVariables(content)).toBe(content);
    });

    it('空字符串返回空字符串', () => {
      expect(replaceDbSqlVariables('')).toBe('');
    });

    it('null 返回空字符串', () => {
      expect(replaceDbSqlVariables(null as any)).toBe('');
    });

    it('正确处理 whereIn 中的嵌套方括号（Bug 回归测试）', () => {
      const content = "{[db.背包物品表.whereIn('物品名称', ['铁剑', '魔法书']).count()]}";
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('2');
    });

    it('正确处理多个 ORM 模板变量', () => {
      const content = "物品数: {[db.背包物品表.count()]}，人物数: {[db.重要人物表.count()]}";
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('物品数: 3，人物数: 3');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // evaluateDbCondition
  // ═══════════════════════════════════════════════════════════════
  describe('evaluateDbCondition', () => {
    it('ORM 表达式结果为 truthy 返回 true', () => {
      expect(evaluateDbCondition("db.背包物品表.where('物品名称', '铁剑').exists()")).toBe(true);
    });

    it('ORM 表达式结果为 falsy 返回 false', () => {
      expect(evaluateDbCondition("db.背包物品表.where('物品名称', '不存在').exists()")).toBe(false);
    });

    it('比较表达式直接返回布尔值', () => {
      expect(evaluateDbCondition("db.背包物品表.count() > 2")).toBe(true);
      expect(evaluateDbCondition("db.背包物品表.count() > 10")).toBe(false);
    });

    it('空表达式返回 false', () => {
      expect(evaluateDbCondition('')).toBe(false);
    });

    it('不以 db. 开头时自动补前缀', () => {
      // 传入 "背包物品表.count()" 应自动补为 "db.背包物品表.count()"
      expect(evaluateDbCondition("背包物品表.count() > 0")).toBe(true);
    });

    it('表达式执行抛错时返回 false', () => {
      // 不存在的表名会导致 Proxy 返回的 SQL 执行失败
      expect(evaluateDbCondition('db.完全不存在的表.count()')).toBe(false);
    });

    // ═══ isTruthy 边界测试（通过 evaluateDbCondition 间接测试） ═══
    it('count() 返回 0 时 isTruthy 返回 false', () => {
      expect(evaluateDbCondition("db.背包物品表.where('物品名称', '不存在的物品').count()")).toBe(false);
    });

    it('get() 返回 null 时 isTruthy 返回 false', () => {
      expect(evaluateDbCondition("db.背包物品表.where('物品名称', '不存在').get('数量')")).toBe(false);
    });

    it('get() 返回有效数值时 isTruthy 返回 true', () => {
      expect(evaluateDbCondition("db.背包物品表.where('物品名称', '铁剑').get('数量')")).toBe(true);
    });

    it('exists() 返回 boolean 直接使用（不经过 isTruthy）', () => {
      // exists() 返回 true/false，源码中 typeof result === 'boolean' 分支直接返回
      expect(evaluateDbCondition("db.背包物品表.where('物品名称', '铁剑').exists()")).toBe(true);
      expect(evaluateDbCondition("db.背包物品表.where('物品名称', '不存在').exists()")).toBe(false);
    });

    it('count() 返回非零数值时 isTruthy 返回 true', () => {
      expect(evaluateDbCondition('db.背包物品表.count()')).toBe(true);
    });

    it('比较表达式 count() == 0 返回 false', () => {
      expect(evaluateDbCondition("db.背包物品表.where('物品名称', '不存在').count() == 0")).toBe(true);
    });

    it('比较表达式 count() != 0 返回 true', () => {
      expect(evaluateDbCondition('db.背包物品表.count() != 0')).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // evaluateSqlCondition
  // ═══════════════════════════════════════════════════════════════
  describe('evaluateSqlCondition', () => {
    it('有结果返回 true', () => {
      expect(evaluateSqlCondition("SELECT 1 FROM inventory WHERE item_name = '铁剑'")).toBe(true);
    });

    it('无结果返回 false', () => {
      expect(evaluateSqlCondition("SELECT 1 FROM inventory WHERE item_name = '不存在'")).toBe(false);
    });

    it('COUNT 结果非零返回 true', () => {
      expect(evaluateSqlCondition('SELECT COUNT(*) FROM inventory')).toBe(true);
    });

    it('支持中文名翻译', () => {
      expect(evaluateSqlCondition("SELECT 1 FROM 背包物品表 WHERE 物品名称 = '铁剑'")).toBe(true);
    });

    it('SQL 执行抛错时返回 false', () => {
      expect(evaluateSqlCondition('SELECT * FROM 完全不存在的表')).toBe(false);
    });

    it('空表达式返回 false', () => {
      expect(evaluateSqlCondition('')).toBe(false);
    });

    // ═══ isTruthy 边界测试（通过 evaluateSqlCondition 间接测试） ═══
    it('COUNT(*) 为零时返回 false', () => {
      expect(evaluateSqlCondition("SELECT COUNT(*) FROM inventory WHERE item_name = '不存在'")).toBe(false);
    });

    it('SELECT 返回 0 时 isTruthy 返回 false', () => {
      expect(evaluateSqlCondition('SELECT 0')).toBe(false);
    });

    it('SELECT 返回非零数值时 isTruthy 返回 true', () => {
      expect(evaluateSqlCondition('SELECT 42')).toBe(true);
    });

    it('SELECT 返回空字符串时 isTruthy 返回 false', () => {
      expect(evaluateSqlCondition("SELECT ''")).toBe(false);
    });

    it('SELECT 返回非空字符串时 isTruthy 返回 true', () => {
      expect(evaluateSqlCondition("SELECT '有内容'")).toBe(true);
    });

    it('SUM 结果为 0 时返回 false', () => {
      expect(evaluateSqlCondition("SELECT SUM(quantity) FROM inventory WHERE item_name = '不存在'")).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // db.expr() — 执行任意 SQL 表达式
  // ═══════════════════════════════════════════════════════════════
  describe('db.expr() — 执行任意 SQL 表达式', () => {
    it('纯算术表达式', () => {
      const result = evaluateOrmExpression('db.expr("3 + 5 * 2")');
      expect(result).toBe('13');
    });

    it('子查询计算', () => {
      const result = evaluateOrmExpression("db.expr(\"(SELECT quantity FROM inventory WHERE item_name = '铁剑') * 2\")");
      expect(result).toBe('6');
    });

    it('中文表名/列名翻译', () => {
      const result = evaluateOrmExpression("db.expr(\"(SELECT 数量 FROM 背包物品表 WHERE 物品名称 = '铁剑') + 10\")");
      expect(result).toBe('13');
    });

    it('跨表计算', () => {
      const result = evaluateOrmExpression("db.expr(\"(SELECT 数量 FROM 背包物品表 WHERE 物品名称 = '铁剑') + (SELECT 数量 FROM 背包物品表 WHERE 物品名称 = '治疗药水')\")");
      expect(result).toBe('8'); // 3 + 5
    });

    it('空表达式返回空字符串', () => {
      expect(evaluateOrmExpression('db.expr("")')).toBe('');
    });

    it('无效表达式返回空字符串（不抛出）', () => {
      expect(evaluateOrmExpression('db.expr("INVALID SQL EXPRESSION !!!")')).toBe('');
    });

    it('通过 {[db.expr(...)]} 模板变量替换', () => {
      const content = '计算结果: {[db.expr("10 + 20 * 3")]}';
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('计算结果: 70');
    });

    it('通过 {[db.expr(...) as 变量名]} 存入变量', () => {
      const content = '{[db.expr("3 + 5") as total]}结果是 $v:total';
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('结果是 8');
    });

    it('SQLite 聚合函数', () => {
      const result = evaluateOrmExpression('db.expr("(SELECT SUM(quantity) FROM inventory)")');
      expect(result).toBe('9'); // 3 + 5 + 1
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // db.rand() — 生成随机整数
  // ═══════════════════════════════════════════════════════════════
  describe('db.rand() — 生成随机整数', () => {
    it('生成范围内的随机整数', () => {
      const result = evaluateOrmExpression('db.rand(1, 6)');
      const num = Number(result);
      expect(num).toBeGreaterThanOrEqual(1);
      expect(num).toBeLessThanOrEqual(6);
    });

    it('min > max 时自动交换', () => {
      const result = evaluateOrmExpression('db.rand(6, 1)');
      const num = Number(result);
      expect(num).toBeGreaterThanOrEqual(1);
      expect(num).toBeLessThanOrEqual(6);
    });

    it('min == max 时返回固定值', () => {
      const result = evaluateOrmExpression('db.rand(5, 5)');
      expect(result).toBe('5');
    });

    it('支持负数范围', () => {
      const result = evaluateOrmExpression('db.rand(-3, 3)');
      const num = Number(result);
      expect(num).toBeGreaterThanOrEqual(-3);
      expect(num).toBeLessThanOrEqual(3);
    });

    it('通过 {[db.rand(...) as 变量名]} 存入变量', () => {
      const content = '{[db.rand(1, 100) as dice]}骰子: $v:dice';
      const result = replaceDbSqlVariables(content);
      // 骰子值应该是 1-100 之间的数字
      const match = result.match(/骰子: (\d+)/);
      expect(match).not.toBeNull();
      const num = Number(match![1]);
      expect(num).toBeGreaterThanOrEqual(1);
      expect(num).toBeLessThanOrEqual(100);
    });

    it('通过 {[db.rand(...)]} 直接输出', () => {
      const content = '随机数: {[db.rand(1, 10)]}';
      const result = replaceDbSqlVariables(content);
      const match = result.match(/随机数: (\d+)/);
      expect(match).not.toBeNull();
      const num = Number(match![1]);
      expect(num).toBeGreaterThanOrEqual(1);
      expect(num).toBeLessThanOrEqual(10);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // db.calc() — 执行含变量引用的算术表达式
  // ═══════════════════════════════════════════════════════════════
  describe('db.calc() — 执行含变量引用的算术表达式', () => {
    it('纯变量计算', () => {
      // 先定义变量
      const content = '{[db.背包物品表.where(\'物品名称\', \'铁剑\').get(\'数量\') as sword]}{[db.背包物品表.where(\'物品名称\', \'治疗药水\').get(\'数量\') as potion]}{[db.calc("$v:sword + $v:potion * 2") as total]}总计: $v:total';
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('总计: 13'); // 3 + 5 * 2 = 13
    });

    it('带括号的复杂表达式', () => {
      const content = '{[db.背包物品表.where(\'物品名称\', \'铁剑\').get(\'数量\') as a]}{[db.背包物品表.where(\'物品名称\', \'治疗药水\').get(\'数量\') as b]}{[db.calc("($v:a + $v:b) * 3") as result]}结果: $v:result';
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('结果: 24'); // (3 + 5) * 3 = 24
    });

    it('变量不存在时返回空字符串', () => {
      const result = evaluateOrmExpression('db.calc("$v:不存在 + 1")');
      expect(result).toBe('');
    });

    it('空表达式返回空字符串', () => {
      expect(evaluateOrmExpression('db.calc("")')).toBe('');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TableQueryBuilder.value() — 自定义 SELECT 表达式
  // ═══════════════════════════════════════════════════════════════
  describe('TableQueryBuilder.value() — 自定义 SELECT 表达式', () => {
    it('聚合表达式', () => {
      const builder = new TableQueryBuilder('背包物品表');
      const result = builder.value('SUM(数量)');
      expect(result).toBe(9); // 3 + 5 + 1
    });

    it('带条件的聚合表达式', () => {
      const builder = new TableQueryBuilder('背包物品表');
      const result = builder.where('类别', '武器').value('SUM(数量) * 2');
      expect(result).toBe(6); // 3 * 2
    });

    it('算术表达式', () => {
      const builder = new TableQueryBuilder('背包物品表');
      const result = builder.where('物品名称', '铁剑').value('数量 * 10 + 5');
      expect(result).toBe(35); // 3 * 10 + 5
    });

    it('无匹配返回 null', () => {
      const builder = new TableQueryBuilder('背包物品表');
      const result = builder.where('物品名称', '不存在').value('数量');
      expect(result).toBeNull();
    });

    it('通过 {[db...value(...)]} 模板变量替换', () => {
      const content = "武器总量翻倍: {[db.背包物品表.where('类别', '武器').value('SUM(数量) * 2')]}";
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('武器总量翻倍: 6');
    });

    it('全表聚合（无 WHERE 条件）', () => {
      const builder = new TableQueryBuilder('背包物品表');
      const result = builder.value('COUNT(*) * 100');
      expect(result).toBe(300); // 3 * 100
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // db.max() / db.min() — 取多个值中的最大/最小值
  // ═══════════════════════════════════════════════════════════════
  describe('db.max() — 取多个值中的最大值', () => {
    it('纯数字参数', () => {
      const result = evaluateOrmExpression('db.max(3, 7, 1)');
      expect(result).toBe('7');
    });

    it('单个参数', () => {
      const result = evaluateOrmExpression('db.max(42)');
      expect(result).toBe('42');
    });

    it('负数参数', () => {
      const result = evaluateOrmExpression('db.max(-5, -1, -10)');
      expect(result).toBe('-1');
    });

    it('通过 {[db.max(...) as 变量名]} 存入变量', () => {
      const content = '{[db.max(10, 30, 20) as highest]}最大值: $v:highest';
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('最大值: 30');
    });

    it('配合变量使用', () => {
      // 先取值存变量，再用 db.max 比较
      const content = "{[db.背包物品表.where('物品名称', '铁剑').get('数量') as a]}{[db.背包物品表.where('物品名称', '治疗药水').get('数量') as b]}{[db.max($v:a, $v:b) as biggest]}最大: $v:biggest";
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('最大: 5'); // max(3, 5) = 5
    });

    it('直接输出（无 as）', () => {
      const content = '最大值: {[db.max(1, 99, 50)]}';
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('最大值: 99');
    });

    it('空参数返回空字符串', () => {
      const result = evaluateOrmExpression('db.max()');
      expect(result).toBe('');
    });
  });

  describe('db.min() — 取多个值中的最小值', () => {
    it('纯数字参数', () => {
      const result = evaluateOrmExpression('db.min(3, 7, 1)');
      expect(result).toBe('1');
    });

    it('单个参数', () => {
      const result = evaluateOrmExpression('db.min(42)');
      expect(result).toBe('42');
    });

    it('负数参数', () => {
      const result = evaluateOrmExpression('db.min(-5, -1, -10)');
      expect(result).toBe('-10');
    });

    it('通过 {[db.min(...) as 变量名]} 存入变量', () => {
      const content = '{[db.min(10, 30, 20) as lowest]}最小值: $v:lowest';
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('最小值: 10');
    });

    it('配合变量使用', () => {
      const content = "{[db.背包物品表.where('物品名称', '铁剑').get('数量') as a]}{[db.背包物品表.where('物品名称', '治疗药水').get('数量') as b]}{[db.min($v:a, $v:b) as smallest]}最小: $v:smallest";
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('最小: 3'); // min(3, 5) = 3
    });

    it('直接输出（无 as）', () => {
      const content = '最小值: {[db.min(1, 99, 50)]}';
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('最小值: 1');
    });

    it('空参数返回空字符串', () => {
      const result = evaluateOrmExpression('db.min()');
      expect(result).toBe('');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // ORM 独立完成完整场景（纯 db.* 方法，不依赖任何旧标签）
  // ═══════════════════════════════════════════════════════════════
  describe('ORM 独立完成完整场景', () => {
    it('取值 → 计算 → 输出 全流程', () => {
      const content = "{[db.背包物品表.where('物品名称', '铁剑').get('数量') as sword_count]}{[db.calc(\"$v:sword_count * 10\") as damage]}伤害: $v:damage";
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('伤害: 30'); // 3 * 10 = 30
    });

    it('随机数 → 计算 → 输出 全流程', () => {
      const content = '{[db.rand(10, 10) as dice]}{[db.calc("$v:dice * 3") as result]}结果: $v:result';
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('结果: 30'); // 10 * 3 = 30
    });

    it('expr 一步完成跨表计算', () => {
      const content = "{[db.expr(\"(SELECT 数量 FROM 背包物品表 WHERE 物品名称 = '铁剑') + (SELECT 数量 FROM 背包物品表 WHERE 物品名称 = '治疗药水')\") as total]}总数: $v:total";
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('总数: 8'); // 3 + 5
    });

    it('value 在查询上下文中做计算', () => {
      const content = "{[db.背包物品表.value('SUM(数量) * 2 + 100')]}";
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('118'); // 9 * 2 + 100
    });

    it('取值 → max/min → 输出 全流程', () => {
      const content = "{[db.背包物品表.where('物品名称', '铁剑').get('数量') as a]}{[db.背包物品表.where('物品名称', '治疗药水').get('数量') as b]}{[db.背包物品表.where('物品名称', '魔法书').get('数量') as c]}{[db.max($v:a, $v:b, $v:c) as highest]}{[db.min($v:a, $v:b, $v:c) as lowest]}最大: $v:highest, 最小: $v:lowest";
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('最大: 5, 最小: 1'); // max(3,5,1)=5, min(3,5,1)=1
    });

    it('随机数 → max → 输出（完全不依赖旧标签）', () => {
      // 用固定值测试，避免随机性
      const content = '{[db.rand(5, 5) as d1]}{[db.rand(8, 8) as d2]}{[db.rand(3, 3) as d3]}{[db.max($v:d1, $v:d2, $v:d3) as best]}最佳: $v:best';
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('最佳: 8'); // max(5, 8, 3) = 8
    });
  });

  describe('Agent read-only query template renderer', () => {
    it('executes one read-only SQL tag exactly once', () => {
      const querySpy = vi.spyOn(_engine, 'query');
      const before = querySpy.mock.calls.length;
      const result = renderAgentReadOnlyQueryTemplates_ACU('总数: {[sql "SELECT SUM(quantity) FROM inventory"]}');

      expect(result).toMatchObject({ content: '总数: 9', tagCount: 1, executedCount: 1, rejectedCount: 0 });
      expect(querySpy.mock.calls.length - before).toBe(1);
      querySpy.mockRestore();
    });

    it('通过代理只读标签兼容原始 DDL 表名与显示列名', () => {
      _set_currentJsonTableData_ACU({
        mate: { type: 'acu', version: 1 },
        sheet_0: {
          uid: 'sheet_0',
          name: '纪要表',
          sourceData: { ddl: 'CREATE TABLE chronicle (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  content TEXT -- 内容\n);' },
          content: [['row_id', '内容'], ['1', '记录A']],
        },
      } as any);

      const result = renderAgentReadOnlyQueryTemplates_ACU('{[sql "SELECT 内容 FROM chronicle"]}');

      expect(result).toMatchObject({ content: '记录A', executedCount: 1, rejectedCount: 0 });
      _set_currentJsonTableData_ACU(null);
    });

    it('在 Agent SQL 标签中保留派生查询输出列名', () => {
      const result = renderAgentReadOnlyQueryTemplates_ACU(
        '{[sql "SELECT 姓名 FROM (SELECT char_name AS 姓名 FROM characters) AS people_view ORDER BY 姓名"]}',
      );

      expect(result).toMatchObject({ content: '角色A\n角色B\n角色C', executedCount: 1, rejectedCount: 0 });
    });

    it('executes allowlisted ORM chains without evaluating arbitrary JavaScript', () => {
      const result = renderAgentReadOnlyQueryTemplates_ACU("数量: {[db.背包物品表.where('物品名称', '铁剑').get('数量')]}");
      expect(result).toMatchObject({ content: '数量: 3', executedCount: 1, rejectedCount: 0 });

      const rejected = renderAgentReadOnlyQueryTemplates_ACU('{[db.inventory.constructor.constructor("return globalThis")()]}');
      expect(rejected.executedCount).toBe(0);
      expect(rejected.rejectedCount).toBe(1);
      expect(rejected.content).toContain('constructor');
    });

    it('keeps aliases local to one render call', () => {
      const first = renderAgentReadOnlyQueryTemplates_ACU('{[sql "SELECT SUM(quantity) FROM inventory" as total]}总数=$v:total');
      const second = renderAgentReadOnlyQueryTemplates_ACU('总数=$v:total');

      expect(first.content).toBe('总数=9');
      expect(second.content).toBe('总数=$v:total');
    });

    it('executes multiple query tags in one segment once each and shares aliases only within that render', () => {
      const querySpy = vi.spyOn(_engine, 'query');
      const before = querySpy.mock.calls.length;
      const result = renderAgentReadOnlyQueryTemplates_ACU('{[sql "SELECT SUM(quantity) FROM inventory" as total]}总数=$v:total; 人数={[sql "SELECT COUNT(*) FROM characters"]}');

      expect(result).toMatchObject({ content: '总数=9; 人数=3', tagCount: 2, executedCount: 2, rejectedCount: 0 });
      expect(querySpy.mock.calls.length - before).toBe(2);
      querySpy.mockRestore();
    });

    it('rejects query tags containing unresolved placeholders without executing them', () => {
      const querySpy = vi.spyOn(_engine, 'query');
      const before = querySpy.mock.calls.length;
      const result = renderAgentReadOnlyQueryTemplates_ACU('{[sql "SELECT {{agent.userMessage}}"]}');
      expect(result).toMatchObject({ executedCount: 0, rejectedCount: 1, content: '{[sql "SELECT {{agent.userMessage}}"]}' });
      expect(querySpy.mock.calls.length - before).toBe(0);
      querySpy.mockRestore();
    });

    it('reports real raw SQL engine failures as rejected without logging query text', () => {
      const query = '{[sql "SELECT \'sensitive_value\' FROM missing_sensitive_table"]}';
      const result = renderAgentReadOnlyQueryTemplates_ACU(query);

      expect(result).toMatchObject({ content: query, executedCount: 0, rejectedCount: 1 });
      const logs = [...vi.mocked(logWarn_ACU).mock.calls, ...vi.mocked(logError_ACU).mock.calls]
        .flat().map(value => String(value)).join('\n');
      expect(logs).toContain('reason=sql_query_execution_failed');
      expect(logs).not.toContain('sensitive_value');
      expect(logs).not.toContain('SELECT');
    });

    it('reports real ORM engine failures as rejected without logging generated SQL or values', () => {
      const query = "{[db.背包物品表.where('不存在列', 'sensitive_value').get('数量')]}";
      const result = renderAgentReadOnlyQueryTemplates_ACU(query);

      expect(result).toMatchObject({ content: query, executedCount: 0, rejectedCount: 1 });
      const logs = [...vi.mocked(logWarn_ACU).mock.calls, ...vi.mocked(logError_ACU).mock.calls]
        .flat().map(value => String(value)).join('\n');
      expect(logs).toContain('reason=orm_query_execution_failed');
      expect(logs).not.toContain('sensitive_value');
      expect(logs).not.toContain('SELECT');
    });

    it('rejects write SQL without mutating the database', () => {
      const result = renderAgentReadOnlyQueryTemplates_ACU('{[sql "DELETE FROM inventory"]}');
      expect(result).toMatchObject({ executedCount: 0, rejectedCount: 1, content: '{[sql "DELETE FROM inventory"]}' });
      expect(_engine.query('SELECT COUNT(*) FROM inventory').values[0][0]).toBe(3);
    });

    it('does not interpret query tags returned by the database', () => {
      const result = renderAgentReadOnlyQueryTemplates_ACU(`{[sql "SELECT '{[sql ''DELETE FROM inventory'']}'"]}`);
      expect(result.executedCount).toBe(1);
      expect(result.content).toContain('{[sql');
      expect(_engine.query('SELECT COUNT(*) FROM inventory').values[0][0]).toBe(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 非 SQLite 模式守卫测试
  // ═══════════════════════════════════════════════════════════════
  describe('非 SQLite 模式守卫', () => {
    beforeEach(async () => {
      const { isSqliteMode } = await import('../../../../src/service/table/storage-mode');
      vi.mocked(isSqliteMode).mockReturnValue(false);
    });

    afterEach(async () => {
      const { isSqliteMode } = await import('../../../../src/service/table/storage-mode');
      vi.mocked(isSqliteMode).mockReturnValue(true);
    });

    it('replaceDbSqlVariables 返回原文', () => {
      const content = "你有 {[db.背包物品表.where('物品名称', '铁剑').get('数量')]} 把铁剑";
      expect(replaceDbSqlVariables(content)).toBe(content);
    });

    it('evaluateDbCondition 返回 false', () => {
      expect(evaluateDbCondition("db.背包物品表.count() > 0")).toBe(false);
    });

    it('evaluateSqlCondition 返回 false', () => {
      expect(evaluateSqlCondition('SELECT COUNT(*) FROM inventory')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // NameMapper 就绪门禁
  // ═══════════════════════════════════════════════════════════════
  describe('NameMapper 就绪门禁', () => {
    it('runtime 尚无表结构时按 debug 记录，不产生 WARN', () => {
      _mapperStatus = { ready: false, tableCount: 0, binding: 'empty_schema' };
      const content = "你有 {[db.背包物品表.where('物品名称', '铁剑').get('数量')]} 把铁剑";

      expect(replaceDbSqlVariables(content)).toBe(content);
      expect(vi.mocked(logWarn_ACU)).not.toHaveBeenCalled();
      expect(vi.mocked(logDebug_ACU).mock.calls.some(([message]) => String(message).includes('运行时尚无表结构'))).toBe(true);
    });

    it('mapper 意外丢失时仍按 WARN 上报', () => {
      _mapperStatus = { ready: false, tableCount: 0, binding: 'unbound' };

      expect(evaluateDbCondition("db.背包物品表.count() > 0")).toBe(false);
      expect(vi.mocked(logWarn_ACU).mock.calls.some(([message]) => String(message).includes('NameMapper 未就绪'))).toBe(true);
    });

    it('空 schema 与 mapper 丢失分别去重，不会互相压掉对方告警', () => {
      _mapperStatus = { ready: false, tableCount: 0, binding: 'empty_schema' };
      expect(evaluateDbCondition("db.背包物品表.count() > 0")).toBe(false);
      expect(vi.mocked(logWarn_ACU)).not.toHaveBeenCalled();

      _mapperStatus = { ready: false, tableCount: 0, binding: 'unbound' };
      expect(evaluateDbCondition("db.背包物品表.count() > 0")).toBe(false);
      expect(vi.mocked(logWarn_ACU).mock.calls.some(([message]) => String(message).includes('NameMapper 未就绪'))).toBe(true);
    });
  });

});
