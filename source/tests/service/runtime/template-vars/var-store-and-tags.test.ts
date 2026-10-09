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
  getCellValue_ACU: vi.fn((_allTablesJson: any, tableName: string, rowName: string, colName: string) => {
    if (tableName === '属性表' && rowName === '攻击力' && colName === '数值') {
      return { success: true, value: 25, rawValue: '25' };
    }
    return { success: false, value: null, error: '未找到单元格' };
  }),
}));

import {
  setTemplateVariableStores_ACU,
  parseRandomTags_ACU,
  replaceRandomVariables_ACU,
  getRandomVariable_ACU,
  parseCalcTags_ACU,
  replaceCalcVariables_ACU,
  getCalcVariable_ACU,
  parseMaxTags_ACU,
  parseMinTags_ACU,
  parseCalcExpressionValue_ACU,
} from '../../../../src/service/runtime/template-vars/var-store-and-tags';

beforeEach(() => {
  setTemplateVariableStores_ACU(null);
});

// ═══════════════════════════════════════════════════════════════
// Random 标签
// ═══════════════════════════════════════════════════════════════
describe('parseRandomTags_ACU', () => {
  it('生成随机数并替换标签', () => {
    const result = parseRandomTags_ACU('前缀<random min="1" max="6" />后缀');
    expect(result).toMatch(/^前缀\d后缀$/);
  });
  it('缺少 min/max 参数不替换', () => {
    const result = parseRandomTags_ACU('<random id="x" />');
    expect(result).toContain('<random');
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
});

// ═══════════════════════════════════════════════════════════════
// Calc 标签
// ═══════════════════════════════════════════════════════════════
describe('parseCalcTags_ACU', () => {
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
  it('未定义的变量保留原文', () => {
    expect(replaceCalcVariables_ACU('$calc:unknown')).toBe('$calc:unknown');
  });
});

// ═══════════════════════════════════════════════════════════════
// Max/Min 标签
// ═══════════════════════════════════════════════════════════════
describe('parseMaxTags_ACU', () => {
  it('缺少参数不替换', () => {
    const result = parseMaxTags_ACU('<max id="x" />', {});
    expect(result).toContain('<max');
  });
});

// ═══════════════════════════════════════════════════════════════
// parseCalcExpressionValue_ACU
// ═══════════════════════════════════════════════════════════════
describe('parseCalcExpressionValue_ACU', () => {
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
});

// ═══════════════════════════════════════════════════════════════
// getCalcVariable_ACU
// ═══════════════════════════════════════════════════════════════
describe('getCalcVariable_ACU', () => {
  it('值为 0 时正确返回', () => {
    parseCalcTags_ACU('<calc id="zero" expr="5-5" />', {});
    expect(getCalcVariable_ACU('zero')).toBe(0);
  });
});
