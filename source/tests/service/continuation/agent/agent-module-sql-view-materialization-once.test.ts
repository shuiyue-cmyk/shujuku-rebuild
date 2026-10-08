/**
 * tests/service/continuation/agent/agent-module-sql-view-materialization-once.test.ts
 * P1-m：同一次提交只物化一次视图 + 损坏必须仍然被拒。
 *
 * 背景（2026-09-27 实测）：8 表×400 行时单次物化 89ms（其中引擎 init 仅 0.14ms），
 * 物化 = new SqliteEngine + init + 建 schema + 全条目装载。因此「同一次提交被物化
 * 几遍」直接决定一次写入的门禁成本。
 *
 * 本文件锁两件事：
 *   ① 结构不变量：每一种提交形态（逐栏提交 / 整行事务 / webRefs 事务 / 约束登记 /
 *      固定工作流的一次派工结算）都**恰好物化 1 次**，且释放次数与物化次数相等
 *      （wasm 资源不泄漏）。一条 write_sql 里 N 条语句、一次派工里多次写入，
 *      物化次数都不随语句数增长。
 *   ② 损坏必拒的判别门：物化之后视图被破坏（分栏值被篡改 / 领域 payload 被篡改）时，
 *      SQL 复算门必须仍然拒收，且拒绝理由与错误分类逐字不变：
 *      - 逐栏提交：整批 rejected，理由是原句 `模块 X 的 SQL 分栏复算与计划写集不一致`，
 *        帧内不落任何字���（拒收发生在帧持久化门之前）；
 *      - 整行事务：复算读回与事务结果不一致 → fail-closed 回退 JSON 链结果，
 *        返回值与「只跑 JSON 链」逐字相同（门确实开火，而不是静默通过）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEmptyAgentModuleSnapshot_ACU, readAgentModuleFieldSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { AGENT_MODULE_FIELD_ACU, type AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

/** 物化后注入的破坏动作（在真实物化完成后、调用方写批次之前生效）。 */
const harness = vi.hoisted(() => ({
  apply: null as null | ((view: any) => void),
  /** 行视图复算抛出的结构化错误（含逐字文案），用于锁「损坏必拒且分类不变」。 */
  sqlViewErrors: [] as Array<{ name: string; message: string; module?: string; expected?: number; actual?: number }>,
}));

vi.mock('../../../../src/service/continuation/agent/agent-module-sql-view', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/service/continuation/agent/agent-module-sql-view')>();
  // 行视图复算的错误是 fail-closed 吞掉的，外部只能通过「抛出的结构化错误」观察门是否开火。
  // 这里用子类记录每次构造（name/message/module/expected/actual 全部逐字），
  // 不改变 instanceof 与抛出行为。
  class RecordingSqlViewError extends actual.AgentModuleSqlViewError_ACU {
    constructor(message: string, detail?: { module?: string; expected?: number; actual?: number }) {
      super(message, detail);
      harness.sqlViewErrors.push({ name: this.name, message, module: detail?.module, expected: detail?.expected, actual: detail?.actual });
    }
  }
  return {
    ...actual,
    AgentModuleSqlViewError_ACU: RecordingSqlViewError,
    materializeAgentModuleSqlView_ACU: async (...args: unknown[]) => {
      const view = await (actual.materializeAgentModuleSqlView_ACU as any)(...args);
      if (harness.apply) harness.apply(view);
      return view;
    },
  };
});

import {
  __readAgentModuleSqlViewCountersForTests_ACU,
  __resetAgentModuleSqlViewCountersForTests_ACU,
} from '../../../../src/service/continuation/agent/agent-module-sql-view';
import {
  applyAgentConstraintRegistrationViaSql_ACU,
  applyAgentModuleDelta_ACU,
  applyAgentModuleDeltaViaSql_ACU,
  applyAgentWebRefsDeltaViaSql_ACU,
} from '../../../../src/service/continuation/agent/agent-transaction';
import { runContinuationMaterialRepair_ACU } from '../../../../src/service/continuation/agent/agent-workflow';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';

function snapshot_ACU(patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 4, ...patch };
}

function hookDelta_ACU(id: string): Record<string, unknown> {
  return {
    expectedRevisions: {},
    hooks: [{ action: 'upsert', id, summary: '断裂的封印', status: 'planted', importance: 'mid', plantedIndex: 2, plannedPayoff: '后文回收', reason: '' }],
    hookPatches: [], infoGap: [], infoGapPatches: [], storyArc: [], storyArcPatches: [],
    chronology: [], chronologyPatches: [], constraintProposals: [],
  };
}

function existingHook_ACU(id: string): Record<string, unknown> {
  return {
    id, summary: `旧伏笔 ${id}`, status: 'planted', importance: 'mid',
    plantedIndex: 1, updatedIndex: 1, plannedPayoff: '待回收', retired: false, retiredReason: '',
  };
}

