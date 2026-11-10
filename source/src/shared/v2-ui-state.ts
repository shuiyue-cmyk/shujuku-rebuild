/**
 * v2-ui-state — 新 UI localStorage 根状态的共享常量。
 */
export const ACU_V2_STORAGE_KEY = 'acu_v2_ui_state';
export const ACU_V2_DEV_OPTIONS_SECTION_KEY = 'devOptions';
export const WARN_LOG_ENABLED_KEY = 'warnLogEnabled';
export const SCOPE_GUARD_PROMPT_KEY = 'scopeGuardPrompt';
export const SCOPE_GUARD_TARGETS_KEY = 'scopeGuardTargets';

/**
 * 在 Vue/Pinia 尚未挂载时读取一个开发者选项的原始值，
 * 保证启动阶段、没打开过面板时也遵守持久化设置。读不到返回 undefined。
 */
function readDevOptionValue(key: string): unknown {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return undefined;
    const raw = window.localStorage.getItem(ACU_V2_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const devOptions = (parsed as Record<string, unknown>)[ACU_V2_DEV_OPTIONS_SECTION_KEY];
    if (!devOptions || typeof devOptions !== 'object') return undefined;
    return (devOptions as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** 布尔开关只认显式 true。 */
function readDevOptionFlag(key: string): boolean {
  return readDevOptionValue(key) === true;
}

/** 执行边界提示词的「附加到」勾选原始记录；非布尔值由服务层按默认处理。 */
export function readScopeGuardTargets(): Record<string, unknown> {
  const raw = readDevOptionValue(SCOPE_GUARD_TARGETS_KEY);
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

export function readWarnLogEnabled(): boolean {
  return readDevOptionFlag(WARN_LOG_ENABLED_KEY);
}

export function readScopeGuardPromptEnabled(): boolean {
  return readDevOptionFlag(SCOPE_GUARD_PROMPT_KEY);
}
