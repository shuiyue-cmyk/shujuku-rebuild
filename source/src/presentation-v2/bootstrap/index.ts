/**
 * presentation-v2/bootstrap — 新 UI 启动入口
 *
 * 由 src/index.ts / src/entry-extension.ts / src/entry-extension-plus-assistantembedded.ts
 * 在旧 UI 启动之后调用。
 *
 * 注册"打开新 UI"菜单按钮；点击时惰性挂载 Vue 应用。
 */
import { registerUiSurface_ACU } from '../../shared/ui-surface-registry';
import { registerAcuV2MenuButton } from './menu-button';
import {
  installAutoCardUpdaterV2Api_ACU,
  openAcuV2Shell_ACU,
  openVisualizerSurface_ACU,
  requestVisualizerExternalRefresh_ACU,
  isVisualizerSurfaceActive_ACU,
} from '../surfaces/visualizer/open-visualizer-surface';

export { openAcuV2App, closeAcuV2App } from './mount';
export { openVisualizerSurface_ACU } from '../surfaces/visualizer/open-visualizer-surface';

export function bootstrapAcuV2(): void {
  registerUiSurface_ACU({
    openSettings: openAcuV2Shell_ACU,
    openVisualizer: () => openVisualizerSurface_ACU({ source: 'external-api' }),
    refreshVisualizer: requestVisualizerExternalRefresh_ACU,
    isVisualizerActive: isVisualizerSurfaceActive_ACU,
  });
  installAutoCardUpdaterV2Api_ACU();
  registerAcuV2MenuButton();
}
