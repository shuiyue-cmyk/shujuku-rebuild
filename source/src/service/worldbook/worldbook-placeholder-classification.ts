import { ensureExportConfigDefaults_ACU } from './injection-engine-config';

export const EXTERNAL_CUSTOM_TABLE_EXPORT_MARKER_VERSION_ACU = 1;
const MARKER_PATTERN_ACU = /<!--\s*ACU_CUSTOM_TABLE_EXPORT_V1\s+({[\s\S]*?})\s*-->/;

export interface ExternalCustomTableExportMarker_ACU {
  version: 1;
  kind: 'custom_table_export';
  sheetKey: string;
  tableName: string;
  entryName: string;
  role: 'main' | 'row' | 'header' | 'wrapper_before' | 'wrapper_after' | 'index';
  rowIndex?: number;
}

export function buildExternalCustomTableExportComment_ACU(
  comment: string,
  marker: ExternalCustomTableExportMarker_ACU,
): string {
  return `${String(comment || '').trim()}\n<!-- ACU_CUSTOM_TABLE_EXPORT_V1 ${JSON.stringify(marker)} -->`;
}

export function parseExternalCustomTableExportMarker_ACU(comment: unknown): ExternalCustomTableExportMarker_ACU | null {
  const match = String(comment || '').match(MARKER_PATTERN_ACU);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]) as Record<string, unknown>;
    const role = String(value.role || '');
    const validRoles = new Set(['main', 'row', 'header', 'wrapper_before', 'wrapper_after', 'index']);
    if (value.version !== EXTERNAL_CUSTOM_TABLE_EXPORT_MARKER_VERSION_ACU
      || value.kind !== 'custom_table_export'
      || !validRoles.has(role)
      || !['sheetKey', 'tableName', 'entryName'].every(key => typeof value[key] === 'string' && value[key].trim())) return null;
    const rowIndex = Number(value.rowIndex);
    return {
      version: 1,
      kind: 'custom_table_export',
      sheetKey: String(value.sheetKey).trim(),
      tableName: String(value.tableName).trim(),
      entryName: String(value.entryName).trim(),
      role: role as ExternalCustomTableExportMarker_ACU['role'],
      ...(Number.isInteger(rowIndex) && rowIndex > 0 ? { rowIndex } : {}),
    };
  } catch {
    return null;
  }
}

export function isExternalImportLorebookEntry_ACU(entry: Record<string, any>): boolean {
  const raw = String(entry?.comment || entry?.name || '').trim().replace(/^ACU-\[[^\]]+\]-/, '');
  return raw.startsWith('外部导入-');
}

function normalizeInternalComment_ACU(entry: Record<string, any>): string {
  return String(entry?.comment || entry?.name || '')
    .replace(MARKER_PATTERN_ACU, '')
    .trim()
    .replace(/^ACU-\[[^\]]+\]-/, '');
}

export function isDatabaseGeneratedLorebookEntry_ACU(entry: Record<string, any>): boolean {
  if (isExternalImportLorebookEntry_ACU(entry)) return false;
  const comment = normalizeInternalComment_ACU(entry);
  if (!comment || comment.startsWith('TavernDB-ACU-AgentGreenlight')) return false;
  if (['TavernDB-ACU-AgentWorldbookConfig', 'TavernDB-ACU-AgentWorldbookSnapshot', 'TavernDB-ACU-AgentFinalGenerationGreenlights'].some(prefix => comment.startsWith(prefix))) return true;
  return ['TavernDB-ACU-', '重要人物条目', '总结条目', '小总结条目'].some(prefix => comment.startsWith(prefix));
}

export function isSplitByRowTable_ACU(tableName: string, tableData: Record<string, any>): boolean {
  const matches = Object.values(tableData || {}).filter((table: any) => table && typeof table === 'object' && String(table.name || '').trim() === String(tableName || '').trim());
  return matches.length === 1 && ensureExportConfigDefaults_ACU((matches[0] as any).exportConfig, tableName).splitByRow === true;
}

