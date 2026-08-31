/**
 * tests/shared/host-compat/tavern-helper-compat.test.ts
 * TavernHelper 三级后端兼容适配器 单元测试
 *
 * 覆盖装配语义：rawTH 存在时逐方法透传（油猴模式行为零变化）、
 * 只有新版改名 API 时 mapped 包装、完全没有酒馆助手时落到 SillyTavern 原生后端。
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
