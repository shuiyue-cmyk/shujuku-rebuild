/**
 * V38→V39：跟进上游问答版默认提示词。只升级整组与 V38 冻结默认逐段相同的提示词，
 * 用户改过（正文或启用状态）的整组原样保留；reviewer 与 requirementsMaintainer 不变。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V36_ACU,
  CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V38_ACU,
  CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V39_ACU,
  buildDefaultContinuationOutlinePrompt_ACU,
  buildDefaultContinuationSettings_ACU,
  buildV38DefaultContinuationOutlinePrompt_ACU,
} from '../../../src/service/continuation/defaults';
import {
  buildDefaultContinuationAgentPrompts_ACU,
  buildV36ContinuationAgentPrompts_ACU,
  buildV38ContinuationAgentPrompts_ACU,
} from '../../../src/service/continuation/agent/agent-defaults';
import { FirstFloorContinuationStore_ACU } from '../../../src/service/continuation/continuation-store';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

function buildV38Envelope_ACU(): any {
  const settings = buildDefaultContinuationSettings_ACU();
  return {
    schemaVersion: 1,
    settings: {
      ...settings,
      outlinePrompt: buildV38DefaultContinuationOutlinePrompt_ACU(),
      agentPrompts: buildV38ContinuationAgentPrompts_ACU(),
      promptForceDefaultVersion: CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V38_ACU,
    },
    activeTask: null,
  };
}

function seed_ACU(envelope: any) {
  _set_SillyTavern_API_ACU({ chat: [{ _qrf_continuation: envelope }], chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat: vi.fn() } as any);
}

describe('续写迁移 V38→V39（只升级没动过的默认提示词）', () => {
  beforeEach(() => {
    _set_SillyTavern_API_ACU(undefined);
  });

  it('V39 默认组确实不同于 V38：八个角色与阶段大纲换新，reviewer 与 requirementsMaintainer 不变', () => {
    const v38 = buildV38ContinuationAgentPrompts_ACU();
    const v39 = buildDefaultContinuationAgentPrompts_ACU();
    for (const role of ['main', 'arcArchitect', 'maintainer', 'mainlinePlanner', 'beatPlanner', 'finalReviewer', 'webResearcher', 'instructionComposer'] as const) {
      expect(v39[role]).not.toEqual(v38[role]);
    }
    expect(v39.reviewer).toEqual(v38.reviewer);
    expect(v39.requirementsMaintainer).toEqual(v38.requirementsMaintainer);
    expect(buildDefaultContinuationOutlinePrompt_ACU()).not.toEqual(buildV38DefaultContinuationOutlinePrompt_ACU());
  });

  it('没动过的 V38 默认整组升级为 V39 默认，标记推进到 V39', () => {
    seed_ACU(buildV38Envelope_ACU());
    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V39_ACU);
    expect(loaded.settings.agentPrompts).toEqual(buildDefaultContinuationAgentPrompts_ACU());
    expect(loaded.settings.outlinePrompt).toEqual(buildDefaultContinuationOutlinePrompt_ACU());
  });

  it('改过正文的角色整组保留原样，其余没动过的角色照常升级', () => {
    const envelope = buildV38Envelope_ACU();
    const editedMain = envelope.settings.agentPrompts.main.map((segment: any) => ({ ...segment }));
    editedMain[1] = { ...editedMain[1], content: `${editedMain[1].content}\n用户补的一句。` };
    envelope.settings.agentPrompts.main = editedMain;
    const editedOutline = envelope.settings.outlinePrompt.map((segment: any) => ({ ...segment }));
    editedOutline[0] = { ...editedOutline[0], content: '用户自己的大纲身份段。' };
    envelope.settings.outlinePrompt = editedOutline;
    seed_ACU(envelope);
    const loaded = new FirstFloorContinuationStore_ACU().read()!;
    const v39 = buildDefaultContinuationAgentPrompts_ACU();

    expect(loaded.settings.agentPrompts.main).toEqual(editedMain);
    expect(loaded.settings.outlinePrompt).toEqual(editedOutline);
    expect(loaded.settings.agentPrompts.maintainer).toEqual(v39.maintainer);
    expect(loaded.settings.agentPrompts.instructionComposer).toEqual(v39.instructionComposer);
  });

  it('只关掉某段或多加一段也算改过，整组保留', () => {
    const envelope = buildV38Envelope_ACU();
    const toggled = envelope.settings.agentPrompts.maintainer.map((segment: any) => ({ ...segment }));
    toggled[1] = { ...toggled[1], enabled: false };
    envelope.settings.agentPrompts.maintainer = toggled;
    const extended = [...envelope.settings.agentPrompts.beatPlanner.map((segment: any) => ({ ...segment })), { role: 'user', content: '用户追加段', enabled: true, deletable: true }];
    envelope.settings.agentPrompts.beatPlanner = extended;
    seed_ACU(envelope);
    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.agentPrompts.maintainer).toEqual(toggled);
    expect(loaded.settings.agentPrompts.beatPlanner).toEqual(extended);
    expect(loaded.settings.agentPrompts.mainlinePlanner).toEqual(buildDefaultContinuationAgentPrompts_ACU().mainlinePlanner);
  });

  it('更早版本的默认信封沿迁移链到达 V39 默认', () => {
    const envelope = buildV38Envelope_ACU();
    envelope.settings.agentPrompts = buildV36ContinuationAgentPrompts_ACU();
    envelope.settings.promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V36_ACU;
    seed_ACU(envelope);
    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V39_ACU);
    expect(loaded.settings.agentPrompts).toEqual(buildDefaultContinuationAgentPrompts_ACU());
    expect(loaded.settings.outlinePrompt).toEqual(buildDefaultContinuationOutlinePrompt_ACU());
  });

  it('未知版本标记重置为当前（V39）默认', () => {
    const envelope = buildV38Envelope_ACU();
    envelope.settings.promptForceDefaultVersion = 'spv0-unknown';
    seed_ACU(envelope);
    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V39_ACU);
    expect(loaded.settings.agentPrompts).toEqual(buildDefaultContinuationAgentPrompts_ACU());
    expect(loaded.settings.outlinePrompt).toEqual(buildDefaultContinuationOutlinePrompt_ACU());
  });

  it('已是 V39 的信封再读一遍不变（幂等）', () => {
    const envelope = buildV38Envelope_ACU();
    envelope.settings.agentPrompts = buildDefaultContinuationAgentPrompts_ACU();
    envelope.settings.outlinePrompt = buildDefaultContinuationOutlinePrompt_ACU();
    envelope.settings.promptForceDefaultVersion = CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V39_ACU;
    envelope.settings.agentPrompts.main[1] = { ...envelope.settings.agentPrompts.main[1], content: '用户改过' };
    seed_ACU(envelope);
    const loaded = new FirstFloorContinuationStore_ACU().read()!;

    expect(loaded.settings.agentPrompts.main[1].content).toBe('用户改过');
    expect(loaded.settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V39_ACU);
  });
});
