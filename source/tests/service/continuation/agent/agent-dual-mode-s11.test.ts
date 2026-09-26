import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildEmptyAgentModuleSnapshot_ACU,
  readAgentModuleFieldSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-module-store';
import { AGENT_MODULE_FIELD_ACU } from '../../../../src/service/continuation/agent/agent-model';
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
    const calls = parse!('{"action":"write_sql","sql":"UPDATE hooks SET summary = \'x\' WHERE id = \'H1\' AND expected_revision = 0"}', '');
    expect(calls?.some(item => item.kind === 'write_sql')).toBe(true);
  });

  it('逐栏 SQL 意图按角色鉴权并拒绝越权表', async () => {
    const protocol = await import('../../../../src/service/continuation/agent/agent-protocol');
    const parse = (protocol as Record<string, unknown>).parseAgentModuleSqlFieldWrites_ACU as unknown as
      ((sql: string, role: string) => { intents: Array<{ module: string; kind: string }>; rejected: Array<{ path: string }> }) | undefined;
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
    const base = snapshotAt(2);
    const db = await materialize!(base, undefined);
    try {
      db.applyFieldBatch({ module: 'hooks', expectedRevision: 0, updatedAt: 2000, fieldWrites: { H9: { summary: { value: 's' } } } });
      expect(db.readFieldRecord('hooks', 'H9')?.fields.summary.value).toBe('s');
      expect(db.readPartialRecords('hooks').map(item => item.id)).toContain('H9');
      // 深比较锁：逐栏批次必须原样导出 模块→ID→栏目 写集（toBeDefined 曾放行任何非空对象）。
      expect(db.exportDelta().fieldUpserts).toEqual({ hooks: { H9: { summary: { value: 's' } } } });
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
    const folded = (store as Record<string, (chat: unknown[]) => { snapshot: AgentModuleSnapshot_ACU }>)
      .readAgentModuleSnapshot_ACU(chat);
    const out = resolve!('$FIELD:hooks:H1', { chat, moduleSnapshot: folded, settledThroughIndex: 0, execution: {}, originInstruction: '' });
    expect(out.title).toContain('hooks');
  });
});

