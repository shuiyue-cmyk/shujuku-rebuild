import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGuide = vi.fn();
const mockTemplate = vi.fn();

vi.mock('../../../src/service/template/chat-scope/chat-scope-guide', () => ({
  getChatSheetGuideDataForIsolationKey_ACU: (...args: any[]) => mockGuide(...args),
}));
vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: vi.fn(),
  parseTableTemplateJson_ACU: (...args: any[]) => mockTemplate(...args),
}));

const makeSheet = (ddl: string, headers: string[]) => ({
  uid: 'u', name: 'n',
  sourceData: { ddl },
  content: [headers],
});

let range: typeof import('../../../src/service/template/chat-scope/chat-scope-range');

beforeEach(async () => {
  vi.clearAllMocks();
  range = await import('../../../src/service/template/chat-scope/chat-scope-range');
});

describe('resolveTemplateScope_ACU', () => {
  it('优先用 sheet guide 的声明范围', () => {
    mockGuide.mockReturnValue({ mate: {}, sheet_a: makeSheet('CREATE TABLE a (row_id INTEGER PRIMARY KEY);', ['row_id']), sheet_b: makeSheet('CREATE TABLE b (row_id INTEGER PRIMARY KEY);', ['row_id']) });
    const scope = range.resolveTemplateScope_ACU('');
    expect(scope).not.toBeNull();
    expect([...scope!.sheetKeys].sort()).toEqual(['sheet_a', 'sheet_b']);
    expect(mockTemplate).not.toHaveBeenCalled();
  });

  it('guide 为空时回退到全局模板', () => {
    mockGuide.mockReturnValue(null);
    mockTemplate.mockReturnValue({ mate: {}, sheet_x: makeSheet('CREATE TABLE x (row_id INTEGER PRIMARY KEY);', ['row_id']) });
    const scope = range.resolveTemplateScope_ACU('');
    expect([...scope!.sheetKeys]).toEqual(['sheet_x']);
  });

  it('guide 与模板都拿不到时返回 null（范围未知）', () => {
    mockGuide.mockReturnValue(null);
    mockTemplate.mockReturnValue(null);
    expect(range.resolveTemplateScope_ACU('')).toBeNull();
  });

  it('guide 报错时回退到模板，不抛出', () => {
    mockGuide.mockImplementation(() => { throw new Error('guide boom'); });
    mockTemplate.mockReturnValue({ mate: {}, sheet_y: makeSheet('CREATE TABLE y (row_id INTEGER PRIMARY KEY);', ['row_id']) });
    const scope = range.resolveTemplateScope_ACU('');
    expect([...scope!.sheetKeys]).toEqual(['sheet_y']);
  });
});

describe('filterSheetKeysByTemplateScope_ACU', () => {
  it('范围未知（null）时不过滤', () => {
    expect(range.filterSheetKeysByTemplateScope_ACU(['sheet_a', 'sheet_c'], null)).toEqual(['sheet_a', 'sheet_c']);
  });

  it('只保留模板声明的表', () => {
    const scope = { sheetKeys: new Set(['sheet_a', 'sheet_b']), sheets: {} as any };
    expect(range.filterSheetKeysByTemplateScope_ACU(['sheet_a', 'sheet_b', 'sheet_c'], scope)).toEqual(['sheet_a', 'sheet_b']);
  });
});

describe('resolveOutOfScopeColumns_ACU', () => {
  it('返回运行时有、模板无的列，row_id 永不列入', () => {
    const runtimeSheet = makeSheet(
      'CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT, b TEXT, extra TEXT);',
      ['row_id', 'a', 'b', 'extra'],
    );
    const scopeSheet = makeSheet(
      'CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT, b TEXT);',
      ['row_id', 'a', 'b'],
    );
    expect(range.resolveOutOfScopeColumns_ACU(runtimeSheet as any, scopeSheet as any)).toEqual(['extra']);
  });

  it('模板列与运行时一致时返回空', () => {
    const sheet = makeSheet('CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT);', ['row_id', 'a']);
    expect(range.resolveOutOfScopeColumns_ACU(sheet as any, sheet as any)).toEqual([]);
  });
});

