import { describe, expect, it, vi } from 'vitest';

const { mockLogWarn } = vi.hoisted(() => ({ mockLogWarn: vi.fn() }));

vi.mock('../../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../../src/shared/utils');
  return { ...actual, logWarn_ACU: mockLogWarn };
});

import { loadTableStateFromFramesV2_ACU, loadTableStateFromFramesV2Detailed_ACU } from '../../../src/service/table/storage-frame-v2-replay';

/**
 * Phase 0 红灯矩阵：DDL/fallback 双轨列名身份 + 目标缺列安全边界。
 *
 * 本测试文件替换旧版错误语义（current_location → prev_scene_time 被当作
 * 同一列的前后物理名）。真实默认模板中二者始终是不同列：
 *   src/shared/table-defaults/global-state.js:13-19
 *   src/shared/table-defaults/romance-overrides.js:18
 * 把地点写入时间列不是兼容，是静默数据破坏。
 *
 * 目标：修复后的列 registry 必须对称支持：
 *   1. 显式英文 DDL 目标接受确定性 fallback 拼音列名（历史 SQL）；
 *   2. fallback 拼音目标接受 supplemental 作者 DDL 英文列名（当前模板）；
 *   3. 目标 schema 中不存在的列绝不注册 → 保持 SQLite 原始 no such column。
 */

function makeGlobalSheet() {
  return {
    uid: 'global_state',
    name: '全局数据表',
    content: [
      ['row_id', 'current_location', 'prev_scene_time', 'cur_time', 'elapsed_time'],
      ['1', '起点', '之前', '现在', '5分'],
    ],
    sourceData: {
      ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, current_location TEXT, prev_scene_time TEXT, cur_time TEXT, elapsed_time TEXT);',
    },
    updateConfig: {},
    exportConfig: {},
    orderNo: 0,
  } as any;
}

/** 单消息 chat：首个消息携带 full checkpoint + 一条 sql_sheet_batch。 */
function makeChat(checkpointData: any, operation: Record<string, unknown>): any[] {
  return [
    {
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full',
              createdAt: 1,
              reason: 'init',
              data: checkpointData,
              event: { filledSheetKeys: [], changedSheetKeys: [], groupKeys: [] },
            },
            logEntries: [
              {
                seq: 1,
                entryId: 'phase0-red',
                createdAt: 2,
                source: 'manual_crud',
                targetMessageIndex: 0,
                aiFloor: 1,
                filledSheetKeys: [],
                changedSheetKeys: ['sheet_global'],
                groupKeys: [],
                operations: [operation],
              },
            ],
          },
        },
      },
    },
  ];
}

/** 带聊天模板的 chat：模板走 TavernDB_ACU_ScopedConfig，供补锚路径使用。 */
function makeChatWithTemplate(checkpointData: any, operation: Record<string, unknown>, template: any): any[] {
  const chat = makeChat(checkpointData, operation);
  chat[0].TavernDB_ACU_ScopedConfig = {
    version: 1,
    template: {
      '': { mode: 'chat_override', isolationKey: '', templateStr: JSON.stringify(template) },
    },
  };
  return chat;
}