describe('S11-TT 判别：融合提交（帧/plan 路径，不另起文件）', () => {
  it('commitAgentModuleFieldWrites_ACU 经帧路径持久化逐栏增量并签发回执', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    const commit = (store as Record<string, unknown>).commitAgentModuleFieldWrites_ACU as unknown as
      ((input: Record<string, unknown>) => Promise<{ status: string; accepted: unknown[]; rejected: unknown[]; revisions: unknown }>) | undefined;
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

describe('S11-TT 判别：逐栏顺序补号 / 修订号自动分配 / 批量新行（移植上游 2a8472e+56540c9 TT 子集）', () => {
  async function commitStore() {
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    return (store as Record<string, unknown>).commitAgentModuleFieldWrites_ACU as unknown as
      ((input: { chat: any[]; targetIndex: number; sql: string; role: string }) => Promise<{
        status: string; accepted: Array<{ module: string; id: string; field: string }>; rejected: Array<{ path: string; reason: string }>;
        partials: Array<{ module: string; id: string; missingFields: string[] }> | null; revisions: Record<string, number> | null;
      }>);
  }

  it('INSERT 省略 id 与 expected_revision 时按 STORY-/VOL-/H001 顺序补号、卷状态一起补、修订号自动填', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const commit = await commitStore();
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    await (store as Record<string, (chat: unknown[], index: number, snapshot: AgentModuleSnapshot_ACU) => Promise<void>>)
      .writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: '正文', is_user: false });
    const sql = [
      "INSERT INTO story_arc (title, direction, escalation, withheld) VALUES ('全书', '方向', '台阶', '底牌')",
      "INSERT INTO story_arc (scope, title, direction, escalation, withheld, narrative_role, target_stage_range, target_time_span, progress_ceiling, sustaining_threads, payoff_targets) VALUES ('volume', '卷一', '方向', '台阶', '底牌', 'setup', '{\"min\":6,\"max\":10}', '十日', '到婚礼', '[\"线\"]', '[\"兑现\"]')",
      "INSERT INTO story_arc (title, direction, escalation, withheld, narrative_role, target_stage_range, target_time_span, progress_ceiling, sustaining_threads, payoff_targets) VALUES ('卷二', '方向', '台阶', '底牌', 'development', '{\"min\":6,\"max\":10}', '十日', '到后宅', '[\"线\"]', '[\"兑现\"]')",
    ].join('; ');
    const receipt = await commit({ chat, targetIndex: 1, sql, role: 'arc-architect' });
    expect(receipt.rejected.map(item => `${item.path}:${item.reason}`)).toEqual([]);
    expect(receipt.status).toBe('committed');
    const ids = Object.keys(readAgentModuleFieldSnapshot_ACU(chat).records.storyArc ?? {}).sort();
    expect(ids).toEqual(['STORY-01', 'VOL-01', 'VOL-02']);
    const records = readAgentModuleFieldSnapshot_ACU(chat).records.storyArc ?? {};
    expect(records['VOL-01']?.fields.status.value).toBe('active');
    expect(records['VOL-02']?.fields.status.value).toBe('planned');
    expect(records['STORY-01']?.fields.scope.value).toBe('story');
    const hooks = await commit({ chat, targetIndex: 1, sql: "INSERT INTO hooks (summary) VALUES ('信件')", role: 'hook-cognition-maintainer' });
    expect(hooks.status).toBe('committed');
    expect(Object.keys(readAgentModuleFieldSnapshot_ACU(chat).records.hooks ?? {})).toContain('H001');
    // 省略 expected_revision 的 UPDATE 用当前模块修订号自动补上，能改已有行。
    const renamed = await commit({ chat, targetIndex: 1, sql: "UPDATE story_arc SET title = '新全书' WHERE id = 'STORY-01'", role: 'arc-architect' });
    expect(renamed.rejected.map(item => `${item.path}:${item.reason}`)).toEqual([]);
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.storyArc?.['STORY-01']?.fields.title.value).toBe('新全书');
  });

  it('同一条 SQL 一次写入多条新卷：新行固定 expected 0，不被同批模块修订号打成冲突（56540c9）', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const commit = await commitStore();
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    const base = snapshotAt(0);
    await (store as Record<string, (chat: unknown[], index: number, snapshot: AgentModuleSnapshot_ACU) => Promise<void>>)
      .writeAgentModuleSnapshot_ACU(chat, 0, { ...base, revisions: { ...base.revisions, storyArc: 2 } });
    chat.push({ mes: '正文', is_user: false });
    const insert = [
      "INSERT INTO story_arc (id, scope, title, direction, escalation, status, expected_revision) VALUES ('STORY-01', 'story', '全书', '方向', '台阶', 'active', 0)",
      "INSERT INTO story_arc (id, scope, title, direction, escalation, withheld, status, expected_revision) VALUES ('VOL-01', 'volume', '卷一', '方向', '台阶', '底', 'active', 0)",
      "INSERT INTO story_arc (id, scope, title, direction, escalation, withheld, status, expected_revision) VALUES ('VOL-02', 'volume', '卷二', '方向', '台阶', '底', 'planned', 0)",
    ].join('; ');
    const inserted = await commit({ chat, targetIndex: 1, sql: insert, role: 'arc-architect' });
    expect(inserted.rejected.filter(item => item.reason.includes('revision_conflict'))).toEqual([]);
    expect(inserted.status).toBe('committed');
    const revision = inserted.revisions?.storyArc;
    const update = ['VOL-01', 'VOL-02'].map(id => `UPDATE story_arc SET escalation = '新台阶' WHERE id = '${id}' AND expected_revision = ${revision}`).join('; ');
    const filled = await commit({ chat, targetIndex: 1, sql: update, role: 'arc-architect' });
    expect(filled.rejected.map(item => `${item.path}:${item.reason}`)).toEqual([]);
    expect(filled.status).toBe('committed');
  });

  it('逐栏 SQL 允许省略 expected_revision，非法值仍被拒（解析层）', async () => {
    const protocol = await import('../../../../src/service/continuation/agent/agent-protocol');
    const parse = (protocol as Record<string, unknown>).parseAgentModuleSqlFieldWrites_ACU as unknown as
      ((sql: string, role: string) => { intents: Array<Record<string, unknown>>; rejected: Array<{ path: string; reason: string }> }) | undefined;
    const omitted = parse!("INSERT INTO story_arc (title) VALUES ('全书')", 'arc-architect');
    expect(omitted.rejected).toEqual([]);
    expect(omitted.intents).toHaveLength(1);
    expect(omitted.intents[0]).not.toHaveProperty('expectedRevision');
    const updateNoRev = parse!("UPDATE hooks SET summary = 'x' WHERE id = 'H1'", 'hook-cognition-maintainer');
    expect(updateNoRev.rejected).toEqual([]);
    const negative = parse!("UPDATE hooks SET summary = 'x' WHERE id = 'H1' AND expected_revision = -1", 'hook-cognition-maintainer');
    expect(negative.rejected.some(item => item.reason.includes('非负整数'))).toBe(true);
  });

  it('INSERT 缺 scope 与 status 的草稿，用 UPDATE 补上 scope 时同步补 status（2a8472e UPDATE 路径）', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const commit = await commitStore();
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    await (store as Record<string, (chat: unknown[], index: number, snapshot: AgentModuleSnapshot_ACU) => Promise<void>>)
      .writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: '正文', is_user: false });
    const drafted = await commit({ chat, targetIndex: 1, sql: "INSERT INTO story_arc (id, title, direction, escalation) VALUES ('A1', '卷甲', '方向', '台阶')", role: 'arc-architect' });
    expect(drafted.rejected.map(item => `${item.path}:${item.reason}`)).toEqual([]);
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.storyArc?.['A1']?.fields.status).toBeUndefined();
    const filled = await commit({ chat, targetIndex: 1, sql: "UPDATE story_arc SET scope = 'volume', withheld = '底牌' WHERE id = 'A1'", role: 'arc-architect' });
    expect(filled.rejected.map(item => `${item.path}:${item.reason}`)).toEqual([]);
    const record = readAgentModuleFieldSnapshot_ACU(chat).records.storyArc?.['A1'];
    expect(record?.fields.scope.value).toBe('volume');
    expect(record?.fields.status.value).toBe('active');
  });

  it('字段数不一致的整句错误穿透到逐栏提交入口，并解释引号拆分而非缺字段（9ee4f0f）', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const commit = await commitStore();
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    await (store as Record<string, (chat: unknown[], index: number, snapshot: AgentModuleSnapshot_ACU) => Promise<void>>)
      .writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: '正文', is_user: false });
    const error = await commit({ chat, targetIndex: 1, sql: "INSERT INTO story_arc (id, title, direction, expected_revision) VALUES ('S1', '很好', 3)", role: 'arc-architect' })
      .then(() => null, e => e);
    const message = JSON.stringify((error as Error)?.message ?? error);
    expect(message).toContain('字段数与值数量不一致（4 个字段、3 个值）');
    expect(message).toContain('不是缺 id');
    expect(message).toContain('单引号要写成两个单引号');
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