describe('projectSheetForTemplateScope_ACU', () => {
  it('把模板未声明的列合并进 hiddenPhysicalColumns，不改写原对象', () => {
    const scopeSheet = makeSheet('CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT);', ['row_id', 'a']);
    const scope = { sheetKeys: new Set(['sheet_t']), sheets: { sheet_t: scopeSheet as any } };
    const runtimeSheet = makeSheet('CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT, extra TEXT);', ['row_id', 'a', 'extra']);
    const projected = range.projectSheetForTemplateScope_ACU(runtimeSheet as any, scope, 'sheet_t');
    expect(projected.sourceData!.hiddenPhysicalColumns).toEqual(['extra']);
    // 原对象不被改写。
    expect((runtimeSheet as any).sourceData.hiddenPhysicalColumns).toBeUndefined();
  });

  it('范围未知时原样返回', () => {
    const runtimeSheet = makeSheet('CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT);', ['row_id', 'a']);
    expect(range.projectSheetForTemplateScope_ACU(runtimeSheet as any, null, 'sheet_t')).toBe(runtimeSheet);
  });

  it('test31 隐藏列创建副本时保留 non-enumerable runtime effective schema descriptor', () => {
    const scopeSheet = makeSheet('CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT);', ['row_id', 'a']);
    const scope = { sheetKeys: new Set(['sheet_t']), sheets: { sheet_t: scopeSheet as any } };
    const runtimeSheet: any = makeSheet(
      'CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT, extra TEXT);',
      ['row_id', 'a', 'extra'],
    );
    const runtimeSchema = {
      source: 'fallback_missing',
      diagnostics: ['DDL 缺失，已使用运行时 fallback schema。'],
      effectiveDDL: 'CREATE TABLE t (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  a TEXT -- a\n  extra TEXT -- extra\n);',
      columnMap: { mappings: [], sqlToDisplay: new Map() },
      originalDdlDigest: 'digest',
    };
    Object.defineProperty(runtimeSheet, '_acu_runtimeEffectiveSchema', {
      value: runtimeSchema,
      enumerable: false,
      writable: false,
      configurable: false,
    });

    const projected = range.projectSheetForTemplateScope_ACU(runtimeSheet, scope, 'sheet_t') as any;

    // descriptor 被复制且保持 non-enumerable / 与源一致。
    const descriptor = Object.getOwnPropertyDescriptor(projected, '_acu_runtimeEffectiveSchema');
    expect(descriptor).toBeDefined();
    expect(descriptor!.enumerable).toBe(false);
    expect(descriptor!.writable).toBe(false);
    expect(descriptor!.configurable).toBe(false);
    expect(projected._acu_runtimeEffectiveSchema).toBe(runtimeSchema);
    // JSON 序列化不包含该字段：不进入持久化边界。
    expect(JSON.stringify(projected)).not.toContain('_acu_runtimeEffectiveSchema');
    // 原对象不被修改。
    expect(runtimeSheet._acu_runtimeEffectiveSchema).toBe(runtimeSchema);
    expect(Object.getOwnPropertyDescriptor(runtimeSheet, '_acu_runtimeEffectiveSchema')!.enumerable).toBe(false);
  });

  it('无隐藏列时返回原对象，不复制 descriptor（不产生无意义副本）', () => {
    const scopeSheet = makeSheet('CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT);', ['row_id', 'a']);
    const scope = { sheetKeys: new Set(['sheet_t']), sheets: { sheet_t: scopeSheet as any } };
    const runtimeSheet: any = makeSheet('CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT);', ['row_id', 'a']);
    const runtimeSchema = { source: 'fallback_missing', diagnostics: [], effectiveDDL: 'CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT);', columnMap: { mappings: [], sqlToDisplay: new Map() }, originalDdlDigest: '' };
    Object.defineProperty(runtimeSheet, '_acu_runtimeEffectiveSchema', {
      value: runtimeSchema,
      enumerable: false,
    });

    const projected = range.projectSheetForTemplateScope_ACU(runtimeSheet, scope, 'sheet_t');
    expect(projected).toBe(runtimeSheet);
    expect((projected as any)._acu_runtimeEffectiveSchema).toBe(runtimeSchema);
  });
});

describe('projectTableDataForTemplateScope_ACU', () => {
  it('范围外的表从投影中移除，非 sheet_ 键保留', () => {
    const scope = { sheetKeys: new Set(['sheet_a']), sheets: {} as any };
    const data: any = { mate: { type: 'acu' }, sheet_a: makeSheet('CREATE TABLE a (row_id INTEGER PRIMARY KEY);', ['row_id']), sheet_c: makeSheet('CREATE TABLE c (row_id INTEGER PRIMARY KEY);', ['row_id']) };
    const projected = range.projectTableDataForTemplateScope_ACU(data, scope) as any;
    expect(projected.mate).toEqual({ type: 'acu' });
    expect(projected.sheet_a).toBeDefined();
    expect(projected.sheet_c).toBeUndefined();
  });
});


