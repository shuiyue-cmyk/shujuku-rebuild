import { describe, expect, it } from 'vitest';
import { auditTableDataForUpgrade_ACU } from '../../src/service/table/table-data-upgrade-audit';
import { repairTableDataFromAudit_ACU } from '../../src/service/table/table-data-repair';

function data(content: unknown[][], seedRows?: unknown[][], ddl?: string) {
  return { mate: { type: 'chatSheets', version: 1 }, sheet_0: { content, seedRows, sourceData: { ddl } } };
}
function nonEmptyCells(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce<number>((total, item) => total + (Array.isArray(item) ? nonEmptyCells(item) : item === null || item === undefined || item === '' ? 0 : 1), 0);
}

describe('table-data-upgrade-audit', () => {
  it('接受已满足 canonical 契约的基线数据', () => {
    const audit = auditTableDataForUpgrade_ACU(data([['row_id', 'name'], ['1', '铁剑']]));
    expect(audit.status).toBe('clean');
    expect(audit.issues).toEqual([]);
  });

  it('将可识别身份列表头改名为 row_id 并保留行', () => {
    const source = data([['rowId', 'name'], ['1', '铁剑']]);
    const result = repairTableDataFromAudit_ACU(auditTableDataForUpgrade_ACU(source));
    expect(result.status).toBe('repairable');
    expect((result.candidateData as any).sheet_0.content).toEqual([['row_id', 'name'], ['1', '铁剑']]);
    expect(source.sheet_0.content[0][0]).toBe('rowId');
  });

  it('仅在 DDL 可证明业务表头完整时插入 row_id', () => {
    const source = data([['物品名'], ['铁剑']], undefined, 'CREATE TABLE inventory (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  item_name TEXT -- 物品名\n)');
    const result = repairTableDataFromAudit_ACU(auditTableDataForUpgrade_ACU(source));
    expect(result.status).toBe('repairable');
    expect((result.candidateData as any).sheet_0.content).toEqual([['row_id', '物品名'], ['1', '铁剑']]);
  });

  it('为无数据业务表头插入 row_id，不创建占位行且不修改输入', () => {
    const source = data([['名称', '数量']]);
    const audit = auditTableDataForUpgrade_ACU(source);
    const result = repairTableDataFromAudit_ACU(audit);

    expect(audit.status).toBe('repairable');
    expect(audit.repairPlan).toContainEqual(expect.objectContaining({
      action: 'insert_row_id_column', sheetKey: 'sheet_0', rowIndex: 0,
    }));
    expect((result.candidateData as any).sheet_0.content).toEqual([['row_id', '名称', '数量']]);
    expect((result.candidateData as any).sheet_0.seedRows).toBeUndefined();
    expect(result.idRemap).toEqual([]);
    expect(source.sheet_0.content).toEqual([['名称', '数量']]);
  });

  it('无数据模板的 rowId 别名只改名，不额外插入列', () => {
    const source = data([['rowId', '名称']]);
    const result = repairTableDataFromAudit_ACU(auditTableDataForUpgrade_ACU(source));

    expect((result.candidateData as any).sheet_0.content).toEqual([['row_id', '名称']]);
  });

  it('有 content 或 seedRows 数据的无 DDL 表头仍不猜测插入 row_id', () => {
    const contentSource = data([['名称'], ['铁剑']]);
    const seedSource = data([['名称']], [['铁剑']]);

    expect(auditTableDataForUpgrade_ACU(contentSource).status).toBe('requires_confirmation');
    expect(auditTableDataForUpgrade_ACU(seedSource).status).toBe('requires_confirmation');
  });

  it('无数据模板的错位 row_id 仍要求人工确认', () => {
    const source = data([['名称', 'row_id']]);

    expect(auditTableDataForUpgrade_ACU(source).status).toBe('requires_confirmation');
  });

  it('为数值/字符串重复 ID 与空 ID 分配稳定新 ID，保留所有业务单元格', () => {
    const source = data([['row_id', 'name'], [1, '铁剑'], ['1', '盾牌'], [' ', '药水']]);
    const audit = auditTableDataForUpgrade_ACU(source);
    const result = repairTableDataFromAudit_ACU(audit);
    expect(audit.issues.map(item => item.code)).toContain('upgrade_duplicate_row_id');
    expect(audit.issues.map(item => item.code)).toContain('upgrade_empty_row_id');
    expect((result.candidateData as any).sheet_0.content).toEqual([['row_id', 'name'], ['1', '铁剑'], ['2', '盾牌'], ['3', '药水']]);
    expect(result.idRemap).toHaveLength(2);
  });

  it('补齐短行，但保留长行原值并要求确认', () => {
    const source = data([['row_id', 'name'], ['1'], ['2', '盾牌', '不可丢失']]);
    const result = repairTableDataFromAudit_ACU(auditTableDataForUpgrade_ACU(source));
    expect(result.requiresConfirmation).toBe(true);
    expect((result.candidateData as any).sheet_0.content[1]).toEqual(['1', null]);
    expect((result.candidateData as any).sheet_0.content[2]).toEqual(['2', '盾牌', '不可丢失']);
    expect(result.overflowCells).toEqual([{ sheetKey: 'sheet_0', rowPool: 'content', rowIndex: 2, cells: ['不可丢失'] }]);
  });

  it('将非数组行与可补齐短行分为不同审计类别，避免把不可修复形状误放入无损修复', () => {
    const source: any = data([['row_id', 'name'], ['1'], { malformed: true } as any]);
    const audit = auditTableDataForUpgrade_ACU(source);

    expect(audit.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'upgrade_row_width_mismatch', rowIndex: 1 }),
      expect.objectContaining({ code: 'upgrade_invalid_row_shape', rowIndex: 2 }),
    ]));
    expect(audit.status).toBe('requires_confirmation');
  });

  it('短行缺少 NOT NULL 且无默认值的业务列时禁止自动猜值', () => {
    const source = data(
      [['row_id', '当前地点', '当前主要地区'], ['1', '新宿']],
      undefined,
      'CREATE TABLE global_state (\n  row_id INTEGER PRIMARY KEY,\n  current_location TEXT NOT NULL, -- 当前地点\n  current_major_region TEXT NOT NULL -- 当前主要地区\n);',
    );

    const audit = auditTableDataForUpgrade_ACU(source);
    const result = repairTableDataFromAudit_ACU(audit);

    expect(audit.status).toBe('requires_confirmation');
    expect(audit.issues).toContainEqual(expect.objectContaining({
      code: 'upgrade_required_business_cell_missing', sheetKey: 'sheet_0', rowIndex: 1,
    }));
    expect(result.requiresConfirmation).toBe(true);
  });

  it('缺少 row_id 的中文业务表头仍审计 content 与 seedRows 的 NOT NULL 缺口', () => {
    const source = data(
      [['当前地点', '当前主要地区'], ['新宿']],
      [['大阪']],
      'CREATE TABLE global_state (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  current_location TEXT NOT NULL, -- 当前地点\n  current_major_region TEXT NOT NULL -- 当前主要地区\n);',
    );

    const audit = auditTableDataForUpgrade_ACU(source);

    expect(audit.status).toBe('requires_confirmation');
    expect(audit.repairPlan).toContainEqual(expect.objectContaining({ action: 'insert_row_id_column', sheetKey: 'sheet_0' }));
    expect(audit.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'upgrade_required_business_cell_missing', rowPool: 'content', rowIndex: 1 }),
      expect.objectContaining({ code: 'upgrade_required_business_cell_missing', rowPool: 'seedRows', rowIndex: 0 }),
    ]));
  });

  it('quoted 且大小写不同的物理列名仍能命中 NOT NULL 审计', () => {
    const source = data(
      [['row_id', 'item_name'], ['1']],
      undefined,
      'CREATE TABLE inventory (\n  "ROW_ID" INTEGER PRIMARY KEY,\n  "Item_Name" TEXT NOT NULL\n);',
    );

    const audit = auditTableDataForUpgrade_ACU(source);

    expect(audit.status).toBe('requires_confirmation');
    expect(audit.issues).toContainEqual(expect.objectContaining({
      code: 'upgrade_required_business_cell_missing', rowIndex: 1,
    }));
  });

  it('缺少 row_id 时接受 quoted 物理列名并插入身份列', () => {
    const source = data(
      [['item_name'], ['铁剑']],
      undefined,
      'CREATE TABLE inventory (\n  `ROW_ID` INTEGER PRIMARY KEY,\n  [Item_Name] TEXT\n);',
    );

    const result = repairTableDataFromAudit_ACU(auditTableDataForUpgrade_ACU(source));

    expect(result.status).toBe('repairable');
    expect((result.candidateData as any).sheet_0.content).toEqual([['row_id', 'item_name'], ['1', '铁剑']]);
  });

  it('重复中文注释导致 NOT NULL 列映射歧义时要求确认', () => {
    const source = data(
      [['row_id', '备注', '备注'], ['1', '甲']],
      undefined,
      'CREATE TABLE notes (\n  row_id INTEGER PRIMARY KEY,\n  first_note TEXT NOT NULL, -- 备注\n  second_note TEXT NOT NULL -- 备注\n);',
    );

    const audit = auditTableDataForUpgrade_ACU(source);

    expect(audit.status).toBe('requires_confirmation');
    expect(audit.issues).toContainEqual(expect.objectContaining({ code: 'upgrade_required_mapping_ambiguous' }));
  });

  it('检测 content 与 seedRows 的跨池 row_id 冲突并重映射 seedRows', () => {
    const source = data([['row_id', 'name'], ['1', '铁剑']], [['1', '预置盾牌']]);
    const result = repairTableDataFromAudit_ACU(auditTableDataForUpgrade_ACU(source));
    expect(result.status).toBe('repairable');
    expect((result.candidateData as any).sheet_0.seedRows[0][0]).toBe('2');
  });

  it('对同一输入生成确定性候选结果，且不减少行或非空业务单元格', () => {
    const source = data([['id', 'name'], ['1'], ['1', '盾牌', '保留']]);
    const first = repairTableDataFromAudit_ACU(auditTableDataForUpgrade_ACU(source));
    const second = repairTableDataFromAudit_ACU(auditTableDataForUpgrade_ACU(source));
    expect(first).toEqual(second);
    expect((first.candidateData as any).sheet_0.content).toHaveLength(source.sheet_0.content.length);
    expect(nonEmptyCells(first.candidateData)).toBeGreaterThanOrEqual(nonEmptyCells(source));
  });
});