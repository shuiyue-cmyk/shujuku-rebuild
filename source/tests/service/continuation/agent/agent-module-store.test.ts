import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  alignAgentModuleSnapshotToFloor_ACU,
  buildEmptyAgentModuleSnapshot_ACU,
  commitAgentModuleFieldWrites_ACU,
  readAgentModuleSnapshot_ACU,
  readAgentModuleFieldSnapshot_ACU,
  readAgentModuleSnapshotDiagnostics_ACU,
  refreshAgentModuleSnapshotChatPrefix_ACU,
  replaceAgentModuleSnapshotByUser_ACU,
  renderAgentActiveVolumePlanningContext_ACU,
  renderAgentChronology_ACU,
  renderAgentChronologyByIds_ACU,
  renderAgentConstraints_ACU,
  renderAgentHooksLedger_ACU,
  renderAgentInfoGap_ACU,
  validateAgentModuleSnapshot_ACU,
  writeAgentModuleSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-module-store';
import { AGENT_BLOCK_CHAR_LIMIT_ACU, AGENT_HOT_HOOK_LIMIT_ACU, AGENT_MODULE_FIELD_ACU, AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU, AGENT_MODULE_SCHEMA_VERSION_ACU, AGENT_MODULE_SCHEMA_VERSION_V2_ACU, type AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import { ContinuationValidationError_ACU } from '../../../../src/service/continuation/model';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

function snapshotAt_ACU(settledThroughIndex: number, patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex, ...patch };
}

function hook_ACU(id: string, patch: Record<string, unknown> = {}) {
  return { id, summary: `伏笔 ${id}`, status: 'planted', importance: 'mid', plantedIndex: 3, updatedIndex: 3, plannedPayoff: '', retired: false, retiredReason: '', ...patch };
}

beforeEach(() => {
  _set_SillyTavern_API_ACU(null as any);
});

