// 红测使命已完成（TT 判别期全部转绿），本文件现为常驻回归锁：防止已修复语义被后续改动悄悄回退。
import { beforeEach, describe, expect, it } from 'vitest';

import { buildEmptyAgentModuleSnapshot_ACU, validateAgentModuleSnapshot_ACU } from '../../../src/service/continuation/agent/agent-module-store';
import type { AgentFinalReviewerOutput_ACU, AgentModuleDelta_ACU, AgentModuleSnapshot_ACU } from '../../../src/service/continuation/agent/agent-model';
import {
  runContinuationAgentWorkflow_ACU,
  type ContinuationWorkflowAgentPayload_ACU,
} from '../../../src/service/continuation/agent/agent-workflow';
import { ContinuationAgentTurnPlanner_ACU } from '../../../src/service/continuation/agent/agent-main-loop';
import { AgentSubagentRuntime_ACU } from '../../../src/service/continuation/agent/agent-subagent-runtime';
import { buildEmptyAgentConversation_ACU } from '../../../src/service/continuation/agent/agent-conversation-store';
import { buildEmptyAgentWorldbookSnapshot_ACU } from '../../../src/service/continuation/agent/agent-worldbook-read';
import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';
import { resetAgentSessionLogForTests_ACU } from '../../../src/service/continuation/agent/agent-session-log';
import { resetAgentRunCacheForTests_ACU } from '../../../src/service/continuation/agent/agent-run-cache';

beforeEach(() => { resetAgentSessionLogForTests_ACU(); resetAgentRunCacheForTests_ACU(); });

function wfSnapshot_ACU(patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 4, ...patch };
}

function wfDelta_ACU(patch: Partial<AgentModuleDelta_ACU> = {}): AgentModuleDelta_ACU {
  return { expectedRevisions: {}, hooks: [], hookPatches: [], infoGap: [], infoGapPatches: [], storyArc: [], storyArcPatches: [], chronology: [], constraintProposals: [], ...patch };
}

function wfReview_ACU(): AgentFinalReviewerOutput_ACU {
  return { verdict: 'pass', summary: 'pass', emotionFindings: [], worldFindings: [], logicFindings: [], requiredFixes: [], preserve: [] };
}

function wfPending_ACU(module: 'hooks' | 'chronology', firstFailedAtIndex: number, rangeStartIndex: number, rangeEndIndex: number) {
  return {
    module, agentName: 'hook-cognition-maintainer',
    violations: [{ path: module, message: `${module} 旧缺口` }], attempts: 1,
    firstFailedAtIndex, lastError: `${module} 旧缺口`,
    source: 'contract_rejected' as const, completion: 'failed' as const,
    rangeStartIndex, rangeEndIndex, acceptedKeys: [], createdAt: 1, updatedAt: 1,
  };
}

