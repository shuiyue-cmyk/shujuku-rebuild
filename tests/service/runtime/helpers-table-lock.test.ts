/**
 * tests/service/runtime/helpers-table-lock.test.ts
 * 表格锁定与索引 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings, mockSaveSettings } = vi.hoisted(() => {
  const mockSettings: any = { tableUpdateLocks: {}, specialIndexLocks: {} };
  const mockSaveSettings = vi.fn();
  return { mockSettings, mockSaveSettings };
});

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentChatFileIdentifier_ACU: 'test-chat',
  getCurrentIsolationKey_ACU: () => 'iso-key',
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn((name: string) => name.includes('总结') || name.includes('纪要')),
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: mockSaveSettings,
}));

import {
  getTableLocksForSheet_ACU,
  saveTableLocksForSheet_ACU,
  deleteTableLocksForSheet_ACU,
  toggleRowLock_ACU,
  toggleColLock_ACU,
  toggleCellLock_ACU,
  isSpecialIndexLockEnabled_ACU,
  setSpecialIndexLockEnabled_ACU,
  clearCurrentTableLocks_ACU,
  getSummaryIndexColumnIndex_ACU,
  formatSummaryIndexCode_ACU,
  applySummaryIndexSequenceToTable_ACU,
  applySpecialIndexSequenceToSummaryTables_ACU,
} from '../../../src/service/runtime/helpers-table-lock';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.tableUpdateLocks = {};
  mockSettings.specialIndexLocks = {};
});

// scopeKey = "test-chat::iso-key"

describe('getTableLocksForSheet_ACU', () => {
  it('无锁定数据返回空 Set', () => {
    const locks = getTableLocksForSheet_ACU('sheet_0');
    expect(locks.rows).toBeInstanceOf(Set);
    expect(locks.cols).toBeInstanceOf(Set);
    expect(locks.cells).toBeInstanceOf(Set);
    expect(locks.rows.size).toBe(0);
  });
  it('有锁定数据返回对应 Set', () => {
    mockSettings.tableUpdateLocks = {
      'test-chat::iso-key': {
        sheet_0: { rows: [1, 2], cols: ['物品名'], cells: [] },
      },
    };
    const locks = getTableLocksForSheet_ACU('sheet_0');
    expect(locks.rows.has(1)).toBe(true);
    expect(locks.rows.has(2)).toBe(true);
    expect(locks.cols.has('物品名')).toBe(true);
  });
});

describe('saveTableLocksForSheet_ACU', () => {
  it('保存锁定数据', () => {
    const lockState = { rows: new Set([1]), cols: new Set(), cells: new Set() };
    saveTableLocksForSheet_ACU('sheet_0', lockState);
    const saved = mockSettings.tableUpdateLocks['test-chat::iso-key']?.sheet_0;
    expect(saved).not.toBeUndefined();
    expect(saved.rows).toEqual([1]);
  });
  it('空 sheetKey 不保存', () => {
    saveTableLocksForSheet_ACU('', { rows: new Set(), cols: new Set(), cells: new Set() });
    expect(mockSettings.tableUpdateLocks['test-chat::iso-key']).toBeUndefined();
  });
});

describe('deleteTableLocksForSheet_ACU', () => {
  it('只删除当前 scope 中指定表的普通锁和特殊索引锁', () => {
    mockSettings.tableUpdateLocks = {
      'test-chat::iso-key': {
        sheet_remove: { rows: [1], cols: [], cells: [] },
        sheet_keep: { rows: [2], cols: [], cells: [] },
      },
      'other-chat::iso-key': { sheet_remove: { rows: [3], cols: [], cells: [] } },
    };
    mockSettings.specialIndexLocks = {
      'test-chat::iso-key': { sheet_remove: false, sheet_keep: true },
      'test-chat::other-iso': { sheet_remove: false },
    };

    expect(deleteTableLocksForSheet_ACU('sheet_remove')).toBe(true);
    expect(mockSettings.tableUpdateLocks['test-chat::iso-key'].sheet_remove).toBeUndefined();
    expect(mockSettings.tableUpdateLocks['test-chat::iso-key'].sheet_keep).toBeDefined();
    expect(mockSettings.tableUpdateLocks['other-chat::iso-key'].sheet_remove).toBeDefined();
    expect(mockSettings.specialIndexLocks['test-chat::iso-key'].sheet_remove).toBeUndefined();
    expect(mockSettings.specialIndexLocks['test-chat::iso-key'].sheet_keep).toBe(true);
    expect(mockSettings.specialIndexLocks['test-chat::other-iso'].sheet_remove).toBe(false);
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
  });
});

describe('toggleRowLock_ACU', () => {
  it('锁定行后可查询到', () => {
    toggleRowLock_ACU('sheet_0', 1);
    const saved = mockSettings.tableUpdateLocks['test-chat::iso-key']?.sheet_0;
    expect(saved.rows).toContain(1);
  });
  it('再次 toggle 解锁', () => {
    toggleRowLock_ACU('sheet_0', 1); // 锁定
    toggleRowLock_ACU('sheet_0', 1); // 解锁
    const saved = mockSettings.tableUpdateLocks['test-chat::iso-key']?.sheet_0;
    expect(saved.rows).not.toContain(1);
  });
});

describe('toggleColLock_ACU', () => {
  it('锁定列后可查询到', () => {
    toggleColLock_ACU('sheet_0', 2);
    const saved = mockSettings.tableUpdateLocks['test-chat::iso-key']?.sheet_0;
    expect(saved.cols).toContain(2);
  });
  it('再次 toggle 解锁', () => {
    toggleColLock_ACU('sheet_0', 2);
    toggleColLock_ACU('sheet_0', 2);
    const saved = mockSettings.tableUpdateLocks['test-chat::iso-key']?.sheet_0;
    expect(saved.cols).not.toContain(2);
  });
});

describe('toggleCellLock_ACU', () => {
  it('锁定单元格后可查询到', () => {
    toggleCellLock_ACU('sheet_0', 1, 2);
    const saved = mockSettings.tableUpdateLocks['test-chat::iso-key']?.sheet_0;
    expect(saved.cells).toContain('1:2');
  });
  it('再次 toggle 解锁', () => {
    toggleCellLock_ACU('sheet_0', 1, 2);
    toggleCellLock_ACU('sheet_0', 1, 2);
    const saved = mockSettings.tableUpdateLocks['test-chat::iso-key']?.sheet_0;
    expect(saved.cells).not.toContain('1:2');
  });
});

describe('isSpecialIndexLockEnabled_ACU / setSpecialIndexLockEnabled_ACU', () => {
  it('默认启用（返回 true）', () => {
    expect(isSpecialIndexLockEnabled_ACU('sheet_0')).toBe(true);
  });
  it('禁用后返回 false', () => {
    setSpecialIndexLockEnabled_ACU('sheet_0', false);
    expect(isSpecialIndexLockEnabled_ACU('sheet_0')).toBe(false);
  });
  it('重新启用后返回 true', () => {
    setSpecialIndexLockEnabled_ACU('sheet_0', false);
    setSpecialIndexLockEnabled_ACU('sheet_0', true);
    expect(isSpecialIndexLockEnabled_ACU('sheet_0')).toBe(true);
  });
});

describe('clearCurrentTableLocks_ACU', () => {
  it('只清理当前聊天和隔离标识的表格锁', () => {
    mockSettings.tableUpdateLocks = {
      'test-chat::iso-key': { sheet_0: { rows: [1], cols: [], cells: [] } },
      'other-chat::iso-key': { sheet_0: { rows: [2], cols: [], cells: [] } },
    };
    mockSettings.specialIndexLocks = {
      'test-chat::iso-key': { sheet_0: false },
      'test-chat::other-iso': { sheet_0: false },
    };

    const result = clearCurrentTableLocks_ACU();

    expect(result.changed).toBe(true);
    expect(result.scopeKey).toBe('test-chat::iso-key');
    expect(mockSettings.tableUpdateLocks['test-chat::iso-key']).toBeUndefined();
    expect(mockSettings.tableUpdateLocks['other-chat::iso-key']).toBeDefined();
    expect(mockSettings.specialIndexLocks['test-chat::iso-key']).toBeUndefined();
    expect(mockSettings.specialIndexLocks['test-chat::other-iso']).toBeDefined();
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
  });

  it('save=false 时不立即保存设置', () => {
    mockSettings.tableUpdateLocks = {
      'test-chat::iso-key': { sheet_0: { rows: [1], cols: [], cells: [] } },
    };

    clearCurrentTableLocks_ACU({ save: false });

    expect(mockSettings.tableUpdateLocks['test-chat::iso-key']).toBeUndefined();
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });
});

describe('getSummaryIndexColumnIndex_ACU', () => {
  it('找到编码列', () => {
    const table = { content: [['row_id', '编码', '事件'], ['1', 'AM0001', '开始']] };
    const idx = getSummaryIndexColumnIndex_ACU(table);
    expect(idx).toBe(0); // headers = content[0].slice(1) → ['编码', '事件']，编码在 index 0
  });
  it('找到索引列', () => {
    const table = { content: [['row_id', '事件', '索引'], ['1', '开始', 'AM0001']] };
    const idx = getSummaryIndexColumnIndex_ACU(table);
    expect(idx).toBe(1); // headers = ['事件', '索引']，索引在 index 1
  });
  it('无匹配列返回最后一列', () => {
    const table = { content: [['row_id', '事件', '时间'], ['1', '开始', '第1天']] };
    const idx = getSummaryIndexColumnIndex_ACU(table);
    expect(idx).toBe(1); // headers = ['事件', '时间']，无匹配，返回 length-1 = 1
  });
  it('null 返回 -1', () => {
    expect(getSummaryIndexColumnIndex_ACU(null)).toBe(-1);
  });
  it('空 content 返回 -1', () => {
    expect(getSummaryIndexColumnIndex_ACU({ content: [] })).toBe(-1);
  });
});

describe('formatSummaryIndexCode_ACU', () => {
  it('格式化为 AM 前缀 + 4 位数字', () => {
    expect(formatSummaryIndexCode_ACU(1)).toBe('AM0001');
    expect(formatSummaryIndexCode_ACU(42)).toBe('AM0042');
    expect(formatSummaryIndexCode_ACU(9999)).toBe('AM9999');
  });
  it('0 或负数返回 AM0001', () => {
    expect(formatSummaryIndexCode_ACU(0)).toBe('AM0001');
    expect(formatSummaryIndexCode_ACU(-5)).toBe('AM0001');
  });
  it('非数字返回 AM0001', () => {
    expect(formatSummaryIndexCode_ACU('abc')).toBe('AM0001');
    expect(formatSummaryIndexCode_ACU(null)).toBe('AM0001');
  });
});

describe('applySummaryIndexSequenceToTable_ACU', () => {
  it('为表格应用索引序列', () => {
    const table = {
      content: [
        ['row_id', '编码', '事件'],
        ['1', '', '开始'],
        ['2', '', '结束'],
      ],
    };
    applySummaryIndexSequenceToTable_ACU(table, 0); // colIndex=0 → 实际写入 row[1]
    expect(table.content[1][1]).toBe('AM0001');
    expect(table.content[2][1]).toBe('AM0002');
  });
  it('null table 不报错', () => {
    expect(() => applySummaryIndexSequenceToTable_ACU(null, 0)).not.toThrow();
  });
  it('负数 colIndex 不操作', () => {
    const table = { content: [['row_id'], ['1']] };
    expect(() => applySummaryIndexSequenceToTable_ACU(table, -1)).not.toThrow();
  });
});

// ═══ applySpecialIndexSequenceToSummaryTables_ACU ═══
describe('applySpecialIndexSequenceToSummaryTables_ACU', () => {
  it('null 数据不报错', () => {
    expect(() => applySpecialIndexSequenceToSummaryTables_ACU(null as any)).not.toThrow();
  });
  it('非对象不报错', () => {
    expect(() => applySpecialIndexSequenceToSummaryTables_ACU('invalid' as any)).not.toThrow();
  });
  it('无 sheet_ 前缀的 key 被跳过', () => {
    const data = { mate: { type: 'chatSheets' } };
    expect(() => applySpecialIndexSequenceToSummaryTables_ACU(data)).not.toThrow();
  });
  it('非纪要表被跳过', () => {
    const data = { sheet_0: { name: '背包物品表', content: [['row_id']] } };
    expect(() => applySpecialIndexSequenceToSummaryTables_ACU(data)).not.toThrow();
  });
});