describe('Agent 资料快照存储', () => {
  it('从尾向前取最近的合法快照，跳过被污染的楼层', () => {
    const chat: any[] = [
      { mes: 'a', [AGENT_MODULE_FIELD_ACU]: snapshotAt_ACU(0, { revisions: { hooks: 1, infoGap: 0, constraints: 0 } }) },
      { mes: 'b' },
      { mes: 'c', [AGENT_MODULE_FIELD_ACU]: { schemaVersion: 99, settledThroughIndex: 2 } },
    ];

    const snapshot = readAgentModuleSnapshot_ACU(chat);
    expect(snapshot.settledThroughIndex).toBe(0);
    expect(snapshot.revisions.hooks).toBe(1);
  });

  it('聊天里没有任何快照时返回未结算的空快照', () => {
    expect(readAgentModuleSnapshot_ACU([{ mes: 'a' }]).settledThroughIndex).toBe(-1);
  });

  it('读取不再把基线里的水位钳到当前数组长度', () => {
    const chat: any[] = [{ mes: 'a', [AGENT_MODULE_FIELD_ACU]: snapshotAt_ACU(9) }];
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(9);
    expect(chat[0][AGENT_MODULE_FIELD_ACU].schemaVersion).toBe(AGENT_MODULE_SCHEMA_VERSION_ACU);
  });

  it('schema v1 缺 pendingFixes 时内存归一为空数组并升到当前版本，非法队列则拒绝', () => {
    const legacy = {
      schemaVersion: 1, settledThroughIndex: 2, updatedAt: 1,
      revisions: { hooks: 1, infoGap: 0, constraints: 0, storyArc: 0, chronology: 0, webRefs: 0 },
      hooks: [hook_ACU('H1')], infoGap: [], constraints: [],
    };
    const loaded = validateAgentModuleSnapshot_ACU(legacy);
    expect(loaded!.schemaVersion).toBe(AGENT_MODULE_SCHEMA_VERSION_ACU);
    expect(loaded!.pendingFixes).toEqual([]);
    expect(loaded!.materialCompletion.state).toBe('legacy_unknown');
    expect(loaded!.hooks).toHaveLength(1);
    const current = validateAgentModuleSnapshot_ACU({ ...legacy, schemaVersion: AGENT_MODULE_SCHEMA_VERSION_V2_ACU, pendingFixes: [] });
    expect(current!.pendingFixes).toEqual([]);
    expect(current!.materialCompletion.state).toBe('legacy_unknown');
    expect(validateAgentModuleSnapshot_ACU({ ...legacy, schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU, pendingFixes: '坏掉了' })).toBeNull();
    // v4 要求结构化缺口字段：旧 5 字段形态在 v4 下非法（fail-closed），v2 下兼容为 transaction_rejected/failed。
    expect(validateAgentModuleSnapshot_ACU({
      ...legacy,
      schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
      materialCompletion: { state: 'failed', rangeStartIndex: 2, rangeEndIndex: 2, modules: { hooks: 'failed' }, updatedAt: 1 },
      pendingFixes: [{ module: 'hooks', agentName: 'hook-cognition-maintainer', violations: [{ path: 'hooks', message: 'title 不能为空' }], attempts: 1, firstFailedAtIndex: 2, lastError: 'title 不能为空' }],
    })).toBeNull();
    expect(validateAgentModuleSnapshot_ACU({
      ...legacy,
      schemaVersion: AGENT_MODULE_SCHEMA_VERSION_V2_ACU,
      pendingFixes: [{ module: 'hooks', agentName: 'hook-cognition-maintainer', violations: [{ path: 'hooks', message: 'title 不能为空' }], attempts: 1, firstFailedAtIndex: 2, lastError: 'title 不能为空' }],
    })!.pendingFixes).toHaveLength(1);
    const chat: any[] = [{ mes: 'a', [AGENT_MODULE_FIELD_ACU]: legacy }];
    expect(readAgentModuleSnapshot_ACU(chat).pendingFixes).toEqual([]);
    expect(readAgentModuleSnapshot_ACU(chat).schemaVersion).toBe(AGENT_MODULE_SCHEMA_VERSION_ACU);
    expect(chat[0][AGENT_MODULE_FIELD_ACU].schemaVersion).toBe(1);
  });

  it('空快照自带空用户要求清单及其修订号', () => {
    const empty = buildEmptyAgentModuleSnapshot_ACU();
    expect(empty.userRequirements).toEqual([]);
    expect(empty.revisions.userRequirements).toBe(0);
  });

  it('追溯边界缺字段兼容为无；出现就必须整体合法（移植上游 365dd863）', () => {
    const legacy = {
      schemaVersion: 1, settledThroughIndex: 2, updatedAt: 1,
      revisions: { hooks: 1, infoGap: 0, constraints: 0, storyArc: 0, chronology: 0, webRefs: 0 },
      hooks: [], infoGap: [], constraints: [],
    };
    expect(validateAgentModuleSnapshot_ACU(legacy)!.settlementBoundary).toBeUndefined();
    const boundary = {
      startIndex: 7, reason: '用户要求从第 7 楼开始', userMessageId: 3, updatedAt: 1, skippedPendingFixes: [],
    };
    expect(validateAgentModuleSnapshot_ACU({ ...legacy, settlementBoundary: boundary })!.settlementBoundary).toMatchObject({ startIndex: 7 });
    expect(validateAgentModuleSnapshot_ACU({ ...legacy, settlementBoundary: { ...boundary, reason: '  ' } })).toBeNull();
    expect(validateAgentModuleSnapshot_ACU({ ...legacy, settlementBoundary: { ...boundary, userMessageId: 0 } })).toBeNull();
  });

  it('旧快照缺 userRequirements 时兼容为空清单；字段一旦出现就必须整体合法', () => {
    const legacy = {
      schemaVersion: 1, settledThroughIndex: 2, updatedAt: 1,
      revisions: { hooks: 1, infoGap: 0, constraints: 0, storyArc: 0 },
      hooks: [hook_ACU('H1')], infoGap: [], constraints: [],
    };
    const loaded = validateAgentModuleSnapshot_ACU(legacy);
    expect(loaded!.userRequirements).toEqual([]);
    expect(loaded!.revisions.userRequirements).toBe(0);
    expect(loaded!.hooks).toHaveLength(1);
    expect(validateAgentModuleSnapshot_ACU({ ...legacy, userRequirements: [''] })).toBeNull();
    expect(validateAgentModuleSnapshot_ACU({ ...legacy, userRequirements: [1] })).toBeNull();
    expect(validateAgentModuleSnapshot_ACU({ ...legacy, userRequirements: '不是数组' })).toBeNull();
    expect(validateAgentModuleSnapshot_ACU({ ...legacy, userRequirements: ['不要提前揭底牌', '用第一人称'] })!.userRequirements).toEqual(['不要提前揭底牌', '用第一人称']);
  });

  it('水位之前删除中间楼层时不复用旧快照，按前缀失配安全回退', async () => {
    const chat: any[] = [{ mes: 'a' }, { mes: 'b' }, { mes: 'c' }, { mes: 'd' }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);
    await writeAgentModuleSnapshot_ACU(chat, 3, snapshotAt_ACU(3, { hooks: [hook_ACU('H1') as any] }));

    chat.splice(1, 1);

    expect(readAgentModuleSnapshot_ACU(chat).hooks).toEqual([]);
  });

  it('未揭示条目携带揭示楼层时读取阶段就把楼层清空', () => {
    const validated = validateAgentModuleSnapshot_ACU({
      schemaVersion: 1,
      settledThroughIndex: 2,
      updatedAt: 1,
      revisions: { hooks: 0, infoGap: 1, constraints: 0 },
      hooks: [],
      infoGap: [{ id: 'E1', topic: '幕后身份', revealStatus: 'unrevealed', revealIndex: 7, characterKnowledge: [] }],
      constraints: [],
    });

    expect(validated!.infoGap[0].revealIndex).toBeNull();
  });

  it('旧总纲缺少 P2 字段仍兼容读取，已出现但损坏的 P2 字段拒绝整份快照', () => {
    const base = {
      schemaVersion: 1, settledThroughIndex: 2, updatedAt: 1,
      revisions: { hooks: 0, infoGap: 0, constraints: 0, storyArc: 1 },
      hooks: [], infoGap: [], constraints: [],
      storyArc: [{
        id: 'VOL-01', scope: 'volume', title: '旧卷', direction: '推进旧主线', escalation: '收在旧卷结点', withheld: '', status: 'active', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '',
      }],
    };

    const compatible = validateAgentModuleSnapshot_ACU(base);
    expect(compatible!.storyArc[0]).toMatchObject({ id: 'VOL-01', narrativeRole: undefined, targetStageRange: undefined });
    expect(validateAgentModuleSnapshot_ACU({
      ...base,
      storyArc: [{ ...base.storyArc[0], targetStageRange: { min: 6, max: 4 } }],
    })).toBeNull();
  });

  it('storyArc 已出现但不是数组时整份快照非法，并回退到上一份合法快照', () => {
    const story = { id: 'VOL-01', scope: 'volume', title: '卷一', direction: 'd', escalation: 'e', withheld: '', status: 'active', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '' };
    const good = snapshotAt_ACU(0, { revisions: { hooks: 0, infoGap: 0, constraints: 0, storyArc: 1, chronology: 0, webRefs: 0 }, storyArc: [story] as any });
    const malformed = { ...good, settledThroughIndex: 1, storyArc: '不是数组' };

    expect(validateAgentModuleSnapshot_ACU(malformed)).toBeNull();
    const chat: any[] = [
      { mes: 'a', [AGENT_MODULE_FIELD_ACU]: good },
      { mes: 'b', [AGENT_MODULE_FIELD_ACU]: malformed },
    ];
    expect(readAgentModuleSnapshot_ACU(chat).storyArc).toEqual([expect.objectContaining({ id: 'VOL-01' })]);
  });

  it('空快照初始化 chronology 为空账本且 revision 为 0', () => {
    const empty = buildEmptyAgentModuleSnapshot_ACU();
    expect(empty.chronology).toEqual([]);
    expect(empty.revisions.chronology).toBe(0);
  });

  it('旧快照缺 chronology 与其 revision 时兼容读成空账本，不误报数据丢失', () => {
    const legacy = validateAgentModuleSnapshot_ACU({
      schemaVersion: 1, settledThroughIndex: 2, updatedAt: 1,
      revisions: { hooks: 1, infoGap: 0, constraints: 0, storyArc: 0 },
      hooks: [hook_ACU('H1')], infoGap: [], constraints: [],
    });

    expect(legacy!.chronology).toEqual([]);
    expect(legacy!.revisions.chronology).toBe(0);
    expect(legacy!.hooks).toHaveLength(1);
  });

  it('合法 chronology 保真读取；已出现但非法的 chronology 使整份快照回退', () => {
    const entry = { id: 'T1', anchor: '入城后的第七天', elapsed: '自开篇约十七日', precision: 'approximate', transition: '在临川城休整七日', evidenceIndexes: [5, 4, 5], updatedIndex: 5, retired: false, retiredReason: '' };
    const base = {
      schemaVersion: 1, settledThroughIndex: 5, updatedAt: 1,
      revisions: { hooks: 0, infoGap: 0, constraints: 0, storyArc: 0, chronology: 2 },
      hooks: [], infoGap: [], constraints: [], chronology: [entry],
    };

    const validated = validateAgentModuleSnapshot_ACU(base);
    expect(validated!.chronology[0]).toMatchObject({ id: 'T1', precision: 'approximate', evidenceIndexes: [4, 5], updatedIndex: 5 });
    expect(validated!.revisions.chronology).toBe(2);

    // 字段一旦出现就必须整体合法：坏条目不做静默过滤，而是让读取端回退上一份合法快照。
    expect(validateAgentModuleSnapshot_ACU({ ...base, chronology: '不是数组' })).toBeNull();
    expect(validateAgentModuleSnapshot_ACU({ ...base, chronology: [{ ...entry, precision: '大概' }] })).toBeNull();
    expect(validateAgentModuleSnapshot_ACU({ ...base, chronology: [{ ...entry, evidenceIndexes: [] }] })).toBeNull();
    expect(validateAgentModuleSnapshot_ACU({ ...base, chronology: [{ ...entry, anchor: '' }] })).toBeNull();
    expect(validateAgentModuleSnapshot_ACU({ ...base, chronology: [{ ...entry, retired: true, retiredReason: '' }] })).toBeNull();

    // 读取端行为：末楼快照的 chronology 损坏时回退到更早的合法快照。
    const good = { ...base, settledThroughIndex: 0 };
    const chat: any[] = [
      { mes: 'a', [AGENT_MODULE_FIELD_ACU]: good },
      { mes: 'b', [AGENT_MODULE_FIELD_ACU]: { ...base, chronology: [{ ...entry, precision: '大概' }] } },
    ];
    expect(readAgentModuleSnapshot_ACU(chat).revisions.chronology).toBe(2);
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(0);
  });

  it('全程没有合法快照但存在损坏快照时，按宽容模式抢救而不是静默返回空，并留下诊断', () => {
    const entry = { id: 'T1', anchor: '入城后的第七天', elapsed: '自开篇约十七日', precision: 'approximate', transition: '休整七日', evidenceIndexes: [1], updatedIndex: 1, retired: false, retiredReason: '' };
    const broken = {
      schemaVersion: 1, settledThroughIndex: 1, updatedAt: 1,
      revisions: { hooks: 1, infoGap: 0, constraints: 0, storyArc: 1, chronology: 1 },
      hooks: [hook_ACU('H1')], infoGap: [], constraints: [],
      storyArc: [{ id: 'VOL-01', scope: 'volume', title: '卷一', direction: 'd', escalation: 'e', withheld: '', status: 'active', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '', targetStageRange: { min: 6, max: 4 } }],
      chronology: [entry, { ...entry, id: 'T2', precision: '大概' }],
    };
    const chat: any[] = [{ mes: 'a' }, { mes: 'b', [AGENT_MODULE_FIELD_ACU]: broken }];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const snapshot = readAgentModuleSnapshot_ACU(chat);
    warn.mockRestore();
    // 合法条目保住，坏条目丢弃。
    expect(snapshot.hooks).toHaveLength(1);
    expect(snapshot.chronology.map(item => item.id)).toEqual(['T1']);
    expect(snapshot.storyArc).toEqual([]);
    expect(snapshot.settledThroughIndex).toBe(1);
    const diagnostics = readAgentModuleSnapshotDiagnostics_ACU();
    expect(diagnostics).toMatchObject({ adoptedIndex: 1, salvaged: true });
    expect(diagnostics.candidates[0].problems.join('；')).toContain('storyArc[0]');
    expect(diagnostics.candidates[0].problems.join('；')).toContain('chronology[1]');

    // 有合法快照时诊断记录采用楼层且不标记抢救。
    const chatOk: any[] = [{ mes: 'a', [AGENT_MODULE_FIELD_ACU]: snapshotAt_ACU(0) }];
    readAgentModuleSnapshot_ACU(chatOk);
    expect(readAgentModuleSnapshotDiagnostics_ACU()).toEqual({
      candidates: [{ index: 0, valid: true, problems: [] }],
      adoptedIndex: 0,
      salvaged: false,
      checkpointIndex: 0,
      foldedDeltaCount: 0,
    });
    readAgentModuleSnapshot_ACU([{ mes: 'a' }]);
    expect(readAgentModuleSnapshotDiagnostics_ACU().adoptedIndex).toBeNull();
  });

  it('写盘保留快照自带的水位（钳制在 0 与目标楼层之间），不再自动顶到目标楼层', async () => {
    const chat: any[] = [{ mes: 'a' }, { mes: 'b' }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);

    // 水位只由结算子代理成功交付时显式推进：写盘时快照声明多少就是多少。
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt_ACU(0, { hooks: [hook_ACU('H1') as any] }));
    expect(saveChat).toHaveBeenCalledOnce();
    expect(chat[1][AGENT_MODULE_FIELD_ACU].schemaVersion).toBe(3);
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(0);
    expect(readAgentModuleSnapshot_ACU(chat).hooks).toHaveLength(1);

    // 显式声明的水位如实进入折叠；越界声明（超过目标楼层 / 负值）在写入时钳回合法区间。
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt_ACU(1));
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(1);
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt_ACU(9));
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(1);
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt_ACU(-1));
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(0);
  });

  it('写盘失败时还原楼层字段而不留下半成品', async () => {
    const chat: any[] = [{ mes: 'a' }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockRejectedValue(new Error('save failed')) } as any);

    await expect(writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt_ACU(0))).rejects.toThrow(ContinuationValidationError_ACU);
    expect(Object.prototype.hasOwnProperty.call(chat[0], AGENT_MODULE_FIELD_ACU)).toBe(false);
  });

  it('目标楼层不存在时拒绝写入', async () => {
    await expect(writeAgentModuleSnapshot_ACU([], 0, snapshotAt_ACU(0))).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_SNAPSHOT_INVALID' } });
  });
});

