import { describe, expect, it, vi } from 'vitest';

import { AgentSubagentRuntime_ACU } from '../../../../src/service/continuation/agent/agent-subagent-runtime';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import type { AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import { runContinuationAgentWorkflow_ACU } from '../../../../src/service/continuation/agent/agent-workflow';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

/**
 * 复审必须修三项判别测试（T8 未提交基线，按本地脚手架重写）：
 * 1. 余量静默丢弃：usedFieldWrites + 非空最终余量不得流入结算；
 * 2. 写轮次预算溢出：maxCalls 必须计入写轮，iterations 必须含写轮；
 * 3. $FIELD 原型链：模型可控 id 不得命中原型、不得抛 TypeError 拖垮整批。
 * 先全部判红，再逐项落码。
 */

const preset_ACU = { presetName: 'p1', source: 'settings', reason: 'test' } as any;

function snapshotAt(settledThroughIndex: number, patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex, ...patch };
}

function runtimeInput_ACU(overrides: Record<string, unknown> = {}): Parameters<AgentSubagentRuntime_ACU['run']>[0] {
  const settings = buildDefaultContinuationSettings_ACU();
  settings.promptCacheEnabled = false;
  settings.internalAiRetryLimit = 0;
  return {
    delegation: { agentName: 'hook-cognition-maintainer', prompt: '结算', reads: [] },
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
    },
    budget: { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 1, maxReads: 8, maxExtraReads: 0 },
    preset: preset_ACU,
    createIdentity: (_name, attempt) => ({ taskId: 't', stageId: 's', turnId: 'u', attemptId: `a-${attempt}`, source: 'agent_subagent' }) as any,
    isCurrent: () => true,
    ...overrides,
  };
}

const committedReceipt_ACU = {
  status: 'committed',
  accepted: [{ module: 'hooks', id: 'H1', field: 'summary', revision: 1 }],
  rejected: [],
  partials: [{ module: 'hooks', id: 'H1', missingFields: ['status'] }],
  revisions: snapshotAt(0).revisions,
  constraintProposals: [],
} as any;

const writeSqlReply_ACU = '{"action":"write_sql","sql":"UPDATE hooks SET summary = \'x\' WHERE id = \'H1\' AND expected_revision = 0"}';
const remainderContractReply_ACU = JSON.stringify({
  summary: '还有余量',
  delta: { hooks: [{ action: 'upsert', id: 'HX', summary: '余量条目', status: 'planted', importance: 'mid', plantedIndex: 0, plannedPayoff: '', reason: '' }] },
});
const emptyContractReply_ACU = JSON.stringify({ summary: '结算完成', delta: {} });

describe('必须修1：余量不得静默丢弃', () => {
  it('工作流结算门：usedFieldWrites + 非空余量直接拒绝，不流入重读交付', async () => {
    const defaults = buildDefaultContinuationSettings_ACU();
    const input = {
      settings: defaults,
      snapshot: snapshotAt(4),
      opening: { focus: '焦点', summary: '', dispatchWebResearcher: false },
      hasUnsettledHistory: true,
      beatObligation: false,
      majorTurn: false,
      settledIndex: 6,
      completedStageNumbers: [],
      readCommittedSnapshot: () => snapshotAt(6),
      runAgent: async () => ({
        ok: true,
        summary: '写过又带余量',
        usedFieldWrites: true,
        maintainer: {
          summary: '写过又带余量',
          delta: {
            expectedRevisions: {}, hooks: [{ action: 'upsert', id: 'HX', summary: '余量', status: 'planted', importance: 'mid', plantedIndex: 0, plannedPayoff: '', reason: '' }],
            hookPatches: [], infoGap: [], infoGapPatches: [], storyArc: [], storyArcPatches: [], chronology: [], constraintProposals: [],
          },
        },
        writes: ['hooks'],
        readRevisions: snapshotAt(4).revisions,
      }),
      runComposer: async () => ({ instruction: '写', summary: 's', constraints: null }),
      runFinalReview: async () => ({ verdict: 'pass', summary: 'p', emotionFindings: [], worldFindings: [], logicFindings: [], requiredFixes: [], preserve: [] }),
    };
    await expect(runContinuationAgentWorkflow_ACU(input as any)).rejects.toThrow(/余量/);
  });

  it('运行时交付门：写过+最终带余量时要求模型移入 write_sql，不直接交付余量', async () => {
    const calls: unknown[][] = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        if (calls.length === 1) return writeSqlReply_ACU;
        if (calls.length === 2) return remainderContractReply_ACU;
        // 合规模型：把余量移入 write_sql 后再交空契约。
        if (calls.length === 3) return writeSqlReply_ACU;
        return emptyContractReply_ACU;
      },
    } as any);
    const result = await runtime.run(runtimeInput_ACU({ writeSql: async () => committedReceipt_ACU }));
    // 余量必须被纠错轮消化：多两次模型调用（纠错 + 移入写轮），且交付的最终余量为空。
    expect(calls.length).toBe(4);
    expect(result.usedFieldWrites).toBe(true);
    expect(result.maintainer?.delta.hooks).toEqual([]);
  });

  it('运行时交付门：余量既不移入写轮又不消除时打回重写，不静默丢弃', async () => {
    const calls: unknown[][] = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        if (calls.length === 1) return writeSqlReply_ACU;
        if (calls.length === 2) return remainderContractReply_ACU;
        // 非合规模型：空契约蒙混，余量从未移入写轮。
        return emptyContractReply_ACU;
      },
    } as any);
    await expect(runtime.run(runtimeInput_ACU({ writeSql: async () => committedReceipt_ACU }))).rejects.toThrow(/没有交付契约输出/);
  });
});

