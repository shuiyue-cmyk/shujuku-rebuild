/**
 * service/template/chat-scope/chat-scope-range.ts — 模板范围（template scope range）
 *
 * 契约：模板只起指导作用。只有模板里声明的表与列参与填表、快照和 prompt；
 * 运行时数据里有但模板未声明的表与列休眠保留，不参与任何操作，也不删除。
 *
 * 设计约束：
 * - 本模块只做“范围解析”，不改写任何持久化数据。
 * - 范围无法解析时返回 null（“范围未知”），调用方必须退化为不过滤。
 *   绕不开的理由：把解析失败当成“什么都不参与”会直接造成数据静默写不进去。
 * - 保留边界 checkpoint / V2 回放等数据保全路径绝不得使用本模块过滤，
 *   否则休眠数据会随保留边界清理永久丢失。
 */
import type { Sheet_ACU, TableDataObject_ACU } from '../../../shared/models/table-data';
import { logWarn_ACU, parseTableTemplateJson_ACU } from '../../../shared/utils';
import { copyRuntimeEffectiveSchemaDescriptor_ACU, getSheetColumnProjection_ACU } from '../../../shared/ddl-utils';
import { getChatSheetGuideDataForIsolationKey_ACU } from './chat-scope-guide';

/** 模板范围。null 表示范围未知，调用方应退化为不过滤。 */
export type TemplateScope_ACU = {
  /** 模板声明的 sheetKey 集合。 */
  sheetKeys: Set<string>;
  /** 模板声明的表体，用于列级范围比对。 */
  sheets: Record<string, Sheet_ACU>;
} | null;

function collectScopeFromDataObject_ACU(dataObj: any): TemplateScope_ACU {
  if (!dataObj || typeof dataObj !== 'object') return null;
  const sheetKeys = new Set<string>();
  const sheets: Record<string, Sheet_ACU> = {};
  Object.keys(dataObj).forEach(key => {
    if (!key.startsWith('sheet_')) return;
    const sheet = dataObj[key];
    if (!sheet || typeof sheet !== 'object') return;
    sheetKeys.add(key);
    sheets[key] = sheet as Sheet_ACU;
  });
  if (sheetKeys.size === 0) return null;
  return { sheetKeys, sheets };
}

/**
 * 解析当前生效的模板范围。
 *
 * 优先用 sheet guide（它已处理 chat_override / preset_link / 全局的优先级），
 * 其次回退到全局模板 JSON。两者都拿不到时返回 null。
 */
export function resolveTemplateScope_ACU(isolationKey?: string): TemplateScope_ACU {
  try {
    const guideData = getChatSheetGuideDataForIsolationKey_ACU(isolationKey ?? '');
    const guideScope = collectScopeFromDataObject_ACU(guideData);
    if (guideScope) return guideScope;
  } catch (error) {
    logWarn_ACU('[TemplateScope] 读取 sheet guide 失败，尝试回退到全局模板。', error);
  }

  try {
    const templateObj = parseTableTemplateJson_ACU({ stripSeedRows: true });
    const templateScope = collectScopeFromDataObject_ACU(templateObj);
    if (templateScope) return templateScope;
  } catch (error) {
    logWarn_ACU('[TemplateScope] 解析全局模板失败，模板范围视为未知。', error);
  }

  return null;
}

/**
 * 按模板范围过滤 sheetKey 列表。范围未知时原样返回（不过滤）。
 */
export function filterSheetKeysByTemplateScope_ACU(
  sheetKeys: readonly string[],
  scope: TemplateScope_ACU,
): string[] {
  if (!scope) return [...sheetKeys];
  return sheetKeys.filter(sheetKey => scope.sheetKeys.has(sheetKey));
}

function collectDeclaredPhysicalNames_ACU(scopeSheet: Sheet_ACU): Set<string> {
  const declared = new Set<string>();
  try {
    getSheetColumnProjection_ACU(scopeSheet).columns.forEach(column => {
      if (column.physicalName) declared.add(column.physicalName.toLowerCase());
      if (column.header) declared.add(String(column.header).toLowerCase());
    });
  } catch (error) {
    logWarn_ACU('[TemplateScope] 无法解析模板表的列投影，该表列级范围视为未知。', error);
    return new Set<string>();
  }
  return declared;
}

