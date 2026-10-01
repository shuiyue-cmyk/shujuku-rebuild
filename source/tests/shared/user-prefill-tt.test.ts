/**
 * TT 移植上游 ce867f86 的 user-prefill 切换批（shared 默认组部分）。
 *
 * 上游把「以 assistant 预填充收尾」的默认组尾段换成一条 user 消息（内容为伪 assistant
 * JSON 块的文本预填充）。本地按实际形状盘点：只切真正以 assistant 预填充收尾的组
 * （剧情推进 DEFAULT_PLOT_PROMPT_GROUP_ACU、向量关键词 keywordPromptGroup、
 * 去破限后的填表组 DEFAULT_CHAR_CARD_PROMPT_ACU）；
 * 时间召回与正文优化尾段是整句应答而非续写前缀，上游同样未切——这些组保持原样并用守卫测试锁死。
 */
import { describe, expect, it } from 'vitest';
import { USER_PREFILL_CONTENT_ACU } from '../../src/shared/user-prefill.js';
import {
  DEFAULT_CHAR_CARD_PROMPT_ACU,
  DEFAULT_CONTENT_OPTIMIZATION_PROMPT_GROUP_ACU,
  DEFAULT_PLOT_PROMPT_GROUP_ACU,
  DEFAULT_TIME_RECALL_PLOT_PRESET_ACU,
} from '../../src/shared/defaults-json.js';
import { defaultVectorMemoryConfig_ACU } from '../../src/shared/defaults';

describe('USER_PREFILL_CONTENT_ACU 公共构造器', () => {
  it('内容即上游 user-prefill 文本：两段伪 assistant JSON 块，role 字段是保留文本', () => {
    expect(USER_PREFILL_CONTENT_ACU).toContain('"role": "assistant"');
    expect(USER_PREFILL_CONTENT_ACU).toContain('<thinking>我已经完成了思考。');
    expect(USER_PREFILL_CONTENT_ACU).toContain('<thinking>让我开始我的任务。');
    // String.raw 语义：\n 保持为字面反斜杠+n，而不是真实换行。
    expect(USER_PREFILL_CONTENT_ACU).toContain('\\n</thinking>');
  });
});

describe('默认组尾段 assistant→user 切换（与上游对齐、按本地形状）', () => {
  it('剧情推进默认组尾段切为 user + USER_PREFILL', () => {
    const tail = DEFAULT_PLOT_PROMPT_GROUP_ACU[DEFAULT_PLOT_PROMPT_GROUP_ACU.length - 1];
    expect(tail.role).toBe('user');
    expect(tail.content).toBe(USER_PREFILL_CONTENT_ACU);
    expect(tail.deletable).toBe(true);
  });

  it('交火向量关键词组尾段切为 user + USER_PREFILL', () => {
    const tail = defaultVectorMemoryConfig_ACU.keywordPromptGroup[defaultVectorMemoryConfig_ACU.keywordPromptGroup.length - 1];
    expect(tail.role).toBe('user');
    expect(tail.content).toBe(USER_PREFILL_CONTENT_ACU);
    expect(tail.deletable).toBe(true);
  });

  it('填表组尾段切为 user + USER_PREFILL（去破限后与上游一致）', () => {
    const tail = DEFAULT_CHAR_CARD_PROMPT_ACU[DEFAULT_CHAR_CARD_PROMPT_ACU.length - 1];
    expect(tail.role).toBe('user');
    expect(tail.content).toBe(USER_PREFILL_CONTENT_ACU);
    expect(tail.deletable).toBe(true);
  });

  it('守卫：时间召回预设尾段是整句 assistant 应答（上游未切），保持 assistant', () => {
    const tail = DEFAULT_TIME_RECALL_PLOT_PRESET_ACU.promptGroup[DEFAULT_TIME_RECALL_PLOT_PRESET_ACU.promptGroup.length - 1];
    expect(tail.role).toBe('assistant');
    expect(tail.content).toBe('收到，天之音开始执行！');
  });

  it('守卫：正文优化组尾段是整句 assistant 应答（上游未切），保持 assistant', () => {
    const tail = DEFAULT_CONTENT_OPTIMIZATION_PROMPT_GROUP_ACU[DEFAULT_CONTENT_OPTIMIZATION_PROMPT_GROUP_ACU.length - 1];
    expect(tail.role).toBe('assistant');
  });
});
