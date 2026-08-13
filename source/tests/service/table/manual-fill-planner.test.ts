import { describe, expect, it } from 'vitest';
import { planManualCatchUpWaves_ACU } from '../../../src/service/table/manual-fill-planner';

const aiIndices = Array.from({ length: 70 }, (_value, index) => index * 2 + 1);

function sheet(sheetKey: string, lastCompletedAiFloor: number, overrides: Record<string, unknown> = {}) {
  return {
    sheetKey,
    lastCompletedAiFloor,
    groupId: 0,
    batchSize: 2,
    requestOptions: null,
    ...overrides,
  };
}

describe('planManualCatchUpWaves_ACU', () => {
  it('按后缀缺口切分 wave：A 20~70 后再以 A+B 追平 40~70', () => {
    const plan = planManualCatchUpWaves_ACU(aiIndices, [
      sheet('sheet_a', 19),
      sheet('sheet_b', 39),
    ]);

    expect(plan.targetAiFloor).toBe(70);
    expect(plan.targetMessageIndex).toBe(139);
    expect(plan.waves).toHaveLength(2);
    expect(plan.waves[0]).toMatchObject({
      startAiFloor: 20,
      endAiFloor: 39,
      sheetKeys: ['sheet_a'],
      messageIndices: aiIndices.slice(19, 39),
    });
    expect(plan.waves[1]).toMatchObject({
      startAiFloor: 40,
      endAiFloor: 70,
      sheetKeys: ['sheet_a', 'sheet_b'],
      messageIndices: aiIndices.slice(39, 70),
    });
    expect(plan.waves[1].groups[0].sheetKeys).toEqual(['sheet_a', 'sheet_b']);
  });

  it('表均已追平时不产生 wave', () => {
    const plan = planManualCatchUpWaves_ACU(aiIndices.slice(0, 3), [sheet('sheet_a', 3)]);

    expect(plan.waves).toEqual([]);
  });

  it('相同 groupId 但请求配置不同必须拆组', () => {
    const plan = planManualCatchUpWaves_ACU(aiIndices.slice(0, 2), [
      sheet('sheet_a', 0, { requestOptions: { tableApiPreset: 'fast' } }),
      sheet('sheet_b', 0, { requestOptions: { tableApiPreset: 'slow' } }),
    ]);

    expect(plan.waves).toHaveLength(1);
    expect(plan.waves[0].groups).toHaveLength(2);
    expect(plan.waves[0].groups.map(group => group.sheetKeys)).toEqual([['sheet_a'], ['sheet_b']]);
  });

  it('同一输入生成稳定签名，输入排序不影响计划', () => {
    const inputs = [sheet('sheet_b', 1), sheet('sheet_a', 0)];
    const first = planManualCatchUpWaves_ACU(aiIndices.slice(0, 3), inputs);
    const second = planManualCatchUpWaves_ACU(aiIndices.slice(0, 3), [...inputs].reverse());

    expect(second).toEqual(first);
  });
});
