import { describe, expect, it } from 'vitest';
import { resolveTemplateSwitchMode_ACU } from '../../../src/service/table/template-switch-mode-resolver';
import { allocateStableSheetKeys_ACU } from '../../../src/shared/sheet-identity';

function makeSheet(name: string, rows: string[][] = [['row_id', 'value']]) {
  return {
    uid: name,
    name,
    sourceData: { ddl: `CREATE TABLE ${name} (row_id INTEGER PRIMARY KEY, value TEXT);` },
    content: rows,
    updateConfig: {},
    exportConfig: {},
    orderNo: 0,
  };
}

function makeV2Message(frame: Record<string, any>): any {
  return {
    is_user: false,
    TavernDB_ACU_IsolatedData: {
      '': { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [], ...frame } },
    },
  };
}

const isolationKey = '';

function chatOf(...messages: any[]): any[] {
  return messages;
}

describe('resolveTemplateSwitchMode_ACU', () => {
  it('空会话 → pristine', () => {
    const mode = resolveTemplateSwitchMode_ACU([], isolationKey);
    expect(mode.mode).toBe('pristine');
  });

  it('仅 header-only full checkpoint → pristine', () => {
    const chat = chatOf(makeV2Message({
      checkpoint: {
        kind: 'full',
        createdAt: 1,
        reason: 'init',
        data: { mate: { type: 'acu' }, sheet_a: makeSheet('表A') },
        event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
      },
    }));
    const mode = resolveTemplateSwitchMode_ACU(chat, isolationKey);
    expect(mode.mode).toBe('pristine');
  });

  it('有 logEntries → inherit', () => {
    const chat = chatOf(makeV2Message({
      checkpoint: {
        kind: 'full',
        createdAt: 1,
        reason: 'init',
        data: { mate: { type: 'acu' }, sheet_a: makeSheet('表A') },
        event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
      },
      logEntries: [{
        seq: 1, entryId: 'e1', createdAt: 2, source: 'manual_fill', targetMessageIndex: 0, aiFloor: 1,
        filledSheetKeys: ['sheet_a'], changedSheetKeys: ['sheet_a'], groupKeys: [],
        operations: [{ kind: 'sql_sheet_batch', sheetKey: 'sheet_a', statements: ['UPDATE 表A SET value = ?'], params: [['v']] }],
      }],
    }));
    const mode = resolveTemplateSwitchMode_ACU(chat, isolationKey);
    expect(mode.mode).toBe('inherit');
  });

  it('checkpoint 含数据行 → inherit', () => {
    const chat = chatOf(makeV2Message({
      checkpoint: {
        kind: 'full',
        createdAt: 1,
        reason: 'init',
        data: { mate: { type: 'acu' }, sheet_a: makeSheet('表A', [['row_id', 'value'], ['1', '数据']]) },
        event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
      },
    }));
    const mode = resolveTemplateSwitchMode_ACU(chat, isolationKey);
    expect(mode.mode).toBe('inherit');
  });

  it('perSheetCheckpoints 含数据行 → inherit', () => {
    const chat = chatOf(makeV2Message({
      perSheetCheckpoints: {
        sheet_hidden: { kind: 'sheet_full', createdAt: 1, reason: 'manual', sheetKey: 'sheet_hidden', data: makeSheet('隐藏表', [['row_id', 'value'], ['1', '数据']]) },
      },
    }));
    const mode = resolveTemplateSwitchMode_ACU(chat, isolationKey);
    expect(mode.mode).toBe('inherit');
  });

  it('有 hidden 表 → inherit（不得判 pristine）', () => {
    const chat = chatOf(makeV2Message({
      perSheetCheckpoints: {
        sheet_hidden: {
          kind: 'sheet_full',
          createdAt: 1,
          reason: 'manual',
          sheetKey: 'sheet_hidden',
          data: makeSheet('隐藏表', [['row_id', 'value'], ['1', '隐藏数据']]),
          timeline: { kind: 'sheet_hide', activateAtMessageIndex: 0, afterSeq: 0 },
        },
      },
    }));
    const mode = resolveTemplateSwitchMode_ACU(chat, isolationKey);
    expect(mode.mode).toBe('inherit');
  });

  it('lifecycle indeterminate → blocked', () => {
    const chat = chatOf(makeV2Message({
      perSheetCheckpoints: {
        sheet_bad: {
          kind: 'sheet_full',
          createdAt: 1,
          reason: 'manual',
          sheetKey: 'sheet_bad',
          data: makeSheet('坏表'),
          timeline: { kind: 'sheet_hide', afterSeq: -1 }, // 非法 afterSeq → indeterminate
        },
      },
    }));
    const mode = resolveTemplateSwitchMode_ACU(chat, isolationKey);
    expect(mode.mode).toBe('blocked');
  });

  it('frame 结构损坏（logEntries 非数组）→ blocked', () => {
    const chat = chatOf({
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: 'not-array' } },
      },
    });
    const mode = resolveTemplateSwitchMode_ACU(chat, isolationKey);
    expect(mode.mode).toBe('blocked');
  });

  it('legacy 顶层表格数据 → inherit（不得判 pristine）', () => {
    const chat = chatOf({
      is_user: false,
      TavernDB_ACU_IndependentData: { sheet_legacy: makeSheet('旧表') },
    });
    const mode = resolveTemplateSwitchMode_ACU(chat, isolationKey);
    expect(mode.mode).toBe('inherit');
  });

  it('新会话与删光后（无任何 frame）会话等价：均判 pristine，且走同一 scope-only 分支', () => {
    // 阶段 4 验收：删光数据后必须回到「从未填表」状态，与全新会话判定一致。
    // 空会话（新会话）：
    const freshChat = chatOf();
    const freshMode = resolveTemplateSwitchMode_ACU(freshChat, isolationKey);
    // 删光后：所有 AI 楼层的 storageFrame 已被 deleteLocalDataInChatCore_ACU 清除。
    const clearedChat = chatOf(
      { is_user: false, mes: 'AI 1' },
      { is_user: false, mes: 'AI 2' },
    );
    const clearedMode = resolveTemplateSwitchMode_ACU(clearedChat, isolationKey);
    // 删光后仍残留 header-only 结构（无任何数据行）也等价：
    const headerOnlyChat = chatOf(makeV2Message({
      checkpoint: {
        kind: 'full',
        createdAt: 1,
        reason: 'init',
        data: { mate: { type: 'acu' }, sheet_a: makeSheet('表A') },
        event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
      },
    }));
    const headerOnlyMode = resolveTemplateSwitchMode_ACU(headerOnlyChat, isolationKey);

    expect(freshMode.mode).toBe('pristine');
    expect(clearedMode.mode).toBe('pristine');
    expect(headerOnlyMode.mode).toBe('pristine');
    // 三者判定一致 → 切模板时走完全相同的 pristine scope-only 路径，最终 chat 状态等价。
    expect(clearedMode).toEqual(freshMode);
  });

  it('同拼音 slug 冲突的两张表 rekey 幂等：两次分配结果一致，不出现 key 漂移', () => {
    // 计划 2.1 例外：「记录表」与「纪录表」拼音 slug 相同（ji lu biao），
    // allocateStableSheetKeys_ACU 会退化为 sheet_<截断slug>_<canonical hash>。
    // hash 源自 canonical 名 → 重分配幂等，两次 rekey 结果必须逐字段一致。
    const names = ['记录表', '纪录表'];
    const first = allocateStableSheetKeys_ACU(names);
    const second = allocateStableSheetKeys_ACU(names);
    expect(first.keys).toEqual(second.keys);
    expect(first.keys.every((key: string | null) => !!key)).toBe(true);
    // 两表 slug 相同 → 必须退化为 hash 后缀（不是裸 sheet_ji_lu_biao），
    // 且两次分配的 key 完全一致（无漂移）。
    expect(first.keys[0]).toMatch(/^sheet_ji_lu_biao_/);
    expect(first.keys[1]).toMatch(/^sheet_ji_lu_biao_/);
    expect(new Set(first.keys).size).toBe(2);
  });
});
