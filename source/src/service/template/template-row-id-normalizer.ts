/**
 * service/template/template-row-id-normalizer.ts — 外部模板 row_id 结构规范化纯函数
 *
 * 职责：在外部模板进入系统（游戏初始化重置、聊天模板协调、模板预设导入）之前，
 * 把每张 Sheet 的表头与行结构规范化为 canonical 形态（首列 row_id）。
 *
 * 边界：本模块是纯函数，不读取聊天、不写存储、不触发 UI 或事务。
 * 不可无损证明的输入（错位 row_id、重复身份表头、非法行、DDL 歧义）返回 blocker，
 * 不做猜测性修复。
 */

import {
  canonicalizeDisplayName_ACU
} from '../../shared/sheet-identity';
import {
  allocateStableRowId_ACU,
  createStableRowIdReservation_ACU
} from '../../shared/stable-row-id-allocator';
import {
  injectRowIdPrimaryKeyColumn_ACU,
  parseDDLColumnInfos_ACU,
  validateDDLTextAgainstHeaders_ACU
} from '../../shared/ddl-utils';

// ═══ 公共类型 ═══

export type TemplateRowIdNormalizationIssueCode_ACU =
  | 'invalid_template'
  | 'invalid_sheet'
  | 'missing_content'
  | 'invalid_header'
  | 'empty_header'
  | 'misplaced_row_id'
  | 'duplicate_row_id_header'
  | 'invalid_content_row'
  | 'invalid_seed_rows'
  | 'invalid_seed_row'
  | 'row_width_mismatch'
  | 'duplicate_row_id'
  | 'invalid_ddl'
  | 'ambiguous_ddl';

export interface TemplateRowIdNormalizationIssue_ACU {
  code: TemplateRowIdNormalizationIssueCode_ACU;
  sheetKey: string;
  sheetName: string;
  message: string;
  rowIndex?: number;
  columnIndex?: number;
}

export interface TemplateRowIdNormalizationAudit_ACU {
  sheetKey: string;
  sheetName: string;
  headerAction: 'unchanged' | 'renamed' | 'inserted';
  contentRowsUpdated: number;
  seedRowsUpdated: number;
  generatedRowIdCount: number;
  ddlUpdated: boolean;
  /** 跨 content/seedRows 完全重复去重审计（仅 deduplicateIdenticalCrossSourceRows 开启时产生）。 */
  deduplicatedSeedRows: Array<{ rowId: string; contentRowIndex: number }>;
}

export interface TemplateRowIdNormalizationResult_ACU<T> {
  templateData: T;
  changed: boolean;
  audits: TemplateRowIdNormalizationAudit_ACU[];
  blockers: TemplateRowIdNormalizationIssue_ACU[];
}

export interface TemplateRowIdNormalizationOptions_ACU {
  /** SQLite 模式下同步 DDL；native 模式只处理 JSON 行结构。默认 false。 */
  syncDdl?: boolean;
  /** 为缺失/空 row_id 分配稳定身份。默认 true。 */
  assignStableRowIds?: boolean;
  /**
   * content 优先的消费者会丢弃同表 seedRows；此时不将两个来源的既有 ID 视为冲突。
   * 默认 true，防止会同时物化两个行池的入口提交重复身份。
   */
  rejectCrossSourceDuplicateRowIds?: boolean;
  /**
   * 跨来源完全重复去重：当 seedRows 行与 content 行的规范化 row_id 相同且完整行逐列相同
   * 时，从候选 seedRows 删除该重复副本（content 优先）。默认 false，避免影响聊天协调等
   * 对 seedRows 生命周期语义不同的调用方。
   *
   * 仅当行结构合法、行宽一致、row_id 非空且 canonical 相同、其余列逐列严格相同时才去重；
   * 同 row_id 但任一业务字段不同仍保留跨池冲突 blocker。去重只作用于深拷贝候选，不修改输入。
   */
  deduplicateIdenticalCrossSourceRows?: boolean;

  /** 已有 row_id 表头时是否预检 DDL。默认 true；协调器将在完整候选阶段校验。 */
  validateExistingDdl?: boolean;
}
type SheetLike = Record<string, any>;
type RecordValue = Record<string, any>;

