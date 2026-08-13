import { describe, expect, it } from 'vitest';
import { normalizeSheetGuideRowIds_ACU } from '../../../src/service/template/chat-scope/sheet-guide-row-id-normalizer';

function guide(header: unknown[], rows: unknown[][] = []) {
  return { mate: { type: 'chatSheets', version: 2 }, sheet_a: { uid: 'sheet_a', name: '测试表', content: [header], seedRows: rows } };
}

describe('normalizeSheetGuideRowIds_ACU', () => {
  it('普通业务表头插入 row_id，并保持种子行的业务值与顺序', () => {
    const input = guide(['名称', '数量'], [['铁剑', 1], ['药水', 2]]);
    const result = normalizeSheetGuideRowIds_ACU(input);
    expect(result.blockers).toEqual([]);
    expect(result.guideData.sheet_a.content).toEqual([['row_id', '名称', '数量']]);
    expect(result.guideData.sheet_a.seedRows).toEqual([['1', '铁剑', 1], ['2', '药水', 2]]);
    expect(input.sheet_a.content).toEqual([['名称', '数量']]);
    expect(input.sheet_a.seedRows).toEqual([['铁剑', 1], ['药水', 2]]);
  });

  it('将“行号”首列作为身份别名改名，不右移业务列', () => {
    const result = normalizeSheetGuideRowIds_ACU(guide(['行号', '名称'], [['7', '铁剑']]));
    expect(result.blockers).toEqual([]);
    expect(result.guideData.sheet_a.content).toEqual([['row_id', '名称']]);
    expect(result.guideData.sheet_a.seedRows).toEqual([['7', '铁剑']]);
  });

  it('重复执行幂等，错位身份列和重复 ID 均拒绝自动修复', () => {
    const first = normalizeSheetGuideRowIds_ACU(guide(['名称'], [['铁剑']]));
    expect(normalizeSheetGuideRowIds_ACU(first.guideData).changed).toBe(false);
    expect(normalizeSheetGuideRowIds_ACU(guide(['名称', '行号'], [['铁剑', '1']])).blockers).toHaveLength(1);
    expect(normalizeSheetGuideRowIds_ACU(guide(['row_id', '名称'], [['1', '铁剑'], ['1', '盾牌']])).blockers).toHaveLength(1);
  });

  it.each(['id', 'rowId', 'row-id'])('将首列历史别名 %s 改名为 row_id，不改变行值位置', (alias) => {
    const result = normalizeSheetGuideRowIds_ACU(guide([alias, '名称'], [['legacy-7', '铁剑']]));

    expect(result.blockers).toEqual([]);
    expect(result.guideData.sheet_a.content).toEqual([['row_id', '名称']]);
    expect(result.guideData.sheet_a.seedRows).toEqual([['legacy-7', '铁剑']]);
  });

  it('短种子行尾部补 null，超宽或非法种子行 fail-closed', () => {
    const shortRow = normalizeSheetGuideRowIds_ACU(guide(['row_id', '名称', '数量'], [['7', '铁剑']]));
    expect(shortRow.blockers).toEqual([]);
    expect(shortRow.guideData.sheet_a.seedRows).toEqual([['7', '铁剑', null]]);

    expect(normalizeSheetGuideRowIds_ACU(guide(['名称'], [['铁剑', '额外列']])).blockers).toHaveLength(1);
    const nonArrayRows: any = guide(['row_id', '名称']);
    nonArrayRows.sheet_a.seedRows = ['非法行'];
    expect(normalizeSheetGuideRowIds_ACU(nonArrayRows).blockers).toHaveLength(1);
  });

  it('同时存在 seedRows 与历史 _seedRows 时，以当前字段 seedRows 为准', () => {
    const input: any = guide(['名称'], [['当前字段']]);
    input.sheet_a._seedRows = [['历史字段']];

    const result = normalizeSheetGuideRowIds_ACU(input);

    expect(result.blockers).toEqual([]);
    expect(result.guideData.sheet_a.seedRows).toEqual([['1', '当前字段']]);
    expect(result.guideData.sheet_a._seedRows).toEqual([['历史字段']]);
  });

  it('缺失或空表头时拒绝，且 blocker 候选不得被调用方当作成功结果使用', () => {
    const missingContent: any = { mate: {}, sheet_a: { name: '坏表' } };
    const emptyHeader = guide([], []);

    expect(normalizeSheetGuideRowIds_ACU(missingContent).blockers).toHaveLength(1);
    expect(normalizeSheetGuideRowIds_ACU(emptyHeader).blockers).toHaveLength(1);
  });
});
