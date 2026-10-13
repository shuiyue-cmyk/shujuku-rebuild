/**
 * service/agent/agent-favorite-worldbooks.ts — 常用世界书（用户需求）
 *
 * 用户把几本 skill 化的世界书设为「常用」，换新角色卡时一键复制成「角色卡名-原书名」并挂成该卡的
 * 附加世界书，免去手动复制、改名、挂载。副本与常用书互相独立：每张卡的 Agent 接管、手改互不影响。
 * 名单存插件设置（所有角色卡共用）。
 */
import { settings_ACU } from '../runtime/state-manager';
import { saveSettings_ACU } from '../settings/settings-service';
import { getLorebookEntries_ACU } from '../../data/gateways/worldbook-gateway';
import {
  addAuxWorldbookToCurrentCharacter_ACU,
  getCurrentSingleCharacter_ACU,
  listWorldbookNamesLive_ACU,
  loadWorldbookFile_ACU,
  saveWorldbookFile_ACU,
  type AuxWorldbookBindResult_ACU,
} from '../../data/gateways/worldbook-file-gateway';
import { isWorldbookEntrySkillifyCandidate_ACU } from './agent-skillify-service';
import { hasUsableWorldbookSkillMeta_ACU } from './agent-worldbook-skill-meta';
import { isDatabaseGeneratedLorebookEntry_ACU } from '../worldbook/worldbook-placeholder-classification';

const FAVORITE_WORLDBOOKS_KEY_ACU = 'agentFavoriteWorldbooks';

export interface FavoriteWorldbookSkillStatus_ACU {
  bookName: string;
  exists: boolean;
  /** 可 skill 化的条目数（排除关闭、常驻、数据库生成的）。 */
  candidateCount: number;
  /** 其中已带 skill 元数据的条目数。 */
  skilledCount: number;
}

export type FavoriteExistingCopyDecision_ACU = 'keep' | 'overwrite' | 'skip';

export interface FavoriteMountItemResult_ACU {
  sourceName: string;
  targetName: string;
  copy: 'created' | 'overwritten' | 'kept' | 'skipped' | 'failed';
  binding: AuxWorldbookBindResult_ACU | 'failed' | 'not_attempted';
  reason?: string;
}

export type FavoriteMountResult_ACU =
  | { ok: true; characterName: string; results: FavoriteMountItemResult_ACU[] }
  | { ok: false; reason: 'no_character' };

export function normalizeFavoriteWorldbookNames_ACU(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw
    .filter((name): name is string => typeof name === 'string')
    .map(name => name.trim())
    .filter(Boolean))];
}

export function readFavoriteWorldbookNames_ACU(): string[] {
  return normalizeFavoriteWorldbookNames_ACU((settings_ACU as any)?.[FAVORITE_WORLDBOOKS_KEY_ACU]);
}

export function writeFavoriteWorldbookNames_ACU(names: unknown): string[] {
  const normalized = normalizeFavoriteWorldbookNames_ACU(names);
  (settings_ACU as any)[FAVORITE_WORLDBOOKS_KEY_ACU] = normalized;
  saveSettings_ACU();
  return normalized;
}

