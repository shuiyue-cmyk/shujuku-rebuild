import { describe, expect, it } from 'vitest';
import {
  buildCanonicalFullCheckpoint_ACU,
  buildCanonicalSheetCheckpoint_ACU,
} from '../../../src/service/table/canonical-checkpoint-builder';

function sheet(content: any[][] = [['row_id', '名称'], ['1', '铁剑']]) {
  return { uid: 'inventory', name: '背包', content, sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 } as any;
}

describe('canonical-checkpoint-builder', () => {
  it('构建 full checkpoint 时深拷贝数据和可选 metadata', () => {
    const data = { mate: { type: 'acu' }, sheet_0: sheet() } as any;
    const scheduleSummary = { sheet_0: { lastFilledAiFloor: 3, lastChangedAiFloor: 2 } } as any;
    const event = { filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'] } as any;
    const manualRefillProgress = { kind: 'manual_refill', status: 'complete', selectedSheetKeys: ['sheet_0'] } as any;
    const migrationProvenance = {
      version: 1 as const,
      legacyDataFingerprint: 'fnv1a:abcd1234',
      legacySourceMessageIndices: [0],
      legacySourceAiFloors: [1],
      legacyLastChangedAiFloorBySheet: { sheet_0: 1 },
      targetMessageIndex: 4,
      targetAiFloor: 2,
      isolationKey: 'tag-a',
      migratedAt: 10,
    };

    const result = buildCanonicalFullCheckpoint_ACU({
      createdAt: 10, reason: 'migration', data, scheduleSummary, event, manualRefillProgress, migrationProvenance,
      context: { messageIndex: 4, aiFloor: 2, isolationKey: 'tag-a' },
    });

    expect(result.checkpoint).toMatchObject({ kind: 'full', createdAt: 10, reason: 'migration', data, scheduleSummary, event, manualRefillProgress, migrationProvenance });
    expect(result.issues).toBeUndefined();
    data.sheet_0.content[1][1] = '调用方修改';
    scheduleSummary.sheet_0.lastFilledAiFloor = 99;
    event.changedSheetKeys.push('sheet_other');
    manualRefillProgress.selectedSheetKeys.push('sheet_other');
    migrationProvenance.legacySourceMessageIndices.push(9);
    migrationProvenance.legacyLastChangedAiFloorBySheet.sheet_0 = 99;
    expect(result.checkpoint?.data.sheet_0.content[1][1]).toBe('铁剑');
    expect(result.checkpoint?.scheduleSummary?.sheet_0.lastFilledAiFloor).toBe(3);
    expect(result.checkpoint?.event?.changedSheetKeys).toEqual(['sheet_0']);
    expect(result.checkpoint?.manualRefillProgress?.selectedSheetKeys).toEqual(['sheet_0']);
    expect(result.checkpoint?.migrationProvenance?.legacySourceMessageIndices).toEqual([0]);
    expect(result.checkpoint?.migrationProvenance?.legacyLastChangedAiFloorBySheet).toEqual({ sheet_0: 1 });
  });

  it('构建 sheet checkpoint 时保留 baseRevision 并深拷贝 metadata', () => {
    const data = sheet();
    const event = { filledSheetKeys: [], changedSheetKeys: ['sheet_0'] } as any;
    const result = buildCanonicalSheetCheckpoint_ACU({
      createdAt: 11, reason: 'manual', sheetKey: 'sheet_0', data, event,
      scheduleSummary: { lastFilledAiFloor: 5 } as any, baseRevision: 'runtime-v1:7',
      context: { messageIndex: 8, isolationKey: 'tag-b' },
    });

    expect(result.checkpoint).toMatchObject({ kind: 'sheet_full', sheetKey: 'sheet_0', baseRevision: 'runtime-v1:7', event });
    data.content[1][1] = '调用方修改';
    event.changedSheetKeys.push('sheet_other');
    expect(result.checkpoint?.data.content[1][1]).toBe('铁剑');
    expect(result.checkpoint?.event?.changedSheetKeys).toEqual(['sheet_0']);
  });

  it('拒绝非法 sheet checkpoint，并且最终错误文本不泄露单元格内容', () => {
    const result = buildCanonicalSheetCheckpoint_ACU({
      createdAt: 11,
      reason: 'manual',
      sheetKey: 'sheet_0',
      data: sheet([['row_id', '名称'], ['1', '铁剑'], [' 1 ', '冒名副本']]),
      context: { messageIndex: 8, isolationKey: 'tag-b' },
    });

    expect(result.checkpoint).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({ type: 'duplicate_row_id', sheetKey: 'sheet_0', messageIndex: 8, isolationKey: 'tag-b' }),
    ]);
    expect(result.error).toContain('duplicate_row_id');
    expect(result.error).not.toContain('铁剑');
    expect(result.error).not.toContain('冒名副本');
  });

  it.each([
    ['duplicate', { mate: {}, sheet_0: sheet([['row_id', '名称'], ['1', '铁剑'], [' 1 ', '冒名副本']]) }, 'duplicate_row_id'],
    ['empty', { mate: {}, sheet_0: sheet([['row_id', '名称'], ['', '空身份']]) }, 'empty_row_id'],
    ['header', { mate: {}, sheet_0: sheet([['id', '名称'], ['1', '铁剑']]) }, 'invalid_header'],
    ['width', { mate: {}, sheet_0: sheet([['row_id', '名称'], ['1']]) }, 'row_width_mismatch'],
  ])('拒绝 %s full checkpoint，返回定位上下文且不泄露业务行内容', (_name, data, issueType) => {
    const result = buildCanonicalFullCheckpoint_ACU({
      createdAt: 12, reason: 'migration', data: data as any,
      context: { messageIndex: 9, aiFloor: 4, isolationKey: 'tag-c' },
    });

    expect(result.checkpoint).toBeUndefined();
    expect(result.error).toContain(issueType);
    expect(result.issues).toEqual([expect.objectContaining({ type: issueType, sheetKey: 'sheet_0', messageIndex: 9, aiFloor: 4, isolationKey: 'tag-c' })]);
    expect(result.issues?.every(issue => !Object.prototype.hasOwnProperty.call(issue, 'cells'))).toBe(true);
    expect(JSON.stringify(result.issues)).not.toContain('铁剑');
    expect(JSON.stringify(result.issues)).not.toContain('冒名副本');
    expect(result.error).not.toContain('铁剑');
    expect(result.error).not.toContain('冒名副本');
  });
});
