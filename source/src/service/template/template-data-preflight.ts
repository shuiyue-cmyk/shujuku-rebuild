/**
 * service/template/template-data-preflight.ts — 模板数据导入预检纯函数
 *
 * 计划阶段 B 的产物：在模板进入任何持久化/提交链之前，统一完成
 * 数据行归一化、row_id 唯一性、业务 UNIQUE 键提取、每表导入审计与 merge 显式计划。
 *
 * 边界：本模块是纯函数，不读取聊天、不写存储、不触发 UI 或事务。
 * 预检失败即返回 blockers，调用方不得继续提交。
 */

import type { TableDataObject_ACU } from '../../shared/models/table-data';
import {
  normalizeTemplateConflictPolicy_ACU,
  type TemplateDataMode_ACU,
  type TemplateMergeConflictPolicy_ACU,
  type TemplateSheetImportAudit_ACU,
  type TemplateRowIdentity_ACU,
} from '../../shared/template-data-mode';
import { normalizeTemplateRowIds_ACU } from './template-row-id-normalizer';
import { parseDDLColumnInfos_ACU, parseDDLTableConstraints_ACU } from '../../shared/ddl-utils';

function canonicalRowId_ACU(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * 规范化 SQL 标识符用于列名对齐：剥离引号（"x" / `x` / [x]）并转小写。
 * 与 ddl-utils 的 canonicalSqlIdentifier_ACU 语义一致；SQLite 标识符大小写不敏感。
 */
function canonicalizeColumnName_ACU(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === '`' && last === '`') || (first === '[' && last === ']')) {
      return raw.slice(1, -1).toLowerCase();
    }
  }
  return raw.toLowerCase();
}

// ═══ 公共类型 ═══

export interface TemplatePreflightBlocker_ACU {
  code: 'missing_business_key' | 'merge_conflict_rejected' | 'invalid_row' | 'cross_pool_row_id_collision' | 'invalid_template';
  sheetKey: string;
  sheetName: string;
  message: string;
}

/** merge 模式单表显式计划：匹配行/插入行/保留行/冲突行全部可审计 */
export interface TemplateSheetMergePlan_ACU {
  sheetKey: string;
  businessKeyColumns: string[];
  matchedRowIds: string[];
  insertRowIds: string[];
  conflictRowIds: string[];
  rejectedRowIds: string[];
  /** conflictPolicy=template-wins 时，用模板行覆盖既有行的 row_id 列表 */
  overrideRowIds: string[];
}

export interface TemplateDataPreflightOptions_ACU {
  templateData: TableDataObject_ACU;
  runtimeData?: TableDataObject_ACU | null;
  dataMode: TemplateDataMode_ACU;
  conflictPolicy?: TemplateMergeConflictPolicy_ACU;
}

export interface TemplateDataPreflightResult_ACU {
  ok: boolean;
  blockers: TemplatePreflightBlocker_ACU[];
  audits: TemplateSheetImportAudit_ACU[];
  mergePlan?: Record<string, TemplateSheetMergePlan_ACU>;
}

// ═══ 内部工具 ═══

type SheetLike = Record<string, any>;

function collectTemplateDataRows_ACU(sheet: SheetLike | undefined): string[][] {
  if (!sheet || typeof sheet !== 'object') return [];
  const rows: string[][] = [];
  const content = sheet.content;
  if (Array.isArray(content) && content.length > 1) {
    for (const row of content.slice(1)) {
      if (Array.isArray(row)) rows.push(row.map(cell => (cell === null || cell === undefined ? '' : String(cell))));
    }
  }
  const seedRows = sheet.seedRows;
  if (Array.isArray(seedRows)) {
    for (const row of seedRows) {
      if (Array.isArray(row)) rows.push(row.map(cell => (cell === null || cell === undefined ? '' : String(cell))));
    }
  }
  return rows;
}

/**
 * 从 DDL 提取可证明业务身份的唯一键组（列级 UNIQUE / 表级 UNIQUE(...)）。
 * row_id 本身是系统身份，不参与业务匹配。返回空数组表示无法证明业务身份。
 */
export function extractBusinessKeyColumns_ACU(ddl: string): string[][] {
  const normalizedDdl = String(ddl || '').trim();
  if (!normalizedDdl) return [];
  const groups: string[][] = [];
  for (const column of parseDDLColumnInfos_ACU(normalizedDdl)) {
    const sqlName = canonicalizeColumnName_ACU(column.sqlName);
    if (sqlName === 'row_id') continue;
    if (/\bUNIQUE\b/i.test(column.normalizedDefinition)) {
      groups.push([sqlName]);
    }
  }
  for (const constraint of parseDDLTableConstraints_ACU(normalizedDdl)) {
    const match = constraint.match(/^UNIQUE\s*\(\s*([^)]+)\s*\)$/i);
    if (!match) continue;
    const columns = match[1].split(',').map(item => canonicalizeColumnName_ACU(item)).filter(Boolean);
    if (columns.includes('row_id')) continue; // row_id 是系统身份，含它的组不能作为业务键（fail-closed）
    if (columns.length > 0) groups.push(columns);
  }
  return groups;
}