function sanitizeWorldbookNamePart_ACU(text: string): string {
  // 宿主按文件名保存世界书：先替换文件名不允许的字符，保证挂载用的名字与实际文件名一致。
  return String(text || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .replace(/[.\s]+$/, '');
}

/** 副本名：角色卡名-原书名（用户决定）。 */
export function buildMountedWorldbookName_ACU(characterName: string, bookName: string): string {
  return `${sanitizeWorldbookNamePart_ACU(characterName)}-${sanitizeWorldbookNamePart_ACU(bookName)}`;
}

function isAgentRuntimeEntry_ACU(entry: Record<string, any>): boolean {
  const comment = String(entry?.comment ?? '').trim();
  // 数据库生成条目与 Agent 每卡状态（配置、快照、绿灯）都不属于常用书内容，复制会把别的卡的状态带过来。
  return comment.startsWith('TavernDB-ACU-') || isDatabaseGeneratedLorebookEntry_ACU(entry);
}

/** 复制用的世界书数据：深拷贝，去掉数据库生成与 Agent 状态条目。 */
export function buildFavoriteWorldbookCopyData_ACU(data: Record<string, any>): Record<string, any> {
  const copy = structuredClone(data);
  const entries = copy?.entries && typeof copy.entries === 'object' ? copy.entries : {};
  copy.entries = Object.fromEntries(Object.entries(entries)
    .filter(([, entry]) => entry && typeof entry === 'object' && !isAgentRuntimeEntry_ACU(entry as Record<string, any>)));
  return copy;
}

export async function readFavoriteWorldbookSkillStatus_ACU(bookName: string): Promise<FavoriteWorldbookSkillStatus_ACU> {
  const names = await listWorldbookNamesLive_ACU();
  if (!names.includes(bookName)) return { bookName, exists: false, candidateCount: 0, skilledCount: 0 };
  const candidates = (await getLorebookEntries_ACU(bookName)).filter(entry => isWorldbookEntrySkillifyCandidate_ACU(entry));
  return {
    bookName,
    exists: true,
    candidateCount: candidates.length,
    skilledCount: candidates.filter(entry => hasUsableWorldbookSkillMeta_ACU(entry?.comment)).length,
  };
}

function errorText_ACU(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 把选中的常用书复制成当前角色卡的副本并挂成附加世界书。逐本处理、一本失败不影响其他本。
 * 副本已存在时由 resolveExisting 决定保留 / 覆盖 / 跳过（用户决定：每次都问）。
 */
export async function mountFavoriteWorldbooksToCurrentCharacter_ACU(
  bookNames: string[],
  options: { resolveExisting: (targetName: string, sourceName: string) => Promise<FavoriteExistingCopyDecision_ACU> },
): Promise<FavoriteMountResult_ACU> {
  const character = getCurrentSingleCharacter_ACU();
  if (!character) return { ok: false, reason: 'no_character' };

  const results: FavoriteMountItemResult_ACU[] = [];
  for (const sourceName of normalizeFavoriteWorldbookNames_ACU(bookNames)) {
    const targetName = buildMountedWorldbookName_ACU(character.name, sourceName);
    const item: FavoriteMountItemResult_ACU = { sourceName, targetName, copy: 'failed', binding: 'not_attempted' };
    results.push(item);
    try {
      const existingNames = await listWorldbookNamesLive_ACU();
      let decision: FavoriteExistingCopyDecision_ACU | 'create' = 'create';
      if (existingNames.includes(targetName)) decision = await options.resolveExisting(targetName, sourceName);
      if (decision === 'skip') {
        item.copy = 'skipped';
        continue;
      }
      if (decision === 'keep') {
        item.copy = 'kept';
      } else {
        const source = existingNames.includes(sourceName) ? await loadWorldbookFile_ACU(sourceName) : null;
        if (!source) {
          item.reason = `找不到常用世界书「${sourceName}」，可能已被删除或改名。`;
          continue;
        }
        await saveWorldbookFile_ACU(targetName, buildFavoriteWorldbookCopyData_ACU(source));
        if (!(await listWorldbookNamesLive_ACU()).includes(targetName)) {
          item.reason = `副本「${targetName}」保存后没有出现在世界书列表里。`;
          continue;
        }
        item.copy = decision === 'overwrite' ? 'overwritten' : 'created';
      }
    } catch (error) {
      item.reason = errorText_ACU(error);
      continue;
    }
    try {
      item.binding = await addAuxWorldbookToCurrentCharacter_ACU(character, targetName);
    } catch (error) {
      item.binding = 'failed';
      item.reason = errorText_ACU(error);
    }
  }
  return { ok: true, characterName: character.name, results };
}
