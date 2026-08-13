/**
 * tests/service/runtime/template-vars/seed-condition.test.ts
 * Seed 关键词表达式求值 + 统一条件表达式求值 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../../../src/service/runtime/template-vars/cell-utils', () => ({
  evaluateCellExpression_ACU: vi.fn((expr: string) => {
    if (expr.includes('生命值') && expr.includes('> 50')) return true;
    if (expr.includes('攻击力') && expr.includes('< 10')) return false;
    return false;
  }),
  normalizeOperators_ACU: vi.fn((s: string) => s),
  compareValue_ACU: vi.fn((a: any, op: string, b: any) => {
    if (op === '>') return a > b;
    if (op === '<') return a < b;
    if (op === '==') return a === b;
    if (op === '!=') return a !== b;
    if (op === '>=') return a >= b;
    if (op === '<=') return a <= b;
    return false;
  }),
}));

vi.mock('../../../../src/service/runtime/template-vars/var-store-and-tags', () => ({
  getRandomVariable_ACU: vi.fn((id: string) => {
    if (id === 'dice') return 4;
    return null;
  }),
  getCalcVariable_ACU: vi.fn((id: string) => {
    if (id === 'total') return 15;
    return null;
  }),
  getMaxVariable_ACU: vi.fn(() => null),
  getMinVariable_ACU: vi.fn(() => null),
}));

vi.mock('../../../../src/service/runtime/template-vars/sql-query-var', () => ({
  evaluateDbCondition: vi.fn(() => false),
  evaluateSqlCondition: vi.fn(() => false),
}));

import { evaluateSeedExpression_ACU, evaluateCondExpression_ACU } from '../../../../src/service/runtime/template-vars/seed-condition';

// ═══════════════════════════════════════════════════════════════
// evaluateSeedExpression_ACU
// ═══════════════════════════════════════════════════════════════
describe('evaluateSeedExpression_ACU', () => {
  const content = '勇者拔出了铁剑，向恶龙发起了战斗';

  it('简单关键词匹配', () => {
    expect(evaluateSeedExpression_ACU('战斗', content)).toBe(true);
  });
  it('关键词不匹配', () => {
    expect(evaluateSeedExpression_ACU('魔法', content)).toBe(false);
  });
  it('或逻辑（逗号分隔）', () => {
    expect(evaluateSeedExpression_ACU('魔法,战斗', content)).toBe(true);
  });
  it('与逻辑（& 分隔）', () => {
    expect(evaluateSeedExpression_ACU('战斗&铁剑', content)).toBe(true);
  });
  it('与逻辑不满足', () => {
    expect(evaluateSeedExpression_ACU('战斗&魔法', content)).toBe(false);
  });
  it('非逻辑（!前缀）', () => {
    expect(evaluateSeedExpression_ACU('!魔法', content)).toBe(true);
  });
  it('非逻辑不满足', () => {
    expect(evaluateSeedExpression_ACU('!战斗', content)).toBe(false);
  });
  it('括号分组', () => {
    expect(evaluateSeedExpression_ACU('(战斗&铁剑),魔法', content)).toBe(true);
  });
  it('大小写不敏感', () => {
    const eng = 'The hero fights the Dragon';
    expect(evaluateSeedExpression_ACU('dragon', eng)).toBe(true);
  });
  it('plotContent 也参与匹配', () => {
    expect(evaluateSeedExpression_ACU('剧情推进', '普通内容', '剧情推进数据')).toBe(true);
  });
  it('空表达式返回 false', () => {
    expect(evaluateSeedExpression_ACU('', content)).toBe(false);
  });
  it('空内容返回 false', () => {
    expect(evaluateSeedExpression_ACU('战斗', '')).toBe(false);
  });
  it('null 表达式返回 false', () => {
    expect(evaluateSeedExpression_ACU(null as any, content)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// evaluateCondExpression_ACU
// ═══════════════════════════════════════════════════════════════
describe('evaluateCondExpression_ACU', () => {
  const context = {
    seedContent: '勇者拔出了铁剑，向恶龙发起了战斗',
    allTablesJson: {},
    plotContent: '',
  };

  it('seed: 前缀条件', () => {
    expect(evaluateCondExpression_ACU('seed:战斗', context)).toBe(true);
  });
  it('seed: 前缀不匹配', () => {
    expect(evaluateCondExpression_ACU('seed:魔法', context)).toBe(false);
  });
  it('cell: 前缀条件', () => {
    expect(evaluateCondExpression_ACU('cell:角色属性表/生命值/数值 > 50', context)).toBe(true);
  });
  it('random: 前缀条件', () => {
    expect(evaluateCondExpression_ACU('random:dice > 3', context)).toBe(true);
  });
  it('calc: 前缀条件', () => {
    expect(evaluateCondExpression_ACU('calc:total > 10', context)).toBe(true);
  });
  it('取反 !seed:', () => {
    expect(evaluateCondExpression_ACU('!seed:魔法', context)).toBe(true);
  });
  it('AND 组合（&）', () => {
    expect(evaluateCondExpression_ACU('seed:战斗 & seed:铁剑', context)).toBe(true);
  });
  it('OR 组合（,）', () => {
    expect(evaluateCondExpression_ACU('seed:魔法, seed:战斗', context)).toBe(true);
  });
  it('括号分组', () => {
    expect(evaluateCondExpression_ACU('(seed:战斗 & seed:铁剑), seed:魔法', context)).toBe(true);
  });
  it('嵌套括号', () => {
    expect(evaluateCondExpression_ACU('((seed:战斗))', context)).toBe(true);
  });
  it('无前缀默认作为关键词匹配', () => {
    expect(evaluateCondExpression_ACU('战斗', context)).toBe(true);
  });
  it('空表达式返回 false', () => {
    expect(evaluateCondExpression_ACU('', context)).toBe(false);
  });
  it('null 表达式返回 false', () => {
    expect(evaluateCondExpression_ACU(null as any, context)).toBe(false);
  });

  // ═══ db: 前缀 ═══
  describe('db: 前缀', () => {
    it('db: 条件为 true 时返回 true', async () => {
      const { evaluateDbCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateDbCondition).mockReturnValue(true);
      expect(evaluateCondExpression_ACU('db:背包物品表.count() > 0', context)).toBe(true);
      expect(evaluateDbCondition).toHaveBeenCalledWith('背包物品表.count() > 0');
    });

    it('db: 条件为 false 时返回 false', async () => {
      const { evaluateDbCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateDbCondition).mockReturnValue(false);
      expect(evaluateCondExpression_ACU('db:不存在的表.count() > 0', context)).toBe(false);
    });

    it('!db: 取反', async () => {
      const { evaluateDbCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateDbCondition).mockReturnValue(true);
      expect(evaluateCondExpression_ACU('!db:背包物品表.count() > 0', context)).toBe(false);
    });

    it('!db: 取反（原条件为 false）', async () => {
      const { evaluateDbCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateDbCondition).mockReturnValue(false);
      expect(evaluateCondExpression_ACU('!db:不存在.count()', context)).toBe(true);
    });

    it('db: 包含复杂括号的 ORM 表达式', async () => {
      const { evaluateDbCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateDbCondition).mockReturnValue(true);
      const expr = "db:背包物品表.where('物品名称', '铁剑').exists()";
      expect(evaluateCondExpression_ACU(expr, context)).toBe(true);
      expect(evaluateDbCondition).toHaveBeenCalledWith("背包物品表.where('物品名称', '铁剑').exists()");
    });

    it('db: 包含多层括号嵌套', async () => {
      const { evaluateDbCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateDbCondition).mockReturnValue(true);
      const expr = "db:背包物品表.where('物品名称', '铁剑').get('数量')";
      expect(evaluateCondExpression_ACU(expr, context)).toBe(true);
      expect(evaluateDbCondition).toHaveBeenCalledWith("背包物品表.where('物品名称', '铁剑').get('数量')");
    });

    it('多个 db: 条件用 & 连接（包含括号）', async () => {
      const { evaluateDbCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateDbCondition).mockClear();
      vi.mocked(evaluateDbCondition).mockReturnValue(true);
      expect(evaluateCondExpression_ACU('db:背包物品表.count() > 0 & db:重要人物表.count() > 0', context)).toBe(true);
      // 应该被调用两次（清除后）
      expect(evaluateDbCondition).toHaveBeenCalledTimes(2);
      expect(evaluateDbCondition).toHaveBeenCalledWith('背包物品表.count() > 0');
      expect(evaluateDbCondition).toHaveBeenCalledWith('重要人物表.count() > 0');
    });
  });

  // ═══ sql: 前缀 ═══
  describe('sql: 前缀', () => {
    it('sql: 条件为 true 时返回 true', async () => {
      const { evaluateSqlCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateSqlCondition).mockReturnValue(true);
      expect(evaluateCondExpression_ACU('sql:SELECT 1 FROM inventory', context)).toBe(true);
      expect(evaluateSqlCondition).toHaveBeenCalledWith('SELECT 1 FROM inventory');
    });

    it('sql: 条件为 false 时返回 false', async () => {
      const { evaluateSqlCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateSqlCondition).mockReturnValue(false);
      expect(evaluateCondExpression_ACU('sql:SELECT 1 WHERE 1=0', context)).toBe(false);
    });

    it('!sql: 取反', async () => {
      const { evaluateSqlCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateSqlCondition).mockReturnValue(true);
      expect(evaluateCondExpression_ACU('!sql:SELECT 1', context)).toBe(false);
    });

    it('!sql: 取反（原条件为 false）', async () => {
      const { evaluateSqlCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateSqlCondition).mockReturnValue(false);
      expect(evaluateCondExpression_ACU('!sql:SELECT 1 WHERE 1=0', context)).toBe(true);
    });

    it('sql: 包含 SQL 函数括号', async () => {
      const { evaluateSqlCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateSqlCondition).mockReturnValue(true);
      expect(evaluateCondExpression_ACU('sql:SELECT COUNT(*) FROM inventory', context)).toBe(true);
      expect(evaluateSqlCondition).toHaveBeenCalledWith('SELECT COUNT(*) FROM inventory');
    });

    it('sql: 包含多个 SQL 函数括号', async () => {
      const { evaluateSqlCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateSqlCondition).mockReturnValue(true);
      expect(evaluateCondExpression_ACU('sql:SELECT SUM(quantity) FROM inventory WHERE item_name IN (\'a\')', context)).toBe(true);
      expect(evaluateSqlCondition).toHaveBeenCalledWith("SELECT SUM(quantity) FROM inventory WHERE item_name IN (\'a\')");
    });
  });

  // ═══ max: 前缀 ═══
  describe('max: 前缀', () => {
    it('max: 变量存在且条件满足时返回 true', async () => {
      const { getMaxVariable_ACU } = await import('../../../../src/service/runtime/template-vars/var-store-and-tags');
      vi.mocked(getMaxVariable_ACU).mockReturnValue(100);
      expect(evaluateCondExpression_ACU('max:hp > 50', context)).toBe(true);
    });

    it('max: 变量存在但条件不满足时返回 false', async () => {
      const { getMaxVariable_ACU } = await import('../../../../src/service/runtime/template-vars/var-store-and-tags');
      vi.mocked(getMaxVariable_ACU).mockReturnValue(30);
      expect(evaluateCondExpression_ACU('max:hp > 50', context)).toBe(false);
    });

    it('max: 变量不存在时返回 false', async () => {
      const { getMaxVariable_ACU } = await import('../../../../src/service/runtime/template-vars/var-store-and-tags');
      vi.mocked(getMaxVariable_ACU).mockReturnValue(null);
      expect(evaluateCondExpression_ACU('max:nonexistent > 0', context)).toBe(false);
    });

    it('!max: 取反', async () => {
      const { getMaxVariable_ACU } = await import('../../../../src/service/runtime/template-vars/var-store-and-tags');
      vi.mocked(getMaxVariable_ACU).mockReturnValue(100);
      expect(evaluateCondExpression_ACU('!max:hp > 50', context)).toBe(false);
    });
  });

  // ═══ min: 前缀 ═══
  describe('min: 前缀', () => {
    it('min: 变量存在且条件满足时返回 true', async () => {
      const { getMinVariable_ACU } = await import('../../../../src/service/runtime/template-vars/var-store-and-tags');
      vi.mocked(getMinVariable_ACU).mockReturnValue(10);
      expect(evaluateCondExpression_ACU('min:hp < 50', context)).toBe(true);
    });

    it('min: 变量存在但条件不满足时返回 false', async () => {
      const { getMinVariable_ACU } = await import('../../../../src/service/runtime/template-vars/var-store-and-tags');
      vi.mocked(getMinVariable_ACU).mockReturnValue(80);
      expect(evaluateCondExpression_ACU('min:hp < 50', context)).toBe(false);
    });

    it('min: 变量不存在时返回 false', async () => {
      const { getMinVariable_ACU } = await import('../../../../src/service/runtime/template-vars/var-store-and-tags');
      vi.mocked(getMinVariable_ACU).mockReturnValue(null);
      expect(evaluateCondExpression_ACU('min:nonexistent > 0', context)).toBe(false);
    });

    it('!min: 取反', async () => {
      const { getMinVariable_ACU } = await import('../../../../src/service/runtime/template-vars/var-store-and-tags');
      vi.mocked(getMinVariable_ACU).mockReturnValue(10);
      expect(evaluateCondExpression_ACU('!min:hp < 50', context)).toBe(false);
    });
  });

  // ═══ !random: 和 !calc: 取反 ═══
  describe('random:/calc: 取反', () => {
    it('!random: 取反（原条件为 true）', () => {
      // dice=4, 4 > 3 = true, 取反 = false
      expect(evaluateCondExpression_ACU('!random:dice > 3', context)).toBe(false);
    });

    it('!random: 取反（原条件为 false）', () => {
      // dice=4, 4 > 10 = false, 取反 = true
      expect(evaluateCondExpression_ACU('!random:dice > 10', context)).toBe(true);
    });

    it('!calc: 取反（原条件为 true）', () => {
      // total=15, 15 > 10 = true, 取反 = false
      expect(evaluateCondExpression_ACU('!calc:total > 10', context)).toBe(false);
    });

    it('!calc: 取反（原条件为 false）', () => {
      // total=15, 15 > 100 = false, 取反 = true
      expect(evaluateCondExpression_ACU('!calc:total > 100', context)).toBe(true);
    });
  });

  // ═══ 混合组合 ═══
  describe('db/sql 与其他前缀混合组合', () => {
    it('db: 与 seed: 组合（AND）', async () => {
      const { evaluateDbCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateDbCondition).mockReturnValue(true);
      expect(evaluateCondExpression_ACU('db:test & seed:战斗', context)).toBe(true);
    });

    it('db: 与 seed: 组合（AND，db 为 false）', async () => {
      const { evaluateDbCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateDbCondition).mockReturnValue(false);
      expect(evaluateCondExpression_ACU('db:test & seed:战斗', context)).toBe(false);
    });

    it('sql: 与 random: 组合（OR）', async () => {
      const { evaluateSqlCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateSqlCondition).mockReturnValue(false);
      // sql: false, random:dice > 3 = true → false OR true = true
      expect(evaluateCondExpression_ACU('sql:SELECT 1 WHERE 1=0, random:dice > 3', context)).toBe(true);
    });

    it('括号分组中的 db: 和 sql:', async () => {
      const { evaluateDbCondition, evaluateSqlCondition } = await import('../../../../src/service/runtime/template-vars/sql-query-var');
      vi.mocked(evaluateDbCondition).mockReturnValue(true);
      vi.mocked(evaluateSqlCondition).mockReturnValue(false);
      // (db:true & sql:false) = false, seed:战斗 = true → false OR true = true
      expect(evaluateCondExpression_ACU('(db:test & sql:test), seed:战斗', context)).toBe(true);
    });

    it('max: 与 min: 组合（AND）', async () => {
      const { getMaxVariable_ACU, getMinVariable_ACU } = await import('../../../../src/service/runtime/template-vars/var-store-and-tags');
      vi.mocked(getMaxVariable_ACU).mockReturnValue(100);
      vi.mocked(getMinVariable_ACU).mockReturnValue(10);
      // max:hp > 50 = true, min:hp < 50 = true → true AND true = true
      expect(evaluateCondExpression_ACU('max:hp > 50 & min:hp < 50', context)).toBe(true);
    });
  });
});
