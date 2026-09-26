import { describe, expect, it } from 'vitest';

import { renderAgentSubagentCatalog_ACU } from '../../../../src/service/continuation/agent/agent-catalog';
import {
  buildDefaultContinuationAgentPrompts_ACU,
  findAgentPromptSlot_ACU,
} from '../../../../src/service/continuation/agent/agent-defaults';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import type { AgentModuleDelta_ACU, AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import {
  continuationBeatObligation_ACU,
  runContinuationAgentWorkflow_ACU,
  type ContinuationWorkflowAgentPayload_ACU,
} from '../../../../src/service/continuation/agent/agent-workflow';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';

function snapshot_ACU(patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 4, ...patch };
}
function delta_ACU(patch: Partial<AgentModuleDelta_ACU> = {}): AgentModuleDelta_ACU {
  return { expectedRevisions: {}, hooks: [], hookPatches: [], infoGap: [], infoGapPatches: [], storyArc: [], storyArcPatches: [], chronology: [], constraintProposals: [], ...patch };
}
function harness_ACU(patch: Record<string, unknown> = {}) {
  const calls: Array<{ agentName: string; prompt: string }> = [];
  const composerPrompts: string[] = [];
  const input: any = {
    settings: buildDefaultContinuationSettings_ACU(),
    snapshot: snapshot_ACU(),
    opening: { focus: '守门人的回避', summary: '试探', dispatchWebResearcher: false },
    hasUnsettledHistory: true,
    beatObligation: false,
    turnNumber: 1,
    settledIndex: 6,
    completedStageNumbers: [],
    runAgent: async (call: { agentName: string; prompt: string }) => {
      calls.push(call);
      if (call.agentName === 'hook-cognition-maintainer') {
        return {
          ok: true, summary: '结算完成',
          maintainer: { summary: '结算完成', delta: delta_ACU({ hooks: [{ action: 'upsert', id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'mid', plantedIndex: 2, plannedPayoff: '后文回收', reason: '' }] }) },
          writes: ['hooks'], readRevisions: snapshot_ACU().revisions,
        } satisfies ContinuationWorkflowAgentPayload_ACU;
      }
      return { ok: true, summary: call.agentName, planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] } };
    },
    runComposer: async (call: { prompt: string }) => {
      composerPrompts.push(call.prompt);
      return { instruction: '从守门人的回避写起', summary: '试探', constraints: null };
    },
    runFinalReview: async () => ({ verdict: 'pass', summary: 'pass', emotionFindings: [], worldFindings: [], logicFindings: [], requiredFixes: [], preserve: [] }),
    ...patch,
  };
  return { input, calls, composerPrompts, run: () => runContinuationAgentWorkflow_ACU(input) };
}

describe('统一资料维护派遣策略 TT 子集（判别测试）', () => {
  it('目录不再暴露 continuity-reviewer 派遣入口', () => {
    const catalog = renderAgentSubagentCatalog_ACU();
    expect(catalog).toContain('hook-cognition-maintainer');
    expect(catalog).not.toContain('continuity-reviewer');
  });

  it('首轮无伏笔义务时跳过 beat；第二轮起保底派遣 beat（no_change 出口）', async () => {
    const first = harness_ACU({ turnNumber: 1, beatObligation: false });
    const firstResult = await first.run();
    expect(first.calls.map(c => c.agentName)).toEqual(['hook-cognition-maintainer', 'mainline-planner']);
    expect(firstResult.steps.map(s => `${s.agentName}:${s.status}`)).toContain('beat-planner:skipped');

    const second = harness_ACU({ turnNumber: 2, beatObligation: false });
    await second.run();
    expect(second.calls.map(c => c.agentName)).toEqual(['hook-cognition-maintainer', 'mainline-planner', 'beat-planner']);
    const beatPrompt = second.calls.find(c => c.agentName === 'beat-planner')!.prompt;
    expect(beatPrompt).toContain('no_change');
  });

  it('砍掉 reviewer 派遣：即使策划冲突也不派 continuity-reviewer，composer 承担自查', async () => {
    const h = harness_ACU({
      turnNumber: 2,
      runAgent: async (call: { agentName: string; prompt: string }) => {
        if (call.agentName === 'hook-cognition-maintainer') {
          return { ok: true, summary: '结算完成', maintainer: { summary: '结算完成', delta: delta_ACU() }, writes: ['hooks'], readRevisions: snapshot_ACU().revisions } satisfies ContinuationWorkflowAgentPayload_ACU;
        }
        return { ok: true, summary: call.agentName, planner: { summary: '建议', recommendation: '两套方案互相冲突：A 要连夜追击、B 要原地休整', mustPreserve: [], risks: ['红线风险'] } };
      },
    });
    // harness 的 runAgent 被覆盖，需要手动记录 calls
    const calls: string[] = [];
    const origRun = h.input.runAgent;
    h.input.runAgent = async (call: any) => { calls.push(call.agentName); return origRun(call); };
    const result = await h.run();
    expect(calls).not.toContain('continuity-reviewer');
    expect(result.steps.some(s => s.agentName === 'continuity-reviewer')).toBe(false);
    expect(h.composerPrompts[0]).toContain('保守');
    expect(h.composerPrompts[0]).not.toContain('审查结论');
  });

  it('composer 自查指令要求保守取舍、不得拼接矛盾建议', async () => {
    const h = harness_ACU({ turnNumber: 2 });
    await h.run();
    const prompt = h.composerPrompts[0];
    expect(prompt).toContain('自查');
    expect(prompt).toContain('保守');
    expect(prompt).toContain('不得原样拼接');
  });

  it('默认组：主规则不再派 reviewer、composer 自查、终审兜底（承接大转折/冲突判定）', () => {
    const prompts = buildDefaultContinuationAgentPrompts_ACU();
    const mainText = prompts.main.map(s => s.content).join('\n');
    expect(mainText).toContain('不再单独派 continuity-reviewer');
    expect(mainText).toContain('第二轮起保底派 beat-planner');
    expect(mainText).toContain('instruction-composer 自查');
    expect(mainText).toContain('finalReviewer 终审');

    const composerTask = findAgentPromptSlot_ACU(prompts.instructionComposer, 'task')!.content;
    expect(composerTask).toContain('冲突');
    expect(composerTask).toContain('保守');

    const finalTask = findAgentPromptSlot_ACU(prompts.finalReviewer, 'task')!.content;
    expect(finalTask).toContain('hooks');
    expect(finalTask).toContain('continuity-reviewer');
  });

  it('伏笔义务判定保持（payoff/reveal 仍触发），turnNumber 接管大转折判定', () => {
    expect(continuationBeatObligation_ACU({ function: 'payoff', goal: '喝茶' })).toBe(true);
    expect(continuationBeatObligation_ACU({ goal: '回收旧伏笔' })).toBe(true);
    expect(continuationBeatObligation_ACU({ function: 'daily_bond', goal: '喝茶' })).toBe(false);
  });
});
