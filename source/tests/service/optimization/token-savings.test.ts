import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callAIWithResolvedPreset_ACU } from '../../../src/service/ai/api-call';
import {
  getWorldbookCompressionBlock_ACU,
  previewTokenSavingsItem_ACU,
  type resolveTokenSavingsPreset_ACU,
} from '../../../src/service/optimization/token-savings';

vi.mock('../../../src/service/ai/api-call', () => ({ callAIWithResolvedPreset_ACU: vi.fn() }));
vi.mock('../../../src/service/ai/token-counter', () => ({
  measureTextTokens_ACU: vi.fn(async (text: string) => ({ count: text.length, estimated: false })),
  estimateTextTokens_ACU: vi.fn((text: string) => text.length),
}));

const call = vi.mocked(callAIWithResolvedPreset_ACU);
const preset = { presetName: 'test' } as ReturnType<typeof resolveTokenSavingsPreset_ACU>;
const item = { id: '42', label: 'AM0042', original: '星汐在晚上 9 点告诉夜莺，先等在外面，不可以自行进入。' };

function preview(signal = new AbortController().signal) {
  return previewTokenSavingsItem_ACU(item, 'chronicle', preset, signal);
}

function reply(text: string): string {
  return JSON.stringify({ text });
}

beforeEach(() => call.mockReset());

describe('Token 节省候选', () => {
  it('压缩与复核是独立请求，复核只接收原文和候选作为数据', async () => {
    const text = '晚9点星汐告夜莺：在外等，禁自行进入。';
    call.mockResolvedValueOnce(reply(text)).mockResolvedValueOnce('{"equivalent":true}');
    const result = await preview();
    expect(result.candidate).toEqual({ text, before: item.original.length, after: text.length, estimated: false });
    expect(call).toHaveBeenCalledTimes(2);
    expect(JSON.parse(call.mock.calls[0][0][1].content)).toEqual({ original: item.original });
    expect(JSON.parse(call.mock.calls[1][0][1].content)).toEqual({ original: item.original, candidate: text });
  });

  it('数值变化不送审，且复核拒绝或异常格式时不输出可替换结果', async () => {
    call.mockResolvedValueOnce(reply('晚8点星汐让夜莺在外等。'))
      .mockResolvedValueOnce(reply('晚9点星汐让夜莺在外等。'))
      .mockResolvedValueOnce('{"equivalent":"true"}');
    expect(await preview()).toMatchObject({ skipped: '语义复核未通过' });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('激进候选少了否定时改用保守候选，并在停止后拒绝继续请求', async () => {
    const conservative = '晚上 9 点，星汐让夜莺在外等，禁止自行进入。';
    call.mockResolvedValueOnce(reply('9点夜莺等。')).mockResolvedValueOnce('{"equivalent":false}')
      .mockResolvedValueOnce(reply(conservative)).mockResolvedValueOnce('{"equivalent":true}');
    expect((await preview()).candidate?.text).toBe(conservative);
    const controller = new AbortController();
    controller.abort();
    await expect(preview(controller.signal)).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(4);
  });

  it('为世界书样例中的模版、变量初始化与协议标记禁用压缩', () => {
    expect(getWorldbookCompressionBlock_ACU('阶段指导', '<%_ if (x) { _%>分支')).toBeTruthy();
    expect(getWorldbookCompressionBlock_ACU('[InitVar]请勿打开', '善念: 200')).toBeTruthy();
    expect(getWorldbookCompressionBlock_ACU('变量列表', '{{format_message_variable::stat_data}}')).toBeTruthy();
    expect(getWorldbookCompressionBlock_ACU('输出格式', '<JSONPatch>[]</JSONPatch>')).toBeTruthy();
    expect(getWorldbookCompressionBlock_ACU('背景故事', '背景故事: |\n  <user>刚来到都市。')).toBeUndefined();
  });
});
