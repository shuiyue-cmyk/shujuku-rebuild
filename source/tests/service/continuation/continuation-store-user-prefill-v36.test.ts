/**
 * TT 移植上游 ce867f86+255dfd62 的续写迁移链本地形状：V35→V36（Agent 尾段 user 预填充、
 * 谱系定向替换、不强刷）与 V36→V37（outlinePrompt 追加 user 预填充尾段，仅未改写的
 * 默认收尾段命中）；校验链白名单收新档位；链幂等。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V35_ACU,
  CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V36_ACU,
  CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V38_ACU,
  buildDefaultContinuationOutlinePrompt_ACU,
  buildDefaultContinuationSettings_ACU,
} from '../../../src/service/continuation/defaults';
import {
  buildV35ContinuationAgentPrompts_ACU,
  buildV36ContinuationAgentPrompts_ACU,
  buildV37ContinuationAgentPrompts_ACU,
} from '../../../src/service/continuation/agent/agent-defaults';
import { FirstFloorContinuationStore_ACU } from '../../../src/service/continuation/continuation-store';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';
import { USER_PREFILL_CONTENT_ACU } from '../../../src/shared/user-prefill.js';

function buildV35ShapedEnvelope_ACU(): any {
  const settings = buildDefaultContinuationSettings_ACU();
  return {
    schemaVersion: 1,
    settings: {
      ...settings,
      // V36 之前的默认收尾恰是 V31 上下文注入段：去掉当前默认的 user 预填充尾段即旧形状。
      outlinePrompt: settings.outlinePrompt.slice(0, -1),
      agentPrompts: buildV35ContinuationAgentPrompts_ACU(),
      promptForceDefaultVersion: CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V35_ACU,
    },
    activeTask: null,
  };
}

function seed_ACU(envelope: any) {
  _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: envelope }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
}

describe('续写迁移链 V35→V36→V37→V38-agent（user-prefill 切换批＋进度校准批）', () => {
  beforeEach(() => {
    _set_SillyTavern_API_ACU(undefined);
  });

  it('V35 默认信封读入后逐段到达 V37 默认组与带预填充的 outlinePrompt，标记推进到 V38', async () => {
    seed_ACU(buildV35ShapedEnvelope_ACU());
    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V38_ACU);
    expect(loaded.settings.agentPrompts).toEqual(buildV37ContinuationAgentPrompts_ACU());
    expect(loaded.settings.agentPrompts.main.some(segment => segment.content.includes('action = adjust_progress'))).toBe(true);
    expect(loaded.settings.outlinePrompt[loaded.settings.outlinePrompt.length - 1])
      .toMatchObject({ role: 'user', content: USER_PREFILL_CONTENT_ACU });
  });

  it('用户定制段不被强刷：改写过的尾段与非尾段原样保留，仅命中谱系的默认段被替换', async () => {
    const envelope = buildV35ShapedEnvelope_ACU();
    const customTail = { role: 'assistant', content: '用户自己写的尾段预填充', enabled: true, deletable: true };
    const customProtocol = { role: 'user', content: '【文本协议规范】用户改写版协议段', enabled: true, deletable: false, pinned: true };
    envelope.settings.agentPrompts.main = [
      ...envelope.settings.agentPrompts.main.slice(0, -1).map((segment, index) => index === 0 ? customProtocol : segment),
      customTail,
    ];
    seed_ACU(envelope);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;
    const v36 = buildV36ContinuationAgentPrompts_ACU();
    expect(loaded.settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V38_ACU);
    expect(loaded.settings.agentPrompts.main[mainIndex(loaded, customTail)]).toEqual(customTail);
    expect(loaded.settings.agentPrompts.main.some(segment => segment.content === customProtocol.content)).toBe(true);
    // 未改写的其余组（如 beatPlanner）按谱系命中被切换到 V36 形态。
    expect(loaded.settings.agentPrompts.beatPlanner[loaded.settings.agentPrompts.beatPlanner.length - 1])
      .toMatchObject({ role: 'user', content: USER_PREFILL_CONTENT_ACU });
    expect(loaded.settings.agentPrompts.beatPlanner.find(segment => segment.role === 'system')!.content)
      .toBe(v36.beatPlanner.find(segment => segment.role === 'system')!.content);
  });

  it('迁移幂等：迁移后的信封再读一遍不再变化', async () => {
    seed_ACU(buildV35ShapedEnvelope_ACU());
    const store = new FirstFloorContinuationStore_ACU();
    const first = store.read()!;
    seed_ACU({ schemaVersion: 1, settings: first.settings, activeTask: null });
    const second = store.read()!;
    expect(second.settings).toEqual(first.settings);
  });

  it('V36 档位信封补 outlinePrompt 预填充尾段，agentPrompts 按谱系到 V37（移植上游 e35f758d）', async () => {
    const envelope = buildV35ShapedEnvelope_ACU();
    envelope.settings.agentPrompts = buildV36ContinuationAgentPrompts_ACU();
    envelope.settings.promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V36_ACU;
    seed_ACU(envelope);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;
    expect(loaded.settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V38_ACU);
    expect(loaded.settings.agentPrompts).toEqual(buildV37ContinuationAgentPrompts_ACU());
    expect(loaded.settings.outlinePrompt).toEqual(buildDefaultContinuationOutlinePrompt_ACU());
  });

  it('V36→V37 对自定义收尾的 outlinePrompt 不强刷：非默认尾段原样保留', async () => {
    const envelope = buildV35ShapedEnvelope_ACU();
    envelope.settings.agentPrompts = buildV36ContinuationAgentPrompts_ACU();
    envelope.settings.promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V36_ACU;
    envelope.settings.outlinePrompt = [{ role: 'user', content: '用户定制的收尾段', enabled: true, deletable: true }];
    seed_ACU(envelope);

    const loaded = new FirstFloorContinuationStore_ACU().read()!;
    expect(loaded.settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V38_ACU);
    expect(loaded.settings.outlinePrompt).toEqual([{ role: 'user', content: '用户定制的收尾段', enabled: true, deletable: true }]);
  });

  it('新档位 V36/V37 在白名单内：未知标记仍整体刷新，已知标记保留用户内容', async () => {
    const custom = { role: 'user', content: '完全自定义的主组', enabled: true, deletable: false };
    const goodEnvelope = buildV35ShapedEnvelope_ACU();
    goodEnvelope.settings.agentPrompts = { ...buildV36ContinuationAgentPrompts_ACU(), main: [custom] };
    goodEnvelope.settings.outlinePrompt = [custom];
    goodEnvelope.settings.promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V38_ACU;
    seed_ACU(goodEnvelope);
    const kept = new FirstFloorContinuationStore_ACU().read()!;
    expect(kept.settings.agentPrompts.main).toEqual([custom]);
    expect(kept.settings.outlinePrompt).toEqual([custom]);

    const unknownEnvelope = buildV35ShapedEnvelope_ACU();
    unknownEnvelope.settings.agentPrompts = { ...buildV35ContinuationAgentPrompts_ACU(), main: [custom] };
    unknownEnvelope.settings.outlinePrompt = [custom];
    unknownEnvelope.settings.promptForceDefaultVersion = 'spv0.0-unknown-marker';
    seed_ACU(unknownEnvelope);
    const reset = new FirstFloorContinuationStore_ACU().read()!;
    expect(reset.settings.agentPrompts).toEqual(buildV37ContinuationAgentPrompts_ACU());
    expect(reset.settings.outlinePrompt).toEqual(buildDefaultContinuationOutlinePrompt_ACU());
    expect(reset.settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V38_ACU);
  });
});

function mainIndex(envelope: { settings: { agentPrompts: { main: Array<{ content: string }> } } }, segment: { content: string }): number {
  return envelope.settings.agentPrompts.main.findIndex(item => item.content === segment.content);
}
