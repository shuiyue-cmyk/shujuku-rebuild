/**
 * service/biotracker/silent-migration.ts — 内置生理追踪数据一次性静默迁移
 *
 * 背景：数据库已剥离内置 biotracker，存量用户的数据留在 settings_ACU.bs_biotracker
 * （chatStates: chatKey → chatState）。本模块把它转写成上游 st_bs_biotracker 可读的
 * 形态，让用户平移到上游 tracker。仅运行一次（全局/按聊天双重打标），全程静默（仅 logDebug）。
 *
 * 口径（用户拍板 2026-08-26）：
 * - 目标端两栖：TT/Luker 写上游 per-chat sidecar（bs-biotracker/chat-state-v1，句柄仅当前聊天可达
 *   → 「打开即迁」：当前聊天迁一次并按聊天打永久标）；SillyTavern 网页端写
 *   extensionSettings.bs_biotracker.chatStates（启动时全量一次）。
 * - 完整度：按 (聊天×角色) 逐角色序列化体积比，严格大于才用我们的，平局/更小一律用上游；
 *   chatState 其他顶层字段同口径逐项比。
 * - 范围：整个 chatState（characters / skillCatalog / snapshots / 重填进度等）。
 */

import { settings_ACU } from '../runtime/state-manager';
import { isSettingsStorageReadyForSave_ACU } from '../settings/settings-service';
import { logDebug_ACU } from '../../shared/utils';
import {
  getHostContext,
  getHostExtensionSettings,
  getHostKind,
  isHostChatStateConfirmed,
  loadHostChatState,
  resolveHostChatId,
  saveHostSettings,
  scheduleHostChatStateSave,
} from './host-bridge';

const DONE_FLAG_KEY = 'acu-bs-silent-migration-done';
const CHAT_DONE_PREFIX = 'acu-bs-silent-migration-chat:';

function isGlobalDone(): boolean {
  try { return localStorage.getItem(DONE_FLAG_KEY) === '1'; } catch { return false; }
}

function markGlobalDone(): void {
  try { localStorage.setItem(DONE_FLAG_KEY, '1'); } catch {}
}

function isChatDone(chatKey: string): boolean {
  try { return localStorage.getItem(CHAT_DONE_PREFIX + chatKey) === '1'; } catch { return false; }
}

function markChatDone(chatKey: string): void {
  try { localStorage.setItem(CHAT_DONE_PREFIX + chatKey, '1'); } catch {}
}

