/**
 * v2-ui-state — 新 UI localStorage 根状态的共享常量。
 */
export const ACU_V2_STORAGE_KEY = 'acu_v2_ui_state';
export const ACU_V2_DEV_OPTIONS_SECTION_KEY = 'devOptions';
export const WARN_LOG_ENABLED_KEY = 'warnLogEnabled';
export const SCOPE_GUARD_PROMPT_KEY = 'scopeGuardPrompt';

/**
 * 在 Vue/Pinia 尚未挂载时读取一个开发者选项布尔开关（只认显式 true），
 * 保证启动阶段、没打开过面板时也遵守持久化设置。
 */
function readDevOptionFlag(key: string): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const raw = window.localStorage.getItem(ACU_V2_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    const devOptions = (parsed as Record<string, unknown>)[ACU_V2_DEV_OPTIONS_SECTION_KEY];
    if (!devOptions || typeof devOptions !== 'object') return false;
    return (devOptions as Record<string, unknown>)[key] === true;
  } catch {
    return false;
  }
}

export function readWarnLogEnabled(): boolean {
  return readDevOptionFlag(WARN_LOG_ENABLED_KEY);
}

export function readScopeGuardPromptEnabled(): boolean {
  return readDevOptionFlag(SCOPE_GUARD_PROMPT_KEY);
}