describe('必须修2：写轮次预算与上报', () => {
  it('纯写批次不提前触发“未交付契约”：4 写轮 + 最终契约可交付', async () => {
    const calls: unknown[][] = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return calls.length <= 4 ? writeSqlReply_ACU : emptyContractReply_ACU;
      },
    } as any);
    const result = await runtime.run(runtimeInput_ACU({ writeSql: async () => committedReceipt_ACU }));
    expect(result.usedFieldWrites).toBe(true);
    expect(result.maintainer).not.toBeNull();
  });

  it('iterations 如实包含写轮：1 首轮 + 0 读轮 + 4 写轮 = 5', async () => {
    const calls: unknown[][] = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return calls.length <= 4 ? writeSqlReply_ACU : emptyContractReply_ACU;
      },
    } as any);
    const result = await runtime.run(runtimeInput_ACU({ writeSql: async () => committedReceipt_ACU }));
    expect(result.iterations).toBe(5);
  });
});

describe('必须修3：$FIELD 原型链隔离', () => {
  async function fieldContext_ACU() {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    await store.writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: 'b', is_user: false });
    await store.writeAgentModuleFields_ACU(chat, 1, { hooks: { H1: { summary: { value: 's' } } } });
    const folded = store.readAgentModuleSnapshot_ACU(chat);
    return { chat, moduleSnapshot: folded, settledThroughIndex: 0, execution: {}, originInstruction: '' } as any;
  }

  it('原型 id 返回非法地址文案，不返回原型内容', async () => {
    const placeholder = await import('../../../../src/service/continuation/agent/agent-placeholder-resolver');
    const context = await fieldContext_ACU();
    for (const evil of ['$FIELD:hooks:__proto__', '$FIELD:hooks:constructor', '$FIELD:hooks:prototype', `$FIELD:hooks:${'A'.repeat(129)}`]) {
      const out = placeholder.resolveAgentReadToken_ACU(evil, context);
      expect(out.text).toMatch(/非法/);
    }
  });

  it('带栏位原型 id 不抛 TypeError，且整批读取不被拖垮', async () => {
    const placeholder = await import('../../../../src/service/continuation/agent/agent-placeholder-resolver');
    const context = await fieldContext_ACU();
    const single = placeholder.resolveAgentReadToken_ACU('$FIELD:hooks:__proto__:summary', context);
    expect(single.text).toMatch(/非法/);
    const batch = placeholder.renderAgentReadMaterials_ACU(['$FIELD:hooks:__proto__:summary', '$HOOKS_LEDGER'], context);
    expect(batch).toMatch(/非法/);
    expect(batch).toContain('伏笔');
  });
});
