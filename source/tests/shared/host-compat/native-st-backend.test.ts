/**
 * tests/shared/host-compat/native-st-backend.test.ts
 * SillyTavern 原生后端 单元测试
 *
 * 重点覆盖 TT-only 定案修复：
 * - charLore 读取路径必须是 settings.world_info_settings.world_info.charLore
 *   （dev script.js:9556 写 world_info_settings: getWorldInfoSettings()，
 *    而 getWorldInfoSettings() 返回 { world_info, ... }）；
 * - getLorebooks 优先 ctx.getWorldInfoNames()（dev st-context.js:289 返回 string[]），
 *   只有它缺失时才降级到 POST /api/settings/get。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockLogWarn, mockLogDebug } = vi.hoisted(() => ({
  mockLogWarn: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
  logDebug_ACU: mockLogDebug,
}));

import { createNativeStBackend_ACU } from '../../../src/shared/host-compat/native-st-backend';

/** 构造一份与 TT dev getContext() 同形的最小 context 快照 */
function buildContext(overrides: Record<string, any> = {}): any {
  return {
    getRequestHeaders: () => ({ 'X-CSRF-Token': 'csrf' }),
    loadWorldInfo: vi.fn(async () => null),
    saveWorldInfo: vi.fn(async () => undefined),
    executeSlashCommandsWithOptions: vi.fn(async () => ({ pipe: 'slash-result' })),
    getWorldInfoNames: vi.fn(() => ['书A', '书B']),
    characters: [],
    characterId: 0,
    chat: [],
    ...overrides,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
});

afterEach(() => {
  delete (globalThis as any).fetch;
});

describe('isUsable', () => {
  it('loadWorldInfo / saveWorldInfo / executeSlashCommandsWithOptions 齐备时可用', () => {
    const backend = createNativeStBackend_ACU(() => buildContext());
    expect(backend.isUsable()).toBe(true);
  });

  it('context 缺失或最低接口不齐时不可用', () => {
    expect(createNativeStBackend_ACU(() => undefined).isUsable()).toBe(false);
    const partial = buildContext();
    delete partial.saveWorldInfo;
    expect(createNativeStBackend_ACU(() => partial).isUsable()).toBe(false);
  });

  it('getStApi 抛异常时按不可用处理，不把异常外抛', () => {
    expect(createNativeStBackend_ACU(() => { throw new Error('getContext 未就绪'); }).isUsable()).toBe(false);
  });
});

describe('getLorebooks', () => {
  it('优先原生 getWorldInfoNames，不发起 /api/settings/get 请求', async () => {
    const ctx = buildContext({ getWorldInfoNames: vi.fn(() => ['剧情书', '世界书']) });
    const backend = createNativeStBackend_ACU(() => ctx);

    expect(await backend.getLorebooks()).toEqual(['剧情书', '世界书']);
    expect(ctx.getWorldInfoNames).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getWorldInfoNames 缺失时降级到 /api/settings/get 的 world_names', async () => {
    const ctx = buildContext();
    delete ctx.getWorldInfoNames;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ world_names: ['降级书'], settings: JSON.stringify({}) }),
    });
    const backend = createNativeStBackend_ACU(() => ctx);

    expect(await backend.getLorebooks()).toEqual(['降级书']);
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/get', expect.objectContaining({ method: 'POST' }));
  });

  it('getWorldInfoNames 抛异常时降级到 /api/settings/get 并告警', async () => {
    const ctx = buildContext({
      getWorldInfoNames: vi.fn(() => { throw new Error('宿主未初始化'); }),
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ world_names: ['降级书'], settings: '{}' }),
    });
    const backend = createNativeStBackend_ACU(() => ctx);

    expect(await backend.getLorebooks()).toEqual(['降级书']);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('getWorldInfoNames 调用失败'),
      expect.any(Error),
    );
  });

  it('两条通道都不可用时返回空数组', async () => {
    const ctx = buildContext();
    delete ctx.getWorldInfoNames;
    fetchMock.mockResolvedValue({ ok: 500, status: 500 });
    const backend = createNativeStBackend_ACU(() => ctx);

    expect(await backend.getLorebooks()).toEqual([]);
  });
});

