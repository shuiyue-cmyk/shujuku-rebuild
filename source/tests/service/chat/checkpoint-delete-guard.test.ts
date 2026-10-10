/**
 * tests/service/chat/checkpoint-delete-guard.test.ts
 * S0-4 删楼 checkpoint 保管库与前移恢复 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetChatArray,
  mockSaveChatToHostStrict,
  mockRegisterPostChatSaveListener,
  mockAssertSingleFull,
  mockRunTableWriteTransaction,
  mockDeepClone,
  mockState,
} = vi.hoisted(() => ({
  mockGetChatArray: vi.fn(),
  mockSaveChatToHostStrict: vi.fn(),
  mockRegisterPostChatSaveListener: vi.fn(),
  mockAssertSingleFull: vi.fn(() => null as string | null),
  mockRunTableWriteTransaction: vi.fn(),
  mockDeepClone: vi.fn(),
  mockState: { chatKey: 'chat-a' },
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: mockGetChatArray,
  saveChatToHostStrict_ACU: mockSaveChatToHostStrict,
  registerPostChatSaveListener_ACU: mockRegisterPostChatSaveListener,
}));

vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  readIsolatedDataContainer_ACU: (msg: any) => {
    const container = msg?.TavernDB_ACU_IsolatedData;
    return container && typeof container === 'object' && !Array.isArray(container) ? container : null;
  },
  readIsolatedTagData_ACU: (msg: any, isolationKey: string) => {
    const tagData = msg?.TavernDB_ACU_IsolatedData?.[isolationKey];
    return tagData && typeof tagData === 'object' ? tagData : null;
  },
}));

vi.mock('../../../src/service/table/storage-strategy-resolver', () => ({
  isV2TagData_ACU: (tagData: any) => !!tagData
    && typeof tagData === 'object'
    && tagData.storageFrame?.version === 2
    && Array.isArray(tagData.storageFrame.logEntries),
}));

vi.mock('../../../src/service/table/storage-frame-v2-persist', () => ({
  assertSingleActiveFullCheckpointV2_ACU: mockAssertSingleFull,
}));

vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: mockRunTableWriteTransaction,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return mockState.chatKey; },
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  deepClone_ACU: mockDeepClone,
}));

import {
  captureCheckpointVaultForCurrentChat_ACU,
  recoverLostCheckpointsAfterMessageDeletion_ACU,
  installCheckpointDeleteGuard_ACU,
  noteMessagesPresentAtDeletion_ACU,
  __getCheckpointVaultForTests_ACU,
  __resetCheckpointDeleteGuardForTests_ACU,
} from '../../../src/service/chat/checkpoint-delete-guard';

function fullCheckpoint(data: Record<string, any> = { sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '剑']] } }) {
  return { kind: 'full' as const, createdAt: 1000, reason: 'compaction' as const, data };
}

function hideCheckpoint(sheetKey: string, activateAt: number) {
  return {
    kind: 'sheet_full' as const,
    createdAt: 2000,
    reason: 'compaction' as const,
    sheetKey,
    data: { name: '休眠表', content: [['row_id', '备注'], ['1', '尘封']] },
    timeline: { kind: 'sheet_hide' as const, activateAtMessageIndex: activateAt, afterSeq: 3 },
  };
}

function aiMsg(mes: string, frame?: any, tagExtras?: Record<string, any>): any {
  const msg: any = { is_user: false, mes };
  if (frame || tagExtras) {
    msg.TavernDB_ACU_IsolatedData = { '': { ...(frame ? { storageFrame: frame, _acu_storage_version: 2 } : {}), ...(tagExtras || {}) } };
  }
  return msg;
}

function userMsg(mes: string): any {
  return { is_user: true, mes };
}

function logFrame(entries: any[] = [{ seq: 1, operations: [] }]) {
  return { version: 2, logEntries: entries };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetCheckpointDeleteGuardForTests_ACU();
  mockState.chatKey = 'chat-a';
  mockSaveChatToHostStrict.mockResolvedValue(undefined);
  mockAssertSingleFull.mockReturnValue(null);
  mockRunTableWriteTransaction.mockImplementation(async (_options: any, task: any) => task());
  mockDeepClone.mockReset();
  mockDeepClone.mockImplementation((value: any) => (value == null ? value : JSON.parse(JSON.stringify(value))));
});

describe('captureCheckpointVaultForCurrentChat_ACU', () => {
  it('捕获全部隔离键的产物帧与 log-only 信标', () => {
    const chat = [
      userMsg('u'),
      aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] }),
      aiMsg('inc', logFrame()),
    ];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    const vault = __getCheckpointVaultForTests_ACU();
    expect(vault?.chatKey).toBe('chat-a');
    expect(vault?.entryCounts['']).toBe(2);
  });

  it('无 frame 的聊天捕获为空 vault', () => {
    mockGetChatArray.mockReturnValue([userMsg('u'), aiMsg('plain')]);
    captureCheckpointVaultForCurrentChat_ACU();
    expect(__getCheckpointVaultForTests_ACU()?.isolationKeys).toEqual([]);
  });
});

describe('captureCheckpointVaultForCurrentChat_ACU · 产物克隆记忆化', () => {
  function rootFrame() {
    return {
      version: 2,
      checkpoint: fullCheckpoint(),
      logEntries: [],
      perSheetCheckpoints: { sheet_9: hideCheckpoint('sheet_9', 1) },
    };
  }

  it('连续两次捕获未变的帧：第二轮零深克隆，条目集合不变', () => {
    const chat = [userMsg('u'), aiMsg('root', rootFrame()), aiMsg('inc', logFrame())];
    mockGetChatArray.mockReturnValue(chat);

    captureCheckpointVaultForCurrentChat_ACU();
    // 首轮：root 楼的 full 根 + per-sheet 锚各克隆一次，log-only 楼层零克隆。
    expect(mockDeepClone.mock.calls.length).toBe(2);
    mockDeepClone.mockClear();

    captureCheckpointVaultForCurrentChat_ACU();
    expect(mockDeepClone).not.toHaveBeenCalled();
    expect(__getCheckpointVaultForTests_ACU()?.entryCounts['']).toBe(2);
  });

  it('新增楼层只克隆新增楼层的产物，既有楼层只更新信标', () => {
    const chat = [userMsg('u'), aiMsg('root', rootFrame()), aiMsg('inc', logFrame())];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    mockDeepClone.mockClear();

    chat.push(aiMsg('tail', { version: 2, checkpoint: fullCheckpoint({ sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['2', '盾']] } }), logEntries: [] }));
    captureCheckpointVaultForCurrentChat_ACU();

    // 只为新楼层的 full 根克隆一次；旧楼层的两份产物直接复用。
    expect(mockDeepClone.mock.calls.length).toBe(1);
    expect(__getCheckpointVaultForTests_ACU()?.entryCounts['']).toBe(3);
  });

  // R3-09：chat 在锁外取得，等锁期间宿主换了聊天数组就必须放弃，不得把旧聊天产物嫁接进新聊天。
  it('等锁期间聊天数组被替换：放弃恢复，旧数组与新数组都不改写', async () => {
    const rootMsg = aiMsg('root', rootFrame());
    const incMsg = aiMsg('inc', logFrame());
    const chat = [userMsg('u'), rootMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    chat.splice(1, 1);
    const otherChat = [userMsg('x'), aiMsg('other')];
    mockRunTableWriteTransaction.mockImplementationOnce(async (_options: any, task: any) => {
      mockGetChatArray.mockReturnValue(otherChat);
      return task();
    });
    const before = JSON.stringify(incMsg);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(result.recovered).toBe(false);
    expect(JSON.stringify(incMsg)).toBe(before);
    expect(mockRunTableWriteTransaction.mock.calls[0][0].guardChatSwitch).toBe(true);
  });

  it('帧产物换新后重新深克隆，且嫁接读回的是新产物而非记忆化旧值', async () => {
    const rootMsg = aiMsg('root', rootFrame());
    const incMsg = aiMsg('inc', logFrame());
    const chat = [userMsg('u'), rootMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    mockDeepClone.mockClear();

    const nextFull = fullCheckpoint({ sheet_0: { name: '物品表', content: [['row_id', '物品名'], ['1', '斧']] } });
    rootMsg.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint = nextFull;
    rootMsg.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints = { sheet_8: hideCheckpoint('sheet_8', 4) };
    captureCheckpointVaultForCurrentChat_ACU();
    expect(mockDeepClone.mock.calls.length).toBe(2);

    chat.splice(1, 1); // 删根楼层
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(result.recovered).toBe(true);
    const frame = incMsg.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint).toEqual(nextFull);
    expect(Object.keys(frame.perSheetCheckpoints)).toEqual(['sheet_8']);
    expect(frame.perSheetCheckpoints.sheet_8.timeline.activateAtMessageIndex).toBe(chat.indexOf(incMsg));
  });

  it('per-sheet 锚被原地增删后重新克隆：记忆化不得停在旧集合', async () => {
    const rootMsg = aiMsg('root', rootFrame());
    const incMsg = aiMsg('inc', logFrame());
    const chat = [userMsg('u'), rootMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    mockDeepClone.mockClear();

    // 原地删除一张表的锚（container 引用不变，只有内容变了）。
    delete rootMsg.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_9;
    captureCheckpointVaultForCurrentChat_ACU();
    expect(mockDeepClone.mock.calls.length).toBe(1);

    chat.splice(1, 1);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(result.recovered).toBe(true);
    expect(incMsg.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints).toBeUndefined();
  });
});

describe('recoverLostCheckpointsAfterMessageDeletion_ACU', () => {
  it('删掉唯一 full 根楼层后嫁接到后继增量帧的 checkpoint 槽位', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const incMsg = aiMsg('inc', logFrame([{ seq: 5, operations: [] }]));
    const chat = [userMsg('u'), rootMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(1, 1); // 宿主删根楼层
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(result.graftedCount).toBe(1);
    const frame = incMsg.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint).toEqual(fullCheckpoint());
    // 后继帧自身的增量日志保持不变（帧内 checkpoint 先于 logs 回放）
    expect(frame.logEntries).toEqual([{ seq: 5, operations: [] }]);
    expect(mockSaveChatToHostStrict).toHaveBeenCalledTimes(1);
    expect(mockAssertSingleFull).toHaveBeenCalledWith(chat, '', 'delete_recovery');
  });

  it('删掉携带 hide checkpoint 的楼层后 per-sheet 嫁接且 timeline 重写为目标楼层', async () => {
    const hideMsg = aiMsg('hide', { version: 2, logEntries: [], perSheetCheckpoints: { sheet_9: hideCheckpoint('sheet_9', 2) } });
    const incMsg = aiMsg('inc', logFrame());
    const chat = [userMsg('u'), aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] }), hideMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(2, 1); // 删 hide 楼层
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(result.graftedCount).toBe(1);
    const grafted = incMsg.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_9;
    expect(grafted.data).toEqual(hideCheckpoint('sheet_9', 2).data);
    expect(grafted.timeline).toEqual({
      kind: 'sheet_hide',
      activateAtMessageIndex: chat.indexOf(incMsg),
      afterSeq: 0,
    });
  });

  it('删 log-only 楼层零操作零保存', async () => {
    const chat = [
      aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] }),
      aiMsg('inc', logFrame()),
    ];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(1, 1); // 删增量楼层
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(false);
    expect(result.graftedCount).toBe(0);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
    expect(mockRunTableWriteTransaction).not.toHaveBeenCalled();
  });

  it('批量删除多个产物楼层时各自嫁接到同一后继帧', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const hideMsg = aiMsg('hide', { version: 2, logEntries: [], perSheetCheckpoints: { sheet_9: hideCheckpoint('sheet_9', 2) } });
    const incMsg = aiMsg('inc', logFrame());
    const chat = [rootMsg, hideMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(0, 2); // 一次删掉 root + hide 两楼
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(result.graftedCount).toBe(2);
    const frame = incMsg.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint?.kind).toBe('full');
    expect(frame.perSheetCheckpoints.sheet_9.timeline.activateAtMessageIndex).toBe(0);
  });

  it('后继帧已有同 sheetKey 的 per-sheet checkpoint 时以幸存者为准跳过', async () => {
    const survivorCheckpoint = { ...hideCheckpoint('sheet_9', 3), createdAt: 9999 };
    const hideMsg = aiMsg('hide-old', { version: 2, logEntries: [], perSheetCheckpoints: { sheet_9: hideCheckpoint('sheet_9', 1) } });
    const newerMsg = aiMsg('hide-new', { version: 2, logEntries: [], perSheetCheckpoints: { sheet_9: survivorCheckpoint } });
    const chat = [hideMsg, newerMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(0, 1);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(false);
    expect(result.graftedCount).toBe(0);
    expect(newerMsg.TavernDB_ACU_IsolatedData[''].storageFrame.perSheetCheckpoints.sheet_9.createdAt).toBe(9999);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('无后继帧时落到最后 AI 楼层并新建 frame', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const tailMsg = aiMsg('tail'); // 无 frame
    const chat = [rootMsg, tailMsg, userMsg('u-tail')];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(0, 1);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    const tagData = tailMsg.TavernDB_ACU_IsolatedData[''];
    expect(tagData._acu_storage_version).toBe(2);
    expect(tagData.storageFrame.checkpoint).toEqual(fullCheckpoint());
    expect(tagData.storageFrame.logEntries).toEqual([]);
  });

  it('无后继帧且最后 AI 楼层携带更早增量帧时清空其 logs（已被恢复的 full 吸收）', async () => {
    const earlierMsg = aiMsg('earlier', logFrame([{ seq: 2, operations: [] }]));
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const chat = [earlierMsg, rootMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(1, 1); // 删最后的 full 根楼层
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    const frame = earlierMsg.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint).toEqual(fullCheckpoint());
    expect(frame.logEntries).toEqual([]);
  });

  it('重新生成：删楼后宿主已追加的新回复（流式占位）不当嫁接目标，产物落到删楼前就在的楼层', async () => {
    // issue #2：宿主重新生成先删旧回复，流式开始即 push 新回复；删楼调度 1.2s 后才嫁接，
    // 若落到新回复上，新回复会被当成「已填过表」，自动填表跳过，且带着旧回复的数据。
    const earlierMsg = aiMsg('earlier', logFrame([{ seq: 2, operations: [] }]));
    const oldReply = aiMsg('old-truncated', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const chat: any[] = [userMsg('u1'), earlierMsg, userMsg('u2'), oldReply];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(3, 1);
    const newReply: any = { is_user: false, mes: '' };
    chat.push(newReply);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(newReply.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(earlierMsg.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(fullCheckpoint());
  });

  it('删掉唯一 AI 楼后只剩新追加的回复：不嫁接到新回复，保留保管库', async () => {
    const oldReply = aiMsg('old', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const chat: any[] = [userMsg('u'), oldReply];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(1, 1);
    const newReply: any = { is_user: false, mes: '' };
    chat.push(newReply);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(false);
    expect(newReply.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('保管库过期：上次捕获后宿主追加、插件未保存过的楼，删楼那一刻登记后可作落点', async () => {
    // 关自动填表 / 频率跳过 / 填表失败时插件不保存，保管库停在旧捕获；删楼那一刻在场的楼都算「删楼前就在」。
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const chat: any[] = [userMsg('u1'), rootMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    const laterReply = aiMsg('later');
    chat.push(userMsg('u2'), laterReply);

    chat.splice(1, 1);
    noteMessagesPresentAtDeletion_ACU();
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(laterReply.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(fullCheckpoint());
  });

  it('删楼时登记在场楼层后，重新生成随后追加的流式新回复仍不当落点', async () => {
    const earlierMsg = aiMsg('earlier', logFrame([{ seq: 2, operations: [] }]));
    const oldReply = aiMsg('old', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const chat: any[] = [userMsg('u1'), earlierMsg, userMsg('u2'), oldReply];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(3, 1);
    noteMessagesPresentAtDeletion_ACU();
    const newReply: any = { is_user: false, mes: '' };
    chat.push(newReply);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(newReply.TavernDB_ACU_IsolatedData).toBeUndefined();
    expect(earlierMsg.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(fullCheckpoint());
  });

  it('删楼登记只作用于保管库所属聊天：聊天标识对不上时不登记', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const chat: any[] = [userMsg('u1'), rootMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    const laterReply = aiMsg('later');
    chat.push(userMsg('u2'), laterReply);

    mockState.chatKey = 'chat-b';
    noteMessagesPresentAtDeletion_ACU();
    mockState.chatKey = 'chat-a';
    chat.splice(1, 1);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(false);
    expect(laterReply.TavernDB_ACU_IsolatedData).toBeUndefined();
  });

  it('续写基线兜底同样不落到删楼后追加的新回复上（TT-only）', async () => {
    const { registerMaterialCheckpointRecoveryAdapter_ACU } = await import('../../../src/service/chat/material-checkpoint-sync');
    registerMaterialCheckpointRecoveryAdapter_ACU({
      capture: (message: unknown) => {
        const marker = (message as { _qrf_continuation_agent?: { swipeId: string; snapshot: unknown } })._qrf_continuation_agent;
        return marker ? { continuation: marker } : null;
      },
      graftContinuation(message, artifact) {
        const target = message as { _qrf_continuation_agent?: unknown };
        if (target._qrf_continuation_agent) return false;
        target._qrf_continuation_agent = artifact;
        return true;
      },
      assertContinuation() { return null; },
    });
    const earlier = aiMsg('earlier');
    const oldReply = aiMsg('old');
    oldReply._qrf_continuation_agent = { swipeId: '0', snapshot: { hooks: ['H1'] } };
    const chat: any[] = [userMsg('u1'), earlier, userMsg('u2'), oldReply];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(3, 1);
    noteMessagesPresentAtDeletion_ACU();
    const newReply: any = { is_user: false, mes: '' };
    chat.push(newReply);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(newReply._qrf_continuation_agent).toBeUndefined();
    expect(earlier._qrf_continuation_agent).toEqual({ swipeId: '0', snapshot: { hooks: ['H1'] } });
  });

  it('聊天中已无 AI 楼层时放弃且不保存', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const chat = [userMsg('u'), rootMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(1, 1); // 只剩用户楼层
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(false);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('单根断言违规时回滚目标楼层字段且返回错误', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const incMsg = aiMsg('inc', logFrame());
    const chat = [rootMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    const before = JSON.stringify(incMsg.TavernDB_ACU_IsolatedData);
    mockAssertSingleFull.mockReturnValue('违反单根不变量');

    chat.splice(0, 1);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(false);
    expect(result.error).toContain('违反单根不变量');
    expect(JSON.stringify(incMsg.TavernDB_ACU_IsolatedData)).toBe(before);
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('宿主保存失败时回滚改动、保留保管库、下轮可重试成功', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const incMsg = aiMsg('inc', logFrame());
    const chat = [rootMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    const before = JSON.stringify(incMsg.TavernDB_ACU_IsolatedData);

    chat.splice(0, 1);
    mockSaveChatToHostStrict.mockRejectedValueOnce(new Error('host save failed'));
    const failed = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(failed.recovered).toBe(false);
    expect(failed.error).toContain('host save failed');
    expect(JSON.stringify(incMsg.TavernDB_ACU_IsolatedData)).toBe(before);

    const retried = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(retried.recovered).toBe(true);
    expect(incMsg.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toEqual(fullCheckpoint());
  });

  it('插件保存后 post-save 同步以当前聊天为权威，purge 掉的产物不复活', async () => {
    installCheckpointDeleteGuard_ACU();
    expect(mockRegisterPostChatSaveListener).toHaveBeenCalledTimes(1);
    const postSaveListener = mockRegisterPostChatSaveListener.mock.calls[0][0] as () => void;

    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const incMsg = aiMsg('inc', logFrame());
    const chat = [rootMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(0, 1); // 插件自身 purge 删掉根楼层
    postSaveListener(); // purge 以插件保存收尾 → vault 权威同步

    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(result.recovered).toBe(false);
    expect(incMsg.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint).toBeUndefined();
  });

  it('chatKey 不匹配（切聊后残留事件）时跳过', async () => {
    const rootMsg = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    const chat = [rootMsg, aiMsg('inc', logFrame())];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(0, 1);
    mockState.chatKey = 'chat-b';
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(result.recovered).toBe(false);
    expect(mockRunTableWriteTransaction).not.toHaveBeenCalled();
  });

  it('删掉向量 checkpoint 楼层后嫁接到同一后继 frame，且不覆盖已有向量 checkpoint', async () => {
    const vectorCheckpoint = {
      kind: 'vector_full',
      createdAt: 1111,
      reason: 'initial',
      sourceTableKey: 'sheet_summary',
      tableCheckpointFingerprint: 'fp',
      embedding: { provider: 'x', model: 'm', dimension: 2 },
      rowCount: 1,
      vectorRevision: 'rev-1',
      manifestRef: { manifestHash: 'h', path: 'TavernDB_ACU_vector_v2vcp_x_h', byteLength: 1 },
      packRefs: [],
    };
    const rootMsg = aiMsg('root', {
      version: 2,
      checkpoint: fullCheckpoint(),
      logEntries: [],
      summaryVectorIndexFrame: {
        version: 3,
        sourceTableKey: 'sheet_summary',
        checkpoint: vectorCheckpoint,
        logEntries: [],
      },
    });
    const incMsg = aiMsg('inc', logFrame([{ seq: 5, operations: [] }]));
    const chat = [userMsg('u'), rootMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(1, 1);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(result.graftedCount).toBeGreaterThanOrEqual(2);
    const frame = incMsg.TavernDB_ACU_IsolatedData[''].storageFrame;
    expect(frame.checkpoint).toEqual(fullCheckpoint());
    expect(frame.summaryVectorIndexFrame.checkpoint).toEqual(vectorCheckpoint);
    expect(frame.logEntries).toEqual([{ seq: 5, operations: [] }]);
  });

  it('过渡根无法从幸存历史重建时阻止保存，不把旧 cutoff 原样嫁接', async () => {
    const transition = { kind: 'spv79_duplicate_row_id_transition', cutoff: { messageIndex: 0 }, data: { sheet_0: {} } };
    const transitionMsg = aiMsg('transition', logFrame([]), { spv79TransitionCheckpoint: transition });
    const incMsg = aiMsg('inc', logFrame());
    const chat = [transitionMsg, incMsg];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();

    chat.splice(0, 1);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(false);
    expect(result.error).toContain('full checkpoint');
    expect(incMsg.TavernDB_ACU_IsolatedData[''].spv79TransitionCheckpoint).toBeUndefined();
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });

  it('删掉带续写基线的楼层后，基线嫁到后继楼，断言失败则回滚且不保存（TT-only）', async () => {
    const { registerMaterialCheckpointRecoveryAdapter_ACU } = await import('../../../src/service/chat/material-checkpoint-sync');
    const captureContinuation = (message: unknown) => {
      const marker = (message as { _qrf_continuation_agent?: { swipeId: string; snapshot: unknown } })._qrf_continuation_agent;
      return marker ? { continuation: marker } : null;
    };
    registerMaterialCheckpointRecoveryAdapter_ACU({
      capture: captureContinuation,
      graftContinuation(message, artifact) {
        const target = message as { _qrf_continuation_agent?: unknown };
        if (target._qrf_continuation_agent) return false;
        target._qrf_continuation_agent = artifact;
        return true;
      },
      assertContinuation() { return null; },
    });
    const root = aiMsg('root', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    root._qrf_continuation_agent = { swipeId: '0', snapshot: { hooks: ['H1'] } };
    const survivor = aiMsg('survivor', logFrame());
    const chat = [root, survivor];
    mockGetChatArray.mockReturnValue(chat);
    captureCheckpointVaultForCurrentChat_ACU();
    chat.splice(0, 1);

    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result.recovered).toBe(true);
    expect(survivor._qrf_continuation_agent).toEqual({ swipeId: '0', snapshot: { hooks: ['H1'] } });
    expect(mockSaveChatToHostStrict).toHaveBeenCalled();

    delete survivor._qrf_continuation_agent;
    captureCheckpointVaultForCurrentChat_ACU();
    const pluginDelete = await recoverLostCheckpointsAfterMessageDeletion_ACU();
    expect(pluginDelete.recovered).toBe(false);
    expect(survivor._qrf_continuation_agent).toBeUndefined();

    registerMaterialCheckpointRecoveryAdapter_ACU({
      capture: captureContinuation,
      graftContinuation(message, artifact) {
        (message as { _qrf_continuation_agent?: unknown })._qrf_continuation_agent = artifact;
        return true;
      },
      assertContinuation() { return '续写资料存在多个活跃基线'; },
    });
    const again = aiMsg('root2', { version: 2, checkpoint: fullCheckpoint(), logEntries: [] });
    again._qrf_continuation_agent = { swipeId: '0', snapshot: { hooks: ['H2'] } };
    const keep = aiMsg('keep', logFrame());
    const second = [again, keep];
    mockGetChatArray.mockReturnValue(second);
    captureCheckpointVaultForCurrentChat_ACU();
    second.splice(0, 1);
    mockSaveChatToHostStrict.mockClear();

    const rolled = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(rolled.recovered).toBe(false);
    expect(rolled.error).toContain('多个活跃基线');
    expect(keep._qrf_continuation_agent).toBeUndefined();
    expect(mockSaveChatToHostStrict).not.toHaveBeenCalled();
  });
});
