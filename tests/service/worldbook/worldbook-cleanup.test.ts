/**
 * tests/service/worldbook/worldbook-cleanup.test.ts
 * 世界书条目清理 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetEntries, mockDeleteEntries, mockIsAvailable, mockGetTargetLorebook, mockGetIsoPrefix } = vi.hoisted(() => ({
  mockGetEntries: vi.fn(),
  mockDeleteEntries: vi.fn(),
  mockIsAvailable: vi.fn(() => true),
  mockGetTargetLorebook: vi.fn(),
  mockGetIsoPrefix: vi.fn(() => ''),
}));

vi.mock('../../../src/service/worldbook/worldbook-service', () => ({
  getLorebookEntries_ACU: mockGetEntries,
  deleteLorebookEntries_ACU: mockDeleteEntries,
  isWorldbookApiAvailable_ACU: mockIsAvailable,
}));

vi.mock('../../../src/service/worldbook/injection-engine', () => ({
  getInjectionTargetLorebook_ACU: mockGetTargetLorebook,
  getIsolationPrefix_ACU: mockGetIsoPrefix,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

import { cleanupWorldbookEntriesAfterDataDeletion_ACU } from '../../../src/service/worldbook/worldbook-cleanup';

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAvailable.mockReturnValue(true);
  mockGetIsoPrefix.mockReturnValue('');
});

describe('cleanupWorldbookEntriesAfterDataDeletion_ACU', () => {
  it('删除 Wrapper + PersonsHeader + Memory 条目', async () => {
    mockGetTargetLorebook.mockResolvedValue('primary-lorebook');
    mockGetEntries.mockResolvedValue([
      { uid: 1, comment: 'TavernDB-ACU-WrapperStart' },
      { uid: 2, comment: 'TavernDB-ACU-WrapperEnd' },
      { uid: 3, comment: 'TavernDB-ACU-PersonsHeader' },
      { uid: 4, comment: 'TavernDB-ACU-MemoryStart' },
      { uid: 5, comment: 'TavernDB-ACU-MemoryEnd' },
      { uid: 6, comment: '其他条目' },
    ]);
    const count = await cleanupWorldbookEntriesAfterDataDeletion_ACU();
    expect(count).toBe(5);
    expect(mockDeleteEntries).toHaveBeenCalledTimes(2);
    expect(mockDeleteEntries).toHaveBeenNthCalledWith(1, 'primary-lorebook', [1, 2]);
    expect(mockDeleteEntries).toHaveBeenNthCalledWith(2, 'primary-lorebook', [3, 4, 5]);
  });

  it('无匹配条目时返回 0', async () => {
    mockGetTargetLorebook.mockResolvedValue('primary-lorebook');
    mockGetEntries.mockResolvedValue([
      { uid: 1, comment: '无关条目' },
    ]);
    const count = await cleanupWorldbookEntriesAfterDataDeletion_ACU();
    expect(count).toBe(0);
    expect(mockDeleteEntries).not.toHaveBeenCalled();
  });

  it('无 lorebook 时返回 0', async () => {
    mockGetTargetLorebook.mockResolvedValue(null);
    const count = await cleanupWorldbookEntriesAfterDataDeletion_ACU();
    expect(count).toBe(0);
  });

  it('API 不可用时返回 0', async () => {
    mockIsAvailable.mockReturnValue(false);
    mockGetTargetLorebook.mockResolvedValue('primary-lorebook');
    const count = await cleanupWorldbookEntriesAfterDataDeletion_ACU();
    expect(count).toBe(0);
  });

  it('带隔离前缀时匹配带前缀的条目', async () => {
    mockGetIsoPrefix.mockReturnValue('iso_');
    mockGetTargetLorebook.mockResolvedValue('primary-lorebook');
    mockGetEntries.mockResolvedValue([
      { uid: 1, comment: 'iso_TavernDB-ACU-WrapperStart' },
      { uid: 2, comment: 'TavernDB-ACU-WrapperStart' }, // 不匹配（无前缀）
    ]);
    const count = await cleanupWorldbookEntriesAfterDataDeletion_ACU();
    expect(count).toBe(1);
  });

  it('getLorebookEntries 抛错时不中断，返回部分结果', async () => {
    mockGetTargetLorebook.mockResolvedValue('primary-lorebook');
    // 第一次调用（Wrapper）成功，第二次调用（PersonsHeader）抛错
    let callCount = 0;
    mockGetEntries.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return [{ uid: 1, comment: 'TavernDB-ACU-WrapperStart' }];
      }
      throw new Error('网络错误');
    });
    const count = await cleanupWorldbookEntriesAfterDataDeletion_ACU();
    // Wrapper 部分成功删除 1 个，PersonsHeader 部分失败
    expect(count).toBe(1);
  });

  it('不删除外部导入的 Wrapper、PersonsHeader、Memory 条目', async () => {
    mockGetTargetLorebook.mockResolvedValue('primary-lorebook');
    mockGetEntries.mockResolvedValue([
      { uid: 1, comment: '外部导入-TavernDB-ACU-WrapperStart' },
      { uid: 2, comment: '外部导入-TavernDB-ACU-WrapperEnd' },
      { uid: 3, comment: '外部导入-TavernDB-ACU-PersonsHeader' },
      { uid: 4, comment: '外部导入-TavernDB-ACU-MemoryStart' },
      { uid: 5, comment: '外部导入-TavernDB-ACU-MemoryEnd' },
    ]);
    const count = await cleanupWorldbookEntriesAfterDataDeletion_ACU();
    expect(count).toBe(0);
    expect(mockDeleteEntries).not.toHaveBeenCalled();
  });

  it('隔离前缀下只删除当前隔离的普通条目，不删除外部导入条目', async () => {
    mockGetIsoPrefix.mockReturnValue('ACU-[test]-');
    mockGetTargetLorebook.mockResolvedValue('primary-lorebook');
    mockGetEntries.mockResolvedValue([
      { uid: 1, comment: 'ACU-[test]-TavernDB-ACU-WrapperStart' },
      { uid: 2, comment: 'ACU-[test]-TavernDB-ACU-WrapperEnd' },
      { uid: 3, comment: 'ACU-[test]-外部导入-TavernDB-ACU-WrapperStart' },
      { uid: 4, comment: '外部导入-TavernDB-ACU-WrapperStart' },
      { uid: 5, comment: 'ACU-[test]-TavernDB-ACU-PersonsHeader' },
      { uid: 6, comment: 'ACU-[test]-外部导入-TavernDB-ACU-MemoryStart' },
      { uid: 7, comment: 'ACU-[other]-TavernDB-ACU-MemoryEnd' },
    ]);
    const count = await cleanupWorldbookEntriesAfterDataDeletion_ACU();
    expect(count).toBe(3);
    expect(mockDeleteEntries).toHaveBeenCalledTimes(2);
    expect(mockDeleteEntries).toHaveBeenNthCalledWith(1, 'primary-lorebook', [1, 2]);
    expect(mockDeleteEntries).toHaveBeenNthCalledWith(2, 'primary-lorebook', [5]);
  });
});
