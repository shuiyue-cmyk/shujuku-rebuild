import { describe, expect, it } from 'vitest';
import { getTableDataFingerprint_ACU } from '../../../src/service/table/table-data-upgrade-audit';
import { evaluateMixedStorageDecision_ACU } from '../../../src/service/table/mixed-storage-decision';

function sheet(rows: string[][]) {
  return { uid: 'inventory', name: '背包', content: [['row_id', '名称'], ...rows], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 } as any;
}

function buildChat(legacyData: any, v2Data: any, options: { provenance?: boolean; successor?: boolean } = {}) {
  const provenance = options.provenance === false ? undefined : {
    version: 1 as const,
    legacyDataFingerprint: getTableDataFingerprint_ACU(legacyData),
    legacySourceMessageIndices: [0],
    legacySourceAiFloors: [1],
    legacyLastChangedAiFloorBySheet: { sheet_0: 1 },
    targetMessageIndex: 1,
    targetAiFloor: 2,
    isolationKey: '',
    migratedAt: 1,
  };
  return [
    { is_user: false, TavernDB_ACU_Data: legacyData, TavernDB_ACU_ModifiedKeys: ['sheet_0'] },
    { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: {
      version: 2,
      checkpoint: { kind: 'full', createdAt: 1, reason: 'migration', data: v2Data, scheduleSummary: { sheet_0: { lastChangedAiFloor: 1 } }, migrationProvenance: provenance },
      logEntries: [],
    } } } },
    ...(options.successor ? [{ is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: {
      version: 2,
      logEntries: [{ seq: 1, entryId: 'successor', createdAt: 2, source: 'manual_crud', targetMessageIndex: 2, aiFloor: 3, filledSheetKeys: [], changedSheetKeys: ['sheet_0'], operations: [] }],
    } } } }] : []),
  ];
}

async function evaluate(chat: any[], legacyData: any) {
  return evaluateMixedStorageDecision_ACU({ chat, isolationKey: '', isolationConfig: { enabled: false, code: '' }, legacyData });
}

