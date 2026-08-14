/**
 * data/sqlite/schema-mapper.ts — Sheet ↔ SQL 双向映射
 *
 * 职责：
 * - Sheet → SQL：生成 DDL + INSERT 语句
 * - SQL → Sheet：SELECT 结果 → content 二维数组
 * - 处理类型亲和性转换（content 全是 string，SQL 有类型）
 * - DDL 解析（表名、中文名、列信息）
 */

import type {
  Sheet_ACU
} from '../../shared/models/table-data';
import {
  logDebug_ACU
} from '../../shared/utils';
import {
  mapSqlColumnIdentifiers_ACU
} from '../../shared/sql-identifier-mapper';
import {
  normalizeSqlStructure,
  normalizeConstrainedValue
} from './sql-normalizer';

// DDL 纯解析函数已移至 shared/ddl-utils.ts，此处 re-export 保持 data 层内部调用不变
export {
  parseDDLTableName,
  parseDDLChineseName,
  parseDDLColumnNames,
  parseDDLColumnComments,
  buildColumnNameMap,
  getDDLColumnNameByIndex,
  updateDDLColumnComment,
  parseDDLColumnInfos_ACU,
  validateDDLTextAgainstHeaders_ACU,
  rebindCreateTableName_ACU,
} from '../../shared/ddl-utils';
import {
  matchesDDLColumnHeader_ACU,
  parseDDLColumnInfos_ACU,
  parseDDLTableName,
  parseDDLColumnNames,
  rebindCreateTableName_ACU,
  validateDDLTextAgainstHeaders_ACU,
} from '../../shared/ddl-utils';

// ═══════════════════════════════════════════════════════════════
// DDL 生成
// ═══════════════════════════════════════════════════════════════

/**
 * 从 Sheet 生成建表 DDL
 * 优先使用 sourceData.ddl，fallback 为全 TEXT 的自动生成 DDL
 *
 * @param sheet Sheet 对象
 * @param fallbackTableName fallback 时使用的英文表名（默认用 sheet.uid）
 * @returns CREATE TABLE 语句
 */
export function generateDDL(sheet: Sheet_ACU, fallbackTableName?: string): string {
  const ddl = sheet.sourceData?.ddl?.trim();
  if (ddl) {
    const normalizedDdl = normalizeSqlStructure(ddl);
    logDebug_ACU(`[Schema] generateDDL: 使用用户定义 DDL, 表名=${parseDDLTableName(normalizedDdl) || 'unknown'}`);
    return normalizedDdl;
  }

  const headers = sheet.content?.[0];
  if (!Array.isArray(headers) || headers.length === 0) {
    const tblName = fallbackTableName || sheet.uid || 'unknown_table';
    return `CREATE TABLE ${sanitizeIdentifier(tblName)} (\n  row_id INTEGER PRIMARY KEY -- 行号\n);`;
  }

  const tblName = fallbackTableName || sheet.uid || 'unknown_table';
  return generateFallbackDDL(sanitizeIdentifier(tblName), headers);
}

export interface EffectiveDDLColumnMap_ACU {
  mappings: ReadonlyArray<{ sourceIndex: number; displayName: string; sqlName: string; required: boolean }>;
  sqlToDisplay: Map<string, string>;
}

export interface EffectiveDDLResult_ACU {
  originalDDL: string;
  effectiveDDL: string;
  source: 'explicit' | 'fallback_missing' | 'fallback_invalid';
  diagnostics: string[];
  columnMap: EffectiveDDLColumnMap_ACU;
}

/**
 * Resolves the DDL used by runtime SQLite without mutating sourceData.ddl.
 * Persistence and migration callers must reject fallback_invalid explicitly;
 * runtime callers may use its generated effectiveDDL after recording a diagnostic.
 */
