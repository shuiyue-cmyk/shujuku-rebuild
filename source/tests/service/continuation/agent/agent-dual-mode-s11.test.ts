import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildEmptyAgentModuleSnapshot_ACU,
  readAgentModuleFieldSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-module-store';
import type { AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

/**
 * S11 双模生命周期 TT 判别测试（移植上游 fe3f7bc TT 子集，按本地脚手架重写）：
 * dual-mode 在 TT 下的含义——Mode R 整条领域行提交（既有 ViaSql 整行事务）与
 * Mode F 逐栏即时提交（write_sql 受控端口 → 帧内 fieldUpserts 增量，不做领域提升）。
 * 两种模式共用同一帧/指纹/乐观锁/证据门持久化路径，不另起写旁路。
 * 先全部判红，再逐项落码。
 */

function snapshotAt(settledThroughIndex: number, patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex, ...patch };
}

beforeEach(() => {
  _set_SillyTavern_API_ACU(null as any);
});

describe('S11-TT 判别：write_sql 协议解析', () => {
  it('可写工具解析器提取 write_sql 动作', async () => {
    const protocol = await import('../../../../src/service/continuation/agent/agent-protocol');
    const parse = (protocol as Record<string, unknown>).parseAgentWritableToolCalls_ACU as unknown as
      ((raw: string, prefill: string) => Array<{ kind: string; sql?: string }> | null) | undefined;
    expect(typeof parse).toBe('function');
    const calls = parse!('{"action":"write_sql","sql":"UPDATE hooks SET summary = \'x\' WHERE id = \'H1\' AND expected_revision = 0"}', '');
    expect(calls?.some(item => item.kind === 'write_sql')).toBe(true);
  });

  it('逐栏 SQL 意图按角色鉴权并拒绝越权表', async () => {
    const protocol = await import('../../../../src/service/continuation/agent/agent-protocol');
    const parse = (protocol as Record<string, unknown>).parseAgentModuleSqlFieldWrites_ACU as unknown as
      ((sql: string, role: string) => { intents: Array<{ module: string; kind: string }>; rejected: Array<{ path: string }> }) | undefined;
    expect(typeof parse).toBe('function');
    const ok = parse!("INSERT INTO hooks (id, expected_revision, summary) VALUES ('H1', 0, 's')", 'hook-cognition-maintainer');
    expect(ok.intents.length).toBe(1);
    expect(ok.intents[0].module).toBe('hooks');
    const denied = parse!("INSERT INTO hooks (id, expected_revision, summary) VALUES ('H1', 0, 's')", 'arc-architect');
    expect(denied.intents.length).toBe(0);
    expect(denied.rejected.length).toBeGreaterThan(0);
  });
});

describe('S11-TT 判别：栏级修补事务', () => {
  it('年代学 patch 只改指定栏目并守证据门', async () => {
    const transaction = await import('../../../../src/service/continuation/agent/agent-transaction');
    const apply = (transaction as Record<string, unknown>).applyAgentModuleDelta_ACU as unknown as
      ((snapshot: AgentModuleSnapshot_ACU, delta: Record<string, unknown>, modules: readonly string[], settled: number) => { snapshot: AgentModuleSnapshot_ACU }) | undefined;
    expect(typeof apply).toBe('function');
    const base = snapshotAt(3, {
      chronology: [{ id: 'C1', anchor: '旧锚', elapsed: '三天', precision: 'exact', transition: '转场', evidenceIndexes: [1], updatedIndex: 1, retired: false, retiredReason: '' } as never],
    });
    const next = apply!(base, {
      expectedRevisions: { chronology: 0 },
      hooks: [], hookPatches: [], infoGap: [], infoGapPatches: [],
      storyArc: [], storyArcPatches: [], chronology: [], chronologyPatches: [{ id: 'C1', anchor: '新锚' }],
      constraintProposals: [],
    }, ['chronology'], 3);
    expect(next.snapshot.chronology.find(item => item.id === 'C1')?.anchor).toBe('新锚');
  });

  it('百科 patch 只改内容栏，换源需回填', async () => {
    const transaction = await import('../../../../src/service/continuation/agent/agent-transaction');
    const apply = (transaction as Record<string, unknown>).applyAgentWebRefsDelta_ACU as unknown as
      ((snapshot: AgentModuleSnapshot_ACU, output: Record<string, unknown>, expected: number | undefined, now: number) => { snapshot: AgentModuleSnapshot_ACU }) | undefined;
    expect(typeof apply).toBe('function');
    const base = snapshotAt(3, {
      webRefs: [{ id: 'W1', title: '旧名', source: 'web', url: 'https://example.com/1', query: 'q', tags: [], brief: '旧简介', summary: '', sourceStatus: 'ok', fetchedAt: 1, retired: false, retiredReason: '' } as never],
    });
    const next = apply!(base, { summary: '', expectedRevision: 0, items: [], patches: [{ id: 'W1', brief: '新简介' }] }, 0, 999);
    expect(next.snapshot.webRefs.find(item => item.id === 'W1')?.brief).toBe('新简介');
  });
});

