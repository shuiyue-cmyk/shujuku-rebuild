/**
 * tests/service/continuation/agent/agent-module-frame-fold-memo.test.ts
 *
 * 性能优化第二批 · P0-5「资料帧写路径去冗余折叠」判别测试。
 *
 * 三条红线：
 * 1. 折叠次数与逐楼深度解析次数必须从旧值降到新值（先量旧值再钉，见用例注释里的实测数字）；
 * 2. 记忆化不得改变任何折叠/规划输出——与「每次都冷解析」的朴素路径逐字相等；
 * 3. 深度校验与「保存后回读」崩溃门一次都不许省：换新对象的楼层必须重新深度解析。
 *
 * 记忆化键的不变式（全仓 grep 实证）：对 `_qrf_continuation_agent` 的写入只有
 * writeFrame_ACU / agent-module-store 的 assignment 提交 / clearAgentModuleField，
 * 三者都是整对象替换或 delete，不存在原地 mutation；因此引用相同即内容相同。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __readAgentModuleFrameCountersForTests_ACU,
  __resetAgentModuleFrameCachesForTests_ACU,
  foldAgentModuleSnapshot_ACU,
  planAgentModuleFieldWrite_ACU,
  planAgentModuleSnapshotWrite_ACU,
} from '../../../../src/service/continuation/agent/agent-module-frame';
import {
  AGENT_MODULE_FIELD_ACU,
  AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
  type AgentModuleFrameDeps_ACU,
  type AgentModuleSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-model';
import {
  agentModuleFrameDeps_ACU,
  buildEmptyAgentModuleSnapshot_ACU,
  commitAgentModuleFieldWrites_ACU,
  readAgentModuleFieldSnapshot_ACU,
  writeAgentModuleSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-module-store';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

/** 固定时间戳：帧 delta 的 updatedAt 由 Date.now() 决定，差分比对需要逐字一致。 */
const FROZEN_NOW = 1756252800000;
const FLOOR_COUNT = 12;

function hook(id: string) {
  return { id, summary: `伏笔 ${id}`, status: 'planted', importance: 'mid', plantedIndex: 1, updatedIndex: 1, plannedPayoff: '', retired: false, retiredReason: '' };
}

/** 累积式快照：每多一层就多一条 hook，保证每次写入都真产生 delta（否则楼层不带字段）。 */
function cumulativeSnapshot(settledThroughIndex: number): AgentModuleSnapshot_ACU {
  return {
    ...buildEmptyAgentModuleSnapshot_ACU(),
    settledThroughIndex,
    hooks: Array.from({ length: settledThroughIndex + 1 }, (_, index) => hook(`H${index + 1}`)) as never,
  };
}

function freshChat(): any[] {
  return Array.from({ length: FLOOR_COUNT }, (_, index) => ({ mes: `m${index}`, is_user: false }));
}

function counters(): { folds: number; fieldParses: number; fieldMemoHits: number } {
  return __readAgentModuleFrameCountersForTests_ACU();
}

/** 计数器差值：__reset 会连同记忆化一起清掉，测量单次操作只能取差。 */
function diff(before: ReturnType<typeof counters>): ReturnType<typeof counters> {
  const after = counters();
  return {
    folds: after.folds - before.folds,
    fieldParses: after.fieldParses - before.fieldParses,
    fieldMemoHits: after.fieldMemoHits - before.fieldMemoHits,
  };
}

async function buildHistory(chat: any[]): Promise<void> {
  for (let index = 0; index < chat.length; index += 1) {
    await writeAgentModuleSnapshot_ACU(chat, index, cumulativeSnapshot(index));
  }
}

/** 与上一次写入内容不同的一次写入（否则语义未变，规划直接判 changed=false）。 */
function nextSnapshot(settledThroughIndex: number): AgentModuleSnapshot_ACU {
  return {
    ...buildEmptyAgentModuleSnapshot_ACU(),
    settledThroughIndex,
    hooks: Array.from({ length: settledThroughIndex + 2 }, (_, index) => hook(`H${index + 1}`)) as never,
  };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  __resetAgentModuleFrameCachesForTests_ACU();
});