describe('复审必须修（判别红测）', () => {
  it('1. 自动修复并发丢 unresolvedIssues：repair partial 必须挂账且 steps 失败', async () => {
    const base = wfSnapshot_ACU({
      pendingFixes: [wfPending_ACU('hooks', 4, 4, 4)],
      materialCompletion: { state: 'failed', rangeStartIndex: 4, rangeEndIndex: 4, modules: { hooks: 'failed' }, updatedAt: 1 },
    });
    const result = await runContinuationAgentWorkflow_ACU({
      settings: buildDefaultContinuationSettings_ACU(),
      snapshot: base,
      opening: { focus: 'f', summary: 's', dispatchWebResearcher: false },
      hasUnsettledHistory: false,
      beatObligation: false,
      majorTurn: false,
      settledIndex: 6,
      completedStageNumbers: [],
      runAgent: async call => {
        if (!call.repair) {
          return { ok: true, summary: 'no_change', noChange: true, planner: { summary: 's', recommendation: 'r', mustPreserve: [], risks: [] } };
        }
        return {
          ok: true,
          summary: '部分修复：H1 已入库，H2 被拒',
          maintainer: {
            summary: '部分修复',
            delta: wfDelta_ACU({ hooks: [{ action: 'upsert', id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'mid', plantedIndex: 2, plannedPayoff: '后文回收', reason: '' }] }),
          },
          writes: ['hooks'],
          readRevisions: base.revisions,
          completion: 'partial',
          moduleCompletion: { hooks: 'partial' },
          unresolvedIssues: [{ module: 'hooks', source: 'contract_rejected', path: 'hooks[1]', message: 'H2 的 summary 不能为空', id: 'H2' }],
          acceptedKeys: ['hooks:H1'],
        } satisfies ContinuationWorkflowAgentPayload_ACU;
      },
      runComposer: async () => ({ instruction: '写吧', summary: 's', constraints: null }),
      runFinalReview: async () => wfReview_ACU(),
    });
    // H1 合法条目已入库
    expect(result.snapshot.hooks.map(item => item.id)).toContain('H1');
    // 被拒的 H2 不得丢失：pending 留存（与主干同式：apply 成功先清掉目标模块 pending，
    // 再按 issues 重建挂账，因此 attempts 从 1 起算）、acceptedKeys 保留已入库键
    const fix = result.snapshot.pendingFixes.find(item => item.module === 'hooks');
    expect(fix).toBeDefined();
    expect(fix!.attempts).toBe(1);
    expect(fix!.acceptedKeys).toContain('hooks:H1');
    expect(fix!.violations.map(item => item.message).join('')).toContain('H2');
    // repair 步进不得报 ok
    expect(result.steps.filter(step => step.agentName === 'hook-cognition-maintainer').map(step => step.status)).toEqual(['failed', 'failed']);
  });

  it('2. 手工派工 partial 当成功且误推水位：被拒条目挂账且水位不推', async () => {
    const preset = { presetName: 'p1', source: 'settings', reason: 'test' } as any;
    const chat = [
      { mes: '我要进禁区', is_user: true },
      { mes: '主角推开铁门。', is_user: false },
      { mes: '继续', is_user: true },
      { mes: '守门人挡在门后，右手藏着黑色晶屑。', is_user: false },
    ];
    const mainReplies = [
      '{"action":"delegate","delegations":[{"agentName":"hook-cognition-maintainer","prompt":"结算最近正文","reads":["$HISTORY_UNSETTLED","$HOOKS_LEDGER"]}]}',
      '{"action":"finalize","instruction":"最终指导"}',
    ];
    const mixed = JSON.stringify({
      summary: '部分结算：H1 已入库，H2 被拒',
      delta: {
        hooks: [
          { action: 'upsert', id: 'H1', summary: '黑色晶屑', status: 'planted', importance: 'high', plantedIndex: 3 },
          { action: 'delete', id: 'H2' },
        ],
      },
    });
    const subReplies = [mixed, mixed, mixed, mixed];
    const mainCalls: Array<Array<{ role: string; content: string }>> = [];
    const written: Array<{ index: number; snapshot: AgentModuleSnapshot_ACU }> = [];
    let snapshot = buildEmptyAgentModuleSnapshot_ACU();
    let conversation = buildEmptyAgentConversation_ACU();
    const subagentRuntime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset) as any,
      resolveAgentApiPreset: (() => preset) as any,
      callInternalAi: async messages => {
        const reply = subReplies.shift() ?? '{"summary":"空","delta":{}}';
        void messages;
        return reply;
      },
    });
    const planner = new ContinuationAgentTurnPlanner_ACU({
      resolveApiPreset: (() => preset) as any,
      callInternalAi: async messages => {
        mainCalls.push(messages);
        return mainReplies.shift() ?? '{"action":"block","reason":"无更多回复"}';
      },
      subagentRuntime,
      readChat: () => chat,
      readModuleSnapshot: () => snapshot,
      writeModuleSnapshot: async (_chat, index, next) => { written.push({ index, snapshot: next }); snapshot = next; },
      readConversation: () => conversation,
      appendConversationMessages: async (_chat, prepared: readonly { id: number }[]) => {
        const existing = new Set(conversation.messages.map(message => message.id));
        const fresh = (prepared as any[]).filter(message => !existing.has(message.id));
        if (!fresh.length) return false;
        const highest = fresh.reduce((max: number, message: any) => Math.max(max, message.id), conversation.nextId - 1);
        conversation = { ...conversation, nextId: highest + 1, messages: [...conversation.messages, ...fresh] };
        return true;
      },
      readCompactionMark: () => null,
      writeCompactionMark: async () => false,
      loadWorldbook: async () => buildEmptyAgentWorldbookSnapshot_ACU(true),
      budget: { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 2, maxReads: 8, maxExtraReads: 1 },
    } as any);
    const settings = buildDefaultContinuationSettings_ACU();
    settings.internalAiRetryLimit = 1;
    settings.agentRunBudget = { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 2, maxReads: 8, maxExtraReads: 1 };
    settings.apiPresetMode = 'fixed';
    settings.fixedApiPresetName = 'p1';
    const result = await planner.plan({
      settings,
      readContext: () => ({
        envelope: {}, task: { taskId: 'task-1', originInstruction: '推进主角进入禁区', stages: [{ stageId: 'stage-1', stageNumber: 2, status: 'running' }] },
        stage: { stageId: 'stage-1', stageNumber: 2, status: 'running' },
        revision: { outline: { title: '禁区试探', goal: '进入禁区', totalTurns: 6 } },
        node: { id: 'node-1', title: '试探', goal: '试探', turns: [{ id: 'turn-1', goal: '推门' }, { id: 'turn-2', goal: '试探' }] },
        turn: { id: 'turn-2', goal: '试探' }, turnNumber: 2, nodeTurnNumber: 2,
      }) as any,
      createInternalRequestIdentity: attempt => ({ taskId: 'task-1', stageId: 'stage-1', turnId: 'turn-2', attemptId: `a-${attempt}`, source: 'turn_instruction' }) as any,
      isInternalRequestCurrent: () => true,
    });
    expect(result.instruction).toBe('最终指导');
    expect(written).toHaveLength(1);
    // H1 已入库
    expect(written[0].snapshot.hooks.map(item => item.id)).toContain('H1');
    // 被拒的 H2 必须挂账 pending
    expect(written[0].snapshot.pendingFixes.map(item => item.module)).toContain('hooks');
    // 未清偿不得推水位到末楼
    expect(written[0].snapshot.settledThroughIndex).toBe(-1);
  });

  it('3. settlementStart>settlementEnd 写出非法快照：钳制后整体合法', async () => {
    const base = wfSnapshot_ACU({
      settledThroughIndex: 4,
      pendingFixes: [wfPending_ACU('hooks', 10, 10, 10)],
      materialCompletion: { state: 'failed', rangeStartIndex: 10, rangeEndIndex: 10, modules: { hooks: 'failed' }, updatedAt: 1 },
    });
    const result = await runContinuationAgentWorkflow_ACU({
      settings: buildDefaultContinuationSettings_ACU(),
      snapshot: base,
      opening: { focus: 'f', summary: 's', dispatchWebResearcher: false },
      hasUnsettledHistory: true,
      beatObligation: false,
      majorTurn: false,
      settledIndex: 4,
      completedStageNumbers: [],
      runAgent: async call => {
        if (call.agentName === 'hook-cognition-maintainer') {
          return {
            ok: true,
            summary: '结算完成',
            maintainer: {
              summary: '结算完成',
              delta: wfDelta_ACU({ hooks: [{ action: 'upsert', id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'mid', plantedIndex: 2, plannedPayoff: '后文回收', reason: '' }] }),
            },
            writes: ['hooks'],
            readRevisions: base.revisions,
            completion: 'complete_changed',
            moduleCompletion: { hooks: 'complete_changed' },
            acceptedKeys: ['hooks:H1'],
          } satisfies ContinuationWorkflowAgentPayload_ACU;
        }
        return { ok: true, summary: call.agentName, planner: { summary: 's', recommendation: 'r', mustPreserve: [], risks: [] } };
      },
      runComposer: async () => ({ instruction: '写吧', summary: 's', constraints: null }),
      runFinalReview: async () => wfReview_ACU(),
    });
    expect(result.snapshot.materialCompletion.rangeStartIndex).toBeLessThanOrEqual(result.snapshot.materialCompletion.rangeEndIndex);
    for (const fix of result.snapshot.pendingFixes) {
      expect(fix.rangeEndIndex).toBeGreaterThanOrEqual(fix.rangeStartIndex);
    }
    expect(validateAgentModuleSnapshot_ACU(result.snapshot)).not.toBeNull();
  });
});