function isRecordValue_ACU(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue_ACU<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function canonicalHeader_ACU(value: unknown): string {
  return canonicalizeDisplayName_ACU(value);
}

const ROW_ID_ALIASES_ACU = new Set(['id', 'rowid', 'row_id', '行号']);

function isRowIdHeader_ACU(value: unknown): boolean {
  return canonicalHeader_ACU(value) === 'row_id';
}

function isRowIdAliasHeader_ACU(value: unknown): boolean {
  return ROW_ID_ALIASES_ACU.has(canonicalHeader_ACU(value));
}

function sheetLabel_ACU(sheet: SheetLike | undefined, sheetKey: string): string {
  return `表「${String(sheet?.name ?? '') || sheetKey}」(${sheetKey})`;
}

function issue_ACU(
  code: TemplateRowIdNormalizationIssueCode_ACU,
  sheetKey: string,
  sheetName: string,
  message: string,
  rowIndex?: number,
  columnIndex?: number,
): TemplateRowIdNormalizationIssue_ACU {
  return { code, sheetKey, sheetName, message, rowIndex, columnIndex };
}

function blankAudit_ACU(sheetKey: string, sheetName: string): TemplateRowIdNormalizationAudit_ACU {
  return {
    sheetKey, sheetName,
    headerAction: 'unchanged',
    contentRowsUpdated: 0,
    seedRowsUpdated: 0,
    generatedRowIdCount: 0,
    ddlUpdated: false,
    deduplicatedSeedRows: [],
  };
}


/**
 * 在同一张表内共享 content 与 seedRows 的身份空间，避免两个行池各自分配出重复 ID。
 * 已经存在相同非空身份时保持原样，由后续 canonical 校验拒绝，不在规范化器里猜测重映射。
 * 传入 sharedReserved 时在既有保留区上继续分配，保证跨池不冲突。
 */
function normalizeRowIdsForRows_ACU(rows: unknown[], assignStableRowIds: boolean, audit: TemplateRowIdNormalizationAudit_ACU, sharedReserved?: Set<string>): void {
  if (!assignStableRowIds) return;
  const reserved = sharedReserved || createStableRowIdReservation_ACU(rows);
  for (const row of rows) {
    if (!Array.isArray(row) || row.length === 0) continue;
    const raw = row[0];
    const rowId = raw === null || raw === undefined ? '' : String(raw).trim();
    if (rowId) reserved.add(rowId);
  }
  for (const row of rows) {
    if (!Array.isArray(row) || row.length === 0) continue;
    const raw = row[0];
    const rowId = raw === null || raw === undefined ? '' : String(raw).trim();
    if (!rowId) {
      row[0] = allocateStableRowId_ACU(reserved);
      audit.generatedRowIdCount += 1;
    } else row[0] = rowId;
  }
}

/**
 * canonical 行比较：row_id 使用既有 trim 规则比较；其余列逐列严格相等（===），
 * 不做未经证明的业务字段 trim、大小写折叠或 null/空串互换；行宽不一致不判定相同。
 */
function canonicalRowsEqual_ACU(contentRow: unknown[], seedRow: unknown[]): boolean {
  if (contentRow.length !== seedRow.length) return false;
  for (let index = 0; index < contentRow.length; index += 1) {
    if (index === 0) {
      // row_id 列：按既有 trim 规则规范化比较（与 rejectDuplicateRowIds_ACU 一致）
      if (String(contentRow[0] ?? '').trim() !== String(seedRow[0] ?? '').trim()) return false;
      continue;
    }
    if (contentRow[index] !== seedRow[index]) return false;
  }
  return true;
}

/**
 * 跨来源完全重复去重（content 优先，仅处理深拷贝候选）：
 * 在跨池重复 blocker 生成之前，删除与 content 行完全相同（规范 row_id 相同 + 完整行逐列相同）
 * 的 seedRows 行。只修改候选 seedRows，不修改 content；输入对象由调用方深拷贝保证不受影响。
 *
 * 返回删除的行数；被删除行的 row_id 与对应 content 行索引记录进 audit.deduplicatedSeedRows。
 */
function deduplicateIdenticalCrossSourceSeedRows_ACU(
  contentRows: unknown[],
  seedRows: unknown[],
  sheetKey: string,
  sheetName: string,
  audit: TemplateRowIdNormalizationAudit_ACU,
  blockers: TemplateRowIdNormalizationIssue_ACU[],
): number {
  // 同池结构错误由既有校验先行阻断；此处假定行均为合法数组（调用方保证）。
  const contentById = new Map<string, { row: unknown[]; index: number }>();
  for (let index = 0; index < contentRows.length; index += 1) {
    const row = contentRows[index];
    if (!Array.isArray(row) || row.length === 0) continue;
    const rowId = String(row[0] ?? '').trim();
    if (!rowId) continue;
    // content 内部重复由 rejectDuplicateRowIds_ACU 处理；索引仅记录首个，不覆盖。
    if (!contentById.has(rowId)) contentById.set(rowId, { row, index });
  }

  const retained: unknown[] = [];
  let removed = 0;
  for (const seedRow of seedRows) {
    if (!Array.isArray(seedRow) || seedRow.length === 0) {
      retained.push(seedRow);
      continue;
    }
    const seedRowId = String(seedRow[0] ?? '').trim();
    const matched = seedRowId ? contentById.get(seedRowId) : undefined;
    if (matched && canonicalRowsEqual_ACU(matched.row, seedRow)) {
      removed += 1;
      audit.deduplicatedSeedRows.push({ rowId: seedRowId, contentRowIndex: matched.index });
      continue;
    }
    retained.push(seedRow);
  }
  if (removed > 0) {
    seedRows.length = 0;
    for (const row of retained) seedRows.push(row);
    audit.seedRowsUpdated += removed;
  }
  return removed;
}

function rejectDuplicateRowIds_ACU(
  rows: unknown[],
  source: 'content' | 'seedRows',
  sheetKey: string,
  sheetName: string,
  seen: Set<string>,
  blockers: TemplateRowIdNormalizationIssue_ACU[],
): void {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!Array.isArray(row)) continue;
    const rowId = String(row[0] ?? '').trim();
    if (!rowId) continue;
    if (seen.has(rowId)) {
      blockers.push(issue_ACU('duplicate_row_id', sheetKey, sheetName,
        `${sheetLabel_ACU({ name: sheetName }, sheetKey)} 的 ${source} 第 ${index + 1} 行 row_id「${rowId}」重复，不能安全重写身份。`, index + 1));
      continue;
    }
    seen.add(rowId);
  }
}