describe('mixed-storage-decision', () => {
  it('仅在 provenance、fingerprint 与 coverage 全部匹配时授权 keep_v2', async () => {
    const legacyData = { sheet_0: sheet([['1', '药水']]) } as any;
    const chat = buildChat(legacyData, structuredClone(legacyData));
    const before = structuredClone(chat);

    const decision = await evaluate(chat, legacyData);

    expect(decision.kind).toBe('equivalent_provenance_verified');
    expect(decision.allowedActions).toEqual(['noop', 'download_snapshots', 'keep_v2']);
    expect(chat).toEqual(before);
  });

  it('历史 checkpoint 缺 provenance 但业务投影与覆盖均可验证时，授权带 backup 的 keep_v2', async () => {
    const legacyData = { sheet_0: sheet([['1', '药水']]) } as any;
    const decision = await evaluate(buildChat(legacyData, structuredClone(legacyData), { provenance: false }), legacyData);

    expect(decision.kind).toBe('equivalent_projection_verified');
    expect(decision.diagnosticCodes).toContain('provenance_missing_or_invalid');
    expect(decision.allowedActions).toContain('keep_v2');
  });


  it('legacy 与 V2 仅 key 不同但规范名相同时先归一化，再按投影等价放行', async () => {
    const legacyData = { sheet_legacy: { ...sheet([['1', '药水']]), uid: 'sheet_legacy', name: '背包物品表' } } as any;
    const v2Data = { sheet_bei_bao_wu_pin_biao: { ...sheet([['1', '药水']]), uid: 'sheet_bei_bao_wu_pin_biao', name: '背包物品表' } } as any;
    const chat = buildChat(legacyData, v2Data, { provenance: false });
    chat[0].TavernDB_ACU_ModifiedKeys = ['sheet_legacy'];
    chat[1].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.scheduleSummary = {
      sheet_bei_bao_wu_pin_biao: { lastChangedAiFloor: 1 },
    };

    const decision = await evaluate(chat, legacyData);

    expect(decision.kind).toBe('equivalent_projection_verified');
    expect(decision.diagnosticCodes).toContain('legacy_keys_normalized');
    expect(decision.allowedActions).toContain('keep_v2');
  });

  it('V2 replay 缺少 full anchor 时保持 fail-closed', async () => {
    const legacyData = { sheet_0: sheet([['1', '药水']]) } as any;
    const chat = [{ is_user: false, TavernDB_ACU_Data: legacyData }, { is_user: false, TavernDB_ACU_IsolatedData: { '': { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [] } } } }];
    const decision = await evaluate(chat, legacyData);

    expect(decision.kind).toBe('blocked_replay_unavailable');
    expect(decision.allowedActions).toEqual(['noop', 'download_snapshots']);
  });

  it('V2 replay 依赖临时 Sheet 补锚时阻止 keep_v2 与 merge candidate', async () => {
    const legacyData = { sheet_0: sheet([['1', '药水']]) } as any;
    const template = {
      mate: { type: 'acu', version: 1 },
      sheet_global: {
        uid: 'global_state', name: '全局数据表',
        content: [['row_id', 'prev_scene_time', 'elapsed_time', 'cur_time']],
        sourceData: { ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, prev_scene_time TEXT, elapsed_time TEXT, cur_time TEXT);' },
        updateConfig: {}, exportConfig: {}, orderNo: 1,
      },
    } as any;
    const chat = [{
      is_user: false,
      TavernDB_ACU_Data: legacyData,
      TavernDB_ACU_ModifiedKeys: ['sheet_0'],
      TavernDB_ACU_ScopedConfig: {
        version: 1,
        template: { '': { mode: 'chat_override', isolationKey: '', templateStr: JSON.stringify(template) } },
      },
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'migration', data: legacyData },
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

    const decision = await evaluate(chat, legacyData);

    expect(decision.kind).toBe('blocked_checkpoint_convergence');
    expect(decision.diagnosticCodes).toContain('v2_requires_checkpoint_convergence');
    expect(decision.allowedActions).toEqual(['noop', 'download_snapshots']);
    expect(decision.frozenMergeCandidate).toBeUndefined();
  });

  it('已验证的 V2 后继状态仅在 anchor 后有 V2 活动时授权 keep_v2', async () => {
    const legacyData = { sheet_0: sheet([['1', '药水']]) } as any;
    const v2Data = { sheet_0: sheet([['1', '药水'], ['2', '卷轴']]) } as any;
    const decision = await evaluate(buildChat(legacyData, v2Data, { successor: true }), legacyData);

    expect(decision.kind).toBe('v2_successor_verified');
    expect(decision.allowedActions).toContain('keep_v2');
  });

  it('仅追加 V2 缺失且 row_id 不冲突的 legacy 行，冻结 merge candidate', async () => {
    const legacyData = { sheet_0: sheet([['1', '药水'], ['2', '卷轴']]) } as any;
    const v2Data = { sheet_0: sheet([['1', '药水']]) } as any;
    const decision = await evaluate(buildChat(legacyData, v2Data, { provenance: false }), legacyData);

    expect(decision.kind).toBe('legacy_has_v2_missing_data');
    expect(decision.frozenMergeCandidate?.sheet_0.content).toEqual([['row_id', '名称'], ['1', '药水'], ['2', '卷轴']]);
    expect(decision.allowedActions).toContain('commit_merge_candidate');
  });

  it('同一 row_id 的业务单元格冲突时拒绝构造 merge candidate', async () => {
    const legacyData = { sheet_0: sheet([['1', '旧名称']]) } as any;
    const v2Data = { sheet_0: sheet([['1', '新名称']]) } as any;
    const decision = await evaluate(buildChat(legacyData, v2Data, { provenance: false }), legacyData);

    expect(decision.kind).toBe('conflict_requires_user_choice');
    expect(decision.frozenMergeCandidate).toBeUndefined();
    expect(decision.diagnosticCodes).toContain('merge_candidate_conflict');
  });

  it('legacy 审计要求确认时不允许生成自动决策或 merge candidate', async () => {
    const legacyData = { sheet_0: sheet([['1', '药水', '溢出列']]) } as any;
    const v2Data = { sheet_0: sheet([['1', '药水']]) } as any;
    const decision = await evaluate(buildChat(legacyData, v2Data), legacyData);

    expect(decision.kind).toBe('blocked_legacy_requires_confirmation');
    expect(decision.frozenMergeCandidate).toBeUndefined();
    expect(decision.allowedActions).toEqual(['noop', 'download_snapshots']);
  });

  it('畸形 provenance 不得进入 verified 类别', async () => {
    const legacyData = { sheet_0: sheet([['1', '药水']]) } as any;
    const chat = buildChat(legacyData, structuredClone(legacyData));
    chat[1].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.migrationProvenance.legacySourceMessageIndices = [];

    const decision = await evaluate(chat, legacyData);

    expect(decision.kind).toBe('conflict_requires_user_choice');
    expect(decision.diagnosticCodes).toContain('provenance_claim_mismatch');
  });

  it('provenance 来源与当前 legacy evidence 不一致时必须保持冲突', async () => {
    const legacyData = { sheet_0: sheet([['1', '药水']]) } as any;
    const chat = buildChat(legacyData, structuredClone(legacyData));
    chat[1].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.migrationProvenance.legacySourceMessageIndices = [99];

    const decision = await evaluate(chat, legacyData);

    expect(decision.kind).toBe('conflict_requires_user_choice');
    expect(decision.diagnosticCodes).toContain('provenance_claim_mismatch');
  });

  it('V2 coverage 早于 legacy 最后变更 floor 时不得授权 cleanup', async () => {
    const legacyData = { sheet_0: sheet([['1', '药水']]) } as any;
    const chat = buildChat(legacyData, structuredClone(legacyData));
    chat[1].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.scheduleSummary.sheet_0.lastChangedAiFloor = 0;

    const decision = await evaluate(chat, legacyData);

    expect(decision.kind).toBe('conflict_requires_user_choice');
    expect(decision.diagnosticCodes).toContain('v2_coverage_insufficient');
  });

  it('schema/header 不一致时拒绝构造 merge candidate', async () => {
    const legacyData = { sheet_0: sheet([['1', '药水']]) } as any;
    const v2Data = { sheet_0: { ...sheet([['1', '药水']]), content: [['row_id', '不同列'], ['1', '药水']] } } as any;

    const decision = await evaluate(buildChat(legacyData, v2Data, { provenance: false }), legacyData);

    expect(decision.kind).toBe('conflict_requires_user_choice');
    expect(decision.frozenMergeCandidate).toBeUndefined();
    expect(decision.diagnosticCodes).toContain('merge_candidate_conflict');
  });

  it('冻结 decision 时不会冻结 live chat reference', async () => {
    const legacyData = { sheet_0: sheet([['1', '药水']]) } as any;
    const chat = buildChat(legacyData, structuredClone(legacyData));
    const decision = await evaluate(chat, legacyData);

    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(chat)).toBe(false);
    expect(() => chat.push({ is_user: true, mes: '仍可由调用方管理' })).not.toThrow();
  });
});
