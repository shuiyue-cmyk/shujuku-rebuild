import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { logWarn_ACU } from '../../shared/utils';

interface TableFillCommit_ACU {
  before: TableDataObject_ACU | null;
  after: TableDataObject_ACU;
  sheetKeys: readonly string[] | null;
}

const listeners = new Set<(event: TableFillCommit_ACU) => void>();

export function onTableFillCommitted_ACU(listener: (event: TableFillCommit_ACU) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyTableFillCommitted_ACU(event: TableFillCommit_ACU): void {
  for (const listener of listeners) {
    try { listener(event); } catch (error) { logWarn_ACU('[填表] 保存完成后的订阅失败。', error); }
  }
}
