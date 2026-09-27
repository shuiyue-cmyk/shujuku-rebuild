/**
 * tests/shared/ai-floor.test.ts
 * 聊天消息三档判定（宽档 AI 楼 / 窄档模型产出楼 / 数据承载档）的判据锁定。
 *
 * 背景：TT 2.3.0 把工具调用结果升为一等楼层 `{role:'tool', is_system:true}`；
 * `is_system` 本义是「隐藏消息」（可被 /unhide 清掉）⇒ 两个位都要看。
 * 数据承载档刻意**不排除**隐藏楼与工具楼：被隐藏的 AI 楼仍可能挂着本库的表数据。
 */
import { describe, expect, it } from 'vitest';
import {
  isAiFloor_ACU,
  countAiFloors_ACU,
  isAiModelOutputFloor_ACU,
  countAiModelOutputFloors_ACU,
  isDataBearingMessage_ACU,
} from '../../src/shared/ai-floor';

const user = { is_user: true, mes: '用户' };
const ai = { is_user: false, mes: 'AI', name: '角色A' };
const narrator = { is_user: false, mes: '旁白', extra: { type: 'narrator' } };
// TT 2.3.0 一等工具楼：带 is_system、无 extra
const toolFloor = { role: 'tool', is_system: true, is_user: false, mes: '搜索结果', tool_call_id: 'call_1' };
// 被 /unhide 过的工具楼：隐藏位已清、只剩类型位
const unhiddenToolFloor = { role: 'tool', is_system: false, is_user: false, mes: '搜索结果' };
// is_system 本义是「隐藏消息」
const hiddenFloor = { is_user: false, is_system: true, mes: '隐藏楼' };

describe('isAiFloor_ACU（宽档：含 narrator，排除隐藏楼与工具楼）', () => {
  it('AI 楼为真', () => expect(isAiFloor_ACU(ai)).toBe(true));
  it('用户楼为假', () => expect(isAiFloor_ACU(user)).toBe(false));
  it('narrator 旁白计入（宽档既存口径）', () => expect(isAiFloor_ACU(narrator)).toBe(true));
  it('隐藏楼（is_system）不计入', () => expect(isAiFloor_ACU(hiddenFloor)).toBe(false));
  it('工具楼（role:tool + is_system）不计入', () => expect(isAiFloor_ACU(toolFloor)).toBe(false));
  it('被 /unhide 过的工具楼仍不计入（类型位独立生效）', () => {
    expect(isAiFloor_ACU(unhiddenToolFloor)).toBe(false);
  });
  it('null / 非对象为假', () => {
    expect(isAiFloor_ACU(null)).toBe(false);
    expect(isAiFloor_ACU(undefined)).toBe(false);
    expect(isAiFloor_ACU('x')).toBe(false);
    expect(isAiFloor_ACU(0)).toBe(false);
  });
});

describe('countAiFloors_ACU（宽档计数）', () => {
  it('含 narrator，但排除隐藏楼与工具楼', () => {
    expect(countAiFloors_ACU([user, ai, narrator, ai])).toBe(3);
    expect(countAiFloors_ACU([user, ai, toolFloor, hiddenFloor, ai])).toBe(2);
  });
  it('非数组返回 0', () => expect(countAiFloors_ACU(null as any)).toBe(0));
});

describe('isAiModelOutputFloor_ACU（窄档：再排除 narrator）', () => {
  it('AI 楼为真', () => expect(isAiModelOutputFloor_ACU(ai)).toBe(true));
  it('用户楼为假', () => expect(isAiModelOutputFloor_ACU(user)).toBe(false));
  it('narrator 旁白不计入', () => expect(isAiModelOutputFloor_ACU(narrator)).toBe(false));
  it('隐藏楼与工具楼不计入', () => {
    expect(isAiModelOutputFloor_ACU(hiddenFloor)).toBe(false);
    expect(isAiModelOutputFloor_ACU(toolFloor)).toBe(false);
  });
});

describe('countAiModelOutputFloors_ACU（窄档计数）', () => {
  it('排除用户、旁白、隐藏楼与工具楼', () => {
    expect(countAiModelOutputFloors_ACU([user, ai, narrator, ai])).toBe(2);
    expect(countAiModelOutputFloors_ACU([user, ai, toolFloor, hiddenFloor, ai])).toBe(2);
  });
  it('非数组返回 0', () => expect(countAiModelOutputFloors_ACU(null as any)).toBe(0));
});

