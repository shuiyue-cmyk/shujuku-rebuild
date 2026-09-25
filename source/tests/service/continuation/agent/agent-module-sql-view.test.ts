import { afterEach, describe, expect, it } from 'vitest';

import {
  AgentModuleSqlViewError_ACU,
  materializeAgentModuleSqlView_ACU,
  type AgentModuleSqlView_ACU,
} from '../../../../src/service/continuation/agent/agent-module-sql-view';
import {
  applyAgentConstraintRegistrationViaSql_ACU,
  applyAgentModuleDeltaViaSql_ACU,
  applyAgentWebRefsDeltaViaSql_ACU,
  applyAgentModuleDelta_ACU,
} from '../../../../src/service/continuation/agent/agent-transaction';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import type {
  AgentModuleDelta_ACU,
  AgentModuleSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-model';

/**
 * TT 判别测试（移植上游 0de0352 TT 子集，按本地脚手架重写）：
 * SQL 行视图只做只读复算（写走既有事务链），知识边界外资料不得泄漏进提示词（越界 fail-closed）。
 * T1–T6 语义锁定：帧/字段增量/工作流/用户要求区/受限 SQL 白名单/证据门/pendingFixes/SQL 重绑守卫保持。
 */

function baseSnapshot_ACU(): AgentModuleSnapshot_ACU {
  return {
    ...buildEmptyAgentModuleSnapshot_ACU(),
    settledThroughIndex: 12,
    updatedAt: 1000,
    revisions: { hooks: 3, infoGap: 2, constraints: 1, storyArc: 0, chronology: 0, webRefs: 0, userRequirements: 5 },
    hooks: [
      { id: 'hook-1', summary: '旧伏笔', status: 'planted', importance: 'high', plantedIndex: 2, updatedIndex: 2, plannedPayoff: '后期兑现', retired: false, retiredReason: '' },
      { id: 'hook-2', summary: '待删伏笔', status: 'planted', importance: 'low', plantedIndex: 4, updatedIndex: 4, plannedPayoff: '', retired: false, retiredReason: '' },
    ],
    infoGap: [
      { id: 'gap-1', topic: '身世', objectiveFact: '主角是遗孤', readerKnown: '不知情', characterKnowledge: [{ name: '长老', knows: '全部真相' }], revealStatus: 'unrevealed', revealIndex: null, retired: false, retiredReason: '' },
    ],
    userRequirements: ['保持悬疑'],
    pendingFixes: [],
  };
}

function delta_ACU(patch: Partial<AgentModuleDelta_ACU> = {}): AgentModuleDelta_ACU {
  return { expectedRevisions: {}, hooks: [], hookPatches: [], infoGap: [], infoGapPatches: [], storyArc: [], storyArcPatches: [], chronology: [], constraintProposals: [], ...patch };
}

describe('SQL 行视图（TT 只读复算）', () => {
  let view: AgentModuleSqlView_ACU | null = null;
  afterEach(() => { view?.dispose(); view = null; });

  it('物化快照：条目、revision 与标量字段完整进库，初始无变更', async () => {
    view = await materializeAgentModuleSqlView_ACU(baseSnapshot_ACU());
    const back = view.readSnapshot();
    expect(back.hooks.map(item => item.id)).toEqual(['hook-1', 'hook-2']);
    expect(back.infoGap).toHaveLength(1);
    expect(back.userRequirements).toEqual(['保持悬疑']);
    expect(back.revisions.hooks).toBe(3);
    expect(back.revisions.userRequirements).toBe(5);
    expect(back.settledThroughIndex).toBe(12);
    expect(back.updatedAt).toBe(1000);
    expect(back.pendingFixes).toEqual([]);
    expect(view.hasChanges()).toBe(false);
  });

  it('空快照物化为合法空库', async () => {
    const empty = { ...baseSnapshot_ACU(), hooks: [], infoGap: [], userRequirements: [] };
    view = await materializeAgentModuleSqlView_ACU(empty);
    const back = view.readSnapshot();
    expect(back.hooks).toEqual([]);
    expect(back.userRequirements).toEqual([]);
    expect(view.hasChanges()).toBe(false);
  });

  it('行级 upsert：新增与覆盖同 id 条目，revision 随写推进', async () => {
    view = await materializeAgentModuleSqlView_ACU(baseSnapshot_ACU());
    const next = view.applyRowWrite({
      module: 'hooks',
      expectedRevision: 3,
      upserts: [
        { id: 'hook-1', summary: '旧伏笔（已更新）', status: 'reinforced', importance: 'high', plantedIndex: 2, updatedIndex: 12, plannedPayoff: '后期兑现', retired: false, retiredReason: '' },
        { id: 'hook-3', summary: '新伏笔', status: 'planted', importance: 'mid', plantedIndex: 12, updatedIndex: 12, plannedPayoff: '', retired: false, retiredReason: '' },
      ],
    });
    expect(next).toBe(4);
    const back = view.readSnapshot();
    expect(back.hooks.map(item => item.id)).toEqual(['hook-1', 'hook-2', 'hook-3']);
    expect(back.hooks[0].summary).toBe('旧伏笔（已更新）');
    expect(back.revisions.hooks).toBe(4);
    expect(view.hasChanges()).toBe(true);
  });

  it('行级 remove：按 id 删除并进入变更追踪', async () => {
    view = await materializeAgentModuleSqlView_ACU(baseSnapshot_ACU());
    view.applyRowWrite({ module: 'hooks', expectedRevision: 3, removedIds: ['hook-2'] });
    const back = view.readSnapshot();
    expect(back.hooks.map(item => item.id)).toEqual(['hook-1']);
    const deltaOut = view.exportDelta();
    expect(deltaOut.removedIds?.hooks).toEqual(['hook-2']);
    expect(deltaOut.revisions.hooks).toBe(4);
  });

  it('revision 冲突在 SQL 层拒绝且库内容不变（fail-closed）', async () => {
    view = await materializeAgentModuleSqlView_ACU(baseSnapshot_ACU());
    expect(() => view!.applyRowWrite({
      module: 'hooks',
      expectedRevision: 1,
      upserts: [{ id: 'hook-9', summary: '不该写入', status: 'planted', importance: 'low', plantedIndex: 0, updatedIndex: 0, plannedPayoff: '', retired: false, retiredReason: '' }],
    })).toThrow(AgentModuleSqlViewError_ACU);
    const back = view.readSnapshot();
    expect(back.hooks).toHaveLength(2);
    expect(back.revisions.hooks).toBe(3);
    expect(view.hasChanges()).toBe(false);
  });

  it('upsert 条目缺少合法 id 即拒绝（知识边界：越界 fail-closed）', async () => {
    view = await materializeAgentModuleSqlView_ACU(baseSnapshot_ACU());
    expect(() => view!.applyRowWrite({ module: 'hooks', expectedRevision: 3, upserts: [{ summary: '无 id' }] })).toThrow(/缺少合法 id/);
    expect(view.hasChanges()).toBe(false);
  });

  it('未知模块即拒绝，绝不成为写旁路', async () => {
    view = await materializeAgentModuleSqlView_ACU(baseSnapshot_ACU());
    expect(() => view!.applyRowWrite({ module: 'userRequirements' as never, expectedRevision: 5, upserts: ['x'] })).toThrow(AgentModuleSqlViewError_ACU);
    expect(() => view!.applyRowWrite({ module: 'nope' as never, expectedRevision: 0 })).toThrow(AgentModuleSqlViewError_ACU);
    expect(view.hasChanges()).toBe(false);
  });

  it('removedIds 含非法 id 即拒绝', async () => {
    view = await materializeAgentModuleSqlView_ACU(baseSnapshot_ACU());
    expect(() => view!.applyRowWrite({ module: 'hooks', expectedRevision: 3, removedIds: ['  '] })).toThrow(/非法 id/);
    expect(view.hasChanges()).toBe(false);
  });

  it('物化含无 id 条目的快照即失败', async () => {
    const broken = baseSnapshot_ACU();
    (broken.hooks as unknown[]).push({ summary: '无 id 条目' });
    await expect(materializeAgentModuleSqlView_ACU(broken)).rejects.toThrow(/无法物化/);
  });

  it('变更导出：同 id 先删后写只剩 upsert，导出后清空追踪', async () => {
    view = await materializeAgentModuleSqlView_ACU(baseSnapshot_ACU());
    view.applyRowWrite({ module: 'hooks', expectedRevision: 3, removedIds: ['hook-2'] });
    view.applyRowWrite({
      module: 'hooks',
      expectedRevision: 4,
      upserts: [
        { id: 'hook-2', summary: '删后再建', status: 'planted', importance: 'low', plantedIndex: 4, updatedIndex: 13, plannedPayoff: '', retired: false, retiredReason: '' },
        { id: 'hook-4', summary: '全新条目', status: 'planted', importance: 'mid', plantedIndex: 13, updatedIndex: 13, plannedPayoff: '', retired: false, retiredReason: '' },
      ],
    });
    const deltaOut = view.exportDelta();
    const upsertIds = ((deltaOut.writes.hooks ?? []) as Array<{ id: string }>).map(item => item.id);
    expect(upsertIds).toEqual(['hook-2', 'hook-4']);
    expect(deltaOut.removedIds).toBeUndefined();
    expect(deltaOut.revisions.hooks).toBe(5);
    expect(view.hasChanges()).toBe(false);
    const back = view.readSnapshot();
    expect(back.hooks.map(item => item.id)).toEqual(['hook-1', 'hook-2', 'hook-4']);
  });

  it('行视图只读：exportDelta 不产出用户要求单例写旁路（T5 单例仍走快照整写）', async () => {
    view = await materializeAgentModuleSqlView_ACU(baseSnapshot_ACU());
    view.applyRowWrite({
      module: 'hooks',
      expectedRevision: 3,
      upserts: [{ id: 'hook-9', summary: '行写', status: 'planted', importance: 'low', plantedIndex: 12, updatedIndex: 12, plannedPayoff: '', retired: false, retiredReason: '' }],
    });
    const deltaOut = view.exportDelta();
    expect(deltaOut.writes).not.toHaveProperty('userRequirements');
    expect((deltaOut as Record<string, unknown>).userRequirements).toBeUndefined();
  });
});

describe('SQL 视图校验变体（写走既有事务链，失败 fail-closed 回退 JSON）', () => {
  it('ViaSql 与 JSON 事务结果一致：revision 推进与 appliedModules 相同', async () => {
    const snapshot = baseSnapshot_ACU();
    const delta = delta_ACU({
      expectedRevisions: { hooks: 3 },
      hooks: [{ action: 'upsert', id: 'hook-3', summary: '新伏笔', status: 'planted', importance: 'mid', plantedIndex: 12, plannedPayoff: '', reason: '' }],
    });
    const json = applyAgentModuleDelta_ACU(snapshot, delta, ['hooks'], 12);
    const via = await applyAgentModuleDeltaViaSql_ACU(snapshot, delta, ['hooks'], 12);
    expect(via.snapshot).toEqual(json.snapshot);
    expect(via.appliedModules).toEqual(json.appliedModules);
    expect(via.snapshot.revisions.hooks).toBe(4);
  });

  it('P1 证据门不弱化：未来楼层证据仍拒绝（ViaSql 与 JSON 同语义）', async () => {
    const snapshot = baseSnapshot_ACU();
    const delta = delta_ACU({
      chronology: [{ action: 'upsert', id: 'T9', anchor: '未来锚', elapsed: '未知', precision: 'unknown', transition: '跳跃', evidenceIndexes: [99], reason: '' }],
    });
    await expect(applyAgentModuleDeltaViaSql_ACU(snapshot, delta, ['chronology'], 12, [], new Set([12]))).rejects.toThrow(/AI 正文楼层|未来楼层/);
  });

  it('pendingFixes 语义保持：容错模式下违规模块记入 pendingFixes', async () => {
    const snapshot = baseSnapshot_ACU();
    const seen: string[] = [];
    const delta = delta_ACU({
      hooks: [{ action: 'retire', id: '不存在', summary: '', status: 'planted', importance: 'low', plantedIndex: 0, plannedPayoff: '', reason: '' }],
    });
    const via = await applyAgentModuleDeltaViaSql_ACU(snapshot, delta, ['hooks'], 12, [], { onViolation: message => { seen.push(message); }, agentName: 'hook-cognition-maintainer' });
    expect(via.appliedModules).toEqual([]);
    expect(via.pendingFixes.map(item => item.module)).toContain('hooks');
    expect(seen.length).toBe(1);
  });

  it('SQL 层不可用时 fail-closed 回退 JSON 结果（不静默产出空资料）', async () => {
    const broken = baseSnapshot_ACU();
    (broken.hooks as unknown[]).push({ summary: '无 id 坏条目' });
    const delta = delta_ACU({
      expectedRevisions: { infoGap: 2 },
      infoGap: [{ action: 'upsert', id: 'gap-2', topic: '新', objectiveFact: '实', readerKnown: '读', characterKnowledge: [], revealStatus: 'unrevealed', revealIndex: null, reason: '' }],
    });
    const via = await applyAgentModuleDeltaViaSql_ACU(broken, delta, ['infoGap'], 12);
    expect(via.appliedModules).toEqual(['infoGap']);
    expect(via.snapshot.infoGap.map(item => item.id)).toContain('gap-2');
  });

  it('webRefs / constraints ViaSql 变体与 JSON 一致', async () => {
    const snapshot = baseSnapshot_ACU();
    const web = await applyAgentWebRefsDeltaViaSql_ACU(snapshot, {
      summary: '检索',
      expectedRevision: 0,
      items: [{ action: 'upsert', id: '', title: '实体', source: 'web', url: 'https://example.com/x', query: '实体', tags: [], brief: '简介', summary: '详情', sourceStatus: 'ok', reason: '' }],
    }, 0, 2000);
    expect(web.appliedModules).toEqual(['webRefs']);
    expect(web.snapshot.revisions.webRefs).toBe(1);

    const cons = await applyAgentConstraintRegistrationViaSql_ACU(snapshot, ['新红线'], [], 12);
    expect(cons.appliedModules).toEqual(['constraints']);
    expect(cons.snapshot.constraints.map(item => item.text)).toContain('新红线');
  });
});
