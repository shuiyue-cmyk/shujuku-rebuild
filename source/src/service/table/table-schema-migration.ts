import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';
import { normalizeDDLForSchemaDescriptor_ACU, parseDDLColumnInfos_ACU, parseDDLTableConstraints_ACU, parseDDLTableName, parseDDLTableSuffix_ACU, parseDDLSafeDefaultLiteral_ACU, validateDDLTextAgainstHeaders_ACU } from '../../shared/ddl-utils';
import { hydrateTableDataStrict_ACU } from './sqlite-template-validation';
import type {
  TableSchemaColumnChangeV2_ACU,
  TableSchemaColumnDescriptorV2_ACU,
  TableSchemaConversionPolicyV2_ACU,
  TableSchemaDefaultLiteralV2_ACU,
  TableSheetSchemaDescriptorV2Contract_ACU,
  TableSheetSchemaMigrateOperation_ACU,
  TableSheetSchemaMigrateOperationV2Contract_ACU,
  TableSheetSchemaDescriptorV2_ACU,
  TableSheetSchemaMigrateOperationV2_ACU,
} from './storage-frame-v2-types';

function deepClone_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

const P1_COLUMN_CONSTRAINT_TOKENS_ACU = new Set(['AS', 'CHECK', 'COLLATE', 'CONSTRAINT', 'DEFAULT', 'FOREIGN', 'GENERATED', 'NOT', 'PRIMARY', 'REFERENCES', 'UNIQUE']);

function canonicalJson_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson_ACU).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson_ACU(record[key])}`).join(',')}}`;
}

