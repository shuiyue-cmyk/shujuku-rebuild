import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getNames: vi.fn(),
  getPrimary: vi.fn(),
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({ getWorldbookNames_ACU: h.getNames }));
vi.mock('../../../src/service/worldbook/worldbook-service', () => ({ getCurrentCharPrimaryLorebook_ACU: h.getPrimary }));
vi.mock('../../../src/shared/utils', () => ({ logError_ACU: vi.fn() }));

import { useWorldbookSelector } from '../../../src/presentation-v2/composables/useWorldbookSelector';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getNames.mockResolvedValue(['old-book', 'new-book']);
});

describe('useWorldbookSelector', () => {
  it('正常刷新：列表与角色主世界书发布，状态 success', async () => {
    h.getPrimary.mockResolvedValue('new-book');
    const selector = useWorldbookSelector();
    await selector.refresh();
    expect(selector.names.value).toEqual(['old-book', 'new-book']);
    expect(selector.charPrimary.value).toBe('new-book');
    expect(selector.status.value).toBe('success');
  });

  it('列表读取失败进入 error 状态，不伪装成空列表', async () => {
    h.getNames.mockRejectedValue(new Error('列表读取失败'));
    h.getPrimary.mockResolvedValue(null);
    const selector = useWorldbookSelector();
    await selector.refresh();
    expect(selector.status.value).toBe('error');
    expect(selector.error.value).toBe('列表读取失败');
  });

  it('旧聊天较慢的刷新后到，不覆盖新聊天的角色主世界书（上游 #45）', async () => {
    const oldPrimary = deferred<string | null>();
    h.getPrimary.mockReturnValueOnce(oldPrimary.promise).mockResolvedValueOnce('new-book');
    const selector = useWorldbookSelector();

    const first = selector.refresh();
    await selector.refresh();
    oldPrimary.resolve('old-book');
    await first;

    expect(selector.charPrimary.value).toBe('new-book');
    expect(selector.status.value).toBe('success');
  });

  it('旧刷新后到且失败，不把最新的成功状态改成 error', async () => {
    const oldNames = deferred<string[]>();
    h.getNames.mockReturnValueOnce(oldNames.promise).mockResolvedValueOnce(['new-book']);
    h.getPrimary.mockResolvedValue('new-book');
    const selector = useWorldbookSelector();

    const first = selector.refresh();
    await selector.refresh();
    oldNames.reject(new Error('旧请求失败'));
    await first;

    expect(selector.status.value).toBe('success');
    expect(selector.error.value).toBe('');
    expect(selector.names.value).toEqual(['new-book']);
  });

  it('新刷新进行中时，先返回的旧结果不发布、不提前结束 loading', async () => {
    const newPrimary = deferred<string | null>();
    h.getPrimary.mockResolvedValueOnce('old-book').mockReturnValueOnce(newPrimary.promise);
    const selector = useWorldbookSelector();

    const first = selector.refresh();
    const second = selector.refresh();
    await first;
    expect(selector.charPrimary.value).toBeNull();
    expect(selector.status.value).toBe('loading');

    newPrimary.resolve('new-book');
    await second;
    expect(selector.charPrimary.value).toBe('new-book');
  });
});
