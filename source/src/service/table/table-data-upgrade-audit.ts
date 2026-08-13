import { parseDDLColumnInfos_ACU } from '../../shared/ddl-utils';

export type UpgradeAuditStatus_ACU = 'clean' | 'repairable' | 'requires_confirmation' | 'unrecoverable';
export type UpgradeAuditIssueCode_ACU =
  | 'upgrade_invalid_data'
  | 'upgrade_missing_sheet'
  | 'upgrade_invalid_header'
  | 'upgrade_empty_row_id'
  | 'upgrade_duplicate_row_id'
  | 'upgrade_invalid_row_shape'
  | 'upgrade_row_width_mismatch'
  | 'upgrade_required_mapping_ambiguous'
  | 'upgrade_required_business_cell_missing'
  | 'upgrade_overflow_cells'
  | 'upgrade_seed_pool_conflict';
export type UpgradeRepairAction_ACU = 'rename_header' | 'insert_row_id_column' | 'normalize_row_id' | 'assign_row_id' | 'pad_row' | 'preserve_overflow';

export interface UpgradeAuditIssue_ACU {
  code: UpgradeAuditIssueCode_ACU;
  sheetKey?: string;
  rowIndex?: number;
  rowPool?: 'content' | 'seedRows';
  rowId?: string;
  message: string;
}
export interface UpgradeRepairPlanItem_ACU {
  action: UpgradeRepairAction_ACU;
  sheetKey: string;
  rowIndex?: number;
  rowPool?: 'content' | 'seedRows';
  targetHeader?: string;
}
export interface UpgradeAuditResult_ACU {
  status: UpgradeAuditStatus_ACU;
  issues: UpgradeAuditIssue_ACU[];
  repairPlan: UpgradeRepairPlanItem_ACU[];
  dataFingerprintBefore: string;
  sourceData: unknown;
}