describe('infoGap 回退自动修复（移植上游 a830de93 前半 TT 子集）', () => {
  async function commitStore() {
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    return (store as Record<string, unknown>).commitAgentModuleFieldWrites_ACU as unknown as
      ((input: { chat: any[]; targetIndex: number; sql: string; role: string }) => Promise<{
        status: string; accepted: Array<{ module: string; id: string; field: string }>; rejected: Array<{ path: string; reason: string }>;
        partials: unknown; revisions: Record<string, number> | null;
      }>);
  }

  it('信息差单独回退未揭示时自动清除旧揭示楼层，显式冲突楼层仍拒绝', async () => {
    const snapshot = { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 1 };
    const chat: any[] = [
      { is_user: false, mes: 'root', [AGENT_MODULE_FIELD_ACU]: snapshot },
      { is_user: false, mes: 'tail' },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const commit = await commitStore();
    const insert = "INSERT INTO info_gap (id, topic, objective_fact, reader_known, character_knowledge, reveal_status) VALUES ('G2', '秘密', '钥匙', '无人知道', '[]', 'unrevealed')";
    expect((await commit({ chat, targetIndex: 1, sql: insert, role: 'hook-cognition-maintainer' })).status).toBe('committed');
    const revealed = await commit({ chat, targetIndex: 1,
      sql: "UPDATE info_gap SET reveal_status = 'revealed', reveal_index = 1 WHERE id = 'G2'",
      role: 'hook-cognition-maintainer',
    });
    expect(revealed.status).toBe('committed');
    const reset = await commit({ chat, targetIndex: 1,
      sql: "UPDATE info_gap SET reveal_status = 'unrevealed' WHERE id = 'G2'",
      role: 'hook-cognition-maintainer',
    });
    expect(reset.status).toBe('committed');
    expect(reset.rejected).toEqual([]);
    const fields = readAgentModuleFieldSnapshot_ACU(chat).records.infoGap?.['G2']?.fields;
    expect(fields?.['revealStatus']?.value).toBe('unrevealed');
    expect(fields?.['revealIndex']?.value).toBeNull();
    const conflict = await commit({ chat, targetIndex: 1,
      sql: "UPDATE info_gap SET reveal_status = 'unrevealed', reveal_index = 1 WHERE id = 'G2'",
      role: 'hook-cognition-maintainer',
    });
    expect(conflict.status).toBe('rejected');
    expect(conflict.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'infoGap#G2.revealStatus' })]));
  });
});