describe('S11-TT 判别：帧内逐栏写集严格校验', () => {
  it('结构损坏的 fieldUpserts 返回 null（整条不可折叠判损）', async () => {
    const frame = await import('../../../../src/service/continuation/agent/agent-module-frame');
    const parse = (frame as Record<string, unknown>).parseAgentModuleFieldUpserts_ACU as unknown as
      ((raw: unknown) => Record<string, unknown> | null) | undefined;
    expect(typeof parse).toBe('function');
    expect(parse!({ hooks: { H1: { summary: { value: 's' } } } })).not.toBeNull();
    expect(parse!({ hooks: [] })).toBeNull();
  });
});

describe('S11-TT 判别：SQL 分栏层复算', () => {
  it('applyFieldBatch 落栏后可读回单条记录与 partial 清单，exportDelta 带 fieldUpserts', async () => {
    const view = await import('../../../../src/service/continuation/agent/agent-module-sql-view');
    const materialize = (view as Record<string, unknown>).materializeAgentModuleSqlView_ACU as unknown as
      ((snapshot: AgentModuleSnapshot_ACU, fields?: unknown) => Promise<{
        applyFieldBatch: (batch: Record<string, unknown>) => number;
        readFieldRecord: (module: string, id: string) => { id: string; fields: Record<string, { value: unknown }> } | null;
        readPartialRecords: (module?: string) => Array<{ id: string }>;
        exportDelta: () => { fieldUpserts?: unknown };
        dispose: () => void;
      }>) | undefined;
    expect(typeof materialize).toBe('function');
    const base = snapshotAt(2);
    const db = await materialize!(base, undefined);
    try {
      db.applyFieldBatch({ module: 'hooks', expectedRevision: 0, updatedAt: 2000, fieldWrites: { H9: { summary: { value: 's' } } } });
      expect(db.readFieldRecord('hooks', 'H9')?.fields.summary.value).toBe('s');
      expect(db.readPartialRecords('hooks').map(item => item.id)).toContain('H9');
      expect(db.exportDelta().fieldUpserts).toBeDefined();
    } finally {
      db.dispose();
    }
  });
});

describe('S11-TT 判别：$FIELD 权威读取与证据楼层', () => {
  it('$FIELD:模块:ID 可读出栏目状态与 revision', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    await (store as Record<string, (chat: unknown[], index: number, snapshot: AgentModuleSnapshot_ACU) => Promise<void>>)
      .writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: 'b', is_user: false });
    await (store as Record<string, (chat: unknown[], index: number, upserts: unknown) => Promise<boolean>>)
      .writeAgentModuleFields_ACU(chat, 1, { hooks: { H1: { summary: { value: 's' } } } });
    const placeholder = await import('../../../../src/service/continuation/agent/agent-placeholder-resolver');
    const resolve = (placeholder as Record<string, unknown>).resolveAgentReadToken_ACU as unknown as
      ((token: string, context: Record<string, unknown>) => { title: string; text: string }) | undefined;
    expect(typeof resolve).toBe('function');
    const folded = (store as Record<string, (chat: unknown[]) => { snapshot: AgentModuleSnapshot_ACU }>)
      .readAgentModuleSnapshot_ACU(chat);
    const out = resolve!('$FIELD:hooks:H1', { chat, moduleSnapshot: folded, settledThroughIndex: 0, execution: {}, originInstruction: '' });
    expect(out.title).toContain('hooks');
    expect(typeof (placeholder as Record<string, unknown>).agentStoryEvidenceFloorIndexes_ACU).toBe('function');
  });
});

