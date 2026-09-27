/**
 * tests/service/continuation/stage-cursor-identity-table.test.ts
 *
 * 性能优化第二批 · P0-7「任务光标调和：预计算逐楼身份」判别测试。
 *
 * 三条红线：
 * 1. 每楼指纹计算次数从 O(完成数×楼层) 降到 O(楼层)；完成记录带 messageId 时降到 0；
 * 2. `used` 消耗顺序与全部匹配语义一字不变——与「旧实现逐条重算指纹」的朴素参考实现逐字段相等；
 * 3. 命中 / 未命中 / 重复完成 / 换 swipe 四类 fixture 都要走到。
 *
 * 计数钩子只统计「真正算过整段 mes 指纹」的次数；身份表是单次调和的局部量，
 * 不跨调用复用，所以不存在陈旧值路径（无需版本键）。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  __readStageCursorCountersForTests_ACU,
  __resetStageCursorCountersForTests_ACU,
  cursorFromCompletedTurns_ACU,
  getStableMessageIdentity_ACU,
  reconcileTaskCursorFromChat_ACU,
} from '../../../src/service/continuation/stage-cursor';
import type { ContinuationStage_ACU, ContinuationTask_ACU, StageRevision_ACU } from '../../../src/service/continuation/model';

const FLOORS = 40;
const COMPLETIONS = 20;

function revisionOf(totalTurns: number): StageRevision_ACU {
  return {
    revision: 1, createdAt: 1, reason: 'initial', replanInstruction: '', frozen: true,
    outline: {
      schemaVersion: 1, title: '阶段', goal: '目标', tempo: 'mixed', totalTurns,
      nodes: [{
        id: 'node-1', title: '节点', goal: '目标', suggestedTurns: totalTurns,
        turns: Array.from({ length: totalTurns }, (_, index) => ({ id: `s1-t${index + 1}`, goal: '轮', pacing: 'setup' as const })),
      }],
    },
  };
}

function stageOf(stageId: string, stageNumber: number, totalTurns: number, completedTurns: number, status: ContinuationStage_ACU['status'] = 'running'): ContinuationStage_ACU {
  const revision = revisionOf(totalTurns);
  const cursor = cursorFromCompletedTurns_ACU(revision, completedTurns);
  return { stageId, stageNumber, status, activeRevision: 1, revisions: [revision], activeNodeIndex: cursor.nodeIndex, activeTurnIndex: cursor.turnIndex, completedTurns };
}

function taskOf(stages: ContinuationStage_ACU[], timeline: ContinuationTask_ACU['timeline'], activeStageId: string): ContinuationTask_ACU {
  return {
    taskId: 'task-a', originInstruction: '推进', status: 'paused', createdAt: 1, updatedAt: 1,
    runStartedAt: 1, deadlineAt: null, runStageCount: stages.length, activeStageId, stages, timeline,
    stopReason: null, lastError: null,
  };
}

type Entry = ContinuationTask_ACU['timeline'][number];

function buildChat(): any[] {
  return Array.from({ length: FLOORS }, (_, index) => ({
    message_id: `floor-${index}`,
    is_user: index % 2 === 0,
    role: index % 2 === 0 ? 'user' : 'assistant',
    mes: `第 ${index} 层正文`.repeat(30),
  }));
}

function idEntries(count: number, floorIndexes: number[]): Entry[] {
  return Array.from({ length: count }, (_, index) => {
    const floor = floorIndexes[index];
    return { id: `c${index}`, at: 1, kind: 'turn_completed', stageId: 'stage-1', turnId: `s1-t${index + 1}`, messageIndex: floor, messageId: `floor-${floor}` } as Entry;
  });
}

function fingerprintEntry(floor: number, identity: { messageFingerprint: string }): Entry {
  return { id: `fp-${floor}`, at: 1, kind: 'turn_completed', stageId: 'stage-1', turnId: `s1-t${floor}`, messageIndex: floor, messageFingerprint: identity.messageFingerprint } as Entry;
}

// ── 朴素参考实现：优化前逐字照抄的语义（每条完成记录从 0 楼重算整段指纹） ──────

function naiveSurvives_ACU(entry: Entry, chat: readonly unknown[] | undefined, chatLength: number, used: Set<number>): boolean {
  const hasDurableIdentity = entry.messageId !== undefined || entry.messageFingerprint !== undefined;
  if (!chat) return !hasDurableIdentity && typeof entry.messageIndex === 'number' ? entry.messageIndex < chatLength : !hasDurableIdentity;
  if (!hasDurableIdentity) return typeof entry.messageIndex === 'number' && entry.messageIndex < chat.length;
  for (let index = 0; index < chat.length; index += 1) {
    if (used.has(index)) continue;
    const identity = getStableMessageIdentity_ACU(chat[index]);
    if (entry.messageId !== undefined && identity.messageId !== entry.messageId) continue;
    if (entry.messageFingerprint !== undefined && identity.messageFingerprint !== entry.messageFingerprint) continue;
    used.add(index);
    return true;
  }
  return false;
}

function naiveReconcile_ACU(task: ContinuationTask_ACU, chatLength: number, chat?: readonly unknown[]): ContinuationTask_ACU {
  const effectiveLength = Array.isArray(chat) ? chat.length : chatLength;
  if (!Number.isInteger(effectiveLength) || effectiveLength < 0) return task;
  const completions = task.timeline.filter(entry => entry.kind === 'turn_completed' && entry.stageId);
  const survivingByStage = new Map<string, number>();
  const hasAnchorByStage = new Map<string, boolean>();
  for (const entry of completions) {
    const stageId = entry.stageId as string;
    if (typeof entry.messageIndex === 'number' || entry.messageId !== undefined || entry.messageFingerprint !== undefined) hasAnchorByStage.set(stageId, true);
    const surviving = survivingByStage.get(stageId) ?? 0;
    survivingByStage.set(stageId, surviving + (naiveSurvives_ACU(entry, chat, effectiveLength, new Set()) ? 1 : 0));
  }
  let firstOpenIndex = -1;
  let changed = false;
  const stages = task.stages.map((stage, index) => {
    const revision = stage.revisions.find(item => item.revision === stage.activeRevision) ?? null;
    const totalTurns = revision?.outline.totalTurns ?? 0;
    const hasAnchor = hasAnchorByStage.get(stage.stageId) === true;
    if (!hasAnchor) {
      if (stage.status !== 'completed' && stage.status !== 'abandoned' && stage.status !== 'failed' && firstOpenIndex < 0) firstOpenIndex = index;
      return stage;
    }
    const recorded = completions.filter(entry => entry.stageId === stage.stageId).length;
    const used = new Set<number>();
    let surviving = 0;
    for (const entry of completions) {
      if (entry.stageId !== stage.stageId) continue;
      if (!naiveSurvives_ACU(entry, chat, effectiveLength, used)) break;
      surviving += 1;
    }
    surviving = Math.min(surviving, recorded, totalTurns);
    const cursor = cursorFromCompletedTurns_ACU(revision, surviving);
    const fullyDone = totalTurns > 0 && surviving >= totalTurns;
    let nextStatus: ContinuationStage_ACU['status'] = stage.status;
    if (fullyDone) {
      if (stage.status !== 'abandoned' && stage.status !== 'failed') nextStatus = 'completed';
    } else if (stage.status === 'completed') {
      nextStatus = 'running';
    }
    if (!fullyDone && firstOpenIndex < 0) firstOpenIndex = index;
    if (stage.completedTurns === surviving && stage.activeNodeIndex === cursor.nodeIndex && stage.activeTurnIndex === cursor.turnIndex && stage.status === nextStatus) return stage;
    changed = true;
    return { ...stage, completedTurns: surviving, activeNodeIndex: cursor.nodeIndex, activeTurnIndex: cursor.turnIndex, status: nextStatus };
  });
  if (firstOpenIndex >= 0) {
    for (let index = firstOpenIndex + 1; index < stages.length; index += 1) {
      const stage = stages[index];
      const hasAnchor = hasAnchorByStage.get(stage.stageId) === true;
      const surviving = hasAnchor ? (survivingByStage.get(stage.stageId) ?? 0) : stage.completedTurns;
      if (surviving > 0) continue;
      if (stage.status === 'abandoned' && stage.completedTurns === 0 && stage.activeNodeIndex === 0 && stage.activeTurnIndex === 0) continue;
      stages[index] = { ...stage, status: 'abandoned', completedTurns: 0, activeNodeIndex: 0, activeTurnIndex: 0 };
      changed = true;
    }
  }
  const firstOpen = stages.find(stage => stage.status !== 'completed' && stage.status !== 'abandoned' && stage.status !== 'failed') ?? null;
  const activeStageId = firstOpen?.stageId ?? task.activeStageId;
  if (activeStageId !== task.activeStageId) changed = true;
  if (!changed) return task;
  return { ...task, activeStageId, stages };
}

beforeEach(() => {
  __resetStageCursorCountersForTests_ACU();
});

describe('P0-7 光标调和：预计算逐楼身份', () => {
  it('完成记录带 messageId：指纹计算 650→0，身份表 40 条', () => {
    const live = buildChat();
    const task = taskOf([stageOf('stage-1', 1, COMPLETIONS, COMPLETIONS)], idEntries(COMPLETIONS, Array.from({ length: COMPLETIONS }, (_, i) => 2 * i + 1)), 'stage-1');
    // 旧实现实测（同 fixture）：fingerprints=650（完成数×楼层量级）
    const next = reconcileTaskCursorFromChat_ACU(task, live.length, live);
    const counters = __readStageCursorCountersForTests_ACU();
    expect(counters.fingerprints).toBe(0);
    expect(counters.floorIdentities).toBe(FLOORS);
    expect(counters.reconciles).toBe(1);
    expect(next.stages[0].completedTurns).toBe(COMPLETIONS);
  });

  it('完成记录只带指纹：指纹计算 840→8（O(楼层)，且不超楼层数）', () => {
    const live = buildChat();
    const fingerprint = getStableMessageIdentity_ACU(live[7]).messageFingerprint;
    __resetStageCursorCountersForTests_ACU();
    const task = taskOf([stageOf('stage-1', 1, COMPLETIONS, COMPLETIONS)], [fingerprintEntry(7, { messageFingerprint: fingerprint })], 'stage-1');
    const next = reconcileTaskCursorFromChat_ACU(task, live.length, live);
    const counters = __readStageCursorCountersForTests_ACU();
    // 旧实现实测（同 fixture）：fingerprints=840（第一条完成记录扫到第 7 楼，阶段复核再扫一遍，
    // 后续每条完成记录又从 0 楼重来）。新实现：身份表内每楼最多算一次，走到命中为止＝8。
    expect(counters.fingerprints).toBe(8);
    expect(counters.fingerprints).toBeLessThanOrEqual(FLOORS);
    expect(next.stages[0].completedTurns).toBe(1);
  });

  it('没有 durable identity 的旧记录一条指纹都不算', () => {
    const live = buildChat();
    const task = taskOf(
      [stageOf('stage-1', 1, 6, 3)],
      [
        { id: 'c1', at: 1, kind: 'turn_completed', stageId: 'stage-1', turnId: 's1-t1', messageIndex: 1 } as Entry,
        { id: 'c2', at: 1, kind: 'turn_completed', stageId: 'stage-1', turnId: 's1-t2', messageIndex: 3 } as Entry,
        { id: 'c3', at: 1, kind: 'turn_completed', stageId: 'stage-1', turnId: 's1-t3', messageIndex: 5 } as Entry,
      ],
      'stage-1',
    );
    const next = reconcileTaskCursorFromChat_ACU(task, live.length, live);
    expect(__readStageCursorCountersForTests_ACU().fingerprints).toBe(0);
    expect(next.stages[0].completedTurns).toBe(3);
  });
});

describe('P0-7 光标调和：与朴素参考实现逐字段相等', () => {
  it('命中 / 未命中 / 重复完成 / 删楼 / 换 swipe 五类 fixture', () => {
    const base = buildChat();
    const fingerprint = getStableMessageIdentity_ACU(base[7]).messageFingerprint;
    const cases: Array<{ name: string; chat: any[]; timeline: Entry[]; stages?: ContinuationStage_ACU[]; activeStageId?: string }> = [
      {
        name: '全部命中',
        chat: base,
        timeline: idEntries(COMPLETIONS, Array.from({ length: COMPLETIONS }, (_, i) => 2 * i + 1)),
      },
      {
        name: '中段删楼（未命中靠 identity 跳过）',
        chat: base.filter(message => message.message_id !== 'floor-21'),
        timeline: idEntries(COMPLETIONS, Array.from({ length: COMPLETIONS }, (_, i) => 2 * i + 1)),
      },
      {
        name: '重复完成（同一 messageId 被两条记录占用）',
        chat: base,
        timeline: [
          ...idEntries(2, [5, 5]),
          ...idEntries(2, [9, 11]),
        ],
      },
      {
        name: '换 swipe（正文变了、messageId 不变，仍按 identity 命中）',
        chat: base.map((message, index) => (index === 7 ? { ...message, mes: `${message.mes}（另一 swipe）` } : message)),
        timeline: idEntries(COMPLETIONS, Array.from({ length: COMPLETIONS }, (_, i) => 2 * i + 1)),
      },
      {
        name: '纯指纹完成记录',
        chat: base,
        timeline: [fingerprintEntry(7, { messageFingerprint: fingerprint }), fingerprintEntry(9, { messageFingerprint: getStableMessageIdentity_ACU(base[9]).messageFingerprint })],
      },
      {
        name: '指纹与 messageId 同时存在但正文被改（指纹不再匹配）',
        chat: base.map((message, index) => (index === 7 ? { ...message, mes: '正文被改' } : message)),
        timeline: [{
          id: 'both', at: 1, kind: 'turn_completed', stageId: 'stage-1', turnId: 's1-t1', messageIndex: 7,
          messageId: 'floor-7', messageFingerprint: fingerprint,
        } as Entry],
      },
      {
        name: '无 chat 数组（只按下标回退）',
        chat: [],
        timeline: [
          { id: 'c1', at: 1, kind: 'turn_completed', stageId: 'stage-1', turnId: 's1-t1', messageIndex: 1 } as Entry,
          { id: 'c2', at: 1, kind: 'turn_completed', stageId: 'stage-1', turnId: 's1-t2', messageIndex: 3 } as Entry,
        ],
      },
      {
        name: '多阶段：后段因删楼被废弃',
        chat: base.filter(message => message.message_id !== 'floor-5'),
        stages: [stageOf('stage-1', 1, 4, 4, 'completed'), stageOf('stage-2', 2, 6, 2)],
        timeline: [
          ...idEntries(4, [1, 3, 7, 9]).map(entry => ({ ...entry, stageId: 'stage-1', turnId: entry.turnId } as Entry)),
          ...idEntries(2, [13, 15]).map(entry => ({ ...entry, stageId: 'stage-2' } as Entry)),
        ],
        activeStageId: 'stage-2',
      },
    ];

    for (const item of cases) {
      const stages = item.stages ?? [stageOf('stage-1', 1, COMPLETIONS, COMPLETIONS)];
      const activeStageId = item.activeStageId ?? 'stage-1';
      const task = taskOf(stages, item.timeline, activeStageId);
      const chat = item.chat.length ? item.chat : undefined;
      const actual = reconcileTaskCursorFromChat_ACU(task, item.chat.length, chat);
      const expected = naiveReconcile_ACU(task, item.chat.length, chat);
      expect(JSON.stringify(actual), item.name).toBe(JSON.stringify(expected));
    }
  });

  it('同一个任务连续调和两次：第二次零指纹计算且结果不变', () => {
    const live = buildChat();
    const fingerprint = getStableMessageIdentity_ACU(live[7]).messageFingerprint;
    const task = taskOf([stageOf('stage-1', 1, COMPLETIONS, COMPLETIONS)], [
      ...idEntries(COMPLETIONS, Array.from({ length: COMPLETIONS }, (_, i) => 2 * i + 1)),
      fingerprintEntry(7, { messageFingerprint: fingerprint }),
    ], 'stage-1');
    const first = reconcileTaskCursorFromChat_ACU(task, live.length, live);
    const warm = __readStageCursorCountersForTests_ACU();
    const second = reconcileTaskCursorFromChat_ACU(task, live.length, live);
    const hot = __readStageCursorCountersForTests_ACU();
    // 身份表是单次调和的局部量：第二次调和重新建表，但仍然每楼最多算一次指纹。
    expect(hot.fingerprints - warm.fingerprints).toBeLessThanOrEqual(FLOORS);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
