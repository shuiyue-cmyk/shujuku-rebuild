import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [] as any[],
  save: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
  saveChatToHostStrict_ACU: h.save,
  registerPostChatSaveListener_ACU: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentChatFileIdentifier_ACU: 'transition-delete-test',
  currentJsonTableData_ACU: null,
  independentTableStates_ACU: {},
  settings_ACU: { dataIsolationEnabled: false, dataIsolationCode: '', storageMode: 'sqlite' },
  getCurrentIsolationKey_ACU: () => '',
  _set_currentJsonTableData_ACU: vi.fn(),
  _set_independentTableStates_ACU: vi.fn(),
}));

vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: async (_options: any, task: any) => task(),
}));

vi.mock('../../../src/service/table/storage-frame-v2-persist', () => ({
  assertSingleActiveFullCheckpointV2_ACU: vi.fn(() => null),
}));

vi.mock('../../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../../src/shared/utils');
  return {
    ...actual,
    logDebug_ACU: vi.fn(),
    logWarn_ACU: vi.fn(),
    logError_ACU: vi.fn(),
  };
});

import {
  __resetCheckpointDeleteGuardForTests_ACU,
  captureCheckpointVaultForCurrentChat_ACU,
  recoverLostCheckpointsAfterMessageDeletion_ACU,
} from '../../../src/service/chat/checkpoint-delete-guard';
import { loadTableStateFromFramesV2Detailed_ACU } from '../../../src/service/table/storage-frame-v2-replay';

function data(rows: string[][] = []) {
  return {
    mate: { type: 'acu', version: 1 },
    sheet_inventory: {
      uid: 'inventory',
      name: '背包',
      content: [['row_id', 'name'], ...rows],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
      updateConfig: {},
      exportConfig: {},
      orderNo: 0,
    },
  } as any;
}

function entry(id: string, rowId: string, name: string, messageIndex: number) {
  return {
    seq: 1,
    entryId: id,
    createdAt: messageIndex + 1,
    source: 'system',
    targetMessageIndex: messageIndex,
    aiFloor: messageIndex + 1,
    filledSheetKeys: ['sheet_inventory'],
    changedSheetKeys: ['sheet_inventory'],
    groupKeys: [],
    operations: [{
      kind: 'row_upsert',
      sheetKey: 'sheet_inventory',
      rowId,
      cells: [rowId, name],
    }],
  } as any;
}

function frame(checkpoint: any, logEntries: any[] = []) {
  return { version: 2, headRevision: 'checkpoint:test', checkpoint, logEntries };
}

function tag(storageFrame: any, transition?: any) {
  return {
    _acu_storage_version: 2,
    storageFrame,
    ...(transition ? { compatTransitionCheckpoint: transition } : {}),
  };
}

describe('checkpoint delete guard transition recovery', () => {
  beforeEach(() => {
    __resetCheckpointDeleteGuardForTests_ACU();
    h.chat = [];
    h.save.mockClear();
    h.save.mockResolvedValue(undefined);
  });

  it('删除过渡根楼层后重建 cutoff，真实回放仍保留 row1/row2', async () => {
    const transitionData = data([['1', 'row1']]);
    const transition = {
      version: 1,
      kind: 'compat_replay_transition',
      createdAt: 2,
      data: transitionData,
      cutoff: { messageIndex: 1, seq: 1, operationIndex: 0 },
      tolerances: [],
    };
    const base = { is_user: false, TavernDB_ACU_IsolatedData: { '': tag(frame({ kind: 'full', createdAt: 1, reason: 'init', data: data([['1', 'row1']]) })) } };
    const root = { is_user: false, TavernDB_ACU_IsolatedData: { '': tag(frame(undefined, [entry('insert-1', '1', 'row1', 1)]), transition) } };
    const suffix = { is_user: false, TavernDB_ACU_IsolatedData: { '': tag(frame(undefined, [entry('insert-2', '2', 'row2', 2)])) } };
    h.chat = [base, root, suffix];

    captureCheckpointVaultForCurrentChat_ACU();
    h.chat.splice(1, 1);
    const result = await recoverLostCheckpointsAfterMessageDeletion_ACU();

    expect(result).toMatchObject({ recovered: true, graftedCount: 1 });
    const replay = await loadTableStateFromFramesV2Detailed_ACU(h.chat, '', {
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });
    expect(replay?.data.sheet_inventory.content).toEqual([
      ['row_id', 'name'],
      ['1', 'row1'],
      ['2', 'row2'],
    ]);
  });
});