describe('S11-TT 判别：融合提交（帧/plan 路径，不另起文件）', () => {
  it('commitAgentModuleFieldWrites_ACU 经帧路径持久化逐栏增量并签发回执', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    const commit = (store as Record<string, unknown>).commitAgentModuleFieldWrites_ACU as unknown as
      ((input: Record<string, unknown>) => Promise<{ status: string; accepted: unknown[]; rejected: unknown[]; revisions: unknown }>) | undefined;
    expect(typeof commit).toBe('function');
    await (store as Record<string, (chat: unknown[], index: number, snapshot: AgentModuleSnapshot_ACU) => Promise<void>>)
      .writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: '正文', is_user: false });
    const receipt = await commit!({
      chat,
      targetIndex: 1,
      sql: "INSERT INTO hooks (id, expected_revision, summary) VALUES ('HF1', 0, '融合提交')",
      role: 'hook-cognition-maintainer',
    });
    expect(receipt.status).toBe('committed');
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.HF1?.fields.summary.value).toBe('融合提交');
  });
});

describe('S11-TT 判别：工作流 usedFieldWrites 免重复覆盖', () => {
  it('已即时保存的栏目不再走旧最终写集覆盖，可读回提交后快照', async () => {
    const workflow = await import('../../../../src/service/continuation/agent/agent-workflow');
    const { runContinuationAgentWorkflow_ACU } = workflow as unknown as {
      runContinuationAgentWorkflow_ACU: (input: Record<string, unknown>) => Promise<{ snapshot: AgentModuleSnapshot_ACU }>;
    };
    const defaults = await import('../../../../src/service/continuation/defaults');
    const committed = snapshotAt(6, { hooks: [{ id: 'HC', summary: '已保存', status: 'planted', importance: 'mid', plantedIndex: 1, updatedIndex: 1, plannedPayoff: '', retired: false, retiredReason: '' } as never] });
    let reread = 0;
    const result = await runContinuationAgentWorkflow_ACU({
      settings: (defaults as Record<string, () => unknown>).buildDefaultContinuationSettings_ACU(),
      snapshot: snapshotAt(4),
      opening: { focus: '焦点', summary: '', dispatchWebResearcher: false },
      hasUnsettledHistory: true,
      beatObligation: false,
      majorTurn: false,
      settledIndex: 6,
      completedStageNumbers: [],
      readCommittedSnapshot: () => { reread += 1; return committed; },
      runAgent: async (call: { agentName: string }) => {
        if (call.agentName === 'hook-cognition-maintainer') {
          return {
            ok: true, summary: '已即时保存', usedFieldWrites: true,
            maintainer: { summary: '已即时保存', delta: { expectedRevisions: {}, hooks: [], hookPatches: [], infoGap: [], infoGapPatches: [], storyArc: [], storyArcPatches: [], chronology: [], constraintProposals: [] } },
            writes: ['hooks'], readRevisions: snapshotAt(4).revisions,
          };
        }
        return { ok: true, summary: call.agentName };
      },
      runComposer: async () => ({ instruction: '写', summary: 's', constraints: null }),
      runFinalReview: async () => ({ verdict: 'pass', summary: 'p', emotionFindings: [], worldFindings: [], logicFindings: [], requiredFixes: [], preserve: [] }),
    });
    expect(reread).toBeGreaterThan(0);
    expect(result.snapshot.hooks.map(item => item.id)).toContain('HC');
  });
});
