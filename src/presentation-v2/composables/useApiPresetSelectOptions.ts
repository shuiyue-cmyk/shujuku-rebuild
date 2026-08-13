import { computed } from 'vue';
import { useApiPresetStore } from '../stores/api-preset-store';

interface ApiPresetSelectOption {
  value: string;
  label: string;
}

export function formatFollowActiveApiLabel(activePresetName: string): string {
  const name = String(activePresetName || '').trim();
  return `跟随当前活动 API（${name || '未选择预设'}）`;
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