/** 序列化体积：完整度的比较口径（undefined/null 记 0） */
function serializeSize(value: unknown): number {
  if (value === undefined || value === null) return 0;
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? text.length : 0;
  } catch {
    return 0;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 数据是否有迁移价值：完全没有角色/技能/快照的空壳不迁移，也不覆盖上游 */
function hasMeaningfulData(chatState: unknown): boolean {
  if (!isPlainRecord(chatState)) return false;
  if (isPlainRecord(chatState.characters) && Object.keys(chatState.characters).length > 0) return true;
  if (Array.isArray(chatState.skillCatalog) && chatState.skillCatalog.length > 0) return true;
  if (Array.isArray(chatState.snapshots) && chatState.snapshots.length > 0) return true;
  return false;
}

/**
 * 合并单个 chatState：完整度规则逐项取舍。
 * - characters：按角色名逐个比体积，严格大于才用我们的，平局/更小用上游；两侧并集
 * - 其余顶层字段：我们的体积严格大于上游才用我们的（上游缺失=0，我们的非空即胜出）
 * - 仅一侧存在：取存在的一侧
 */
function mergeChatState(ours: Record<string, unknown>, upstream: Record<string, unknown> | null): Record<string, unknown> {
  if (!isPlainRecord(ours)) return isPlainRecord(upstream) ? upstream : {};
  if (!isPlainRecord(upstream)) return ours;

  const merged: Record<string, unknown> = { ...upstream };

  const ourCharacters = isPlainRecord(ours.characters) ? ours.characters : {};
  const upstreamCharacters = isPlainRecord(upstream.characters) ? upstream.characters : {};
  const mergedCharacters: Record<string, unknown> = { ...upstreamCharacters };
  for (const [name, ourChar] of Object.entries(ourCharacters)) {
    // 严格大于才用我们的；平局/更小用上游。上游缺失时体积为 0，我们的非空数据自然胜出（保数据优先）
    if (serializeSize(ourChar) > serializeSize(upstreamCharacters[name])) {
      mergedCharacters[name] = ourChar;
    }
  }
  merged.characters = mergedCharacters;

  for (const [key, ourValue] of Object.entries(ours)) {
    if (key === 'characters') continue;
    if (serializeSize(ourValue) > serializeSize(upstream[key])) {
      merged[key] = ourValue;
    }
  }
  return merged;
}

/** TT/Luker：迁移当前聊天（打开即迁，按聊天键打永久标） */
async function migrateCurrentChatInHostedKind(): Promise<void> {
  const ctx = getHostContext();
  // [加载门控] 用显式的 settings 可靠加载信号，而不是 chatStates 形状代理——
  // IDB 加载窗口内适配层可能已把空 chatStates 物化出来，形状判断会误标完成。
  if (!isSettingsStorageReadyForSave_ACU()) {
    logDebug_ACU('[生物追踪迁移] 设置尚未完成可靠加载，本轮跳过（不打标）。');
    return;
  }
  const chatKey = await resolveHostChatId(ctx);
  if (!chatKey) return;
  if (isChatDone(chatKey)) return;

  // [加载门控] 已由显式 settings 可靠加载信号把关；此处不再用 chatStates 形状代理
  const legacyRoot = (settings_ACU as any)?.bs_biotracker;
  const chatStates = isPlainRecord(legacyRoot?.chatStates) ? (legacyRoot.chatStates as Record<string, unknown>) : null;
  if (!chatStates) return;

  const ours = chatStates[chatKey];
  if (!hasMeaningfulData(ours)) {
    // 存量已可靠加载且该聊天确无内置数据：打标避免每次切换都空转
    markChatDone(chatKey);
    logDebug_ACU(`[生物追踪迁移] 聊天 ${chatKey} 无存量内置数据，标记完成（不触碰上游存档）。`);
    return;
  }

  const upstream = await loadHostChatState(ctx);
  // [防竞态②] 读取确认门：null 混淆「确认无存档」与「读取失败/未知」。未确认时不写回，
  // 避免上游存档还没读到（TT 启动 handle 未挂/超时）就被我们的数据整包覆盖。
  if (!isHostChatStateConfirmed(ctx)) {
    logDebug_ACU(`[生物追踪迁移] 聊天 ${chatKey} 上游 sidecar 读取未确认，本轮不写回（下次触发重试）。`);
    return;
  }
  // [防竞态③] await 期间聊天可能已切换：复核 chatKey 未变才写（load/save 都按当前 handle 解析）
  const currentChatKey = await resolveHostChatId(ctx);
  if (currentChatKey !== chatKey) {
    logDebug_ACU(`[生物追踪迁移] 迁移期间聊天已切换（${chatKey} → ${currentChatKey}），本轮放弃。`);
    return;
  }

  const merged = mergeChatState(ours as Record<string, unknown>, isPlainRecord(upstream) ? upstream : null);
  const queued = scheduleHostChatStateSave(ctx, merged);
  // schedule 返回 false = handle 缺失等静默 no-op：不打标，下次触发重试
  if (!queued) {
    logDebug_ACU(`[生物追踪迁移] 聊天 ${chatKey} 写入未入队（宿主句柄未就绪），本次不打标。`);
    return;
  }
  markChatDone(chatKey);
  logDebug_ACU(`[生物追踪迁移] 聊天 ${chatKey} 已静默合并写入上游 sidecar（characters=${Object.keys(merged.characters ?? {}).length}）。`);
}

/** SillyTavern 网页端：extensionSettings 全量一次性迁移 */
function migrateExtensionSettingsFull(): void {
  // [加载门控] 同 TT 分支：settings 未可靠加载不打标，等下次触发
  if (!isSettingsStorageReadyForSave_ACU()) {
    logDebug_ACU('[生物追踪迁移] 设置尚未完成可靠加载，本轮跳过（不打标）。');
    return;
  }
  const ctx = getHostContext();
  const extensionSettings = getHostExtensionSettings(ctx);
  if (!extensionSettings) {
    logDebug_ACU('[生物追踪迁移] 宿主 extensionSettings 不可用，本轮跳过（不打完成标）。');
    return;
  }
  const legacyRoot = (settings_ACU as any)?.bs_biotracker;
  const chatStates = isPlainRecord(legacyRoot?.chatStates) ? (legacyRoot.chatStates as Record<string, unknown>) : null;
  if (!chatStates || Object.keys(chatStates).length === 0) {
    // settings 已可靠加载且确无存量数据：打完成标（此后不再重试）
    markGlobalDone();
    logDebug_ACU('[生物追踪迁移] 无存量内置追踪数据，标记全局完成。');
    return;
  }
  const upstreamRoot = isPlainRecord(extensionSettings.bs_biotracker)
    ? (extensionSettings.bs_biotracker as Record<string, unknown>)
    : {};
  const upstreamChatStates = isPlainRecord(upstreamRoot.chatStates) ? upstreamRoot.chatStates : {};
  let mergedChats = 0;
  for (const [chatKey, ours] of Object.entries(chatStates)) {
    if (!hasMeaningfulData(ours)) continue;
    const upstream = isPlainRecord(upstreamChatStates[chatKey]) ? (upstreamChatStates[chatKey] as Record<string, unknown>) : null;
    upstreamChatStates[chatKey] = mergeChatState(ours as Record<string, unknown>, upstream);
    mergedChats += 1;
  }
  upstreamRoot.chatStates = upstreamChatStates;
  extensionSettings.bs_biotracker = upstreamRoot;
  saveHostSettings(ctx);
  markGlobalDone();
  logDebug_ACU(`[生物追踪迁移] extensionSettings 全量静默迁移完成：合并 ${mergedChats} 个聊天的追踪数据。`);
}

/**
 * 静默迁移入口：启动时调用一次；TT/Luker 下每次聊天切换也会调用（打开即迁，
 * 已迁移过的聊天按标记直接跳过）。全程吞错，绝不影响主流程。
 */
export async function runLegacyBiotrackerSilentMigration_ACU(): Promise<void> {
  try {
    const kind = getHostKind();
    if (kind === 'tauritavern' || kind === 'luker') {
      // TT/Luker 走「打开即迁」：per-chat 标记控制每个聊天只迁一次
      await migrateCurrentChatInHostedKind();
      return;
    }
    if (isGlobalDone()) return;
    migrateExtensionSettingsFull();
  } catch (error) {
    logDebug_ACU('[生物追踪迁移] 静默迁移异常（已忽略，不影响主流程）:', error);
  }
}
