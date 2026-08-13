/**
 * tests/service/runtime/template-vars/name-mapper.test.ts
 * NameMapper 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock log 函数（name-mapper 通过 schema-mapper 间接使用，但自身也 import log）
vi.mock('../../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

import {
  NameMapper,
  createNameMapperOwnerToken_ACU,
  disposeGlobalNameMapper,
  ensureGlobalNameMapperForDDLs_ACU,
  getGlobalNameMapperOwnershipSnapshot_ACU,
  getGlobalNameMapperStatus_ACU,
  getNameMapper,
  isGlobalNameMapperCurrentForDDLs_ACU,
  publishGlobalNameMapperEmptySchema_ACU,
  publishGlobalNameMapperForDDLs_ACU,
  releaseGlobalNameMapperForOwner_ACU,
} from '../../../../src/service/runtime/template-vars/name-mapper';

// ═══════════════════════════════════════════════════════════════
// 测试用 DDL
// ═══════════════════════════════════════════════════════════════
const INVENTORY_DDL = `CREATE TABLE inventory ( -- 背包物品表
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL, -- 物品名称
  quantity INTEGER DEFAULT 1, -- 数量
  description TEXT -- 描述
);`;

const CHARACTERS_DDL = `CREATE TABLE characters ( -- 重要人物表
  row_id INTEGER PRIMARY KEY, -- 行号
  char_name TEXT NOT NULL, -- 姓名
  age INTEGER, -- 年龄
  status TEXT DEFAULT '存活' -- 状态
);`;

function buildTestMapper(): NameMapper {
  const ddlMap = new Map<string, string>();
  ddlMap.set('inventory', INVENTORY_DDL);
  ddlMap.set('characters', CHARACTERS_DDL);
  return NameMapper.fromDDLs(ddlMap);
}

describe('NameMapper', () => {
  let mapper: NameMapper;

  beforeEach(() => {
    mapper = buildTestMapper();
  });

  // ═══════════════════════════════════════════════════════════════
  // fromDDLs
  // ═══════════════════════════════════════════════════════════════
  describe('fromDDLs', () => {
    it('正确构建映射器', () => {
      expect(mapper.tableCount).toBe(2);
    });

    it('空 DDL Map 构建空映射器', () => {
      const emptyMapper = NameMapper.fromDDLs(new Map());
      expect(emptyMapper.tableCount).toBe(0);
    });

    it('跳过空 DDL 值', () => {
      const ddlMap = new Map<string, string>();
      ddlMap.set('test', '');
      ddlMap.set('inventory', INVENTORY_DDL);
      const m = NameMapper.fromDDLs(ddlMap);
      expect(m.tableCount).toBe(1);
    });

    it('以 runtime physical name map key 而非 DDL 内旧表名建立映射', () => {
      const m = NameMapper.fromDDLs(new Map([
        ['jiyaobiao', `CREATE TABLE chronicle ( -- 纪要表
  row_id INTEGER PRIMARY KEY, -- 行号
  content TEXT -- 内容
);`],
      ]));

      expect(m.resolveTableName('纪要表')).toBe('jiyaobiao');
      expect(m.resolveColumnName('jiyaobiao', '内容')).toBe('content');
      expect(m.getAllTableNames()).toEqual(['jiyaobiao']);
    });

    it('无 DDL 注释的物理 ASCII 列仍被视为可写列，且不覆盖有注释列的展示名', () => {
      const m = NameMapper.fromDDLs(new Map([
        ['diaochayuanjuesekabiao', `CREATE TABLE investigator ( -- 调查员角色卡表
  row_id INTEGER PRIMARY KEY, -- 行号
  STR TEXT,
  DEX TEXT,
  name TEXT -- 姓名
);`],
      ]));

      expect(m.hasColumnName('diaochayuanjuesekabiao', 'STR')).toBe(true);
      expect(m.resolveColumnName('diaochayuanjuesekabiao', 'STR')).toBe('STR');
      expect(m.getChineseColumnName('diaochayuanjuesekabiao', 'STR')).toBe('STR');
      expect(m.getChineseColumnName('diaochayuanjuesekabiao', 'name')).toBe('姓名');
      expect(m.hasColumnName('diaochayuanjuesekabiao', '不存在的列')).toBe(false);
      expect(m.translateSql('SELECT STR FROM 调查员角色卡表 WHERE 姓名 = \'助手\'')).toBe(
        "SELECT STR FROM diaochayuanjuesekabiao WHERE name = '助手'",
      );
    });

    it('无法提取列定义时不产生伪物理列', () => {
      const m = NameMapper.fromDDLs(new Map([
        ['empty_table', `CREATE TABLE empty_table ( -- 空表
  PRIMARY KEY (row_id),
  CHECK (1 = 1)
);`],
      ]));

      expect(m.tableCount).toBe(1);
      expect(m.hasColumnName('empty_table', 'row_id')).toBe(true);
      expect(m.hasColumnName('empty_table', 'PRIMARY')).toBe(false);
      expect(m.hasColumnName('empty_table', 'CHECK')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // resolveTableName
  // ═══════════════════════════════════════════════════════════════
  describe('resolveTableName', () => {
    it('中文表名 → 英文表名', () => {
      expect(mapper.resolveTableName('背包物品表')).toBe('inventory');
      expect(mapper.resolveTableName('重要人物表')).toBe('characters');
    });

    it('英文表名直接透传', () => {
      expect(mapper.resolveTableName('inventory')).toBe('inventory');
      expect(mapper.resolveTableName('characters')).toBe('characters');
    });

    it('未知名称原样返回', () => {
      expect(mapper.resolveTableName('不存在的表')).toBe('不存在的表');
    });

    it('空字符串原样返回', () => {
      expect(mapper.resolveTableName('')).toBe('');
    });

    it('带空格的名称自动 trim', () => {
      expect(mapper.resolveTableName('  背包物品表  ')).toBe('inventory');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // resolveColumnName
  // ═══════════════════════════════════════════════════════════════
  describe('resolveColumnName', () => {
    it('中文列名 → 英文列名', () => {
      expect(mapper.resolveColumnName('inventory', '物品名称')).toBe('item_name');
      expect(mapper.resolveColumnName('inventory', '数量')).toBe('quantity');
      expect(mapper.resolveColumnName('characters', '姓名')).toBe('char_name');
    });

    it('英文列名直接透传', () => {
      expect(mapper.resolveColumnName('inventory', 'item_name')).toBe('item_name');
    });

    it('未知列名原样返回', () => {
      expect(mapper.resolveColumnName('inventory', '不存在的列')).toBe('不存在的列');
    });

    it('row_id 不在映射中（注释为"行号"但不需要映射）', () => {
      // row_id 在 parseDDLColumnComments 中会被解析，但 NameMapper 跳过 row_id
      // 所以 resolveColumnName('inventory', '行号') 应该原样返回
      // 因为 NameMapper.fromDDLs 中 colName !== 'row_id' 的条件过滤了它
      expect(mapper.resolveColumnName('inventory', 'row_id')).toBe('row_id');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getChineseTableName / getChineseColumnName
  // ═══════════════════════════════════════════════════════════════
  describe('反向映射', () => {
    it('英文表名 → 中文表名', () => {
      expect(mapper.getChineseTableName('inventory')).toBe('背包物品表');
      expect(mapper.getChineseTableName('characters')).toBe('重要人物表');
    });

    it('未知英文表名原样返回', () => {
      expect(mapper.getChineseTableName('unknown')).toBe('unknown');
    });

    it('英文列名 → 中文列名', () => {
      expect(mapper.getChineseColumnName('inventory', 'item_name')).toBe('物品名称');
      expect(mapper.getChineseColumnName('characters', 'char_name')).toBe('姓名');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // translateSql
  // ═══════════════════════════════════════════════════════════════
  describe('translateSql', () => {
    it('替换中文表名和列名', () => {
      const sql = 'SELECT 物品名称, 数量 FROM 背包物品表 WHERE 数量 > 3';
      const translated = mapper.translateSql(sql);
      expect(translated).toBe('SELECT item_name, quantity FROM inventory WHERE quantity > 3');
    });

    it('跳过字符串值中的中文', () => {
      const sql = "SELECT item_name FROM inventory WHERE item_name = '背包物品表'";
      const translated = mapper.translateSql(sql);
      // 字符串值中的"背包物品表"不应该被替换
      expect(translated).toContain("'背包物品表'");
      // 但 FROM 后面的表名不在引号中，应该保持不变（已经是英文）
      expect(translated).toContain('FROM inventory');
    });

    it('混合中英文', () => {
      const sql = 'SELECT char_name, 年龄 FROM 重要人物表 WHERE status = \'存活\'';
      const translated = mapper.translateSql(sql);
      expect(translated).toContain('age');
      expect(translated).toContain('characters');
      expect(translated).toContain('char_name');
      // 字符串值中的"存活"不应该被替换
      expect(translated).toContain("'存活'");
    });

    it('空 SQL 原样返回', () => {
      expect(mapper.translateSql('')).toBe('');
    });

    it('无中文的 SQL 原样返回', () => {
      const sql = 'SELECT * FROM inventory WHERE quantity > 5';
      expect(mapper.translateSql(sql)).toBe(sql);
    });

    it('长名称优先替换（避免子串误匹配）', () => {
      // 构造一个有子串关系的映射器
      const ddlMap = new Map<string, string>();
      ddlMap.set('items', `CREATE TABLE items ( -- 物品表
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT -- 物品名称
);`);
      ddlMap.set('special_items', `CREATE TABLE special_items ( -- 特殊物品表
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT -- 特殊物品名称
);`);
      const m = NameMapper.fromDDLs(ddlMap);

      // "特殊物品表" 应该被完整替换，不应该先替换 "物品表" 部分
      const sql = 'SELECT * FROM 特殊物品表';
      const translated = m.translateSql(sql);
      expect(translated).toBe('SELECT * FROM special_items');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getAllTableNames
  // ═══════════════════════════════════════════════════════════════
  describe('getAllTableNames', () => {
    it('返回所有英文表名', () => {
      const names = mapper.getAllTableNames();
      expect(names).toContain('inventory');
      expect(names).toContain('characters');
    });
  });
});

describe('全局 NameMapper 绑定状态', () => {
  beforeEach(() => {
    disposeGlobalNameMapper();
  });

  it('dispose 后为 unbound，且 getNameMapper 懒建实例不会让其变就绪', () => {
    expect(getGlobalNameMapperStatus_ACU()).toEqual({ ready: false, tableCount: 0, binding: 'unbound' });

    // 懒建的空实例只用于透传，不代表已绑定 runtime schema。
    getNameMapper();
    expect(getGlobalNameMapperStatus_ACU().ready).toBe(false);
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('unbound');
  });

  it('标记空 schema 后与 unbound 可区分，但仍不视为就绪', () => {
    publishGlobalNameMapperEmptySchema_ACU(createNameMapperOwnerToken_ACU('test'));
    expect(getGlobalNameMapperStatus_ACU()).toEqual({ ready: false, tableCount: 0, binding: 'empty_schema' });
  });

  it('绑定有效 DDL 后进入 bound 并报告表数量', () => {
    const ddlMap = new Map<string, string>([
      ['inventory', INVENTORY_DDL],
      ['characters', CHARACTERS_DDL],
    ]);
    ensureGlobalNameMapperForDDLs_ACU(ddlMap);

    expect(getGlobalNameMapperStatus_ACU()).toEqual({ ready: true, tableCount: 2, binding: 'bound' });
    expect(isGlobalNameMapperCurrentForDDLs_ACU(ddlMap)).toBe(true);
  });

  it('空 DDL 集合构建出的 mapper 记为 empty_schema，不冒充就绪', () => {
    ensureGlobalNameMapperForDDLs_ACU(new Map());
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('empty_schema');
    expect(getGlobalNameMapperStatus_ACU().ready).toBe(false);
  });

  it('empty_schema 之后拿到真实 DDL 会重建为 bound', () => {
    const owner = createNameMapperOwnerToken_ACU('test');
    publishGlobalNameMapperEmptySchema_ACU(owner);
    const ddlMap = new Map<string, string>([['inventory', INVENTORY_DDL]]);

    // owned 状态只能由持有凭证的 runtime 自己升级为 bound。
    publishGlobalNameMapperForDDLs_ACU(ddlMap, owner);

    expect(getGlobalNameMapperStatus_ACU().binding).toBe('bound');
    expect(getNameMapper().resolveTableName('背包物品表')).toBe('inventory');
  });
});

describe('全局 NameMapper 发布所有权', () => {
  const ddlMapA = new Map<string, string>([['inventory', INVENTORY_DDL]]);
  const ddlMapB = new Map<string, string>([['characters', CHARACTERS_DDL]]);

  beforeEach(() => {
    disposeGlobalNameMapper();
  });

  it('更新的发布者可以接管，旧发布者的释放变成 no-op', () => {
    const ownerA = createNameMapperOwnerToken_ACU('runtime-a');
    const ownerB = createNameMapperOwnerToken_ACU('runtime-b');

    expect(publishGlobalNameMapperForDDLs_ACU(ddlMapA, ownerA)).toBe(true);
    expect(publishGlobalNameMapperForDDLs_ACU(ddlMapB, ownerB)).toBe(true);
    expect(getGlobalNameMapperOwnershipSnapshot_ACU().ownerLabel).toBe('runtime-b');

    // 旧实例的迟到清理绝不能破坏新实例已经发布的映射。
    expect(releaseGlobalNameMapperForOwner_ACU(ownerA)).toBe(false);
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('bound');
    expect(getNameMapper().resolveTableName('重要人物表')).toBe('characters');

    expect(releaseGlobalNameMapperForOwner_ACU(ownerB)).toBe(true);
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('unbound');
  });

  it('更旧的发布者不得覆盖更新发布者的映射', () => {
    const staleOwner = createNameMapperOwnerToken_ACU('stale');
    const currentOwner = createNameMapperOwnerToken_ACU('current');

    expect(publishGlobalNameMapperForDDLs_ACU(ddlMapB, currentOwner)).toBe(true);
    expect(publishGlobalNameMapperForDDLs_ACU(ddlMapA, staleOwner)).toBe(false);

    expect(getGlobalNameMapperOwnershipSnapshot_ACU().ownerLabel).toBe('current');
    expect(getNameMapper().resolveTableName('重要人物表')).toBe('characters');
    expect(isGlobalNameMapperCurrentForDDLs_ACU(ddlMapB)).toBe(true);
  });

  it('empty_schema 发布同样受所有权保护', () => {
    const ownerA = createNameMapperOwnerToken_ACU('runtime-a');
    const ownerB = createNameMapperOwnerToken_ACU('runtime-b');

    publishGlobalNameMapperForDDLs_ACU(ddlMapA, ownerA);
    expect(publishGlobalNameMapperEmptySchema_ACU(ownerB)).toBe(true);
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('empty_schema');

    expect(releaseGlobalNameMapperForOwner_ACU(ownerA)).toBe(false);
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('empty_schema');
  });

  it('同一发布者可重复发布并按新 schema 切换绑定', () => {
    const owner = createNameMapperOwnerToken_ACU('runtime');

    publishGlobalNameMapperForDDLs_ACU(ddlMapA, owner);
    expect(getNameMapper().resolveTableName('背包物品表')).toBe('inventory');

    publishGlobalNameMapperForDDLs_ACU(ddlMapB, owner);
    expect(getNameMapper().resolveTableName('重要人物表')).toBe('characters');
    expect(isGlobalNameMapperCurrentForDDLs_ACU(ddlMapA)).toBe(false);
  });

  it('ensureGlobalNameMapperForDDLs_ACU 不得改写仍被 runtime 持有的映射', () => {
    const owner = createNameMapperOwnerToken_ACU('runtime');
    publishGlobalNameMapperForDDLs_ACU(ddlMapA, owner);

    ensureGlobalNameMapperForDDLs_ACU(ddlMapB);

    // owner 说是 A、内容却来自别处，会让 A 的释放清掉不属于它的映射。
    expect(isGlobalNameMapperCurrentForDDLs_ACU(ddlMapA)).toBe(true);
    expect(isGlobalNameMapperCurrentForDDLs_ACU(ddlMapB)).toBe(false);
    expect(getNameMapper().resolveTableName('背包物品表')).toBe('inventory');
    expect(releaseGlobalNameMapperForOwner_ACU(owner)).toBe(true);
  });

  it('无 runtime 持有时，ensureGlobalNameMapperForDDLs_ACU 仍可刷新绑定', () => {
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('unbound');

    ensureGlobalNameMapperForDDLs_ACU(ddlMapB);

    expect(getGlobalNameMapperStatus_ACU().binding).toBe('bound');
    expect(getGlobalNameMapperOwnershipSnapshot_ACU().ownerId).toBeNull();
    expect(getNameMapper().resolveTableName('重要人物表')).toBe('characters');
  });

  it('伪造的凭证不能抢占发布权，也不能释放真实发布者的映射', () => {
    const realOwner = createNameMapperOwnerToken_ACU('runtime');
    publishGlobalNameMapperForDDLs_ACU(ddlMapA, realOwner);

    // 反射复制真实凭证上的品牌 Symbol，并刻意抬高 id：
    // 仅检查属性形状的实现会被这种伪造穿透。
    const brandSymbols = Object.getOwnPropertySymbols(realOwner);
    expect(brandSymbols.length).toBeGreaterThan(0);
    const forged = { id: Number.MAX_SAFE_INTEGER, label: 'forged' } as unknown as typeof realOwner;
    for (const symbol of brandSymbols) (forged as any)[symbol] = (realOwner as any)[symbol];

    expect(publishGlobalNameMapperForDDLs_ACU(ddlMapB, forged)).toBe(false);
    expect(releaseGlobalNameMapperForOwner_ACU(forged)).toBe(false);
    expect(isGlobalNameMapperCurrentForDDLs_ACU(ddlMapA)).toBe(true);
    expect(getGlobalNameMapperOwnershipSnapshot_ACU().ownerLabel).toBe('runtime');
  });

  it('owned empty_schema 也不得由无所有权入口改写为 bound', () => {
    const owner = createNameMapperOwnerToken_ACU('runtime');
    publishGlobalNameMapperEmptySchema_ACU(owner);
    const ownerBefore = getGlobalNameMapperOwnershipSnapshot_ACU();

    ensureGlobalNameMapperForDDLs_ACU(ddlMapA);

    // owner 说内容由 A 发布、内容却来自 CRUD 输入，会让 A 的释放清掉别人的映射。
    expect(getGlobalNameMapperOwnershipSnapshot_ACU()).toEqual(ownerBefore);
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('empty_schema');

    // 活跃 runtime 用自己的凭证发布，才能从空 schema 进入 bound。
    expect(publishGlobalNameMapperForDDLs_ACU(ddlMapA, owner)).toBe(true);
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('bound');
    expect(getGlobalNameMapperOwnershipSnapshot_ACU().ownerId).toBe(ownerBefore.ownerId);
  });
});