describe('charLore 解析（settings.world_info_settings.world_info.charLore）', () => {
  const charLore = [{ name: 'hero', extraBooks: ['附加书A', '附加书B'] }];

  function settingsResponse(payload: unknown) {
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload });
  }

  it('按 dev 实证形状读到角色附加世界书', async () => {
    settingsResponse({
      world_names: ['附加书A', '附加书B'],
      settings: JSON.stringify({ world_info_settings: { world_info: { charLore } } }),
    });
    const ctx = buildContext({
      getWorldInfoNames: undefined,
      characters: [{ name: '主角', avatar: 'hero.png', data: { extensions: { world: '主书' } } }],
      characterId: 0,
    });
    const backend = createNativeStBackend_ACU(() => ctx);

    expect(await backend.getCharWorldbookNames('current')).toEqual({
      primary: '主书',
      additional: ['附加书A', '附加书B'],
    });
  });

  it('旧错误形状 settings.world_info.charLore 不再被消费（回归守卫）', async () => {
    settingsResponse({
      world_names: [],
      settings: JSON.stringify({ world_info: { charLore } }),
    });
    const ctx = buildContext({
      getWorldInfoNames: undefined,
      characters: [{ name: '主角', avatar: 'hero.png', data: { extensions: { world: '主书' } } }],
      characterId: 0,
    });
    const backend = createNativeStBackend_ACU(() => ctx);

    expect(await backend.getCharWorldbookNames('current')).toEqual({
      primary: '主书',
      additional: [],
    });
  });

  it('charLore 匹配键是去掉扩展名的头像文件名', async () => {
    settingsResponse({
      world_names: [],
      settings: JSON.stringify({ world_info_settings: { world_info: { charLore: [{ name: 'hero', extraBooks: ['X'] }] } } }),
    });
    const ctx = buildContext({
      getWorldInfoNames: undefined,
      characters: [{ name: '主角', avatar: 'hero.webp', data: {} }],
      characterId: 0,
    });
    const backend = createNativeStBackend_ACU(() => ctx);

    expect(await backend.getCharWorldbookNames('current')).toEqual({ primary: null, additional: ['X'] });
  });

  it('settings 不是合法 JSON 时降级为无附加书且不抛错', async () => {
    settingsResponse({ world_names: [], settings: '{ not json' });
    const ctx = buildContext({
      getWorldInfoNames: undefined,
      characters: [{ name: '主角', avatar: 'hero.png', data: {} }],
      characterId: 0,
    });
    const backend = createNativeStBackend_ACU(() => ctx);

    await expect(backend.getCharWorldbookNames('current')).resolves.toEqual({ primary: null, additional: [] });
    expect(mockLogWarn).toHaveBeenCalled();
  });
});

describe('世界书条目 CRUD（loadWorldInfo / saveWorldInfo 通道）', () => {
  it('getLorebookEntries 把原生 entries 字典转成旧版扁平条目', async () => {
    const ctx = buildContext({
      loadWorldInfo: vi.fn(async () => ({
        entries: {
          7: {
            uid: 7,
            comment: '条目7',
            content: '正文7',
            key: ['k1'],
            position: 4,
            role: 2,
            depth: 3,
            disable: false,
            constant: true,
          },
        },
      })),
    });
    const backend = createNativeStBackend_ACU(() => ctx);

    const entries = await backend.getLorebookEntries('书A');
    expect(ctx.loadWorldInfo).toHaveBeenCalledWith('书A');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      uid: 7,
      comment: '条目7',
      content: '正文7',
      keys: ['k1'],
      position: 'at_depth_as_assistant',
      depth: 3,
      type: 'constant',
      enabled: true,
    });
  });

  it('世界书不存在时抛出可被 not-found 分类识别的中文错误', async () => {
    const ctx = buildContext({ loadWorldInfo: vi.fn(async () => null) });
    const backend = createNativeStBackend_ACU(() => ctx);

    await expect(backend.getLorebookEntries('幽灵书')).rejects.toThrow('世界书 "幽灵书" 不存在');
  });

  it('setLorebookEntries 只改存在的 uid 并整本保存一次', async () => {
    const saveWorldInfo = vi.fn(async () => undefined);
    const ctx = buildContext({
      loadWorldInfo: vi.fn(async () => ({ entries: { 1: { uid: 1, content: '旧' } } })),
      saveWorldInfo,
    });
    const backend = createNativeStBackend_ACU(() => ctx);

    await backend.setLorebookEntries('书A', [
      { uid: 1, content: '新' },
      { uid: 99, content: '不存在' },
    ]);

    expect(saveWorldInfo).toHaveBeenCalledTimes(1);
    expect(saveWorldInfo.mock.calls[0][2]).toBe(true);
    expect(saveWorldInfo.mock.calls[0][1].entries[1].content).toBe('新');
    expect(saveWorldInfo.mock.calls[0][1].entries[99]).toBeUndefined();
  });

  it('createLorebookEntries 分配递增 uid 并返回新 uid 列表', async () => {
    const saveWorldInfo = vi.fn(async () => undefined);
    const ctx = buildContext({
      loadWorldInfo: vi.fn(async () => ({ entries: { 3: { uid: 3, content: '旧' } } })),
      saveWorldInfo,
    });
    const backend = createNativeStBackend_ACU(() => ctx);

    const result = await backend.createLorebookEntries('书A', [{ content: '新1' }, { content: '新2' }]);
    expect(result.new_uids).toEqual([4, 5]);
    expect(result.entries).toHaveLength(3);
    expect(saveWorldInfo).toHaveBeenCalledTimes(1);
  });

  it('deleteLorebookEntries 删除后回写并报告 delete_occurred', async () => {
    const saveWorldInfo = vi.fn(async () => undefined);
    const ctx = buildContext({
      loadWorldInfo: vi.fn(async () => ({ entries: { 1: { uid: 1 }, 2: { uid: 2 } } })),
      saveWorldInfo,
    });
    const backend = createNativeStBackend_ACU(() => ctx);

    const result = await backend.deleteLorebookEntries('书A', [2]);
    expect(result.delete_occurred).toBe(true);
    expect(result.entries.map(e => e.uid)).toEqual([1]);
    expect(saveWorldInfo.mock.calls[0][1].entries[2]).toBeUndefined();
  });
});

