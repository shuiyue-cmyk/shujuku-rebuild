/**
 * presentation-v2/composables/useBiotrackerPage.ts
 * 生理追踪页逻辑：API 预设（参照剧情推进）+ 注册（手动/自动搜寻）+ 已注册角色只读
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { settings_ACU, currentChatFileIdentifier_ACU } from '../../service/runtime/state-manager';
import { saveSettings_ACU } from '../../service/settings/settings-service';
import {
  isAutoRegisterEnabled_ACU,
  setAutoRegisterEnabled_ACU,
  getAutoRegisterFrequency_ACU,
  setAutoRegisterFrequency_ACU,
  registerCharacter_ACU,
  autoRegisterCharacters_ACU,
  runBiotrackerNow_ACU,
} from '../../service/biotracker/biotracker-adapter';
import { useApiPresetSelectOptions } from './useApiPresetSelectOptions';
import { ALL_BUILTIN_RACES } from '../../service/biotracker/vendor/race_config.js';
import { showToastr_ACU } from '../../presentation/theme/toast';

export function useBiotrackerPage() {
  // ─── API 预设（参照剧情推进：跟随当前活动 API 或选择专用预设） ───
  const { apiStore, apiPresetSelectOptions, followActiveApiLabel } = useApiPresetSelectOptions();
  const apiPreset = ref(String(settings_ACU.bs_biotracker?.apiPreset || ''));
  // 生效配置 = 选中预设 → 活动 API 预设 → 数据库主配置（响应式跟随，避免初始快照误报未配置）
  const effectiveApiConfig = computed(() => {
    const chosen = apiPreset.value ? apiStore.presets.find(p => p.name === apiPreset.value) : null;
    return chosen?.apiConfig || apiStore.activePreset?.apiConfig || settings_ACU.apiConfig || {};
  });
  const apiUrl = computed(() => effectiveApiConfig.value.url || '');
  const apiKey = computed(() => effectiveApiConfig.value.apiKey || '');
  const apiModel = computed(() => effectiveApiConfig.value.model || '');

  function setApiPreset(value: string): void {
    apiPreset.value = String(value || '');
    settings_ACU.bs_biotracker.apiPreset = apiPreset.value;
    saveSettings_ACU();
  }

  // ─── 手动注册（一次点击 = 繁育推演 + 注册两次 API） ───
  // 表单草稿按聊天分桶（regDrafts[chatKey]）：切换聊天恢复对应草稿，新聊天/关闭聊天回初始状态
  function getBiotrackerRoot(): Record<string, any> {
    if (!settings_ACU.bs_biotracker || typeof settings_ACU.bs_biotracker !== 'object') {
      settings_ACU.bs_biotracker = {};
    }
    return settings_ACU.bs_biotracker;
  }
  const currentChatKey = () => String(currentChatFileIdentifier_ACU || '');
  function getRegDraft(): Record<string, any> {
    const root = getBiotrackerRoot();
    if (!root.regDrafts) root.regDrafts = {};
    const key = currentChatKey();
    if (!root.regDrafts[key]) root.regDrafts[key] = {};
    return root.regDrafts[key];
  }
  const registerName = ref(String(getRegDraft().name || ''));
  const registerRace = ref(String(getRegDraft().race || ''));
  const registerNotes = ref(String(getRegDraft().notes || ''));
  // 手动注册/追踪发送给 AI 的最近 AI 回复条数（默认 12）
  const registerRecentCount = ref(Number(settings_ACU.bs_biotracker?.registerRecentCount) > 0 ? settings_ACU.bs_biotracker.registerRecentCount : 12);
  const registering = ref(false);
  const status = ref('');
  const statusIsError = ref(false);

  function setRegisterRecentCount(value: number): void {
    registerRecentCount.value = Math.max(1, Math.min(100, Math.floor(Number(value) || 12)));
    settings_ACU.bs_biotracker.registerRecentCount = registerRecentCount.value;
    saveSettings_ACU();
  }

  // 输入即存当前聊天的草稿（watch 自动触发）
  watch([registerName, registerRace, registerNotes], () => {
    const draft = getRegDraft();
    draft.name = registerName.value;
    draft.race = registerRace.value;
    draft.notes = registerNotes.value;
    saveSettings_ACU();
  });

  // 切换聊天 → 恢复该聊天的草稿（无草稿的新聊天回初始状态）
  watch(currentChatKey, () => {
    const draft = getRegDraft();
    registerName.value = String(draft.name || '');
    registerRace.value = String(draft.race || '');
    registerNotes.value = String(draft.notes || '');
  });

  async function doRegister(): Promise<void> {
    if (registering.value) return;
    registering.value = true;
    statusIsError.value = false;
    showToastr_ACU('info', `正在繁育推演并注册「${registerName.value || '角色'}」…`, { title: '生理追踪', acuToastCategory: 'biotracker' });
    try {
      const result = await registerCharacter_ACU({
        name: registerName.value,
        declaredRace: registerRace.value,
        customNotes: registerNotes.value,
        recentCount: registerRecentCount.value,
      });
      status.value = result.message;
      statusIsError.value = !result.ok;
      showToastr_ACU(result.ok ? 'success' : 'warning', result.message, { title: '生理追踪', acuToastCategory: 'biotracker' });
      // 注册成功后保留表单内容（草稿已持久化），便于连续注册或对照
      refreshCharacters();
    } finally {
      registering.value = false;
    }
  }

  // ─── 自动注册（主开关 + 更新频率：每 N 层新楼层送入分析一次） ───
  const autoRegister = ref(isAutoRegisterEnabled_ACU());
  const autoFrequency = ref(getAutoRegisterFrequency_ACU());
  // 立即分析并注册发送的最近 AI 回复条数（默认 12）
  const autoRecentCount = ref(Number(settings_ACU.bs_biotracker?.autoRecentCount) > 0 ? settings_ACU.bs_biotracker.autoRecentCount : 12);
  const autoRunning = ref(false);
  const autoFrequencyOptions = [1, 3, 5, 10, 20, 30, 50];

  function setAutoRecentCount(value: number): void {
    autoRecentCount.value = Math.max(1, Math.min(100, Math.floor(Number(value) || 12)));
    settings_ACU.bs_biotracker.autoRecentCount = autoRecentCount.value;
    saveSettings_ACU();
  }

  function toggleAutoRegister(value: boolean): void {
    autoRegister.value = !!value;
    setAutoRegisterEnabled_ACU(!!value);
    saveSettings_ACU();
  }

  function setAutoFrequency(value: number): void {
    autoFrequency.value = Math.max(1, Math.min(50, Math.floor(Number(value) || 5)));
    setAutoRegisterFrequency_ACU(autoFrequency.value);
    saveSettings_ACU();
  }

  async function runAutoRegister(): Promise<void> {
    if (autoRunning.value) return;
    autoRunning.value = true;
    statusIsError.value = false;
    showToastr_ACU('info', '正在分析楼层并注册角色…', { title: '生理追踪', acuToastCategory: 'biotracker' });
    try {
      // 手动触发：发送用户指定的最近 N 条 AI 回复
      const result = await autoRegisterCharacters_ACU({ recentCount: autoRecentCount.value });
      status.value = result.message;
      statusIsError.value = !result.ok;
      showToastr_ACU(result.ok ? 'success' : 'warning', result.message, { title: '生理追踪', acuToastCategory: 'biotracker' });
      refreshCharacters();
    } finally {
      autoRunning.value = false;
    }
  }

  async function runTrackerNow(): Promise<void> {
    statusIsError.value = false;
    showToastr_ACU('info', '正在执行生理追踪分析…', { title: '生理追踪', acuToastCategory: 'biotracker' });
    try {
      await runBiotrackerNow_ACU();
      status.value = '追踪分析完成。';
      showToastr_ACU('success', '追踪分析完成。', { title: '生理追踪', acuToastCategory: 'biotracker' });
      refreshCharacters();
    } catch (e: any) {
      status.value = `追踪失败：${e?.message || e}`;
      statusIsError.value = true;
      showToastr_ACU('error', `追踪失败：${e?.message || e}`, { title: '生理追踪', acuToastCategory: 'biotracker' });
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
    // 刷新 API 预设快照（activePreset/currentConfigReady），与剧情推进页一致
    apiStore.refreshFromSettings();
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
    registerRecentCount,
    setRegisterRecentCount,
    registerRaceOptions: ref(ALL_BUILTIN_RACES),
    registering,
    doRegister,
    autoRegister,
    toggleAutoRegister,
    autoFrequency,
    setAutoFrequency,
    autoFrequencyOptions,
    autoRecentCount,
    setAutoRecentCount,
    autoRunning,
    runAutoRegister,
    runTrackerNow,
    characters,
    status,
    statusIsError,
  };
}
