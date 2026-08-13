/**
 * useDevOptions — 仪表盘 / 剧情推进页 / 未来开发者一级页共享的开发者选项读写入口
 *
 * `.vue` 不直接 import store；此 composable 让多页共用同一逻辑。
 */
import { storeToRefs } from 'pinia';
import { useDevOptionsStore } from '../stores/dev-options-store';

export function useDevOptions() {
  const store = useDevOptionsStore();
  const {
    developerOptionsEnabled,
    plotAdvanced,
    vectorIndexAdvanced,
    warnLogEnabled,
  } = storeToRefs(store);
  return {
    developerOptionsEnabled,
    setDeveloperOptionsEnabled: (enabled: boolean) => store.setDeveloperOptionsEnabled(enabled),
    plotAdvanced,
    setPlotAdvanced: (enabled: boolean) => store.setPlotAdvanced(enabled),
    vectorIndexAdvanced,
    setVectorIndexAdvanced: (enabled: boolean) => store.setVectorIndexAdvanced(enabled),
    warnLogEnabled,
    setWarnLogEnabled: (enabled: boolean) => store.setWarnLogEnabled(enabled),
    refresh: () => store.refresh(),
  };
}
