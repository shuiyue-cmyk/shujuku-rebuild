import { describe, expect, it } from 'vitest';
import {
  collectV2CheckpointFloorsFromChat_ACU,
  getLatestTableAppendMessageIndexFromChat_ACU,
  getLatestV2FullCheckpointMessageIndex_ACU,
  getLatestV2SheetReplayMessageIndex_ACU,
  resolveTableHistoryStateFromChat_ACU,
  resolveTableHistoryStatesFromChat_ACU,
} from '../../../src/service/table/table-history';

const settings = {
  dataIsolationEnabled: false,
  dataIsolationCode: '',
};

function v2Message(frame: any, stringify = false) {
  const isolatedData = {
    '': {
      storageFrame: frame,
      _acu_storage_version: 2,
    },
  };
  return {
    is_user: false,
    TavernDB_ACU_IsolatedData: stringify ? JSON.stringify(isolatedData) : isolatedData,
  };
}

describe('resolveTableHistoryStateFromChat_ACU', () => {
  it('识别 V2 checkpoint event 作为已更新楼层', () => {
    const chat = [
      { is_user: true },
      v2Message({
        version: 2,
        checkpoint: {
          kind: 'full',
          createdAt: 1,
          reason: 'init',
          data: { mate: {}, sheet_0: { name: '表A', content: [['row_id']] } },
          event: {
            filledSheetKeys: ['sheet_0'],
            changedSheetKeys: ['sheet_0'],
            groupKeys: ['sheet_0'],
          },
        },
        logEntries: [],
      }),
    ];

    const state = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });

    expect(state.hasAnyData).toBe(true);
    expect(state.hasTrackedUpdate).toBe(true);
    expect(state.latestDataAiFloor).toBe(1);
    expect(state.lastTrackedUpdateAiFloor).toBe(1);
  });

  it('识别 V2 operation log 的 filledSheetKeys 作为最后填表楼层', () => {
    const chat = [
      v2Message({
        version: 2,
        checkpoint: {
          kind: 'full',
          createdAt: 1,
          reason: 'init',
          data: { mate: {}, sheet_0: { name: '表A', content: [['row_id']] } },
          event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
        },
        logEntries: [],
      }),
      { is_user: true },
      v2Message({
        version: 2,
        logEntries: [{
          seq: 1,
          entryId: 'v2_1',
          createdAt: 2,
          source: 'auto_fill',
          targetMessageIndex: 2,
          aiFloor: 2,
          filledSheetKeys: ['sheet_0'],
          changedSheetKeys: ['sheet_0'],
          groupKeys: [],
          operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: { name: '表A', content: [['row_id'], ['1']] }, reason: 'system' }],
        }],
      }),
    ];

    const state = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });

    expect(state.hasTrackedUpdate).toBe(true);
    expect(state.lastTrackedUpdateMessageIndex).toBe(2);
    expect(state.lastTrackedUpdateAiFloor).toBe(2);
  });

  // ─── Checkpoint 导入恢复的覆盖楼层声明 ───
  /** 恢复帧落在最新 AI 楼层（AI 楼层 2），前方再放一个纯空帧模拟历史楼层。 */
  function restoreFrameChat(restoreUpToAiFloor?: number) {
    return [
      { is_user: true },
      v2Message({ version: 2, logEntries: [] }),
      { is_user: true },
      v2Message({
        version: 2,
        checkpoint: {
          kind: 'full',
          createdAt: 1,
          reason: 'init',
          data: { mate: {}, sheet_0: { name: '表A', content: [['row_id'], ['1']] } },
          event: { filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [] },
          ...(restoreUpToAiFloor === undefined ? {} : { restoreUpToAiFloor }),
        },
        logEntries: [],
      }),
    ];
  }

  it('未声明覆盖楼层时，追平前沿仍是恢复帧所在楼层（保持既有行为）', () => {
    const state = resolveTableHistoryStateFromChat_ACU(restoreFrameChat(), {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });

    expect(state.hasAnyData).toBe(true);
    expect(state.hasTrackedUpdate).toBe(true);
    expect(state.lastTrackedUpdateAiFloor).toBe(2);
  });

  it('声明覆盖楼层后，追平前沿下修到该楼层，剩余楼层可被规划', () => {
    const state = resolveTableHistoryStateFromChat_ACU(restoreFrameChat(1), {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });

    expect(state.hasTrackedUpdate).toBe(true);
    expect(state.lastTrackedUpdateAiFloor).toBe(1);
  });

  it('声明楼层超过恢复帧楼层时按帧楼层夹取，非法声明一律忽略', () => {
    const oversized = resolveTableHistoryStateFromChat_ACU(restoreFrameChat(99), {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });
    expect(oversized.lastTrackedUpdateAiFloor).toBe(2);

    for (const invalid of [0, -3, 1.5]) {
      const state = resolveTableHistoryStateFromChat_ACU(restoreFrameChat(invalid), {
        sheetKey: 'sheet_0',
        isSummaryTable: false,
        isolationKey: '',
        settings,
      });
      expect(state.lastTrackedUpdateAiFloor).toBe(2);
    }
  });

  it('边界轮转把 full checkpoint 降级成 entry 后，声明仍随 entry 生效（前沿不回跳）', () => {
    // 降级 entry 由 downgradeV2FullCheckpointAtIndex_ACU 产出：没有 checkpoint，只有 entry，
    // 并把原 checkpoint 的声明原样带过来。丢了它前沿就会跳回该 entry 楼层（误报「已追平」）。
    const chat = [
      { is_user: true },
      v2Message({ version: 2, logEntries: [] }),
      { is_user: true },
      v2Message({
        version: 2,
        logEntries: [{
          seq: 0,
          entryId: 'downgraded-checkpoint-3-1',
          createdAt: 1,
          source: 'system',
          targetMessageIndex: 3,
          aiFloor: 2,
          restoreUpToAiFloor: 1,
          filledSheetKeys: ['sheet_0'],
          changedSheetKeys: ['sheet_0'],
          groupKeys: [],
          operations: [{ kind: 'data_replace', data: { mate: {}, sheet_0: { name: '表A', content: [['row_id'], ['1']] } }, reason: 'checkpoint_fallback' }],
        }],
      }),
    ];

    const state = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });

    expect(state.hasTrackedUpdate).toBe(true);
    expect(state.lastTrackedUpdateAiFloor).toBe(1);

    // 同一 entry 去掉声明时回到 entry 楼层＝改造前行为（证明上面那条断言确实由声明承重）。
    const withoutDeclaration = JSON.parse(JSON.stringify(chat));
    delete withoutDeclaration[3].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries[0].restoreUpToAiFloor;
    const declaredState = resolveTableHistoryStateFromChat_ACU(withoutDeclaration, {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });
    expect(declaredState.lastTrackedUpdateAiFloor).toBe(2);
  });

  it('声明只下修基线：恢复后真实的更高楼层填表仍会推进前沿', () => {
    const chat = restoreFrameChat(1);
    chat.push(v2Message({
      version: 2,
      logEntries: [{
        seq: 1,
        entryId: 'v2_refill_1',
        createdAt: 3,
        source: 'manual_catch_up',
        targetMessageIndex: 3,
        aiFloor: 3,
        filledSheetKeys: ['sheet_0'],
        changedSheetKeys: ['sheet_0'],
        groupKeys: [],
        operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: { name: '表A', content: [['row_id'], ['1']] }, reason: 'system' }],
      }],
    }));

    const state = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });

    expect(state.lastTrackedUpdateAiFloor).toBe(3);
  });

  it('不把前端写入 changedSheetKeys / sheet_replace 视为已填表更新', () => {
    const chat = [
      v2Message({
        version: 2,
        checkpoint: {
          kind: 'full',
          createdAt: 1,
          reason: 'init',
          data: { mate: {}, sheet_0: { name: '表A', content: [['row_id']] } },
          event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
        },
        logEntries: [],
      }),
      { is_user: true },
      v2Message({
        version: 2,
        logEntries: [{
          seq: 1,
          entryId: 'manual_1',
          createdAt: 2,
          source: 'manual_crud',
          targetMessageIndex: 2,
          aiFloor: 2,
          filledSheetKeys: [],
          changedSheetKeys: ['sheet_0'],
          groupKeys: [],
          operations: [{ kind: 'sheet_replace', sheetKey: 'sheet_0', sheet: { name: '表A', content: [['row_id'], ['1']] }, reason: 'manual_crud' }],
        }],
      }),
    ];

    const state = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });

    expect(state.hasAnyData).toBe(true);
    expect(state.latestDataAiFloor).toBe(2);
    expect(state.hasTrackedUpdate).toBe(false);
    expect(state.lastTrackedUpdateAiFloor).toBe(0);
  });

  it('识别字符串化 V2 IsolatedData 的 filledSheetKeys', () => {
    const chat = [
      v2Message({
        version: 2,
        checkpoint: {
          kind: 'full',
          createdAt: 1,
          reason: 'init',
          data: { mate: {}, sheet_0: { name: '表A', content: [['row_id'], ['1']] } },
          event: {
            filledSheetKeys: ['sheet_0'],
            changedSheetKeys: ['sheet_0'],
            groupKeys: ['sheet_0'],
          },
        },
        logEntries: [],
      }, true),
    ];

    const state = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });

    expect(state.hasAnyData).toBe(true);
    expect(state.hasTrackedUpdate).toBe(true);
    expect(state.lastTrackedUpdateAiFloor).toBe(1);
  });

  it('将 sheet_schema_migrate 视为该 sheet 的结构化数据操作，但不把 changedSheetKeys 当作填表', () => {
    const chat = [
      v2Message({
        version: 2,
        logEntries: [{
          seq: 1,
          entryId: 'schema_1',
          createdAt: 2,
          source: 'manual_crud',
          targetMessageIndex: 0,
          aiFloor: 1,
          filledSheetKeys: [],
          changedSheetKeys: ['sheet_0'],
          groupKeys: [],
          operations: [{ kind: 'sheet_schema_migrate', sheetKey: 'sheet_0' }],
        }],
      }),
    ];

    const state = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });

    expect(state.hasAnyData).toBe(true);
    expect(state.latestDataAiFloor).toBe(1);
    expect(state.hasTrackedUpdate).toBe(false);
    expect(state.lastTrackedUpdateAiFloor).toBe(0);
  });

  it('不把 data_replace 覆盖范围视为已填表更新', () => {
    const chat = [
      v2Message({
        version: 2,
        logEntries: [{
          seq: 1,
          entryId: 'replace_1',
          createdAt: 2,
          source: 'system',
          targetMessageIndex: 0,
          aiFloor: 1,
          filledSheetKeys: [],
          changedSheetKeys: [],
          groupKeys: [],
          operations: [{ kind: 'data_replace', data: { mate: {}, sheet_0: { name: '表A', content: [['row_id'], ['1']] } }, reason: 'system' }],
        }],
      }),
    ];

    const state = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });

    expect(state.hasAnyData).toBe(true);
    expect(state.latestDataAiFloor).toBe(1);
    expect(state.hasTrackedUpdate).toBe(false);
    expect(state.lastTrackedUpdateAiFloor).toBe(0);
  });

  it('不把无事件的 V2 初始模板 checkpoint 视为已自动更新', () => {
    const chat = [
      v2Message({
        version: 2,
        checkpoint: {
          kind: 'full',
          createdAt: 1,
          reason: 'init',
          data: { mate: {}, sheet_0: { name: '表A', content: [['row_id']] } },
          event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
        },
        logEntries: [],
      }),
    ];

    const state = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });

    expect(state.hasAnyData).toBe(true);
    expect(state.hasTrackedUpdate).toBe(false);
    expect(state.lastTrackedUpdateAiFloor).toBe(0);
  });

  it('识别 checkpoint scheduleSummary 中被压缩的历史填表楼层', () => {
    const chat = [
      v2Message({
        version: 2,
        checkpoint: {
          kind: 'full',
          createdAt: 1,
          reason: 'init',
          data: { mate: {}, sheet_0: { name: '表A', content: [['row_id'], ['1']] } },
          event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
        },
        logEntries: [],
      }),
      { is_user: true },
      v2Message({
        version: 2,
        checkpoint: {
          kind: 'full',
          createdAt: 2,
          // 历史 fixture：reason:'periodic' 仅表示旧数据兼容，新策略不再生成 periodic full checkpoint。
          reason: 'periodic',
          data: { mate: {}, sheet_0: { name: '表A', content: [['row_id'], ['1'], ['2']] } },
          scheduleSummary: { sheet_0: { lastFilledAiFloor: 1, lastChangedAiFloor: 1 } },
          event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
        },
        logEntries: [],
      }),
    ];

    const state = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });

    expect(state.hasTrackedUpdate).toBe(true);
    expect(state.lastTrackedUpdateMessageIndex).toBe(2);
    expect(state.lastTrackedUpdateAiFloor).toBe(1);
  });

  it('追加日志目标使用最新可承载表数据的 AI 楼，不按单表历史楼层回写', () => {
    const chat = [
      v2Message({
        version: 2,
        checkpoint: {
          kind: 'full',
          createdAt: 1,
          reason: 'init',
          data: { mate: {}, sheet_0: { name: '表A', content: [['row_id']] } },
          event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
        },
        logEntries: [],
      }),
      { is_user: true },
      v2Message({
        version: 2,
        logEntries: [{
          seq: 1,
          entryId: 'sql_1',
          createdAt: 2,
          source: 'raw_sql_mutation',
          targetMessageIndex: 2,
          aiFloor: 2,
          filledSheetKeys: [],
          changedSheetKeys: [],
          groupKeys: [],
          operations: [{ kind: 'sql_batch', statements: ['INSERT INTO table_a (name) VALUES (\'x\')'] }],
        }],
      }),
      { is_user: true },
      { is_user: false, mes: '最新楼跳过填表' },
    ];

    expect(getLatestTableAppendMessageIndexFromChat_ACU(chat, '', settings)).toBe(2);
  });

  it('没有任何表数据帧时追加目标回退到最新 AI 楼', () => {
    const chat = [
      { is_user: true },
      { is_user: false, mes: 'AI 1' },
      { is_user: true },
      { is_user: false, mes: 'AI 2' },
    ];

    expect(getLatestTableAppendMessageIndexFromChat_ACU(chat, '', settings)).toBe(3);
  });


  it('识别 perSheet checkpoint 的单表数据与压缩填表楼层', () => {
    const chat = [
      v2Message({
        version: 2,
        perSheetCheckpoints: {
          sheet_0: {
            kind: 'sheet_full',
            createdAt: 1,
            reason: 'manual',
            sheetKey: 'sheet_0',
            data: { name: '表A', content: [['row_id'], ['1']] },
            scheduleSummary: { lastFilledAiFloor: 6 },
          },
        },
        logEntries: [],
      }),
    ];

    const state = resolveTableHistoryStateFromChat_ACU(chat, {
      sheetKey: 'sheet_0',
      isSummaryTable: false,
      isolationKey: '',
      settings,
    });

    expect(state.hasAnyData).toBe(true);
    expect(state.hasTrackedUpdate).toBe(true);
    expect(state.latestDataAiFloor).toBe(1);
    expect(state.lastTrackedUpdateAiFloor).toBe(6);
  });

  it('收集当前隔离标签的 V2 full checkpoint AI 楼层', () => {
    const chat = [
      { is_user: true },
      v2Message({
        version: 2,
        checkpoint: {
          kind: 'full',
          createdAt: 1,
          reason: 'init',
          data: { mate: {}, sheet_0: { name: '表A', content: [['row_id']] } },
        },
        logEntries: [],
      }),
      v2Message({
        version: 2,
        logEntries: [{ seq: 1, operations: [] }],
      }),
      { is_user: true },
      v2Message({
        version: 2,
        checkpoint: {
          kind: 'full',
          createdAt: 2,
          // 历史 fixture：reason:'periodic' 仅表示旧数据兼容，新策略不再生成 periodic full checkpoint。
          reason: 'periodic',
          data: { mate: {}, sheet_0: { name: '表A', content: [['row_id'], ['2']] } },
        },
        logEntries: [],
      }, true),
    ];

    expect(collectV2CheckpointFloorsFromChat_ACU(chat, '')).toEqual([
      { messageIndex: 1, aiFloor: 1, reason: 'init', createdAt: 1 },
      // 历史 fixture：reason:'periodic' 仅表示旧数据兼容，新策略不再生成 periodic full checkpoint。
      { messageIndex: 4, aiFloor: 3, reason: 'periodic', createdAt: 2 },
    ]);
  });
});