export function resolveEffectiveDDL(
  sheet: Sheet_ACU,
  fallbackTableName?: string,
  runtimeTableName?: string,
): EffectiveDDLResult_ACU {
  const headers = sheet.content?.[0];
  const safeHeaders = Array.isArray(headers) && headers.length > 0
    ? headers.map(header => String(header ?? ''))
    : ['row_id'];
  const originalDDL = typeof sheet.sourceData?.ddl === 'string' ? sheet.sourceData.ddl.trim() : '';

  if (!originalDDL) {
    return buildRuntimeFallbackDDL_ACU(sheet, runtimeTableName || fallbackTableName, 'fallback_missing', 'DDL 缺失，已使用运行时 fallback schema。');
  }

  const normalizedDDL = normalizeSqlStructure(originalDDL);
  const columns = parseDDLColumnInfos_ACU(normalizedDDL);
  const firstColumn = columns[0];
  if (parseDDLTableName(normalizedDDL) && firstColumn?.sqlName === 'row_id'
    && firstColumn.declaredType === 'INTEGER' && firstColumn.isPrimaryKey) {
    const effectiveDDL = runtimeTableName
      ? rebindCreateTableName_ACU(normalizedDDL, runtimeTableName)
      : normalizedDDL;
    logDebug_ACU(`[Schema] resolveEffectiveDDL: 使用用户定义 DDL, runtime表名=${parseDDLTableName(effectiveDDL) || 'unknown'}`);
    return {
      originalDDL,
      effectiveDDL,
      source: 'explicit',
      diagnostics: [],
      columnMap: buildExplicitColumnMap_ACU(sheet, normalizedDDL, safeHeaders),
    };
  }

  return buildRuntimeFallbackDDL_ACU(sheet, runtimeTableName || fallbackTableName, 'fallback_invalid', '显式 DDL 缺少可用的 row_id INTEGER PRIMARY KEY 结构。');
}

export function buildRuntimeFallbackDDL_ACU(
  sheet: Sheet_ACU,
  fallbackTableName?: string,
  source: 'fallback_missing' | 'fallback_invalid' = 'fallback_missing',
  diagnostic = 'DDL 缺失，已使用运行时 fallback schema。',
): EffectiveDDLResult_ACU {
  const headers = Array.isArray(sheet.content?.[0]) && sheet.content[0].length > 0
    ? sheet.content[0].map(header => (header === null || header === undefined ? null : String(header)))
    : ['row_id'];
  const fallbackTable = sanitizeIdentifier(fallbackTableName || sheet.uid || 'unknown_table');
  return {
    originalDDL: typeof sheet.sourceData?.ddl === 'string' ? sheet.sourceData.ddl.trim() : '',
    effectiveDDL: generateFallbackDDL(fallbackTable, headers),
    source,
    diagnostics: [diagnostic],
    columnMap: buildFallbackColumnMap_ACU(headers),
  };
}

function buildFallbackColumnMap_ACU(headers: readonly (string | null)[]): EffectiveDDLColumnMap_ACU {
  const { mappings } = mapSqlColumnIdentifiers_ACU(headers);
  if (!mappings[0]?.isRowId) {
    throw new Error('fallback schema 需要首列表头为 row_id，且所有表头必须可安全映射');
  }
  return {
    mappings: mappings.map(mapping => ({ sourceIndex: mapping.index, displayName: String(mapping.displayName), sqlName: mapping.sqlName, required: mapping.isRowId })),
    sqlToDisplay: new Map(mappings.map(mapping => [mapping.sqlName, String(mapping.displayName)])),
  };
}

function buildExplicitColumnMap_ACU(sheet: Sheet_ACU, ddl: string, headers: readonly string[]): EffectiveDDLColumnMap_ACU {
  const insertMappings = resolveInsertColumnMappings(sheet, headers, ddl);
  const mappings = insertMappings.map(mapping => {
    return {
      sourceIndex: mapping.sourceIndex,
      displayName: headers[mapping.sourceIndex],
      sqlName: mapping.sqlName,
      required: mapping.required,
    };
  });
  return {
    mappings,
    sqlToDisplay: new Map(mappings.map(mapping => [mapping.sqlName, mapping.displayName])),
  };
}

