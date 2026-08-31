/**
 * tests/service/biotracker/silent-migration.test.ts
 *
 * 内置 biotracker 已剥离，silent-migration 是唯一保留的迁移功能（存量数据 → 上游 tracker 可读形态）。
 * 本用例以导出入口 runLegacyBiotrackerSilentMigration_ACU 为被测面（不测私有函数），覆盖：
 * - TT/Luker「打开即迁」分支：无意义数据打标跳过 / 读取未确认不写回 / chatKey 切换放弃 / 正常合并写入+打标
 * - ST extensionSettings 全量分支：无存量打全局标 / 有存量合并写入 + saveHostSettings
 * - 完整度合并规则（角色级严格大于用我们的、平局用上游）经入口间接验证
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runLegacyBiotrackerSilentMigration_ACU } from '../../../src/service/biotracker/silent-migration';

const DONE_FLAG_KEY = 'acu-bs-silent-migration-done';
const CHAT_DONE_PREFIX = 'acu-bs-silent-migration-chat:';

const m = vi.hoisted(() => ({
  hostKind: 'sillytavern' as 'sillytavern' | 'tauritavern' | 'luker',
  getHostKind: vi.fn((): string => 'sillytavern'),
  getHostContext: vi.fn((): any => ({})),
  getHostExtensionSettings: vi.fn((): any => null),
  saveHostSettings: vi.fn(),
  resolveHostChatId: vi.fn(async (): Promise<string> => 'chat-1'),
  isHostChatStateConfirmed: vi.fn((): boolean => true),
  loadHostChatState: vi.fn(async (): Promise<any> => null),
  scheduleHostChatStateSave: vi.fn((): boolean => true),
  settingsReady: vi.fn((): boolean => true),
  settings: { bs_biotracker: undefined as any },
  logDebug: vi.fn(),
}));

vi.mock('../../../src/service/biotracker/host-bridge', () => ({
  getHostKind: () => m.getHostKind(),
  getHostContext: () => m.getHostContext(),
  getHostExtensionSettings: (ctx: any) => m.getHostExtensionSettings(ctx),
  saveHostSettings: (ctx: any) => m.saveHostSettings(ctx),
  resolveHostChatId: (ctx: any) => m.resolveHostChatId(ctx),
  isHostChatStateConfirmed: (ctx: any) => m.isHostChatStateConfirmed(ctx),
  loadHostChatState: (ctx: any) => m.loadHostChatState(ctx),
  scheduleHostChatStateSave: (ctx: any, chatState: any) => m.scheduleHostChatStateSave(ctx, chatState),
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get settings_ACU() { return m.settings; },
}));
vi.mock('../../../src/service/settings/settings-service', () => ({
  isSettingsStorageReadyForSave_ACU: () => m.settingsReady(),
}));
vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: (...args: any[]) => m.logDebug(...args),
}));

/** localStorage stub：迁移的完成标全部落在这里，测试需要逐用例隔离 */
function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
}

let ls: ReturnType<typeof createLocalStorageStub>;

function chatFlagKey(chatKey: string): string { return CHAT_DONE_PREFIX + chatKey; }

