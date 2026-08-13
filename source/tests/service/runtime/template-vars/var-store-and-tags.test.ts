/**
 * tests/service/runtime/template-vars/var-store-and-tags.test.ts
 * 模板变量存储管理 + Random/Calc/Max/Min 标签解析 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../../../src/service/runtime/template-vars/cell-utils', () => ({
  getCellValue_ACU: vi.fn((_tables: any, _row: string, _col: string, allTablesJson: any) => {
    if (_tables === '属性表' && _row === '攻击力' && _col === '数值') return 25;
    return null;
  }),
}));

import {
  getTemplateVariableStores_ACU,
  setTemplateVariableStores_ACU,
  parseRandomTags_ACU,
  replaceRandomVariables_ACU,
  getRandomVariable_ACU,
  parseCalcTags_ACU,
  replaceCalcVariables_ACU,
  getCalcVariable_ACU,
  parseMaxTags_ACU,
  replaceMaxVariables_ACU,
  getMaxVariable_ACU,
  parseMinTags_ACU,
  replaceMinVariables_ACU,
  getMinVariable_ACU,
  parseCalcExpressionValue_ACU,
} from '../../../../src/service/runtime/template-vars/var-store-and-tags';

beforeEach(() => {
  setTemplateVariableStores_ACU(null);
});

// ═══════════════════════════════════════════════════════════════
// 存储管理
// ═══════════════════════════════════════════════════════════════
describe('getTemplateVariableStores_ACU / setTemplateVariableStores_ACU', () => {
  it('初始状态为空对象', () => {
    const stores = getTemplateVariableStores_ACU();
    expect(stores.randomVariables_ACU).toEqual({});
    expect(stores.calcVariables_ACU).toEqual({});
    expect(stores.maxVariables_ACU).toEqual({});
    expect(stores.minVariables_ACU).toEqual({});
  });
  it('设置后可读取', () => {
    setTemplateVariableStores_ACU({
      randomVariables_ACU: { dice: 4 },
      calcVariables_ACU: { total: 10 },
      maxVariables_ACU: { maxHp: 100 },
      minVariables_ACU: { minDmg: 1 },
    });
    const stores = getTemplateVariableStores_ACU();
    expect(stores.randomVariables_ACU).toEqual({ dice: 4 });
    expect(stores.calcVariables_ACU).toEqual({ total: 10 });
  });
  it('null 重置为空', () => {
    setTemplateVariableStores_ACU({ randomVariables_ACU: { a: 1 } });
    setTemplateVariableStores_ACU(null);
    expect(getTemplateVariableStores_ACU().randomVariables_ACU).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════
// Random 标签
// ═══════════════════════════════════════════════════════════════
describe('parseRandomTags_ACU', () => {
  it('生成随机数并替换标签', () => {
    const result = parseRandomTags_ACU('前缀<random min="1" max="6" />后缀');
    expect(result).toMatch(/^前缀\d后缀$/);
  });
  it('带 id 的随机数存储为变量', () => {
    const result = parseRandomTags_ACU('<random id="dice" min="1" max="6" />');
    expect(result).toBe('');
    const value = getRandomVariable_ACU('dice');
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(6);
  });
  it('缺少 min/max 参数不替换', () => {
    const result = parseRandomTags_ACU('<random id="x" />');
    expect(result).toContain('<random');
  });
  it('空字符串返回空', () => {
    expect(parseRandomTags_ACU('')).toBe('');
  });
  it('null 返回空', () => {
    expect(parseRandomTags_ACU(null as any)).toBe('');
  });
  it('min > max 自动交换', () => {
    parseRandomTags_ACU('<random id="swap" min="10" max="1" />');
    const value = getRandomVariable_ACU('swap');
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(10);
  });
});

describe('replaceRandomVariables_ACU', () => {
  it('替换已定义的变量引用', () => {
    parseRandomTags_ACU('<random id="dice" min="5" max="5" />');
    const result = replaceRandomVariables_ACU('你掷出了$random:dice');
    expect(result).toBe('你掷出了5');
  });
  it('未定义的变量保留原文', () => {
    const result = replaceRandomVariables_ACU('$random:unknown');
    expect(result).toBe('$random:unknown');
  });
  it('空字符串返回空', () => {
    expect(replaceRandomVariables_ACU('')).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// Calc 标签
// ═══════════════════════════════════════════════════════════════
describe('parseCalcTags_ACU', () => {
  it('简单算术表达式', () => {
    parseCalcTags_ACU('<calc id="sum" expr="3+5" />', {});
    expect(getCalcVariable_ACU('sum')).toBe(8);
  });
  it('乘法表达式', () => {
    parseCalcTags_ACU('<calc id="product" expr="4*3" />', {});
    expect(getCalcVariable_ACU('product')).toBe(12);
  });
  it('引用随机数变量', () => {
    parseRandomTags_ACU('<random id="r" min="10" max="10" />');
    parseCalcTags_ACU('<calc id="doubled" expr="$random:r*2" />', {});
    expect(getCalcVariable_ACU('doubled')).toBe(20);
  });
  it('缺少 id 或 expr 不替换', () => {
    const result = parseCalcTags_ACU('<calc id="x" />', {});
    expect(result).toContain('<calc');
  });
  it('除零返回失败', () => {
    parseCalcTags_ACU('<calc id="divzero" expr="10/0" />', {});
    // 除零在 JS 中返回 Infinity，evaluateCalcExpression 会判断 !isFinite
    expect(getCalcVariable_ACU('divzero')).toBeNull();
  });
  it('非法字符表达式失败', () => {
    parseCalcTags_ACU('<calc id="bad" expr="abc" />', {});
    expect(getCalcVariable_ACU('bad')).toBeNull();
  });
});

describe('replaceCalcVariables_ACU', () => {
  it('替换已定义的计算变量', () => {
    parseCalcTags_ACU('<calc id="hp" expr="80+20" />', {});
    expect(replaceCalcVariables_ACU('生命值: $calc:hp')).toBe('生命值: 100');
  });
  it('未定义的变量保留原文', () => {
    expect(replaceCalcVariables_ACU('$calc:unknown')).toBe('$calc:unknown');
  });
});

// ═══════════════════════════════════════════════════════════════
// Max/Min 标签
// ═══════════════════════════════════════════════════════════════
describe('parseMaxTags_ACU', () => {
  it('取最大值', () => {
    parseMaxTags_ACU('<max id="maxVal" values="3, 7, 1" />', {});
    expect(getMaxVariable_ACU('maxVal')).toBe(7);
  });
  it('单个值', () => {
    parseMaxTags_ACU('<max id="single" values="42" />', {});
    expect(getMaxVariable_ACU('single')).toBe(42);
  });
  it('缺少参数不替换', () => {
    const result = parseMaxTags_ACU('<max id="x" />', {});
    expect(result).toContain('<max');
  });
});

describe('parseMinTags_ACU', () => {
  it('取最小值', () => {
    parseMinTags_ACU('<min id="minVal" values="3, 7, 1" />', {});
    expect(getMinVariable_ACU('minVal')).toBe(1);
  });
  it('单个值', () => {
    parseMinTags_ACU('<min id="single" values="42" />', {});
    expect(getMinVariable_ACU('single')).toBe(42);
  });
});

describe('replaceMaxVariables_ACU / replaceMinVariables_ACU', () => {
  it('替换最大值变量', () => {
    parseMaxTags_ACU('<max id="m" values="10, 20" />', {});
    expect(replaceMaxVariables_ACU('最大: $max:m')).toBe('最大: 20');
  });
  it('替换最小值变量', () => {
    parseMinTags_ACU('<min id="m" values="10, 20" />', {});
    expect(replaceMinVariables_ACU('最小: $min:m')).toBe('最小: 10');
  });
});

// ═══════════════════════════════════════════════════════════════
// parseCalcExpressionValue_ACU
// ═══════════════════════════════════════════════════════════════
describe('parseCalcExpressionValue_ACU', () => {
  it('纯数字', () => {
    expect(parseCalcExpressionValue_ACU('42', {})).toEqual({ success: true, value: 42, error: null });
  });
  it('负数', () => {
    expect(parseCalcExpressionValue_ACU('-3.5', {})).toEqual({ success: true, value: -3.5, error: null });
  });
  it('$random 引用', () => {
    parseRandomTags_ACU('<random id="r" min="7" max="7" />');
    const result = parseCalcExpressionValue_ACU('$random:r', {});
    expect(result.success).toBe(true);
    expect(result.value).toBe(7);
  });
  it('$calc 引用', () => {
    parseCalcTags_ACU('<calc id="c" expr="5+5" />', {});
    const result = parseCalcExpressionValue_ACU('$calc:c', {});
    expect(result.success).toBe(true);
    expect(result.value).toBe(10);
  });
  it('$max 引用', () => {
    parseMaxTags_ACU('<max id="mx" values="3, 9" />', {});
    const result = parseCalcExpressionValue_ACU('$max:mx', {});
    expect(result.success).toBe(true);
    expect(result.value).toBe(9);
  });
  it('$min 引用', () => {
    parseMinTags_ACU('<min id="mn" values="3, 9" />', {});
    const result = parseCalcExpressionValue_ACU('$min:mn', {});
    expect(result.success).toBe(true);
    expect(result.value).toBe(3);
  });
  it('不存在的变量返回失败', () => {
    const result = parseCalcExpressionValue_ACU('$random:nope', {});
    expect(result.success).toBe(false);
  });
  it('空表达式返回失败', () => {
    const result = parseCalcExpressionValue_ACU('', {});
    expect(result.success).toBe(false);
  });
  it('无法解析的表达式返回失败', () => {
    const result = parseCalcExpressionValue_ACU('abc', {});
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// getRandomVariable_ACU
// ═══════════════════════════════════════════════════════════════
describe('getRandomVariable_ACU', () => {
  it('已定义的变量返回值', () => {
    parseRandomTags_ACU('<random id="test" min="5" max="5" />');
    expect(getRandomVariable_ACU('test')).toBe(5);
  });
  it('未定义的变量返回 null', () => {
    expect(getRandomVariable_ACU('nonexistent')).toBeNull();
  });
  it('重置后返回 null', () => {
    parseRandomTags_ACU('<random id="temp" min="1" max="1" />');
    setTemplateVariableStores_ACU(null);
    expect(getRandomVariable_ACU('temp')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// getCalcVariable_ACU
// ═══════════════════════════════════════════════════════════════
describe('getCalcVariable_ACU', () => {
  it('已定义的变量返回值', () => {
    parseCalcTags_ACU('<calc id="hp" expr="50+50" />', {});
    expect(getCalcVariable_ACU('hp')).toBe(100);
  });
  it('未定义的变量返回 null', () => {
    expect(getCalcVariable_ACU('nonexistent')).toBeNull();
  });
  it('值为 0 时正确返回', () => {
    parseCalcTags_ACU('<calc id="zero" expr="5-5" />', {});
    expect(getCalcVariable_ACU('zero')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// getMaxVariable_ACU
// ═══════════════════════════════════════════════════════════════
describe('getMaxVariable_ACU', () => {
  it('已定义的变量返回值', () => {
    parseMaxTags_ACU('<max id="maxHp" values="50, 100, 75" />', {});
    expect(getMaxVariable_ACU('maxHp')).toBe(100);
  });
  it('未定义的变量返回 null', () => {
    expect(getMaxVariable_ACU('nonexistent')).toBeNull();
  });
  it('负数取最大值', () => {
    parseMaxTags_ACU('<max id="neg" values="-10, -5, -20" />', {});
    expect(getMaxVariable_ACU('neg')).toBe(-5);
  });
});

// ═══════════════════════════════════════════════════════════════
// getMinVariable_ACU
// ═══════════════════════════════════════════════════════════════
describe('getMinVariable_ACU', () => {
  it('已定义的变量返回值', () => {
    parseMinTags_ACU('<min id="minDmg" values="5, 10, 3" />', {});
    expect(getMinVariable_ACU('minDmg')).toBe(3);
  });
  it('未定义的变量返回 null', () => {
    expect(getMinVariable_ACU('nonexistent')).toBeNull();
  });
  it('负数取最小值', () => {
    parseMinTags_ACU('<min id="neg" values="-10, -5, -20" />', {});
    expect(getMinVariable_ACU('neg')).toBe(-20);
  });
});