describe('聊天 / slash / 角色数据', () => {
  it('getChatMessages 按 range 取楼层并映射旧版消息形状', async () => {
    const ctx = buildContext({
      chat: [
        { name: '用户', mes: '你好', is_user: true },
        { name: '角色', mes: '回复', is_user: false, swipe_id: 0, swipes: ['回复', '备选'] },
        { name: '系统', mes: '旁白', is_system: true },
      ],
    });
    const backend = createNativeStBackend_ACU(() => ctx);

    const all = await backend.getChatMessages('0-2');
    expect(all.map((m: any) => m.role)).toEqual(['user', 'assistant', 'system']);
    expect(all[1]).toMatchObject({ message_id: 1, name: '角色', message: '回复', is_hidden: false });

    const onlyAi = await backend.getChatMessages('0-2', { role: 'assistant' });
    expect(onlyAi.map((m: any) => m.message_id)).toEqual([1]);

    const withSwipes = await backend.getChatMessages(1, { include_swipes: true });
    expect(withSwipes[0]).toMatchObject({ swipe_id: 0, swipes: ['回复', '备选'] });
  });

  it('负数 range 从尾部解析；无法解析的 range 返回空数组并告警', async () => {
    const ctx = buildContext({ chat: [{ mes: 'a' }, { mes: 'b' }, { mes: 'c' }] });
    const backend = createNativeStBackend_ACU(() => ctx);

    expect((await backend.getChatMessages('-1')).map((m: any) => m.message)).toEqual(['c']);
    expect(await backend.getChatMessages('not-a-range')).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('无法解析 range'));
  });

  it('getLastMessageId 反映 chat 长度', () => {
    expect(createNativeStBackend_ACU(() => buildContext({ chat: [{}, {}] })).getLastMessageId()).toBe(1);
    expect(createNativeStBackend_ACU(() => buildContext({ chat: [] })).getLastMessageId()).toBe(-1);
  });

  it('triggerSlash 走 executeSlashCommandsWithOptions 并取 pipe', async () => {
    const ctx = buildContext();
    const backend = createNativeStBackend_ACU(() => ctx);
    expect(await backend.triggerSlash('/hello')).toBe('slash-result');
    expect(ctx.executeSlashCommandsWithOptions).toHaveBeenCalledWith('/hello');
  });

  it('getCharData 支持按名字/头像查找与 current 解析', async () => {
    const characters = [{ name: '主角', avatar: 'hero.png' }, { name: '配角', avatar: 'side.png' }];
    const backend = createNativeStBackend_ACU(() => buildContext({ characters, characterId: 1 }));
    expect(backend.getCharData('current')).toBe(characters[1]);
    expect(backend.getCharData('主角')).toBe(characters[0]);
    expect(backend.getCharData('side.png')).toBe(characters[1]);
    expect(backend.getCharData('不存在')).toBeNull();
  });

  it('invalidateSettingsSnapshot 后重新拉取列表快照', async () => {
    const ctx = buildContext();
    delete ctx.getWorldInfoNames;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ world_names: ['第一轮'], settings: '{}' }) });
    const backend = createNativeStBackend_ACU(() => ctx);

    expect(await backend.getLorebooks()).toEqual(['第一轮']);
    expect(await backend.getLorebooks()).toEqual(['第一轮']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ world_names: ['第二轮'], settings: '{}' }) });
    backend.invalidateSettingsSnapshot();
    expect(await backend.getLorebooks()).toEqual(['第二轮']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
