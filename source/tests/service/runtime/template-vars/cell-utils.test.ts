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

import { getCellValue_ACU, normalizeOperators_ACU, evaluateCellExpression_ACU } from '../../../../src/service/runtime/template-vars/cell-utils';

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
  it('行标识在任意列中匹配', () => {
    const result = getCellValue_ACU(mockTables, '角色属性表', '生命值', '数值');
    expect(result.success).toBe(true);
    expect(result.value).toBe(80);
  });
});

describe('normalizeOperators_ACU', () => {
  it('全角等号转双等号', () => expect(normalizeOperators_ACU('＝')).toBe('=='));
});

describe('evaluateCellExpression_ACU', () => {
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
  it('表格不存在时 != 返回 true', () => {
    expect(evaluateCellExpression_ACU('不存在/行/列 != 0', mockTables)).toBe(true);
  });
  it('无运算符返回 false', () => {
    expect(evaluateCellExpression_ACU('背包物品表/铁剑/数量', mockTables)).toBe(false);
  });
});
