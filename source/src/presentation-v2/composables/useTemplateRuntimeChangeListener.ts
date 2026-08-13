/**
 * 将非 Vue 的模板提交通知转换为 V2 响应式刷新信号。
 * App 只安装一次监听；页面只观察 tick，因此不会把服务层耦合到 Vue。
 */
import { onBeforeUnmount, ref, type Ref } from 'vue';
import {
  subscribeTemplateRuntimeChanges_ACU,
} from '../../shared/template-runtime-change';
import { requestVisualizerExternalRefresh_ACU } from '../surfaces/visualizer/open-visualizer-surface';

const templateRuntimeChangeTick = ref(0);

export function useTemplateRuntimeChangeTick(): Ref<number> {
  return templateRuntimeChangeTick;
}

export function useTemplateRuntimeChangeListener(): void {
  let disposed = false;
  let refreshQueued = false;
  const unsubscribe = subscribeTemplateRuntimeChanges_ACU(() => {
    if (disposed || refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      if (disposed) return;
      templateRuntimeChangeTick.value += 1;
      void requestVisualizerExternalRefresh_ACU();
    });
  });

  onBeforeUnmount(() => {
    disposed = true;
    unsubscribe();
  });
}
