/**
 * content-replace-store — 提示词身份派生收敛（P2-5）
 *
 * 旧实现里 hasSelectedPreset / selectedPresetName / activePresetLabel / promptTemplateMode
 * 四个 getter 各自独立跑「当前草稿 stringify + 默认组深拷贝与 stringify + 逐预设 stringify」，
 * 同一帧内四个读数就是 4×(N+2) 次整组序列化。改成一个派生 getter（promptIdentity）后，
 * 整帧只构建一次草稿指纹与一次预设匹配，默认组指纹在模块级算一次。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CUSTOM_VALUE = '__acu_content_replace_custom__';

function createSettings(presetCount = 3) {
  return {
    apiPresets: [{ name: 'fast', apiConfig: {} }],
    contentOptimizationSettings: {
      enabled: false,
      apiPreset: 'fast',
      seamlessMode: true,
      autoApply: true,
      showDiff: true,
      parallelMode: false,
      ignoreMvuUpdate: false,
      minLength: 100,
      maxOptimizations: 10,
      loopCount: 1,
      retryCount: 3,
      extractTags: '',
      extractRules: [],
      excludeRules: [],
      promptGroup: [
        { role: 'system', content: '草稿主提示词', deletable: false, mainSlot: 'A' },
        { role: 'user', content: '请改写下面这段：\n$CONTENT', deletable: true },
      ],
      promptPresets: Array.from({ length: presetCount }, (_, index) => ({
        name: `预设 ${index + 1}`,
        promptGroup: [
          { role: 'system', content: `预设 ${index + 1} 主提示词`, deletable: false, mainSlot: 'A' },
          { role: 'user', content: '预设正文', deletable: true },
        ],
      })),
    },
  } as any;
}

async function setupStore(presetCount = 3) {
  vi.resetModules();
  const settings = createSettings(presetCount);
  vi.doMock('../../../src/service/runtime/state-manager', () => ({
    settings_ACU: settings,
    get currentChatFileIdentifier_ACU() { return 'chat-a'; },
  }));
  vi.doMock('../../../src/data/gateways/chat-gateway', () => ({ getChatArray_ACU: () => [] }));
  vi.doMock('../../../src/service/settings/settings-service', () => ({ saveSettings_ACU: vi.fn() }));
  vi.doMock('../../../src/service/optimization/content-optimization', () => ({ performContentOptimization_ACU: vi.fn() }));
  vi.doMock('../../../src/service/chat/chat-service', () => ({
    getOriginalContent_ACU: vi.fn(() => ''),
    replaceChatMessage_ACU: vi.fn(async () => true),
  }));
  vi.doMock('../../../src/service/plot/plot-logic', () => ({ getLastOptimizedMessageIndex_ACU: vi.fn(() => -1) }));

  const pinia = await import('pinia');
  pinia.setActivePinia(pinia.createPinia());
  const mod = await import('../../../src/presentation-v2/stores/content-replace-store');
  const store = mod.useContentReplaceStore();
  store.refreshFromSettings();
  return { store, mod, settings };
}

/** 同帧读取四个 getter，返回这一帧新增的指纹构建次数。 */
function readAllIdentityGetters(store: any, mod: any): { builds: number; values: Record<string, unknown> } {
  const before = mod.__readContentReplacePromptFingerprintCountForTests_ACU();
  const values = {
    hasSelectedPreset: store.hasSelectedPreset,
    selectedPresetName: store.selectedPresetName,
    activePresetLabel: store.activePresetLabel,
    promptTemplateMode: store.promptTemplateMode,
  };
  return { builds: mod.__readContentReplacePromptFingerprintCountForTests_ACU() - before, values };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('content-replace-store 提示词身份派生', () => {
  it('同帧读取四个 getter 只构建一次草稿指纹（不再 4×(N+2) 次序列化）', async () => {
    const presetCount = 3;
    const { store, mod } = await setupStore(presetCount);

    const first = readAllIdentityGetters(store, mod);
    // 旧实现：4 个 getter 各自 stringify 草稿 + 默认组（深拷贝后再 stringify）+ 逐预设，
    // 本夹具同帧共 18 次序列化；收敛后只剩「草稿 1 次 + 逐预设 N 次」这一次派生。
    expect(first.builds).toBeLessThanOrEqual(1 + presetCount);
    expect(first.values).toEqual({
      hasSelectedPreset: false,
      selectedPresetName: CUSTOM_VALUE,
      activePresetLabel: '自定义提示词',
      promptTemplateMode: 'custom',
    });

    // 同帧内再次读取：computed 命中（值正确即证明，新增序列化次数是机制，不数）。
    expect(readAllIdentityGetters(store, mod).values).toEqual(first.values);
  });

  it('命中已有预设时四个 getter 给出同一套读数', async () => {
    const { store, mod } = await setupStore(3);
    store.promptGroup = store.promptPresets[1].promptGroup.map(segment => ({ ...segment }));
    store.activePresetHint = '预设 2';

    const { builds, values } = readAllIdentityGetters(store, mod);

    expect(builds).toBeLessThanOrEqual(1 + 3);
    expect(values).toEqual({
      hasSelectedPreset: true,
      selectedPresetName: '预设 2',
      activePresetLabel: '预设 2',
      promptTemplateMode: 'custom',
    });
  });

  it('预设切换后取值立刻跟着变，不吃上一帧的缓存', async () => {
    const { store, mod } = await setupStore(3);
    readAllIdentityGetters(store, mod);

    store.selectPreset('预设 3');
    const afterSwitch = readAllIdentityGetters(store, mod);

    expect(afterSwitch.values).toEqual({
      hasSelectedPreset: true,
      selectedPresetName: '预设 3',
      activePresetLabel: '预设 3',
      promptTemplateMode: 'custom',
    });
    expect(store.promptGroup[0].content).toContain('预设 3');

    // 手工改一句提示词：立刻退回「自定义」，而不是继续显示预设名。
    store.updatePromptSegment(0, { content: '我自己改的主提示词' });
    const afterEdit = readAllIdentityGetters(store, mod);

    expect(afterEdit.values).toEqual({
      hasSelectedPreset: false,
      selectedPresetName: CUSTOM_VALUE,
      activePresetLabel: '自定义提示词',
      promptTemplateMode: 'custom',
    });
  });

  it('恢复默认提示词组后 selectedPresetName 为空、模式为 default', async () => {
    const { store, mod } = await setupStore(3);
    readAllIdentityGetters(store, mod);

    store.resetPromptGroup();

    const { values } = readAllIdentityGetters(store, mod);
    expect(values).toEqual({
      hasSelectedPreset: false,
      selectedPresetName: '',
      activePresetLabel: '默认预设',
      promptTemplateMode: 'default',
    });
    expect(store.defaultPromptSegmentCount).toBe(store.promptSegmentCount);
    expect(store.defaultPromptSegmentCount).toBeGreaterThan(0);
  });
});
