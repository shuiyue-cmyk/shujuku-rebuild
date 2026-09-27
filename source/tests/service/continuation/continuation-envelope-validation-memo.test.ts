/**
 * tests/service/continuation/continuation-envelope-validation-memo.test.ts
 *
 * 性能优化第二批 · P1-l「read 漏斗：信封深校验记忆化」判别测试。
 *
 * 三条红线：
 * 1. 连续两次 read 的全量深校验次数必须塌到 1（冷路径那一次），第二次零深校验；
 * 2. 记忆化的是「校验结论」，交给调用方的永远是私有对象图——外部就地改返回值不得污染后续读；
 * 3. 写路径整体替换字段对象后必须重新深校验（引用键天然失效），且校验幂等：
 *    validate(validate(x)) 与 validate(x) 逐字段相等，read 漏斗省掉的那次重复深校验才安全。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __readContinuationEnvelopeCountersForTests_ACU,
  __resetContinuationEnvelopeCachesForTests_ACU,
  CONTINUATION_FIRST_FLOOR_FIELD_ACU,
  FirstFloorContinuationStore_ACU,
  derivePausedContinuationEnvelopeAfterReload_ACU,
  validateContinuationEnvelope_ACU,
} from '../../../src/service/continuation/continuation-store';
import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';
import { reconcileContinuationEnvelopeCursor_ACU } from '../../../src/service/continuation/stage-cursor';
import type { ContinuationEnvelope_ACU } from '../../../src/service/continuation/model';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

function buildEnvelope(): ContinuationEnvelope_ACU {
  return { schemaVersion: 1, settings: buildDefaultContinuationSettings_ACU(), activeTask: null };
}

function buildRunningEnvelope(): ContinuationEnvelope_ACU {
  const envelope = buildEnvelope();
  envelope.activeTask = {
    taskId: 'task-1',
    originInstruction: '推进剧情',
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    runStartedAt: 1,
    deadlineAt: null,
    runStageCount: 1,
    activeStageId: 'stage-1',
    stages: [{
      stageId: 'stage-1',
      stageNumber: 1,
      status: 'running',
      chronicleStartCount: 0,
      chronicleEndCount: null,
      chronicleAddedCount: null,
      chronicleRange: null,
      activeRevision: 1,
      revisions: [{
        revision: 1,
        createdAt: 1,
        reason: 'initial',
        replanInstruction: '',
        frozen: true,
        outline: {
          schemaVersion: 1,
          title: '阶段',
          goal: '目标',
          totalTurns: 6,
          nodes: [{ id: 'node-1', title: '节点', goal: '节点目标', suggestedTurns: 6, turns: Array.from({ length: 6 }, (_, index) => ({ id: `turn-${index + 1}`, goal: `轮次 ${index + 1}` })) }],
        },
      }],
      activeNodeIndex: 0,
      activeTurnIndex: 0,
      completedTurns: 0,
    }],
    timeline: [],
    stopReason: null,
    lastError: null,
  } as ContinuationEnvelope_ACU['activeTask'];
  return envelope;
}

function mountStore(envelope: ContinuationEnvelope_ACU | null): { store: FirstFloorContinuationStore_ACU; chat: any[]; saveChat: ReturnType<typeof vi.fn> } {
  const chat: any[] = [envelope === null ? {} : { [CONTINUATION_FIRST_FLOOR_FIELD_ACU]: envelope }];
  const saveChat = vi.fn().mockResolvedValue(undefined);
  _set_SillyTavern_API_ACU({ chat, chatId: 'chat-a', getCurrentChatId: () => 'chat-a', saveChat } as any);
  return { store: new FirstFloorContinuationStore_ACU(), chat, saveChat };
}

function counters() { return __readContinuationEnvelopeCountersForTests_ACU(); }

function diffValidations(before: number): number {
  return counters().envelopeValidations - before;
}

beforeEach(() => {
  _set_SillyTavern_API_ACU(undefined);
  vi.spyOn(Date, 'now').mockReturnValue(1790497297995);
  __resetContinuationEnvelopeCachesForTests_ACU();
});

describe('P1-l 信封深校验记忆化：read 漏斗', () => {
  it('连续两次 read：深校验 4→3（readRawEnvelope 那一遍被记忆化）', () => {
    const { store } = mountStore(buildRunningEnvelope());
    // 旧实现：每次 read 两遍全量深校验（readRawEnvelope + 派生重载暂停态），两次共 4 次。
    // 新实现：readRawEnvelope 命中记忆化，派生那一遍仍跑（它有真实副作用，见下条），两次共 3 次。
    const first = store.read();
    const afterCold = counters().envelopeValidations;
    expect(afterCold).toBe(2);
    const second = store.read();
    expect(diffValidations(afterCold)).toBe(1);
    expect(counters().envelopeMemoHits).toBe(1);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('read 输出与朴素两遍校验参考实现逐字段相等（差分）', () => {
    const envelope = buildRunningEnvelope();
    const { store, chat } = mountStore(envelope);
    const naive = reconcileContinuationEnvelopeCursor_ACU(
      derivePausedContinuationEnvelopeAfterReload_ACU(validateContinuationEnvelope_ACU(chat[0][CONTINUATION_FIRST_FLOOR_FIELD_ACU])),
      chat.length,
      chat as any,
    );
    expect(JSON.stringify(store.read())).toBe(JSON.stringify(naive));
  });

  it('readPersisted 连续两次只深校验一次', () => {
    const { store } = mountStore(buildRunningEnvelope());
    store.readPersisted();
    const afterCold = counters().envelopeValidations;
    expect(afterCold).toBe(1);
    store.readPersisted();
    expect(diffValidations(afterCold)).toBe(0);
  });

  it('派生那一遍深校验有真实副作用（洗掉 inferred 标记），不得当成冗余删掉', () => {
    // 大纲校验对缺失的软字段补默认并打 inferred 标记；对已补齐的对象再校验一次不会重新打标。
    // read 漏斗正是靠第二遍把 inferred 洗掉，所以记忆化只覆盖 readRawEnvelope 这一遍。
    const envelope = buildRunningEnvelope();
    const once = validateContinuationEnvelope_ACU(envelope);
    const turns = (once.activeTask as any).stages[0].revisions[0].outline.nodes[0].turns as Array<{ inferred?: string[] }>;
    expect(turns[0].inferred).toEqual(['function', 'mainlineDelta', 'timeAdvance']);
    const twice = validateContinuationEnvelope_ACU(once);
    const twiceTurns = (twice.activeTask as any).stages[0].revisions[0].outline.nodes[0].turns as Array<{ inferred?: string[] }>;
    expect(twiceTurns[0].inferred).toBeUndefined();
    // 记忆化不得把这份差异吞掉：read() 与朴素两遍校验的输出必须逐字段相等。
    const { store } = mountStore(envelope);
    const readTurns = ((store.read()!.activeTask as any).stages[0].revisions[0].outline.nodes[0].turns) as Array<{ inferred?: string[] }>;
    expect(readTurns[0].inferred).toBeUndefined();
  });

  it('记忆化的是校验结论：外部就地改返回值不得污染后续读', () => {
    const { store } = mountStore(buildRunningEnvelope());
    const first = store.readPersisted()!;
    first.settings.maxTurnsPerStage = 999;
    ((first.activeTask as any).stages)[0].status = 'abandoned';
    const second = store.readPersisted()!;
    expect(second.settings.maxTurnsPerStage).not.toBe(999);
    expect((second.activeTask as any).stages[0].status).toBe('running');
  });

  it('两次 read 交出的是不同对象图', () => {
    const { store } = mountStore(buildRunningEnvelope());
    const first = store.readPersisted()!;
    const second = store.readPersisted()!;
    expect(second).not.toBe(first);
    expect((second.activeTask as any).stages).not.toBe((first.activeTask as any).stages);
  });

  it('写路径整体替换字段对象后必须重新深校验', async () => {
    const { store, chat } = mountStore(buildRunningEnvelope());
    store.read();
    const beforeWrite = counters().envelopeValidations;
    const next = buildRunningEnvelope();
    (next.activeTask as any).originInstruction = '改写后的要求';
    await store.replaceAtomically(next);
    expect(chat[0][CONTINUATION_FIRST_FLOOR_FIELD_ACU]).not.toBe(next);
    // 读到的必须是新值，而不是记忆化里的旧结论。
    expect((store.readPersisted()!.activeTask as any).originInstruction).toBe('改写后的要求');
    expect(diffValidations(beforeWrite)).toBeGreaterThanOrEqual(1);
  });

  it('首楼被整体换新（宿主重载聊天）后同样重新深校验', () => {
    const { store, chat } = mountStore(buildRunningEnvelope());
    store.readPersisted();
    const afterCold = counters().envelopeValidations;
    const fresh = buildRunningEnvelope();
    (fresh.activeTask as any).originInstruction = '重载后的要求';
    chat[0] = { [CONTINUATION_FIRST_FLOOR_FIELD_ACU]: fresh };
    expect((store.readPersisted()!.activeTask as any).originInstruction).toBe('重载后的要求');
    expect(diffValidations(afterCold)).toBe(1);
  });

  it('损坏信封仍然每次都深校验并抛出（记忆化不得吞掉校验）', () => {
    const broken = { schemaVersion: 1, settings: undefined, activeTask: null };
    const { store } = mountStore(broken as unknown as ContinuationEnvelope_ACU);
    expect(() => store.readPersisted()).toThrow();
    const afterFirst = counters().envelopeValidations;
    expect(() => store.readPersisted()).toThrow();
    expect(diffValidations(afterFirst)).toBe(1);
  });

  it('对外 derive 入口仍接受未校验入参（契约不变）', () => {
    const derived = derivePausedContinuationEnvelopeAfterReload_ACU(buildRunningEnvelope() as ContinuationEnvelope_ACU);
    expect(derived.activeTask?.status).toBe('paused');
    expect(() => derivePausedContinuationEnvelopeAfterReload_ACU({ schemaVersion: 1 } as any)).toThrow();
  });
});
