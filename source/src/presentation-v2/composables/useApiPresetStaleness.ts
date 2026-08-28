// presentation-v2/composables/useApiPresetStaleness.ts — API 预设变更防呆（Vue 响应式封装）
// 核心机制见 service/settings/api-preset-staleness.ts。
// 用法：const { isStale, markConfirmed } = useApiPresetStaleness('<选择器key>')；
// isStale 为 true 时给预设选择器标淡黄底，用户手动重选后在 @update 处调 markConfirmed()。

import { ref, onMounted, onBeforeUnmount } from 'vue';
import {
  isApiPresetStale_ACU,
  confirmApiPresetStaleness_ACU,
  onApiPresetRevisionChanged_ACU,
} from '../../service/settings/api-preset-staleness';

export function useApiPresetStaleness(key: string) {
  const isStale = ref(isApiPresetStale_ACU(key));
  let unsubscribe: (() => void) | null = null;
  const recompute = () => { isStale.value = isApiPresetStale_ACU(key); };
  onMounted(() => {
    recompute();
    unsubscribe = onApiPresetRevisionChanged_ACU(recompute);
  });
  onBeforeUnmount(() => { unsubscribe?.(); unsubscribe = null; });
  const markConfirmed = () => {
    confirmApiPresetStaleness_ACU(key);
    recompute();
  };
  return { isStale, markConfirmed };
}

// 再导出核心函数，供组件一次性导入
export {
  bumpApiPresetRevision_ACU,
  isApiPresetStale_ACU,
  confirmApiPresetStaleness_ACU,
} from '../../service/settings/api-preset-staleness';
