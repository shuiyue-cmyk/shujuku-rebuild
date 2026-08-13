import { describe, expect, it } from 'vitest';
import { collectMixedStorageEvidence_ACU } from '../../../src/service/table/mixed-storage-evidence';
import { _set_independentTableStates_ACU, independentTableStates_ACU } from '../../../src/service/runtime/state-manager';

function sheet(name: string) {
  return { uid: 'inventory', name, content: [['row_id', '名称'], ['1', name]], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 } as any;
}

function migrationProvenance() {
  return {
    version: 1 as const,
    legacyDataFingerprint: 'placeholder',
    legacySourceMessageIndices: [0],
    legacySourceAiFloors: [1],
    legacyLastChangedAiFloorBySheet: { sheet_0: 1 },
    targetMessageIndex: 2,
    targetAiFloor: 2,
    isolationKey: 'tag-a',
    migratedAt: 10,
  };
}

describe('mixed-storage-evidence', () => {
  it('只读收集 isolated/top-level legacy、V2 anchor/replay/provenance，并稳定排序', async () => {
    const data = { sheet_0: sheet('背包'), sheet_1: sheet('任务') } as any;
    const provenance = migrationProvenance();
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_Identity: 'tag-a',
        TavernDB_ACU_IsolatedData: {
          'tag-a': { independentData: { sheet_1: data.sheet_1 }, incrementalData: { sheet_0: data.sheet_0 }, modifiedKeys: ['sheet_1', 'sheet_0'], updateGroupKeys: ['sheet_1'] },
        },
        TavernDB_ACU_Data: { sheet_0: data.sheet_0 },
        TavernDB_ACU_SummaryData: { sheet_1: data.sheet_1 },
        TavernDB_ACU_ModifiedKeys: ['sheet_1', 'sheet_0'],
      },
      { is_user: true, TavernDB_ACU_Data: { sheet_0: data.sheet_0 } },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          'tag-a': { _acu_storage_version: 2, storageFrame: { version: 2, headRevision: 'checkpoint:migration', checkpoint: { kind: 'full', createdAt: 10, reason: 'migration', data, migrationProvenance: provenance }, logEntries: [] } },
        },
      },
    ];
    const before = structuredClone(chat);
    const priorRuntime = independentTableStates_ACU;
    _set_independentTableStates_ACU({ sheet_existing: { lastUpdatedAiFloor: 99 } });
    try {
      const evidence = await collectMixedStorageEvidence_ACU({ chat, isolationKey: 'tag-a', isolationConfig: { enabled: true, code: 'tag-a' }, legacyCandidateData: data });

      expect(evidence.legacy.messages).toEqual([expect.objectContaining({
        messageIndex: 0, aiFloor: 1,
        locations: ['isolated_independent', 'isolated_incremental', 'top_level_standard', 'top_level_summary'],
        sheetKeys: ['sheet_0', 'sheet_1'], modifiedKeys: ['sheet_0', 'sheet_1'], updateGroupKeys: ['sheet_1'],
      })]);
      expect(evidence.legacy.lastFilledAiFloorBySheet).toEqual({ sheet_0: 1, sheet_1: 1 });
      expect(evidence.legacy.lastChangedAiFloorBySheet).toEqual({ sheet_0: 1, sheet_1: 1 });
      expect(evidence.v2.anchor).toEqual(expect.objectContaining({
        status: 'anchored', messageIndex: 2, aiFloor: 2, reason: 'migration', createdAt: 10, headRevision: 'checkpoint:migration',
      }));
      expect(evidence.v2.sheetCoverage).toEqual([
        { sheetKey: 'sheet_0', lastReplayMessageIndex: 2, lastReplayAiFloor: 2, lastChangedAiFloor: 0 },
        { sheetKey: 'sheet_1', lastReplayMessageIndex: 2, lastReplayAiFloor: 2, lastChangedAiFloor: 0 },
      ]);
      expect(evidence.v2.replay).toEqual(expect.objectContaining({ status: 'success', fingerprint: expect.any(String) }));
      expect(evidence.v2.provenance).toEqual(expect.objectContaining({ present: true, targetMatchesAnchor: true, isolationKeyMatches: true, sourceEvidenceMatches: true, legacyFingerprintMatchesCandidate: false }));
      expect(evidence.comparison).toEqual({ fingerprintsComparable: true, fingerprintsEqual: true });
      expect(chat).toEqual(before);
      expect(independentTableStates_ACU).toEqual({ sheet_existing: { lastUpdatedAiFloor: 99 } });
    } finally {
      _set_independentTableStates_ACU(priorRuntime);
    }
 });

  it('无 full checkpoint 但存在 V2 log 时保留 fail-closed 证据，不伪造 replay 成功', async () => {
    const data = { sheet_0: sheet('背包') } as any;
    const chat = [{ is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, headRevision: 'orphan', logEntries: [{ seq: 1 }] } } } }];
    const evidence = await collectMixedStorageEvidence_ACU({ chat, isolationKey: '', isolationConfig: { enabled: false, code: '' }, legacyCandidateData: data });

    expect(evidence.v2.anchor).toEqual({ status: 'missing_with_artifacts', messageIndex: null, aiFloor: null });
    expect(evidence.v2.replay).toEqual({ status: 'unavailable', fingerprint: null });
    expect(evidence.comparison).toEqual({ fingerprintsComparable: false, fingerprintsEqual: null });
  });

  it('按 replay anchor 后的单表 checkpoint 与 log 收集每表 coverage，历史无 provenance 保持兼容证据', async () => {
    const data = { sheet_0: sheet('背包'), sheet_1: sheet('任务') } as any;
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              headRevision: 'checkpoint:init',
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              headRevision: 'entry:sheet-0',
              perSheetCheckpoints: {
                sheet_1: { kind: 'sheet_full', createdAt: 2, reason: 'manual', sheetKey: 'sheet_1', data: sheet('任务'), scheduleSummary: { lastChangedAiFloor: 2 } },
              },
              logEntries: [{
                seq: 1, entryId: 'sheet-0-log', createdAt: 2, source: 'manual_crud', targetMessageIndex: 1, aiFloor: 2,
                filledSheetKeys: [], changedSheetKeys: ['sheet_0'], groupKeys: [], operations: [],
              }],
            },
          },
        },
      },
    ];

    const evidence = await collectMixedStorageEvidence_ACU({ chat, isolationKey: '', isolationConfig: { enabled: false, code: '' }, legacyCandidateData: data });

    expect(evidence.v2.provenance).toEqual({ present: false });
    expect(evidence.v2.sheetCoverage).toEqual([
      { sheetKey: 'sheet_0', lastReplayMessageIndex: 1, lastReplayAiFloor: 2, lastChangedAiFloor: 2 },
      { sheetKey: 'sheet_1', lastReplayMessageIndex: 1, lastReplayAiFloor: 2, lastChangedAiFloor: 2 },
    ]);
    expect(evidence.v2.replay.status).toBe('success');
  });

  it('仅采集与 candidate sheet 相交且 identity 匹配的 top-level legacy，保留 provenance claim 不匹配事实', async () => {
    const data = { sheet_0: sheet('背包') } as any;
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_Identity: 'other-tag',
        TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0 },
        TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      },
      {
        is_user: false,
        TavernDB_ACU_Identity: 'tag-a',
        TavernDB_ACU_IndependentData: { sheet_0: data.sheet_0, sheet_unrelated: sheet('忽略') },
        TavernDB_ACU_UpdateGroupKeys: ['sheet_0', 'sheet_unrelated'],
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          'tag-a': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: {
                kind: 'full', createdAt: 1, reason: 'migration', data,
                migrationProvenance: { ...migrationProvenance(), legacySourceMessageIndices: [0], legacySourceAiFloors: [1], targetMessageIndex: 2, targetAiFloor: 3 },
              },
              logEntries: [],
            },
          },
        },
      },
    ];

    const evidence = await collectMixedStorageEvidence_ACU({ chat, isolationKey: 'tag-a', isolationConfig: { enabled: true, code: 'tag-a' }, legacyCandidateData: data });

    expect(evidence.legacy.messages).toEqual([expect.objectContaining({
      messageIndex: 1,
      locations: ['top_level_independent'],
      sheetKeys: ['sheet_0'],
      updateGroupKeys: ['sheet_0'],
    })]);
    expect(evidence.legacy.sourceMessageIndices).toEqual([1]);
    expect(evidence.v2.provenance).toEqual(expect.objectContaining({
      present: true,
      validation: { valid: true, issues: [] },
      sourceEvidenceMatches: false,
      targetMatchesAnchor: true,
    }));
  });

  it('legacy 来源业务数据变化时生成不同 sourceFingerprint', async () => {
    const data = { sheet_0: sheet('背包') } as any;
    const chat = [{ is_user: false, TavernDB_ACU_Data: data, TavernDB_ACU_ModifiedKeys: ['sheet_0'] }];
    const initial = await collectMixedStorageEvidence_ACU({ chat, isolationKey: '', isolationConfig: { enabled: false, code: '' }, legacyCandidateData: data });
    chat[0].TavernDB_ACU_Data.sheet_0.content[1][1] = '修改后背包';

    const changed = await collectMixedStorageEvidence_ACU({ chat, isolationKey: '', isolationConfig: { enabled: false, code: '' }, legacyCandidateData: data });

    expect(changed.legacy.sourceMessageIndices).toEqual(initial.legacy.sourceMessageIndices);
    expect(changed.legacy.sourceFingerprint).not.toBe(initial.legacy.sourceFingerprint);
  });

  it('将没有 changedSheetKeys 的 sheet-scoped operation 计入逐 sheet 变更 coverage', async () => {
    const data = { sheet_0: sheet('背包') } as any;
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data },
              logEntries: [],
            },
          },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [{
                seq: 1, entryId: 'metadata-only', createdAt: 2, source: 'manual_crud', targetMessageIndex: 1, aiFloor: 2,
                filledSheetKeys: [], changedSheetKeys: [], groupKeys: [],
                operations: [{ kind: 'meta_update', sheetKey: 'sheet_0', meta: { name: '背包（已更新）' } }],
              }],
            },
          },
        },
      },
    ];

    const evidence = await collectMixedStorageEvidence_ACU({ chat, isolationKey: '', isolationConfig: { enabled: false, code: '' }, legacyCandidateData: data });

    expect(evidence.v2.sheetCoverage).toEqual([
      { sheetKey: 'sheet_0', lastReplayMessageIndex: 1, lastReplayAiFloor: 2, lastChangedAiFloor: 2 },
    ]);
  });

  it('真实缺表回放会暴露 temporary anchor 与待收敛状态，不能只报告 fingerprint success', async () => {
    const template = {
      mate: { type: 'acu', version: 1 },
      sheet_global: {
        uid: 'global_state',
        name: '全局数据表',
        content: [['row_id', 'prev_scene_time', 'elapsed_time', 'cur_time'], ['99', '模板示例', '0分', '模板时间']],
        sourceData: { ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, prev_scene_time TEXT, elapsed_time TEXT, cur_time TEXT);' },
        updateConfig: {}, exportConfig: {}, orderNo: 1,
      },
    } as any;
    const checkpointData = { mate: { type: 'acu', version: 1 }, sheet_0: sheet('背包') } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_ScopedConfig: {
        version: 1,
        template: { '': { mode: 'chat_override', isolationKey: '', templateStr: JSON.stringify(template) } },
      },
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: checkpointData },
            logEntries: [{
              seq: 1,
              entryId: 'missing-global-sheet-384',
              createdAt: 2,
              source: 'manual_crud',
              targetMessageIndex: 0,
              aiFloor: 1,
              filledSheetKeys: ['sheet_global'],
              changedSheetKeys: ['sheet_global'],
              groupKeys: [],
              operations: [{
                kind: 'sql_sheet_batch',
                sheetKey: 'sheet_global',
                tableName: 'quanjushujubiao',
                statements: ["INSERT INTO quanjushujubiao (row_id, prev_scene_time, elapsed_time, cur_time) VALUES (1, '2026-08-07 00:15', '5分', '2026-08-07 00:20')"],
                reason: 'system',
              }],
            }],
          },
        },
      },
    }];

    const evidence = await collectMixedStorageEvidence_ACU({
      chat,
      isolationKey: '',
      isolationConfig: { enabled: false, code: '' },
      legacyCandidateData: checkpointData,
    });

    expect(evidence.v2.replay).toEqual(expect.objectContaining({
      status: 'success',
      requiresCheckpointConvergence: true,
      compatibilityRepairs: [expect.objectContaining({
        kind: 'temporary_sheet_anchor', sheetKey: 'sheet_global', messageIndex: 0, seq: 1, operationIndex: 0,
      })],
    }));
    expect(evidence.v2.replay.data?.sheet_global.content).toEqual([
      ['row_id', 'prev_scene_time', 'elapsed_time', 'cur_time'],
      ['1', '2026-08-07 00:15', '5分', '2026-08-07 00:20'],
    ]);
  });
});
