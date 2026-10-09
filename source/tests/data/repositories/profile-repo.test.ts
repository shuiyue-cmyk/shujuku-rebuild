/**
 * tests/data/repositories/profile-repo.test.ts
 * Profile 与 GlobalMeta 管理 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockStore,
  mockLogWarn,
} = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    mockStore: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
      _clear: () => store.clear(),
      _store: store,
    },
    mockLogWarn: vi.fn(),
  };
});

vi.mock('../../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (json: string, fallback: any) => { try { return JSON.parse(json); } catch { return fallback; } },
  safeJsonStringify_ACU: (obj: any, fallback: string) => { try { return JSON.stringify(obj); } catch { return fallback; } },
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
}));

vi.mock('../../../src/shared/data-constants', () => ({
  STORAGE_KEY_GLOBAL_META_ACU: 'acu_global_meta',
  normalizeIsolationCode_ACU: vi.fn((code: string) => String(code || '').trim()),
  getProfileSettingsKey_ACU: vi.fn((code: string) => `acu_settings_${code}`),
  getProfileTemplateKey_ACU: vi.fn((code: string) => `acu_template_${code}`),
}));

vi.mock('../../../src/data/storage/tavern-storage', () => ({
  getConfigStorage_ACU: () => mockStore,
}));

vi.mock('../../../src/shared/defaults-json.js', () => ({
  get TABLE_TEMPLATE_ACU() { return '{"sheet_0":{}}'; },
}));

import {
  buildDefaultGlobalMeta_ACU,
  loadGlobalMeta_ACU,
  saveGlobalMeta_ACU,
  readProfileSettingsFromStorage_ACU,
  backupProfileTemplateRawBeforeDegradation_ACU,
  sanitizeSettingsForProfileSave_ACU,
} from '../../../src/data/repositories/profile-repo';

beforeEach(() => {
  vi.clearAllMocks();
  mockStore._clear();
});

// ═══ buildDefaultGlobalMeta_ACU ═══
describe('buildDefaultGlobalMeta_ACU', () => {

  it('每次调用返回新对象', () => {
    const a = buildDefaultGlobalMeta_ACU();
    const b = buildDefaultGlobalMeta_ACU();
    expect(a).not.toBe(b);
  });
});

// ═══ loadGlobalMeta_ACU ═══
describe('loadGlobalMeta_ACU', () => {

  it('存储有损坏数据时返回默认值', () => {
    mockStore._store.set('acu_global_meta', 'not valid json');
    const meta = loadGlobalMeta_ACU();
    expect(meta.version).toBe(1);
    expect(meta.activeIsolationCode).toBe('');
  });
});

// ═══ saveGlobalMeta_ACU ═══
describe('saveGlobalMeta_ACU', () => {

  it('存储抛错返回 false', () => {
    mockStore.setItem.mockImplementationOnce(() => { throw new Error('存储满了'); });
    const result = saveGlobalMeta_ACU();
    expect(result).toBe(false);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('存储门面明确返回 false 时不得谎报成功', () => {
    mockStore.setItem.mockImplementationOnce(() => false);
    expect(saveGlobalMeta_ACU()).toBe(false);
  });
});

// ═══ readProfileSettingsFromStorage_ACU ═══
describe('readProfileSettingsFromStorage_ACU', () => {

  it('无效 JSON 返回 null', () => {
    mockStore._store.set('acu_settings_code_1', 'bad json');
    expect(readProfileSettingsFromStorage_ACU('code_1')).toBeNull();
  });
});

// R3-08：模板读不出来、即将被默认模板覆盖前，原始串先备份到旁路键。
describe('backupProfileTemplateRawBeforeDegradation_ACU', () => {
  it('把原始模板串复制到 .bak 旁路键', () => {
    mockStore._store.set('acu_template_code_1', '{坏掉的模板');
    backupProfileTemplateRawBeforeDegradation_ACU('code_1', 'json_parse_failed');
    expect(mockStore._store.get('acu_template_code_1.bak')).toBe('{坏掉的模板');
  });

  it('没有原始串时不写备份', () => {
    backupProfileTemplateRawBeforeDegradation_ACU('code_1', 'json_parse_failed');
    expect(mockStore._store.has('acu_template_code_1.bak')).toBe(false);
  });
});

// ═══ sanitizeSettingsForProfileSave_ACU ═══
describe('sanitizeSettingsForProfileSave_ACU', () => {
  it('删除 dataIsolationHistory 和 dataIsolationEnabled', () => {
    const input = {
      theme: 'dark',
      dataIsolationHistory: ['code_1'],
      dataIsolationEnabled: true,
      otherSetting: 42,
    };
    const result = sanitizeSettingsForProfileSave_ACU(input);
    expect(result.theme).toBe('dark');
    expect(result.otherSetting).toBe(42);
    expect(result.dataIsolationHistory).toBeUndefined();
    expect(result.dataIsolationEnabled).toBeUndefined();
  });

  it('返回深拷贝', () => {
    const input = { nested: { value: 1 } };
    const result = sanitizeSettingsForProfileSave_ACU(input);
    expect(result.nested.value).toBe(1);
    result.nested.value = 2;
    expect(input.nested.value).toBe(1);
  });
});