describe('V2 replay layer routing', () => {
  it('将最新 full checkpoint 作为基底，而不是 sheet 增量追加目标', () => {
    const chat = [
      v2Message({
        version: 2,
        checkpoint: {
          kind: 'full', createdAt: 1, reason: 'init',
          data: { mate: {}, sheet_a: { content: [['row_id']] }, sheet_b: { content: [['row_id']] } },
        },
        logEntries: [],
      }),
      { is_user: true },
      v2Message({
        version: 2,
        logEntries: [{
          seq: 1, entryId: 'a-1', createdAt: 2, source: 'manual_crud', targetMessageIndex: 2, aiFloor: 2,
          filledSheetKeys: [], changedSheetKeys: ['sheet_a'], groupKeys: [],
          operations: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: '1', cells: ['1'] }],
        }],
      }),
      v2Message({
        version: 2,
        perSheetCheckpoints: {
          sheet_b: { kind: 'sheet_full', createdAt: 3, reason: 'manual', sheetKey: 'sheet_b', data: { content: [['row_id']] } },
        },
        logEntries: [],
      }),
    ];

    expect(getLatestV2FullCheckpointMessageIndex_ACU(chat, '')).toBe(0);
    expect(getLatestV2SheetReplayMessageIndex_ACU(chat, '', 'sheet_a')).toBe(2);
    expect(getLatestV2SheetReplayMessageIndex_ACU(chat, '', 'sheet_b')).toBe(3);
  });

  it('对没有显式单表 replay 层的 sheet 返回 -1，并忽略 checkpoint 之前的历史', () => {
    const chat = [
      v2Message({
        version: 2,
        logEntries: [{
          seq: 1, entryId: 'old-a', createdAt: 1, source: 'manual_crud', targetMessageIndex: 0, aiFloor: 1,
          filledSheetKeys: [], changedSheetKeys: ['sheet_a'], groupKeys: [],
          operations: [{ kind: 'row_delete', sheetKey: 'sheet_a', rowId: '1' }],
        }],
      }),
      v2Message({
        version: 2,
        checkpoint: {
          kind: 'full', createdAt: 2, reason: 'init',
          data: { mate: {}, sheet_a: { content: [['row_id']] }, sheet_b: { content: [['row_id']] } },
        },
        logEntries: [],
      }),
    ];

    expect(getLatestV2SheetReplayMessageIndex_ACU(chat, '', 'sheet_a')).toBe(-1);
    expect(getLatestV2SheetReplayMessageIndex_ACU(chat, '', 'sheet_b')).toBe(-1);
  });
});