describe('Agent 资料热上下文渲染', () => {
  it('伏笔按重要度排序，退役条目不进热上下文，超限数量如实标注', () => {
    const hooks = [
      hook_ACU('H-low', { importance: 'low' }),
      hook_ACU('H-high', { importance: 'high' }),
      hook_ACU('H-retired', { importance: 'high', retired: true, retiredReason: '已回收' }),
      ...Array.from({ length: AGENT_HOT_HOOK_LIMIT_ACU }, (_, index) => hook_ACU(`H-fill-${index}`)),
    ];
    const text = renderAgentHooksLedger_ACU(snapshotAt_ACU(1, { hooks: hooks as any }));

    expect(text.indexOf('H-high')).toBeLessThan(text.indexOf('H-fill-0'));
    expect(text).not.toContain('H-retired');
    expect(text).toContain('另有 2 条活跃伏笔未进入本次热上下文');
  });

  it('空模块如实说明为空而不是返回空串', () => {
    const empty = buildEmptyAgentModuleSnapshot_ACU();
    expect(renderAgentHooksLedger_ACU(empty)).toContain('没有活跃伏笔');
    expect(renderAgentInfoGap_ACU(empty)).toContain('没有登记的信息差条目');
    expect(renderAgentConstraints_ACU(empty)).toContain('没有登记的长期约束');
  });

  it('活动卷规划上下文区分承载阶段、真实完成进度、剩余目标与禁翻底牌', () => {
    const snapshot = snapshotAt_ACU(4, {
      storyArc: [
        { id: 'VOL-01', scope: 'volume', title: '商行之乱', direction: '主角夺回商行控制权', escalation: '收在印信回归且第三方签名浮现', withheld: '第三方身份', status: 'active', stageNumbers: [1, 2], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '', narrativeRole: 'development', targetStageRange: { min: 4, max: 6 }, targetTimeSpan: '两个月', progressCeiling: '只查明第三方签名存在', sustainingThreads: ['主角与账房建立互信'], payoffTargets: ['兑现夺回印信的期待'] },
        { id: 'VOL-02', scope: 'volume', title: '追查签名', direction: '追查第三方势力', escalation: '收在幕后势力主动灭口', withheld: '幕后首脑身份', status: 'planned', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '' },
      ],
    });

    const text = renderAgentActiveVolumePlanningContext_ACU(snapshot, [1]);

    expect(text).toContain('当前 active 卷：[VOL-01]「商行之乱」');
    expect(text).toContain('卷级结构职责：development');
    expect(text).toContain('目标阶段容量：4–6 个阶段');
    expect(text).toContain('目标故事时间：两个月');
    expect(text).toContain('已完成阶段 1');
    expect(text).toContain('已登记但尚未完成阶段 2');
    expect(text).toContain('主角夺回商行控制权');
    expect(text).toContain('主线进度上限：只查明第三方签名存在');
    expect(text).toContain('持续经营线：主角与账房建立互信');
    expect(text).toContain('兑现目标：兑现夺回印信的期待');
    expect(text).toContain('第三方身份');
  });


  it('三个模块都在首行给出修订号，作为写入并发校验的依据', () => {
    const snapshot = snapshotAt_ACU(2, { revisions: { hooks: 4, infoGap: 5, constraints: 6 } });
    expect(renderAgentHooksLedger_ACU(snapshot).startsWith('当前修订号=4')).toBe(true);
    expect(renderAgentInfoGap_ACU(snapshot).startsWith('当前修订号=5')).toBe(true);
    expect(renderAgentConstraints_ACU(snapshot).startsWith('当前修订号=6')).toBe(true);
  });

  it('超长资料块截断到上限并标注未展示部分不代表不存在', () => {
    const long = Array.from({ length: 6 }, (_, index) => ({
      id: `E${index}`,
      topic: `主题${index}`,
      objectiveFact: '事'.repeat(900),
      readerKnown: '知',
      characterKnowledge: [],
      revealStatus: 'unrevealed',
      revealIndex: null,
      retired: false,
      retiredReason: '',
    }));
    const text = renderAgentInfoGap_ACU(snapshotAt_ACU(1, { infoGap: long as any }));

    expect(text).toContain(`超出 ${AGENT_BLOCK_CHAR_LIMIT_ACU} 字上限，已截断`);
    expect(text).toContain('未展示部分不代表不存在');
    expect(text.startsWith('当前修订号=0')).toBe(true);
  });

  it('年代学热渲染给出当前时间锚与逐条转换，空账本说明事实来源', () => {
    const empty = renderAgentChronology_ACU(buildEmptyAgentModuleSnapshot_ACU());
    expect(empty).toContain('当前修订号=0');
    expect(empty).toContain('没有已结算的故事时间记录');
    expect(empty).toContain('大纲里的时间字段是计划');

    const snapshot = snapshotAt_ACU(6, {
      revisions: { ...buildEmptyAgentModuleSnapshot_ACU().revisions, chronology: 3 },
      chronology: [
        { id: 'T2', anchor: '入城后的第七天', elapsed: '自开篇约十七日', precision: 'approximate', transition: '在临川城休整七日', evidenceIndexes: [4, 5], updatedIndex: 5, retired: false, retiredReason: '' },
        { id: 'T1', anchor: '抵达临川城的当日', elapsed: '自开篇约十日', precision: 'approximate', transition: '行船三日抵达', evidenceIndexes: [2], updatedIndex: 3, retired: false, retiredReason: '' },
        { id: 'T0', anchor: '误登记的锚', elapsed: '未知', precision: 'unknown', transition: '误登记', evidenceIndexes: [1], updatedIndex: 2, retired: true, retiredReason: '登记错误' },
      ] as any,
    });
    const text = renderAgentChronology_ACU(snapshot);

    expect(text.startsWith('当前修订号=3')).toBe(true);
    // 按结算次序排列后，最新锚是 T2；作废条目不进热上下文但如实标注。
    expect(text).toContain('当前时间锚：入城后的第七天');
    expect(text.indexOf('T1')).toBeLessThan(text.indexOf('[T2]'));
    expect(text).not.toContain('误登记的锚');
    expect(text).toContain('另有 1 条已作废记录未列出');
    expect(text).toContain('证据楼层：4、5');
  });

  it('年代学按 ID 精读含已作废条目，未知 ID 如实提示', () => {
    const snapshot = snapshotAt_ACU(6, {
      revisions: { ...buildEmptyAgentModuleSnapshot_ACU().revisions, chronology: 2 },
      chronology: [
        { id: 'T0', anchor: '误登记的锚', elapsed: '未知', precision: 'unknown', transition: '误登记', evidenceIndexes: [1], updatedIndex: 2, retired: true, retiredReason: '登记错误' },
      ] as any,
    });

    const byId = renderAgentChronologyByIds_ACU(snapshot, ['T0', 'T9']);
    expect(byId).toContain('误登记的锚');
    expect(byId).toContain('作废原因：登记错误');
    expect(byId).toContain('以下 ID 不存在于故事年代学账本：T9');
  });

  it('信息差渲染包含客观事实、读者已知与角色知晓', () => {
    const text = renderAgentInfoGap_ACU(snapshotAt_ACU(4, {
      infoGap: [{ id: 'E1', topic: '守门人身份', objectiveFact: '守门人是内应', readerKnown: '只知道行为反常', characterKnowledge: [{ name: '林瑶', knows: '完全不知' }], revealStatus: 'partial', revealIndex: 4, retired: false, retiredReason: '' }],
    }));

    expect(text).toContain('守门人是内应');
    expect(text).toContain('只知道行为反常');
    expect(text).toContain('林瑶=完全不知');
    expect(text).toContain('揭示楼层=4');
  });
});

