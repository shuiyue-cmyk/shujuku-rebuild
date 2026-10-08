/**
 * 表级 API 预设覆盖按表名存储（settings_ACU.tableApiPresetOverridesByName）。
 * R10A-14：可视化器里的改名只是草稿，覆盖不能在改名那一刻迁移；
 * 模板提交成功后再按「已保存的旧名 → 新名」统一迁移。
 */
import { settings_ACU } from '../../../service/runtime/state-manager';
import { saveSettings_ACU } from '../../../service/settings/settings-service';

type SheetMap = Record<string, any> | null | undefined;

export function migrateTableApiPresetOverridesForRenames_ACU(base: SheetMap, next: SheetMap): void {
  const overrides = settings_ACU.tableApiPresetOverridesByName as Record<string, string> | undefined;
  if (!overrides || typeof overrides !== 'object' || !base || !next) return;

  const renames: Array<{ oldName: string; newName: string }> = [];
  for (const key of Object.keys(next)) {
    if (!key.startsWith('sheet_')) continue;
    const oldName = String(base[key]?.name ?? '').trim();
    const newName = String(next[key]?.name ?? '').trim();
    if (oldName && newName && oldName !== newName && Object.prototype.hasOwnProperty.call(overrides, oldName)) {
      renames.push({ oldName, newName });
    }
  }
  if (renames.length === 0) return;

  const snapshot = { ...overrides };
  const vacatedNames = new Set(renames.map(item => item.oldName));
  // 新名正被另一张未改走的表占用：不覆盖它，这一项保持原样（旧名上的覆盖也不丢）
  const applicable = renames.filter(({ newName }) => !Object.prototype.hasOwnProperty.call(snapshot, newName) || vacatedNames.has(newName));
  if (applicable.length === 0) return;
  for (const { oldName } of applicable) delete overrides[oldName];
  for (const { oldName, newName } of applicable) overrides[newName] = snapshot[oldName];
  saveSettings_ACU();
}

/** 已保存模板中的表名：覆盖按它读写，草稿改名不影响当前生效的覆盖。 */
export function persistedSheetNameForOverrides_ACU(base: SheetMap, sheetKey: string | null | undefined, draftName: unknown): string {
  const persisted = sheetKey && base ? String(base[sheetKey]?.name ?? '').trim() : '';
  return persisted || String(draftName ?? '').trim();
}
