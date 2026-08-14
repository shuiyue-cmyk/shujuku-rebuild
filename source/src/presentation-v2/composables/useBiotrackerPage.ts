/**
 * presentation-v2/composables/useBiotrackerPage.ts
 * 生理追踪页逻辑：API 独立配置 + 注册（手动/自动）+ 已注册角色只读
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { settings_ACU, currentChatFileIdentifier_ACU } from '../../service/runtime/state-manager';
import { saveSettings_ACU } from '../../service/settings/settings-service';
import {
  isAutoRegisterEnabled_ACU,
  setAutoRegisterEnabled_ACU,
  registerCharacter_ACU,
  autoRegisterCharacters_ACU,
  runBiotrackerNow_ACU,
} from '../../service/biotracker/biotracker-adapter';
import { ALL_BUILTIN_RACES } from '../../service/biotracker/vendor/race_config.js';

export function useBiotrackerPage() {
  // ─── API 独立配置（settings_ACU.bsBiotracker） ───
  const apiUrl = ref(settings_ACU.bs_biotracker?.apiUrl || '');
  const apiKey = ref(settings_ACU.bs_biotracker?.apiKey || '');
  const apiModel = ref(settings_ACU.bs_biotracker?.model || '');

  function saveApiConfig(): void {
    const root = settings_ACU.bs_biotracker;
    root.apiUrl = String(apiUrl.value || '').trim();
    root.apiKey = String(apiKey.value || '').trim();
    root.model = String(apiModel.value || '').trim();
    saveSettings_ACU();
    status.value = 'API 配置已保存。';
  }

  // ─── 手动注册 ───
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

  // ─── 自动注册 ───
  const autoRegister = ref(isAutoRegisterEnabled_ACU());
  const autoRunning = ref(false);

  function toggleAutoRegister(value: boolean): void {
    autoRegister.value = !!value;
    setAutoRegisterEnabled_ACU(!!value);
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
    apiUrl,
    apiKey,
    apiModel,
    saveApiConfig,
    registerName,
    registerRace,
    registerNotes,
    registerRaceOptions: ALL_BUILTIN_RACES,
    registering,
    doRegister,
    autoRegister,
    toggleAutoRegister,
    autoRunning,
    runAutoRegister,
    runTrackerNow,
    characters,
    status,
    statusIsError,
  };
}