/**
 * 从 content[0] 表头自动生成全 TEXT 的 fallback DDL
 * 第一列 "row_id" 映射为 INTEGER PRIMARY KEY
 * 其余列全部为 TEXT
 * 生成与验证共享同一份列身份契约：表头先规范化（NFKC/trim），
 * 空/空白/重复规范化列名、row_id 缺失或非首位一律 fail-closed，
 * 绝不把空表头掩盖成 col_N 物理列。
 *
 * @param tableName 英文表名
 * @param headers content[0] 表头行
 * @returns CREATE TABLE 语句
 */
export function generateFallbackDDL(tableName: string, headers: (string | null)[]): string {
  const lines: string[] = [];
  const rawHeaders = Array.isArray(headers) ? headers : [];
  const normalizedHeaders = rawHeaders.length > 0 ? rawHeaders : ['row_id'];
  const { mappings, diagnostics } = mapSqlColumnIdentifiers_ACU(normalizedHeaders);
  if (diagnostics.length > 0) {
    throw new Error(`fallback DDL 表头不合法：${diagnostics
      .map(diagnostic => `第 ${diagnostic.index + 1} 列「${diagnostic.originalName}」${diagnostic.code}`)
      .join('；')}`);
  }
  if (!mappings[0]?.isRowId) {
    throw new Error('fallback DDL 需要首列表头为 row_id，且所有表头必须唯一且非空');
  }

  for (const mapping of mappings) {
    if (mapping.isRowId) {
      lines.push('  row_id INTEGER PRIMARY KEY -- 行号');
    } else {
      lines.push(`  ${mapping.sqlName} TEXT -- ${mapping.displayName}`);
    }
  }

  if (lines.length === 0) {
    lines.push('  row_id INTEGER PRIMARY KEY -- 行号');
  }

  // 逗号必须放在注释之前（-- 注释到行尾，逗号在注释后会被注释掉）
  // 格式：column_def, -- 注释
  const formattedLines = lines.map((line, idx) => {
    if (idx < lines.length - 1) {
      // 非最后一行：在注释前插入逗号
      const commentIdx = line.indexOf('--');
      if (commentIdx > 0) {
        return line.substring(0, commentIdx).trimEnd() + ', ' + line.substring(commentIdx);
      }
      return line + ',';
    }
    return line; // 最后一行不加逗号
  });

  return `CREATE TABLE ${sanitizeIdentifier(tableName)} (\n${formattedLines.join('\n')}\n);`;
}

// ═══════════════════════════════════════════════════════════════
// INSERT 生成
// ═══════════════════════════════════════════════════════════════

/**
 * 从 Sheet 生成 INSERT 语句（灌入 content 数据）
 * content[0] 是表头，content[1:] 是数据行
 *
 * @param sheet Sheet 对象
 * @param tableName SQL 表名（如果不传，从 DDL 解析或用 sheet.uid）
 * @returns INSERT 语句数组（每行一条）
 */
export function generateInserts(sheet: Sheet_ACU, tableName?: string, plan?: SheetInsertPlan_ACU): string[] {
  const content = sheet.content;
  if (!Array.isArray(content) || content.length < 2) return [];

  const headers = content[0];
  if (!Array.isArray(headers) || headers.length === 0) return [];

  // 确定表名
  const tblName = tableName
    || parseDDLTableName(sheet.sourceData?.ddl || '')
    || sheet.uid
    || 'unknown_table';

  logDebug_ACU(`[Schema] generateInserts: 表=${tblName}, 数据行数=${content.length - 1}`);

  const resolvedPlan = plan || createSheetInsertPlan(sheet);
  const columnNames = resolvedPlan.mappings.map(mapping => mapping.sqlName);

  const statements: string[] = [];

  for (let r = 1; r < content.length; r++) {
    const row = content[r];
    if (!Array.isArray(row)) continue;

    const values: string[] = [];
    for (const mapping of resolvedPlan.mappings) {
      const val = mapping.sourceIndex < row.length ? row[mapping.sourceIndex] : null;
      if (mapping.required && (val === null || val === undefined)) {
        throw new Error(`第 ${r} 行缺少必需列「${mapping.sqlName}」的值`);
      }
      // 对白名单约束字段做值规范化（如 code_index 的大小写/全角数字）
      const normalizedVal = normalizeConstrainedValue(mapping.sqlName, val);
      values.push(escapeValue(normalizedVal));
    }

    // Snapshot row_id is a persistent identity. Duplicates must fail instead of
    // overwriting an earlier row and silently losing historical data.
    statements.push(`INSERT INTO ${sanitizeIdentifier(tblName)} (${columnNames.map(sanitizeIdentifier).join(', ')}) VALUES (${values.join(', ')});`);
  }

  return statements;
}

