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
    expect(options.excludeEntry({ comment: 'ACU-[chat-a]-总结条目1' })).toBe(true);
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

  it('normalizes the manual selection without touching either resolver', async () => {
    worldbookDoubles.readConfig.mockReturnValueOnce({ source: 'manual', manualSelection: [' 设定书 ', '', 42] });

    await expect(resolveRelevantBookNames_ACU()).resolves.toEqual(['设定书', '42']);
    expect(worldbookDoubles.activeNames).not.toHaveBeenCalled();
  });
});

describe('normalizeAmCode_ACU', () => {
  it('normalizes casing and whitespace of valid AM codes', () => {
    expect(normalizeAmCode_ACU(' am0010 ')).toBe('AM0010');
    expect(normalizeAmCode_ACU('AM0002')).toBe('AM0002');
  });

  it('rejects non-AM inputs instead of guessing', () => {
    expect(normalizeAmCode_ACU('not-an-am')).toBeNull();
    expect(normalizeAmCode_ACU('')).toBeNull();
    expect(normalizeAmCode_ACU(null)).toBeNull();
  });
});