async function sha256_ACU(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('schema migration requires Web Crypto SHA-256 support.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function requireSheetShape_ACU(sheet: Sheet_ACU, phase: string): { headers: string[]; columns: ReturnType<typeof parseDDLColumnInfos_ACU> } {
  const headers = sheet.content?.[0];
  if (!Array.isArray(headers) || headers[0] !== 'row_id') throw new Error(`${phase} 必须保留 row_id 作为首列。`);
  const ddl = String(sheet.sourceData?.ddl || '');
  const validation = validateDDLTextAgainstHeaders_ACU(ddl, headers.map(value => String(value ?? '')));
  if (!validation.valid) throw new Error(`${phase} DDL/表头不一致：${validation.message}`);
  const columns = parseDDLColumnInfos_ACU(ddl);
  if (columns.length !== headers.length || columns[0]?.sqlName !== 'row_id' || !columns[0].isPrimaryKey || columns[0].declaredType !== 'INTEGER') {
    throw new Error(`${phase} 必须以 row_id INTEGER PRIMARY KEY 作为首列。`);
  }
  const physicalNames = columns.map(column => column.sqlName);
  if (new Set(physicalNames).size !== physicalNames.length) throw new Error(`${phase} 包含重复 physical column。`);
  return { headers: headers.map(value => String(value ?? '')), columns };
}

export function getSheetSchemaDescriptor_ACU(sheet: Sheet_ACU): TableSheetSchemaDescriptorV2_ACU {
  const { headers, columns } = requireSheetShape_ACU(sheet, 'schema descriptor');
  const ddl = String(sheet.sourceData?.ddl || '');
  const tableName = parseDDLTableName(ddl);
  if (!tableName) throw new Error('schema descriptor 缺少可解析的物理表名。');
  return {
    descriptorVersion: 1,
    uid: String(sheet.uid || ''),
    tableName,
    headers: [...headers],
    ddl,
    normalizedSql: normalizeDDLForSchemaDescriptor_ACU(ddl),
    columns: columns.map((column, index): TableSchemaColumnDescriptorV2_ACU => ({
      index,
      physicalName: column.sqlName,
      displayHeader: headers[index],
      normalizedDefinition: column.normalizedDefinition,
    })),
    tableConstraints: parseDDLTableConstraints_ACU(ddl),
    tableSuffix: parseDDLTableSuffix_ACU(ddl),
  };
}

export function getSheetSchemaDescriptorV2Contract_ACU(sheet: Sheet_ACU): TableSheetSchemaDescriptorV2Contract_ACU {
  const { headers, columns } = requireSheetShape_ACU(sheet, 'schema descriptor V2');
  const ddl = String(sheet.sourceData?.ddl || '');
  const tableName = parseDDLTableName(ddl);
  if (!tableName) throw new Error('schema descriptor V2 缺少可解析的物理表名。');
  return {
    descriptorVersion: 2,
    uid: String(sheet.uid || ''),
    tableName,
    headers: [...headers],
    ddl,
    normalizedSql: normalizeDDLForSchemaDescriptor_ACU(ddl),
    columns: columns.map((column, index) => ({
      index,
      physicalName: column.sqlName,
      displayHeader: headers[index],
      normalizedDefinition: column.normalizedDefinition,
      defaultExpression: column.defaultExpression,
    })),
    tableConstraints: parseDDLTableConstraints_ACU(ddl),
    tableSuffix: parseDDLTableSuffix_ACU(ddl),
  };
}

function descriptorV2ToSheet_ACU(descriptor: TableSheetSchemaDescriptorV2Contract_ACU): Sheet_ACU {
  return {
    uid: descriptor.uid,
    name: '',
    content: [descriptor.headers.map(value => value == null ? null : String(value))],
    sourceData: { ddl: descriptor.ddl },
  } as Sheet_ACU;
}

function assertDescriptorV2MatchesSheet_ACU(
  descriptor: TableSheetSchemaDescriptorV2Contract_ACU,
  sheet: Sheet_ACU,
  phase: string,
): void {
  if (!descriptor || descriptor.descriptorVersion !== 2) throw new Error(`${phase} 缺少受支持的 descriptorVersion: 2。`);
  const actual = getSheetSchemaDescriptorV2Contract_ACU(sheet);
  if (canonicalJson_ACU(descriptor) !== canonicalJson_ACU(actual)) throw new Error(`${phase} 与 DDL/表头定义不一致。`);
}

async function getSchemaV2ContractDigest_ACU(descriptor: TableSheetSchemaDescriptorV2Contract_ACU): Promise<string> {
  return sha256_ACU(canonicalJson_ACU(descriptor));
}

export async function getSheetSchemaDigest_ACU(sheet: Sheet_ACU): Promise<string> {
  return sha256_ACU(canonicalJson_ACU(getSheetSchemaDescriptor_ACU(sheet)));
}

function descriptorToSheet_ACU(descriptor: TableSheetSchemaDescriptorV2_ACU): Sheet_ACU {
  return {
    uid: descriptor.uid,
    name: '',
    content: [descriptor.headers.map(value => value == null ? null : String(value))],
    sourceData: { ddl: descriptor.ddl },
  } as Sheet_ACU;
}

function assertDescriptorMatchesSheet_ACU(
  descriptor: TableSheetSchemaDescriptorV2_ACU,
  sheet: Sheet_ACU,
  phase: string,
): void {
  if (!descriptor || descriptor.descriptorVersion !== 1) throw new Error(`${phase} 缺少受支持的 descriptorVersion。`);
  const actual = getSheetSchemaDescriptor_ACU(sheet);
  if (canonicalJson_ACU(descriptor) !== canonicalJson_ACU(actual)) throw new Error(`${phase} 与 DDL/表头定义不一致。`);
}

function getExpectedChanges_ACU(
  before: TableSheetSchemaDescriptorV2_ACU,
  target: TableSheetSchemaDescriptorV2_ACU,
): TableSchemaColumnChangeV2_ACU[] {
  if (before.uid !== target.uid) throw new Error('schema migration 不允许修改 sheet uid。');
  if (canonicalJson_ACU(before.tableConstraints) !== canonicalJson_ACU(target.tableConstraints)) throw new Error('P1 不支持表级 constraint 变更。');
  if (before.tableSuffix !== target.tableSuffix) throw new Error('P1 不支持 CREATE TABLE suffix 变更。');
  const beforeByName = new Map(before.columns.map(column => [column.physicalName, column]));
  const targetByName = new Map(target.columns.map(column => [column.physicalName, column]));
  const removed = before.columns.slice(1).filter(column => !targetByName.has(column.physicalName));
  const added = target.columns.slice(1).filter(column => !beforeByName.has(column.physicalName));
  if (removed.length > 0 && added.length > 0) throw new Error('P1 不支持同次新增和删除 physical column；必须等待显式 mapping 契约。');
  const retainedBefore = before.columns.filter(column => targetByName.has(column.physicalName)).map(column => column.physicalName);
  const retainedTarget = target.columns.filter(column => beforeByName.has(column.physicalName)).map(column => column.physicalName);
  if (canonicalJson_ACU(retainedBefore) !== canonicalJson_ACU(retainedTarget)) {
    throw new Error('P1 不支持 retained physical column 重排。');
  }

  const changes: TableSchemaColumnChangeV2_ACU[] = [];
  for (const column of before.columns) {
    const targetColumn = targetByName.get(column.physicalName);
    if (!targetColumn) {
      if (column.physicalName === 'row_id') throw new Error('schema migration 不允许删除 row_id。');
      changes.push({ kind: 'drop', physicalName: column.physicalName, header: column.displayHeader, index: column.index });
      continue;
    }
    if (column.normalizedDefinition !== targetColumn.normalizedDefinition) {
      throw new Error(`P1 不支持 definition/constraint 变更: ${column.physicalName}`);
    }
    if (column.displayHeader !== targetColumn.displayHeader) {
      changes.push({ kind: 'rename_display', physicalName: column.physicalName, fromHeader: column.displayHeader, toHeader: targetColumn.displayHeader });
    }
  }
  for (const column of added) {
    if (column.physicalName === 'row_id') throw new Error('schema migration 不允许新增或替换 row_id。');
    const targetSheet = descriptorToSheet_ACU(target);
    const targetInfo = requireSheetShape_ACU(targetSheet, 'target schema').columns[column.index];
    const pureDefinition = targetInfo?.declaredType ? `${targetInfo.sqlName} ${targetInfo.declaredType}` : targetInfo?.sqlName;
    if (!targetInfo) {
      throw new Error(`P1 新增列缺少可解析 definition: ${column.physicalName}`);
    }
    if (targetInfo.isNotNull) {
      throw new Error(`P1 新增列必须允许 NULL，NOT NULL/default fillStrategy 留待 P2: ${column.physicalName}`);
    }
    if (targetInfo.hasDefault || P1_COLUMN_CONSTRAINT_TOKENS_ACU.has(targetInfo.declaredType?.toUpperCase() || '') || targetInfo.normalizedDefinition !== pureDefinition) {
      throw new Error(`P1 新增列必须是无 DEFAULT 或列级 constraint 的 nullable pure column，复杂 definition/fillStrategy 留待 P2: ${column.physicalName}`);
    }
    changes.push({ kind: 'add', physicalName: column.physicalName, header: column.displayHeader, index: column.index });
  }
  return changes;
}

function assertChangesMatch_ACU(actual: TableSchemaColumnChangeV2_ACU[], expected: TableSchemaColumnChangeV2_ACU[]): void {
  if (canonicalJson_ACU(actual) !== canonicalJson_ACU(expected)) throw new Error('schema migration columnChanges 与 before→target diff 不一致。');
}

function buildMigratedSheet_ACU(currentSheet: Sheet_ACU, target: TableSheetSchemaDescriptorV2_ACU): Sheet_ACU {
  const current = getSheetSchemaDescriptor_ACU(currentSheet);
  const currentIndexByPhysicalName = new Map(current.columns.map(column => [column.physicalName, column.index]));
  const targetColumns = target.columns;
  const content: (string | null)[][] = [target.headers.map(value => value == null ? null : String(value))];
  for (const row of currentSheet.content.slice(1)) {
    if (!Array.isArray(row)) continue;
    content.push(targetColumns.map(column => {
      const sourceIndex = currentIndexByPhysicalName.get(column.physicalName);
      return sourceIndex === undefined || row[sourceIndex] == null ? null : String(row[sourceIndex]);
    }));
  }
  return { ...deepClone_ACU(currentSheet), uid: target.uid, content, sourceData: { ...currentSheet.sourceData, ddl: target.ddl } };
}


/**
 * Builds the only schema operation accepted by the P1 reader. Writer use stays
 * frozen; this constructor exists for tests and future preflight only.
 */
export async function buildSheetSchemaMigrationOperation_ACU(
  sheetKey: string,
  beforeSheet: Sheet_ACU,
  afterSheet: Sheet_ACU,
  options: { destructiveChangeConfirmed?: boolean } = {},
): Promise<TableSheetSchemaMigrateOperationV2_ACU> {
  if (!sheetKey.startsWith('sheet_')) throw new Error('schema migration requires a sheet_ key.');
  const beforeSchema = getSheetSchemaDescriptor_ACU(beforeSheet);
  const targetSchema = getSheetSchemaDescriptor_ACU(afterSheet);
  const columnChanges = getExpectedChanges_ACU(beforeSchema, targetSchema);
  const hasDrop = columnChanges.some(change => change.kind === 'drop');
  if (hasDrop && !options.destructiveChangeConfirmed) throw new Error('删除列需要显式确认。');
  const operation: TableSheetSchemaMigrateOperationV2_ACU = {
    kind: 'sheet_schema_migrate',
    contractVersion: 1,
    sheetKey,
    beforeSchemaDigest: await sha256_ACU(canonicalJson_ACU(beforeSchema)),
    targetSchemaDigest: await sha256_ACU(canonicalJson_ACU(targetSchema)),
    beforeSchema,
    targetSchema,
    columnChanges,
    migrationPolicy: { destructiveChangeConfirmed: hasDrop ? true : false },
  };
  const candidate = buildMigratedSheet_ACU(beforeSheet, targetSchema);
  await hydrateTableDataStrict_ACU({ mate: { type: 'acu', version: 1 }, [sheetKey]: candidate });
  return operation;
}

function assertOperationContract_ACU(currentSheet: Sheet_ACU, operation: TableSheetSchemaMigrateOperationV2_ACU): void {
  if (operation.contractVersion !== 1) throw new Error(`schema migration contractVersion 不受支持: ${String((operation as any).contractVersion)}`);
  if (!operation.sheetKey.startsWith('sheet_')) throw new Error('schema migration 包含非法 sheetKey。');
  assertDescriptorMatchesSheet_ACU(operation.beforeSchema, currentSheet, 'schema migration beforeSchema');
  assertDescriptorMatchesSheet_ACU(operation.targetSchema, descriptorToSheet_ACU(operation.targetSchema), 'schema migration targetSchema');
  if (operation.beforeSchema.uid !== operation.targetSchema.uid) throw new Error('schema migration 不允许修改 sheet uid。');
  const expectedChanges = getExpectedChanges_ACU(operation.beforeSchema, operation.targetSchema);
  assertChangesMatch_ACU(operation.columnChanges, expectedChanges);
  const hasDrop = expectedChanges.some(change => change.kind === 'drop');
  if (hasDrop !== operation.migrationPolicy?.destructiveChangeConfirmed) {
    throw new Error('schema migration destructive confirmation 与实际 diff 不一致。');
  }
}

function requireUniqueNames_ACU(values: string[], label: string): void {
  if (values.some(value => !value || value === 'row_id')) throw new Error(`${label} 不得为空或触及 row_id。`);
  if (new Set(values).size !== values.length) throw new Error(`${label} 包含重复项。`);
}

function literalToCellValue_ACU(literal: TableSchemaDefaultLiteralV2_ACU): string | null {
  if (literal.kind === 'null') return null;
  if (literal.kind === 'boolean') return literal.value ? '1' : '0';
  return String(literal.value);
}

function convertCellValue_ACU(value: unknown, policy: TableSchemaConversionPolicyV2_ACU): { value: string | null; lossy: boolean } {
  if (value == null) return { value: null, lossy: false };
  const input = String(value);
  if (policy.kind === 'identity') return { value: input, lossy: false };
  if (policy.kind === 'stringify') return { value: input, lossy: false };
  if (policy.kind === 'integer_strict') {
    if (!/^[+-]?\d+$/.test(input)) throw new Error(`integer_strict 无法转换值: ${input}`);
    const numeric = Number(input);
    if (!Number.isSafeInteger(numeric)) throw new Error(`integer_strict 超出安全整数范围: ${input}`);
    const output = String(numeric);
    return { value: output, lossy: output !== input };
  }
  if (policy.kind === 'real_strict') {
    if (!/^[+-]?(?:\d+\.\d*|\d*\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(input)) throw new Error(`real_strict 无法转换值: ${input}`);
    const numeric = Number(input);
    if (!Number.isFinite(numeric)) throw new Error(`real_strict 无法转换值: ${input}`);
    const output = String(numeric);
    return { value: output, lossy: output !== input };
  }
  throw new Error(`不支持的 conversion policy: ${String((policy as any)?.kind)}`);
}

function getSemanticColumnDefinition_ACU(column: { physicalName: string; normalizedDefinition: string }): string {
  return column.normalizedDefinition.slice(column.physicalName.length).trim();
}

function buildMigratedSheetV2_ACU(currentSheet: Sheet_ACU, operation: TableSheetSchemaMigrateOperationV2Contract_ACU, verifyDryRun = true): { sheet: Sheet_ACU; dryRun: { convertedRowCount: number; failedRowCount: number; lossyRowCount: number } } {
  const current = getSheetSchemaDescriptorV2Contract_ACU(currentSheet);
  assertDescriptorV2MatchesSheet_ACU(operation.beforeSchema, currentSheet, 'schema migration V2 beforeSchema');
  assertDescriptorV2MatchesSheet_ACU(operation.targetSchema, descriptorV2ToSheet_ACU(operation.targetSchema), 'schema migration V2 targetSchema');
  if (current.uid !== operation.targetSchema.uid) throw new Error('schema migration V2 不允许修改 sheet uid。');
  if (current.columns[0]?.physicalName !== 'row_id' || operation.targetSchema.columns[0]?.physicalName !== 'row_id') throw new Error('schema migration V2 必须保留 row_id。');

  const sourceByName = new Map(current.columns.map(column => [column.physicalName, column]));
  const targetByName = new Map(operation.targetSchema.columns.map(column => [column.physicalName, column]));
  const mappings = Array.isArray(operation.physicalColumnMappings) ? operation.physicalColumnMappings : [];
  requireUniqueNames_ACU(mappings.map(item => String(item?.fromPhysicalName || '')), 'physicalColumnMappings source');
  requireUniqueNames_ACU(mappings.map(item => String(item?.toPhysicalName || '')), 'physicalColumnMappings target');
  const mappedSource = new Map<string, string>();
  mappings.forEach(item => {
    if (!sourceByName.has(item.fromPhysicalName) || !targetByName.has(item.toPhysicalName)) throw new Error('physicalColumnMappings 指向不存在的 physical column。');
    if (sourceByName.has(item.toPhysicalName)) throw new Error('physicalColumnMappings target 必须是新增 physical column。');
    if (targetByName.has(item.fromPhysicalName)) throw new Error('physicalColumnMappings source 必须是已移除 physical column。');
    mappedSource.set(item.toPhysicalName, item.fromPhysicalName);
  });
  const removed = current.columns.slice(1).filter(column => !targetByName.has(column.physicalName) && !mappings.some(item => item.fromPhysicalName === column.physicalName));
  const added = operation.targetSchema.columns.slice(1).filter(column => !sourceByName.has(column.physicalName) && !mappedSource.has(column.physicalName));
  if (removed.length > 0 && !operation.migrationPolicy?.destructiveChangeConfirmed) throw new Error('schema migration V2 删除列需要 destructiveChangeConfirmed。');

  const conversionByTarget = new Map<string, TableSchemaConversionPolicyV2_ACU>();
  for (const conversion of Array.isArray(operation.conversions) ? operation.conversions : []) {
    if (!conversion || conversion.fromPhysicalName === 'row_id' || conversion.toPhysicalName === 'row_id') throw new Error('conversion 不得触及 row_id。');
    if (conversionByTarget.has(conversion.toPhysicalName)) throw new Error('conversion target 不得重复。');
    conversionByTarget.set(conversion.toPhysicalName, conversion.policy);
  }
  const fills = operation.fills && typeof operation.fills === 'object' ? operation.fills : {};
  Object.keys(fills).forEach(name => {
    if (!added.some(column => column.physicalName === name)) throw new Error(`fillStrategy 指向非新增列: ${name}`);
    const fill = fills[name];
    if (!fill || (fill.kind !== 'literal' && fill.kind !== 'ddl_literal_default')) throw new Error(`fillStrategy 不受支持: ${name}`);
    const parsed = parseDDLSafeDefaultLiteral_ACU(fill.literal?.sql);
    if (!parsed || canonicalJson_ACU(parsed) !== canonicalJson_ACU(fill.literal)) throw new Error(`fillStrategy literal 非法或与 SQL 不一致: ${name}`);
    const target = targetByName.get(name)!;
    if (fill.kind === 'ddl_literal_default' && canonicalJson_ACU(parsed) !== canonicalJson_ACU(parseDDLSafeDefaultLiteral_ACU(target.defaultExpression))) throw new Error(`ddl_literal_default 与目标 DDL DEFAULT 不一致: ${name}`);
  });
  if (Object.keys(fills).length !== added.length) throw new Error('每个新增 physical column 都必须有显式 fillStrategy。');

  const sourceForTarget = (targetName: string): string | undefined => sourceByName.has(targetName) ? targetName : mappedSource.get(targetName);
  for (const target of operation.targetSchema.columns.slice(1)) {
    const sourceName = sourceForTarget(target.physicalName);
    const declaredConversion = Array.isArray(operation.conversions)
      ? operation.conversions.find(item => item?.toPhysicalName === target.physicalName)
      : undefined;
    if (declaredConversion && declaredConversion.fromPhysicalName !== sourceName) throw new Error(`conversion source 与 physical mapping 不一致: ${target.physicalName}`);
    if (!sourceName) continue;
    const source = sourceByName.get(sourceName)!;
    const definitionChanged = getSemanticColumnDefinition_ACU(source) !== getSemanticColumnDefinition_ACU(target);
    const conversion = conversionByTarget.get(target.physicalName);
    if (definitionChanged && !conversion) throw new Error(`definition/type 变更缺少 conversion policy: ${target.physicalName}`);
    if (!definitionChanged && conversion) throw new Error(`未发生 definition/type 变更却提供 conversion: ${target.physicalName}`);
  }
  if (conversionByTarget.size !== Array.from(conversionByTarget).filter(([target]) => {
    const sourceName = sourceForTarget(target);
    return !!sourceName && getSemanticColumnDefinition_ACU(sourceByName.get(sourceName)!) !== getSemanticColumnDefinition_ACU(targetByName.get(target)!);
  }).length) throw new Error('conversion 必须且只能覆盖 definition/type 变更列。');

  const content: (string | null)[][] = [operation.targetSchema.headers.map(value => value == null ? null : String(value))];
  let convertedRowCount = 0;
  let lossyRowCount = 0;
  for (const row of currentSheet.content.slice(1)) {
    if (!Array.isArray(row)) continue;
    let rowLossy = false;
    const targetRow = operation.targetSchema.columns.map(target => {
      const sourceName = sourceForTarget(target.physicalName);
      if (!sourceName) return literalToCellValue_ACU(fills[target.physicalName].literal);
      const sourceIndex = sourceByName.get(sourceName)!.index;
      const policy = conversionByTarget.get(target.physicalName);
      if (!policy) return row[sourceIndex] == null ? null : String(row[sourceIndex]);
      const converted = convertCellValue_ACU(row[sourceIndex], policy);
      convertedRowCount += 1;
      rowLossy ||= converted.lossy;
      return converted.value;
    });
    if (rowLossy) lossyRowCount += 1;
    content.push(targetRow);
  }
  if (lossyRowCount > 0 && !operation.migrationPolicy?.lossyConversionConfirmed) throw new Error('有损 conversion 需要 lossyConversionConfirmed。');
  const actualDryRun = { convertedRowCount, failedRowCount: 0, lossyRowCount };
  if (verifyDryRun && canonicalJson_ACU(operation.dryRun) !== canonicalJson_ACU(actualDryRun)) throw new Error('schema migration V2 dryRun 与实际逐行转换不一致。');
  const sourceData = { ...currentSheet.sourceData, ddl: operation.targetSchema.ddl };
  return { sheet: { ...deepClone_ACU(currentSheet), uid: operation.targetSchema.uid, content, sourceData }, dryRun: actualDryRun };
}

/**
 * P2 reader/preflight constructor. Production writers remain frozen: this
 * function only creates an in-memory contract after running the same dry-run
 * checks that replay will later repeat.
 */
export async function buildSheetSchemaMigrationOperationV2_ACU(
  sheetKey: string,
  beforeSheet: Sheet_ACU,
  targetSheet: Sheet_ACU,
  options: Omit<TableSheetSchemaMigrateOperationV2Contract_ACU, 'kind' | 'contractVersion' | 'sheetKey' | 'beforeSchema' | 'targetSchema' | 'beforeSchemaDigest' | 'targetSchemaDigest' | 'dryRun'>,
): Promise<TableSheetSchemaMigrateOperationV2Contract_ACU> {
  if (!sheetKey.startsWith('sheet_')) throw new Error('schema migration V2 requires a sheet_ key.');
  const beforeSchema = getSheetSchemaDescriptorV2Contract_ACU(beforeSheet);
  const targetSchema = getSheetSchemaDescriptorV2Contract_ACU(targetSheet);
  const operation: TableSheetSchemaMigrateOperationV2Contract_ACU = {
    kind: 'sheet_schema_migrate',
    contractVersion: 2,
    sheetKey,
    beforeSchemaDigest: await getSchemaV2ContractDigest_ACU(beforeSchema),
    targetSchemaDigest: await getSchemaV2ContractDigest_ACU(targetSchema),
    beforeSchema,
    targetSchema,
    physicalColumnMappings: options.physicalColumnMappings,
    fills: options.fills,
    conversions: options.conversions,
    dryRun: { convertedRowCount: 0, failedRowCount: 0, lossyRowCount: 0 },
    migrationPolicy: options.migrationPolicy,
  };
  operation.dryRun = buildMigratedSheetV2_ACU(beforeSheet, operation, false).dryRun;
  return operation;
}

/**
 * Replays a schema migration onto a cloned complete table state. It validates
 * the persisted contract and then executes real SQLite DDL plus historical row
 * insertion before returning the candidate; the caller owns state commit.
 */
export async function applySheetSchemaMigrationOperation_ACU(
  currentState: TableDataObject_ACU,
  operation: TableSheetSchemaMigrateOperation_ACU,
): Promise<TableDataObject_ACU> {
  const currentSheet = currentState[operation.sheetKey] as Sheet_ACU | undefined;
  if (!currentSheet) throw new Error(`schema migration 缺少目标 sheet: ${operation.sheetKey}`);
  if (operation.contractVersion === 1) {
    assertOperationContract_ACU(currentSheet, operation);
    const beforeDigest = await sha256_ACU(canonicalJson_ACU(operation.beforeSchema));
    const targetDigest = await sha256_ACU(canonicalJson_ACU(operation.targetSchema));
    if (operation.beforeSchemaDigest !== beforeDigest || operation.targetSchemaDigest !== targetDigest) {
      throw new Error(`schema migration descriptor digest 不匹配: sheetKey=${operation.sheetKey}`);
    }
    const candidate = deepClone_ACU(currentState);
    candidate[operation.sheetKey] = buildMigratedSheet_ACU(currentSheet, operation.targetSchema);
    await hydrateTableDataStrict_ACU(candidate);
    return candidate;
  }
  if (operation.contractVersion !== 2) throw new Error(`schema migration contractVersion 不受支持: ${String((operation as any).contractVersion)}`);
  const beforeDigest = await sha256_ACU(canonicalJson_ACU(operation.beforeSchema));
  const targetDigest = await sha256_ACU(canonicalJson_ACU(operation.targetSchema));
  if (operation.beforeSchemaDigest !== beforeDigest || operation.targetSchemaDigest !== targetDigest) {
    throw new Error(`schema migration descriptor digest 不匹配: sheetKey=${operation.sheetKey}`);
  }
  const candidate = deepClone_ACU(currentState);
  candidate[operation.sheetKey] = buildMigratedSheetV2_ACU(currentSheet, operation).sheet;
  await hydrateTableDataStrict_ACU(candidate);
  return candidate;
}
