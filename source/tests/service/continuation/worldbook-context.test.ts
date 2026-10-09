import { beforeEach, describe, expect, it, vi } from 'vitest';

const worldbookDoubles = vi.hoisted(() => ({
  readConfig: vi.fn(() => ({ source: 'character' })),
  activeNames: vi.fn(async () => ['激活全局书', '角色绑定书']),
  characterBinding: vi.fn(async () => ({ orderedNames: ['角色绑定书'] })),
}));

vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: worldbookDoubles.readConfig,
}));
vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({
  getActiveWorldbookNamesForFill_ACU: worldbookDoubles.activeNames,
}));
vi.mock('../../../src/data/gateways/character-gateway', () => ({
  getCurrentCharacterWorldbookBinding_ACU: worldbookDoubles.characterBinding,
}));
vi.mock('../../../src/service/worldbook/pipeline', () => ({
  buildCombinedWorldbookContentByStrategy_ACU: vi.fn(),
  getLorebookEntriesByNames_ACU: vi.fn(),
}));
vi.mock('../../../src/service/worldbook/injection-engine-state', () => ({
  getIsolationPrefix_ACU: () => '',
  getInjectionTargetLorebook_ACU: async () => null,
}));
vi.mock('../../../src/shared/utils', () => ({ logWarn_ACU: vi.fn() }));

import {
  ContinuationWorldbookContext_ACU,
  isSummaryIndexEntryComment_ACU,
  normalizeAmCode_ACU,
  resolveRelevantBookNames_ACU,
  type ContinuationWorldbookAdapterDependencies_ACU,
} from '../../../src/service/continuation/worldbook-context';

function createDependencies_ACU(overrides: Partial<ContinuationWorldbookAdapterDependencies_ACU> = {}) {
  return {
    resolveRelevantBookNames: vi.fn().mockResolvedValue(['角色书', '附加书']),
    resolveInjectionTarget: vi.fn().mockResolvedValue('纪要书'),
    getIsolationPrefix: vi.fn().mockReturnValue('ACU-[chat-a]-'),
    buildRelevantWorldbookContent: vi.fn().mockResolvedValue('相关世界书背景'),
    readLorebookEntries: vi.fn().mockResolvedValue({}),
    logReadFailure: vi.fn(),
    ...overrides,
  } satisfies ContinuationWorldbookAdapterDependencies_ACU;
}

describe('ContinuationWorldbookContext_ACU', () => {
  it('uses the configured relevant books and excludes generated entries from $1 selection', async () => {
    const dependencies = createDependencies_ACU();
    const context = new ContinuationWorldbookContext_ACU(dependencies);

    await expect(context.readRelevantBackground('最近剧情')).resolves.toBe('相关世界书背景');

    expect(dependencies.resolveRelevantBookNames).toHaveBeenCalledTimes(1);
    expect(dependencies.buildRelevantWorldbookContent).toHaveBeenCalledWith(expect.objectContaining({
      bookNames: ['角色书', '附加书'],
      baseScanText: '最近剧情',
    }));
    const options = vi.mocked(dependencies.buildRelevantWorldbookContent).mock.calls[0][0] as any;
    // 屏蔽集合收窄为「纪要 + 纪要索引」：纪要（含旧总结残留）与纪要索引及其数字分片必须屏蔽，
    // 其余已启用条目（表格导出、大纲载体、重要人物等）交由世界书方案决定是否注入。
    expect(options.excludeEntry({ comment: 'ACU-[chat-a]-总结条目1' })).toBe(true);
    expect(options.excludeEntry({ comment: 'ACU-[chat-a]-小总结条目2' })).toBe(true);
    expect(options.excludeEntry({ comment: 'ACU-[chat-a]-TavernDB-ACU-CustomExport-纪要索引' })).toBe(true);
    expect(options.excludeEntry({ comment: 'ACU-[chat-a]-TavernDB-ACU-CustomExport-纪要索引-1' })).toBe(true);
    expect(options.excludeEntry({ comment: 'ACU-[chat-a]-TavernDB-ACU-CustomExport-纪要索引-2' })).toBe(true);
    expect(options.excludeEntry({ comment: 'ACU-[chat-a]-TavernDB-ACU-CustomExport-角色表-1' })).toBe(false);
    expect(options.excludeEntry({ comment: 'ACU-[chat-a]-TavernDB-ACU-CustomExport-角色表-索引' })).toBe(false);
    expect(options.excludeEntry({ comment: 'ACU-[chat-a]-TavernDB-ACU-CustomExport-纪要-3' })).toBe(false);
    expect(options.excludeEntry({ comment: 'ACU-[chat-a]-TavernDB-ACU-OutlineTable-1' })).toBe(false);
    expect(options.excludeEntry({ comment: 'ACU-[chat-a]-重要人物条目3' })).toBe(false);
    expect(options.excludeEntry({ comment: '普通设定' })).toBe(false);
    expect(dependencies.resolveInjectionTarget).not.toHaveBeenCalled();
    expect(dependencies.readLorebookEntries).not.toHaveBeenCalled();
  });

  it('returns empty background when configured book resolution fails', async () => {
    const dependencies = createDependencies_ACU({ resolveRelevantBookNames: vi.fn().mockRejectedValue(new Error('binding unavailable')) });
    const context = new ContinuationWorldbookContext_ACU(dependencies);

    await expect(context.readRelevantBackground('剧情')).resolves.toBe('');
    expect(dependencies.buildRelevantWorldbookContent).not.toHaveBeenCalled();
    expect(dependencies.logReadFailure).toHaveBeenCalledWith('background');
  });

  it('returns empty background without touching the pipeline when no book is configured', async () => {
    const dependencies = createDependencies_ACU({ resolveRelevantBookNames: vi.fn().mockResolvedValue([]) });
    const context = new ContinuationWorldbookContext_ACU(dependencies);

    await expect(context.readRelevantBackground('剧情')).resolves.toBe('');
    expect(dependencies.buildRelevantWorldbookContent).not.toHaveBeenCalled();
    expect(dependencies.logReadFailure).not.toHaveBeenCalled();
  });
});