/**
 * 供 hydrate 校验与 INSERT 生成共同消费的单次映射计划。
 * 只接受 DDL 物理列名、DDL 注释和 row_id/行号别名；不猜测未知旧表头的位置。
 */
export interface SheetInsertPlan_ACU {
  mappings: readonly InsertColumnMapping[];
}

export function createSheetInsertPlan(sheet: Sheet_ACU, columnMap?: EffectiveDDLColumnMap_ACU): SheetInsertPlan_ACU {
  const headers = sheet.content?.[0];
  if (!Array.isArray(headers) || headers.length === 0) {
    throw new Error('snapshot 缺少表头，无法安全 hydrate');
  }
  if (columnMap) return { mappings: columnMap.mappings.map(mapping => ({ ...mapping })) };
  return { mappings: resolveInsertColumnMappings(sheet, headers) };
}

interface InsertColumnMapping {
  sqlName: string;
  sourceIndex: number;
  required: boolean;
}

function resolveInsertColumnMappings(sheet: Sheet_ACU, headers: readonly string[], ddlOverride?: string): InsertColumnMapping[] {
  const ddl = ddlOverride || sheet.sourceData?.ddl?.trim();
  if (!ddl) {
    // 与 buildRuntimeFallbackDDL_ACU 保持一致：保留首列不可编辑的 null row_id 占位，
    // 不把它拍扁成空串（否则会被映射器判为非法空列而 fail-closed）。
    const nullPreservingHeaders = headers.map(header => (header === null || header === undefined ? null : String(header)));
    return createSheetInsertPlan(sheet, buildFallbackColumnMap_ACU(nullPreservingHeaders)).mappings.slice();
  }

  const columns = parseDDLColumnInfos_ACU(ddl);
  const firstColumn = columns[0];
  if (!firstColumn || firstColumn.sqlName !== 'row_id' || firstColumn.declaredType !== 'INTEGER' || !firstColumn.isPrimaryKey) {
    throw new Error('DDL 必须以 row_id INTEGER PRIMARY KEY 作为首列，无法安全 hydrate');
  }

  const normalizedHeaders = headers.map(header => String(header ?? '').trim());
  if (new Set(normalizedHeaders.filter(Boolean)).size !== normalizedHeaders.filter(Boolean).length) {
    throw new Error('snapshot 表头存在重复列，无法安全 hydrate');
  }
  const mappings: InsertColumnMapping[] = [];
  const usedSourceIndexes = new Set<number>();

  for (const column of columns) {
    const candidates = normalizedHeaders
      .map((header, index) => ({ header, index }))
      .filter(({ header }) => matchesDDLColumnHeader_ACU(column.sqlName, column.comment, header));

    if (candidates.length > 1) {
      throw new Error(`DDL 列「${column.sqlName}」匹配到多个表头，无法安全 hydrate`);
    }
    if (candidates.length === 1) {
      const sourceIndex = candidates[0].index;
      if (usedSourceIndexes.has(sourceIndex)) {
        throw new Error(`表头「${normalizedHeaders[sourceIndex]}」被多个 DDL 列使用，无法安全 hydrate`);
      }
      usedSourceIndexes.add(sourceIndex);
      mappings.push({
        sqlName: column.sqlName,
        sourceIndex,
        required: column.isPrimaryKey || (column.isNotNull && !column.hasDefault),
      });
    }
  }

  for (const column of columns) {
    const mapped = mappings.some(mapping => mapping.sqlName === column.sqlName);
    const required = column.isPrimaryKey || (column.isNotNull && !column.hasDefault);
    if (!mapped && required) {
      throw new Error(`缺少必需 DDL 列「${column.sqlName}」对应的表头，无法安全 hydrate`);
    }
  }

  const unusedSourceIndexes = normalizedHeaders
    .map((_, index) => index)
    .filter(index => !usedSourceIndexes.has(index));
  for (const index of unusedSourceIndexes) {
    const hasBusinessValue = (sheet.content || []).slice(1).some(row =>
      Array.isArray(row) && row[index] !== null && row[index] !== undefined && row[index] !== '',
    );
    if (hasBusinessValue) {
      throw new Error(`表头「${normalizedHeaders[index] || `第 ${index + 1} 列`}」没有对应的 DDL 列，拒绝丢弃非空数据`);
    }
  }

  return mappings;
}

