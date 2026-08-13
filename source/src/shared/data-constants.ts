/**
 * data/constants.ts — 数据层存储键常量和 Profile 工具
 *
 * 从 src/core/02_storage_and_profile.js 迁移而来。
 * 依赖 shared/constants.ts 中的 SCRIPT_ID_PREFIX_ACU。
 */

import { SCRIPT_ID_PREFIX_ACU } from './constants';

// ═══════════════════════════════════════════════════════════════
// 存储键常量
// ═══════════════════════════════════════════════════════════════
export const STORAGE_KEY_CUSTOM_TEMPLATE_ACU = `${SCRIPT_ID_PREFIX_ACU}_customTemplate`;
export const MENU_ITEM_CONTAINER_ID_ACU = `${SCRIPT_ID_PREFIX_ACU}-extensions-menu-container`;
export const STORAGE_KEY_ALL_SETTINGS_ACU = `${SCRIPT_ID_PREFIX_ACU}_allSettings_v2`;
export const STORAGE_KEY_GLOBAL_META_ACU = `${SCRIPT_ID_PREFIX_ACU}_globalMeta_v1`;
export const STORAGE_KEY_PROFILE_PREFIX_ACU = `${SCRIPT_ID_PREFIX_ACU}_profile_v1`;
export const STORAGE_KEY_TEMPLATE_PRESETS_ACU = `${SCRIPT_ID_PREFIX_ACU}_templatePresets_v1`;
export const STORAGE_KEY_IMPORTED_ENTRIES_ACU = `${SCRIPT_ID_PREFIX_ACU}_importedTxtEntries`;
export const STORAGE_KEY_IMPORTED_STATUS_ACU = `${SCRIPT_ID_PREFIX_ACU}_importedTxtStatus`;
export const STORAGE_KEY_IMPORTED_STATUS_STANDARD_ACU = `${SCRIPT_ID_PREFIX_ACU}_importedTxtStatus_standard`;
export const STORAGE_KEY_IMPORTED_STATUS_SUMMARY_ACU = `${SCRIPT_ID_PREFIX_ACU}_importedTxtStatus_summary`;
export const STORAGE_KEY_IMPORTED_STATUS_FULL_ACU = `${SCRIPT_ID_PREFIX_ACU}_importedTxtStatus_full`;
export const STORAGE_KEY_PLOT_SETTINGS_ACU = `${SCRIPT_ID_PREFIX_ACU}_plotSettings`;

// ═══════════════════════════════════════════════════════════════
// Profile 工具函数
// ═══════════════════════════════════════════════════════════════
export const DEFAULT_ISOLATION_SLOT_ACU = '__default__';

export function normalizeIsolationCode_ACU(code: string): string {
  return (typeof code === 'string') ? code.trim() : '';
}

export function getIsolationSlot_ACU(code: string): string {
  const c = normalizeIsolationCode_ACU(code);
  return c ? encodeURIComponent(c) : DEFAULT_ISOLATION_SLOT_ACU;
}

export function getProfileSettingsKey_ACU(code: string): string {
  return `${STORAGE_KEY_PROFILE_PREFIX_ACU}__${getIsolationSlot_ACU(code)}__settings`;
}

export function getProfileTemplateKey_ACU(code: string): string {
  return `${STORAGE_KEY_PROFILE_PREFIX_ACU}__${getIsolationSlot_ACU(code)}__template`;
}
