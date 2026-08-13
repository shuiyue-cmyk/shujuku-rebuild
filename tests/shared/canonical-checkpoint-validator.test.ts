import { describe, expect, it } from 'vitest';
import {
  validateCanonicalCheckpoint_ACU,
  validateCanonicalCheckpointData_ACU,
  validateMigrationProvenanceV1_ACU,
} from '../../src/shared/canonical-checkpoint-validator';

function fullCheckpoint(data: any) {
  return { kind: 'full', createdAt: 1, reason: 'init', data };
}

function sheet(name = '背包', content: any[][] = [['row_id', '名称'], ['1', name]]) {
  return { uid: 'inventory', name, content, sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 };
}

describe('canonical-checkpoint-validator', () => {
  it('接受 header-only full 与 sheet_full checkpoint，并保留定位上下文', () => {
    const full = fullCheckpoint({ sheet_0: sheet('空表', [['row_id', '名称']]) });
    const fullResult = validateCanonicalCheckpoint_ACU(full, { messageIndex: 12, aiFloor: 8, isolationKey: 'tag-a' });
    const sheetResult = validateCanonicalCheckpoint_ACU({
      kind: 'sheet_full', createdAt: 2, reason: 'manual', sheetKey: 'sheet_0', data: sheet(),
    });

    expect(fullResult).toEqual({ valid: true, issues: [] });
    expect(sheetResult).toEqual({ valid: true, issues: [] });
  });

  it('只读报告 canonical duplicate、空 ID、非数组行和行宽错误，不修改历史 snapshot', () => {
    const data = {
      sheet_0: sheet('背包', [
        ['row_id', '名称'],
        ['1', '铁剑'],
        [' 1 ', '冒名副本'],
        [' ', '空身份'],
        { secret: '不得泄漏' },
        ['2'],
      ]),
    };
    const before = JSON.parse(JSON.stringify(data));

    const result = validateCanonicalCheckpointData_ACU(data, { messageIndex: 7, aiFloor: 4, isolationKey: 'tag-a', reason: 'migration' });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ checkpointKind: 'data', type: 'duplicate_row_id', sheetKey: 'sheet_0', rowIndex: 2, rowId: '1' }),
      expect.objectContaining({ checkpointKind: 'data', type: 'empty_row_id', sheetKey: 'sheet_0', rowIndex: 3 }),
      expect.objectContaining({ checkpointKind: 'data', type: 'invalid_row', sheetKey: 'sheet_0', rowIndex: 4 }),
      expect.objectContaining({ checkpointKind: 'data', type: 'row_width_mismatch', sheetKey: 'sheet_0', rowIndex: 5, rowId: '2' }),
    ]);
    expect(result.issues.every(issue => !Object.prototype.hasOwnProperty.call(issue, 'cells'))).toBe(true);
    expect(JSON.stringify(data)).toBe(JSON.stringify(before));
  });

  it('分别报告坏 checkpoint 外壳、坏表头与 sheet_full key 不匹配', () => {
    const invalidFull = validateCanonicalCheckpoint_ACU({ kind: 'full', createdAt: -1, reason: '', data: {} });
    const invalidSheet = validateCanonicalCheckpoint_ACU({
      kind: 'sheet_full', createdAt: 1, reason: 'manual', sheetKey: 'inventory', data: sheet(),
    });
    const invalidHeader = validateCanonicalCheckpoint_ACU(fullCheckpoint({
      sheet_0: sheet('坏表', [['id', '名称'], ['1', '铁剑']]),
    }));

    expect(invalidFull.issues.map(issue => issue.type)).toEqual(['invalid_created_at', 'invalid_reason', 'missing_sheet']);
    expect(invalidSheet.issues.map(issue => issue.type)).toEqual(['sheet_key_mismatch']);
    expect(invalidHeader.issues).toEqual([
      expect.objectContaining({ checkpointKind: 'full', type: 'invalid_header', sheetKey: 'sheet_0', rowIndex: 0 }),
    ]);
  });

  it('严格校验可审计的 migration provenance，但不要求历史 checkpoint 包含它', () => {
    const provenance = {
      version: 1,
      legacyDataFingerprint: 'fnv1a:abcd1234',
      legacySourceMessageIndices: [0, 3],
      legacySourceAiFloors: [1, 2],
      legacyLastChangedAiFloorBySheet: { sheet_0: 2 },
      targetMessageIndex: 5,
      targetAiFloor: 3,
      isolationKey: 'tag-a',
      migratedAt: 123,
    };

    expect(validateMigrationProvenanceV1_ACU(provenance)).toEqual({ valid: true, issues: [] });
    expect(validateCanonicalCheckpoint_ACU(fullCheckpoint({ sheet_0: sheet() }))).toEqual({ valid: true, issues: [] });
  });

  it('接受结构完整的手动重填模板临时根 provenance，并拒绝损坏结构', () => {
    const fallbackProvenance = {
      version: 1,
      kind: 'manual_refill_template_root',
      runId: 'manual-refill:test',
      isolationKey: 'tag-a',
      targetSheetKeys: ['sheet_0'],
      rangeStartMessageIndex: 2,
      rangeEndMessageIndex: 5,
      templateFingerprint: 'fnv1a:abcd1234',
      createdAt: 123,
    };
    const valid = validateCanonicalCheckpoint_ACU({
      ...fullCheckpoint({ sheet_0: sheet() }),
      fallbackProvenance,
    });
    const invalid = validateCanonicalCheckpoint_ACU({
      ...fullCheckpoint({ sheet_0: sheet() }),
      fallbackProvenance: { ...fallbackProvenance, rangeEndMessageIndex: 1 },
    });

    expect(valid).toEqual({ valid: true, issues: [] });
    expect(invalid.issues).toEqual([
      expect.objectContaining({ type: 'invalid_fallback_provenance' }),
    ]);
  });

  it.each([
    ['缺少 fingerprint', { legacyDataFingerprint: '' }, 'invalid_legacy_fingerprint'],
    ['未知版本', { version: 2 }, 'unsupported_provenance_version'],
    ['重复或未排序来源索引', { legacySourceMessageIndices: [3, 3] }, 'invalid_source_indices'],
    ['无效来源 floor', { legacySourceAiFloors: [0, 2] }, 'invalid_source_ai_floors'],
    ['无效 sheet floor map', { legacyLastChangedAiFloorBySheet: { invalid: 1 } }, 'invalid_last_changed_floor_by_sheet'],
    ['无效 target', { targetMessageIndex: -1, targetAiFloor: 0 }, 'invalid_target_message_index'],
  ])('拒绝 %s 的 provenance', (_name, patch, expectedIssue) => {
    const provenance = {
      version: 1,
      legacyDataFingerprint: 'fnv1a:abcd1234',
      legacySourceMessageIndices: [0, 3],
      legacySourceAiFloors: [1, 2],
      legacyLastChangedAiFloorBySheet: { sheet_0: 2 },
      targetMessageIndex: 5,
      targetAiFloor: 3,
      isolationKey: '',
      migratedAt: 123,
      ...patch,
    };
    expect(validateMigrationProvenanceV1_ACU(provenance)).toEqual(expect.objectContaining({ valid: false }));
    expect(validateMigrationProvenanceV1_ACU(provenance).issues).toContain(expectedIssue);
  });
});
