import { computed } from 'vue';
import { useApiPresetStore } from '../stores/api-preset-store';

interface ApiPresetSelectOption {
  value: string;
  label: string;
}

/**
 * 「跟随当前活动 API」选项（值为空串）的显示名：直接以预设名开头，窄屏截断时也先看到名字；
 * 「（当前）」用来区分列表里同名的固定预设选项（选它会固定到该预设，不再随 API 页切换）。
 */
export function formatFollowActiveApiLabel(activePresetName: string): string {
  const name = String(activePresetName || '').trim();
  return name ? `${name}（当前）` : '当前 API';
}

export function useApiPresetSelectOptions() {
  const apiStore = useApiPresetStore();
  const followActiveApiLabel = computed(() =>
    formatFollowActiveApiLabel(apiStore.activePresetName),
  );
  const apiPresetSelectOptions = computed<ApiPresetSelectOption[]>(() => [
    { value: '', label: followActiveApiLabel.value },
    ...apiStore.presets.map(preset => ({
      value: preset.name,
      label: preset.name,
    })),
  ]);

  return {
    apiStore,
    followActiveApiLabel,
    apiPresetSelectOptions,
  };
}