type RecordValue = Record<string, unknown>;
function isRecord_ACU(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fingerprint_ACU(value: unknown): string {
  const text = JSON.stringify(value, (_key, item) => {
    if (!isRecord_ACU(item)) return item;
    return Object.keys(item).sort().reduce<RecordValue>((out, key) => { out[key] = item[key]; return out; }, {});
  });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function canonicalId_ACU(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const id = String(value).trim();
  return id || null;
}
function addIssue_ACU(result: UpgradeAuditResult_ACU, issue: UpgradeAuditIssue_ACU, plan?: UpgradeRepairPlanItem_ACU): void {
  result.issues.push(issue);
  if (plan) result.repairPlan.push(plan);
}
function canonicalPhysicalName_ACU(value: unknown): string {
  const normalized = String(value ?? '').trim();
  if ((normalized.startsWith('"') && normalized.endsWith('"'))
    || (normalized.startsWith('`') && normalized.endsWith('`'))
    || (normalized.startsWith('[') && normalized.endsWith(']'))) {
    return normalized.slice(1, -1).trim().toLowerCase();
  }
  return normalized.toLowerCase();
}
function headerMatchesColumn_ACU(headerValue: unknown, sqlName: string, comment: string | null): boolean {
  const value = String(headerValue ?? '').trim();
  return !!value && (canonicalPhysicalName_ACU(value) === canonicalPhysicalName_ACU(sqlName) || (!!comment && value === comment));
}
function resolveRequiredHeaderIndexes_ACU(result: UpgradeAuditResult_ACU, sheetKey: string, sheet: RecordValue, header: unknown[], omitLeadingRowId = false): Map<number, string> {
  const ddl = isRecord_ACU(sheet.sourceData) && typeof sheet.sourceData.ddl === 'string' ? sheet.sourceData.ddl : '';
  if (!ddl) return new Map();
  const ddlColumns = parseDDLColumnInfos_ACU(ddl).slice(omitLeadingRowId ? 1 : 0);
  const required = new Map<number, string>();
  const assignRequiredIndex = (headerIndex: number, sqlName: string) => {
    const canonicalName = canonicalPhysicalName_ACU(sqlName);
    const existing = required.get(headerIndex);
    if (existing && existing !== canonicalName) {
      addIssue_ACU(result, {
        code: 'upgrade_required_mapping_ambiguous', sheetKey, rowIndex: 0,
        message: `表头第 ${headerIndex + 1} 列同时映射到 NOT NULL 业务列「${existing}」与「${canonicalName}」，无法安全确定列位置`,
      });
      return;
    }
    required.set(headerIndex, canonicalName);
  };
  // 按索引映射只有在每个表头都只命中对应 DDL 列时才算“可证明”；重复中文注释不能靠顺序猜。
  const positionalMappingIsProven = ddlColumns.length === header.length
    && ddlColumns.every((column, index) => {
      if (!headerMatchesColumn_ACU(header[index], column.sqlName, column.comment)) return false;
      const matchedDdlColumns = ddlColumns.filter(candidate => headerMatchesColumn_ACU(header[index], candidate.sqlName, candidate.comment));
      return matchedDdlColumns.length === 1;
    });
  for (const column of ddlColumns) {
    // row_id 的空值、重复与跨池冲突由专用身份审计负责，不能再伪装成业务列缺失。
    if (canonicalPhysicalName_ACU(column.sqlName) === 'row_id') continue;
    if (!column.isNotNull || column.hasDefault || column.isPrimaryKey) continue;
    if (positionalMappingIsProven) {
      assignRequiredIndex(column.index - (omitLeadingRowId ? 1 : 0), column.sqlName);
      continue;
    }
    const physicalMatches = header
      .map((value, index) => ({ value: canonicalPhysicalName_ACU(value), index }))
      .filter(item => item.value === canonicalPhysicalName_ACU(column.sqlName));
    const commentMatches = column.comment
      ? header.map((value, index) => ({ value: String(value ?? '').trim(), index })).filter(item => item.value === column.comment)
      : [];
    const matches = physicalMatches.length > 0 ? physicalMatches : commentMatches;
    if (matches.length === 1) {
      assignRequiredIndex(matches[0].index, column.sqlName);
      continue;
    }
    addIssue_ACU(result, {
      code: 'upgrade_required_mapping_ambiguous',
      sheetKey,
      rowIndex: 0,
      message: matches.length > 1
        ? `NOT NULL 业务列「${canonicalPhysicalName_ACU(column.sqlName)}」匹配到多个表头，无法安全确定列位置`
        : `NOT NULL 业务列「${canonicalPhysicalName_ACU(column.sqlName)}」无法映射到表头，不能跳过必填审计`,
    });
  }
  return required;
}
function inspectRows_ACU(result: UpgradeAuditResult_ACU, sheetKey: string, rows: unknown[], pool: 'content' | 'seedRows', headerLength: number, ids: Map<string, { pool: 'content' | 'seedRows'; rowIndex: number }>, requiredHeaderIndexes: Map<number, string>): void {
  rows.forEach((row, offset) => {
    const rowIndex = pool === 'content' ? offset + 1 : offset;
    if (!Array.isArray(row)) {
      addIssue_ACU(result, { code: 'upgrade_invalid_row_shape', sheetKey, rowIndex, rowPool: pool, message: '行不是数组，无法无损自动修复' });
      return;
    }
    const rowId = canonicalId_ACU(row[0]);
    if (!rowId) addIssue_ACU(result, { code: 'upgrade_empty_row_id', sheetKey, rowIndex, rowPool: pool, message: '行缺少稳定 row_id' }, { action: 'assign_row_id', sheetKey, rowIndex, rowPool: pool });
    else {
      if (row[0] !== rowId) result.repairPlan.push({ action: 'normalize_row_id', sheetKey, rowIndex, rowPool: pool });
      const existing = ids.get(rowId);
      if (existing) {
        const code = existing.pool === pool ? 'upgrade_duplicate_row_id' : 'upgrade_seed_pool_conflict';
        const message = existing.pool === pool
          ? 'row_id 在同一行集中重复'
          : 'row_id 同时存在于 content 与 seedRows 中';
        addIssue_ACU(result, { code, sheetKey, rowIndex, rowPool: pool, rowId, message }, { action: 'assign_row_id', sheetKey, rowIndex, rowPool: pool });
      } else ids.set(rowId, { pool, rowIndex });
    }
    if (row.length < headerLength) {
      addIssue_ACU(result, { code: 'upgrade_row_width_mismatch', sheetKey, rowIndex, rowPool: pool, rowId: rowId || undefined, message: '行短于表头，可尾部补 null' }, { action: 'pad_row', sheetKey, rowIndex, rowPool: pool });
    }
    for (const [headerIndex, sqlName] of requiredHeaderIndexes) {
      if (headerIndex < row.length && row[headerIndex] !== null && row[headerIndex] !== undefined) continue;
      addIssue_ACU(result, {
        code: 'upgrade_required_business_cell_missing', sheetKey, rowIndex, rowPool: pool,
        rowId: rowId || undefined,
        message: `缺少 NOT NULL 且无默认值的业务列「${sqlName}」，不能猜测填充值`,
      });
    }
    if (row.length > headerLength) addIssue_ACU(result, { code: 'upgrade_overflow_cells', sheetKey, rowIndex, rowPool: pool, rowId: rowId || undefined, message: '行超出表头，必须保留原值并等待确认' }, { action: 'preserve_overflow', sheetKey, rowIndex, rowPool: pool });
  });
}
function inspectRowsWithoutIds_ACU(result: UpgradeAuditResult_ACU, sheetKey: string, rows: unknown[], pool: 'content' | 'seedRows', expectedWidth: number, requiredHeaderIndexes: Map<number, string>): void {
  rows.forEach((row, offset) => {
    const rowIndex = pool === 'content' ? offset + 1 : offset;
    if (!Array.isArray(row)) {
      addIssue_ACU(result, { code: 'upgrade_invalid_row_shape', sheetKey, rowIndex, rowPool: pool, message: '行不是数组，无法无损自动修复' });
    } else if (row.length < expectedWidth) {
      addIssue_ACU(result, { code: 'upgrade_row_width_mismatch', sheetKey, rowIndex, rowPool: pool, message: '行短于业务表头，可尾部补 null' }, { action: 'pad_row', sheetKey, rowIndex, rowPool: pool });
    } else if (row.length > expectedWidth) {
      addIssue_ACU(result, { code: 'upgrade_overflow_cells', sheetKey, rowIndex, rowPool: pool, message: '行超出业务表头，必须保留原值并等待确认' }, { action: 'preserve_overflow', sheetKey, rowIndex, rowPool: pool });
    }
    if (!Array.isArray(row)) return;
    for (const [headerIndex, sqlName] of requiredHeaderIndexes) {
      if (headerIndex < row.length && row[headerIndex] !== null && row[headerIndex] !== undefined) continue;
      addIssue_ACU(result, {
        code: 'upgrade_required_business_cell_missing', sheetKey, rowIndex, rowPool: pool,
        message: `缺少 NOT NULL 且无默认值的业务列「${sqlName}」，不能猜测填充值`,
      });
    }
  });
}


function headerOnlyRowIdNormalizationAction_ACU(sheet: RecordValue): 'rename' | 'insert' | null {
  const content = sheet.content;
  if (!Array.isArray(content) || content.length !== 1 || !Array.isArray(content[0]) || content[0].length === 0) return null;
  // A business-only header is unambiguous only when no row exists in either pool.
  // Do not treat malformed seedRows as empty: that would silently shift data later.
  if (sheet.seedRows !== undefined && (!Array.isArray(sheet.seedRows) || sheet.seedRows.length > 0)) return null;
  const header = content[0];
  const firstHeader = String(header[0] ?? '').trim();
  if (canonicalPhysicalName_ACU(firstHeader) === 'row_id') return null;
  // A misplaced identity column is not an empty-template shortcut. Inserting
  // another row_id would conceal a malformed schema and create duplicate names.
  if (header.slice(1).some(value => canonicalPhysicalName_ACU(value) === 'row_id')) return null;
  return !firstHeader || /^(id|rowid|row_id)$/i.test(firstHeader) || firstHeader === '行号'
    ? 'rename'
    : 'insert';
}

/**
 * Pure, lossless normalization for an externally supplied header-only template.
 * It deliberately does not touch populated tables or malformed seed pools.
 */
export function normalizeHeaderOnlyRowIdColumns_ACU<T>(data: T): T {
  if (!isRecord_ACU(data)) return data;
  let normalized: RecordValue | null = null;
  for (const [sheetKey, sheet] of Object.entries(data)) {
    if (!sheetKey.startsWith('sheet_') || !isRecord_ACU(sheet)) continue;
    const action = headerOnlyRowIdNormalizationAction_ACU(sheet);
    if (!action) continue;
    const content = sheet.content as unknown[][];
    const header = content[0];
    const nextHeader = action === 'rename' ? ['row_id', ...header.slice(1)] : ['row_id', ...header];
    if (!normalized) normalized = { ...data };
    normalized[sheetKey] = { ...sheet, content: [nextHeader] };
  }
  return (normalized || data) as T;
}

function determineHeaderRepair_ACU(result: UpgradeAuditResult_ACU, sheetKey: string, sheet: RecordValue): { header: unknown[]; insertsRowId: boolean } | null {
  const content = sheet.content;
  if (!Array.isArray(content) || !Array.isArray(content[0]) || content[0].length === 0) {
    addIssue_ACU(result, { code: 'upgrade_invalid_header', sheetKey, rowIndex: 0, message: '缺少可识别表头，无法安全推导 row_id 位置' });
    return null;
  }
  const header = content[0];
  const firstHeader = String(header[0] ?? '').trim();
  if (canonicalPhysicalName_ACU(firstHeader) === 'row_id') return { header, insertsRowId: false };
  if (!firstHeader || /^(id|rowid|row_id)$/i.test(firstHeader) || firstHeader === '行号') {
    addIssue_ACU(result, { code: 'upgrade_invalid_header', sheetKey, rowIndex: 0, message: '身份列表头可确定地规范化为 row_id' }, { action: 'rename_header', sheetKey, rowIndex: 0, targetHeader: 'row_id' });
    return { header: ['row_id', ...header.slice(1)], insertsRowId: false };
  }
  if (headerOnlyRowIdNormalizationAction_ACU(sheet) === 'insert') {
    addIssue_ACU(result, { code: 'upgrade_invalid_header', sheetKey, rowIndex: 0, message: '无数据模板缺少 row_id，可在首列插入' }, { action: 'insert_row_id_column', sheetKey, rowIndex: 0, targetHeader: 'row_id' });
    return { header: ['row_id', ...header], insertsRowId: true };
  }
  const ddl = isRecord_ACU(sheet.sourceData) ? sheet.sourceData.ddl : undefined;
  const ddlText = typeof ddl === 'string' ? ddl : '';
  const ddlColumns = ddlText ? parseDDLColumnInfos_ACU(ddlText) : [];
  // 只有 DDL 明确多出首列 row_id，且其余列按顺序与业务表头对应，才允许自动插入身份列。
  const ddlHasLeadingRowId = canonicalPhysicalName_ACU(ddlColumns[0]?.sqlName) === 'row_id' && ddlColumns.length === header.length + 1;
  const headerMatchesDdlWithoutRowId = ddlHasLeadingRowId && header.every((value, index) => {
    const ddlColumn = ddlColumns[index + 1];
    return !!ddlColumn && headerMatchesColumn_ACU(value, ddlColumn.sqlName, ddlColumn.comment);
  });
  if (headerMatchesDdlWithoutRowId) {
    addIssue_ACU(result, { code: 'upgrade_invalid_header', sheetKey, rowIndex: 0, message: 'DDL 证明当前业务表头缺少 row_id 列，可在首列插入' }, { action: 'insert_row_id_column', sheetKey, rowIndex: 0, targetHeader: 'row_id' });
    return { header: ['row_id', ...header], insertsRowId: true };
  }
  addIssue_ACU(result, { code: 'upgrade_invalid_header', sheetKey, rowIndex: 0, message: '无法依据 DDL 安全判定应改名还是插入 row_id' });
  return null;
}

export function getTableDataFingerprint_ACU(data: unknown): string {
  return fingerprint_ACU(data);
}

export function auditTableDataForUpgrade_ACU(data: unknown): UpgradeAuditResult_ACU {
  const result: UpgradeAuditResult_ACU = { status: 'clean', issues: [], repairPlan: [], dataFingerprintBefore: fingerprint_ACU(data), sourceData: data };
  if (!isRecord_ACU(data)) {
    addIssue_ACU(result, { code: 'upgrade_invalid_data', message: '表格数据不是对象' });
    result.status = 'unrecoverable';
    return result;
  }
  const sheets = Object.entries(data).filter(([key]) => key.startsWith('sheet_'));
  if (sheets.length === 0) {
    addIssue_ACU(result, { code: 'upgrade_missing_sheet', message: '表格数据不含 sheet_*' });
    result.status = 'unrecoverable';
    return result;
  }
  for (const [sheetKey, rawSheet] of sheets) {
    if (!isRecord_ACU(rawSheet)) {
      addIssue_ACU(result, { code: 'upgrade_invalid_data', sheetKey, message: 'sheet 不是对象' });
      continue;
    }
    const headerState = determineHeaderRepair_ACU(result, sheetKey, rawSheet);
    if (!headerState) continue;
    const content = Array.isArray(rawSheet.content) ? rawSheet.content : [];
    const seedRows = Array.isArray(rawSheet.seedRows) ? rawSheet.seedRows : [];
    const ids = new Map<string, { pool: 'content' | 'seedRows'; rowIndex: number }>();
    if (headerState.insertsRowId) {
      // 此时行内尚无 row_id；宽度与 NOT NULL 业务列必须按原业务表头独立审计。
      const expectedBusinessWidth = headerState.header.length - 1;
      const requiredHeaderIndexes = resolveRequiredHeaderIndexes_ACU(result, sheetKey, rawSheet, headerState.header.slice(1), true);
      inspectRowsWithoutIds_ACU(result, sheetKey, content.slice(1), 'content', expectedBusinessWidth, requiredHeaderIndexes);
      inspectRowsWithoutIds_ACU(result, sheetKey, seedRows, 'seedRows', expectedBusinessWidth, requiredHeaderIndexes);
      content.slice(1).forEach((_row, offset) => result.repairPlan.push({ action: 'assign_row_id', sheetKey, rowIndex: offset + 1, rowPool: 'content' }));
      seedRows.forEach((_row, offset) => result.repairPlan.push({ action: 'assign_row_id', sheetKey, rowIndex: offset, rowPool: 'seedRows' }));
      continue;
    }
    const requiredHeaderIndexes = resolveRequiredHeaderIndexes_ACU(result, sheetKey, rawSheet, headerState.header);
    inspectRows_ACU(result, sheetKey, content.slice(1), 'content', headerState.header.length, ids, requiredHeaderIndexes);
    inspectRows_ACU(result, sheetKey, seedRows, 'seedRows', headerState.header.length, ids, requiredHeaderIndexes);
  }
  if (result.issues.some(issue => issue.code === 'upgrade_invalid_data' || issue.code === 'upgrade_missing_sheet')) result.status = 'unrecoverable';
  else if (result.issues.some(issue => issue.code === 'upgrade_invalid_row_shape' || issue.code === 'upgrade_invalid_header' && !result.repairPlan.some(plan => plan.sheetKey === issue.sheetKey && (plan.action === 'rename_header' || plan.action === 'insert_row_id_column')) || issue.code === 'upgrade_overflow_cells' || issue.code === 'upgrade_required_mapping_ambiguous' || issue.code === 'upgrade_required_business_cell_missing')) result.status = 'requires_confirmation';
  else if (result.issues.length > 0) result.status = 'repairable';
  return result;
}
