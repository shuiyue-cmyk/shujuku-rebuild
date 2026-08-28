/**
 * tests/shared/sheet-identity-merge.test.ts
 * 两代 sheetKey 身份归并纯函数单元测试（零 mock，直接测输入输出）
 */
import { describe, expect, it } from 'vitest';
import { mergeLegacySheetIdentities_ACU } from '../../src/shared/sheet-identity-merge';
import { buildStableSheetKeyCandidate_ACU } from '../../src/shared/sheet-identity';

const NEW_KEY = buildStableSheetKeyCandidate_ACU('背包')!;

function makeSheet(name: string, rows: unknown[][], extra: Record<string, unknown> = {}) {
  return {
    uid: name,
    name,
    content: [['row_id', 'name'], ...rows],
    updateConfig: {},
    exportConfig: {},
    orderNo: 0,
    ...extra,
  } as any;
}

describe('mergeLegacySheetIdentities_ACU', () => {
  it('无同名冲突时是纯 no-op', () => {
    const state = {
      mate: { type: 'acu', version: 1 },
      sheet_a: makeSheet('背包', [['1', '铁剑']]),
      sheet_b: makeSheet('技能', [['1', '火球']]),
    } as any;
    const before = JSON.parse(JSON.stringify(state));

    const result = mergeLegacySheetIdentities_ACU(state);

    expect(result.changed).toBe(false);
    expect(result.remaps).toEqual([]);
    expect(state).toEqual(before);
  });

  it('两代 key 同名时归并到新版稳定 key：同 row_id winner 胜出，loser 独有行追加', () => {
    const state = {
      sheet_x9k2f: makeSheet('背包', [['1', '旧行'], ['2', '旧独有行']]),
      [NEW_KEY]: makeSheet('背包', [['1', '新行']]),
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state);

    expect(result.changed).toBe(true);
    expect(result.remaps).toEqual([{
      fromKey: 'sheet_x9k2f',
      toKey: NEW_KEY,
      canonicalName: '背包',
      overriddenRows: 1,
      appendedRows: 1,
    }]);
    expect(state.sheet_x9k2f).toBeUndefined();
    expect(state[NEW_KEY].content).toEqual([
      ['row_id', 'name'],
      ['1', '新行'],
      ['2', '旧独有行'],
    ]);
  });

  it('preferredKeys（模板/指导表侧）优先于新版稳定 key 候选', () => {
    const state = {
      sheet_legacy_hash: makeSheet('背包', [['1', '指导表侧行']]),
      [NEW_KEY]: makeSheet('背包', [['1', '另一代行'], ['2', '独有行']]),
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state, ['sheet_legacy_hash']);

    expect(result.remaps).toEqual([{
      fromKey: NEW_KEY,
      toKey: 'sheet_legacy_hash',
      canonicalName: '背包',
      overriddenRows: 1,
      appendedRows: 1,
    }]);
    expect(state[NEW_KEY]).toBeUndefined();
    expect(state.sheet_legacy_hash.content).toEqual([
      ['row_id', 'name'],
      ['1', '指导表侧行'],
      ['2', '独有行'],
    ]);
  });

  it('两侧都不含新版稳定 key 时按 key 字典序取首位（确定性）', () => {
    const state = {
      sheet_zzz: makeSheet('背包', [['1', 'zzz 行']]),
      sheet_aaa: makeSheet('背包', [['2', 'aaa 行']]),
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state);

    expect(result.remaps[0].toKey).toBe('sheet_aaa');
    expect(state.sheet_zzz).toBeUndefined();
    expect(state.sheet_aaa.content).toEqual([
      ['row_id', 'name'],
      ['2', 'aaa 行'],
      ['1', 'zzz 行'],
    ]);
  });

  it('winner 无可用 content 时整体采纳 loser 的 content，并继承 seedRows/sourceData', () => {
    const loserSheet = makeSheet('背包', [['1', '旧数据']], {
      seedRows: [['1', '种子']],
      sourceData: { ddl: 'CREATE TABLE beibao (row_id INTEGER PRIMARY KEY, name TEXT);' },
    });
    const winnerSheet = makeSheet('背包', []);
    winnerSheet.content = [];
    delete winnerSheet.sourceData;
    const state = {
      sheet_old_hash: loserSheet,
      [NEW_KEY]: winnerSheet,
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state);

    expect(result.remaps[0]).toEqual(expect.objectContaining({ fromKey: 'sheet_old_hash', toKey: NEW_KEY }));
    expect(state[NEW_KEY].content).toEqual([['row_id', 'name'], ['1', '旧数据']]);
    expect(state[NEW_KEY].seedRows).toEqual([['1', '种子']]);
    expect(state[NEW_KEY].sourceData).toEqual({ ddl: 'CREATE TABLE beibao (row_id INTEGER PRIMARY KEY, name TEXT);' });
  });

  it('归并幂等：第二次调用是 no-op', () => {
    const state = {
      sheet_old_hash: makeSheet('背包', [['1', '旧行'], ['3', '旧独有']]),
      [NEW_KEY]: makeSheet('背包', [['1', '新行'], ['2', '新独有']]),
    } as any;

    const first = mergeLegacySheetIdentities_ACU(state);
    const afterFirst = JSON.parse(JSON.stringify(state));
    const second = mergeLegacySheetIdentities_ACU(state);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(state).toEqual(afterFirst);
  });

  it('行身份守恒：归并后不同 row_id 的行一个不丢', () => {
    const state = {
      sheet_old_hash: makeSheet('背包', [['1', '旧1'], ['2', '旧2'], ['5', '旧5']]),
      [NEW_KEY]: makeSheet('背包', [['1', '新1'], ['3', '新3']]),
    } as any;

    mergeLegacySheetIdentities_ACU(state);

    const rowIds = state[NEW_KEY].content.slice(1).map((row: unknown[]) => row[0]);
    expect([...rowIds].sort()).toEqual(['1', '2', '3', '5']);
  });

  it('显示名做 canonical 归一（空白/大小写差异视为同名）', () => {
    const state = {
      sheet_old_hash: makeSheet(' Inventory ', [['2', '旧行']]),
      sheet_inventory: makeSheet('inventory', [['1', '新行']]),
    } as any;

    const result = mergeLegacySheetIdentities_ACU(state);

    expect(result.changed).toBe(true);
    expect(result.remaps[0].canonicalName).toBe('inventory');
    expect(state.sheet_inventory.content).toEqual([
      ['row_id', 'name'],
      ['1', '新行'],
      ['2', '旧行'],
    ]);
  });
});