describe('P0-5 折叠记忆化：整条快照写入路径', () => {
  it('单次写入的折叠次数 2→1、逐楼深度解析次数 38→1', async () => {
    const chat = freshChat();
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await buildHistory(chat);
    // 旧实现实测（同 fixture）：folds=2，fieldParses=38
    // = 复核折叠 12 + 规划内折叠 12 + maxSeq 扫描 12 + 可用基线探测 1 + 追加 delta 读帧 1。
    // 新实现：复核折叠与规划共用同一次折叠（folds=1），序号取该次折叠的 maxDeltaSeq，
    // 11 个未变楼层的帧对象引用未变→全部命中记忆化；只有上一步刚被换新的末楼需要重新深度解析。
    const before = counters();
    await writeAgentModuleSnapshot_ACU(chat, FLOOR_COUNT - 1, nextSnapshot(FLOOR_COUNT - 1));
    const measured = diff(before);
    expect(measured.folds).toBe(1);
    expect(measured.fieldParses).toBe(1);
    expect(measured.fieldMemoHits).toBeGreaterThanOrEqual(FLOOR_COUNT);
  });

  it('记忆化与「每次冷解析」的朴素路径落盘结果逐字相等', async () => {
    // chatA：走记忆化热路径；chatB：每次写入前清空记忆化，等价于旧实现的无缓存路径。
    const chatA = freshChat();
    _set_SillyTavern_API_ACU({ chat: chatA, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await buildHistory(chatA);

    const chatB = freshChat();
    _set_SillyTavern_API_ACU({ chat: chatB, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    for (let index = 0; index < chatB.length; index += 1) {
      __resetAgentModuleFrameCachesForTests_ACU();
      await writeAgentModuleSnapshot_ACU(chatB, index, cumulativeSnapshot(index));
    }
    expect(JSON.stringify(chatB)).toBe(JSON.stringify(chatA));
  });

  it('折叠结果与换 deps 实例强制冷解析的参考实现逐字相等', async () => {
    const chat = freshChat();
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await buildHistory(chat);
    const warm = foldAgentModuleSnapshot_ACU(chat, agentModuleFrameDeps_ACU());
    const again = foldAgentModuleSnapshot_ACU(chat, agentModuleFrameDeps_ACU());
    // 新的 deps 实例 = 记忆化的外层键不同 = 强制冷解析，等价于朴素参考实现。
    const cold = foldAgentModuleSnapshot_ACU(chat, { ...agentModuleFrameDeps_ACU() });
    expect(JSON.stringify(again)).toBe(JSON.stringify(warm));
    expect(JSON.stringify(cold)).toBe(JSON.stringify(warm));
    expect(warm.maxDeltaSeq).toBe(cold.maxDeltaSeq);
  });

  it('写路径换新帧对象：记忆化按引用天然失效，下一次读取重新深度解析', async () => {
    const chat = freshChat();
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await buildHistory(chat);
    readAgentModuleFieldSnapshot_ACU(chat);
    const frameBefore = chat[FLOOR_COUNT - 1][AGENT_MODULE_FIELD_ACU];
    const before = counters();
    await writeAgentModuleSnapshot_ACU(chat, FLOOR_COUNT - 1, nextSnapshot(FLOOR_COUNT - 1));
    // 读入口刚折叠过全部楼层，本次写入全程命中记忆化。
    expect(diff(before).fieldParses).toBe(0);
    // 帧对象被整体替换（不是原地改写）——记忆化必须因此失效。
    expect(chat[FLOOR_COUNT - 1][AGENT_MODULE_FIELD_ACU]).not.toBe(frameBefore);
    const afterWrite = counters();
    readAgentModuleFieldSnapshot_ACU(chat);
    expect(diff(afterWrite).fieldParses).toBe(1);
  });

  it('前缀指纹失配的诊断不被记忆化污染：连续两次折叠判定逐字一致', async () => {
    // 折叠会把「前缀指纹失配」文案 push 进 candidates[].problems，而 problems 又参与
    // valid 判定；若记忆化直接共享同一个数组，第二次折叠就会把同一帧误判成 invalid
    // （帧损坏门会拒写本可写入的聊天）。
    const broken = {
      ...buildEmptyAgentModuleSnapshot_ACU(),
      settledThroughIndex: 0,
      settledPrefixFingerprint: 'not-the-real-fingerprint',
    };
    const chat: any[] = [{
      mes: 'm0',
      is_user: false,
      swipe_id: 0,
      [AGENT_MODULE_FIELD_ACU]: {
        schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
        deltas: [],
        checkpoint: { swipeId: '0', snapshot: broken },
      },
    }];
    const deps: AgentModuleFrameDeps_ACU = agentModuleFrameDeps_ACU();
    const first = foldAgentModuleSnapshot_ACU(chat, deps);
    const second = foldAgentModuleSnapshot_ACU(chat, deps);
    expect(first.candidates).toEqual([{
      index: 0,
      valid: true,
      problems: ['结算水位之前的聊天前缀已变化（删楼、替换或重排），拒绝复用此基线'],
    }]);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('P0-5 折叠记忆化：逐栏写入与崩溃门', () => {
  it('逐栏写入的 delta 序号仍来自深度解析（规划内不折叠，不得走廉价直读）', async () => {
    const chat = freshChat();
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await buildHistory(chat);
    const before = counters();
    const result = planAgentModuleFieldWrite_ACU(
      chat,
      FLOOR_COUNT - 1,
      { hooks: { P1: { summary: { value: '草稿' } } } },
      agentModuleFrameDeps_ACU(),
    );
    expect(result.changed).toBe(true);
    const seqs = result.assignments.flatMap(item => (item.value as { deltas: Array<{ seq: number }> }).deltas.map(delta => delta.seq));
    // 深度解析口径：序号必须严格大于全聊天已有的最大 delta 序号。
    expect(Math.max(...seqs)).toBe(FLOOR_COUNT);
    // 深度解析仍在跑（只是命中记忆化，不再重复 applyDelta/validate/clone）。
    expect(diff(before).fieldParses).toBe(1);
  });

  it('融合提交：保存后回读门对刚写入的楼层重新深度解析一次，其余楼层命中记忆化', async () => {
    const chat = freshChat();
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await buildHistory(chat);
    // 生产形态：提交前先做过一次权威读取（$FIELD / 提示词组装），记忆化已是热的。
    readAgentModuleFieldSnapshot_ACU(chat);
    const before = counters();
    const receipt = await commitAgentModuleFieldWrites_ACU({
      chat,
      targetIndex: FLOOR_COUNT - 1,
      sql: "INSERT INTO hooks (id, expected_revision, summary) VALUES ('HF1', 0, '融合提交')",
      role: 'hook-cognition-maintainer',
    });
    const measured = diff(before);
    expect(receipt.status).toBe('committed');
    // 崩溃门（:1129 保存后回读）必须真解析：目标楼层换了新帧对象 → 恰好 1 次深度解析。
    expect(measured.fieldParses).toBe(1);
    expect(measured.folds).toBe(2);
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.HF1?.fields.summary.value).toBe('融合提交');
  });
});

describe('P0-5 规划基线自检：折叠来源必须是同一条 chat', () => {
  it('传入「另一条更长聊天」的折叠结果时重新折叠，规划输出与本 chat 的真实折叠逐字相等', async () => {
    const chat = freshChat();
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await buildHistory(chat);

    // 一条更长、delta 序号更高的聊天：折它的结果若被误传给本 chat 规划，delta 序号会整体抬高。
    const longer = Array.from({ length: FLOOR_COUNT + 4 }, (_, index) => ({ mes: `L${index}`, is_user: false }));
    _set_SillyTavern_API_ACU({ chat: longer, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await buildHistory(longer);
    const foreignFold = foldAgentModuleSnapshot_ACU(longer, agentModuleFrameDeps_ACU());
    // 可观测特征已经变了：帧落点改成「≤ targetIndex 的最近 AI 楼」之后，外来基线也落在本 chat 的
    // 下标范围内（逐楼写入的历史恒落在第 0 楼），checkpointIndex 越界这个旧判据不再成立。
    // 现在的判据是来源身份（楼层数 + 尾楼对象引用）。
    expect(foreignFold.checkpointIndex, '旧的越界特征已消失，正是本用例要防的静默采纳').toBeLessThan(chat.length);
    expect(foreignFold.chatLength).toBeGreaterThan(chat.length);
    expect(foreignFold.tailFloor).not.toBe(chat[chat.length - 1]);

    const deps = agentModuleFrameDeps_ACU();
    const next = nextSnapshot(FLOOR_COUNT - 1);
    const reference = planAgentModuleSnapshotWrite_ACU(
      chat, FLOOR_COUNT - 1, next, deps, null, foldAgentModuleSnapshot_ACU(chat, deps),
    );
    const before = counters();
    const guarded = planAgentModuleSnapshotWrite_ACU(chat, FLOOR_COUNT - 1, next, deps, null, foreignFold);
    expect(guarded).toEqual(reference);
    // 自检命中 → 恰好重新折叠一次（而不是静默接受外来基线）。
    expect(diff(before).folds).toBe(1);
  });

  /**
   * 长度相同、内容同形的另一条聊天：越界与长度两个判据都失效，只剩尾楼对象身份能认出它是外来的。
   * 旧的「只看 checkpointIndex 范围」实现在这里会静默采纳外来基线（重折 0 次）。
   */
  it('同长度的另一条聊天：靠尾楼对象身份识别外来折叠，仍恰好重折一次', async () => {
    const chat = freshChat();
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await buildHistory(chat);

    const twin = freshChat();
    _set_SillyTavern_API_ACU({ chat: twin, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await buildHistory(twin);
    // 多写一轮，让 twin 的 maxDeltaSeq 与本 chat 不同：否则「规划输出逐字相等」成了恒真式，
    // 判别力会全压在折叠计数那一条上。
    await writeAgentModuleSnapshot_ACU(twin, FLOOR_COUNT - 1, nextSnapshot(FLOOR_COUNT - 1));
    const foreignFold = foldAgentModuleSnapshot_ACU(twin, agentModuleFrameDeps_ACU());
    expect(foreignFold.chatLength).toBe(chat.length);
    expect(foreignFold.checkpointIndex).toBeLessThan(chat.length);
    expect(foreignFold.tailFloor).not.toBe(chat[chat.length - 1]);
    expect(foreignFold.maxDeltaSeq).not.toBe(foldAgentModuleSnapshot_ACU(chat, agentModuleFrameDeps_ACU()).maxDeltaSeq);

    const deps = agentModuleFrameDeps_ACU();
    const next = nextSnapshot(FLOOR_COUNT - 1);
    const reference = planAgentModuleSnapshotWrite_ACU(
      chat, FLOOR_COUNT - 1, next, deps, null, foldAgentModuleSnapshot_ACU(chat, deps),
    );
    const before = counters();
    const guarded = planAgentModuleSnapshotWrite_ACU(chat, FLOOR_COUNT - 1, next, deps, null, foreignFold);
    expect(guarded).toEqual(reference);
    expect(diff(before).folds).toBe(1);
  });
});