describe('resolveRelevantBookNames_ACU', () => {
  // vi.hoisted 的 spy 计数跨用例累积：active 用例会真实触发 activeNames，
  // 不清计数会让后续用例的 not.toHaveBeenCalled 断言吃到历史调用。
  beforeEach(() => {
    worldbookDoubles.activeNames.mockClear();
    worldbookDoubles.characterBinding.mockClear();
  });

  it('takes the active-source book set from the same resolver the fill pipeline uses', async () => {
    worldbookDoubles.readConfig.mockReturnValueOnce({ source: 'active' });

    await expect(resolveRelevantBookNames_ACU()).resolves.toEqual(['激活全局书', '角色绑定书']);
    expect(worldbookDoubles.activeNames).toHaveBeenCalledTimes(1);
    expect(worldbookDoubles.characterBinding).not.toHaveBeenCalled();
  });

  it('still falls back to the character binding for the character source', async () => {
    worldbookDoubles.readConfig.mockReturnValueOnce({ source: 'character' });

    await expect(resolveRelevantBookNames_ACU()).resolves.toEqual(['角色绑定书']);
    expect(worldbookDoubles.activeNames).not.toHaveBeenCalled();
  });
});

describe('normalizeAmCode_ACU', () => {

  it('rejects non-AM inputs instead of guessing', () => {
    expect(normalizeAmCode_ACU('not-an-am')).toBeNull();
    expect(normalizeAmCode_ACU('')).toBeNull();
    expect(normalizeAmCode_ACU(null)).toBeNull();
  });
});

describe('纪要索引识别（TT 移植上游 86be318e 屏蔽判据）', () => {
  it('只识别纪要索引及数字分片，不屏蔽普通表格及其索引', () => {
    expect(isSummaryIndexEntryComment_ACU('TavernDB-ACU-CustomExport-纪要索引')).toBe(true);
    expect(isSummaryIndexEntryComment_ACU('TavernDB-ACU-CustomExport-纪要索引-12')).toBe(true);
    expect(isSummaryIndexEntryComment_ACU('TavernDB-ACU-CustomExport-角色表-索引')).toBe(false);
    expect(isSummaryIndexEntryComment_ACU('TavernDB-ACU-CustomExport-纪要索引-说明')).toBe(false);
    // 数字分片必须以 1 开头的十进制序号出现；前导零与其它后缀都不算索引分片。
    expect(isSummaryIndexEntryComment_ACU('TavernDB-ACU-CustomExport-纪要索引-0')).toBe(false);
    expect(isSummaryIndexEntryComment_ACU('TavernDB-ACU-CustomExport-纪要索引-01')).toBe(false);
    // 外部导入变体不带 CustomExport 标记时按普通条目放行。
    expect(isSummaryIndexEntryComment_ACU('外部导入-纪要索引')).toBe(false);
  });
});
