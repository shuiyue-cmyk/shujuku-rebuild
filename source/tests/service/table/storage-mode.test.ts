/**
 * tests/service/table/storage-mode.test.ts
 * 存储模式工具函数单元测试
 *
 * 原生存储模式已移除，存储模式恒为 SQLite。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock state-manager
let mockSettings: any = {};
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get settings_ACU() { return mockSettings; },
}));

import {
  getCurrentStorageMode,
  isSqliteMode,
} from '../../../src/service/table/storage-mode';

describe('storage-mode', () => {
  beforeEach(() => {
    mockSettings = {};
  });

  // ═══════════════════════════════════════════════════════════════
  // getCurrentStorageMode
  // ═══════════════════════════════════════════════════════════════
  describe('getCurrentStorageMode', () => {
    it('恒返回 "sqlite"（原生模式已移除）', () => {
      expect(getCurrentStorageMode()).toBe('sqlite');
    });

    it('settings 标记为 native 时仍返回 "sqlite"', () => {
      mockSettings = { storageMode: 'native' };
      expect(getCurrentStorageMode()).toBe('sqlite');
    });

    it('settings 未设置时返回 "sqlite"', () => {
      mockSettings = {};
      expect(getCurrentStorageMode()).toBe('sqlite');
    });

    it('settings_ACU 为 null 时返回 "sqlite"', () => {
      mockSettings = null;
      expect(getCurrentStorageMode()).toBe('sqlite');
    });

    it('settings_ACU 为 undefined 时返回 "sqlite"', () => {
      mockSettings = undefined;
      expect(getCurrentStorageMode()).toBe('sqlite');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // isSqliteMode
  // ═══════════════════════════════════════════════════════════════
  describe('isSqliteMode', () => {
    it('恒返回 true', () => {
      expect(isSqliteMode()).toBe(true);
    });

    it('settings 标记为 native 时仍返回 true', () => {
      mockSettings = { storageMode: 'native' };
      expect(isSqliteMode()).toBe(true);
    });

    it('settings 未设置时返回 true', () => {
      mockSettings = {};
      expect(isSqliteMode()).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // isNativeMode
  // ═══════════════════════════════════════════════════════════════
  

    it('settings 标记为 native 时仍返回 false', () => {
      mockSettings = { storageMode: 'native' };
      expect(isNativeMode()).toBe(false);
    });

    it('settings 未设置时返回 false', () => {
      mockSettings = {};
      expect(isNativeMode()).toBe(false);
    });
  });
});