describe('isDataBearingMessage_ACU（数据承载档：任意非 user 消息）', () => {
  it('AI 楼可承载数据', () => expect(isDataBearingMessage_ACU(ai)).toBe(true));
  it('narrator 可承载数据', () => expect(isDataBearingMessage_ACU(narrator)).toBe(true));
  // 这两条是与 AI 楼口径的关键分野：被隐藏的楼/工具楼仍可能挂着本库数据，
  // 清理与快照必须覆盖它们，否则会漏清（数据留在原地）或让预校验与实际执行分叉。
  it('隐藏楼仍视为可承载数据', () => expect(isDataBearingMessage_ACU(hiddenFloor)).toBe(true));
  it('工具楼仍视为可承载数据', () => expect(isDataBearingMessage_ACU(toolFloor)).toBe(true));
  it('用户楼不可承载', () => expect(isDataBearingMessage_ACU(user)).toBe(false));
  it('null / 非对象为假', () => {
    expect(isDataBearingMessage_ACU(null)).toBe(false);
    expect(isDataBearingMessage_ACU(undefined)).toBe(false);
    expect(isDataBearingMessage_ACU('x')).toBe(false);
  });
});

/**
 * 给整条聊天数组装一个 filter 探针：一旦计数实现改回 `chat.filter(...).length`，
 * 探针就会记录到一次「为整条数组分配等长拷贝」的调用。
 * Array.prototype.filter 是普通数据属性，数组实例上的自有属性会先命中，
 * 因此探针既能观测旧实现，也能要求新实现保持零调用。
 */
function withFilterSpy(chat: any[]) {
  const probe = { filterCalls: 0, resultSizes: [] as number[] };
  Object.defineProperty(chat, 'filter', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: (predicate: (value: any, index: number, array: any[]) => unknown) => {
      probe.filterCalls += 1;
      const matched = Array.prototype.filter.call(chat, predicate);
      probe.resultSizes.push(matched.length);
      return matched;
    },
  });
  return probe;
}

function buildFloorChat(size: number): any[] {
  const chat: any[] = [];
  for (let index = 0; index < size; index += 1) {
    if (index % 4 === 0) chat.push({ is_user: true, mes: `用户 ${index}` });
    else if (index % 7 === 0) chat.push({ is_user: false, is_system: true, mes: `隐藏 ${index}` });
    else if (index % 11 === 0) chat.push({ role: 'tool', is_system: true, mes: `工具 ${index}` });
    else if (index % 13 === 0) chat.push({ is_user: false, mes: `旁白 ${index}`, extra: { type: 'narrator' } });
    else chat.push({ is_user: false, mes: `AI ${index}` });
  }
  return chat;
}

describe('计数函数不再为整条聊天数组分配拷贝（P2-1）', () => {
  it('宽档计数在 5000 楼聊天上零 filter 调用，计数与 filter 基线相等', () => {
    const chat = buildFloorChat(5000);
    const probe = withFilterSpy(chat);

    const count = countAiFloors_ACU(chat);

    expect(probe.filterCalls).toBe(0);
    expect(probe.resultSizes).toEqual([]);
    expect(count).toBe(chat.filter(isAiFloor_ACU).length);
    expect(count).toBeGreaterThan(0);
  });

  it('窄档计数同样零 filter 调用，计数与 filter 基线相等', () => {
    const chat = buildFloorChat(5000);
    const probe = withFilterSpy(chat);

    const count = countAiModelOutputFloors_ACU(chat);

    expect(probe.filterCalls).toBe(0);
    expect(count).toBe(buildFloorChat(5000).filter(isAiModelOutputFloor_ACU).length);
  });

  it('稀疏数组与非法入参下计数与旧 filter 实现一致', () => {
    const sparse = new Array(6);
    sparse[0] = { is_user: false, mes: 'AI' };
    sparse[3] = { is_user: false, mes: 'AI', extra: { type: 'narrator' } };
    sparse[5] = { is_user: true, mes: '用户' };
    expect(countAiFloors_ACU(sparse)).toBe(sparse.filter(isAiFloor_ACU).length);
    expect(countAiModelOutputFloors_ACU(sparse)).toBe(sparse.filter(isAiModelOutputFloor_ACU).length);
    expect(countAiFloors_ACU(null as any)).toBe(0);
    expect(countAiModelOutputFloors_ACU({ length: 3 } as any)).toBe(0);
  });
});
