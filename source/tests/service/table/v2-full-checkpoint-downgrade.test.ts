/**
 * v2-full-checkpoint-downgrade — 单根不变量的共用降级工具。
 * G04-04 回归：降级 fallback entry 必须把 checkpoint 的 restoreUpToAiFloor 导入声明
 * 原样带过去（对齐 chat-service 轮转降级的双胞胎修复，上游 issue #18 第五条），
 * 否则追平前沿会跳回该帧楼层，「已追平」误报在下一次边界轮转后复现。
 */
import { describe, expect, it } from 'vitest';
import { downgradeOtherFullCheckpoints_ACU } from '../../../src/service/table/v2-full-checkpoint-downgrade';

function data(rows: any[][] = [['1', '铁剑']]) {
  return { mate: { type: 'acu', version: 1 }, sheet_0: { uid: 'inventory', name: '背包', content: [['row_id', '名称'], ...rows], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 } } as any;
}
function frame(checkpoint: any, logEntries: any[] = []) {
  return { version: 2, checkpoint, logEntries };
}
function aiMessage(storageFrame: any) {
  return { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame } } };
}

describe('downgradeOtherFullCheckpoints_ACU（G04-04）', () => {
  it('带 restoreUpToAiFloor 声明的导入根降级时把声明原样带过，且保留 import 语义', () => {
    const chat = [
      aiMessage(frame({ kind: 'full', createdAt: 5, reason: 'import', data: data(), restoreUpToAiFloor: 7 })),
      aiMessage(frame({ kind: 'full', createdAt: 9, reason: 'init', data: data([['2', '新根']]) })),
    ];

    const downgraded = downgradeOtherFullCheckpoints_ACU(chat, '', 1);

    expect(downgraded).toBe(1);
    const frame0 = chat[0].TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame0.checkpoint).toBeUndefined();
    expect(frame0.logEntries).toHaveLength(1);
    expect(frame0.logEntries[0]).toMatchObject({
      source: 'import',
      targetMessageIndex: 0,
      restoreUpToAiFloor: 7,
      operations: [{ kind: 'data_replace', reason: 'import' }],
    });
    // keepIndex 的根帧保持不动
    expect(chat[1].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint?.kind).toBe('full');
  });

  it('反向对照：无声明或声明非法（0/NaN）时降级 entry 不凭空长出 restoreUpToAiFloor', () => {
    const chat = [
      aiMessage(frame({ kind: 'full', createdAt: 1, reason: 'init', data: data() })),
      aiMessage(frame({ kind: 'full', createdAt: 2, reason: 'init', data: data(), restoreUpToAiFloor: 0 })),
      aiMessage(frame({ kind: 'full', createdAt: 3, reason: 'init', data: data([['2', '新根']]) })),
    ];

    const downgraded = downgradeOtherFullCheckpoints_ACU(chat, '', 2);

    expect(downgraded).toBe(2);
    for (const index of [0, 1]) {
      const entry = chat[index].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0];
      expect(entry).not.toHaveProperty('restoreUpToAiFloor');
      expect(entry.source).toBe('system');
    }
  });
});
