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

    describe('列名参数注入防护', () => {
      it('列名夹带多语句时被多语句门拒绝，不会执行 DROP', () => {
        const rowCountBefore = _engine.query('SELECT COUNT(*) FROM inventory;').values[0][0] as number;
        expect(rowCountBefore).toBe(3);

        // 引号内文本在结构白名单判定前被替换为 ""，黑名单与链式正则都看不见其中的 `;`
        // （H2 加固的已知盲区），因此必须由执行前的多语句门兜住。
        const result = evaluateOrmExpression('db.背包物品表.sum("row_id) FROM inventory; DROP TABLE inventory; --")');

        expect(result).toBe('0');
        expect(vi.mocked(logWarn_ACU)).toHaveBeenCalledWith(expect.stringContaining('拒绝执行多语句查询'));
        expect(_engine.query('SELECT COUNT(*) FROM inventory;').values[0][0]).toBe(rowCountBefore);
      });

      it('合法表达式含 CASE…END 不被多语句门误拒（门只认多语句，不套关键词词表）', () => {
        const result = evaluateOrmExpression(
          'db.背包物品表.where("物品名称", "铁剑").value("CASE WHEN 数量 > 0 THEN 1 ELSE 0 END")',
        );

        expect(result).toBe('1');
        expect(vi.mocked(logWarn_ACU)).not.toHaveBeenCalledWith(expect.stringContaining('拒绝执行多语句查询'));
      });

      it('db.expr 的 CASE…END 同样不被误拒（同族路径共用只认多语句的判据）', () => {
        const result = evaluateOrmExpression('db.expr("CASE WHEN 1 = 1 THEN 1 ELSE 0 END")');

        expect(result).toBe('1');
        expect(vi.mocked(logWarn_ACU)).not.toHaveBeenCalledWith(expect.stringContaining('拒绝执行多语句表达式'));
      });
    });

    describe('where 操作符', () => {

      it('null 值转为 IS NULL', () => {
        // 先插入一条 null 数据
        _engine.run("INSERT INTO inventory VALUES (99, 'test_null', 1, NULL);");
        const builder = new TableQueryBuilder('背包物品表');
        const result = builder.where('类别', null).count();
        expect(result).toBe(1);
        // 清理
        _engine.run('DELETE FROM inventory WHERE row_id = 99;');
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

    describe('toSQL', () => {

      it('无注释 ASCII 物理列的 ORM 条件保持原始 SQL 列名', () => {
        const sql = new TableQueryBuilder('调查员角色卡表').where('STR', '65').toSQL();
        expect(sql).toBe("SELECT * FROM diaochayuanjuesekabiao WHERE STR = '65'");
      });
    });

    // ═══ 上一轮新增方法测试 ═══

    describe('avg', () => {

      it('空结果返回 0', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.where('姓名', '不存在').avg('年龄')).toBe(0);
      });
    });

    describe('max (聚合)', () => {

      it('空结果返回 0', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(builder.where('姓名', '不存在').max('年龄')).toBe(0);
      });
    });

    describe('min (聚合)', () => {

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
    });

    describe('whereNotIn', () => {
      it('NOT IN 查询', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const result = builder.whereNotIn('物品名称', ['铁剑', '魔法书']).list('物品名称');
        expect(result).toEqual(['治疗药水']);
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

      it('无匹配返回空', () => {
        const builder = new TableQueryBuilder('背包物品表');
        expect(builder.whereLike('物品名称', '%不存在%').count()).toBe(0);
      });
    });

    describe('having', () => {

      it('含分号直接拒绝（分号是唯一能切开语句的分隔符）', () => {
        const builder = new TableQueryBuilder('重要人物表');
        expect(() => builder.having('1; DROP TABLE inventory; --')).toThrow();
      });

      it('整词 END 不再被误拒：CASE…END 经完整 ORM 路径可执行', () => {
        const builder = new TableQueryBuilder('背包物品表');
        // having 片段不过列名翻译，故此处用物理列名 quantity
        const rows = builder.groupBy('类别').having('SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END) >= 1').all();
        expect(rows).toHaveLength(3);
      });

      it('整词 REPLACE 不再被误拒：REPLACE() 经完整 ORM 路径可执行', () => {
        const builder = new TableQueryBuilder('背包物品表');
        const rows = builder.groupBy('类别').having("REPLACE(category, '道具', '装备') = '装备'").all();
        expect(rows).toHaveLength(1);
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
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // evaluateOrmExpression
  // ═══════════════════════════════════════════════════════════════
  describe('evaluateOrmExpression', () => {

    it('无效表达式返回空字符串（不抛出）', () => {
      expect(evaluateOrmExpression('invalid.syntax.here')).toBe('');
    });

    // R3-02：表达式来自聊天正文等不可信文本，不得被当作 JS 执行。
    it('计算属性 + 标签模板的绕过载荷不执行任何 JS', () => {
      // 反斜杠用字符码拼，保证 u0067 转义原样到达白名单（白名单不规范化转义，globalThis 黑名单因此被绕过）。
      const payload = 'db.背包物品表.where(""[`con`+`structor`][`con`+`structor`]`' + String.fromCharCode(92) + 'u0067lobalThis.PWNED_R302=1```)';
      expect(evaluateOrmExpression(payload)).toBe('');
      expect(evaluateDbCondition(payload)).toBe(false);
      expect((globalThis as Record<string, unknown>).PWNED_R302).toBeUndefined();
    });

    it('只能调用构建器公开方法：私有方法、constructor 与非字面量参数一律拒绝', () => {
      expect(evaluateOrmExpression("db.背包物品表._executeQuery('DELETE FROM inventory')")).toBe('');
      expect(evaluateOrmExpression('db.背包物品表.constructor')).toBe('');
      expect(evaluateOrmExpression("db.背包物品表.where('物品名称', self).count()")).toBe('');
      expect(evaluateOrmExpression("db.背包物品表.where('物品名称', '铁剑').count()")).toBe('1');
    });

    it('解释器支持的合法语法：数组参数、负数、双引号与转义、比较', () => {
      expect(evaluateOrmExpression("db.背包物品表.whereIn('物品名称', ['铁剑', '魔法书']).count()")).toBe('2');
      expect(evaluateOrmExpression('db.max(-5, -1, -10)')).toBe('-1');
      expect(evaluateOrmExpression('db.背包物品表.where("物品名称", "\u94c1剑").get("数量")')).toBe('3');
      expect(evaluateDbCondition("db.背包物品表.where('物品名称', '铁剑').get('数量') === 3")).toBe(true);
      expect(evaluateDbCondition('db.背包物品表.count() >= 100')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // evaluateRawSqlExpression
  // ═══════════════════════════════════════════════════════════════
  describe('evaluateRawSqlExpression', () => {

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
  });

  // ═══════════════════════════════════════════════════════════════
  // replaceDbSqlVariables
  // ═══════════════════════════════════════════════════════════════
  describe('replaceDbSqlVariables', () => {

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

    it('正确处理 whereIn 中的嵌套方括号（Bug 回归测试）', () => {
      const content = "{[db.背包物品表.whereIn('物品名称', ['铁剑', '魔法书']).count()]}";
      const result = replaceDbSqlVariables(content);
      expect(result).toBe('2');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // evaluateDbCondition
  // ═══════════════════════════════════════════════════════════════
  describe('evaluateDbCondition', () => {

    it('表达式执行抛错时返回 false', () => {
      // 不存在的表名会导致 Proxy 返回的 SQL 执行失败
      expect(evaluateDbCondition('db.完全不存在的表.count()')).toBe(false);
    });

    it('exists() 返回 boolean 直接使用（不经过 isTruthy）', () => {
      // exists() 返回 true/false，源码中 typeof result === 'boolean' 分支直接返回
      expect(evaluateDbCondition("db.背包物品表.where('物品名称', '铁剑').exists()")).toBe(true);
      expect(evaluateDbCondition("db.背包物品表.where('物品名称', '不存在').exists()")).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // evaluateSqlCondition
  // ═══════════════════════════════════════════════════════════════
  describe('evaluateSqlCondition', () => {

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

    it('SELECT 返回空字符串时 isTruthy 返回 false', () => {
      expect(evaluateSqlCondition("SELECT ''")).toBe(false);
    });

    it('SUM 结果为 0 时返回 false', () => {
      expect(evaluateSqlCondition("SELECT SUM(quantity) FROM inventory WHERE item_name = '不存在'")).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // db.expr() — 执行任意 SQL 表达式
  // ═══════════════════════════════════════════════════════════════
  describe('db.expr() — 执行任意 SQL 表达式', () => {

    it('中文表名/列名翻译', () => {
      const result = evaluateOrmExpression("db.expr(\"(SELECT 数量 FROM 背包物品表 WHERE 物品名称 = '铁剑') + 10\")");
      expect(result).toBe('13');
    });

    it('无效表达式返回空字符串（不抛出）', () => {
      expect(evaluateOrmExpression('db.expr("INVALID SQL EXPRESSION !!!")')).toBe('');
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
