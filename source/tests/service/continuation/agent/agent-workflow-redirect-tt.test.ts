import { describe, expect, it } from 'vitest';

import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import type { AgentModuleDelta_ACU, AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import {
  runContinuationAgentWorkflow_ACU,
  type ContinuationWorkflowAgentCall_ACU,
  type ContinuationWorkflowAgentPayload_ACU,
  type ContinuationWorkflowInput_ACU,
} from '../../../../src/service/continuation/agent/agent-workflow';
import { AgentSubagentRuntime_ACU } from '../../../../src/service/continuation/agent/agent-subagent-runtime';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';

function snapshot_ACU(patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 4, ...patch };
}

function delta_ACU(patch: Partial<AgentModuleDelta_ACU> = {}): AgentModuleDelta_ACU {
  return { expectedRevisions: {}, hooks: [], hookPatches: [], infoGap: [], infoGapPatches: [], storyArc: [], storyArcPatches: [], chronology: [], chronologyPatches: [], constraintProposals: [], ...patch };
}

function harness_ACU(patch: Partial<ContinuationWorkflowInput_ACU> = {}) {
  const calls: ContinuationWorkflowAgentCall_ACU[] = [];
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
          readRevisions: snapshot_ACU().revisions,
        } satisfies ContinuationWorkflowAgentPayload_ACU;
      }
      return {
        ok: true,
        summary: call.agentName,
        planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] },
      };
    },
    runComposer: async () => ({ instruction: '从守门人的回避写起', summary: '试探', constraints: null }),
    runFinalReview: async () => ({ verdict: 'pass', summary: 'pass', emotionFindings: [], worldFindings: [], logicFindings: [], requiredFixes: [], preserve: [] }),
    ...patch,
  };
  return { input, calls, run: () => runContinuationAgentWorkflow_ACU(input) };
}

const preset_ACU = { presetName: 'p1', source: 'settings', reason: 'test' } as any;

function subagentInput_ACU(agentName = 'hook-cognition-maintainer', extra: Record<string, unknown> = {}) {
  const settings = buildDefaultContinuationSettings_ACU();
  return {
    delegation: { agentName, prompt: '结算', reads: [] },
    settings,
    resolveContext: {
      chat: [
        { mes: '继续', is_user: true },
        { mes: '守门人挡在门后。', is_user: false },
      ],
      moduleSnapshot: buildEmptyAgentModuleSnapshot_ACU(),
      settledThroughIndex: 0,
      execution: {
        envelope: {}, task: { taskId: 't', stages: [] }, stage: null,
        revision: null, node: null, turn: null,
        turnNumber: null, nodeTurnNumber: null,
      } as any,
      originInstruction: '推进剧情',
      recentTurnCount: 2,
      tableData: { s1: { name: '角色表', content: [['姓名'], ['林瑶']] } },
    },
    budget: { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 1, maxReads: 8, maxExtraReads: 1 },
    preset: preset_ACU,
    createIdentity: (_name: string, attempt: number) => ({ taskId: 't', stageId: 's', turnId: 'u', attemptId: `a-${attempt}`, source: 'agent_subagent' }) as any,
    isCurrent: () => true,
    ...extra,
  } as Parameters<AgentSubagentRuntime_ACU['run']>[0];
}

const finalReply_ACU = JSON.stringify({ summary: '结算完成', delta: {} });