// ═══════════════════════════════════════════════════════════════
// SQL 结果 → content 转换
// ═══════════════════════════════════════════════════════════════

/**
 * 从 SQL 查询结果还原为 content 二维数组
 * 自动将 SQL 类型值转为 string（content 的存储格式）
 *
 * @param columns SQL 结果的列名数组
 * @param values SQL 结果的值数组
 * @param chineseHeaders 中文表头映射（列名 → 中文名），用于还原 content[0]
 * @returns content 二维数组（第一行是表头，后续是数据行）
 */
export function resultToContent(
  columns: string[],
  values: SqlJsValueType[][],
  chineseHeaders?: Map<string, string>
): (string | null)[][] {
  if (columns.length === 0) return [['row_id']];

  // 构建表头行：用中文名（如果有映射），否则用 SQL 列名
  const headerRow: (string | null)[] = columns.map(col => {
    if (col === 'row_id') return 'row_id';
    return chineseHeaders?.get(col) || col;
  });

  // 构建数据行：所有值转为 string
  const dataRows: (string | null)[][] = values.map(row =>
    row.map(val => valueToString(val))
  );

  return [headerRow, ...dataRows];
}

// ═══════════════════════════════════════════════════════════════
// DDL 校验
// ═══════════════════════════════════════════════════════════════

/**
 * 校验 DDL 列名与 content[0] 表头是否匹配
 * 比较的是列数和列的对应关系（通过 DDL 注释中的中文名匹配）
 *
 * @param ddl CREATE TABLE 语句
 * @param headers content[0] 表头行
 * @returns 校验结果
 */
export function validateDDLAgainstHeaders(
  ddl: string,
  headers: (string | null)[]
): { valid: boolean; mismatches: string[] } {
  // 保序传给统一契约校验；不再 filter 剔除 null，避免改变列位置
  // （中间空列由 validator 按“第 N 列为空”fail-closed）。
  // 首列 null 占位（visualizer 不可编辑 row_id）必须原样传递给统一契约，
  // 不能拍扁成空串——否则会被误判为“空表头”fail-closed。
  const normalizedHeaders = Array.isArray(headers) ? headers.map(h => (h === null || h === undefined ? null : String(h))) : [];
  const result = validateDDLTextAgainstHeaders_ACU(ddl, normalizedHeaders);
  return {
    valid: result.valid,
    mismatches: result.valid ? [] : [result.message],
  };
}



// ═══════════════════════════════════════════════════════════════
// 内部工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 将 SQL 值转为 content 中的 string 格式
 * null → null, number → string, Uint8Array → "[BLOB]", string → string
 */
function valueToString(val: SqlJsValueType): string | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Uint8Array) return '[BLOB]';
  return String(val);
}

/**
 * 将 content 中的值转为 SQL 字面量
 * null/undefined → NULL, 数字字符串 → 数字, 其他 → 带引号的字符串
 */
function escapeValue(val: string | null | undefined): string {
  if (val === null || val === undefined) return 'NULL';
  // 纯数字（整数或浮点数）直接输出
  if (/^-?\d+(\.\d+)?$/.test(val)) return val;
  // 字符串：单引号转义
  return `'${val.replace(/'/g, "''")}'`;
}

/**
 * 清理 SQL 标识符（防止注入）
 * 只保留字母、数字、下划线
 */
function sanitizeIdentifier(name: string): string {
  // 如果已经是合法标识符，直接返回
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return name;
  // 否则去掉非法字符
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  return cleaned || '_unknown';
}
