/** 数据库编辑器（v3）数据视图的纯布局计算：短字段并排、分页窗口。 */

export const VIZ_PAGE_SIZE = 30;
const SHORT_FIELD_CHAR_LIMIT = 24;

/** 单行且不超过 24 个字（连续空白按一个算）视为短字段，可与相邻短字段并排。 */
export function isShortDataField(value: string): boolean {
  const normalized = String(value || '').trim();
  if (normalized.includes('\n') || normalized.includes('\r')) return false;
  return Array.from(normalized.replace(/\s+/g, ' ')).length <= SHORT_FIELD_CHAR_LIMIT;
}

export interface FieldRow<T> {
  key: string;
  wide: boolean;
  fields: T[];
}

/** 相邻两列都短就并成一排，否则独占一排；isShort 与 fields 按下标对应。 */
export function pairFieldRows<T extends { columnIndex: number }>(fields: T[], isShort: boolean[]): FieldRow<T>[] {
  const rows: FieldRow<T>[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const next = fields[index + 1];
    if (next && isShort[index] === true && isShort[index + 1] === true) {
      rows.push({ key: `${field.columnIndex}-${next.columnIndex}`, wide: false, fields: [field, next] });
      index += 1;
    } else {
      rows.push({ key: String(field.columnIndex), wide: true, fields: [field] });
    }
  }
  return rows;
}

export interface PageWindow {
  page: number;
  pageCount: number;
  /** 本页第一行的数据行下标（不含表头）。 */
  start: number;
  /** 本页最后一行之后的数据行下标。 */
  end: number;
}

export function pageWindow(rowCount: number, requestedPage: number, pageSize = VIZ_PAGE_SIZE): PageWindow {
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const raw = Math.trunc(Number(requestedPage));
  const page = Number.isFinite(raw) ? Math.min(pageCount, Math.max(1, raw)) : 1;
  const start = Math.min(rowCount, (page - 1) * pageSize);
  return { page, pageCount, start, end: Math.min(rowCount, start + pageSize) };
}