describe('findEmptyBusinessHeaderIndexes_ACU / isSqlActiveTemplateSheet_ACU / projectSqlActiveTemplateData_ACU', () => {
  it('首列 null 占位 + 后续有效列 → 有效', () => {
    const sheet = makeSheet('CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT);', [null, 'a']);
    expect(range.findEmptyBusinessHeaderIndexes_ACU(sheet as any)).toEqual([]);
    expect(range.isSqlActiveTemplateSheet_ACU(sheet as any)).toBe(true);
  });

  it('第二列为 null/undefined/空串/全角空白 → 无效并返回准确列号', () => {
    for (const bad of [null, undefined, '', '\u3000', ' \t ']) {
      const sheet = makeSheet('CREATE TABLE t (row_id INTEGER PRIMARY KEY, b TEXT);', ['row_id', bad]);
      expect(range.findEmptyBusinessHeaderIndexes_ACU(sheet as any)).toEqual([2]);
      expect(range.isSqlActiveTemplateSheet_ACU(sheet as any)).toBe(false);
    }
  });

  it('中间或末尾空表头 → 无效并返回准确列号', () => {
    const middle = makeSheet('CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT, b TEXT);', ['row_id', 'a', null, 'b']);
    expect(range.findEmptyBusinessHeaderIndexes_ACU(middle as any)).toEqual([3]);
    const tail = makeSheet('CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT);', ['row_id', 'a', '']);
    expect(range.findEmptyBusinessHeaderIndexes_ACU(tail as any)).toEqual([3]);
  });

  it('显式 DDL 表仍按空业务表头跳过（DDL 无关）', () => {
    const sheet = makeSheet('CREATE TABLE t (row_id INTEGER PRIMARY KEY, a TEXT);', ['row_id', null]);
    expect(range.isSqlActiveTemplateSheet_ACU(sheet as any)).toBe(false);
  });

  it('不改写原模板对象', () => {
    const sheet = makeSheet('CREATE TABLE t (row_id INTEGER PRIMARY KEY, b TEXT);', ['row_id', '']);
    const data: any = { mate: { type: 'acu' }, sheet_t: sheet };
    const before = JSON.stringify(sheet);
    range.projectSqlActiveTemplateData_ACU(data);
    expect(JSON.stringify(sheet)).toBe(before);
  });

  it('全部表被过滤后得到空投影而不是 null', () => {
    const data: any = { mate: { type: 'acu' }, sheet_a: makeSheet('CREATE TABLE a (row_id INTEGER PRIMARY KEY);', ['row_id', '']) };
    const result = range.projectSqlActiveTemplateData_ACU(data);
    expect(result.data.mate).toEqual({ type: 'acu' });
    expect(Object.keys(result.data).filter(k => k.startsWith('sheet_'))).toEqual([]);
    expect(result.skippedSheets).toHaveLength(1);
    expect(result.skippedSheets[0].sheetKey).toBe('sheet_a');
    expect(result.skippedSheets[0].emptyHeaderIndexes).toEqual([2]);
  });

  it('mate 与非 sheet_* 元数据原样保留', () => {
    const data: any = { mate: { type: 'acu' }, other: { x: 1 }, sheet_ok: makeSheet('CREATE TABLE ok (row_id INTEGER PRIMARY KEY, a TEXT);', ['row_id', 'a']) };
    const result = range.projectSqlActiveTemplateData_ACU(data);
    expect(result.data.mate).toEqual({ type: 'acu' });
    expect(result.data.other).toEqual({ x: 1 });
    expect(result.data.sheet_ok).toBeDefined();
    expect(result.skippedSheets).toEqual([]);
  });

  it('表头缺失/非数组/只有首列 不归入空业务列判定', () => {
    expect(range.findEmptyBusinessHeaderIndexes_ACU(null)).toEqual([]);
    expect(range.findEmptyBusinessHeaderIndexes_ACU({ uid: 'u', name: 'n', sourceData: {}, content: ['not-array'] } as any)).toEqual([]);
    expect(range.findEmptyBusinessHeaderIndexes_ACU({ uid: 'u', name: 'n', sourceData: {}, content: [['row_id']] } as any)).toEqual([]);
  });
});