describe('固定工作流定向修正（上游 333cae77 TT 子集）', () => {
  it('首派失败仍有 pendingFixes 时在结算块内定向重派：billing 保持 pipeline、targetModules 收窄到违规模块、prompt 带 path 级明细', async () => {
    const failedCalls: ContinuationWorkflowAgentCall_ACU[] = [];
    const failed = harness_ACU({
      runAgent: async call => {
        failedCalls.push(call);
        if (call.agentName === 'hook-cognition-maintainer') {
          return { ok: false, summary: '仍缺栏', writes: ['hooks'], unresolvedIssues: [{ module: 'hooks', source: 'protocol_failed', path: 'hooks#H1.status', message: '缺栏' }] };
        }
        return { ok: true, summary: '建议', planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] } };
      },
    });
    const failedResult = await failed.run();
    const failedMaintainerCalls = failedCalls.filter(call => call.agentName === 'hook-cognition-maintainer');
    // 默认 reviseLimit=3：首派 + 3 次定向重派 = 4 次，且全部在结算块内（billing 保持 pipeline）
    expect(failedMaintainerCalls).toHaveLength(4);
    expect(failedCalls.every(call => call.billing !== 'repair')).toBe(true);
    // 首派不带 targetModules，重派必须定向到违规模块
    expect(failedMaintainerCalls[0].targetModules).toBeUndefined();
    expect(failedMaintainerCalls.slice(1).every(call => call.targetModules?.includes('hooks'))).toBe(true);
    // 重派 prompt 必须带 path 级违规明细（path: message），否则模型无法定位缺栏
    expect(failedMaintainerCalls[1].prompt).toContain('hooks#H1.status: 缺栏');
    expect(failedMaintainerCalls[1].prompt).toContain('定向修正');
    expect(failedResult).toMatchObject({ outcome: 'escalate', escalationKind: 'pending_fix' });
    expect(failedResult.pendingFixes[0].violations).toContainEqual({ path: 'hooks#H1.status', message: '缺栏' });
  });

  it('重派次数有界：reviseLimit=0 时只首派一次，reviseLimit=1 时首派+1 次', async () => {
    const alwaysFail = async (call: ContinuationWorkflowAgentCall_ACU, calls: ContinuationWorkflowAgentCall_ACU[]) => {
      calls.push(call);
      if (call.agentName === 'hook-cognition-maintainer') {
        return { ok: false, summary: '仍缺栏', writes: ['hooks'], unresolvedIssues: [{ module: 'hooks', source: 'protocol_failed', path: 'hooks#H1.status', message: '缺栏' }] };
      }
      return { ok: true, summary: '建议', planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] } };
    };
    const settings0 = buildDefaultContinuationSettings_ACU();
    settings0.workflow.reviseLimit = 0;
    const calls0: ContinuationWorkflowAgentCall_ACU[] = [];
    const h0 = harness_ACU({ settings: settings0, runAgent: call => alwaysFail(call, calls0) });
    await h0.run();
    // 有界对象是结算块内重派（billing pipeline）；残余由旧并行 repair 通道收尾，故总数含 1 次 repair
    expect(calls0.filter(call => call.agentName === 'hook-cognition-maintainer' && call.billing === 'pipeline')).toHaveLength(1);

    const settings1 = buildDefaultContinuationSettings_ACU();
    settings1.workflow.reviseLimit = 1;
    const calls1: ContinuationWorkflowAgentCall_ACU[] = [];
    const h1 = harness_ACU({ settings: settings1, runAgent: call => alwaysFail(call, calls1) });
    await h1.run();
    expect(calls1.filter(call => call.agentName === 'hook-cognition-maintainer' && call.billing === 'pipeline')).toHaveLength(2);
  });

  it('第二轮修复成功即停止重派，不耗尽 reviseLimit', async () => {
    const calls: ContinuationWorkflowAgentCall_ACU[] = [];
    let maintainerCount = 0;
    const base = snapshot_ACU();
    const h = harness_ACU({
      runAgent: async call => {
        calls.push(call);
        if (call.agentName === 'hook-cognition-maintainer') {
          maintainerCount += 1;
          if (maintainerCount === 1) {
            return { ok: false, summary: '仍缺栏', writes: ['hooks'], unresolvedIssues: [{ module: 'hooks', source: 'protocol_failed', path: 'hooks#H1.status', message: '缺栏' }] };
          }
          return {
            ok: true,
            summary: '补齐伏笔',
            maintainer: { summary: '补齐伏笔', delta: delta_ACU({ hooks: [{ action: 'upsert', id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'mid', plantedIndex: 2, plannedPayoff: '后文回收', reason: '' }] }) },
            writes: ['hooks'],
            readRevisions: base.revisions,
          };
        }
        return { ok: true, summary: '建议', planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] } };
      },
    });
    const result = await h.run();
    expect(calls.filter(call => call.agentName === 'hook-cognition-maintainer')).toHaveLength(2);
    // 必须走结算块内定向重派（billing pipeline + targetModules），而非旧并行 repair 通道
    expect(calls[1].billing).toBe('pipeline');
    expect(calls[1].targetModules).toContain('hooks');
    expect(calls[1].prompt).toContain('hooks#H1.status: 缺栏');
    expect(result.pendingFixes).toEqual([]);
  });

  it('truncated pending 不触发结算块内重派（留给契约续写/旧并行通道），旧并行 repair 通道保留收残余', async () => {
    const calls: ContinuationWorkflowAgentCall_ACU[] = [];
    const base = snapshot_ACU();
    const h = harness_ACU({
      runAgent: async call => {
        calls.push(call);
        if (call.agentName === 'hook-cognition-maintainer' && !call.repair) {
          return {
            ok: true,
            summary: '伏笔已结算，年代学尾部截断',
            maintainer: {
              summary: '伏笔已结算，年代学尾部截断',
              delta: delta_ACU({ hooks: [{ action: 'upsert', id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'mid', plantedIndex: 2, plannedPayoff: '后文回收', reason: '' }] }),
            },
            writes: ['hooks', 'infoGap', 'chronology'],
            readRevisions: base.revisions,
            completion: 'partial',
            moduleCompletion: { hooks: 'complete_changed', infoGap: 'complete_no_change', chronology: 'failed' },
            unresolvedIssues: [{ module: 'chronology', source: 'truncated', path: 'chronology', message: '年代学尾部尚未确认完整' }],
            acceptedKeys: ['hooks:H1'],
          };
        }
        if (call.repair) {
          return { ok: true, summary: '修复中', maintainer: { summary: '修复中', delta: delta_ACU() }, writes: call.targetModules ? [...call.targetModules] : [], readRevisions: base.revisions };
        }
        return { ok: true, summary: call.agentName, planner: { summary: '建议', recommendation: '安静地问一句', mustPreserve: [], risks: [] } };
      },
    });
    await h.run();
    const maintainerPipelineCalls = calls.filter(call => call.agentName === 'hook-cognition-maintainer' && call.billing === 'pipeline');
    // truncated 不进结算块内重派：pipeline 维持首派一次
    expect(maintainerPipelineCalls).toHaveLength(1);
    // 旧并行 repair 通道保留：残余 truncated 仍走 billing=repair 收尾
    expect(calls.some(call => call.billing === 'repair' && call.agentName === 'hook-cognition-maintainer')).toBe(true);
  });

  it('子代理 write 集按 targetModules∩KIND_FIXED_WRITES 真实收窄：合法模块保留、非法模块不扩张、空集回退全集', async () => {
    const runOnce = async (agentName: string, extra: Record<string, unknown>) => {
      const runtime = new AgentSubagentRuntime_ACU({
        resolveApiPreset: (() => preset_ACU) as any,
        callInternalAi: async () => finalReply_ACU,
      });
      return runtime.run(subagentInput_ACU(agentName, extra));
    };
    // 定向到 hooks：只保留 hooks（收窄生效）
    const narrowed = await runOnce('hook-cognition-maintainer', { targetModules: ['hooks'] });
    expect(narrowed.writes).toEqual(['hooks']);
    // 混入职责外模块 storyArc：交集裁掉非法项，不得扩张到 storyArc（裁剪错误即丢修的反例）
    const mixed = await runOnce('hook-cognition-maintainer', { targetModules: ['hooks', 'storyArc'] as any });
    expect(mixed.writes).toEqual(['hooks']);
    expect(mixed.writes).not.toContain('storyArc');
    // 不传 targetModules：回退职责全集（合法模块不得被裁掉）
    const full = await runOnce('hook-cognition-maintainer', {});
    expect(full.writes).toEqual(['hooks', 'infoGap', 'chronology']);
    // 空数组同样回退全集
    const empty = await runOnce('hook-cognition-maintainer', { targetModules: [] });
    expect(empty.writes).toEqual(['hooks', 'infoGap', 'chronology']);
    // 非 maintain 职责不受 targetModules 影响（arc 仍只写 storyArc）
    const arcInput = subagentInput_ACU('arc-architect', { targetModules: ['hooks'] });
    arcInput.resolveContext.moduleSnapshot = {
      ...arcInput.resolveContext.moduleSnapshot,
      storyArc: [{ id: 'ARC-STORY', scope: 'story', title: '全书', direction: '追查真相', escalation: '', withheld: '', status: 'active', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '' }],
    } as any;
    const arcRuntime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async () => finalReply_ACU,
    });
    const arc = await arcRuntime.run(arcInput);
    expect(arc.writes).toEqual(['storyArc']);
  });
});
