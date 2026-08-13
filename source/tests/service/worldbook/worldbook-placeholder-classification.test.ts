import { describe, expect, it } from 'vitest';
import {
  buildExternalCustomTableExportComment_ACU,
  isDatabaseGeneratedLorebookEntry_ACU,
  isSplitByRowTable_ACU,
  parseExternalCustomTableExportMarker_ACU,
  resolveGeneratedEntriesForTable_ACU,
} from '../../../src/service/worldbook/worldbook-placeholder-classification';

const tableData = {
  sheet_people: {
    name: '人物关系表',
    exportConfig: { enabled: true, splitByRow: true, entryName: '关系档案', extraIndexEnabled: false },
  },
};

describe('worldbook placeholder classification', () => {
  it('keeps external import entries, including marked exports, out of database-generated classification', () => {
    const comment = buildExternalCustomTableExportComment_ACU('外部导入-关系档案-1', {
      version: 1,
      kind: 'custom_table_export',
      sheetKey: 'sheet_people',
      tableName: '人物关系表',
      entryName: '关系档案',
      role: 'row',
      rowIndex: 1,
    });
    expect(parseExternalCustomTableExportMarker_ACU(comment)).toMatchObject({ role: 'row', rowIndex: 1 });
    expect(isDatabaseGeneratedLorebookEntry_ACU({ comment })).toBe(false);
    expect(isDatabaseGeneratedLorebookEntry_ACU({ comment: '外部导入-总结条目-1' })).toBe(false);
    expect(isDatabaseGeneratedLorebookEntry_ACU({ comment: 'TavernDB-ACU-CustomExport-关系档案-1' })).toBe(true);
    expect(isDatabaseGeneratedLorebookEntry_ACU({ comment: 'TavernDB-ACU-AgentGreenlight-plot' })).toBe(false);
  });

  it('resolves marked external entries and stable internal entries for the unique table only', () => {
    const marked = {
      comment: buildExternalCustomTableExportComment_ACU('外部导入-关系档案-1', {
        version: 1, kind: 'custom_table_export', sheetKey: 'sheet_people', tableName: '人物关系表', entryName: '关系档案', role: 'row', rowIndex: 1,
      }),
    };
    const internal = { comment: 'TavernDB-ACU-CustomExport-关系档案-2' };
    const historicalImport = { comment: '外部导入-关系档案-2' };
    expect(resolveGeneratedEntriesForTable_ACU([marked, internal, historicalImport], '人物关系表', tableData)).toEqual([marked, internal]);
    expect(isSplitByRowTable_ACU('人物关系表', tableData)).toBe(true);
  });

  it('rejects ambiguous entryName mappings instead of guessing table ownership', () => {
    const ambiguous = {
      ...tableData,
      sheet_other: { name: '另一张表', exportConfig: { enabled: true, splitByRow: false, entryName: '关系档案' } },
    };
    expect(resolveGeneratedEntriesForTable_ACU([{ comment: 'TavernDB-ACU-CustomExport-关系档案' }], '人物关系表', ambiguous)).toEqual([]);
  });
});
