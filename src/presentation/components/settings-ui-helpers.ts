/**
 * presentation/components/settings-ui-helpers.ts
 * 从 settings-service.ts 搬出的 UI 相关便捷函数
 */
import { loadSettings_ACU, saveSettings_ACU } from '../../service/settings/settings-service';
import { syncAllSettingsToUI_ACU } from './status-display';
import { settings_ACU } from '../../service/runtime/state-manager';
import { showToastr_ACU } from '../theme/toast';

export type SaveSettingsNotifyOptions_ACU = {
    silentWarnings?: boolean;
    suppressLoadingWarning?: boolean;
};

/**
 * 加载设置后刷新 UI（presentation 层便捷函数）
 */
export function loadSettingsAndRefreshUI_ACU() {
    loadSettings_ACU();
    if (typeof syncAllSettingsToUI_ACU === 'function') syncAllSettingsToUI_ACU(settings_ACU);
}

/**
 * 保存设置并根据返回值弹 toast 通知（presentation 层便捷函数）
 * service 层 saveSettings_ACU 只返回结果，UI 通知由此函数处理。
 *
 * 后台自动流程可能在设置加载门闸尚未放行时触发保存。那类保护性拒绝必须保留，
 * 但不能把正常填表/世界书同步流程刷成连续 toast；用户主动保存仍然保留提示。
 */
export function saveSettingsAndNotify_ACU(options: SaveSettingsNotifyOptions_ACU = {}) {
    const result = saveSettings_ACU();
    if (result.error) {
        showToastr_ACU('error', result.error);
    } else if (result.warning) {
        if (options.silentWarnings) return result;
        if (options.suppressLoadingWarning !== false && result.code === 'settings_loading') return result;
        const toastType = result.storageType === 'memory' ? 'warning' : 'info';
        const timeOut = result.storageType === 'memory' ? 8000 : 6000;
        showToastr_ACU(toastType, result.warning, { timeOut });
    }
    return result;
}
