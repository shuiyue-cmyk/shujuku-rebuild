/**
 * presentation-v2/bootstrap — 新 UI 启动入口
 *
 * 由 src/entry-extension.ts 在扩展初始化后调用。
 *
 * 注册"打开新 UI"菜单按钮；点击时惰性挂载 Vue 应用。
 */
import { registerUiSurface_ACU, showHostToast_ACU, type UiToastPayload_ACU } from '../../shared/ui-surface-registry';
import { logWarn_ACU } from '../../shared/utils';
import { registerAcuV2MenuButton } from './menu-button';
import { getAcuV2PiniaForBridge } from './mount';
import { useRootShellStore } from '../stores/root-shell-store';
import { useToastStore } from '../stores/toast-store';
import { readPersistedActiveTheme_ACU } from '../stores/theme-store';
import { applyTheme } from '../theme/theme-injector';
import {
  installAutoCardUpdaterV2Api_ACU,
  openAcuV2Shell_ACU,
  openVisualizerSurface_ACU,
  requestVisualizerExternalRefresh_ACU,
  isVisualizerSurfaceActive_ACU,
} from '../surfaces/visualizer/open-visualizer-surface';

export { openAcuV2App, closeAcuV2App } from './mount';
export { openVisualizerSurface_ACU } from '../surfaces/visualizer/open-visualizer-surface';

/**
 * showToast 实现：V2 shell 已挂载且打开时走 Pinia toast-store（可携带
 * "打开数据管理"等 action）；否则用酒馆页面上的插件提示框；再不可用只记日志。
 * 绝不抛错——toast 通道不允许反向破坏调用方（加载/合并）流程。
 */
function showAcuV2Toast_ACU(payload: UiToastPayload_ACU): void {
  try {
    const pinia = getAcuV2PiniaForBridge();
    if (pinia) {
      const shell = useRootShellStore(pinia);
      if (shell.isOpen) {
        useToastStore(pinia).notify(payload.kind, payload.text, {
          muteable: false,
          ...(payload.action ? {
            action: {
              label: payload.action.label,
              onClick: payload.action.onClick,
            },
          } : {}),
        });
        return;
      }
    }
  } catch (error) {
    logWarn_ACU('[ACU-V2] toast-store 通道不可用，回退酒馆页面提示框:', error);
  }
  // 面板没打开：用酒馆页面上的插件提示框（与面板内提示同一设计、跟随主题）。
  if (showHostToast_ACU(payload)) return;
  logWarn_ACU(`[ACU toast:${payload.kind}] ${payload.text}`);
}

/**
 * 启动即按已保存的主题输出 token：插件提示框等宿主浮层在面板打开前就会出现，
 * 不能等首次挂载才上色。面板挂载后由 theme store 订阅接管后续切换。
 */
export function applySavedThemeToHostSurfaces_ACU(): void {
  try {
    applyTheme(readPersistedActiveTheme_ACU());
  } catch (error) {
    logWarn_ACU('[ACU-V2] 启动时应用主题失败，宿主浮层将使用默认配色:', error);
  }
}

export function bootstrapAcuV2(): void {
  registerUiSurface_ACU({
    openSettings: openAcuV2Shell_ACU,
    openVisualizer: () => openVisualizerSurface_ACU({ source: 'external-api' }),
    refreshVisualizer: requestVisualizerExternalRefresh_ACU,
    isVisualizerActive: isVisualizerSurfaceActive_ACU,
    showToast: showAcuV2Toast_ACU,
  });
  installAutoCardUpdaterV2Api_ACU();
  registerAcuV2MenuButton();
}
