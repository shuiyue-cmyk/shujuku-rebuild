/**
 * tests/service/ai/token-counter.test.ts
 * 宿主分词器计数与降级估算 单元测试
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countTextTokens_ACU } from '../../../src/service/ai/token-counter';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';


const { mockLogDebug } = vi.hoisted(() => ({ mockLogDebug: vi.fn() }));

vi.mock('../../../src/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/utils')>();
  return { ...actual, logDebug_ACU: mockLogDebug };
});

describe('countTextTokens_ACU', () => {
  beforeEach(() => { _set_SillyTavern_API_ACU(undefined); mockLogDebug.mockClear(); });

  it('宿主分词器可用时直接采用其结果并向上取整', async () => {
    _set_SillyTavern_API_ACU({ getTokenCountAsync: async () => 42.3 } as any);
    expect(await countTextTokens_ACU('任意文本')).toBe(43);
  });

  it('宿主分词器异常时降级为字符估算，不把异常抛给调用方', async () => {
    _set_SillyTavern_API_ACU({ getTokenCountAsync: async () => { throw new Error('tokenizer down'); } } as any);
    expect(await countTextTokens_ACU('12345678')).toBe(Math.ceil(8 / 1.5));
  });

  it('宿主返回非法值时按字符估算兜底', async () => {
    _set_SillyTavern_API_ACU({ getTokenCountAsync: async () => -1 } as any);
    expect(await countTextTokens_ACU('abcd')).toBe(3);
    _set_SillyTavern_API_ACU({ getTokenCountAsync: async () => Number.NaN } as any);
    expect(await countTextTokens_ACU('abcd')).toBe(3);
  });

  it('空文本恒为 0，且不会调用宿主分词器', async () => {
    let calls = 0;
    _set_SillyTavern_API_ACU({ getTokenCountAsync: async () => { calls += 1; return 99; } } as any);
    expect(await countTextTokens_ACU('')).toBe(0);
    expect(await countTextTokens_ACU(null as any)).toBe(0);
    expect(calls).toBe(0);
  });

  it('宿主分词器缺失时走字符估算分支', async () => {
    _set_SillyTavern_API_ACU(undefined);
    expect(await countTextTokens_ACU('a')).toBe(1);
    expect(await countTextTokens_ACU('中文条目正文')).toBe(4);
  });

  it('降级分支记 logDebug 漂移日志（TT 诊断用），宿主正常时不记', async () => {
    _set_SillyTavern_API_ACU(undefined);
    await countTextTokens_ACU('abc');
    expect(mockLogDebug).toHaveBeenCalledWith(expect.stringContaining('缺失'));
    mockLogDebug.mockClear();
    _set_SillyTavern_API_ACU({ getTokenCountAsync: async () => { throw new Error('tokenizer down'); } } as any);
    await countTextTokens_ACU('abc');
    expect(mockLogDebug).toHaveBeenCalledWith(expect.stringContaining('异常'), expect.any(Error));
    mockLogDebug.mockClear();
    _set_SillyTavern_API_ACU({ getTokenCountAsync: async () => 10 } as any);
    await countTextTokens_ACU('abc');
    expect(mockLogDebug).not.toHaveBeenCalled();
  });
});
