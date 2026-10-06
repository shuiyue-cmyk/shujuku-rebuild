/**
 * 新版界面（v3）测试夹具：最小 settings + 挂载 + 渲染异常收集。
 * 业务层只 mock 运行时状态与保存入口，其余走真实实现，尽量贴近真机。
 */
import { nextTick } from 'vue';
import { vi } from 'vitest';

export const STORAGE_KEY = 'acu_v2_ui_state';

export function createV3Settings(): any {
  return {
    apiMode: 'custom',
    apiConfig: { url: 'https://api.example.com/v1', apiKey: '', model: 'gpt-4', max_tokens: 60000, temperature: 1 },
    tavernProfile: '',
    streamingEnabled: false,
    apiPresets: [
      { name: 'alpha', apiMode: 'custom', apiConfig: { url: 'https://alpha.test/v1', apiKey: '', model: 'ma', max_tokens: 1000, temperature: 0.7 } },
      { name: 'beta', apiMode: 'custom', apiConfig: { url: 'https://beta.test/v1', apiKey: '', model: 'mb', max_tokens: 2000, temperature: 1 } },
    ],
    defaultApiPresetName: 'alpha',
    apiPresetBindingsByChat: { 'chat-v3': { presetName: 'beta', updatedAt: 1 } },
    tableApiPreset: '',
    tableApiPresetOverridesByName: {},
    autoUpdateEnabled: true,
    continuationPageEnabled: true,
    toastMuteEnabled: false,
    promptTemplateSettings: { enabled: true },
    summaryVectorIndexModeDefault: false,
    vectorMemoryConfig: { embeddingEndpoint: '', embeddingModel: '', rerankEndpoint: '', rerankModel: '' },
    autoUpdateFrequency: 3,
    autoUpdateThreshold: 3,
    updateBatchSize: 3,
    skipUpdateFloors: 0,
    manualSelectedTables: [],
    hasManualSelection: false,
    contentOptimizationSettings: { apiPreset: '' },
    plotSettings: { enabled: true, plotTasks: [], promptPresets: [], plotWorldbookConfig: { worldbookName: '', enabledEntries: [] } },
    plotApiPreset: '',
    plotTaskApiPresetOverridesById: {},
  };
}

export interface V3MountOptions {
  settings?: any;
  uiState?: Record<string, unknown>;
}

export async function mountV3(options: V3MountOptions = {}) {
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    uiMode: { mode: 'advanced' },
    router: { activePageId: 'dashboard' },
    ...(options.uiState || {}),
  }));
  const settings = options.settings ?? createV3Settings();
  const saveSettings = vi.fn(() => ({ saved: true, storageType: 'memory' }));
  vi.doMock('../../src/service/runtime/state-manager', async () => {
    const actual = await vi.importActual<any>('../../src/service/runtime/state-manager');
    return {
      ...actual,
      settings_ACU: settings,
      currentChatFileIdentifier_ACU: 'chat-v3',
      currentJsonTableData_ACU: null,
      coreApisAreReady_ACU: true,
      getCurrentIsolationKey_ACU: () => '',
    };
  });
  vi.doMock('../../src/service/settings/settings-service', async () => {
    const actual = await vi.importActual<any>('../../src/service/settings/settings-service');
    return { ...actual, saveSettings_ACU: saveSettings };
  });

  const install = await import('../../src/presentation-v3/bootstrap/install');
  const mount = await import('../../src/presentation-v2/bootstrap/mount');
  install.installAcuV3();
  const errors: string[] = [];
  await mount.openAcuV2App();
  const app = mount.__getAcuV2AppForTests()!;
  app.config.errorHandler = (err: unknown, _inst: unknown, info: string) => {
    errors.push(`${info}: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  };
  await flush();
  const { useRouterStore } = await import('../../src/presentation-v2/stores/router-store');
  const { getAcuV2PiniaForBridge } = mount;
  const router = useRouterStore(getAcuV2PiniaForBridge()!);
  return { mount, settings, saveSettings, errors, router };
}

export async function flush(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

export function byText<T extends Element = HTMLElement>(selector: string, text: string, root: ParentNode = document): T | null {
  return (Array.from(root.querySelectorAll<T>(selector)).find(el => el.textContent?.includes(text)) ?? null) as T | null;
}
