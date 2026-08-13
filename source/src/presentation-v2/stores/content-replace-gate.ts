/**
 * content-replace-gate — 正文替换功能的启用开关
 *
 * 旧版通过“智能续写最大重试次数 == 49”做隐藏解锁；智能续写已删除，
 * 这里收敛为纯用户开关：contentOptimizationSettings.enabled 直接由
 * enabledPreference 决定，不再依赖任何其他设置。
 */
import { settings_ACU } from '../../service/runtime/state-manager';

function ensureContentReplaceSettings(): Record<string, any> {
  if (!settings_ACU.contentOptimizationSettings || typeof settings_ACU.contentOptimizationSettings !== 'object') {
    settings_ACU.contentOptimizationSettings = {};
  }
  return settings_ACU.contentOptimizationSettings as Record<string, any>;
}

function readUserEnabledPreference(cfg: Record<string, any>): boolean {
  if (cfg.enabledSwitchTouched === true) return cfg.enabledPreference === true;
  // 迁移兼容：旧版本设置里没有 enabledSwitchTouched，但正文替换可能已开启。
  // 保留既有 enabled 状态，避免升级后被静默关闭；用户一旦操作开关即接管语义。
  return cfg.enabled === true;
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