/**
 * 插入 row_id 列时，验证原业务行宽度并同步右移。
 * 行宽超过原表头时 fail-loud；不足时按仓库既有 canonical 契约补 null。
 */
function insertRowIdColumnForRows_ACU(
  rows: unknown[],
  businessWidth: number,
  sheetKey: string,
  sheetName: string,
  blockers: TemplateRowIdNormalizationIssue_ACU[],
  audit: TemplateRowIdNormalizationAudit_ACU,
): void {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!Array.isArray(row)) {
      blockers.push(issue_ACU('invalid_content_row', sheetKey, sheetName, `${sheetLabel_ACU({ name: sheetName } as any, sheetKey)} 第 ${index + 1} 行不是数组，无法自动插入 row_id。`, index + 1));
      continue;
    }
    if (row.length > businessWidth) {
      blockers.push(issue_ACU('row_width_mismatch', sheetKey, sheetName, `${sheetLabel_ACU({ name: sheetName } as any, sheetKey)} 第 ${index + 1} 行宽度为 ${row.length}，超过原表头 ${businessWidth} 列，无法安全插入 row_id。`, index + 1));
      continue;
    }
    while (row.length < businessWidth) row.push(null);
    row.unshift('');
    audit.contentRowsUpdated += 1;
  }
}

/**
 * 规范单张 Sheet 的 row_id 结构。
 */