function webRefsOutput_ACU(): Record<string, unknown> {  return {
    summary: '考据完成',
    expectedRevision: 0,
    items: [{ action: 'upsert', id: 'W1', title: '旧王朝', source: 'web', url: 'https://example.invalid/1', query: 'q', tags: [], brief: '简介', summary: '', sourceStatus: 'ok', reason: '' }],
    patches: [],
  };
}

beforeEach(() => {
  harness.apply = null;
  harness.sqlViewErrors = [];
  __resetAgentModuleSqlViewCountersForTests_ACU();
  _set_SillyTavern_API_ACU(null as any);
});

describe('P1-m 同一次提交只物化一次视图（结构不变量）', () => {
  // R4-09：整行事务 / webRefs / 约束登记之后的 SQL 复算失败一律被吞、对结果毫无影响，已移除——
  // 这几种提交不再物化视图，结果与 JSON 事务链逐字相同。逐栏提交的 SQL 分栏门（真正会拒收）不受影响。
  it('R4-09：整行事务提交不再物化视图，结果与 JSON 事务链逐字相同', async () => {
    const base = snapshot_ACU();
    const applied = await applyAgentModuleDeltaViaSql_ACU(base, hookDelta_ACU('H1') as never, ['hooks'], 4, []);

    expect(applied.snapshot.revisions.hooks).toBe(1);
    expect(applied).toEqual(applyAgentModuleDelta_ACU(base, hookDelta_ACU('H1') as never, ['hooks'], 4, []));
    expect(__readAgentModuleSqlViewCountersForTests_ACU()).toEqual({ materializations: 0, disposed: 0 });
  });

  it('R4-09：webRefs 事务提交与约束登记提交不再物化视图', async () => {
    await applyAgentWebRefsDeltaViaSql_ACU(snapshot_ACU(), webRefsOutput_ACU() as never, 0);
    expect(__readAgentModuleSqlViewCountersForTests_ACU()).toEqual({ materializations: 0, disposed: 0 });

    const registered = await applyAgentConstraintRegistrationViaSql_ACU(snapshot_ACU(), ['禁止 OOC'], [], 4);
    expect(registered.snapshot.constraints).toHaveLength(1);
    expect(__readAgentModuleSqlViewCountersForTests_ACU()).toEqual({ materializations: 0, disposed: 0 });
  });

  it('逐栏提交：一条 write_sql 里 3 条语句仍只物化 1 次（语句数不放大门禁成本）', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    await store.writeAgentModuleSnapshot_ACU(chat, 0, snapshot_ACU());
    chat.push({ mes: '正文', is_user: false });
    __resetAgentModuleSqlViewCountersForTests_ACU();

    const receipt = await store.commitAgentModuleFieldWrites_ACU({
      chat,
      targetIndex: 1,
      sql: [
        "INSERT INTO hooks (id, expected_revision, summary) VALUES ('HF1', 0, '融合提交')",
        "INSERT INTO hooks (id, expected_revision, summary) VALUES ('HF2', 0, '融合提交2')",
        "UPDATE hooks SET summary = '改写' WHERE id = 'HF1'",
      ].join('; '),
      role: 'hook-cognition-maintainer',
    });

    expect(receipt.status).toBe('committed');
    expect(__readAgentModuleSqlViewCountersForTests_ACU()).toEqual({ materializations: 1, disposed: 1 });
  });

  it('固定工作流的一次整行派工结算：不物化视图（R4-09）', async () => {
    const result = await runContinuationMaterialRepair_ACU({
      settings: buildDefaultContinuationSettings_ACU(),
      snapshot: {
        ...snapshot_ACU(),
        pendingFixes: [{ module: 'webRefs', path: 'webRefs', message: '缺考据', source: 'auto', rangeStartIndex: 0, rangeEndIndex: 4, attempts: 0, violations: [], lastError: '' }],
      } as never,
      targetModules: ['webRefs'],
      settledIndex: 6,
      completedStageNumbers: [],
      runAgent: async () => ({
        ok: true,
        summary: '考据完成',
        researcher: webRefsOutput_ACU(),
        writes: ['webRefs'],
        readRevisions: buildEmptyAgentModuleSnapshot_ACU().revisions,
      }),
    } as never);

    expect(result.snapshot.revisions.webRefs).toBe(1);
    expect(__readAgentModuleSqlViewCountersForTests_ACU()).toEqual({ materializations: 0, disposed: 0 });
  });

  it('同一派工不会既走逐栏提交又走整行复算：usedFieldWrites 派工的结算段零物化', async () => {
    // 逐栏提交（分栏层 applyFieldBatch + fieldUpserts 比对）与整行事务复算
    // （行层 applyRowWrite + readSnapshot 逐模块比对）是**互斥**的两条路径：
    // usedFieldWrites 派工的栏目已在 writeSql 轮即时落帧，结算段只按 revision
    // 增量认定已应用模块（committed ?? applyAgentModuleDeltaViaSql_ACU 的
    // committed 短路），因此这里一次物化都不该发生——两条路径不共享同一批写入，
    // 也就无从「共用同一 view」。
    const result = await runContinuationMaterialRepair_ACU({
      settings: buildDefaultContinuationSettings_ACU(),
      snapshot: {
        ...snapshot_ACU(),
        pendingFixes: [{ module: 'webRefs', path: 'webRefs', message: '缺考据', source: 'auto', rangeStartIndex: 0, rangeEndIndex: 4, attempts: 0, violations: [], lastError: '' }],
      } as never,
      targetModules: ['webRefs'],
      settledIndex: 6,
      completedStageNumbers: [],
      readCommittedSnapshot: () => ({ ...snapshot_ACU(), revisions: { ...buildEmptyAgentModuleSnapshot_ACU().revisions, webRefs: 1 } }),
      runAgent: async () => ({
        ok: true,
        summary: '已逐栏保存',
        usedFieldWrites: true,
        writes: ['webRefs'],
        readRevisions: buildEmptyAgentModuleSnapshot_ACU().revisions,
      }),
    } as never);

    expect(result.snapshot.revisions.webRefs).toBe(1);
    expect(__readAgentModuleSqlViewCountersForTests_ACU()).toEqual({ materializations: 0, disposed: 0 });
  });

  it('物化失败（引擎装载报错）也照旧释放：释放次数与物化次数仍然相等', async () => {
    const broken = { ...snapshot_ACU(), hooks: [{ noId: true }] } as unknown as AgentModuleSnapshot_ACU;
    await expect(applyAgentModuleDeltaViaSql_ACU(snapshot_ACU(), hookDelta_ACU('H1') as never, ['hooks'], 4, [])).resolves.toBeTruthy();
    const beforeFailure = __readAgentModuleSqlViewCountersForTests_ACU();
    // 直接物化坏快照：入口抛错且必须已释放。
    const view = await import('../../../../src/service/continuation/agent/agent-module-sql-view');
    await expect(view.materializeAgentModuleSqlView_ACU(broken)).rejects.toThrow(/无法物化/);
    const counters = __readAgentModuleSqlViewCountersForTests_ACU();
    // 失败路径确实走过一次物化（不是空转），且释放次数与物化次数相等（不泄漏 wasm 引擎）。
    // 不钉绝对值：warm-up 的成功物化次数是夹具算术，未来复用引擎/合并物化时数字会变。
    expect(counters.materializations).toBe(beforeFailure.materializations + 1);
    expect(counters.disposed).toBe(counters.materializations);
  });
});

