/**
 * shared/sheet-identity-merge.ts — 两代 sheetKey 身份归并（纯函数）
 *
 * spv7.9 及更早版本使用随机 hash 风格的 sheetKey；spv8.4+ 使用按显示名
 * 拼音生成的稳定 key。同一张表（canonical 显示名相同）在旧 checkpoint 与
 * 新模板/指导表中各持有一个 key 时，SQLite 物理表名解析会抛
 * PhysicalTableNameCollisionError_ACU（reason=identity_merge_failed）。
 *
 * 本模块在**内存回放副本**上把同名的两代 key 归并为一个：优先保留当前
 * 模板/指导表侧 key，旧 key 的数据按 row_id 并入（winner 同 id 胜出、
 * loser 独有行追加，与旧版逐楼覆盖语义一致）。纯函数、幂等、无 IO，
 * 不修改任何持久化 storage frame。
 */
import type { Sheet_ACU, TableDataObject_ACU } from './models/table-data';
import { buildStableSheetKeyCandidate_ACU, canonicalizeDisplayName_ACU } from './sheet-identity';

export interface SheetIdentityRemap_ACU {
  /** 被并入并删除的旧 key。 */
  fromKey: string;
  /** 归并后保留的 key。 */
  toKey: string;
  canonicalName: string;
  /** loser 中与 winner 同 row_id 的行数（winner 胜出，loser 行被覆盖语义丢弃）。 */
  overriddenRows: number;
  /** loser 中被追加进 winner 的独有行数。 */
  appendedRows: number;
}

export interface SheetIdentityMergeResult_ACU {
  changed: boolean;
  remaps: SheetIdentityRemap_ACU[];
}

function isSheetLike_ACU(value: unknown): value is Sheet_ACU {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function collectRowIds_ACU(content: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (let index = 1; index < content.length; index += 1) {
    const row = content[index];
    if (!Array.isArray(row)) continue;
    const id = String(row[0] ?? '').trim();
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * 从同 canonical 名的候选 key 中选出保留者（确定性）：
 * 1. preferredKeys（当前模板/指导表侧 key）命中者优先；
 * 2. 等于按显示名生成的新版稳定 key 候选者次之；
 * 3. 否则按 key 字典序取首位。
 */
function pickWinnerKey_ACU(
  keys: readonly string[],
  canonicalName: string,
  sheets: ReadonlyMap<string, Sheet_ACU>,
  preferredKeys: ReadonlySet<string>,
): string {
  const sorted = [...keys].sort();
  const preferred = sorted.find(key => preferredKeys.has(key));
  if (preferred) return preferred;
  const stableCandidate = sorted.find(key => {
    const sheet = sheets.get(key);
    return buildStableSheetKeyCandidate_ACU(sheet?.name ?? canonicalName) === key;
  });
  if (stableCandidate) return stableCandidate;
  return sorted[0];
}

/**
 * 归并 state 中 canonical 显示名相同但 sheetKey 不同的表。
 *
 * 原地修改 state（回放路径持有的都是内存副本），返回 remap 记录。
 * 对没有冲突的数据是纯 no-op（changed=false），可在回放的任意状态
 * 变化点重复调用。
 */
export function mergeLegacySheetIdentities_ACU(
  state: TableDataObject_ACU,
  preferredKeysArg?: readonly string[] | null,
): SheetIdentityMergeResult_ACU {
  const remaps: SheetIdentityRemap_ACU[] = [];
  const preferredKeys = new Set(preferredKeysArg || []);
  const sheets = new Map<string, Sheet_ACU>();
  const groups = new Map<string, string[]>();

  for (const sheetKey of Object.keys(state)) {
    if (!sheetKey.startsWith('sheet_')) continue;
    const sheet = (state as Record<string, unknown>)[sheetKey];
    if (!isSheetLike_ACU(sheet)) continue;
    const canonicalName = canonicalizeDisplayName_ACU((sheet as Sheet_ACU).name);
    if (!canonicalName) continue;
    sheets.set(sheetKey, sheet as Sheet_ACU);
    const group = groups.get(canonicalName) || [];
    group.push(sheetKey);
    groups.set(canonicalName, group);
  }

  for (const [canonicalName, keys] of groups) {
    if (keys.length < 2) continue;
    const winnerKey = pickWinnerKey_ACU(keys, canonicalName, sheets, preferredKeys);
    const winner = sheets.get(winnerKey)!;
    for (const loserKey of keys) {
      if (loserKey === winnerKey) continue;
      const loser = sheets.get(loserKey)!;
      let overriddenRows = 0;
      let appendedRows = 0;

      const winnerHasContent = Array.isArray(winner.content) && winner.content.length > 0;
      const loserHasContent = Array.isArray(loser.content) && loser.content.length > 0;
      if (!winnerHasContent && loserHasContent) {
        // winner 侧无可用 content（如 header 丢失）：整体采纳 loser 的 content。
        winner.content = loser.content;
        appendedRows = loser.content.length > 0 ? loser.content.length - 1 : 0;
      } else if (winnerHasContent && loserHasContent) {
        const winnerIds = collectRowIds_ACU(winner.content);
        for (let index = 1; index < loser.content.length; index += 1) {
          const row = loser.content[index];
          if (!Array.isArray(row)) continue;
          const rowId = String(row[0] ?? '').trim();
          if (rowId && winnerIds.has(rowId)) {
            // 同 row_id：winner（当前/模板侧，写入更晚）胜出。
            overriddenRows += 1;
            continue;
          }
          winner.content.push(row);
          if (rowId) winnerIds.add(rowId);
          appendedRows += 1;
        }
      }

      const winnerSeedRows = (winner as any).seedRows;
      const loserSeedRows = (loser as any).seedRows;
      if ((!Array.isArray(winnerSeedRows) || winnerSeedRows.length === 0)
        && Array.isArray(loserSeedRows) && loserSeedRows.length > 0) {
        (winner as any).seedRows = loserSeedRows;
      }
      if ((winner as any).sourceData === undefined && (loser as any).sourceData !== undefined) {
        (winner as any).sourceData = (loser as any).sourceData;
      }

      delete (state as Record<string, unknown>)[loserKey];
      sheets.delete(loserKey);
      remaps.push({ fromKey: loserKey, toKey: winnerKey, canonicalName, overriddenRows, appendedRows });
    }
  }

  return { changed: remaps.length > 0, remaps };
}
