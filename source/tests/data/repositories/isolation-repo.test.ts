/**
 * tests/data/repositories/isolation-repo.test.ts
 * 数据隔离管理 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGlobalMeta,
  mockSaveGlobalMeta,
  mockReadProfileSettings,
  mockWriteProfileSettings,
  mockReadProfileTemplate,
  mockWriteProfileTemplate,
  mockSanitizeSettings,
  mockLogWarn,
} = vi.hoisted(() => ({
  mockGlobalMeta: {
    version: 1,
    activeIsolationCode: '',
    isolationCodeList: [] as string[],
    migratedLegacySingleStore: false,
    zeroTkOccupyModeGlobal: false,
  },
  mockSaveGlobalMeta: vi.fn(() => true),
  mockReadProfileSettings: vi.fn(() => null),
  mockWriteProfileSettings: vi.fn(),
  mockReadProfileTemplate: vi.fn(() => null),
  mockWriteProfileTemplate: vi.fn(),
  mockSanitizeSettings: vi.fn((obj: any) => ({ ...obj })),
  mockLogWarn: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
}));

vi.mock('../../../src/shared/data-constants', () => ({
  normalizeIsolationCode_ACU: vi.fn((code: string) => String(code || '').trim()),
}));

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  globalMeta_ACU: mockGlobalMeta,
  saveGlobalMeta_ACU: mockSaveGlobalMeta,
  readProfileSettingsFromStorage_ACU: mockReadProfileSettings,
  writeProfileSettingsToStorage_ACU: mockWriteProfileSettings,
  readProfileTemplateFromStorage_ACU: mockReadProfileTemplate,
  writeProfileTemplateToStorage_ACU: mockWriteProfileTemplate,
  sanitizeSettingsForProfileSave_ACU: mockSanitizeSettings,
}));

vi.mock('../../../src/shared/defaults-json.js', () => ({
  TABLE_TEMPLATE_ACU: '{"sheet_0":{}}',
  DEFAULT_TABLE_TEMPLATE_ACU: '{"default":true}',
}));

import {
  MAX_DATA_ISOLATION_HISTORY,
  normalizeDataIsolationHistory_ACU,
  getDataIsolationHistory_ACU,
  addDataIsolationHistory_ACU,
  removeDataIsolationHistory_ACU,
  ensureProfileExists_ACU,
} from '../../../src/data/repositories/isolation-repo';

beforeEach(() => {
  vi.clearAllMocks();
  mockGlobalMeta.isolationCodeList = [];
  mockGlobalMeta.activeIsolationCode = '';
  mockReadProfileSettings.mockReturnValue(null);
  mockReadProfileTemplate.mockReturnValue(null);
});

// ═══ MAX_DATA_ISOLATION_HISTORY ═══
describe('MAX_DATA_ISOLATION_HISTORY', () => {
  it('是正整数', () => {
    expect(MAX_DATA_ISOLATION_HISTORY).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_DATA_ISOLATION_HISTORY)).toBe(true);
  });
});

// ═══ normalizeDataIsolationHistory_ACU ═══
describe('normalizeDataIsolationHistory_ACU', () => {
  it('空列表返回空数组', () => {
    const result = normalizeDataIsolationHistory_ACU([]);
    expect(result).toEqual([]);
  });

  it('去重', () => {
    const result = normalizeDataIsolationHistory_ACU(['a', 'b', 'a', 'c']);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('过滤非字符串和空字符串', () => {
    const result = normalizeDataIsolationHistory_ACU(['valid', '', '  ', 123 as any, null as any, 'ok']);
    expect(result).toEqual(['valid', 'ok']);
  });

  it('超过最大长度截断', () => {
    const longList = Array.from({ length: 30 }, (_, i) => `code_${i}`);
    const result = normalizeDataIsolationHistory_ACU(longList);
    expect(result.length).toBeLessThanOrEqual(MAX_DATA_ISOLATION_HISTORY);
  });

  it('不传参数时使用 globalMeta 的列表', () => {
    mockGlobalMeta.isolationCodeList = ['x', 'y'];
    const result = normalizeDataIsolationHistory_ACU();
    expect(result).toEqual(['x', 'y']);
  });
});

// ═══ getDataIsolationHistory_ACU ═══
describe('getDataIsolationHistory_ACU', () => {
  it('返回规范化后的列表', () => {
    mockGlobalMeta.isolationCodeList = ['a', 'b'];
    const result = getDataIsolationHistory_ACU();
    expect(result).toEqual(['a', 'b']);
  });
});

// ═══ addDataIsolationHistory_ACU ═══
describe('addDataIsolationHistory_ACU', () => {
  it('添加新代码到列表头部', () => {
    mockGlobalMeta.isolationCodeList = ['existing'];
    addDataIsolationHistory_ACU('new_code');
    expect(mockGlobalMeta.isolationCodeList[0]).toBe('new_code');
    expect(mockGlobalMeta.isolationCodeList).toContain('existing');
    expect(mockSaveGlobalMeta).toHaveBeenCalled();
  });

  it('已存在的代码移到头部', () => {
    mockGlobalMeta.isolationCodeList = ['a', 'b', 'c'];
    addDataIsolationHistory_ACU('b');
    expect(mockGlobalMeta.isolationCodeList[0]).toBe('b');
    // 不重复
    expect(mockGlobalMeta.isolationCodeList.filter((x: string) => x === 'b').length).toBe(1);
  });

  it('空字符串不添加', () => {
    addDataIsolationHistory_ACU('');
    expect(mockSaveGlobalMeta).not.toHaveBeenCalled();
  });

  it('非字符串不添加', () => {
    addDataIsolationHistory_ACU(123 as any);
    expect(mockSaveGlobalMeta).not.toHaveBeenCalled();
  });

  it('save=false 时不保存', () => {
    addDataIsolationHistory_ACU('code', { save: false });
    expect(mockSaveGlobalMeta).not.toHaveBeenCalled();
  });
});

// ═══ removeDataIsolationHistory_ACU ═══
describe('removeDataIsolationHistory_ACU', () => {
  it('移除指定代码', () => {
    mockGlobalMeta.isolationCodeList = ['a', 'b', 'c'];
    removeDataIsolationHistory_ACU('b');
    expect(mockGlobalMeta.isolationCodeList).toEqual(['a', 'c']);
    expect(mockSaveGlobalMeta).toHaveBeenCalled();
  });

  it('不存在的代码不影响列表', () => {
    mockGlobalMeta.isolationCodeList = ['a', 'b'];
    removeDataIsolationHistory_ACU('nonexistent');
    expect(mockGlobalMeta.isolationCodeList).toEqual(['a', 'b']);
  });

  it('save=false 时不保存', () => {
    mockGlobalMeta.isolationCodeList = ['a'];
    removeDataIsolationHistory_ACU('a', { save: false });
    expect(mockSaveGlobalMeta).not.toHaveBeenCalled();
  });
});

// ═══ ensureProfileExists_ACU ═══
describe('ensureProfileExists_ACU', () => {
  it('已有 settings 和 template 时不覆盖', () => {
    mockReadProfileSettings.mockReturnValue({ theme: 'dark' });
    mockReadProfileTemplate.mockReturnValue('{"sheet_0":{}}');
    ensureProfileExists_ACU('code_1');
    expect(mockWriteProfileSettings).not.toHaveBeenCalled();
    expect(mockWriteProfileTemplate).not.toHaveBeenCalled();
  });

  it('无 settings 时创建（seedFromCurrent=true）', () => {
    mockReadProfileSettings.mockReturnValue(null);
    mockReadProfileTemplate.mockReturnValue('existing_template');
    ensureProfileExists_ACU('code_1', { seedFromCurrent: true, settings: { theme: 'dark' } });
    expect(mockWriteProfileSettings).toHaveBeenCalled();
    expect(mockWriteProfileTemplate).not.toHaveBeenCalled();
  });

  it('无 template 时创建', () => {
    mockReadProfileSettings.mockReturnValue({ existing: true });
    mockReadProfileTemplate.mockReturnValue(null);
    ensureProfileExists_ACU('code_1');
    expect(mockWriteProfileSettings).not.toHaveBeenCalled();
    expect(mockWriteProfileTemplate).toHaveBeenCalled();
  });

  it('seedFromCurrent=false 时使用默认模板', () => {
    mockReadProfileSettings.mockReturnValue(null);
    mockReadProfileTemplate.mockReturnValue(null);
    ensureProfileExists_ACU('code_1', { seedFromCurrent: false });
    expect(mockWriteProfileSettings).toHaveBeenCalled();
    expect(mockWriteProfileTemplate).toHaveBeenCalledWith('code_1', '{"default":true}');
  });

  it('写入失败时不抛错', () => {
    mockReadProfileSettings.mockReturnValue(null);
    mockReadProfileTemplate.mockReturnValue(null);
    mockWriteProfileSettings.mockImplementationOnce(() => { throw new Error('写入失败'); });
    expect(() => ensureProfileExists_ACU('code_1')).not.toThrow();
    expect(mockLogWarn).toHaveBeenCalled();
  });
});