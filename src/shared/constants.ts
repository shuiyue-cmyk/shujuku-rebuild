/**
 * shared/constants.ts — 环境常量
 *
 * 纯常量定义，不依赖运行时环境。
 * 从 src/core/01_header_and_env.js 迁移而来。
 */

/** 调试模式开关（控制 console.log 输出，不影响日志缓冲区） */
export const DEBUG_MODE_ACU = false;

/**
 * 唯一脚本标识符
 * 重要：如需创建独立副本，请修改此值为全新的唯一英文名称
 */
export const UNIQUE_SCRIPT_ID = 'shujuku_v120';

/** 脚本 ID 前缀（等同于 UNIQUE_SCRIPT_ID） */
export const SCRIPT_ID_PREFIX_ACU = UNIQUE_SCRIPT_ID;

/** 主弹窗 ID */
export const POPUP_ID_ACU = `${SCRIPT_ID_PREFIX_ACU}-popup`;

/** 菜单项 ID */
export const MENU_ITEM_ID_ACU = `${SCRIPT_ID_PREFIX_ACU}-menu-item`;

// ═══ 从 import-status-ui.ts 迁移的纯常量/纯函数 ═══
export const IMPORTED_ENTRY_PREFIX_ACU = 'TavernDB-ACU-ImportedTxt-';
export function getImportStablePrefix_ACU() { return '外部导入-'; }
export function getImportBatchPrefix_ACU() { return getImportStablePrefix_ACU(); }
export function getImportJsonStorageComment_ACU(modeSuffix = '-Selected') {
    const IMPORT_PREFIX = '外部导入-';
    return `${IMPORT_PREFIX}TavernDB-ACU-ImportedJsonData${modeSuffix}`;
}

// ═══ 从 toast.ts 迁移的纯常量 ═══
export const ACU_TOAST_CATEGORY_ACU = {
    ERROR: 'error',
    TABLE_OK: 'table_ok',
    PLAN_OK: 'plan_ok',
    PLANNING: 'planning',
    MANUAL_TABLE: 'manual_table',
    MERGE_TABLE: 'merge_table',
    IMPORT: 'import',
};

export const TABLE_ORDER_FIELD_ACU = 'orderNo';