/**
 * 计算运行时表中“模板未声明”的物理列名，用于合并进 hiddenPhysicalColumns。
 *
 * 返回空数组表示无需隐藏（含“范围未知”情形）。row_id 永不隐藏。
 */
export function resolveOutOfScopeColumns_ACU(sheet: Sheet_ACU, scopeSheet: Sheet_ACU | undefined | null): string[] {
  if (!sheet || !scopeSheet) return [];
  const declared = collectDeclaredPhysicalNames_ACU(scopeSheet);
  if (declared.size === 0) return [];

  let columns: ReturnType<typeof getSheetColumnProjection_ACU>['columns'];
  try {
    columns = getSheetColumnProjection_ACU(sheet).columns;
  } catch (error) {
    logWarn_ACU('[TemplateScope] 无法解析运行时表的列投影，跳过列级范围过滤。', error);
    return [];
  }

  const outOfScope: string[] = [];
  columns.forEach(column => {
    const physicalName = column.physicalName;
    if (!physicalName) return;
    if (physicalName.toLowerCase() === 'row_id') return;
    if (declared.has(physicalName.toLowerCase())) return;
    if (column.header && declared.has(String(column.header).toLowerCase())) return;
    outOfScope.push(physicalName);
  });
  return outOfScope;
}

/**
 * 为 prompt / 填表投影构造一份副本，把模板未声明的列合并进 hiddenPhysicalColumns。
 *
 * 不改写传入的 sheet；无需隐藏时直接返回原对象以避免无意义拷贝。
 */
export function projectSheetForTemplateScope_ACU(sheet: Sheet_ACU, scope: TemplateScope_ACU, sheetKey: string): Sheet_ACU {
  if (!scope) return sheet;
  const scopeSheet = scope.sheets[sheetKey];
  if (!scopeSheet) return sheet;
  const outOfScope = resolveOutOfScopeColumns_ACU(sheet, scopeSheet);
  if (outOfScope.length === 0) return sheet;

  const existingHidden = Array.isArray(sheet.sourceData?.hiddenPhysicalColumns)
    ? sheet.sourceData!.hiddenPhysicalColumns!.map(value => String(value ?? '')).filter(Boolean)
    : [];
  const merged: string[] = [];
  [...existingHidden, ...outOfScope].forEach(name => {
    if (!merged.some(value => value.toLowerCase() === name.toLowerCase())) merged.push(name);
  });

  const projected: Sheet_ACU = {
    ...sheet,
    sourceData: { ...sheet.sourceData, hiddenPhysicalColumns: merged },
  };
  // 对象展开不会复制 non-enumerable 的 `_acu_runtimeEffectiveSchema` descriptor；
  // 手动复制，使投影副本保留 SQLite 实际 schema 证据（不进入 JSON/persist）。
  copyRuntimeEffectiveSchemaDescriptor_ACU(sheet, projected as unknown as Record<string, unknown>);
  return projected;
}

/**
 * 按模板范围过滤一份运行时表数据，用于 prompt 投影。
 * 不得用于持久化写入或保留边界 checkpoint。
 */
export function projectTableDataForTemplateScope_ACU(
  tableData: TableDataObject_ACU,
  scope: TemplateScope_ACU,
): TableDataObject_ACU {
  if (!scope || !tableData || typeof tableData !== 'object') return tableData;
  const out: any = {};
  Object.keys(tableData).forEach(key => {
    if (!key.startsWith('sheet_')) {
      out[key] = (tableData as any)[key];
      return;
    }
    if (!scope.sheetKeys.has(key)) return;
    out[key] = projectSheetForTemplateScope_ACU((tableData as any)[key], scope, key);
  });
  return out as TableDataObject_ACU;
}


// SQL 活动模板判定（非首列空业务表头 → 休眠跳过）在 shared 层实现，
// 供 data 层（sync-bridge hydrate 跳过休眠表）与 service 层共用同一判定源。
export {
    findEmptyBusinessHeaderIndexes_ACU,
    isSqlActiveTemplateSheet_ACU,
    projectSqlActiveTemplateData_ACU,
} from '../../../shared/sql-active-template';
