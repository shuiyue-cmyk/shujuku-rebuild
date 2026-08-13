/**
 * tests/integration/settings-migration.test.ts
 * I6 集成测试：设置加载与迁移
 * 验证旧版设置 → profile 迁移的兼容性
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStore, mockSettings } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    mockStore: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
      removeItem: vi.fn((key: string) => { store.delete(key); }),
      _isTavern: false,
      _clear: () => store.clear(),
      _store: store,
    },
    mockSettings: {} as any,
  };
});

vi.mock('../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (json: string, fallback: any) => { try { return JSON.parse(json); } catch { return fallback; } },
  safeJsonStringify_ACU: (obj: any, fallback: string) => { try { return JSON.stringify(obj); } catch { return fallback; } },
}));

vi.mock('../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  deepMerge_ACU: vi.fn((defaults: any, saved: any) => ({ ...defaults, ...saved })),
}));

vi.mock('../../src/shared/data-constants', () => ({
  STORAGE_KEY_ALL_SETTINGS_ACU: 'acu_all_settings',
  STORAGE_KEY_CUSTOM_TEMPLATE_ACU: 'acu_custom_template',
  STORAGE_KEY_GLOBAL_META_ACU: 'acu_global_meta',
  normalizeIsolationCode_ACU: vi.fn((code: string) => String(code || '').trim()),
  getProfileSettingsKey_ACU: vi.fn((code: string) => `acu_settings_${code}`),
  getProfileTemplateKey_ACU: vi.fn((code: string) => `acu_template_${code}`),
}));

vi.mock('../../src/data/storage/tavern-storage', () => ({
  getConfigStorage_ACU: () => mockStore,
  initTavernSettingsBridge_ACU: vi.fn().mockResolvedValue(false),
  ensureConfigIdbCacheLoaded_ACU: vi.fn().mockResolvedValue(undefined),
  configIdbCacheLoaded_ACU: true,
  migrateKeyToTavernStorageIfNeeded_ACU: vi.fn(() => false),
  pendingSettingsReloadFromIdb_ACU: false,
  _set_pendingSettingsReloadFromIdb_ACU: vi.fn(),
}));

vi.mock('../../src/shared/idb-import-temp', () => ({
  isIndexedDbAvailable_ACU: vi.fn(() => false),
}));

vi.mock('../../src/shared/defaults-json.js', () => ({
  TABLE_TEMPLATE_ACU: '{"sheet_0":{}}',
  DEFAULT_TABLE_TEMPLATE_ACU: '{"default":true}',
}));

import {
  globalMeta_ACU,
  loadGlobalMeta_ACU,
  saveGlobalMeta_ACU,
  readProfileSettingsFromStorage_ACU,
  writeProfileSettingsToStorage_ACU,
  readProfileTemplateFromStorage_ACU,
  writeProfileTemplateToStorage_ACU,
  sanitizeSettingsForProfileSave_ACU,
} from '../../src/data/repositories/profile-repo';

import {
  normalizeDataIsolationHistory_ACU,
  addDataIsolationHistory_ACU,
  ensureProfileExists_ACU,
} from '../../src/data/repositories/isolation-repo';

beforeEach(() => {
  vi.clearAllMocks();
  mockStore._clear();
  // 重置 globalMeta
  globalMeta_ACU.version = 1;
  globalMeta_ACU.activeIsolationCode = '';
  globalMeta_ACU.isolationCodeList = [];
  globalMeta_ACU.migratedLegacySingleStore = false;
});

describe('I6: 设置加载与迁移', () => {
  describe('旧版设置 → Profile 迁移', () => {
    it('旧版设置写入存储 → loadGlobalMeta → 读取正确', () => {
      const legacyMeta = {
        version: 1,
        activeIsolationCode: 'code_1',
        isolationCodeList: ['code_1', 'code_2'],
        migratedLegacySingleStore: true,
      };
      mockStore._store.set('acu_global_meta', JSON.stringify(legacyMeta));

      loadGlobalMeta_ACU();

      expect(globalMeta_ACU.activeIsolationCode).toBe('code_1');
      expect(globalMeta_ACU.isolationCodeList).toEqual(['code_1', 'code_2']);
    });

    it('Profile 设置写入 → 读取 → 数据一致', () => {
      const settings = { theme: 'dark', fontSize: 14, dataIsolationCode: 'code_1' };
      writeProfileSettingsToStorage_ACU('code_1', settings);

      const loaded = readProfileSettingsFromStorage_ACU('code_1');
      expect(loaded).not.toBeNull();
      expect(loaded.theme).toBe('dark');
      expect(loaded.fontSize).toBe(14);
    });

    it('Profile 模板写入 → 读取 → 数据一致', () => {
      writeProfileTemplateToStorage_ACU('code_1', '{"sheet_0":{"name":"自定义表"}}');

      const loaded = readProfileTemplateFromStorage_ACU('code_1');
      expect(loaded).toBe('{"sheet_0":{"name":"自定义表"}}');
    });

    it('sanitizeSettingsForProfileSave 清除隔离相关字段', () => {
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
  });

  describe('隔离历史管理', () => {
    it('添加 → 规范化 → 保存 → 重新加载 → 一致', () => {
      addDataIsolationHistory_ACU('code_1');
      addDataIsolationHistory_ACU('code_2');
      addDataIsolationHistory_ACU('code_1'); // 重复添加，应移到头部

      expect(globalMeta_ACU.isolationCodeList[0]).toBe('code_1');
      expect(globalMeta_ACU.isolationCodeList.filter((x: string) => x === 'code_1').length).toBe(1);

      // 保存
      saveGlobalMeta_ACU();

      // 重新加载
      loadGlobalMeta_ACU();
      expect(globalMeta_ACU.isolationCodeList).toContain('code_1');
      expect(globalMeta_ACU.isolationCodeList).toContain('code_2');
    });

    it('规范化去重和截断', () => {
      globalMeta_ACU.isolationCodeList = ['a', 'b', 'a', 'c', '', '  ', 'd'];
      const result = normalizeDataIsolationHistory_ACU();
      expect(result).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  describe('ensureProfileExists — Profile 创建', () => {
    it('无 Profile 时自动创建', () => {
      ensureProfileExists_ACU('new_code');

      const settings = readProfileSettingsFromStorage_ACU('new_code');
      expect(settings).not.toBeNull();
      expect(settings.dataIsolationCode).toBe('new_code');

      const template = readProfileTemplateFromStorage_ACU('new_code');
      expect(template).not.toBeNull();
    });

    it('已有 Profile 时不覆盖', () => {
      writeProfileSettingsToStorage_ACU('existing', { theme: 'light', dataIsolationCode: 'existing' });
      writeProfileTemplateToStorage_ACU('existing', '{"custom":true}');

      ensureProfileExists_ACU('existing');

      const settings = readProfileSettingsFromStorage_ACU('existing');
      expect(settings.theme).toBe('light'); // 未被覆盖
    });
  });

  describe('完整迁移链路', () => {
    it('旧版设置 → 创建 Profile → 添加历史 → 保存 → 重新加载 → 一致', () => {
      // 1. 模拟旧版设置
      const legacySettings = {
        theme: 'dark',
        dataIsolationCode: 'legacy_code',
        dataIsolationHistory: ['legacy_code', 'old_code'],
        dataIsolationEnabled: true,
      };

      // 2. 清洗并写入 Profile
      const sanitized = sanitizeSettingsForProfileSave_ACU(legacySettings);
      sanitized.dataIsolationCode = 'legacy_code';
      writeProfileSettingsToStorage_ACU('legacy_code', sanitized);

      // 3. 迁移隔离历史
      globalMeta_ACU.isolationCodeList = legacySettings.dataIsolationHistory;
      globalMeta_ACU.activeIsolationCode = 'legacy_code';
      normalizeDataIsolationHistory_ACU();
      globalMeta_ACU.migratedLegacySingleStore = true;
      saveGlobalMeta_ACU();

      // 4. 重新加载验证
      loadGlobalMeta_ACU();
      expect(globalMeta_ACU.activeIsolationCode).toBe('legacy_code');
      expect(globalMeta_ACU.isolationCodeList).toContain('legacy_code');
      expect(globalMeta_ACU.migratedLegacySingleStore).toBe(true);

      const profileSettings = readProfileSettingsFromStorage_ACU('legacy_code');
      expect(profileSettings.theme).toBe('dark');
      expect(profileSettings.dataIsolationHistory).toBeUndefined(); // 已清洗
    });
  });
});