function normalizeSheetRowId_ACU(
  sheetKey: string,
  sheet: SheetLike,
  options: TemplateRowIdNormalizationOptions_ACU,
  blockers: TemplateRowIdNormalizationIssue_ACU[],
  audits: TemplateRowIdNormalizationAudit_ACU[],
): void {
  const sheetName = String(sheet?.name ?? '');
  const label = sheetLabel_ACU(sheet, sheetKey);
  const audit = blankAudit_ACU(sheetKey, sheetName);

  if (!isRecordValue_ACU(sheet)) {
    blockers.push(issue_ACU('invalid_sheet', sheetKey, sheetName, `${label} 不是对象，无法规范化。`));
    return;
  }
  const content = sheet.content;
  if (!Array.isArray(content) || content.length === 0) {
    blockers.push(issue_ACU('missing_content', sheetKey, sheetName, `${label} 缺少 content 表头行。`));
    return;
  }
  const header = content[0];
  if (!Array.isArray(header)) {
    blockers.push(issue_ACU('invalid_header', sheetKey, sheetName, `${label} 表头不是数组。`));
    return;
  }
  if (header.length === 0) {
    blockers.push(issue_ACU('empty_header', sheetKey, sheetName, `${label} 表头为空。`));
    return;
  }

  // 可视化编辑器使用 content[0][0] === null/undefined 表示不可编辑的 row_id 占位，
  // 与 sql-identifier-mapper.ts 的首列 null/undefined row_id 身份契约一致（仅限首列）。
  const firstIsRowIdPlaceholder = header[0] === null || header[0] === undefined;
  // 占位本身就是身份列，不能进入“缺失身份列”的扫描/插入语义。
  const firstIsRowId = isRowIdHeader_ACU(header[0]);
  const firstIsAlias = !firstIsRowId && !firstIsRowIdPlaceholder && isRowIdAliasHeader_ACU(header[0]);
  let misplacedIndex = -1;
  let duplicateHeaderIndex = -1;
  if (!firstIsRowId && !firstIsAlias && !firstIsRowIdPlaceholder) {
    for (let index = 1; index < header.length; index += 1) {
      if (isRowIdHeader_ACU(header[index])) {
        misplacedIndex = index;
        break;
      }
      if (duplicateHeaderIndex < 0 && isRowIdAliasHeader_ACU(header[index])) {
        duplicateHeaderIndex = index;
      }
    }
  }
  if (misplacedIndex >= 0) {
    blockers.push(issue_ACU('misplaced_row_id', sheetKey, sheetName,
      `${label} 的 row_id 位于第 ${misplacedIndex + 1} 列；自动移动可能改变数据列语义，请手动调整模板列顺序。`,
      undefined, misplacedIndex));
    return;
  }
  if (duplicateHeaderIndex >= 0) {
    blockers.push(issue_ACU('duplicate_row_id_header', sheetKey, sheetName,
      `${label} 第 ${duplicateHeaderIndex + 1} 列也是身份列（id/rowid/行号）；不能自动决定哪一列保留，请手动调整模板列顺序。`,
      undefined, duplicateHeaderIndex));
    return;
  }

  const businessWidth = header.length;
  for (let index = 1; index < content.length; index += 1) {
    if (!Array.isArray(content[index])) {
      blockers.push(issue_ACU('invalid_content_row', sheetKey, sheetName, `${label} 第 ${index + 1} 行不是数组，无法自动修复。`, index + 1));
      return;
    }
  }
  const seedRows = sheet.seedRows;
  if (seedRows !== undefined && !Array.isArray(seedRows)) {
    blockers.push(issue_ACU('invalid_seed_rows', sheetKey, sheetName, `${label} 的 seedRows 不是数组。`));
    return;
  }
  if (Array.isArray(seedRows)) {
    for (let index = 0; index < seedRows.length; index += 1) {
      if (!Array.isArray(seedRows[index])) {
        blockers.push(issue_ACU('invalid_seed_row', sheetKey, sheetName, `${label} 的 seedRows 第 ${index + 1} 行不是数组。`, index + 1));
        return;
      }
    }
  }

  let changed = false;
  if (firstIsRowIdPlaceholder) {
    // 占位规范化：原地替换为文本 row_id，不增加列、不移动业务列、不改数据行。
    header[0] = 'row_id';
    audit.headerAction = 'renamed';
    changed = true;
  } else if (firstIsAlias) {
    header[0] = 'row_id';
    audit.headerAction = 'renamed';
    changed = true;
  } else if (!firstIsRowId) {
    header.unshift('row_id');
    audit.headerAction = 'inserted';
    changed = true;
    insertRowIdColumnForRows_ACU(content.slice(1), businessWidth, sheetKey, sheetName, blockers, audit);
    if (Array.isArray(seedRows)) {
      const seedAudit = blankAudit_ACU(sheetKey, sheetName);
      insertRowIdColumnForRows_ACU(seedRows, businessWidth, sheetKey, sheetName, blockers, seedAudit);
      audit.seedRowsUpdated = seedAudit.contentRowsUpdated;
    }
  }

  // content 与 seedRows 必须共享同一身份空间，避免两个行池各自从 1 分配出重复 ID。
  const sharedReserved = options.assignStableRowIds !== false
    ? createStableRowIdReservation_ACU([...content.slice(1), ...(Array.isArray(seedRows) ? seedRows : [])])
    : undefined;
  normalizeRowIdsForRows_ACU(content.slice(1), options.assignStableRowIds !== false, audit, sharedReserved);
  if (Array.isArray(seedRows)) {
    normalizeRowIdsForRows_ACU(seedRows, options.assignStableRowIds !== false, audit, sharedReserved);
  }
  // 跨来源完全重复去重（content 优先）：必须在跨池重复 blocker 生成之前完成。
  // 只处理深拷贝候选，删除与 content 完全相同的 seedRows 副本，更新审计。
  if (options.deduplicateIdenticalCrossSourceRows === true && Array.isArray(seedRows) && seedRows.length > 0) {
    deduplicateIdenticalCrossSourceSeedRows_ACU(
      content.slice(1), seedRows, sheetKey, sheetName, audit, blockers,
    );
  }
  const rowIds = new Set<string>();
  rejectDuplicateRowIds_ACU(content.slice(1), 'content', sheetKey, sheetName, rowIds, blockers);
  if (Array.isArray(seedRows)) {
    rejectDuplicateRowIds_ACU(
      seedRows, 'seedRows', sheetKey, sheetName,
      options.rejectCrossSourceDuplicateRowIds === false ? new Set<string>() : rowIds,
      blockers,
    );
  }

  if (options.syncDdl && sheet.sourceData && typeof sheet.sourceData === 'object') {
    const ddl = String(sheet.sourceData.ddl || '').trim();
    if (ddl) {
      const columns = parseDDLColumnInfos_ACU(ddl);
      const firstColumn = columns[0];
      if (audit.headerAction !== 'inserted') {
        if (options.validateExistingDdl === false) {
          audits.push(audit);
          return;
        }
        if (!firstColumn || firstColumn.sqlName.toLowerCase() !== 'row_id'
          || firstColumn.declaredType !== 'INTEGER' || !firstColumn.isPrimaryKey) {
          blockers.push(issue_ACU('invalid_ddl', sheetKey, sheetName,
            `${label} 的 DDL 缺少首列 row_id INTEGER PRIMARY KEY，无法安全规范化。`));
          return;
        }
      } else if (firstColumn && firstColumn.sqlName.toLowerCase() === 'row_id'
        && firstColumn.declaredType === 'INTEGER' && firstColumn.isPrimaryKey) {
        // 已有合法身份列，保持不变。
      } else if (firstColumn && firstColumn.sqlName.toLowerCase() !== 'row_id'
        && !columns.some(column => column.sqlName.toLowerCase() === 'row_id')) {
        if (columns.length === businessWidth) {
          try {
            sheet.sourceData.ddl = injectRowIdPrimaryKeyColumn_ACU(ddl);
            audit.ddlUpdated = true;
            changed = true;
          } catch (error) {
            blockers.push(issue_ACU('invalid_ddl', sheetKey, sheetName,
              `${label} 无法在 DDL 中注入 row_id：${error instanceof Error ? error.message : String(error)}`));
            return;
          }
        } else {
          blockers.push(issue_ACU('ambiguous_ddl', sheetKey, sheetName,
            `${label} 的 DDL 列数（${columns.length}）与原业务表头（${businessWidth}）不一致，无法证明应注入 row_id。`));
          return;
        }
      } else {
        blockers.push(issue_ACU('invalid_ddl', sheetKey, sheetName,
          `${label} 的 DDL 中 row_id 不是首列 INTEGER PRIMARY KEY，无法安全规范化。`));
        return;
      }
      const validation = validateDDLTextAgainstHeaders_ACU(String(sheet.sourceData.ddl || ''), content[0]);
      if (!validation.valid) {
        blockers.push(issue_ACU('ambiguous_ddl', sheetKey, sheetName, `${label} DDL 校验失败：${validation.message}`));
        return;
      }
    }
  }

  audits.push(audit);
}