describe('Phase 0 红灯：DDL/fallback 双轨列名身份', () => {
  beforeEach(() => {
    mockLogWarn.mockClear();
  });

  it('A 类（对照组）：显式英文 DDL 目标，SQL 用当前物理列名应通过', async () => {
    // 目标 schema 显式英文 DDL，SQL 用当前物理名 current_location 可正常回放。
    const data = {
      mate: { type: 'acu', version: 1 },
      sheet_global: makeGlobalSheet(),
    } as any;
    const chat = makeChat(data, {
      kind: 'sql_sheet_batch',
      sheetKey: 'sheet_global',
      tableName: 'global_state',
      reason: 'system',
      statements: ["UPDATE global_state SET current_location = '新地点' WHERE row_id = 1"],
    });

    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    expect(result?.sheet_global.content[1][1]).toBe('新地点');
  });

  it('A2 类：显式英文 DDL 目标接受历史 fallback 拼音列名', async () => {
    const data = {
      mate: { type: 'acu', version: 1 },
      sheet_global: {
        uid: 'global_state', name: '全局数据表',
        content: [['row_id', '当前详细地点', '上一场景时间'], ['1', '起点', '之前']],
        sourceData: { ddl: `CREATE TABLE global_state (
          row_id INTEGER PRIMARY KEY,
          current_location TEXT, -- 当前详细地点
          prev_scene_time TEXT -- 上一场景时间
        );` },
        updateConfig: {}, exportConfig: {}, orderNo: 0,
      },
    } as any;
    const chat = makeChat(data, {
      kind: 'sql_sheet_batch', sheetKey: 'sheet_global', tableName: 'global_state', reason: 'system',
      statements: ["UPDATE global_state SET dang_qian_xiang_xi_di_dian = '新地点' WHERE row_id = 1"],
    });

    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    expect(result?.sheet_global.content[1]).toEqual(['1', '新地点', '之前']);
  });

  it('sql_batch 无目标表归属，不做列重绑', async () => {
    const data = {
      mate: { type: 'acu', version: 1 },
      sheet_global: {
        uid: 'global_state', name: '全局数据表', sourceData: {},
        content: [['row_id', '当前详细地点'], ['1', '起点']],
        updateConfig: {}, exportConfig: {}, orderNo: 0,
      },
    } as any;
    const chat = makeChat(data, {
      kind: 'sql_batch', reason: 'system',
      statements: ["UPDATE quanjushujubiao SET current_location = '新地点' WHERE row_id = 1"],
    });

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).rejects.toThrow(/no such column: current_location/i);
  });

  it('B1 类（目标缺列，无证据）：显式 DDL 目标不含 current_location 时保持 no such column', async () => {
    // 目标 DDL 只有 prev_scene_time 等列，SQL 用 current_location → 无证据不猜测，
    // 保持 SQLite 原始 no such column（fail closed）。
    const data = {
      mate: { type: 'acu', version: 1 },
      sheet_global: {
        uid: 'global_state',
        name: '全局数据表',
        content: [
          ['row_id', 'prev_scene_time', 'cur_time', 'elapsed_time'],
          ['1', '之前', '现在', '5分'],
        ],
        sourceData: {
          ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, prev_scene_time TEXT, cur_time TEXT, elapsed_time TEXT);',
        },
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      } as any,
    };
    const chat = makeChat(data, {
      kind: 'sql_sheet_batch',
      sheetKey: 'sheet_global',
      tableName: 'global_state',
      reason: 'system',
      statements: ["UPDATE global_state SET current_location = '新地点' WHERE row_id = 1"],
    });

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).rejects.toThrow(/no such column: current_location/i);
  });

  it('B2 类（安全断言）：current_location 与 prev_scene_time 同表并存且互不映射', async () => {
    // 真实默认 schema 中二者必须同时存在且保持独立。任何把 current_location
    // 认回 prev_scene_time 的映射都是静默数据破坏，必须红灯。
    const data = {
      mate: { type: 'acu', version: 1 },
      sheet_global: {
        uid: 'global_state',
        name: '全局数据表',
        content: [
          ['row_id', 'current_location', 'prev_scene_time', 'cur_time', 'elapsed_time'],
          ['1', '起点', '之前', '现在', '5分'],
        ],
        sourceData: {
          ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, current_location TEXT, prev_scene_time TEXT, cur_time TEXT, elapsed_time TEXT);',
        },
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      } as any,
    };
    const chat = makeChat(data, {
      kind: 'sql_sheet_batch',
      sheetKey: 'sheet_global',
      tableName: 'global_state',
      reason: 'system',
      statements: ["UPDATE global_state SET current_location = '新地点' WHERE row_id = 1"],
    });

    // 两列独立存在：写入 current_location 只影响该列，绝不触碰 prev_scene_time。
    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    expect(result?.sheet_global.content[1][1]).toBe('新地点');
    expect(result?.sheet_global.content[1][2]).toBe('之前'); // prev_scene_time 原样
  });

  it('C1 类（fallback 目标 + 作者 DDL SQL）：当前模板提供英文列名，可重绑到目标拼音列', async () => {
    // 目标 runtime 为 fallback 拼音 schema（DDL 缺失，表头中文），当前聊天模板
    // 提供作者 DDL 英文列名 current_location → 唯一 canonical 显示名映射到目标拼音列。
    const data = {
      mate: { type: 'acu', version: 1 },
      sheet_global: {
        uid: 'global_state',
        name: '全局数据表',
        content: [
          ['row_id', '当前详细地点', '上一场景时间', '当前时间', '经过时间'],
          ['1', '起点', '之前', '现在', '5分'],
        ],
        sourceData: {},
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      } as any,
    };
    // 模板提供显式 DDL，列名 current_location 等，与目标表头（当前详细地点）对齐。
    const template = {
      mate: { type: 'acu', version: 1 },
      sheet_global: {
        uid: 'global_state',
        name: '全局数据表',
        content: [
          ['row_id', '当前详细地点', '上一场景时间', '当前时间', '经过时间'],
          ['99', '起点', '之前', '现在', '5分'],
        ],
        sourceData: {
          ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, current_location TEXT, prev_scene_time TEXT, cur_time TEXT, elapsed_time TEXT);',
        },
        updateConfig: {},
        exportConfig: {},
        orderNo: 1,
      } as any,
    };
    const chat = makeChatWithTemplate(data, {
      kind: 'sql_sheet_batch',
      sheetKey: 'sheet_global',
      tableName: 'quanjushujubiao',
      reason: 'system',
      statements: ["UPDATE quanjushujubiao SET current_location = '新地点' WHERE row_id = 1"],
    }, template);

    const result = await loadTableStateFromFramesV2_ACU(chat, '');
    // current_location 重绑到 fallback 拼音列 dang_qian_xiang_xi_di_dian（以实际输出为准），
    // 写入目标表第一个业务列（当前详细地点）。
    expect(result?.sheet_global.content[1][1]).toBe('新地点');
  });

  it('D1 类（目标缺列，无证据）：补锚模板提供英文列名但目标缺该列时保持 no such column', async () => {
    // 补锚路径：checkpoint 缺 sheet_global，从当前模板 header-only 补表。
    // 目标表头不含「当前详细地点」，SQL 用 current_location → 无目标列，不注册，
    // 保持 no such column（fail closed）。
    const template = {
      mate: { type: 'acu', version: 1 },
      sheet_global: {
        uid: 'global_state',
        name: '全局数据表',
        content: [
          ['row_id', '上一场景时间', '经过时间', '当前时间'],
          ['99', '模板示例', '0分', '模板时间'],
        ],
        sourceData: {
          ddl: 'CREATE TABLE global_state (row_id INTEGER PRIMARY KEY, prev_scene_time TEXT, elapsed_time TEXT, cur_time TEXT);',
        },
        updateConfig: {},
        exportConfig: {},
        orderNo: 1,
      } as any,
    };
    const checkpointData = {
      mate: { type: 'acu', version: 1 },
      sheet_other: {
        uid: 'other',
        name: '其他表',
        content: [['row_id', 'name'], ['1', '铁剑']],
        sourceData: { ddl: 'CREATE TABLE other (row_id INTEGER PRIMARY KEY, name TEXT);' },
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      } as any,
    };
    const chat = makeChatWithTemplate(checkpointData, {
      kind: 'sql_sheet_batch',
      sheetKey: 'sheet_global',
      tableName: 'quanjushujubiao',
      reason: 'system',
      statements: ["UPDATE quanjushujubiao SET current_location = '地点' WHERE row_id = 1"],
    }, template);

    await expect(loadTableStateFromFramesV2_ACU(chat, '')).rejects.toThrow(/no such column: current_location/i);
  });
});
