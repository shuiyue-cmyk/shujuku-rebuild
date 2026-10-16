/**
 * api-preset-store — API 页状态边界（阶段 1 / D17，阶段 B 重构）
 *
 * Vue 组件只读写本 store；本 store 是 service 的薄包装。
 * 所有写操作委托 service/api-preset-service，不再直接改 settings_ACU。
 * 保存失败时 service 已回滚内存，store 同步恢复快照并传播失败结果。
 */
import {
  defineStore
} from 'pinia';
import {
  settings_ACU
} from '../../service/runtime/state-manager';
import {
  ensureApiSettingsShape_ACU,
  findPresetByName_ACU,
  getCurrentChatKey_ACU,
  normalizeApiConfig_ACU,
  resolveDisplayedActiveApiPresetName_ACU,
  saveApiPreset_ACU,
  saveCurrentConfigAsPreset_ACU,
  deleteApiPreset_ACU,
  setActivePresetForCurrentChat_ACU,
  setDefaultApiPreset_ACU,
  type ApiPreset_ACU,
  type ApiPresetApiConfig_ACU,
  type ApiPresetApiMode_ACU,
  type ApiPresetBinding_ACU,
  type ApiPresetWriteResult_ACU,
} from '../../service/settings/api-preset-service';
import {
  fetchAvailableModels_ACU,
  testApiConnection_ACU,
  type ApiConnectionTestResult_ACU,
} from '../../service/ai/ai-service';

export type AcuV2ApiMode = ApiPresetApiMode_ACU;

export interface AcuV2ApiConfig extends ApiPresetApiConfig_ACU {}

export interface AcuV2ApiPreset extends ApiPreset_ACU {}

export interface AcuV2ApiPresetBinding extends ApiPresetBinding_ACU {}

interface ApiPresetState {
  presets: AcuV2ApiPreset[];
  defaultApiPresetName: string;
  activePresetName: string;
  currentConfigReady: boolean;
  currentConfigLabel: string;
  currentChatKey: string;
  modelOptions: string[];
  modelLoadStatus: 'idle' | 'loading' | 'success' | 'error';
  modelLoadError: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

function resolveCurrentConfigStatus(): { ready: boolean; label: string } {
  ensureApiSettingsShape_ACU();
  const config = normalizeApiConfig_ACU(settings_ACU.apiConfig);

  if (config.url.trim() && config.model.trim()) {
    return { ready: true, label: config.model.trim() };
  }

  return { ready: false, label: '当前 API 配置不完整' };
}

export const useApiPresetStore = defineStore('acu-v2-api-presets', {
  state: (): ApiPresetState => ({
    presets: [],
    defaultApiPresetName: '',
    activePresetName: '',
    currentConfigReady: false,
    currentConfigLabel: '当前 API 配置不完整',
    currentChatKey: getCurrentChatKey_ACU(),
    modelOptions: [],
    modelLoadStatus: 'idle',
    modelLoadError: '',
  }),
  getters: {
    defaultPreset(state): AcuV2ApiPreset | null {
      return findPresetByName_ACU(state.presets, state.defaultApiPresetName);
    },
    activePreset(state): AcuV2ApiPreset | null {
      return findPresetByName_ACU(state.presets, state.activePresetName);
    },
    hasPresets(state): boolean {
      return state.presets.length > 0;
    },
  },
  actions: {
    /**
     * 仅刷新展示用状态。只读消费 service 快照，不写回运行配置。
     * 聊天切换后的运行配置投影由 service 层 reconcile（loadSettings_ACU 末尾）完成。
     */
    refreshFromSettings(): void {
      ensureApiSettingsShape_ACU();
      this.currentChatKey = getCurrentChatKey_ACU();
      this.presets = clone(settings_ACU.apiPresets);
      const defaultName = findPresetByName_ACU(this.presets, settings_ACU.defaultApiPresetName)
        ? settings_ACU.defaultApiPresetName
        : '';
      this.defaultApiPresetName = defaultName;

      this.activePresetName = resolveDisplayedActiveApiPresetName_ACU(this.currentChatKey);
      const currentConfig = resolveCurrentConfigStatus();
      this.currentConfigReady = currentConfig.ready;
      this.currentConfigLabel = currentConfig.label;
    },
    /** 应用写操作结果：成功与失败都同步展示态（失败时 service 已回滚内存）；返回 boolean 保持旧契约。 */
    applyWriteResult(result: ApiPresetWriteResult_ACU): boolean {
      this.refreshFromSettings();
      return result.ok === true;
    },
    setDefaultPreset(name: string): boolean {
      return this.applyWriteResult(setDefaultApiPreset_ACU(name));
    },
    setActivePresetForCurrentChat(name: string): boolean {
      return this.applyWriteResult(setActivePresetForCurrentChat_ACU(name));
    },
    savePreset(presetInput: AcuV2ApiPreset, originalName = ''): boolean {
      return this.applyWriteResult(saveApiPreset_ACU(presetInput, originalName));
    },
    saveCurrentConfigAsPreset(name: string): boolean {
      return this.applyWriteResult(saveCurrentConfigAsPreset_ACU(name));
    },
    deletePreset(name: string): boolean {
      return this.applyWriteResult(deleteApiPreset_ACU(name));
    },
    /**
     * 模型探活（status）：customApiFormat 允许未归一化的草稿值，
     * service 侧按五值白名单校验、非法降级 ''（等价 TT 默认 openai_compat）。
     */
    /** 测试连接：用填写中的配置（可未保存）发一条最短请求；结果由调用方展示，不改 store 状态。 */
    testConnectionForConfig(
      apiConfig: Partial<AcuV2ApiConfig>,
      options?: { nonPrefillSupport?: boolean },
    ): Promise<ApiConnectionTestResult_ACU> {
      return testApiConnection_ACU(apiConfig, options);
    },
    async loadModelsForConfig(
      apiConfig: Partial<Omit<AcuV2ApiConfig, 'customApiFormat'>> & { customApiFormat?: string },
    ): Promise<boolean> {
      this.modelLoadStatus = 'loading';
      this.modelLoadError = '';
      const result = await fetchAvailableModels_ACU(
        String(apiConfig.url || ''),
        String(apiConfig.apiKey || ''),
        String(apiConfig.customApiFormat || ''),
        // 「拉取模型列表」是用户的显式刷新动作：跳过探活缓存读，避免 5 分钟 TTL 吞掉新配置。
        // 数据库直接发送的预设同样直接向端点要模型列表。
        { force: true, ...(apiConfig.sendChannel === 'direct' ? { sendChannel: 'direct' as const } : {}) },
      );
      if (!result.success) {
        this.modelOptions = [];
        this.modelLoadStatus = 'error';
        this.modelLoadError = result.error || '模型列表加载失败';
        return false;
      }
      this.modelOptions = result.models || [];
      this.modelLoadStatus = 'success';
      return true;
    },
  },
});
