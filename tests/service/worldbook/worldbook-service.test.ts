/**
 * tests/service/worldbook/worldbook-service.test.ts
 * 世界书操作服务 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetLorebookEntries, mockSetLorebookEntries, mockCreateLorebookEntries, mockDeleteLorebookEntries, mockIsAvailable } = vi.hoisted(() => ({
  mockGetLorebookEntries: vi.fn(),
  mockSetLorebookEntries: vi.fn(),
  mockCreateLorebookEntries: vi.fn(),
  mockDeleteLorebookEntries: vi.fn(),
  mockIsAvailable: vi.fn(() => true),
}));

vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({
  isWorldbookApiAvailable_ACU: mockIsAvailable,
  getLorebookEntries_ACU: mockGetLorebookEntries,
  setLorebookEntries_ACU: mockSetLorebookEntries,
  createLorebookEntries_ACU: mockCreateLorebookEntries,
  deleteLorebookEntries_ACU: mockDeleteLorebookEntries,
  listLorebooks_ACU: vi.fn(),
  getWorldBooks_ACU: vi.fn(),
  getCurrentCharPrimaryLorebook_ACU: vi.fn(),
  getCharLorebooks_ACU: vi.fn(),
}));

vi.mock('../../../src/shared/constants', () => ({
  getImportJsonStorageComment_ACU: vi.fn((suffix: string) => `ACU-ImportJson${suffix}`),
}));

vi.mock('../../../src/service/worldbook/injection-engine-order', () => ({
  allocOrder_ACU: vi.fn(() => 10001),
  buildUsedOrderSet_ACU: vi.fn(() => new Set<number>()),
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

import {
  loadImportedJsonDataFromLorebook_ACU,
  saveImportedJsonDataToLorebook_ACU,
  deleteImportedJsonDataFromLorebook_ACU,
} from '../../../src/service/worldbook/worldbook-service';

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAvailable.mockReturnValue(true);
});

describe('loadImportedJsonDataFromLorebook_ACU', () => {
  it('找到条目时返回解析后的 JSON', async () => {
    const jsonData = { tables: { sheet_0: { name: '测试表' } } };
    mockGetLorebookEntries.mockResolvedValue([
      { comment: 'ACU-ImportJson-Selected', content: JSON.stringify(jsonData) },
    ]);
    const result = await loadImportedJsonDataFromLorebook_ACU('lorebook1');
    expect(result).toEqual(jsonData);
  });

  it('未找到条目时返回 null', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { comment: '其他条目', content: '{}' },
    ]);
    const result = await loadImportedJsonDataFromLorebook_ACU('lorebook1');
    expect(result).toBeNull();
  });

  it('JSON 解析失败返回 null', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { comment: 'ACU-ImportJson-Selected', content: '不是JSON' },
    ]);
    const result = await loadImportedJsonDataFromLorebook_ACU('lorebook1');
    expect(result).toBeNull();
  });

  it('API 不可用返回 null', async () => {
    mockIsAvailable.mockReturnValue(false);
    const result = await loadImportedJsonDataFromLorebook_ACU('lorebook1');
    expect(result).toBeNull();
  });

  it('空 lorebook 名称返回 null', async () => {
    const result = await loadImportedJsonDataFromLorebook_ACU('');
    expect(result).toBeNull();
  });

  it('自定义 modeSuffix 使用对应 comment', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { comment: 'ACU-ImportJson-Custom', content: '{"ok":true}' },
    ]);
    const result = await loadImportedJsonDataFromLorebook_ACU('lorebook1', '-Custom');
    expect(result).toEqual({ ok: true });
  });
});

describe('saveImportedJsonDataToLorebook_ACU', () => {
  it('已有条目时更新', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 42, comment: 'ACU-ImportJson-Selected', content: '{}', order: 100 },
    ]);
    const result = await saveImportedJsonDataToLorebook_ACU('lorebook1', { data: 1 });
    expect(result).toBe(true);
    expect(mockSetLorebookEntries).toHaveBeenCalledWith('lorebook1', [
      expect.objectContaining({ uid: 42, order: 100 }),
    ]);
  });

  it('无已有条目时创建', async () => {
    mockGetLorebookEntries.mockResolvedValue([]);
    const result = await saveImportedJsonDataToLorebook_ACU('lorebook1', { data: 1 });
    expect(result).toBe(true);
    expect(mockCreateLorebookEntries).toHaveBeenCalledWith('lorebook1', [
      expect.objectContaining({ comment: 'ACU-ImportJson-Selected' }),
    ]);
  });

  it('API 不可用返回 false', async () => {
    mockIsAvailable.mockReturnValue(false);
    const result = await saveImportedJsonDataToLorebook_ACU('lorebook1', { data: 1 });
    expect(result).toBe(false);
  });

  it('空 lorebook 名称返回 false', async () => {
    const result = await saveImportedJsonDataToLorebook_ACU('', { data: 1 });
    expect(result).toBe(false);
  });

  it('null jsonData 返回 false', async () => {
    const result = await saveImportedJsonDataToLorebook_ACU('lorebook1', null);
    expect(result).toBe(false);
  });
});

describe('deleteImportedJsonDataFromLorebook_ACU', () => {
  it('找到条目时删除并返回 true', async () => {
    mockGetLorebookEntries.mockResolvedValue([
      { uid: 42, comment: 'ACU-ImportJson-Selected' },
    ]);
    const result = await deleteImportedJsonDataFromLorebook_ACU('lorebook1');
    expect(result).toBe(true);
    expect(mockDeleteLorebookEntries).toHaveBeenCalledWith('lorebook1', [42]);
  });

  it('未找到条目返回 false', async () => {
    mockGetLorebookEntries.mockResolvedValue([]);
    const result = await deleteImportedJsonDataFromLorebook_ACU('lorebook1');
    expect(result).toBe(false);
  });

  it('API 不可用返回 false', async () => {
    mockIsAvailable.mockReturnValue(false);
    const result = await deleteImportedJsonDataFromLorebook_ACU('lorebook1');
    expect(result).toBe(false);
  });

  it('空 lorebook 名称返回 false', async () => {
    const result = await deleteImportedJsonDataFromLorebook_ACU('');
    expect(result).toBe(false);
  });
});
