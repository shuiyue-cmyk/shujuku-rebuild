/**
 * tests/data/gateways/worldbook-gateway.test.ts
 * 世界书 CRUD 操作网关 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTavernHelper, mockSillyTavern, mockLogWarn, mockIsExtensionMode } = vi.hoisted(() => ({
  mockTavernHelper: {} as any,
  mockSillyTavern: {} as any,
  mockLogWarn: vi.fn(),
  mockIsExtensionMode: vi.fn(() => true),
}));

vi.mock('../../../src/shared/runtime-env', () => ({
  isExtensionMode: () => mockIsExtensionMode(),
}));

vi.mock('../../../src/shared/host-api', () => ({
  TavernHelper_API_ACU: mockTavernHelper,
  SillyTavern_API_ACU: mockSillyTavern,
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
}));

import {
  isWorldbookApiAvailable_ACU,
  normalizeLorebookNameForMatch_ACU,
  resolveLorebookNameFromList_ACU,
  isLorebookNotFoundError_ACU,
  getLorebookEntries_ACU,
  setLorebookEntries_ACU,
  createLorebookEntries_ACU,
  deleteLorebookEntries_ACU,
  listLorebooks_ACU,
  getWorldBooks_ACU,
  getWorldBooksWithEntriesViaNative_ACU,
  collectActiveWorldbookNamesFromModule_ACU,
  getActiveGlobalWorldbookNamesAsync_ACU,
  getActiveWorldbookNamesForFill_ACU,
  loadHostWorldInfoModule_ACU,
  resetHostWorldInfoModuleCache_ACU,
  getCurrentCharPrimaryLorebook_ACU,
  getCharLorebooks_ACU,
} from '../../../src/data/gateways/worldbook-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockTavernHelper).forEach(k => delete mockTavernHelper[k]);
  Object.keys(mockSillyTavern).forEach(k => delete mockSillyTavern[k]);
  mockIsExtensionMode.mockReturnValue(true);
});

describe('isWorldbookApiAvailable_ACU', () => {
  it('API 不可用返回 false', () => {
    expect(isWorldbookApiAvailable_ACU()).toBe(false);
  });

  it('API 可用返回 true', () => {
    mockTavernHelper.getLorebookEntries = vi.fn();
    expect(isWorldbookApiAvailable_ACU()).toBe(true);
  });
});

describe('世界书名称匹配', () => {
  it('兼容全角字符、零宽字符、NBSP 与组合字符差异', () => {
    expect(normalizeLorebookNameForMatch_ACU('  ＡＢ\u200BＣ\u00A0e\u0301  ')).toBe('ABC é');
    expect(resolveLorebookNameFromList_ACU('ＡＢ\u200BＣ', ['ABC'])).toBe('ABC');
  });

  it('匹配时返回宿主列表中的原始真实名称', () => {
    expect(resolveLorebookNameFromList_ACU('剧情书', ['剧\u200B情书'])).toBe('剧\u200B情书');
  });

  it('归一化后出现重名时拒绝猜测', () => {
    expect(resolveLorebookNameFromList_ACU('ＡＢＣ', ['ABC', 'ＡＢＣ\u200B'])).toBeNull();
  });

  it('宿主书名带首尾空格时返回原始名（trim 仅用于匹配键），不得返回 trim 结果', () => {
    // 回归：resolver 返回 trim 后的名字会让后续宿主调用按不存在的名字索引 → not-found。
    expect(resolveLorebookNameFromList_ACU('剧情书', [' 剧情书 '])).toBe(' 剧情书 ');
    expect(resolveLorebookNameFromList_ACU(' 剧情书 ', [' 剧情书 '])).toBe(' 剧情书 ');
    expect(resolveLorebookNameFromList_ACU('剧情书', [{ name: '剧情书\u3000' }])).toBe('剧情书\u3000');
  });

  it('trim 后同名的多本书属于歧义，拒绝猜测；字节级精确命中优先生效', () => {
    expect(resolveLorebookNameFromList_ACU('剧情书', ['剧情书 ', ' 剧情书'])).toBeNull();
    expect(resolveLorebookNameFromList_ACU('剧情书 ', ['剧情书 ', ' 剧情书'])).toBe('剧情书 ');
  });
});

describe('isLorebookNotFoundError_ACU', () => {
  it.each([
    new Error('Worldbook "ghost" not found'),
    new Error('Could not find the lorebook'),
    new Error('世界书“旧书”不存在'),
    new Error('未能找到世界书'),
  ])('识别明确的世界书不存在错误', error => {
    expect(isLorebookNotFoundError_ACU(error)).toBe(true);
  });

  it.each([
    Object.assign(new Error('Worldbook "ghost" not found'), { name: 'AbortError' }),
    new Error('TaskAbortedByUser'),
    new Error('permission denied'),
    new Error('network unavailable'),
  ])('不把取消或其它读取故障归类为世界书不存在', error => {
    expect(isLorebookNotFoundError_ACU(error)).toBe(false);
  });
});

describe('getLorebookEntries_ACU', () => {
  it('API 不可用返回空数组', async () => {
    expect(await getLorebookEntries_ACU('book1')).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('API 可用返回条目', async () => {
    const entries = [{ uid: 1, content: '条目1' }];
    mockTavernHelper.getLorebookEntries = vi.fn().mockResolvedValue(entries);
    expect(await getLorebookEntries_ACU('book1')).toEqual(entries);
  });

  it('将宿主返回的非字符串 comment/name 归一为空串且不污染原对象', async () => {
    const entries: any[] = [
      { uid: 1, comment: 2024, name: { invalid: true } },
      { uid: 2, comment: '  保留空白  ', name: '正常名称' },
      { uid: 3, comment: null },
      null,
      'unexpected-entry',
    ];
    mockTavernHelper.getLorebookEntries = vi.fn().mockResolvedValue(entries);

    const result = await getLorebookEntries_ACU('book1');

    expect(result).toEqual([
      { uid: 1, comment: '', name: '' },
      { uid: 2, comment: '  保留空白  ', name: '正常名称' },
      { uid: 3, comment: '' },
      null,
      'unexpected-entry',
    ]);
    expect(result[0]).not.toBe(entries[0]);
    expect(result[1]).toBe(entries[1]);
    expect(entries[0]).toEqual({ uid: 1, comment: 2024, name: { invalid: true } });
    expect(mockLogWarn).toHaveBeenCalledWith(
      '[WorldbookGateway] 已归一化宿主返回的非字符串世界书条目文本字段。',
      expect.objectContaining({
        phase: 'normalize_entry_text_field',
        bookName: 'book1',
        normalizedFields: expect.arrayContaining([
          { uid: 1, field: 'comment', sourceType: 'number' },
          { uid: 1, field: 'name', sourceType: 'object' },
          { uid: 3, field: 'comment', sourceType: 'object' },
        ]),
      }),
    );
  });

  it('名称仅有 Unicode 或不可见字符差异时使用宿主真实名称重试', async () => {
    const entries = [{ uid: 1, content: '条目1' }];
    mockTavernHelper.getLorebookEntries = vi.fn()
      .mockRejectedValueOnce(new Error('Worldbook "ABC" not found'))
      .mockResolvedValueOnce(entries);
    mockTavernHelper.getLorebooks = vi.fn().mockResolvedValue(['ＡＢ\u200BＣ']);

    expect(await getLorebookEntries_ACU('ABC')).toEqual(entries);
    expect(mockTavernHelper.getLorebookEntries).toHaveBeenNthCalledWith(1, 'ABC');
    expect(mockTavernHelper.getLorebookEntries).toHaveBeenNthCalledWith(2, 'ＡＢ\u200BＣ');
  });

  it('名称恢复重试路径同样归一化条目文本字段', async () => {
    mockTavernHelper.getLorebookEntries = vi.fn()
      .mockRejectedValueOnce(new Error('Worldbook "ABC" not found'))
      .mockResolvedValueOnce([{ uid: 1, comment: true }]);
    mockTavernHelper.getLorebooks = vi.fn().mockResolvedValue(['ＡＢ\u200BＣ']);

    await expect(getLorebookEntries_ACU('ABC')).resolves.toEqual([{ uid: 1, comment: '' }]);
  });

  it('真实名称重试失败时保留首次 not-found 错误并附加重试诊断', async () => {
    const originalError = new Error('Worldbook "ABC" not found');
    const retryError = new Error('network unavailable');
    mockTavernHelper.getLorebookEntries = vi.fn()
      .mockRejectedValueOnce(originalError)
      .mockRejectedValueOnce(retryError);
    mockTavernHelper.getLorebooks = vi.fn().mockResolvedValue(['ＡＢ\u200BＣ']);

    await expect(getLorebookEntries_ACU('ABC')).rejects.toBe(originalError);
    expect((originalError as any).lorebookResolvedName).toBe('ＡＢ\u200BＣ');
    expect((originalError as any).lorebookRetryError).toBe(retryError);
  });

  it('原始错误不可扩展时仍保留错误对象并输出脱敏重试诊断', async () => {
    const sensitiveText = '不得泄露的宿主错误正文';
    const originalError = Object.preventExtensions(new Error('Worldbook "ABC" not found'));
    const retryError = new Error(sensitiveText);
    mockTavernHelper.getLorebookEntries = vi.fn()
      .mockRejectedValueOnce(originalError)
      .mockRejectedValueOnce(retryError);
    mockTavernHelper.getLorebooks = vi.fn().mockResolvedValue(['ＡＢ\u200BＣ']);

    await expect(getLorebookEntries_ACU('ABC')).rejects.toBe(originalError);
    expect(mockLogWarn).toHaveBeenCalledWith(
      '[WorldbookGateway] 世界书真实名称重试失败，原始错误对象不可扩展。',
      {
        phase: 'retry_resolved_lorebook_name',
        requestedName: 'ABC',
        resolvedName: 'ＡＢ\u200BＣ',
        error: { category: 'read_failed' },
      },
    );
    expect(JSON.stringify(mockLogWarn.mock.calls)).not.toContain(sensitiveText);
  });

  it('非 not-found 错误不枚举列表也不重试', async () => {
    const error = new Error('permission denied');
    mockTavernHelper.getLorebookEntries = vi.fn().mockRejectedValue(error);
    mockTavernHelper.getLorebooks = vi.fn();

    await expect(getLorebookEntries_ACU('ABC')).rejects.toBe(error);
    expect(mockTavernHelper.getLorebooks).not.toHaveBeenCalled();
    expect(mockTavernHelper.getLorebookEntries).toHaveBeenCalledTimes(1);
  });
});

describe('setLorebookEntries_ACU', () => {
  it('API 不可用时静默跳过', async () => {
    await setLorebookEntries_ACU('book1', []);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('API 可用时调用', async () => {
    mockTavernHelper.setLorebookEntries = vi.fn().mockResolvedValue(undefined);
    await setLorebookEntries_ACU('book1', [{ uid: 1 }]);
    expect(mockTavernHelper.setLorebookEntries).toHaveBeenCalledWith('book1', [{ uid: 1 }]);
  });
});

describe('createLorebookEntries_ACU', () => {
  it('API 不可用时静默跳过', async () => {
    await createLorebookEntries_ACU('book1', []);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('API 可用时调用', async () => {
    mockTavernHelper.createLorebookEntries = vi.fn().mockResolvedValue(undefined);
    await createLorebookEntries_ACU('book1', [{ content: '新条目' }]);
    expect(mockTavernHelper.createLorebookEntries).toHaveBeenCalled();
  });
});

describe('deleteLorebookEntries_ACU', () => {
  it('API 不可用时静默跳过', async () => {
    await deleteLorebookEntries_ACU('book1', [1]);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('API 可用时调用', async () => {
    mockTavernHelper.deleteLorebookEntries = vi.fn().mockResolvedValue(undefined);
    await deleteLorebookEntries_ACU('book1', [1, 2]);
    expect(mockTavernHelper.deleteLorebookEntries).toHaveBeenCalledWith('book1', [1, 2]);
  });
});

describe('listLorebooks_ACU', () => {
  it('两个 API 都不可用返回空数组', async () => {
    expect(await listLorebooks_ACU()).toEqual([]);
  });

  it('优先使用 TavernHelper', async () => {
    mockTavernHelper.getLorebooks = vi.fn().mockResolvedValue(['book1', 'book2']);
    mockSillyTavern.getWorldBooks = vi.fn().mockResolvedValue(['book3']);
    mockSillyTavern.getWorldInfoNames = vi.fn(() => ['book4']);
    expect(await listLorebooks_ACU()).toEqual(['book1', 'book2']);
    expect(mockSillyTavern.getWorldInfoNames).not.toHaveBeenCalled();
  });

  it('TavernHelper 不可用时降级到 SillyTavern', async () => {
    mockSillyTavern.getWorldBooks = vi.fn().mockResolvedValue(['book3']);
    expect(await listLorebooks_ACU()).toEqual(['book3']);
  });

  it('第三级：TT 原生 context.getWorldInfoNames() 返回 string[] 名称列表', async () => {
    mockSillyTavern.getWorldInfoNames = vi.fn(() => ['剧情书', '设定书']);
    const result = await listLorebooks_ACU();
    expect(result).toEqual(['剧情书', '设定书']);
    expect(mockSillyTavern.getWorldInfoNames).toHaveBeenCalledTimes(1);
  });

  it('第三级返回值可被 resolveLorebookNameFromList_ACU 直接消费（含不可见字符真实名）', async () => {
    mockSillyTavern.getWorldInfoNames = vi.fn(() => ['AB\u200BC']);
    expect(resolveLorebookNameFromList_ACU('ABC', await listLorebooks_ACU())).toBe('AB\u200BC');
  });

  it('getWorldInfoNames 抛异常时降级为空数组并告警', async () => {
    mockSillyTavern.getWorldInfoNames = vi.fn(() => { throw new Error('宿主未就绪'); });
    expect(await listLorebooks_ACU()).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('getWorldInfoNames 调用失败'));
  });
});

describe('getWorldBooksWithEntriesViaNative_ACU', () => {
  it('原生 loadWorldInfo 不可用时返回空列表并告警', async () => {
    expect(await getWorldBooksWithEntriesViaNative_ACU(['书A'])).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('loadWorldInfo 不可用'));
  });

  it('把 entries 字典转成 {name, entries} 旧版扁平条目形状', async () => {
    const loadWorldInfo = vi.fn(async (name: string) => ({
      entries: {
        7: { uid: 7, comment: `${name}-名`, content: `${name}-正文`, key: ['k'], position: 4, role: 0, depth: 2 },
      },
    }));
    mockSillyTavern.loadWorldInfo = loadWorldInfo;

    const books = await getWorldBooksWithEntriesViaNative_ACU(['书A']);

    expect(loadWorldInfo).toHaveBeenCalledWith('书A');
    expect(books).toEqual([
      { name: '书A', entries: [expect.objectContaining({ uid: 7, comment: '书A-名', content: '书A-正文', position: 'at_depth_as_system', depth: 2 })] },
    ]);
  });

  it('世界书不存在（loadWorldInfo 返回 null）时跳过该书且不产空壳', async () => {
    mockSillyTavern.loadWorldInfo = vi.fn(async () => null);
    expect(await getWorldBooksWithEntriesViaNative_ACU(['幽灵书'])).toEqual([]);
  });

  it('单本抛错不影响其它书', async () => {
    mockSillyTavern.loadWorldInfo = vi.fn(async (name: string) => {
      if (name === '坏书') throw new Error('network unavailable');
      return { entries: { 1: { uid: 1, content: 'ok' } } };
    });

    const books = await getWorldBooksWithEntriesViaNative_ACU(['坏书', '好书']);

    expect(books.map(b => b.name)).toEqual(['好书']);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('读取单本世界书失败'),
      expect.objectContaining({ phase: 'native_load_worldbook', bookName: '坏书' }),
    );
  });

  it('宿主书名不得 trim：带空格名按原样读取，仅空串/null 被过滤', async () => {
    const loadWorldInfo = vi.fn(async () => ({ entries: {} }));
    mockSillyTavern.loadWorldInfo = loadWorldInfo;

    await getWorldBooksWithEntriesViaNative_ACU(['书A', ' 书A ', '', null as any]);

    // 回归：trim 会让带首尾空格的真实书名 loadWorldInfo not-found 静默丢书（:50-57 宿主名契约）
    expect(loadWorldInfo).toHaveBeenCalledTimes(2);
    expect(loadWorldInfo).toHaveBeenCalledWith('书A');
    expect(loadWorldInfo).toHaveBeenCalledWith(' 书A ');
  });
});

describe('激活世界书宿主模块通道（TT 裸环境）', () => {
  it('collectActiveWorldbookNamesFromModule_ACU 读 selected_world_info live binding 与 getWorldInfoSettings().world_info.globalSelect', () => {
    const mod = {
      selected_world_info: ['激活书A', ' 激活书B '],
      getWorldInfoSettings: () => ({ world_info: { globalSelect: ['全局书C', '激活书A'] } }),
    };
    expect(collectActiveWorldbookNamesFromModule_ACU(mod)).toEqual(['激活书A', '激活书B', '全局书C']);
  });

  it('模块缺少 getWorldInfoSettings 或字段形状异常时安静降级', () => {
    expect(collectActiveWorldbookNamesFromModule_ACU({ selected_world_info: 'not-an-array' })).toEqual([]);
    expect(collectActiveWorldbookNamesFromModule_ACU({ getWorldInfoSettings: () => null })).toEqual([]);
    expect(collectActiveWorldbookNamesFromModule_ACU({
      getWorldInfoSettings: () => { throw new Error('宿主未就绪'); },
      selected_world_info: ['仍然读到'],
    })).toEqual(['仍然读到']);
    expect(collectActiveWorldbookNamesFromModule_ACU(null)).toEqual([]);
  });

  it('getActiveGlobalWorldbookNamesAsync_ACU 合并全局链与模块链并去重', async () => {
    (globalThis as any).selected_world_info = ['全局书A'];
    try {
      const names = await getActiveGlobalWorldbookNamesAsync_ACU(async () => ({
        selected_world_info: ['模块书B', '全局书A'],
        getWorldInfoSettings: () => ({ world_info: { globalSelect: ['模块书B'] } }),
      }));
      expect(names).toEqual(['全局书A', '模块书B']);
    } finally {
      delete (globalThis as any).selected_world_info;
    }
  });

  it('模块加载抛错时保留全局链结果', async () => {
    (globalThis as any).power_user = { world_info: { globalSelect: ['旧ST全局书'] } };
    try {
      const names = await getActiveGlobalWorldbookNamesAsync_ACU(async () => { throw new Error('import failed'); });
      expect(names).toEqual(['旧ST全局书']);
    } finally {
      delete (globalThis as any).power_user;
    }
  });

  it('非酒馆宿主下真实动态 import 失败时降级为 null 并允许重试', async () => {
    mockIsExtensionMode.mockReturnValue(true);
    resetHostWorldInfoModuleCache_ACU();
    await expect(loadHostWorldInfoModule_ACU()).resolves.toBeNull();
    // 失败不缓存：再次调用会重新尝试（仍失败，但不会把 null 永久钉死）
    await expect(loadHostWorldInfoModule_ACU()).resolves.toBeNull();
    resetHostWorldInfoModuleCache_ACU();
  });

  it('油猴（iframe）模式下不尝试动态 import 宿主模块，直接返回 null', async () => {
    mockIsExtensionMode.mockReturnValue(false);
    resetHostWorldInfoModuleCache_ACU();
    mockLogWarn.mockClear();

    await expect(loadHostWorldInfoModule_ACU()).resolves.toBeNull();

    // 未发起 import ⇒ 不会在 iframe realm 里造出第二个 world-info 实例
    expect(mockLogWarn).not.toHaveBeenCalledWith(expect.stringContaining('动态 import 宿主 world-info 模块失败'), expect.anything());
    resetHostWorldInfoModuleCache_ACU();
  });

  it('getActiveWorldbookNamesForFill_ACU 把模块激活书与角色卡绑定书合并', async () => {
    mockTavernHelper.getCharLorebooks = vi.fn(async () => ({ primary: '角色主书', additional: ['角色附加书'] }));

    const names = await getActiveWorldbookNamesForFill_ACU(async () => ({
      selected_world_info: ['模块激活书'],
      getWorldInfoSettings: () => ({ world_info: { globalSelect: ['模块全局书'] } }),
    }));

    expect(names).toEqual(['模块激活书', '模块全局书', '角色主书', '角色附加书']);
  });

  it('宿主模块不可用时 getActiveWorldbookNamesForFill_ACU 仍返回角色卡绑定书', async () => {
    mockTavernHelper.getCharLorebooks = vi.fn(async () => ({ primary: '角色主书', additional: [] }));

    const names = await getActiveWorldbookNamesForFill_ACU(async () => { throw new Error('import failed'); });

    expect(names).toEqual(['角色主书']);
  });
});

describe('getWorldBooks_ACU', () => {
  it('API 不可用返回空数组', async () => {
    expect(await getWorldBooks_ACU()).toEqual([]);
  });

  it('API 可用返回列表', async () => {
    mockSillyTavern.getWorldBooks = vi.fn().mockResolvedValue(['book1']);
    expect(await getWorldBooks_ACU()).toEqual(['book1']);
  });
});

describe('getCurrentCharPrimaryLorebook_ACU', () => {
  it('API 不可用返回 null', async () => {
    expect(await getCurrentCharPrimaryLorebook_ACU()).toBeNull();
  });

  it('API 可用返回世界书名', async () => {
    mockTavernHelper.getCurrentCharPrimaryLorebook = vi.fn().mockResolvedValue('主世界书');
    expect(await getCurrentCharPrimaryLorebook_ACU()).toBe('主世界书');
  });
});

describe('getCharLorebooks_ACU', () => {
  it('API 不可用返回空对象', async () => {
    const result = await getCharLorebooks_ACU();
    expect(result).toEqual({ primary: '', additional: [] });
  });

  it('API 可用返回世界书列表', async () => {
    const data = { primary: ['book1'], additional: ['book2'] };
    mockTavernHelper.getCharLorebooks = vi.fn().mockResolvedValue(data);
    expect(await getCharLorebooks_ACU()).toEqual(data);
  });
});