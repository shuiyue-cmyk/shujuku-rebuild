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
  isRegisterInFlight_ACU,
  isAutoRegisterInFlight_ACU,
  isTrackerInFlight_ACU,
  registerCharacter_ACU,
  autoRegisterCharacters_ACU,
  runBiotrackerNow_ACU,
  clearBiotrackerChatState_ACU,
  generateWardrobe_ACU,
  getCharacterFullState_ACU,
  debugCharacterAction_ACU,
  saveCharacterFullState_ACU,
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
  // 进行中状态从适配层共享标志恢复：页面关闭再打开时按钮保持「注册中/分析中」直至操作完成
  const registering = ref(isRegisterInFlight_ACU());
  const status = ref('');
  const statusIsError = ref(false);

  // 过程提示 toast：不自动消失，持续到操作完成（timeOut: 0），完成后移除并显示结果
  let pendingOperationToast: any = null;
  function showPendingToast(message: string): void {
    if (pendingOperationToast) {
      try { (pendingOperationToast as any).remove?.(); } catch (e) {}
      pendingOperationToast = null;
    }
    pendingOperationToast = showToastr_ACU('info', message, {
      title: '生理追踪',
      acuToastCategory: 'biotracker',
      timeOut: 0,
      extendedTimeOut: 0,
    });
  }
  function finishPendingToast(): void {
    if (pendingOperationToast) {
      try { (pendingOperationToast as any).remove?.(); } catch (e) {}
      pendingOperationToast = null;
    }
  }

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
    showPendingToast(`正在繁育推演并注册「${registerName.value || '角色'}」…`);
    try {
      const result = await registerCharacter_ACU({
        name: registerName.value,
        declaredRace: registerRace.value,
        customNotes: registerNotes.value,
        recentCount: registerRecentCount.value,
      });
      status.value = result.message;
      statusIsError.value = !result.ok;
      finishPendingToast();
      showToastr_ACU(result.ok ? 'success' : 'warning', result.message, { title: '生理追踪', acuToastCategory: 'biotracker' });
      // 注册成功后保留表单内容（草稿已持久化），便于连续注册或对照
      refreshCharacters();
    } finally {
      finishPendingToast();
      registering.value = false;
    }
  }

  // ─── 自动注册（主开关 + 更新频率：每 N 层新楼层送入分析一次） ───
  const autoRegister = ref(isAutoRegisterEnabled_ACU());
  const autoFrequency = ref(getAutoRegisterFrequency_ACU());
  // 立即分析并注册发送的最近 AI 回复条数（默认 12）
  const autoRecentCount = ref(Number(settings_ACU.bs_biotracker?.autoRecentCount) > 0 ? settings_ACU.bs_biotracker.autoRecentCount : 12);
  const autoRunning = ref(isAutoRegisterInFlight_ACU());
  const tracking = ref(isTrackerInFlight_ACU());
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
    showPendingToast('正在分析楼层并注册角色…');
    try {
      // 手动触发：发送用户指定的最近 N 条 AI 回复
      const result = await autoRegisterCharacters_ACU({ recentCount: autoRecentCount.value });
      status.value = result.message;
      statusIsError.value = !result.ok;
      finishPendingToast();
      showToastr_ACU(result.ok ? 'success' : 'warning', result.message, { title: '生理追踪', acuToastCategory: 'biotracker' });
      refreshCharacters();
    } finally {
      finishPendingToast();
      autoRunning.value = false;
    }
  }

  async function runTrackerNow(): Promise<void> {
    if (tracking.value) return;
    tracking.value = true;
    statusIsError.value = false;
    showPendingToast('正在执行生理追踪分析…');
    try {
      await runBiotrackerNow_ACU();
      status.value = '追踪分析完成。';
      finishPendingToast();
      showToastr_ACU('success', '追踪分析完成。', { title: '生理追踪', acuToastCategory: 'biotracker' });
      refreshCharacters();
    } catch (e: any) {
      status.value = `追踪失败：${e?.message || e}`;
      statusIsError.value = true;
      finishPendingToast();
      showToastr_ACU('error', `追踪失败：${e?.message || e}`, { title: '生理追踪', acuToastCategory: 'biotracker' });
    } finally {
      tracking.value = false;
    }
  }

  // ─── 生成备装（手动注册卡：普通 / 增强） ───
  const wardrobeGenerating = ref(false);
  async function generateWardrobe(enhanced: boolean): Promise<void> {
    if (wardrobeGenerating.value) return;
    const name = String(registerName.value || '').trim();
    if (!name) {
      showToastr_ACU('warning', '请先填写要生成备装的角色名。', { title: '生理追踪', acuToastCategory: 'biotracker' });
      return;
    }
    wardrobeGenerating.value = true;
    statusIsError.value = false;
    showPendingToast(enhanced ? `正在为「${name}」增强生成备装…` : `正在为「${name}」生成备装…`);
    try {
      const result = await generateWardrobe_ACU({ name, enhanced });
      status.value = result.message;
      statusIsError.value = !result.ok;
      finishPendingToast();
      showToastr_ACU(result.ok ? 'success' : 'warning', result.message, { title: '生理追踪', acuToastCategory: 'biotracker' });
      refreshCharacters();
    } catch (e: any) {
      status.value = `生成备装失败：${e?.message || e}`;
      statusIsError.value = true;
      finishPendingToast();
      showToastr_ACU('error', `生成备装失败：${e?.message || e}`, { title: '生理追踪', acuToastCategory: 'biotracker' });
    } finally {
      wardrobeGenerating.value = false;
    }
  }

  // ─── 已注册角色只读（chatState.characters） ───
  const characters = ref<Array<{ name: string; race: string; summary: string }>>([]);
  const dataRefreshTick = ref(0);

  // ─── 完整变量查看 + 调试工具（数据库页面） ───
  const selectedFullStateName = ref('');
  const fullStateJson = ref('');
  const fullStateError = ref('');
  const debugBusy = ref(false);
  const debugMessage = ref('');
  const savingFullState = ref(false);
  const fullStateSaveMessage = ref('');
  const fullStateSaveError = ref(false);

  /** 保存编辑后的完整变量（先做 JSON 格式与基础结构校验） */
  async function saveFullState(): Promise<void> {
    if (!selectedFullStateName.value) return;
    if (savingFullState.value) return;
    savingFullState.value = true;
    fullStateSaveMessage.value = '';
    fullStateSaveError.value = false;
    try {
      const result = saveCharacterFullState_ACU(selectedFullStateName.value, fullStateJson.value);
      fullStateSaveMessage.value = String(result.message || '');
      fullStateSaveError.value = !result.ok;
      showToastr_ACU(result.ok ? 'success' : 'warning', result.message || '', { title: '生理追踪', acuToastCategory: 'biotracker' });
      if (result.ok) {
        viewFullState(selectedFullStateName.value);
        refreshCharacters();
      }
    } catch (e: any) {
      fullStateSaveMessage.value = `保存失败：${e?.message || e}`;
      fullStateSaveError.value = true;
      showToastr_ACU('error', `保存失败：${e?.message || e}`, { title: '生理追踪', acuToastCategory: 'biotracker' });
    } finally {
      savingFullState.value = false;
    }
  }

  /** 读取指定角色的完整状态变量 JSON（只读展示）；再次点击已选中角色时收起 */
  function viewFullState(name: string): void {
    const nextName = String(name || '').trim();
    if (selectedFullStateName.value === nextName) {
      // 点击已选中 → 收起
      selectedFullStateName.value = '';
      fullStateJson.value = '';
      fullStateError.value = '';
      fullStateSaveMessage.value = '';
      return;
    }
    selectedFullStateName.value = nextName;
    fullStateError.value = '';
    fullStateSaveMessage.value = '';
    const result = getCharacterFullState_ACU(selectedFullStateName.value);
    if (!result.ok) {
      fullStateError.value = String(result.message || '读取失败。');
      fullStateJson.value = '';
      return;
    }
    fullStateJson.value = JSON.stringify(result.state, null, 2);
  }

  /** 调试工具操作（在场/妊娠注入/清空容器等，白名单内） */
  async function runDebugAction(toolName: string, args: Record<string, any> = {}): Promise<void> {
    if (!selectedFullStateName.value) {
      showToastr_ACU('warning', '请先选择要调试的角色。', { title: '生理追踪', acuToastCategory: 'biotracker' });
      return;
    }
    if (debugBusy.value) return;
    debugBusy.value = true;
    debugMessage.value = '';
    try {
      const result = debugCharacterAction_ACU(selectedFullStateName.value, toolName, args);
      debugMessage.value = String(result.message || '');
      showToastr_ACU(result.ok ? 'success' : 'warning', result.message || '', { title: '生理追踪', acuToastCategory: 'biotracker' });
      if (result.ok) {
        viewFullState(selectedFullStateName.value);
        refreshCharacters();
      }
    } catch (e: any) {
      debugMessage.value = `操作失败：${e?.message || e}`;
      showToastr_ACU('error', `调试失败：${e?.message || e}`, { title: '生理追踪', acuToastCategory: 'biotracker' });
    } finally {
      debugBusy.value = false;
    }
  }

  /** 清空当前聊天的生理追踪数据（恢复初始空状态） */
  function clearChatState(): void {
    const cleared = clearBiotrackerChatState_ACU();
    if (cleared) {
      showToastr_ACU('success', '已清空本聊天的生理追踪数据。', { title: '生理追踪', acuToastCategory: 'biotracker' });
      refreshCharacters();
    } else {
      showToastr_ACU('warning', '清空失败：当前聊天尚无数据或状态不可用。', { title: '生理追踪', acuToastCategory: 'biotracker' });
    }
  }

  function refreshCharacters(): void {
    dataRefreshTick.value++;
    const chatStates = settings_ACU.bs_biotracker?.chatStates || {};
    const chatKey = String(currentChatFileIdentifier_ACU || '');
    // 当前聊天无匹配数据时（chatKey 为空/插件重载后 CHAT_CHANGED 未触发/隔离码 profile 差异），
    // 回退聚合所有聊天的已注册角色，避免「更新后已注册角色丢失」
    let map: Record<string, any> = chatStates[chatKey]?.characters || {};
    if (Object.keys(map).length === 0) {
      const merged: Record<string, any> = {};
      for (const key of Object.keys(chatStates)) {
        const chars = chatStates[key]?.characters;
        if (!chars || typeof chars !== 'object') continue;
        for (const name of Object.keys(chars)) {
          if (!merged[name]) merged[name] = chars[name];
        }
      }
      map = merged;
    }
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

  // ─── 数据库表格查看已撤销（2026-08-14 用户「内页的表格页面不要」）：表格查看移入弹窗前端（panel/renderTablePage） ───
  let timer: ReturnType<typeof setInterval> | null = null;
  onMounted(() => {
    // 刷新 API 预设快照（activePreset/currentConfigReady），与剧情推进页一致
    apiStore.refreshFromSettings();
    refreshCharacters();
    timer = setInterval(() => {
      refreshCharacters();
    }, 3000);
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
    tracking,
    runAutoRegister,
    runTrackerNow,
    clearChatState,
    generateWardrobe,
    wardrobeGenerating,
    selectedFullStateName,
    fullStateJson,
    fullStateError,
    debugBusy,
    debugMessage,
    viewFullState,
    runDebugAction,
    saveFullState,
    savingFullState,
    fullStateSaveMessage,
    fullStateSaveError,
    characters,
    status,
    statusIsError,
  };
}
