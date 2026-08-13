import { allocateStableRowId_ACU, createStableRowIdReservation_ACU } from '../../shared/stable-row-id-allocator';
import { getTableDataFingerprint_ACU, type UpgradeAuditResult_ACU } from './table-data-upgrade-audit';

export interface RepairOptions_ACU {
  allowUserConfirmation?: boolean;
}
export interface UpgradeIdRemap_ACU {
  sheetKey: string;
  rowPool: 'content' | 'seedRows';
  rowIndex: number;
  previousRowId: unknown;
  nextRowId: string;
}
export interface UpgradeOverflowCells_ACU {
  sheetKey: string;
  rowPool: 'content' | 'seedRows';
  rowIndex: number;
  cells: unknown[];
}
export interface RepairResult_ACU {
  status: UpgradeAuditResult_ACU['status'];
  candidateData: unknown;
  idRemap: UpgradeIdRemap_ACU[];
  overflowCells: UpgradeOverflowCells_ACU[];
  dataFingerprintAfter: string;
  requiresConfirmation: boolean;
}

type RecordValue = Record<string, unknown>;
function isRecord_ACU(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function cloneData_ACU(data: unknown): unknown {
  return JSON.parse(JSON.stringify(data));
}
function getRows_ACU(sheet: RecordValue, pool: 'content' | 'seedRows'): unknown[][] {
  const source = pool === 'content' ? sheet.content : sheet.seedRows;
  if (!Array.isArray(source)) return [];
  return pool === 'content' ? source.slice(1).filter(Array.isArray) : source.filter(Array.isArray);
}
function getRow_ACU(sheet: RecordValue, pool: 'content' | 'seedRows', rowIndex: number): unknown[] | null {
  const rows = pool === 'content' ? sheet.content : sheet.seedRows;
  return Array.isArray(rows) && Array.isArray(rows[rowIndex]) ? rows[rowIndex] as unknown[] : null;
}
function repairSheet_ACU(sheet: RecordValue, sheetKey: string, audit: UpgradeAuditResult_ACU, remaps: UpgradeIdRemap_ACU[], overflows: UpgradeOverflowCells_ACU[]): void {
  const plans = audit.repairPlan.filter(plan => plan.sheetKey === sheetKey);
  const content = Array.isArray(sheet.content) ? sheet.content : [];
  for (const plan of plans) {
    if (plan.action === 'rename_header' && Array.isArray(content[0])) content[0][0] = 'row_id';
    if (plan.action === 'insert_row_id_column' && Array.isArray(content[0])) {
      content[0].unshift('row_id');
      content.slice(1).filter(Array.isArray).forEach(row => row.unshift(null));
      if (Array.isArray(sheet.seedRows)) sheet.seedRows.filter(Array.isArray).forEach(row => row.unshift(null));
    }
  }
  const allRows = [...getRows_ACU(sheet, 'content'), ...getRows_ACU(sheet, 'seedRows')];
  const reserved = createStableRowIdReservation_ACU(allRows);
  for (const plan of plans) {
    if (plan.action !== 'normalize_row_id' || plan.rowIndex === undefined || !plan.rowPool) continue;
    const row = getRow_ACU(sheet, plan.rowPool, plan.rowIndex);
    if (row && row[0] !== null && row[0] !== undefined) row[0] = String(row[0]).trim();
  }
  for (const plan of plans) {
    if (plan.action !== 'assign_row_id' || plan.rowIndex === undefined || !plan.rowPool) continue;
    const row = getRow_ACU(sheet, plan.rowPool, plan.rowIndex);
    if (!row) continue;
    const previousRowId = row[0];
    const nextRowId = allocateStableRowId_ACU(reserved);
    row[0] = nextRowId;
    remaps.push({ sheetKey, rowPool: plan.rowPool, rowIndex: plan.rowIndex, previousRowId, nextRowId });
  }
  const headerLength = Array.isArray(content[0]) ? content[0].length : 0;
  for (const plan of plans) {
    if (plan.rowIndex === undefined || !plan.rowPool) continue;
    const row = getRow_ACU(sheet, plan.rowPool, plan.rowIndex);
    if (!row) continue;
    if (plan.action === 'pad_row') while (row.length < headerLength) row.push(null);
    if (plan.action === 'preserve_overflow' && row.length > headerLength) {
      overflows.push({ sheetKey, rowPool: plan.rowPool, rowIndex: plan.rowIndex, cells: row.slice(headerLength) });
    }
  }
}

export function repairTableDataFromAudit_ACU(audit: UpgradeAuditResult_ACU, _options: RepairOptions_ACU = {}): RepairResult_ACU {
  const candidateData = cloneData_ACU(audit.sourceData);
  const idRemap: UpgradeIdRemap_ACU[] = [];
  const overflowCells: UpgradeOverflowCells_ACU[] = [];
  if (isRecord_ACU(candidateData) && audit.status !== 'unrecoverable') {
    Object.entries(candidateData).forEach(([sheetKey, sheet]) => {
      if (!sheetKey.startsWith('sheet_') || !isRecord_ACU(sheet)) return;
      repairSheet_ACU(sheet, sheetKey, audit, idRemap, overflowCells);
    });
  }
  return {
    status: audit.status,
    candidateData,
    idRemap,
    overflowCells,
    dataFingerprintAfter: getTableDataFingerprint_ACU(candidateData),
    requiresConfirmation: audit.status === 'requires_confirmation',
  };
}
