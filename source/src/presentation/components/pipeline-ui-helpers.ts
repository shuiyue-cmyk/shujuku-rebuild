/**
 * presentation/components/pipeline-ui-helpers.ts
 * 包装 service 层的 pipeline 函数，在调用后自动刷新 UI
 *
 * 同时提供统一的预设切换后 UI 同步入口 refreshPresetUIAfterSwitch_ACU，
 * 供模板预设 / 剧情推进预设的手工切换与 API 切换复用。
 */
import { refreshMergedDataAndNotify_ACU } from '../../service/worldbook/pipeline';
import { topLevelWindow_ACU } from '../../shared/env';
import { getUiSurface_ACU } from '../../shared/ui-surface-registry';
import { logDebug_ACU } from '../../shared/utils';

/**
 * 刷新合并数据后自动通知前端 + 刷新可视化编辑器 + 刷新 UI 选择器和状态面板
 * presentation 层唯一入口：所有需要"刷新数据+刷新UI"的地方都调这个。
 */
/** 通知前端后等待其完成数据读取的窗口；仅在确实发出通知时才等待。 */
const FRONTEND_READBACK_WAIT_MS_ACU = 800;

export async function refreshMergedDataAndNotifyWithUI_ACU(
    { skipNotify = false, notifyMeta }: { skipNotify?: boolean; notifyMeta?: { persisted?: boolean } } = {},
) {
    const result = await refreshMergedDataAndNotify_ACU();

    // 1. 通知前端 (iframe context)；notifyMeta.persisted=false 表示本次更新未写入聊天持久化（S2-1）
    let didNotifyFrontend = false;
    try {
        if (!skipNotify && (topLevelWindow_ACU as any).AutoCardUpdaterAPI) {
            (topLevelWindow_ACU as any).AutoCardUpdaterAPI._notifyTableUpdate(notifyMeta);
            didNotifyFrontend = true;
            logDebug_ACU('Notified frontend to refresh UI after data merge.');
        } else if (skipNotify) {
            logDebug_ACU('Skipped frontend table update notification after data merge.');
        }
    } catch (_) {}

    // 2. 刷新已注册的 V2 可视化界面
    const visualizerActive = getUiSurface_ACU()?.isVisualizerActive?.() === true;
    if (visualizerActive) {
        setTimeout(() => {
            try {
                const surface = getUiSurface_ACU();
                if (surface) {
                    void surface.refreshVisualizer().catch((error: unknown) => {
                        logDebug_ACU('V2 visualizer refresh rejected:', error);
                    });
                }
            } catch (error) {
                logDebug_ACU('Failed to request V2 visualizer refresh:', error);
            }
        }, 200);
    } else {
        logDebug_ACU('Skipped V2 visualizer refresh: surface inactive or not registered.');
    }

    // 3. 仅当本次确实通知了前端读取方时才等待回读窗口，避免无读取方时白等
    if (didNotifyFrontend) {
        await new Promise(resolve => setTimeout(resolve, FRONTEND_READBACK_WAIT_MS_ACU));
    }

    return result;
}

/**
 * 预设切换后刷新已打开的 V2 数据库编辑器（旧弹窗的预设下拉与状态卡片已随旧弹窗删除，R9-11）。
 */
export function refreshPresetUIAfterSwitch_ACU() {
    try {
        const surface = getUiSurface_ACU();
        if (surface) {
            void surface.refreshVisualizer().catch((error: unknown) => {
                logDebug_ACU('[refreshPresetUI] V2 可视化编辑器刷新被拒绝:', error);
            });
        }
    } catch (error) {
        logDebug_ACU('[refreshPresetUI] V2 可视化编辑器刷新失败:', error);
    }
}