describe('Agent 资料快照落盘修订号复核（用户手动保存防冲）', () => {
  it('楼层修订号高于写入快照时放弃落盘并告警，不覆盖用户内容', async () => {
    const chat: any[] = [
      { mes: 'a' },
      { mes: 'b', [AGENT_MODULE_FIELD_ACU]: snapshotAt_ACU(0, { revisions: { hooks: 2, infoGap: 0, constraints: 0, storyArc: 0, chronology: 0, webRefs: 0 }, hooks: [hook_ACU('用户伏笔') as any] }) },
    ];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);
    const stale = snapshotAt_ACU(0, { revisions: { hooks: 1, infoGap: 0, constraints: 0, storyArc: 0, chronology: 0, webRefs: 0 }, hooks: [hook_ACU('子代理伏笔') as any] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let warnTexts: string[] = [];
    let writeError: unknown;
    try {
      await writeAgentModuleSnapshot_ACU(chat, 1, stale);
    } catch (error) {
      writeError = error;
    } finally {
      // mockRestore 会清空调用记录：必须在 restore 前快照。
      warnTexts = warn.mock.calls.map(args => args.map(String).join(' '));
      warn.mockRestore();
    }

    expect(writeError).toMatchObject({ error: { code: 'CONTINUATION_AGENT_WRITE_REJECTED' } });
    expect(warnTexts.some(text => text.includes('放弃本次写入防止整份覆盖'))).toBe(true);
    expect(warnTexts.some(text => text.includes('hooks 楼层=2 写入=1'))).toBe(true);
    expect(saveChat).not.toHaveBeenCalled();
    // 楼层字段原样保留：用户内容不被旧基准快照整份覆盖。
    expect(chat[1][AGENT_MODULE_FIELD_ACU].hooks[0].id).toBe('用户伏笔');
    expect(chat[1][AGENT_MODULE_FIELD_ACU].revisions.hooks).toBe(2);
  });

  it('六类修订号逐一复核：storyArc 漂移同样拒绝，其余持平类不阻断判定', async () => {
    const chat: any[] = [
      { mes: 'a' },
      { mes: 'b', [AGENT_MODULE_FIELD_ACU]: snapshotAt_ACU(0, { revisions: { hooks: 1, infoGap: 1, constraints: 0, storyArc: 3, chronology: 0, webRefs: 0 } }) },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let warnTexts: string[] = [];
    let writeError: unknown;
    try {
      await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt_ACU(0, { revisions: { hooks: 2, infoGap: 1, constraints: 0, storyArc: 2, chronology: 0, webRefs: 0 } }));
    } catch (error) {
      writeError = error;
    } finally {
      warnTexts = warn.mock.calls.map(args => args.map(String).join(' '));
      warn.mockRestore();
    }
    expect(writeError).toMatchObject({ error: { code: 'CONTINUATION_AGENT_WRITE_REJECTED' } });
    expect(warnTexts.some(text => text.includes('storyArc 楼层=3 写入=2'))).toBe(true);
  });

  it('修订号持平或更高时照常落盘（正常路径零影响）', async () => {
    const chat: any[] = [{ mes: 'a' }, { mes: 'b', [AGENT_MODULE_FIELD_ACU]: snapshotAt_ACU(0, { revisions: { hooks: 1, infoGap: 0, constraints: 0, storyArc: 0, chronology: 0, webRefs: 0 } }) }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);

    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt_ACU(0, { revisions: { hooks: 1, infoGap: 0, constraints: 0, storyArc: 0, chronology: 0, webRefs: 0 }, hooks: [hook_ACU('H1') as any] }));
    expect(saveChat).toHaveBeenCalledOnce();
    expect(readAgentModuleSnapshot_ACU(chat).hooks[0].id).toBe('H1');

    // 楼层低于写入快照（子代理正常推进修订）同样落盘。
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt_ACU(0, { revisions: { hooks: 2, infoGap: 0, constraints: 0, storyArc: 0, chronology: 0, webRefs: 0 } }));
    expect(saveChat).toHaveBeenCalledTimes(2);
    expect(readAgentModuleSnapshot_ACU(chat).revisions.hooks).toBe(2);
  });

  it('用户手动保存（修订号整体 +1）不受防冲影响，照常落盘', async () => {
    const chat: any[] = [{ mes: 'a' }, { mes: 'b', [AGENT_MODULE_FIELD_ACU]: snapshotAt_ACU(0, { revisions: { hooks: 1, infoGap: 1, constraints: 1, storyArc: 1, chronology: 1, webRefs: 1 }, hooks: [hook_ACU('既有') as any] }) }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);

    const saved = await replaceAgentModuleSnapshotByUser_ACU({ hooks: [hook_ACU('用户编辑') as any] }, chat);

    expect(saved.revisions).toMatchObject({ hooks: 2, infoGap: 2, constraints: 2, storyArc: 2, chronology: 2, webRefs: 2 });
    expect(readAgentModuleSnapshot_ACU(chat).hooks[0].id).toBe('用户编辑');
    expect(saveChat).toHaveBeenCalledOnce();
  });
});

