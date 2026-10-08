import { logError_ACU } from '../../../shared/utils';
import {
  getAcuV2PiniaForBridge,
  openAcuV2App,
} from '../../bootstrap/mount';
import { getAcuHostWindow } from '../../bootstrap/host-document';
import { canLeaveCurrentPage } from '../../composables/useUiCloseGuard';
import { useRootShellStore } from '../../stores/root-shell-store';
import { useRouterStore } from '../../stores/router-store';
import {
  useVisualizerStore,
  type VisualizerOpenSource,
} from '../../stores/visualizer-store';
import { readVisualizerSourceRevision_ACU } from '../../../service/visualizer/visualizer-source-revision';

interface OpenVisualizerSurfaceOptions {
  source?: VisualizerOpenSource;
}

interface AutoCardUpdaterV2Api {
  open: () => Promise<boolean>;
  /** 第三方前端（如 st-yuzi-phone）探测的打开别名，语义同 open */
  openApp: () => Promise<boolean>;
  openShell: () => Promise<boolean>;
  openVisualizer: () => Promise<boolean>;
  refreshVisualizer: () => Promise<void>;
}

export async function openAcuV2Shell_ACU(): Promise<boolean> {
  try {
    await openAcuV2App();
    return true;
  } catch (error) {
    logError_ACU('openAcuV2Shell failed:', error);
    return false;
  }
}

export async function openVisualizerSurface_ACU(
  options: OpenVisualizerSurfaceOptions = {},
): Promise<boolean> {
  try {
    const existingPinia = getAcuV2PiniaForBridge();
    const wasShellOpen = existingPinia
      ? useRootShellStore(existingPinia).isOpen
      : false;
    const previousPageId = existingPinia
      ? useRouterStore(existingPinia).activePageId
      : null;
    // R10B-06：面板开着时进入编辑器会卸载当前页，页内未保存修改要先过守卫。
    // 新版界面内的入口（v2-shell）在切预设等前置动作之前自行检查，这里只拦外部调用。
    const visualizerAlreadyActive = existingPinia ? useVisualizerStore(existingPinia).isActive : false;
    if (
      (options.source ?? 'external-api') === 'external-api'
      && wasShellOpen
      && !visualizerAlreadyActive
      && !(await canLeaveCurrentPage())
    ) {
      return false;
    }

    await openAcuV2App();

    const pinia = getAcuV2PiniaForBridge();
    if (!pinia) throw new Error('v2 app was not mounted.');

    const router = useRouterStore(pinia);
    const visualizer = useVisualizerStore(pinia);
    visualizer.open({
      source: options.source ?? 'external-api',
      wasShellOpen,
      previousPageId: previousPageId ?? router.activePageId,
    });
    return true;
  } catch (error) {
    logError_ACU('openVisualizerSurface failed:', error);
    return false;
  }
}

export async function requestVisualizerExternalRefresh_ACU(): Promise<void> {
  const pinia = getAcuV2PiniaForBridge();
  if (!pinia) return;
  // 带上当前数据源 revision：store 据此把同一轮的重复请求合并成一次重载，
  // 并在数据源没变时直接跳过（省掉整表重载与两次全库克隆）。
  useVisualizerStore(pinia).requestExternalRefresh(readVisualizerSourceRevision_ACU());
}

/**
 * 返回 V2 可视化表面当前是否处于激活（打开）状态。
 * 供 presentation 层在数据合并后决定是否需要刷新可视化编辑器，
 * 避免面板未打开时仍触发 200ms 延迟刷新与 800ms 前端读取等待。
 * 无 pinia（应用未挂载）时视为未激活。
 */
export function isVisualizerSurfaceActive_ACU(): boolean {
  const pinia = getAcuV2PiniaForBridge();
  if (!pinia) return false;
  return useVisualizerStore(pinia).isActive;
}

function installAutoCardUpdaterV2ApiOnTarget_ACU(target: any): void {
  if (!target) return;
  const previous = target.AutoCardUpdaterV2API || {};
  target.AutoCardUpdaterV2API = {
    ...previous,
    open: openAcuV2Shell_ACU,
    openApp: openAcuV2Shell_ACU,
    openShell: openAcuV2Shell_ACU,
    openVisualizer: () => openVisualizerSurface_ACU({ source: 'external-api' }),
    refreshVisualizer: requestVisualizerExternalRefresh_ACU,
  } satisfies AutoCardUpdaterV2Api;
}

export function installAutoCardUpdaterV2Api_ACU(): void {
  if (typeof window === 'undefined') return;
  installAutoCardUpdaterV2ApiOnTarget_ACU(window as any);
  const hostWindow = getAcuHostWindow();
  if (hostWindow !== window) {
    installAutoCardUpdaterV2ApiOnTarget_ACU(hostWindow as any);
  }
}