function buildHeaderIndexMap_ACU(header: string[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((cell, index) => {
    const key = canonicalizeColumnName_ACU(cell);
    if (key && !map.has(key)) map.set(key, index);
  });
  return map;
}

function blocker_ACU(code: TemplatePreflightBlocker_ACU['code'], sheetKey: string, sheetName: string, message: string): TemplatePreflightBlocker_ACU {
  return { code, sheetKey, sheetName, message };
}

function blankAudit_ACU(sheetKey: string, sheetName: string): TemplateSheetImportAudit_ACU {
  return {
    sheetKey, sheetName,
    action: 'no-data',
    templateRowCount: 0,
    runtimeRowCount: 0,
    insertedRowCount: 0,
    keptRowCount: 0,
    conflictRowCount: 0,
    conflicts: [],
    rowIdentities: [],
  };
}

/**
 * 对模板数据导入做提交前预检，并生成每表审计。
 *
 * - replace：模板数据行直接作为初始快照，审计 action=replaced。
 * - seed：模板数据只进入 seedRows，审计 action=seed-only。
 * - merge：必须能从 DDL 提取唯一业务键；否则 blocker（fail-closed）。
 * - 无数据模板：任何模式都不凭空造行，审计 action=no-data。
 * - content 与 seedRows 跨池 row_id 冲突由 normalizeTemplateRowIds_ACU 拒绝。
 */
export function preflightTemplateDataImport_ACU(options: TemplateDataPreflightOptions_ACU): TemplateDataPreflightResult_ACU {
  const { templateData, dataMode, conflictPolicy } = options;
  const policy = normalizeTemplateConflictPolicy_ACU(conflictPolicy);
  const blockers: TemplatePreflightBlocker_ACU[] = [];
  const audits: TemplateSheetImportAudit_ACU[] = [];
  const mergePlan: Record<string, TemplateSheetMergePlan_ACU> = {};

  if (!templateData || typeof templateData !== 'object' || Array.isArray(templateData)) {
    return { ok: false, blockers: [blocker_ACU('invalid_template', '', '', '模板必须是对象。')], audits: [] };
  }

  const normalization = normalizeTemplateRowIds_ACU(templateData, {
    syncDdl: false,
    assignStableRowIds: true,
    rejectCrossSourceDuplicateRowIds: true,
    // 模板导入候选允许跨池完全重复安全去重（content 优先），真实冲突仍 blocker。
    deduplicateIdenticalCrossSourceRows: true,
    validateExistingDdl: false,
  });
  if (normalization.blockers.length > 0) {
    const normalizationBlockerCode_ACU = (issue: { code: string }): TemplatePreflightBlocker_ACU['code'] => {
      // row_id 身份空间冲突（池内重复 / 跨池重复）→ 身份冲突 blocker；
      // 其余结构性问题（行宽、DDL 歧义、缺 content 等）→ invalid_row，不冒充身份冲突。
      return issue.code === 'duplicate_row_id' || issue.code === 'duplicate_row_id_header'
        ? 'cross_pool_row_id_collision'
        : 'invalid_row';
    };
    return {
      ok: false,
      blockers: normalization.blockers.map(issue => blocker_ACU(normalizationBlockerCode_ACU(issue), issue.sheetKey, issue.sheetName, issue.message)),
      audits: [],
    };
  }
  const normalized = normalization.templateData as TableDataObject_ACU;
  const sheetKeys = Object.keys(normalized).filter(key => key.startsWith('sheet_'));
  if (sheetKeys.length === 0) return { ok: true, blockers: [], audits: [] };

  const runtimeSheets = (options.runtimeData && typeof options.runtimeData === 'object' ? options.runtimeData : {}) as Record<string, SheetLike>;

  for (const sheetKey of sheetKeys) {
    const sheet = normalized[sheetKey] as SheetLike | undefined;
    const sheetName = String(sheet?.name ?? '');
    const audit = blankAudit_ACU(sheetKey, sheetName);
    // 透传 normalizer 的跨池完全重复去重审计（content 优先），供调用方追踪与展示。
    const normalizationAudit = normalization.audits.find(item => item.sheetKey === sheetKey);
    if (normalizationAudit && normalizationAudit.deduplicatedSeedRows.length > 0) {
      audit.deduplicatedSeedRows = normalizationAudit.deduplicatedSeedRows;
    }
    const templateRows = collectTemplateDataRows_ACU(sheet);
    audit.templateRowCount = templateRows.length;

    const runtimeSheet = runtimeSheets[sheetKey];
    const runtimeRows = collectTemplateDataRows_ACU(runtimeSheet);
    audit.runtimeRowCount = runtimeRows.length;

    if (templateRows.length === 0) {
      audit.action = 'no-data';
      audits.push(audit);
      continue;
    }

    const headerRow = Array.isArray(sheet?.content?.[0]) ? sheet.content[0].map(String) : ['row_id'];
    const headerIndexBySql = buildHeaderIndexMap_ACU(headerRow);
    const ddl = String(sheet?.sourceData?.ddl ?? '');
    // normalizer 仅在需要插入 row_id 列时校验行宽；首列已是 row_id 时不校验。
    // preflight 兜底：模板数据行宽度不得超过表头宽度，超宽即数据列错位，fail-closed。
    const headerWidth = headerRow.length;
    const oversizedRows = templateRows.filter(row => row.length > headerWidth);
    if (oversizedRows.length > 0) {
      audit.action = 'blocked';
      audit.blocker = `表「${sheetName || sheetKey}」存在 ${oversizedRows.length} 行宽度（>${headerWidth} 列）超过表头，无法安全导入。`;
      blockers.push(blocker_ACU('invalid_row', sheetKey, sheetName, audit.blocker));
      audits.push(audit);
      continue;
    }
    const businessKeyGroups = extractBusinessKeyColumns_ACU(ddl);
    const businessKeyColumns = businessKeyGroups.length > 0 ? businessKeyGroups[0] : [];
    const businessKeyIndexes = businessKeyColumns
      .map(sqlName => headerIndexBySql.get(sqlName))
      .filter((index): index is number => index !== undefined && index > 0);

    const toRowIdentity = (row: string[]): TemplateRowIdentity_ACU => {
      const rowId = canonicalRowId_ACU(row[0] ?? '');
      const values = businessKeyIndexes.map(index => row[index] ?? '');
      const businessKey = businessKeyColumns.length > 0 && businessKeyIndexes.length === businessKeyColumns.length
        ? values.map(v => String(v).trim()).join('\u0001')
        : null;
      return { rowId, businessKey };
    };

    audit.rowIdentities = templateRows.map(toRowIdentity);

    if (dataMode === 'replace') {
      audit.action = 'replaced';
      audit.insertedRowCount = templateRows.length;
      audits.push(audit);
      continue;
    }

    if (dataMode === 'seed') {
      audit.action = 'seed-only';
      audits.push(audit);
      continue;
    }

    // merge 模式
    if (businessKeyColumns.length === 0) {
      audit.action = 'blocked';
      audit.blocker = `表「${sheetName || sheetKey}」缺少可证明的唯一业务键（DDL UNIQUE/主键），无法安全 merge。请改用 replace 或 seed，或为 DDL 添加 UNIQUE 约束。`;
      blockers.push(blocker_ACU('missing_business_key', sheetKey, sheetName, audit.blocker));
      audits.push(audit);
      continue;
    }

    const runtimeIdentityByKey = new Map<string, string>();
    for (const row of runtimeRows) {
      const identity = toRowIdentity(row);
      if (identity.businessKey) runtimeIdentityByKey.set(identity.businessKey, identity.rowId);
    }

    const plan: TemplateSheetMergePlan_ACU = {
      sheetKey,
      businessKeyColumns,
      matchedRowIds: [],
      insertRowIds: [],
      conflictRowIds: [],
      rejectedRowIds: [],
      overrideRowIds: [],
    };

    for (const identity of audit.rowIdentities) {
      if (!identity.businessKey) {
        audit.action = 'blocked';
        audit.blocker = `表「${sheetName || sheetKey}」存在缺少业务键值的行（row_id=${identity.rowId}），无法安全 merge。`;
        blockers.push(blocker_ACU('invalid_row', sheetKey, sheetName, audit.blocker));
        continue;
      }
      const existing = runtimeIdentityByKey.get(identity.businessKey);
      if (existing === undefined) {
        plan.insertRowIds.push(identity.rowId);
        audit.insertedRowCount += 1;
        continue;
      }
      plan.conflictRowIds.push(identity.rowId);
      audit.conflictRowCount += 1;
      const values = businessKeyIndexes.map(index => identity.businessKey?.split('\u0001')[businessKeyIndexes.indexOf(index)] ?? '');
      audit.conflicts.push({ businessKey: identity.businessKey, values });
      if (policy === 'reject') {
        plan.rejectedRowIds.push(identity.rowId);
        audit.action = 'blocked';
        audit.blocker = `表「${sheetName || sheetKey}」存在业务键冲突（${identity.businessKey}），conflictPolicy=reject 已阻止提交。`;
        blockers.push(blocker_ACU('merge_conflict_rejected', sheetKey, sheetName, audit.blocker));
      } else {
        if (policy === 'template-wins') {
          plan.overrideRowIds.push(identity.rowId);
          audit.keptRowCount += 1;
        } else {
          plan.matchedRowIds.push(identity.rowId);
          audit.keptRowCount += 1;
        }
      }
    }

    if (audit.action === 'blocked') {
      mergePlan[sheetKey] = plan;
      audits.push(audit);
      continue;
    }

    audit.action = 'merged-insert';
    mergePlan[sheetKey] = plan;
    audits.push(audit);
  }

  return { ok: blockers.length === 0, blockers, audits, ...(Object.keys(mergePlan).length > 0 ? { mergePlan } : {}) };
}
