/**
 * shared/sql-active-template.ts — SQL 活动模板判定（非首列空业务表头 → 休眠跳过）
 *
 * 语义：除第一列身份占位（row_id）外，只要任意业务列表头为空，该模板表在 SQL 活动路径中
 * 视为不存在：不建表、不进 Prompt、不参与调度与提交授权。既有物理表与历史数据保留，
 * 修正表头后可在后续请求恢复参与。
 *
 * 判定范围：仅检查 sheet.content[0]（表头行）的第 2 列及以后。
 * 值为 null / undefined / 空字符串 / NFKC+trim 后为空白，都视为无效业务表头。
 *
 * 首列例外：content[0][0] 为 null/undefined 是可视化编辑器的 row_id 身份占位，
 * 不当作空业务列（与 mapSqlColumnIdentifiers_ACU 的空值语义一致）。
 *
 * 边界：表头非数组 / 缺失 / 只有首列（无业务列）不归入“非首列空表头”判定，
 * 仍交由既有严格错误路径处理；本模块返回 []（不跳过）。
 */
import type { Sheet_ACU, TableDataObject_ACU } from './models/table-data';

/** 返回空业务表头的 1-based 列号（第 2 列及以后）。无空表头返回 []。 */
export function findEmptyBusinessHeaderIndexes_ACU(sheet: Sheet_ACU | null | undefined): number[] {
  if (!sheet || typeof sheet !== 'object') return [];
  const headerRow = sheet.content?.[0];
  if (!Array.isArray(headerRow)) return [];
  const emptyIndexes: number[] = [];
  for (let index = 1; index < headerRow.length; index += 1) {
    const value = headerRow[index];
    const isEmpty = value === null || value === undefined
      || String(value).normalize('NFKC').trim() === '';
    if (isEmpty) emptyIndexes.push(index + 1); // 1-based 列号
  }
  return emptyIndexes;
}

/** 判断一张模板表在 SQL 活动路径中是否有效（非首列空表头 → false）。DDL 有无不改变判定。 */
export function isSqlActiveTemplateSheet_ACU(sheet: Sheet_ACU | null | undefined): boolean {
  return findEmptyBusinessHeaderIndexes_ACU(sheet).length === 0;
}

/**
 * 从模板数据对象中投影出“SQL 活动表”子集：非 sheet_* 元数据原样保留，
 * 非首列空表头的模板表被剔除（休眠）。不修改传入对象。
 * 返回 { data, skippedSheets }，skippedSheets 只含 sheetKey/显示名/空列序号（脱敏）。
 */
export function projectSqlActiveTemplateData_ACU(data: TableDataObject_ACU | null | undefined): {
  data: TableDataObject_ACU;
  skippedSheets: Array<{ sheetKey: string; name: string; emptyHeaderIndexes: number[] }>;
} {
  if (!data || typeof data !== 'object') {
    return { data: (data || {}) as TableDataObject_ACU, skippedSheets: [] };
  }
  const out: any = {};
  const skippedSheets: Array<{ sheetKey: string; name: string; emptyHeaderIndexes: number[] }> = [];
  Object.keys(data).forEach(key => {
    const value = (data as any)[key];
    if (!key.startsWith('sheet_')) {
      out[key] = value;
      return;
    }
    const emptyHeaderIndexes = findEmptyBusinessHeaderIndexes_ACU(value);
    if (emptyHeaderIndexes.length > 0) {
      skippedSheets.push({
        sheetKey: key,
        name: String((value as any)?.name ?? key),
        emptyHeaderIndexes,
      });
      return;
    }
    out[key] = value;
  });
  return { data: out as TableDataObject_ACU, skippedSheets };
}
