import { describe, expect, it } from 'vitest';

import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import type { AgentFinalReviewerOutput_ACU, AgentModuleDelta_ACU, AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import {
  continuationBeatObligation_ACU,
  runContinuationAgentWorkflow_ACU,
  type ContinuationWorkflowAgentCall_ACU,
  type ContinuationWorkflowAgentPayload_ACU,
  type ContinuationWorkflowInput_ACU,
} from '../../../../src/service/continuation/agent/agent-workflow';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../../../../src/service/continuation/model';

function snapshot_ACU(patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 4, ...patch };
}

function delta_ACU(patch: Partial<AgentModuleDelta_ACU> = {}): AgentModuleDelta_ACU {
  return { expectedRevisions: {}, hooks: [], hookPatches: [], infoGap: [], infoGapPatches: [], storyArc: [], storyArcPatches: [], chronology: [], constraintProposals: [], ...patch };
}

function review_ACU(verdict: AgentFinalReviewerOutput_ACU['verdict'], requiredFixes: string[] = []): AgentFinalReviewerOutput_ACU {
  return { verdict, summary: verdict, emotionFindings: [], worldFindings: [], logicFindings: [], requiredFixes, preserve: [] };
}

function harness_ACU(patch: Partial<ContinuationWorkflowInput_ACU> = {}) {
  const calls: ContinuationWorkflowAgentCall_ACU[] = [];
  const composerPrompts: string[] = [];
  const input: ContinuationWorkflowInput_ACU = {
    settings: buildDefaultContinuationSettings_ACU(),
    snapshot: snapshot_ACU(),
    opening: { focus: '守门人的回避', summary: '试探', dispatchWebResearcher: false },
    hasUnsettledHistory: true,
    beatObligation: false,
    turnNumber: 1,
    settledIndex: 6,
    completedStageNumbers: [],
    runAgent: async call => {
      calls.push(call);
      if (call.agentName === 'hook-cognition-maintainer') {
        return {
          ok: true,
          summary: '结算完成',
          maintainer: {
            summary: '结算完成',
            delta: delta_ACU({ hooks: [{ action: 'upsert', id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'mid', plantedIndex: 2, plannedPayoff: '后文回收', reason: '' }] }),
          },
          writes: ['hooks'],
          readRevisions: input.snapshot.revisions,
        } satisfies ContinuationWorkflowAgentPayload_ACU;
      }
      return {
        ok: true,
        summary: call.agentName,
        planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] },
      };
    },
    runComposer: async call => {
      composerPrompts.push(call.prompt + call.revisionFeedback);
      return { instruction: '从守门人的回避写起', summary: '试探', constraints: null };
    },
    runFinalReview: async () => review_ACU('pass'),
    ...patch,
  };
  return { input, calls, composerPrompts, run: () => runContinuationAgentWorkflow_ACU(input) };
}