function meaningfulChatState(name = '艾莉丝') {
  return { characters: { [name]: { profile: { base: { race: '人类' } } } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  ls = createLocalStorageStub();
  vi.stubGlobal('localStorage', ls);
  m.hostKind = 'sillytavern';
  m.getHostKind.mockImplementation(() => m.hostKind);
  m.getHostContext.mockReturnValue({ chatId: 'chat-1' });
  m.getHostExtensionSettings.mockReturnValue(null);
  m.resolveHostChatId.mockImplementation(async () => 'chat-1');
  m.isHostChatStateConfirmed.mockReturnValue(true);
  m.loadHostChatState.mockImplementation(async () => null);
  m.scheduleHostChatStateSave.mockReturnValue(true);
  m.settingsReady.mockReturnValue(true);
  m.settings.bs_biotracker = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ═══ TT/Luker：打开即迁 ═══
describe('runLegacyBiotrackerSilentMigration_ACU — TT 分支（migrateCurrentChatInHostedKind）', () => {
  beforeEach(() => { m.hostKind = 'tauritavern'; });

  it('settings 尚未可靠加载时跳过本轮：不解析聊天、不打标', async () => {
    m.settingsReady.mockReturnValue(false);
    m.settings.bs_biotracker = { chatStates: { 'chat-1': meaningfulChatState() } };

    await runLegacyBiotrackerSilentMigration_ACU();

    expect(m.resolveHostChatId).not.toHaveBeenCalled();
    expect(m.scheduleHostChatStateSave).not.toHaveBeenCalled();
    expect(ls.store.get(chatFlagKey('chat-1'))).toBeUndefined();
  });

  it('存量无意义（空壳）时打标跳过，且不触碰上游存档', async () => {
    m.settings.bs_biotracker = { chatStates: { 'chat-1': { characters: {}, skillCatalog: [], snapshots: [] } } };

    await runLegacyBiotrackerSilentMigration_ACU();

    expect(ls.store.get(chatFlagKey('chat-1'))).toBe('1');
    expect(m.loadHostChatState).not.toHaveBeenCalled();
    expect(m.scheduleHostChatStateSave).not.toHaveBeenCalled();
  });

  it('该聊天已打过标时直接跳过（不重复迁移）', async () => {
    ls.store.set(chatFlagKey('chat-1'), '1');
    m.settings.bs_biotracker = { chatStates: { 'chat-1': meaningfulChatState() } };

    await runLegacyBiotrackerSilentMigration_ACU();

    expect(m.loadHostChatState).not.toHaveBeenCalled();
    expect(m.scheduleHostChatStateSave).not.toHaveBeenCalled();
  });

  it('上游 sidecar 读取未确认时不写回、不打标（下次触发重试）', async () => {
    m.settings.bs_biotracker = { chatStates: { 'chat-1': meaningfulChatState() } };
    m.isHostChatStateConfirmed.mockReturnValue(false);

    await runLegacyBiotrackerSilentMigration_ACU();

    expect(m.loadHostChatState).toHaveBeenCalledOnce();
    expect(m.scheduleHostChatStateSave).not.toHaveBeenCalled();
    expect(ls.store.get(chatFlagKey('chat-1'))).toBeUndefined();
  });

  it('await 期间聊天已切换时放弃本轮写入、不打标', async () => {
    m.settings.bs_biotracker = { chatStates: { 'chat-1': meaningfulChatState() } };
    let calls = 0;
    m.resolveHostChatId.mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? 'chat-1' : 'chat-2';
    });

    await runLegacyBiotrackerSilentMigration_ACU();

    expect(m.scheduleHostChatStateSave).not.toHaveBeenCalled();
    expect(ls.store.get(chatFlagKey('chat-1'))).toBeUndefined();
    expect(ls.store.get(chatFlagKey('chat-2'))).toBeUndefined();
  });

  it('写入未入队（宿主句柄未就绪）时不打标', async () => {
    m.settings.bs_biotracker = { chatStates: { 'chat-1': meaningfulChatState() } };
    m.scheduleHostChatStateSave.mockReturnValue(false);

    await runLegacyBiotrackerSilentMigration_ACU();

    expect(m.scheduleHostChatStateSave).toHaveBeenCalledOnce();
    expect(ls.store.get(chatFlagKey('chat-1'))).toBeUndefined();
  });

  it('正常路径：合并写入上游 sidecar 并按聊天打永久标', async () => {
    m.settings.bs_biotracker = { chatStates: { 'chat-1': meaningfulChatState('我们的角色') } };
    m.loadHostChatState.mockImplementation(async () => ({ characters: { 上游角色: { profile: { base: { race: '精灵' } } } } }));

    await runLegacyBiotrackerSilentMigration_ACU();

    expect(m.scheduleHostChatStateSave).toHaveBeenCalledOnce();
    const merged = m.scheduleHostChatStateSave.mock.calls[0][1] as any;
    expect(Object.keys(merged.characters).sort()).toEqual(['上游角色', '我们的角色']);
    expect(ls.store.get(chatFlagKey('chat-1'))).toBe('1');
    // 全局标只属于 ST 分支：TT 下逐聊天打标，不打全局标
    expect(ls.store.get(DONE_FLAG_KEY)).toBeUndefined();
  });

  it('无该聊天存量（chatStates 缺失）时静默返回，不写上游也不打标', async () => {
    m.settings.bs_biotracker = undefined;

    await runLegacyBiotrackerSilentMigration_ACU();

    expect(m.loadHostChatState).not.toHaveBeenCalled();
    expect(m.scheduleHostChatStateSave).not.toHaveBeenCalled();
    expect(ls.store.size).toBe(0);
  });
});

// ═══ SillyTavern 网页端：extensionSettings 全量一次性迁移 ═══
describe('runLegacyBiotrackerSilentMigration_ACU — ST 分支（migrateExtensionSettingsFull）', () => {
  it('无存量数据时打全局完成标，且不写宿主设置', async () => {
    m.getHostExtensionSettings.mockReturnValue({});
    m.settings.bs_biotracker = { chatStates: {} };

    await runLegacyBiotrackerSilentMigration_ACU();

    expect(ls.store.get(DONE_FLAG_KEY)).toBe('1');
    expect(m.saveHostSettings).not.toHaveBeenCalled();
  });

  it('已打全局完成标时直接返回（幂等，不重复迁移）', async () => {
    ls.store.set(DONE_FLAG_KEY, '1');
    m.getHostExtensionSettings.mockReturnValue({});
    m.settings.bs_biotracker = { chatStates: { 'chat-1': meaningfulChatState() } };

    await runLegacyBiotrackerSilentMigration_ACU();

    expect(m.getHostExtensionSettings).not.toHaveBeenCalled();
    expect(m.saveHostSettings).not.toHaveBeenCalled();
  });

  it('有存量时合并写入 extensionSettings.bs_biotracker 并触发宿主保存 + 全局标', async () => {
    const ctx = { chatId: 'chat-1' };
    m.getHostContext.mockReturnValue(ctx);
    const extensionSettings: any = {
      bs_biotracker: { chatStates: { 'chat-9': { characters: { 上游已有: { profile: { base: { race: '兽人' } } } } } } },
    };
    m.getHostExtensionSettings.mockReturnValue(extensionSettings);
    m.settings.bs_biotracker = {
      chatStates: {
        'chat-9': meaningfulChatState('我们的角色'),
        'chat-void': { characters: {} },
      },
    };

    await runLegacyBiotrackerSilentMigration_ACU();

    expect(m.saveHostSettings).toHaveBeenCalledWith(ctx);
    const written = extensionSettings.bs_biotracker.chatStates;
    expect(Object.keys(written['chat-9'].characters).sort()).toEqual(['上游已有', '我们的角色']);
    // 无意义存量（空壳）不写入上游
    expect(written['chat-void']).toBeUndefined();
    expect(ls.store.get(DONE_FLAG_KEY)).toBe('1');
  });

  it('宿主 extensionSettings 不可用时跳过且不打全局标（下次触发重试）', async () => {
    m.getHostExtensionSettings.mockReturnValue(null);
    m.settings.bs_biotracker = { chatStates: { 'chat-1': meaningfulChatState() } };

    await runLegacyBiotrackerSilentMigration_ACU();

    expect(m.saveHostSettings).not.toHaveBeenCalled();
    expect(ls.store.get(DONE_FLAG_KEY)).toBeUndefined();
  });

  it('settings 尚未可靠加载时跳过本轮，不打全局标', async () => {
    m.settingsReady.mockReturnValue(false);
    m.getHostExtensionSettings.mockReturnValue({});

    await runLegacyBiotrackerSilentMigration_ACU();

    expect(m.getHostExtensionSettings).not.toHaveBeenCalled();
    expect(ls.store.get(DONE_FLAG_KEY)).toBeUndefined();
  });
});

// ═══ 合并规则（经入口间接验证）═══
describe('runLegacyBiotrackerSilentMigration_ACU — 完整度合并规则', () => {
  /** 经 ST 入口跑一次合并，返回写入 extensionSettings 的该聊天 chatState */
  async function mergeViaST(ours: any, upstream: any): Promise<any> {
    const extensionSettings: any = upstream === null
      ? {}
      : { bs_biotracker: { chatStates: { 'chat-1': upstream } } };
    m.getHostExtensionSettings.mockReturnValue(extensionSettings);
    m.settings.bs_biotracker = { chatStates: { 'chat-1': ours } };
    await runLegacyBiotrackerSilentMigration_ACU();
    return extensionSettings.bs_biotracker.chatStates['chat-1'];
  }

  it('角色体积严格大于用我们的，平局用上游，两侧并集保留', async () => {
    const ours = {
      characters: {
        胜者: { v: '123456789' },      // 序列化更长 → 用我们的
        平局: { v: 'abc' },            // 与上游等长 → 用上游的
      },
    };
    const upstream = {
      characters: {
        胜者: { v: '123' },
        平局: { v: 'xyz' },
        仅上游: { v: 'only-upstream' },
      },
    };

    const merged = await mergeViaST(ours, upstream);

    expect(merged.characters.胜者).toEqual({ v: '123456789' });
    expect(merged.characters.平局).toEqual({ v: 'xyz' });
    expect(merged.characters.仅上游).toEqual({ v: 'only-upstream' });
  });

  it('顶层字段严格大于才用我们的，更小/平局保留上游', async () => {
    const ours = {
      characters: { 甲: { v: 'a' } },
      skillCatalog: [1, 2, 3],         // 更长 → 用我们的
      snapshots: [1],                  // 更短 → 保留上游
      version: 1,                      // 与上游平局 → 保留上游
    };
    const upstream = {
      characters: { 乙: { v: 'b' } },
      skillCatalog: [0],
      snapshots: [1, 2, 3, 4],
      version: 2,
    };

    const merged = await mergeViaST(ours, upstream);

    expect(merged.skillCatalog).toEqual([1, 2, 3]);
    expect(merged.snapshots).toEqual([1, 2, 3, 4]);
    expect(merged.version).toBe(2);
    expect(Object.keys(merged.characters).sort()).toEqual(['乙', '甲']);
  });

  it('上游无该聊天存档时，我们的完整数据整包写入', async () => {
    const ours = { characters: { 甲: { v: 'a' } }, snapshots: [1, 2] };
    const merged = await mergeViaST(ours, null);

    expect(merged).toEqual(ours);
  });
});
