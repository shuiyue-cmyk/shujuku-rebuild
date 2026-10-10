import { describe, expect, it } from 'vitest';

import {
  MAX_TABLE_FILL_RETRY_TURNS_ACU,
  withTableFillRetryHistory_ACU,
} from '../../../src/service/ai/prompt-builder/table-fill-retry';

const base = () => [
  { role: 'system', content: '主提示词' },
  { role: 'user', content: '表格与聊天' },
];

describe('填表纠错历史回灌', () => {
  it('没有纠错历史时原样返回', () => {
    const messages = base();
    expect(withTableFillRetryHistory_ACU(messages, [], { tools: false })).toBe(messages);
    expect(withTableFillRetryHistory_ACU(messages, undefined, { tools: false })).toBe(messages);
  });

  it('上次回复以 assistant 回灌，报错与修正要求以 system 追加在后', () => {
    const result = withTableFillRetryHistory_ACU(base(), [
      { response: '<tableEdit>INSERT INTO missing (v) VALUES (1);</tableEdit>', error: '无法识别的目标表「missing」' },
    ], { tools: false });

    expect(result.slice(0, 2)).toEqual(base());
    expect(result[2]).toEqual({ role: 'assistant', content: '<tableEdit>INSERT INTO missing (v) VALUES (1);</tableEdit>' });
    expect(result[3].role).toBe('system');
    expect(result[3].content).toContain('【填表纠错】');
    expect(result[3].content).toContain('无法识别的目标表「missing」');
    expect(result[3].content).toContain('<tableEdit>');
    expect(result[3].content).toContain('不编造');
    expect(result).toHaveLength(4);
  });

  it('上次回复只作参考：要求对照原任务重新判断，不照抄，避免把首轮内容固化', () => {
    const [, , , correction] = withTableFillRetryHistory_ACU(base(), [{ response: '坏回复', error: '缺标签' }], { tools: false });

    expect(correction.content).toContain('仅供参考');
    expect(correction.content).toContain('不要照抄');
    expect(correction.content).not.toContain('保留有效内容');
  });

  it('上次没有可读回复（空回）时只追加纠错说明', () => {
    const result = withTableFillRetryHistory_ACU(base(), [{ response: '', error: 'API响应格式不正确或内容为空。' }], { tools: false });

    expect(result).toHaveLength(3);
    expect(result[2].role).toBe('system');
    expect(result[2].content).toContain('API响应格式不正确或内容为空。');
  });

  it('原有 assistant 预填充保持在最后', () => {
    const messages = [...base(), { role: 'assistant', content: '<thinking>' }];
    const result = withTableFillRetryHistory_ACU(messages, [{ response: '坏回复', error: '缺标签' }], { tools: false });

    expect(result.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'system', 'assistant']);
    expect(result[2].content).toBe('坏回复');
    expect(result[4].content).toBe('<thinking>');
  });

  it('挂工具时要求重新调用 table_sql', () => {
    const withTools = withTableFillRetryHistory_ACU(base(), [{ response: '', error: '参数不是合法 JSON' }], { tools: true });
    const withoutTools = withTableFillRetryHistory_ACU(base(), [{ response: '', error: '参数不是合法 JSON' }], { tools: false });

    expect(withTools[2].content).toContain('table_sql');
    expect(withoutTools[2].content).not.toContain('table_sql');
  });

  it('只回灌最近几轮，避免多轮重试把请求越堆越长', () => {
    const history = Array.from({ length: MAX_TABLE_FILL_RETRY_TURNS_ACU + 2 }, (_, index) => ({
      response: `回复${index}`,
      error: `报错${index}`,
    }));
    const result = withTableFillRetryHistory_ACU(base(), history, { tools: false });
    const text = result.map(message => message.content).join('\n');

    expect(result).toHaveLength(2 + MAX_TABLE_FILL_RETRY_TURNS_ACU * 2);
    expect(text).not.toContain('回复0');
    expect(text).not.toContain('报错1');
    expect(text).toContain(`报错${history.length - 1}`);
  });

  it('不改写传入的消息数组', () => {
    const messages = base();
    const snapshot = JSON.parse(JSON.stringify(messages));
    withTableFillRetryHistory_ACU(messages, [{ response: 'x', error: 'y' }], { tools: false });
    expect(messages).toEqual(snapshot);
  });
});