export interface TableExportIdentity_ACU {
  sheetKey: string;
  tableName: string;
  entryName: string;
  extraIndexEntryName: string | null;
  extraIndexEnabled: boolean;
}

/**
 * 解析表导出唯一身份：唯一 table name、唯一 entryName、sheetKey 与 marker 所需身份一次解析。
 * tableName 在 tableData 中必须唯一；entryName 在全部表中必须唯一，否则拒绝（无法证明唯一所有权）。
 * 供剧情与填表在任何世界书条目 I/O 前调用，避免为无效/歧义表名触发读取。
 */
export function resolveUniqueTableExportIdentity_ACU(tableName: string, tableData: Record<string, any>): TableExportIdentity_ACU | null {
  const normalizedTableName = String(tableName || '').trim();
  if (!normalizedTableName || !tableData || typeof tableData !== 'object') return null;
  const matched = Object.entries(tableData).filter(([, table]: any) => (
    table && typeof table === 'object' && String(table.name || '').trim() === normalizedTableName
  ));
  if (matched.length !== 1) return null;
  const [sheetKey, table] = matched[0] as [string, any];
  const config = ensureExportConfigDefaults_ACU(table.exportConfig, table.name || sheetKey);
  const entryName = String(config.entryName || table.name || '').trim();
  if (!entryName) return null;
  const sameEntryNameCount = Object.values(tableData || {}).filter((candidate: any) => {
    if (!candidate || typeof candidate !== 'object' || !candidate.exportConfig) return false;
    const candidateConfig = ensureExportConfigDefaults_ACU(candidate.exportConfig, candidate.name || '');
    return String(candidateConfig.entryName || candidate.name || '').trim() === entryName;
  }).length;
  if (sameEntryNameCount !== 1) return null;
  const extraIndexEntryName = String(config.extraIndexEntryName || '').trim() || null;
  return { sheetKey, tableName: String(table.name || '').trim(), entryName, extraIndexEntryName, extraIndexEnabled: config.extraIndexEnabled === true };
}

export function resolveGeneratedEntriesForTable_ACU(entries: Record<string, any>[], tableName: string, tableData: Record<string, any>): Record<string, any>[] {
  const matched = Object.entries(tableData || {}).filter(([, table]: any) => table && typeof table === 'object' && String(table.name || '').trim() === String(tableName || '').trim());
  if (matched.length !== 1) return [];
  const [sheetKey, table] = matched[0] as [string, any];
  const config = ensureExportConfigDefaults_ACU(table.exportConfig, table.name || sheetKey);
  const entryName = String(config.entryName || table.name || '').trim();
  if (!entryName) return [];
  const sameEntryNameCount = Object.values(tableData || []).filter((candidate: any) => {
    if (!candidate || typeof candidate !== 'object' || !candidate.exportConfig) return false;
    const candidateConfig = ensureExportConfigDefaults_ACU(candidate.exportConfig, candidate.name || '');
    return String(candidateConfig.entryName || candidate.name || '').trim() === entryName;
  }).length;
  if (sameEntryNameCount !== 1) return [];
  const escapedEntryName = entryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mainCommentPattern = new RegExp(`^TavernDB-ACU-CustomExport-${escapedEntryName}(?:-(?:表头|包裹-上|包裹-下|[1-9]\\d*))?$`);
  const extraIndexEntryName = String(config.extraIndexEntryName || '').trim();
  const escapedIndexName = extraIndexEntryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const indexCommentPattern = config.extraIndexEnabled === true && extraIndexEntryName
    ? new RegExp(`^TavernDB-ACU-CustomExport-${escapedIndexName}$`)
    : null;
  return (entries || []).filter(entry => {
    const marker = parseExternalCustomTableExportMarker_ACU(entry?.comment || entry?.name);
    if (marker) return marker.sheetKey === sheetKey && marker.tableName === table.name && marker.entryName === entryName;
    if (isExternalImportLorebookEntry_ACU(entry)) return false;
    const comment = normalizeInternalComment_ACU(entry);
    return mainCommentPattern.test(comment) || !!indexCommentPattern?.test(comment);
  });
}
