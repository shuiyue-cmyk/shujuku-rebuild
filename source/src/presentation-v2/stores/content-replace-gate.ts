import { settings_ACU } from '../../service/runtime/state-manager';

function ensureContentReplaceSettings(): Record<string, any> {
  if (!settings_ACU.contentOptimizationSettings || typeof settings_ACU.contentOptimizationSettings !== 'object') {
    settings_ACU.contentOptimizationSettings = {};
  }
  return settings_ACU.contentOptimizationSettings as Record<string, any>;
}

/**
 * 读取用户的启用偏好。未通过 v2 开关登记过偏好时回退到 legacy enabled 值：
 * 旧 UI 的启用复选框（以及隐藏彩蛋时代的解锁启用）只写 enabled 不写偏好字段，
 * 功能转正后这些用户的已启用状态必须被尊重，不能被同步逻辑静默复位。
 */
function readUserEnabledPreference(cfg: Record<string, any>): boolean {
  if (cfg.enabledSwitchTouched !== true) return cfg.enabled === true;
  return cfg.enabledPreference === true;
}

export function isContentReplaceEnabledBySettings(): boolean {
  return settings_ACU?.contentOptimizationSettings?.enabled === true;
}

export function setContentReplaceEnabledBySettings(enabled: boolean): boolean {
  const cfg = ensureContentReplaceSettings();
  cfg.enabledSwitchTouched = true;
  cfg.enabledPreference = enabled === true;
  cfg.enabled = cfg.enabledPreference === true;
  return cfg.enabled === true;
}

export function syncContentReplaceAvailability(): boolean {
  const cfg = ensureContentReplaceSettings();
  cfg.enabled = readUserEnabledPreference(cfg);
  return cfg.enabled;
}
