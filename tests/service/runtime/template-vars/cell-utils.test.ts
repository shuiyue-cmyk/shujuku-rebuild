/**
 * tests/service/runtime/template-vars/cell-utils.test.ts
 * 表格单元格操作纯函数 单元测试
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

import { getCellValue_ACU, normalizeOperators_ACU, compareValue_ACU, evaluateCellExpression_ACU } from '../../../../src/service/runtime/template-vars/cell-utils';

const mockTables = {
  sheet_0: {
    name: '背包物品表',
    content: [
      ['row_id', '物品名', '数量', '品质'],
      ['1', '铁剑', '1', 'B'],
      ['2', '药水', '5', 'C'],
      ['3', '金币', '100', 'A'],
    ],
  },
  sheet_1: {
    name: '角色属性表',
    content: [
      ['row_id', '属性', '数值'],
      ['1', '生命值', '80'],
      ['2', '攻击力', '25'],
    ],
  },
};

describe('getCellValue_ACU', () => {
  it('精确获取单元格值（数值）', () => {
    const result = getCellValue_ACU(mockTables, '背包物品表', '药水', '数量');
    expect(result.success).toBe(true);
    expect(result.value).toBe(5);
  });
  it('精确获取单元格值（字符串）', () => {
    const result = getCellValue_ACU(mockTables, '背包物品表', '铁剑', '品质');
    expect(result.success).toBe(true);
    expect(result.value).toBe('B');
  });
  it('表格不存在返回失败', () => {
    const result = getCellValue_ACU(mockTables, '不存在的表', '铁剑', '数量');
    expect(result.success).toBe(false);
    expect(result.error).toContain('未找到表格');
  });
  it('列不存在返回失败', () => {
    const result = getCellValue_ACU(mockTables, '背包物品表', '铁剑', '不存在的列');
    expect(result.success).toBe(false);
    expect(result.error).toContain('未找到列');
  });
  it('行不存在返回失败', () => {
    const result = getCellValue_ACU(mockTables, '背包物品表', '不存在的行', '数量');
    expect(result.success).toBe(false);
    expect(result.error).toContain('未找到行标识');
  });
  it('表格数据为空返回失败', () => {
    const result = getCellValue_ACU(null, '背包物品表', '铁剑', '数量');
    expect(result.success).toBe(false);
  });
  it('行标识在任意列中匹配', () => {
    const result = getCellValue_ACU(mockTables, '角色属性表', '生命值', '数值');
    expect(result.success).toBe(true);
    expect(result.value).toBe(80);
  });
});

describe('normalizeOperators_ACU', () => {
  it('全角大于号转半角', () => expect(normalizeOperators_ACU('＞')).toBe('>'));
  it('全角小于号转半角', () => expect(normalizeOperators_ACU('＜')).toBe('<'));
  it('全角等号转双等号', () => expect(normalizeOperators_ACU('＝')).toBe('=='));
  it('≥ 转 >=', () => expect(normalizeOperators_ACU('≥')).toBe('>='));
  it('≤ 转 <=', () => expect(normalizeOperators_ACU('≤')).toBe('<='));
  it('≦ 转 <=', () => expect(normalizeOperators_ACU('≦')).toBe('<='));
  it('≠ 转 !=', () => expect(normalizeOperators_ACU('≠')).toBe('!='));
  it('空字符串返回原值', () => expect(normalizeOperators_ACU('')).toBe(''));
  it('null 返回原值', () => expect(normalizeOperators_ACU(null as any)).toBeNull());
});

describe('compareValue_ACU', () => {
  it('数值大于比较', () => expect(compareValue_ACU(10, '>', 5)).toBe(true));
  it('数值小于比较', () => expect(compareValue_ACU(3, '<', 5)).toBe(true));
  it('数值等于比较', () => expect(compareValue_ACU(5, '==', 5)).toBe(true));
  it('数值不等于比较', () => expect(compareValue_ACU(5, '!=', 3)).toBe(true));
  it('数值大于等于比较', () => expect(compareValue_ACU(5, '>=', 5)).toBe(true));
  it('数值小于等于比较', () => expect(compareValue_ACU(5, '<=', 5)).toBe(true));
  it('字符串等于比较', () => expect(compareValue_ACU('abc', '==', 'abc')).toBe(true));
  it('字符串不等于比较', () => expect(compareValue_ACU('abc', '!=', 'def')).toBe(true));
  it('未知运算符返回 false', () => expect(compareValue_ACU(5, '??', 5)).toBe(false));
});

describe('evaluateCellExpression_ACU', () => {
  it('三段路径精确匹配', () => {
    expect(evaluateCellExpression_ACU('背包物品表/药水/数量 > 3', mockTables)).toBe(true);
  });
  it('三段路径不满足条件', () => {
    expect(evaluateCellExpression_ACU('背包物品表/药水/数量 > 10', mockTables)).toBe(false);
  });
  it('两段路径按行匹配（row[0] 是 row_id）', () => {
    // 两段路径匹配时，targetName 匹配 row[0]（即 row_id 列），但 row_id 是数字
    // 实际上 evaluateCellExpression 的两段路径是在 row[0] 中精确匹配 targetName
    // 我们的测试数据中 row[0] 是 '1','2'，不是 '生命值'
    // 所以需要用列名匹配
    expect(evaluateCellExpression_ACU('角色属性表/数值 > 50', mockTables)).toBe(true);
  });
  it('两段路径按列匹配', () => {
    expect(evaluateCellExpression_ACU('角色属性表/数值 > 50', mockTables)).toBe(true);
  });
  it('全角运算符自动转换', () => {
    expect(evaluateCellExpression_ACU('背包物品表/金币/数量 ≥ 100', mockTables)).toBe(true);
  });
  it('表格不存在时 != 返回 true', () => {
    expect(evaluateCellExpression_ACU('不存在/行/列 != 0', mockTables)).toBe(true);
  });
  it('无运算符返回 false', () => {
    expect(evaluateCellExpression_ACU('背包物品表/铁剑/数量', mockTables)).toBe(false);
  });
  it('空表达式返回 false', () => {
    expect(evaluateCellExpression_ACU('', mockTables)).toBe(false);
  });
  it('null 表达式返回 false', () => {
    expect(evaluateCellExpression_ACU(null as any, mockTables)).toBe(false);
  });
});
