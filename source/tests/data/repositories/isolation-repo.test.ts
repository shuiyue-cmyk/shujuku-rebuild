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
  addDataIsolationHistory_ACU,
} from '../../../src/data/repositories/isolation-repo';

beforeEach(() => {
  vi.clearAllMocks();
  mockGlobalMeta.isolationCodeList = [];
  mockGlobalMeta.activeIsolationCode = '';
  mockReadProfileSettings.mockReturnValue(null);
  mockReadProfileTemplate.mockReturnValue(null);
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
});

// ensureProfileExists_ACU 已随隔离码切换死代码群删除（G11-02 关联清理），其专属用例一并移除。