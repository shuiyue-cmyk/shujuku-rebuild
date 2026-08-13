import { describe, expect, it } from 'vitest';
import {
  hydrateTableDataStrict_ACU,
  validateSqliteTemplateDataStrict_ACU,
} from '../../../src/service/table/sqlite-template-validation';

const invalidRuntimeDdlSnapshot = {
  mate: { type: 'acu_table_data', version: 3 },
  sheet_runtime: {
    uid: 'runtime_sheet',
    name: '运行时回退表',
    sourceData: {
      ddl: 'CREATE TABLE broken_runtime ( INVALID SYNTAX;',
    },
    content: [
      ['row_id', '物品'],
      ['1', '铁剑'],
    ],
    updateConfig: {},
    exportConfig: {},
    orderNo: 0,
  },
};

describe('validateSqliteTemplateDataStrict_ACU', () => {
  it('默认仍拒绝非法 DDL，避免模板校验意外放宽', async () => {
    await expect(validateSqliteTemplateDataStrict_ACU(invalidRuntimeDdlSnapshot))
      .resolves.toMatchObject({ success: false });
  });

  it('显式允许时与 SQLite 运行时一致，使用 fallback schema 完成 hydrate', async () => {
    await expect(validateSqliteTemplateDataStrict_ACU(
      invalidRuntimeDdlSnapshot,
      { allowRuntimeDdlFallback: true },
    )).resolves.toEqual({ success: true });
  });
});

describe('hydrateTableDataStrict_ACU 授权边界（T4.4）', () => {
  it('未授权时非法显式 DDL fail-closed（抛异常，不放行）', async () => {
    await expect(hydrateTableDataStrict_ACU(invalidRuntimeDdlSnapshot))
      .rejects.toThrow(/fallback|DDL|broken_runtime/i);
  });

  it('授权时非法显式 DDL 降级为 fallback schema 完成 hydrate', async () => {
    await expect(hydrateTableDataStrict_ACU(
      invalidRuntimeDdlSnapshot,
      { allowRuntimeDdlFallback: true },
    )).resolves.toBeUndefined();
  });

  it('无 DDL 中文表端到端 hydrate 成功，物理名为拼音（T4.2 hydrate 层）', async () => {
    const chineseSheet = {
      mate: { type: 'acu_table_data', version: 3 },
      sheet_tianqi: {
        uid: 'sheet_tianqi',
        name: '天气表',
        sourceData: {},
        content: [
          ['row_id', '天气状况', '温度'],
          ['1', '晴', '28'],
        ],
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    };
    await expect(hydrateTableDataStrict_ACU(chineseSheet)).resolves.toBeUndefined();
  });
});
