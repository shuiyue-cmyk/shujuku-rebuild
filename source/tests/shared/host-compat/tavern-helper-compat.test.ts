/**
 * tests/shared/host-compat/tavern-helper-compat.test.ts
 * TavernHelper 三级后端兼容适配器 单元测试
 *
 * 覆盖装配语义：世界书后端按组一次性锁定（rawTH 存在→整组 passthrough/mapped，
 * 绝不回落 native；rawTH 缺失→整组 native）、聊天/Slash/角色数据仍逐方法
 * 透传（油猴模式行为零变化）、完全没有酒馆助手时落到 SillyTavern 原生后端。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogDebug } = vi.hoisted(() => ({ mockLogDebug: vi.fn() }));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
  logWarn_ACU: vi.fn(),
}));

import {
  buildTavernHelperCompat_ACU,
  formatHostCapabilities_ACU,
  getLastHostCapabilities_ACU,
} from '../../../src/shared/host-compat/tavern-helper-compat';

function nativeContext(over: Record<string, any> = {}): any {
  return {
    loadWorldInfo: vi.fn(async () => ({ entries: { 1: { uid: 1, comment: '原生条目', content: '原生正文' } } })),
    saveWorldInfo: vi.fn(async () => undefined),
    executeSlashCommandsWithOptions: vi.fn(async () => ({ pipe: 'ok' })),
    getWorldInfoNames: vi.fn(() => ['原生书A', '原生书B']),
    characters: [{ name: '主角', avatar: 'hero.png', data: { extensions: { world: '原生主书' } } }],
    characterId: 0,
    chat: [{ name: '用户', mes: '你好', is_user: true }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('passthrough：旧版酒馆助手全量 API', () => {
  it('同名方法直接透传并绑定宿主对象', async () => {
    const rawTH = {
      getLorebookEntries: vi.fn(async () => [{ uid: 9, comment: '助手条目' }]),
      getLorebooks: vi.fn(async () => ['助手书']),
    };
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => nativeContext());

    expect(capabilities.getLorebookEntries).toBe('passthrough');
    expect(capabilities.getLorebooks).toBe('passthrough');
    await expect(api.getLorebookEntries('书A')).resolves.toEqual([{ uid: 9, comment: '助手条目' }]);
    expect(rawTH.getLorebookEntries).toHaveBeenCalledWith('书A');
  });

  it('rawTH 上未适配的其它属性原样保留', () => {
    const rawTH = { getLorebookEntries: vi.fn(), customHelper: 42 };
    const { api } = buildTavernHelperCompat_ACU(rawTH, () => nativeContext());
    expect(api.customHelper).toBe(42);
  });
});

describe('mapped：只有新版改名 API', () => {
  it('getWorldbook 包装成旧版扁平条目', async () => {
    const rawTH = {
      getWorldbook: vi.fn(async () => ([
        { uid: 3, name: '新条目', content: '新正文', strategy: { type: 'constant', keys: [/正则/g] }, position: { type: 'at_depth', role: 'user', depth: 2 } },
      ])),
    };
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => nativeContext());

    expect(capabilities.getLorebookEntries).toBe('mapped');
    const entries = await api.getLorebookEntries('书A');
    expect(entries[0]).toMatchObject({
      uid: 3,
      comment: '新条目',
      content: '新正文',
      type: 'constant',
      keys: ['/正则/g'],
      position: 'at_depth_as_user',
      depth: 2,
      display_index: 0,
    });
  });

  it('getWorldbookNames 包装成 getLorebooks', async () => {
    const rawTH = { getWorldbookNames: vi.fn(async () => ['新版书']) };
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => nativeContext());
    expect(capabilities.getLorebooks).toBe('mapped');
    await expect(api.getLorebooks()).resolves.toEqual(['新版书']);
  });
});

describe('世界书后端组锁（装配期一次性定源，读写永不混源）', () => {
  it('raw TavernHelper 存在但缺少条目读取时保持缺失，不调用 native 后端', async () => {
    const ctx = nativeContext();
    const rawTH = {
      getCharWorldbookNames: vi.fn(async () => ({ primary: '主书', additional: [] })),
    };

    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => ctx);

    expect(capabilities.getCharWorldbookNames).toBe('passthrough');
    expect(capabilities.getLorebookEntries).toBe('missing');
    expect(api.getLorebookEntries).toBeUndefined();
    await expect(api.getCharWorldbookNames('current')).resolves.toEqual({ primary: '主书', additional: [] });
    expect(ctx.loadWorldInfo).not.toHaveBeenCalled();
  });

  it('派生绑定视图复用同一个 getCharWorldbookNames 来源', async () => {
    const rawTH = {
      getCharWorldbookNames: vi.fn(async () => ({ primary: '主书', additional: ['附书'] })),
    };
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => nativeContext());
    await expect(api.getCurrentCharPrimaryLorebook()).resolves.toBe('主书');
    await expect(api.getCharLorebooks({ type: 'additional' })).resolves.toEqual({ primary: null, additional: ['附书'] });
    expect(rawTH.getCharWorldbookNames).toHaveBeenCalledTimes(2);
    // 能力位跟随来源：rawTH 直通 getCharWorldbookNames 时派生视图应标 passthrough 而非 mapped
    expect(capabilities.getCurrentCharPrimaryLorebook).toBe('passthrough');
    expect(capabilities.getCharLorebooks).toBe('passthrough');
  });

  it('宿主只有新版改名 API 时整组 mapped，写路径与读路径同源且都不碰 native', async () => {
    const ctx = nativeContext();
    const rawTH = {
      getWorldbook: vi.fn(async () => []),
      updateWorldbookWith: vi.fn(async () => undefined),
      createWorldbookEntries: vi.fn(async () => ({ worldbook: [], new_entries: [] })),
      deleteWorldbookEntries: vi.fn(async () => ({ worldbook: [], deleted_entries: [] })),
      getWorldbookNames: vi.fn(async () => ['新版书']),
      getCharLorebooks: vi.fn(async () => ({ primary: '旧版主书', additional: [] })),
    };
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => ctx);

    for (const name of ['getLorebookEntries', 'setLorebookEntries', 'createLorebookEntries',
      'deleteLorebookEntries', 'getLorebooks', 'getCharWorldbookNames'] as const) {
      expect(capabilities[name]).toBe('mapped');
    }
    await api.setLorebookEntries('新版书', [{ uid: 1, comment: '改名' }]);
    await api.createLorebookEntries('新版书', [{ comment: '新条目' }]);
    await api.deleteLorebookEntries('新版书', [1]);
    await expect(api.getLorebooks()).resolves.toEqual(['新版书']);
    await expect(api.getCurrentCharPrimaryLorebook()).resolves.toBe('旧版主书');
    expect(rawTH.updateWorldbookWith).toHaveBeenCalled();
    expect(rawTH.createWorldbookEntries).toHaveBeenCalled();
    expect(rawTH.deleteWorldbookEntries).toHaveBeenCalled();
    expect(rawTH.getWorldbookNames).toHaveBeenCalled();
    expect(ctx.loadWorldInfo).not.toHaveBeenCalled();
    expect(ctx.saveWorldInfo).not.toHaveBeenCalled();
    expect(ctx.getWorldInfoNames).not.toHaveBeenCalled();
  });

  it('raw TavernHelper 存在时聊天组仍逐方法解析：共用名 native 兜底不受世界书组锁影响', async () => {
    const ctx = nativeContext();
    const rawTH = { getLorebookEntries: vi.fn(async () => []) };
    const { api, capabilities } = buildTavernHelperCompat_ACU(rawTH, () => ctx);

    expect(capabilities.getLorebookEntries).toBe('passthrough');
    // 世界书组内未提供方法 → missing，不回落到 native
    expect(capabilities.getLorebooks).toBe('missing');
    expect(api.getLorebooks).toBeUndefined();
    // 聊天组保持既有三级解析：rawTH 无同名方法时落 native
    expect(capabilities.getChatMessages).toBe('native');
    expect(capabilities.getLastMessageId).toBe('native');
    expect(capabilities.triggerSlash).toBe('native');
    expect(capabilities.getCharData).toBe('native');
    await expect(api.getChatMessages('0-0')).resolves.toEqual([
      expect.objectContaining({ role: 'user', message: '你好' }),
    ]);
  });

  it('TT 裸环境（无 rawTH）整组落 native，代码库消费的方法面全部可用', () => {
    const { api, capabilities } = buildTavernHelperCompat_ACU(undefined, () => nativeContext());
    const consumedMethods = [
      'getLorebookEntries', 'setLorebookEntries', 'createLorebookEntries', 'deleteLorebookEntries',
      'getLorebooks', 'getCharWorldbookNames', 'getCurrentCharPrimaryLorebook', 'getCharLorebooks',
      'getChatMessages', 'getLastMessageId', 'triggerSlash', 'getCharData',
    ];
    for (const name of consumedMethods) {
      expect(capabilities[name], name).toBe('native');
      expect(typeof api[name], name).toBe('function');
    }
    // generateRaw 刻意不挂载（本库已剥离酒馆主 API 直连路径）
    expect(capabilities.generateRaw).toBe('missing');
  });
});

describe('native：TT 裸环境完全没有酒馆助手', () => {
  it('rawTH 为 undefined 时仍挂载原生实现，能力表标 native', async () => {
    const ctx = nativeContext();
    const { api, capabilities } = buildTavernHelperCompat_ACU(undefined, () => ctx);

    expect(capabilities.getLorebookEntries).toBe('native');
    expect(capabilities.getLorebooks).toBe('native');
    expect(capabilities.getChatMessages).toBe('native');
    await expect(api.getLorebooks()).resolves.toEqual(['原生书A', '原生书B']);
    await expect(api.getLorebookEntries('书A')).resolves.toEqual([
      expect.objectContaining({ uid: 1, comment: '原生条目', content: '原生正文' }),
    ]);
    await expect(api.getChatMessages('0-0')).resolves.toEqual([
      expect.objectContaining({ role: 'user', message: '你好' }),
    ]);
    await expect(api.triggerSlash('/x')).resolves.toBe('ok');
    expect(api.getCharData('current')).toBe(ctx.characters[0]);
  });

  it('getStApi 每次调用都重新取 context 快照，不缓存旧值', async () => {
    let snapshot = nativeContext({ getWorldInfoNames: vi.fn(() => ['第一轮']) });
    const { api } = buildTavernHelperCompat_ACU(undefined, () => snapshot);
    await expect(api.getLorebooks()).resolves.toEqual(['第一轮']);

    snapshot = nativeContext({ getWorldInfoNames: vi.fn(() => ['第二轮']) });
    await expect(api.getLorebooks()).resolves.toEqual(['第二轮']);
  });

  it('generateRaw 无原生等价实现：保持方法缺失语义', () => {
    const { api, capabilities } = buildTavernHelperCompat_ACU(undefined, () => nativeContext());
    expect(capabilities.generateRaw).toBe('missing');
    expect('generateRaw' in api).toBe(false);
  });
});

describe('missing：原生后端也不可用', () => {
  it('context 不可用时逐方法删除，调用方空值检查照旧生效', () => {
    const { api, capabilities } = buildTavernHelperCompat_ACU(undefined, () => undefined);
    expect(capabilities.getLorebookEntries).toBe('missing');
    expect(capabilities.getLorebooks).toBe('missing');
    expect(typeof api.getLorebookEntries).toBe('undefined');
    expect(typeof api.getLorebooks).toBe('undefined');
  });

  it('能力表可格式化输出且记录到 getLastHostCapabilities', () => {
    const { capabilities } = buildTavernHelperCompat_ACU(undefined, () => undefined);
    expect(getLastHostCapabilities_ACU()).toBe(capabilities);
    const text = formatHostCapabilities_ACU(capabilities);
    expect(text).toContain('缺失:');
    expect(text).toContain('getLorebookEntries');
    expect(formatHostCapabilities_ACU(null)).toBe('（能力表尚未生成）');
  });
});