/**
 * 对外入口：深拷贝输入并规范化所有 sheet_* 的 row_id 结构。
 * 输入对象不被修改；任何 blocker 都代表本次调用不产生可提交候选。
 */
export function normalizeTemplateRowIds_ACU<T>(
  templateData: T,
  options: TemplateRowIdNormalizationOptions_ACU = {},
): TemplateRowIdNormalizationResult_ACU<T> {
  const input = templateData as unknown;
  if (!isRecordValue_ACU(input)) {
    return { templateData, changed: false, audits: [], blockers: [issue_ACU('invalid_template', '', '', '模板必须是对象。')] };
  }
  const template = cloneValue_ACU(input) as RecordValue;
  const blockers: TemplateRowIdNormalizationIssue_ACU[] = [];
  const audits: TemplateRowIdNormalizationAudit_ACU[] = [];
  let changed = false;
  for (const [key, value] of Object.entries(template)) {
    if (!key.startsWith('sheet_')) continue;
    if (!isRecordValue_ACU(value)) {
      blockers.push(issue_ACU('invalid_sheet', key, String((value as any)?.name ?? ''), `表「${key}」不是对象，无法规范化。`));
      continue;
    }
    const before = JSON.stringify(value);
    normalizeSheetRowId_ACU(key, value, options, blockers, audits);
    if (JSON.stringify(value) !== before) changed = true;
  }
  return {
    templateData: template as T,
    changed: blockers.length === 0 && changed,
    audits: blockers.length > 0 ? [] : audits,
    blockers,
  };
}
