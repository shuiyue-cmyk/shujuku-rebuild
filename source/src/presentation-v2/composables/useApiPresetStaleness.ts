// presentation-v2/composables/useApiPresetStaleness.ts — API 预设变更防呆（Vue 响应式封装）
// 核心机制见 service/settings/api-preset-staleness.ts。
// 用法：const { isStale, markConfirmed } = useApiPresetStaleness('<选择器key>')；
// isStale 为 true 时给预设选择器标淡黄底，用户手动重选后在 @update 处调 markConfirmed()。
// 回显规则：从未确认过 + 全局修订号>0（发生过变更）→ 直接标黄（不搞首次沉默）。

import { computed, ref, onMounted, onBeforeUnmount, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import {
  isApiPresetStale_ACU,
  confirmApiPresetStaleness_ACU,
  onApiPresetRevisionChanged_ACU,
} from '../../service/settings/api-preset-staleness';
import { useDevOptionsStore } from '../stores/dev-options-store';

export function useApiPresetStaleness(key: string) {
  // 无 pinia 上下文（如裸挂载单测）时回退为开启＝旧行为；生产环境 pinia 恒在，走 store 真值。
  let apiReconfirm: Ref<boolean>;
  try {
    apiReconfirm = storeToRefs(useDevOptionsStore()).apiReconfirm;
  } catch {
    apiReconfirm = ref(true);
  }
  const rawStale = ref(isApiPresetStale_ACU(key));
  // “API 二次确认”总闸：关闭后全库不再标黄（底层修订号/确认态不动，重开即恢复显示）。
  const isStale = computed(() => apiReconfirm.value !== false && rawStale.value);
  let unsubscribe: (() => void) | null = null;
  const recompute = () => { rawStale.value = isApiPresetStale_ACU(key); };
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
