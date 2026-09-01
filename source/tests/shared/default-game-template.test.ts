/**
 * tests/shared/default-game-template.test.ts
 * 第三方游戏初始化内置默认模板构造（shared/default-game-template）
 *
 * 断言全部对照 defaults 单一来源（shared/table-defaults），不写第二份表名清单。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  buildDefaultGameTemplate_ACU,
} from '../../src/shared/default-game-template';
import {
  buildDefaultTableTemplateObject_ACU,
  buildOriginalDefaultTableTemplateObject_ACU,
  chronicleSheet,
  globalStateSheet,
  importantCharsSheet,
  inventorySheet,
  optionsSheet,
  protagonistInfoSheet,
  protagonistSkillsSheet,
  questsEventsSheet,
} from '../../src/shared/table-defaults/index.js';
import { DEFAULT_TABLE_TEMPLATE_ACU } from '../../src/shared/defaults-json.js';
import { normalizeTemplateRowIds_ACU } from '../../src/service/template/template-row-id-normalizer';
import {
  allocateStableSheetKeys_ACU,
  assertNoPhysicalTableNameCollision_ACU,
} from '../../src/shared/sheet-identity';
import { normalizeCanonicalTableRows_ACU } from '../../src/shared/canonical-row-normalizer';
import { buildSheetTableAliasMap_ACU } from '../../src/shared/sql-read-resolver';

const sheetKeysOf = (template: Record<string, any>) =>
  Object.keys(template || {}).filter(key => key.startsWith('sheet_')).sort();

describe('buildDefaultGameTemplate_ACU', () => {
  it('与库内默认表结构单一来源同表集合（默认 8 张表，含 sheet_OptionsNew）', () => {
    const built = buildDefaultGameTemplate_ACU();
    const source = buildDefaultTableTemplateObject_ACU();

    // 同一来源比对：不硬编码第二份表名清单
    expect(sheetKeysOf(built)).toEqual(sheetKeysOf(source));
    expect(sheetKeysOf(built)).toEqual(sheetKeysOf(buildOriginalDefaultTableTemplateObject_ACU()));
    expect(sheetKeysOf(built)).toHaveLength(8);
    expect(sheetKeysOf(built)).toContain(optionsSheet.uid);
    expect(optionsSheet.uid).toBe('sheet_OptionsNew');

    // 每张默认表都在场（逐表定义来自同一模块）
    const expectedSheets = [
      globalStateSheet, protagonistInfoSheet, importantCharsSheet, protagonistSkillsSheet,
      inventorySheet, questsEventsSheet, chronicleSheet, optionsSheet,
    ];
    expectedSheets.forEach((sheet: any) => {
      expect(built[sheet.uid], `缺少默认表 ${sheet.name}(${sheet.uid})`).toBeTruthy();
    });
  });

  it('输出等于运行时全局默认模板常量 DEFAULT_TABLE_TEMPLATE_ACU 的解析结果', () => {
    // DEFAULT_TABLE_TEMPLATE_ACU 是双重编码字符串（外层引号包裹内层 JSON），与消费端 parseTableTemplateJson 一致
    const inner = JSON.parse(DEFAULT_TABLE_TEMPLATE_ACU);
    const parsed = typeof inner === 'string' ? JSON.parse(inner) : inner;
    expect(buildDefaultGameTemplate_ACU()).toEqual(parsed);
  });

  it('满足模板注入链的 templateData 形状契约（row_id 表头 + mate + DDL）', () => {
    const built = buildDefaultGameTemplate_ACU();
    const sheetKeys = sheetKeysOf(built);
    expect(sheetKeys.length).toBeGreaterThan(0);

    sheetKeys.forEach((key) => {
      const sheet = built[key];
      expect(typeof sheet.name, `${key} 缺少表名`).toBe('string');
      expect(sheet.name.length).toBeGreaterThan(0);
      expect(Array.isArray(sheet.content), `${key} content 不是数组`).toBe(true);
      // prepareTemplate 硬要求：首列 row_id 表头
      expect(Array.isArray(sheet.content[0]), `${key} 表头不是数组`).toBe(true);
      expect(sheet.content[0][0], `${key} 表头首列不是 row_id`).toBe('row_id');
      // SQL 模式取 sourceData.ddl
      expect(typeof sheet.sourceData?.ddl, `${key} 缺少 DDL`).toBe('string');
      expect(sheet.sourceData.ddl).toMatch(/^CREATE TABLE/i);
      expect(sheet.sourceData.ddl).toMatch(/row_id\s+INTEGER\s+PRIMARY KEY/i);
    });

    expect(built.mate).toMatchObject({ type: 'chatSheets', version: 1 });
  });

  it('原生与 SQL 两种存储模式下都能通过 row_id 规范化（无 blocker）', () => {
    const native = normalizeTemplateRowIds_ACU(buildDefaultGameTemplate_ACU(), { syncDdl: false });
    expect(native.blockers).toEqual([]);

    const sqlite = normalizeTemplateRowIds_ACU(buildDefaultGameTemplate_ACU(), { syncDdl: true });
    expect(sqlite.blockers.map(item => item.message)).toEqual([]);
  });

  it('通过模板重置链 prepareTemplate 的全部结构闸口（稳定 key / canonical 行 / 物理表名 / 别名）', () => {
    // 复刻 service/table/template-state-reset.ts prepareTemplate 的校验序列，
    // 证明内置默认模板确实能进入 initGameSession 的重置链，而不只是形状像。
    const normalization = normalizeTemplateRowIds_ACU(buildDefaultGameTemplate_ACU(), { syncDdl: true });
    expect(normalization.blockers).toEqual([]);

    const entries = Object.entries(normalization.templateData).filter(([key]) => key.startsWith('sheet_'));
    expect(entries.length).toBe(sheetKeysOf(buildDefaultTableTemplateObject_ACU()).length);

    const allocation = allocateStableSheetKeys_ACU(entries.map(([, sheet]: any) => sheet?.name));
    expect(allocation.diagnostics).toEqual([]);
    expect(allocation.keys.every(key => !!key)).toBe(true);

    const rekeyed: Record<string, any> = {};
    entries.forEach(([oldKey, source], index) => {
      // 复刻 prepareTemplate :48 行型闸口：数据行必须全为数组
      const rows = (source as any).content.slice(1);
      expect(rows.every((row: unknown) => Array.isArray(row))).toBe(true);
      // 复刻 prepareTemplate :49-58：稳定 key 替换后，被挤掉的旧身份进 tableAliases
      const sheet = { ...(source as any), uid: allocation.keys[index] };
      const declaredAliases = Array.isArray(sheet.sourceData?.tableAliases) ? sheet.sourceData.tableAliases : [];
      const previousUid = String((source as any).uid || '').trim();
      sheet.sourceData = { ...(sheet.sourceData || {}) };
      sheet.sourceData.tableAliases = [...new Set([...declaredAliases, oldKey, previousUid]
        .map((value: unknown) => String(value || '').trim())
        .filter(Boolean))];
      rekeyed[allocation.keys[index]!] = sheet;
    });
    expect(normalizeCanonicalTableRows_ACU(rekeyed).errors).toEqual([]);
    expect(() => assertNoPhysicalTableNameCollision_ACU(rekeyed)).not.toThrow();
    expect([...buildSheetTableAliasMap_ACU([rekeyed], { includeExtendedAliases: true }).conflicts]).toEqual([]);
  });

  it('每次调用返回独立副本，调用方改动不回写默认表定义', () => {
    const first = buildDefaultGameTemplate_ACU();
    const probeKey = sheetKeysOf(first)[0];
    first[probeKey].name = '被调用方改掉的表名';
    delete first[optionsSheet.uid];

    const second = buildDefaultGameTemplate_ACU();
    expect(sheetKeysOf(second)).toContain(optionsSheet.uid);
    expect(second[probeKey].name).not.toBe('被调用方改掉的表名');
    expect(second).toEqual(buildDefaultTableTemplateObject_ACU());
  });

  it('默认表结构产不出任何 Sheet 时抛错，不返回空模板', async () => {
    vi.resetModules();
    vi.doMock('../../src/shared/table-defaults/index.js', () => ({
      buildDefaultTableTemplateObject_ACU: () => ({ mate: { type: 'chatSheets', version: 1 } }),
    }));
    const { buildDefaultGameTemplate_ACU: builtInIsolation } = await import('../../src/shared/default-game-template');
    try {
      expect(() => builtInIsolation()).toThrow('不包含任何 Sheet');
    } finally {
      vi.doUnmock('../../src/shared/table-defaults/index.js');
      vi.resetModules();
    }
  });
});