/**
 * 水位对齐 —— 资料补足锚点可以早于物理尾楼（TT 2.3.0 的工具楼尾）时必须先对齐再写。
 *
 * 写入门（writeAgentModuleSnapshot_ACU）把水位钳到 targetIndex，却拿**钳后**水位去校验快照自带的
 * 前缀指纹；主循环已把水位推到工具楼尾时，直接写到最近的 AI 楼会被判「聊天前缀已变化」——
 * 聊天一个字没变，报错还把排障带偏。alignAgentModuleSnapshotToFloor_ACU 负责把水位与指纹一起对齐。
 */
describe('水位对齐（锚点早于结算水位）', () => {
  it('不对齐会被前缀指纹门以误导性理由拒绝；对齐后写入成功且资料可读回', async () => {
    const chat: any[] = [
      { mes: 'a', is_user: false },
      { role: 'tool', name: 'exa_search', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1' },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);

    // 主循环的既有状态：水位推到物理尾楼（工具楼，index 1），并 stamp 了该水位的前缀指纹。
    const settledAtTail = refreshAgentModuleSnapshotChatPrefix_ACU(
      snapshotAt_ACU(1, { hooks: [hook_ACU('H1') as any] }),
      chat,
    );
    expect(settledAtTail.settledPrefixFingerprint).toBeTruthy();

    // 钉住失败面本身：谁把对齐挪走，这条就会红（而不是等到用户资料补足静默失败）。
    await expect(writeAgentModuleSnapshot_ACU(chat, 0, settledAtTail)).rejects.toThrow(/前缀已变化/);

    const aligned = alignAgentModuleSnapshotToFloor_ACU(settledAtTail, chat, 0);
    expect(aligned.settledThroughIndex).toBe(0);
    await writeAgentModuleSnapshot_ACU(chat, 0, aligned);
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map((item) => item.id)).toEqual(['H1']);
  });

  it('水位不高于承载楼时原样返回，不做无谓拷贝与指纹重算', () => {
    const chat: any[] = [{ mes: 'a', is_user: false }, { mes: 'b', is_user: false }];
    const snapshot = snapshotAt_ACU(1, { hooks: [hook_ACU('H1') as any] });

    expect(alignAgentModuleSnapshotToFloor_ACU(snapshot, chat, 1)).toBe(snapshot);
    expect(alignAgentModuleSnapshotToFloor_ACU(snapshot, chat, 3)).toBe(snapshot);
  });

  /**
   * 钳水位前必须按**原水位**校验旧指纹：否则写入门的指纹比对退化成恒等式，
   * P1 前缀守卫的覆盖面会从 0..W 悄悄收窄到 0..承载楼（补足期间改了水位内的正文楼也放过）。
   */
  it('补足期间 0..W 内的正文楼被改：对齐必须拒，不得重算指纹把失配洗白', () => {
    const chat: any[] = [
      { mes: 'a', is_user: false },
      { role: 'tool', name: 'exa_search', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1' },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const settledAtTail = refreshAgentModuleSnapshotChatPrefix_ACU(
      snapshotAt_ACU(1, { hooks: [hook_ACU('H1') as any] }),
      chat,
    );

    chat[0].mes = 'TAMPERED';
    expect(() => alignAgentModuleSnapshotToFloor_ACU(settledAtTail, chat, 0)).toThrow(/前缀已变化/);
  });
});

/**
 * 逐栏提交的「已结算正文楼层」白名单必须与 SQL 事务路径同判据。
 *
 * 整行 writes 路径的证据集用 isAiFloor_ACU（agent-main-loop.ts 的 aiEvidenceIndexes），逐栏提交路径
 * 此前自建 `is_user !== true` ⇒ 同一份意图在两条路上判定相反：TT 2.3.0 的一等工具楼、被 /hide 的
 * 隐藏楼都能被逐栏路径当成伏笔锚点，而整行路径会拒。判据统一走 shared/ai-floor（本库唯一出处）。
 */
describe('逐栏提交的证据楼白名单（与 SQL 事务路径同判据）', () => {
  function hooksInsert(id: string, plantedIndex: number): string {
    return `INSERT INTO hooks (id, summary, status, importance, planted_index, expected_revision) VALUES ('${id}', '伏笔', 'planted', 'mid', ${plantedIndex}, 0)`;
  }

  /** 每次都用全新聊天：被拒的逐栏提交仍会落一次帧（回执 status 恒 committed），会顶掉后续修订号。 */
  function threeFloorChat(): any[] {
    const chat: any[] = [
      { mes: 'a', is_user: false },
      { mes: '中间楼', is_user: false },
      { mes: '正文', is_user: false },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    return chat;
  }

  it('planted_index 指向 TT 2.3.0 工具楼必须被拒，该栏不落库', async () => {
    const chat = threeFloorChat();
    chat[1] = { role: 'tool', name: 'exa_search', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1' };
    await writeAgentModuleSnapshot_ACU(chat, 2, snapshotAt_ACU(2));

    // 注意：receipt.status 只反映「整批有没有落库」（persist/readback 失败才会是 persist_failed /
    // readback_failed），逐栏拒绝不影响它；拒绝只体现在 rejected[]，且被拒字段不会进 accepted[]。
    // 所以断言要看这两个清单，不能看 status。
    const receipt = await commitAgentModuleFieldWrites_ACU({
      chat, targetIndex: 2, role: 'hook-cognition-maintainer', sql: hooksInsert('HF1', 1),
    } as any);
    expect(receipt.rejected.some((item: { reason: string }) => /已结算正文楼层/.test(item.reason))).toBe(true);
    expect(receipt.accepted.some((item: { id: string; field: string }) => item.id === 'HF1' && item.field === 'plantedIndex')).toBe(false);
  });

  it('planted_index 指向可见 AI 楼则通过（对照：白名单没有收紧过头）', async () => {
    const chat = threeFloorChat();
    await writeAgentModuleSnapshot_ACU(chat, 2, snapshotAt_ACU(2));

    const receipt = await commitAgentModuleFieldWrites_ACU({
      chat, targetIndex: 2, role: 'hook-cognition-maintainer', sql: hooksInsert('HF2', 0),
    } as any);
    expect(receipt.rejected).toEqual([]);
    expect(receipt.accepted.some((item: { id: string; field: string }) => item.id === 'HF2' && item.field === 'plantedIndex')).toBe(true);
  });

  it('被 /hide 的隐藏楼同样不得作为伏笔锚点（is_system 是隐藏位，不是角色事实）', async () => {
    const chat = threeFloorChat();
    chat[1] = { mes: '（用户已隐藏）', is_user: false, is_system: true };
    await writeAgentModuleSnapshot_ACU(chat, 2, snapshotAt_ACU(2));

    const receipt = await commitAgentModuleFieldWrites_ACU({
      chat, targetIndex: 2, role: 'hook-cognition-maintainer', sql: hooksInsert('HF3', 1),
    } as any);
    expect(receipt.rejected.some((item: { reason: string }) => /已结算正文楼层/.test(item.reason))).toBe(true);
    expect(receipt.accepted.some((item: { id: string; field: string }) => item.id === 'HF3' && item.field === 'plantedIndex')).toBe(false);
  });
});

/**
 * 用户手动保存与「播种用户要求」同形：读折叠 → 加工 → 直接回写。
 * 折叠水位被 delta 推高之后，若折叠输出的 (水位, 前缀指纹) 不成对，写盘门会以
 * 「资料快照引用的聊天前缀已变化」硬拒——而这是**用户可见**的失败面（报错弹窗、编辑丢失），
 * 聊天其实一个字没变。修在折叠出口后，所有同形路径一起受益，这里锁定用户可见的那一条。
 */
describe('用户手动保存资料（折叠水位已被 delta 推高）', () => {
  it('不得被前缀指纹门误拒，编辑必须真的落盘', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }, { mes: 'b', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt_ACU(1));

    chat.push({ mes: 'c', is_user: false });
    const second = snapshotAt_ACU(2, { hooks: [hook_ACU('H1') as any] });
    second.revisions = { ...second.revisions, hooks: 1 };
    await writeAgentModuleSnapshot_ACU(chat, 2, second);
    // 前置：水位确实已被 delta 推过基线水位（否则本用例测不到东西）
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(2);

    const saved = await replaceAgentModuleSnapshotByUser_ACU({ hooks: [hook_ACU('USER') as any] }, chat);
    expect(saved.hooks.map((item) => item.id)).toEqual(['USER']);
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map((item) => item.id)).toEqual(['USER']);
  });
});

/**
 * 逐栏提交的**落帧楼层**。
 *
 * 调用方（agent-main-loop 的三处派工）一律传 `chat.length - 1`，而 TT 2.3.0 的物理尾楼可以合法地是
 * 一等工具楼 `{role:'tool', is_system:true}`（tool-calling.js:1058-1089）——它可被用户独立删除、
 * 没有 swipe_id、也不承载剧情正文。逐栏草稿（fieldUpserts）挂在它身上＝用户删掉工具楼就丢草稿。
 * 落帧楼层必须是「≤ targetIndex 的最近 AI 楼」：折叠按楼层序应用 delta，落更早的楼会让新 delta
 * 排在既有 delta 之前被应用。
 */
describe('逐栏提交的帧落在 AI 楼（工具楼尾）', () => {
  const minimalInsert = (id: string) =>
    `INSERT INTO hooks (id, expected_revision, summary) VALUES ('${id}', 0, '草稿')`;

  it('targetIndex 是工具楼时，草稿 delta 落在最近的 AI 楼，工具楼一帧不沾', async () => {
    const chat: any[] = [
      { mes: 'a', is_user: false },
      { mes: 'b', is_user: false },
      { role: 'tool', name: 'exa_search', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1' },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);

    const receipt = await commitAgentModuleFieldWrites_ACU({
      chat, targetIndex: 2, role: 'hook-cognition-maintainer', sql: minimalInsert('HF9'),
    } as any);

    // 回读门必须按「本次规划改写过的楼层」豁免，而不是按调用方给的 targetIndex：
    // 帧落在 AI 楼（floor 1）而 targetIndex 是工具楼（floor 2）时，旧豁免会把这次合法写入判成 readback_failed。
    expect(receipt.status).toBe('committed');
    expect(receipt.accepted.some((item: { id: string }) => item.id === 'HF9')).toBe(true);
    expect(chat[2][AGENT_MODULE_FIELD_ACU], '工具楼不得承载逐栏 delta').toBeUndefined();
    expect(chat[1][AGENT_MODULE_FIELD_ACU]?.deltas?.some((delta: any) => delta.fieldUpserts)).toBe(true);
    // 草稿仍读得回来（落点变了，内容不能丢）
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.HF9?.fields.summary.value).toBe('草稿');
  });

  it('整条聊天没有 AI 楼时 fail-closed：任何楼都不写帧', async () => {
    const chat: any[] = [
      { mes: '用户输入', is_user: true },
      { role: 'tool', name: 'exa_search', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1' },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);

    await commitAgentModuleFieldWrites_ACU({
      chat, targetIndex: 1, role: 'hook-cognition-maintainer', sql: minimalInsert('HF10'),
    } as any);

    expect(chat[0][AGENT_MODULE_FIELD_ACU], '用户楼不得承载帧').toBeUndefined();
    expect(chat[1][AGENT_MODULE_FIELD_ACU], '工具楼不得承载帧').toBeUndefined();
  });

  /**
   * 落点改成 AI 楼之后，折叠顺序（楼层正序）会让「更晚楼层上的遗留帧」覆盖新写入。
   * 逐栏路径不折叠、无处吸收遗留内容，所以必须先拒一次并说清原因——整条快照写入每轮结算都会跑，
   * 会把遗留帧吸收进全量基线并摘掉，阻塞窗口只有一轮。
   */
  it('非 AI 楼上有遗留帧时逐栏提交先拒一次，理由可区分，且不去搅动遗留帧', async () => {
    const chat: any[] = [
      { mes: 'AI 正文', is_user: false },
      {
        role: 'tool', name: 'exa_search', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1',
        [AGENT_MODULE_FIELD_ACU]: {
          schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
          deltas: [{ seq: 1, swipeId: '0', writes: {}, revisions: {}, fieldUpserts: { hooks: { OLD1: { summary: { value: '旧草稿' } } } }, updatedAt: 1 }],
        },
      },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);

    const receipt = await commitAgentModuleFieldWrites_ACU({
      chat, targetIndex: 1, role: 'hook-cognition-maintainer', sql: minimalInsert('HF11'),
    } as any);

    expect(receipt.rejected.some((item: { reason: string }) => /遗留/.test(item.reason)), '理由必须能与「规划不出写入」区分开').toBe(true);
    expect(chat[0][AGENT_MODULE_FIELD_ACU], '拒绝时不得写任何新帧').toBeUndefined();
    expect(chat[1][AGENT_MODULE_FIELD_ACU]?.deltas).toHaveLength(1);
  });
});

/**
 * 用户手动保存资料：没有任何 AI 楼可承载时必须报错，不能弹「已保存」——
 * 那正是本函数自己写下的纪律（「对用户编辑是数据丢失——用户会以为自己保存成功了」）。
 */
describe('用户手动保存资料的落点门', () => {
  it('聊天里没有 AI 楼时直接拒绝，不谎报已保存', async () => {
    const chat: any[] = [
      { mes: '用户输入', is_user: true },
      { role: 'tool', name: 'exa_search', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1' },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);

    await expect(replaceAgentModuleSnapshotByUser_ACU({ hooks: [] }, chat))
      .rejects.toThrow(ContinuationValidationError_ACU);
    expect(chat[0][AGENT_MODULE_FIELD_ACU]).toBeUndefined();
    expect(chat[1][AGENT_MODULE_FIELD_ACU]).toBeUndefined();
  });
});
