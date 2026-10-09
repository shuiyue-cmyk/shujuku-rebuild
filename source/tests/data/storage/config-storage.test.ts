/**
 * tests/data/storage/config-storage.test.ts
 * 统一配置存储门面 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetConfigStorage,
  mockSanitizeSettingsForProfileSave,
  mockGetProfileSettingsKey,
  mockLogError,
} = vi.hoisted(() => ({
  mockGetConfigStorage: vi.fn(),
  mockSanitizeSettingsForProfileSave: vi.fn((obj: any) => ({ ...obj })),
  mockGetProfileSettingsKey: vi.fn((code: string) => `profile_${code}`),
  mockLogError: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logError_ACU: mockLogError,
}));

vi.mock('../../../src/shared/data-constants', () => ({
  getProfileSettingsKey_ACU: mockGetProfileSettingsKey,
}));

vi.mock('../../../src/data/repositories/profile-repo', () => ({
  sanitizeSettingsForProfileSave_ACU: mockSanitizeSettingsForProfileSave,
}));

vi.mock('../../../src/data/storage/tavern-storage', () => ({
  getConfigStorage_ACU: mockGetConfigStorage,
}));

import { persistSettingsToStorage_ACU } from '../../../src/data/storage/config-storage';

let mockStore: { setItem: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  mockStore = { setItem: vi.fn() };
  mockGetConfigStorage.mockReturnValue(mockStore);
});

describe('persistSettingsToStorage_ACU', () => {

  it('存储抛错时记录错误日志并返回 false', () => {
    mockGetConfigStorage.mockImplementation(() => {
      throw new Error('storage error');
    });
    const persisted = persistSettingsToStorage_ACU({ key: 'value' }, 'code');

    expect(persisted).toBe(false);
    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to persist settings to storage:',
      expect.any(Error),
    );
  });

  it('底层存储明确返回 false 时向调用方传播失败', () => {
    mockStore.setItem.mockReturnValue(false);

    expect(persistSettingsToStorage_ACU({ key: 'value' }, 'code')).toBe(false);
  });

  it('setItem 抛错时记录错误日志并返回 false', () => {
    mockStore.setItem.mockImplementation(() => {
      throw new Error('write error');
    });
    const persisted = persistSettingsToStorage_ACU({ key: 'value' }, 'code');

    expect(persisted).toBe(false);
    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to persist settings to storage:',
      expect.any(Error),
    );
  });
});