describe('续写固定工作流（TT）', () => {
  it('结算窗口外的 pendingFixes 不被按模块清账（移植上游 5f8afe3a）', async () => {
    const inWindow = {
      module: 'hooks', agentName: 'hook-cognition-maintainer',
      violations: [{ path: 'hooks', message: 'x' }], attempts: 1, firstFailedAtIndex: 5,
      lastError: 'x', source: 'maintainer', completion: 'failed',
      rangeStartIndex: 5, rangeEndIndex: 6, acceptedKeys: [], createdAt: 1, updatedAt: 1,
    } as const;
    const outWindow = { ...inWindow, rangeStartIndex: 100, rangeEndIndex: 100 };
    const { run } = harness_ACU({
      snapshot: snapshot_ACU({ pendingFixes: [inWindow as any, outWindow as any] }),
    });
    const result = await run();
    const remaining = result.pendingFixes;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ module: 'hooks', rangeStartIndex: 100, rangeEndIndex: 100 });
  });

  it('旧 invoke_failed 缺口在同范围成功后清除，不靠无变化交付清账（移植上游 365dd863）', async () => {
    const stale = {
      module: 'hooks', agentName: 'hook-cognition-maintainer',
      violations: [{ path: 'hooks', message: '维护子代理调用失败' }], attempts: 1, firstFailedAtIndex: 5,
      lastError: '维护子代理调用失败', source: 'invoke_failed', completion: 'failed',
      rangeStartIndex: 5, rangeEndIndex: 6, acceptedKeys: [], createdAt: 1, updatedAt: 1,
    } as const;
    const { run } = harness_ACU({ snapshot: snapshot_ACU({ pendingFixes: [stale as any] }) });
    const result = await run();
    expect(result.pendingFixes.some(item => item.source === 'invoke_failed')).toBe(false);
  });

  it('窗口外仍有未处理正文时不得推进连续结算水位（移植上游 365dd863）', async () => {
    const { run } = harness_ACU({ canAdvanceSettlement: false });
    const result = await run();
    expect(result.snapshot.settledThroughIndex).toBe(4);
  });

  it('窗口结算只记录实际窗口：水位不动、完成区间如实记（移植上游 5f8afe3a）', async () => {
    const { run } = harness_ACU({
      snapshot: snapshot_ACU({ settledThroughIndex: -1 }),
      settledIndex: 999,
      settlementStartIndex: 997,
      canAdvanceSettlement: false,
    });
    const result = await run();
    expect(result.outcome).toBe('deliver');
    expect(result.snapshot.settledThroughIndex).toBe(-1);
    expect(result.snapshot.materialCompletion).toMatchObject({
      state: 'complete_changed', rangeStartIndex: 997, rangeEndIndex: 999,
    });
  });

  it('连续窗口结算合并完成区间；空隙后重新起算（移植上游 5f8afe3a）', async () => {
    const first = harness_ACU({
      snapshot: snapshot_ACU({ settledThroughIndex: -1 }),
      settledIndex: 999,
      settlementStartIndex: 997,
      canAdvanceSettlement: false,
    });
    const firstResult = await first.run();
    expect(firstResult.snapshot.materialCompletion).toMatchObject({ rangeStartIndex: 997, rangeEndIndex: 999 });
    const resumed = harness_ACU({
      snapshot: firstResult.snapshot,
      settledIndex: 1001,
      settlementStartIndex: 1000,
      canAdvanceSettlement: false,
    });
    const resumedResult = await resumed.run();
    expect(resumedResult.snapshot.settledThroughIndex).toBe(-1);
    expect(resumedResult.snapshot.materialCompletion).toMatchObject({ rangeStartIndex: 997, rangeEndIndex: 1001 });
    const afterGap = harness_ACU({
      snapshot: resumedResult.snapshot,
      settledIndex: 1009,
      settlementStartIndex: 1007,
      canAdvanceSettlement: false,
    });
    const afterGapResult = await afterGap.run();
    expect(afterGapResult.outcome).toBe('deliver');
    expect(afterGapResult.snapshot.settledThroughIndex).toBe(-1);
    expect(afterGapResult.snapshot.materialCompletion).toMatchObject({ rangeStartIndex: 1007, rangeEndIndex: 1009 });
  });

  it('无变化交付同样清除同范围旧 invoke_failed（移植上游 365dd863）', async () => {    const stale = {
      module: 'hooks', agentName: 'hook-cognition-maintainer',
      violations: [{ path: 'hooks', message: '维护子代理调用失败' }], attempts: 1, firstFailedAtIndex: 5,
      lastError: '维护子代理调用失败', source: 'invoke_failed', completion: 'failed',
      rangeStartIndex: 5, rangeEndIndex: 6, acceptedKeys: [], createdAt: 1, updatedAt: 1,
    } as const;
    const base = harness_ACU({ snapshot: snapshot_ACU({ pendingFixes: [stale as any] }) });
    const { run } = harness_ACU({
      snapshot: snapshot_ACU({ pendingFixes: [stale as any] }),
      runAgent: async (call: any) => {
        if (call.agentName === 'hook-cognition-maintainer') {
          return {
            ok: true, summary: '复查无变化', noChange: true,
            maintainer: { summary: '复查无变化', delta: delta_ACU() },
            writes: ['hooks'], readRevisions: snapshot_ACU().revisions,
          };
        }
        return base.input.runAgent(call);
      },
    });
    const result = await run();
    expect(result.pendingFixes.some(item => item.source === 'invoke_failed')).toBe(false);
  });

  it('settlementStartIndex 入参覆盖缺省起点（移植上游 5f8afe3a）', async () => {    const pending = {
      module: 'hooks', agentName: 'hook-cognition-maintainer',
      violations: [{ path: 'hooks', message: 'x' }], attempts: 1, firstFailedAtIndex: 5,
      lastError: 'x', source: 'maintainer', completion: 'failed',
      rangeStartIndex: 5, rangeEndIndex: 6, acceptedKeys: [], createdAt: 1, updatedAt: 1,
    } as const;
    const { run } = harness_ACU({
      snapshot: snapshot_ACU({ pendingFixes: [pending as any] }),
      settlementStartIndex: 2,
    });
    const result = await run();
    expect(result.snapshot.materialCompletion.rangeStartIndex).toBe(2);
  });
  it('伏笔义务由程序判定（turnNumber 接管轮次判定）', () => {
    expect(continuationBeatObligation_ACU({ function: 'payoff', goal: '喝茶' })).toBe(true);
    expect(continuationBeatObligation_ACU({ goal: '回收旧伏笔' })).toBe(true);
    expect(continuationBeatObligation_ACU({ function: 'daily_bond', goal: '喝茶' })).toBe(false);
  });

  it('首轮无伏笔义务时跳过 beat，开局焦点进入结算与 composer', async () => {
    const harness = harness_ACU();
    const result = await harness.run();
    expect(result.outcome).toBe('deliver');
    expect(result.instruction).toBe('从守门人的回避写起');
    expect(harness.calls.map(call => call.agentName)).toEqual(['hook-cognition-maintainer', 'mainline-planner']);
    expect(result.steps.map(step => `${step.agentName}:${step.status}`)).toEqual([
      'hook-cognition-maintainer:ok',
      'beat-planner:skipped',
      'mainline-planner:ok',
      'instruction-composer:ok',
    ]);
    expect(harness.calls[0].prompt).toContain('守门人的回避');
    expect(harness.composerPrompts[0]).toContain('守门人的回避');
    expect(result.snapshot.revisions.hooks).toBe(1);
  });

  it('第二轮起即使没有伏笔义务也会保底派 beat-planner（no_change 出口）', async () => {
    const harness = harness_ACU({ beatObligation: false, turnNumber: 2 });
    await harness.run();
    expect(harness.calls.map(call => call.agentName)).toEqual([
      'hook-cognition-maintainer',
      'mainline-planner',
      'beat-planner',
    ]);
    expect(harness.calls.find(call => call.agentName === 'beat-planner')!.prompt).toContain('no_change');
  });

  it('砍掉 reviewer 后冲突由 composer 自查保守取舍（不得拼接矛盾建议）', async () => {
    const harness = harness_ACU({
      turnNumber: 2,
      runAgent: async call => {
        if (call.agentName === 'hook-cognition-maintainer') {
          return {
            ok: true,
            summary: '结算完成',
            maintainer: { summary: '结算完成', delta: delta_ACU() },
            writes: ['hooks'],
            readRevisions: snapshot_ACU().revisions,
          } satisfies ContinuationWorkflowAgentPayload_ACU;
        }
        return { ok: true, summary: call.agentName, planner: { summary: '建议', recommendation: '两套方案互相冲突', mustPreserve: [], risks: [] } };
      },
    });
    const result = await harness.run();
    expect(harness.calls.map(call => call.agentName)).not.toContain('continuity-reviewer');
    expect(result.steps.some(step => step.agentName === 'continuity-reviewer')).toBe(false);
    expect(harness.composerPrompts[0]).toContain('保守');
    expect(harness.composerPrompts[0]).toContain('不得原样拼接');
  });

  it('没有未结算正文时 maintainer 短路，不调用模型', async () => {
    const harness = harness_ACU({ hasUnsettledHistory: false });
    const result = await harness.run();
    expect(result.steps[0]).toMatchObject({ agentName: 'hook-cognition-maintainer', status: 'no_change' });
    expect(harness.calls.map(call => call.agentName)).toEqual(['mainline-planner']);
  });

  it('终审 pass 直接交付；revise 打回后修订交付；连续失败升级', async () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.finalReview.enabled = true;
    settings.workflow.reviseLimit = 3;
    const verdicts: AgentFinalReviewerOutput_ACU['verdict'][] = ['revise', 'pass'];
    const revised = harness_ACU({
      settings,
      hasUnsettledHistory: false,
      runFinalReview: async () => review_ACU(verdicts.shift() ?? 'pass', ['补上时间锚']),
    });
    const revisedResult = await revised.run();
    expect(revisedResult.outcome).toBe('deliver');
    expect(revised.composerPrompts.some(prompt => prompt.includes('补上时间锚'))).toBe(true);

    let reviewCount = 0;
    const failed = harness_ACU({
      settings,
      hasUnsettledHistory: false,
      runFinalReview: async () => {
        reviewCount += 1;
        return review_ACU('block', ['硬冲突']);
      },
    });
    const failedResult = await failed.run();
    expect(reviewCount).toBe(3);
    expect(failedResult.outcome).toBe('escalate');
    expect(failedResult.escalationKind).toBe('final_review');
    expect(failedResult.instruction).toBe('');
  });

  it('终审请求失效时原样重抛，空 instruction 升级', async () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.finalReview.enabled = true;
    const stale = harness_ACU({
      settings,
      hasUnsettledHistory: false,
      runFinalReview: async () => {
        throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_INTERNAL_REQUEST_STALE', 'agent_delegate', '请求已失效', false));
      },
    });
    await expect(stale.run()).rejects.toMatchObject({ error: { code: 'CONTINUATION_INTERNAL_REQUEST_STALE' } });

    const empty = harness_ACU({
      hasUnsettledHistory: false,
      runComposer: async () => ({ instruction: '  ', summary: '空', constraints: null }),
    });
    const emptyResult = await empty.run();
    expect(emptyResult.outcome).toBe('escalate');
    expect(emptyResult.instruction).toBe('');
  });

  it('违规模块记入 pendingFixes 并可被修复清除；达上限后升级', async () => {    const broken = snapshot_ACU({
      pendingFixes: [{ module: 'hooks', agentName: 'hook-cognition-maintainer', violations: [{ path: 'hooks', message: 'title 不能为空' }], attempts: 1, firstFailedAtIndex: 4, lastError: 'title 不能为空' }],
    });
    const repairCalls: ContinuationWorkflowAgentCall_ACU[] = [];
    const repaired = harness_ACU({
      hasUnsettledHistory: false,
      snapshot: broken,
      runAgent: async call => {
        repairCalls.push(call);
        if (call.repair) {
          return {
            ok: true,
            summary: '已修复',
            maintainer: {
              summary: '已修复',
              delta: delta_ACU({ hooks: [{ action: 'upsert', id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'mid', plantedIndex: 2, plannedPayoff: '后文回收', reason: '' }] }),
            },
            writes: ['hooks'],
            readRevisions: broken.revisions,
          };
        }
        return { ok: true, summary: 'no_change', noChange: true, planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] } };
      },
    });
    const repairedResult = await repaired.run();
    expect(repairCalls.some(call => call.billing === 'repair' && call.agentName === 'hook-cognition-maintainer')).toBe(true);
    expect(repairedResult.outcome).toBe('deliver');
    expect(repairedResult.pendingFixes).toEqual([]);

    const exhausted = snapshot_ACU({
      pendingFixes: [{ ...broken.pendingFixes[0], attempts: 3 }],
    });
    const blocked = harness_ACU({ hasUnsettledHistory: false, snapshot: exhausted });
    const blockedResult = await blocked.run();
    expect(blocked.calls.some(call => call.billing === 'repair')).toBe(false);
    expect(blockedResult.outcome).toBe('escalate');
    expect(blockedResult.escalationKind).toBe('pending_fix');
  });

  it('工作流内容斥证据门：chronology 引用非 AI 楼时记入 pendingFixes 且不入库', async () => {
    const harness = harness_ACU({
      allowedEvidenceIndexes: new Set([2, 4, 6]),
      runAgent: async call => {
        if (call.agentName === 'hook-cognition-maintainer') {
          return {
            ok: true,
            summary: '结算完成',
            maintainer: {
              summary: '结算完成',
              delta: delta_ACU({
                chronology: [{
                  action: 'upsert',
                  id: 'T9',
                  anchor: '入城后的第七天',
                  elapsed: '自开篇约十七日',
                  precision: 'approximate',
                  transition: '在临川城休整七日',
                  evidenceIndexes: [0],
                  reason: '',
                }],
              }),
            },
            writes: ['chronology'],
            readRevisions: snapshot_ACU().revisions,
          } satisfies ContinuationWorkflowAgentPayload_ACU;
        }
        return {
          ok: true,
          summary: call.agentName,
          planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] },
        };
      },
    });
    const result = await harness.run();
    expect(result.snapshot.chronology).toEqual([]);
    expect(result.pendingFixes).toHaveLength(1);
    expect(result.pendingFixes[0]).toMatchObject({ module: 'chronology' });
    expect(result.pendingFixes[0].attempts).toBeGreaterThanOrEqual(1);
    expect(result.pendingFixes[0].lastError).toContain('AI 正文楼层');
  });
});