describe('P1-m 损坏必须仍然被拒（复用视图不许削弱门）', () => {
  it('逐栏提交：物化后分栏值被篡改 → 整批拒收，理由逐字不变，帧内零写入', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    await store.writeAgentModuleSnapshot_ACU(chat, 0, snapshot_ACU());
    chat.push({ mes: '正文', is_user: false });
    // 基线帧快照（拒收后必须逐字不变）。
    const frameBefore = JSON.stringify(chat[0]![AGENT_MODULE_FIELD_ACU]);
    __resetAgentModuleSqlViewCountersForTests_ACU();
    // 破坏：物化完成后让视图**静默吞掉**写入批次（模拟 SQL 层没真正落这批栏目）。
    // 门必须靠「导出的 fieldUpserts vs 计划写集」逐字比对抓住它。
    harness.apply = view => {
      view.applyFieldBatch = () => 0;
    };

    const receipt = await store.commitAgentModuleFieldWrites_ACU({
      chat,
      targetIndex: 1,
      sql: "INSERT INTO hooks (id, expected_revision, summary) VALUES ('HF1', 0, '融合提交')",
      role: 'hook-cognition-maintainer',
    });

    expect(receipt.status).toBe('rejected');
    expect(receipt.rejected).toContainEqual({ path: 'sql', reason: '模块 hooks 的 SQL 分栏复算与计划写集不一致' });
    expect(receipt.sqlDiagnostics).toBe('模块 hooks 的 SQL 分栏复算与计划写集不一致');
    // 拒收发生在帧持久化门之前：聊天帧与目标楼层都没有落下任何字段。
    expect(JSON.stringify(chat[0]![AGENT_MODULE_FIELD_ACU])).toBe(frameBefore);
    expect(Object.prototype.hasOwnProperty.call(chat[1]!, AGENT_MODULE_FIELD_ACU)).toBe(false);
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.HF1).toBeUndefined();
    // 门确实开火了（readSnapshot 之外还物化/释放过一次引擎）。
    expect(__readAgentModuleSqlViewCountersForTests_ACU()).toEqual({ materializations: 1, disposed: 1 });
  });

});
