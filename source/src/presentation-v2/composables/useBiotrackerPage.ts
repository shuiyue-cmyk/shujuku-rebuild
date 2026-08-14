/**
 * presentation-v2/composables/useBiotrackerPage.ts
 * 生理追踪页逻辑：API 预设（参照剧情推进）+ 注册（手动/自动搜寻）+ 已注册角色只读
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { settings_ACU, currentChatFileIdentifier_ACU } from '../../service/runtime/state-manager';
import { saveSettings_ACU } from '../../service/settings/settings-service';
import {
  isAutoRegisterEnabled_ACU,
  setAutoRegisterEnabled_ACU,
  getAutoRegisterScanCount_ACU,
  setAutoRegisterScanCount_ACU,
  registerCharacter_ACU,
  autoRegisterCharacters_ACU,
  runBiotrackerNow_ACU,
} from '../../service/biotracker/biotracker-adapter';
import { useApiPresetSelectOptions } from './useApiPresetSelectOptions';
import { ALL_BUILTIN_RACES } from '../../service/biotracker/vendor/race_config.js';

export function useBiotrackerPage() {
  // ─── API 预设（参照剧情推进：跟随当前活动 API 或选择专用预设） ───
  const { apiStore, apiPresetSelectOptions, followActiveApiLabel } = useApiPresetSelectOptions();
  const apiPreset = ref(String(settings_ACU.bs_biotracker?.apiPreset || ''));
  const apiUrl = ref(settings_ACU.apiConfig?.url || '');
  const apiKey = ref(settings_ACU.apiConfig?.apiKey || '');
  const apiModel = ref(settings_ACU.apiConfig?.model || '');

  function setApiPreset(value: string): void {
    apiPreset.value = String(value || '');
    settings_ACU.bs_biotracker.apiPreset = apiPreset.value;
    // 选中预设后展示其 url/model
    const preset = apiStore.presets.find(p => p.name === apiPreset.value);
    const cfg = preset?.apiConfig || settings_ACU.apiConfig || {};
    apiUrl.value = cfg.url || '';
    apiKey.value = cfg.apiKey || '';
    apiModel.value = cfg.model || '';
    saveSettings_ACU();
  }

  // ─── 手动注册（一次点击 = 繁育推演 + 注册两次 API） ───
  const registerName = ref('');
  const registerRace = ref('');
  const registerNotes = ref('');
  const registering = ref(false);
  const status = ref('');
  const statusIsError = ref(false);

  async function doRegister(): Promise<void> {
    if (registering.value) return;
    registering.value = true;
    statusIsError.value = false;
    try {
      const result = await registerCharacter_ACU({
        name: registerName.value,
        declaredRace: registerRace.value,
        customNotes: registerNotes.value,
      });
      status.value = result.message;
      statusIsError.value = !result.ok;
      if (result.ok) {
        registerName.value = '';
        registerNotes.value = '';
      }
      refreshCharacters();
    } finally {
      registering.value = false;
    }
  }

  // ─── 自动搜寻注册（开关 + 扫描楼层数） ───
  const autoRegister = ref(isAutoRegisterEnabled_ACU());
  const autoScanCount = ref(getAutoRegisterScanCount_ACU());
  const autoRunning = ref(false);

  function toggleAutoRegister(value: boolean): void {
    autoRegister.value = !!value;
    setAutoRegisterEnabled_ACU(!!value);
    saveSettings_ACU();
  }

  function setAutoScanCount(value: number): void {
    autoScanCount.value = Math.max(2, Math.min(100, Math.floor(Number(value) || 12)));
    setAutoRegisterScanCount_ACU(autoScanCount.value);
    saveSettings_ACU();
  }

  async function runAutoRegister(): Promise<void> {
    if (autoRunning.value) return;
    autoRunning.value = true;
    statusIsError.value = false;
    try {
      const result = await autoRegisterCharacters_ACU();
      status.value = result.message;
      statusIsError.value = !result.ok;
      refreshCharacters();
    } finally {
      autoRunning.value = false;
    }
  }

  async function runTrackerNow(): Promise<void> {
    statusIsError.value = false;
    try {
      await runBiotrackerNow_ACU();
      status.value = '追踪分析完成。';
      refreshCharacters();
    } catch (e: any) {
      status.value = `追踪失败：${e?.message || e}`;
      statusIsError.value = true;
    }
  }

  // ─── 已注册角色只读（chatState.characters） ───
  const characters = ref<Array<{ name: string; race: string; summary: string }>>([]);
  const dataRefreshTick = ref(0);

  function refreshCharacters(): void {
    dataRefreshTick.value++;
    const chatStates = settings_ACU.bs_biotracker?.chatStates || {};
    const chatKey = String(currentChatFileIdentifier_ACU || '');
    const chatState = chatStates[chatKey];
    const map = chatState?.characters || {};
    characters.value = Object.keys(map).map((name) => {
      const profile = map[name]?.profile || {};
      const base = profile.base || {};
      const pregnant = profile.pregnant || {};
      const summary = [
        base.race ? `种族：${base.race}` : '',
        typeof pregnant.enabled === 'boolean' ? (pregnant.enabled ? `妊娠中（${pregnant.days || 0}天）` : '未妊娠') : '',
      ].filter(Boolean).join('，');
      return { name, race: String(base.race || '未知'), summary };
    });
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  onMounted(() => {
    refreshCharacters();
    timer = setInterval(refreshCharacters, 3000);
  });
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
  });

  return {
    apiPreset,
    setApiPreset,
    apiPresetSelectOptions,
    followActiveApiLabel,
    apiUrl,
    apiKey,
    apiModel,
    registerName,
    registerRace,
    registerNotes,
    registerRaceOptions: ref(ALL_BUILTIN_RACES),
    registering,
    doRegister,
    autoRegister,
    toggleAutoRegister,
    autoScanCount,
    setAutoScanCount,
    autoRunning,
    runAutoRegister,
    runTrackerNow,
    characters,
    status,
    statusIsError,
  };
}