describe('resolveTableHistoryStatesFromChat_ACU', () => {
  const historyOptions = (sheetKey: string, overrides: Record<string, any> = {}) => ({
    sheetKey,
    isSummaryTable: false,
    isolationKey: '',
    settings,
    ...overrides,
  });

  it('在一次批量解析中保持 legacy、V2 checkpoint、per-sheet checkpoint 与 operation log 语义', () => {
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_Data: {
          sheet_legacy: { name: '旧表', content: [['row_id'], ['1']] },
        },
        TavernDB_ACU_ModifiedKeys: ['sheet_legacy'],
      },
      { is_user: true },
      v2Message({
        version: 2,
        checkpoint: {
          kind: 'full',
          createdAt: 2,
          reason: 'init',
          data: { mate: {}, sheet_full: { name: '全量表', content: [['row_id']] } },
          event: { filledSheetKeys: [], changedSheetKeys: ['sheet_full'], groupKeys: ['sheet_full'] },
        },
        perSheetCheckpoints: {
          sheet_single: {
            kind: 'sheet_full',
            createdAt: 2,
            reason: 'manual',
            sheetKey: 'sheet_single',
            data: { name: '单表', content: [['row_id']] },
            scheduleSummary: { lastFilledAiFloor: 7 },
          },
        },
        logEntries: [],
      }),
      { is_user: true },
      v2Message({
        version: 2,
        logEntries: [{
          seq: 1,
          entryId: 'fill-log',
          createdAt: 3,
          source: 'auto_fill',
          targetMessageIndex: 4,
          aiFloor: 3,
          filledSheetKeys: ['sheet_log'],
          changedSheetKeys: ['sheet_log'],
          groupKeys: [],
          operations: [{ kind: 'row_upsert', sheetKey: 'sheet_log', rowId: '1', cells: ['1'] }],
        }],
      }),
    ];

    const states = resolveTableHistoryStatesFromChat_ACU(chat, [
      historyOptions('sheet_legacy'),
      historyOptions('sheet_full'),
      historyOptions('sheet_single'),
      historyOptions('sheet_log'),
    ]);

    expect(states.get('sheet_legacy')).toEqual({
      latestAiMessageIndex: 4,
      latestDataMessageIndex: 0,
      lastTrackedUpdateMessageIndex: 0,
      latestDataAiFloor: 1,
      lastTrackedUpdateAiFloor: 1,
      hasAnyData: true,
      hasTrackedUpdate: true,
    });
    expect(states.get('sheet_full')).toMatchObject({
      latestDataMessageIndex: 2,
      lastTrackedUpdateMessageIndex: 2,
      latestDataAiFloor: 2,
      lastTrackedUpdateAiFloor: 2,
    });
    expect(states.get('sheet_single')).toMatchObject({
      latestDataMessageIndex: 2,
      lastTrackedUpdateMessageIndex: 2,
      latestDataAiFloor: 2,
      lastTrackedUpdateAiFloor: 7,
    });
    expect(states.get('sheet_log')).toMatchObject({
      latestDataMessageIndex: 4,
      lastTrackedUpdateMessageIndex: 4,
      latestDataAiFloor: 3,
      lastTrackedUpdateAiFloor: 3,
    });
  });

  it('按 isolationKey 隔离数据，并为未知表返回空历史状态', () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        branch_a: {
          independentData: { sheet_a: { name: 'A' } },
          modifiedKeys: ['sheet_a'],
          updateGroupKeys: [],
        },
        branch_b: {
          independentData: { sheet_b: { name: 'B' } },
          modifiedKeys: [],
          updateGroupKeys: ['sheet_b'],
        },
      },
    }];

    const states = resolveTableHistoryStatesFromChat_ACU(chat, [
      historyOptions('sheet_a', { isolationKey: 'branch_a' }),
      historyOptions('sheet_b', { isolationKey: 'branch_b' }),
      historyOptions('sheet_missing', { isolationKey: 'branch_a' }),
    ]);

    expect(states.get('sheet_a')).toMatchObject({ hasAnyData: true, hasTrackedUpdate: true, lastTrackedUpdateAiFloor: 1 });
    expect(states.get('sheet_b')).toMatchObject({ hasAnyData: true, hasTrackedUpdate: true, lastTrackedUpdateAiFloor: 1 });
    expect(states.get('sheet_missing')).toEqual({
      latestAiMessageIndex: 0,
      latestDataMessageIndex: -1,
      lastTrackedUpdateMessageIndex: -1,
      latestDataAiFloor: 0,
      lastTrackedUpdateAiFloor: 0,
      hasAnyData: false,
      hasTrackedUpdate: false,
    });
  });

  it('忽略空 sheetKey，重复 sheetKey 只解析一次，无 AI 消息时返回空状态', () => {
    const states = resolveTableHistoryStatesFromChat_ACU([{ is_user: true }], [
      historyOptions('sheet_a'),
      historyOptions('sheet_a'),
      historyOptions(''),
    ]);

    expect([...states.keys()]).toEqual(['sheet_a']);
    expect(states.get('sheet_a')).toMatchObject({
      latestAiMessageIndex: -1,
      latestDataMessageIndex: -1,
      lastTrackedUpdateMessageIndex: -1,
      hasAnyData: false,
      hasTrackedUpdate: false,
    });
  });

  it('聊天层扫描次数不随 sheet 数量平方增长', () => {
    let isUserReads = 0;
    const messageCount = 500;
    const chat = Array.from({ length: messageCount }, (_, index) => new Proxy({
      is_user: index % 2 === 0,
    }, {
      get(target, property, receiver) {
        if (property === 'is_user') isUserReads += 1;
        return Reflect.get(target, property, receiver);
      },
    }));
    const options = Array.from({ length: 40 }, (_, index) => historyOptions(`sheet_${index}`));

    const states = resolveTableHistoryStatesFromChat_ACU(chat, options);

    expect(states.size).toBe(40);
    expect(isUserReads).toBeLessThanOrEqual(messageCount * 2);
  });
});
