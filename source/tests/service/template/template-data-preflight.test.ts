import { describe, expect, it } from 'vitest';
import {
  extractBusinessKeyColumns_ACU,
  preflightTemplateDataImport_ACU,
} from '../../../src/service/template/template-data-preflight';
import type { TableDataObject_ACU } from '../../../src/shared/models/table-data';

function sheet(name: string, headers: string[], rows: Array<Array<string | null>> = [], ddl = '') {
  return {
    uid: `sheet_${name.toLowerCase()}`,
    name,
    content: [headers, ...rows],
    sourceData: ddl ? { ddl } : {},
    updateConfig: {},
    exportConfig: {},
    orderNo: 0,
  };
}

function state(sheets: Record<string, any>): TableDataObject_ACU {
  return { mate: { type: 'chatSheets', version: 1 }, ...sheets } as TableDataObject_ACU;
}

const UNIQUE_DDL = 'CREATE TABLE "t" ("row_id" INTEGER PRIMARY KEY, "code" TEXT UNIQUE, "name" TEXT);';
const TABLE_UNIQUE_DDL = 'CREATE TABLE "t" ("row_id" INTEGER PRIMARY KEY, "code" TEXT, "name" TEXT, UNIQUE("code", "name"));';

function auditOf(result: ReturnType<typeof preflightTemplateDataImport_ACU>, sheetKey: string) {
  return result.audits.find(item => item.sheetKey === sheetKey)!;
}

describe('preflightTemplateDataImport_ACU', () => {
  describe('extractBusinessKeyColumns_ACU', () => {
    it('提取列级 UNIQUE 业务键', () => {
      expect(extractBusinessKeyColumns_ACU(UNIQUE_DDL)).toEqual([['code']]);
    });

    it('提取表级复合 UNIQUE 键', () => {
      expect(extractBusinessKeyColumns_ACU(TABLE_UNIQUE_DDL)).toEqual([['code', 'name']]);
    });

    it('无 UNIQUE 约束时返回空（不可证明业务身份）', () => {
      expect(extractBusinessKeyColumns_ACU('CREATE TABLE "t" ("row_id" INTEGER PRIMARY KEY, "code" TEXT);')).toEqual([]);
    });

    it('空 DDL 返回空', () => {
      expect(extractBusinessKeyColumns_ACU('')).toEqual([]);
    });
  });

  describe('数据模式语义', () => {
    it('无数据模板：任何模式都不凭空造行，action=no-data', () => {
      for (const dataMode of ['replace', 'merge', 'seed'] as const) {
        const result = preflightTemplateDataImport_ACU({
          templateData: state({ sheet_a: sheet('A', ['row_id', '名称']) }),
          dataMode,
        });
        expect(result.ok).toBe(true);
        expect(auditOf(result, 'sheet_a').action).toBe('no-data');
        expect(auditOf(result, 'sheet_a').templateRowCount).toBe(0);
      }
    });

    it('replace：模板数据作为初始快照，action=replaced', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({ sheet_a: sheet('A', ['row_id', '名称'], [['1', '铁剑']], UNIQUE_DDL) }),
        dataMode: 'replace',
      });
      expect(result.ok).toBe(true);
      expect(auditOf(result, 'sheet_a').action).toBe('replaced');
      expect(auditOf(result, 'sheet_a').insertedRowCount).toBe(1);
    });

    it('seed：模板数据只进 seedRows，action=seed-only', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({ sheet_a: sheet('A', ['row_id', '名称'], [['1', '铁剑']], UNIQUE_DDL) }),
        dataMode: 'seed',
      });
      expect(result.ok).toBe(true);
      expect(auditOf(result, 'sheet_a').action).toBe('seed-only');
      expect(auditOf(result, 'sheet_a').insertedRowCount).toBe(0);
    });
  });

  describe('merge 模式', () => {
    it('缺少唯一业务键时 fail-closed 阻止 merge', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({ sheet_a: sheet('A', ['row_id', '名称'], [['1', '铁剑']]) }),
        dataMode: 'merge',
      });
      expect(result.ok).toBe(false);
      expect(result.blockers[0].code).toBe('missing_business_key');
      expect(auditOf(result, 'sheet_a').action).toBe('blocked');
    });

    it('merge：业务键未命中既有行时标记插入', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({ sheet_a: sheet('A', ['row_id', 'code', 'name'], [['1', 'C1', '铁剑']], UNIQUE_DDL) }),
        runtimeData: state({ sheet_a: sheet('A', ['row_id', 'code', 'name'], [['9', 'C2', '盾牌']], UNIQUE_DDL) }),
        dataMode: 'merge',
        conflictPolicy: 'keep-current',
      });
      expect(result.ok).toBe(true);
      expect(result.mergePlan?.sheet_a.insertRowIds).toEqual(['1']);
      expect(auditOf(result, 'sheet_a').action).toBe('merged-insert');
      expect(auditOf(result, 'sheet_a').insertedRowCount).toBe(1);
    });

    it('merge：业务键命中既有行时按 keep-current 保留', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({ sheet_a: sheet('A', ['row_id', 'code', 'name'], [['1', 'C1', '铁剑']], UNIQUE_DDL) }),
        runtimeData: state({ sheet_a: sheet('A', ['row_id', 'code', 'name'], [['9', 'C1', '旧值']], UNIQUE_DDL) }),
        dataMode: 'merge',
        conflictPolicy: 'keep-current',
      });
      expect(result.ok).toBe(true);
      expect(auditOf(result, 'sheet_a').conflictRowCount).toBe(1);
      expect(auditOf(result, 'sheet_a').keptRowCount).toBe(1);
      expect(result.mergePlan?.sheet_a.conflictRowIds).toEqual(['1']);
    });

    it('merge：conflictPolicy=reject 时冲突行阻塞', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({ sheet_a: sheet('A', ['row_id', 'code', 'name'], [['1', 'C1', '铁剑']], UNIQUE_DDL) }),
        runtimeData: state({ sheet_a: sheet('A', ['row_id', 'code', 'name'], [['9', 'C1', '旧值']], UNIQUE_DDL) }),
        dataMode: 'merge',
        conflictPolicy: 'reject',
      });
      expect(result.ok).toBe(false);
      expect(result.blockers[0].code).toBe('merge_conflict_rejected');
      expect(result.mergePlan?.sheet_a.rejectedRowIds).toEqual(['1']);
    });

    it('merge：conflictPolicy=template-wins 时冲突行进 overrideRowIds 覆盖', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({ sheet_a: sheet('A', ['row_id', 'code', 'name'], [['1', 'C1', '铁剑']], UNIQUE_DDL) }),
        runtimeData: state({ sheet_a: sheet('A', ['row_id', 'code', 'name'], [['9', 'C1', '旧值']], UNIQUE_DDL) }),
        dataMode: 'merge',
        conflictPolicy: 'template-wins',
      });
      expect(result.ok).toBe(true);
      expect(result.mergePlan?.sheet_a.overrideRowIds).toEqual(['1']);
      expect(result.mergePlan?.sheet_a.matchedRowIds).toEqual([]);
    });

    it('merge：复合 UNIQUE 键按组合值匹配', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({ sheet_a: sheet('A', ['row_id', 'code', 'name'], [['1', 'C1', '铁剑']], TABLE_UNIQUE_DDL) }),
        runtimeData: state({ sheet_a: sheet('A', ['row_id', 'code', 'name'], [['9', 'C1', '盾牌']], TABLE_UNIQUE_DDL) }),
        dataMode: 'merge',
      });
      expect(result.ok).toBe(true);
      expect(result.mergePlan?.sheet_a.insertRowIds).toEqual(['1']);
    });
  });

  describe('跨来源完全重复去重', () => {
    it('replace：content 与 seedRows 完全重复时预检成功，审计反映去重', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({
          sheet_a: { ...sheet('A', ['row_id', '名称'], [['1', '甲']]), seedRows: [['1', '甲']] },
        }),
        dataMode: 'replace',
      });
      expect(result.ok).toBe(true);
      expect(auditOf(result, 'sheet_a').action).toBe('replaced');
      expect(auditOf(result, 'sheet_a').templateRowCount).toBe(1);
      expect(auditOf(result, 'sheet_a').deduplicatedSeedRows).toEqual([{ rowId: '1', contentRowIndex: 0 }]);
    });

    it('seed：完全重复跨池数据只剩一份 seed 语义，不写 runtime', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({
          sheet_a: { ...sheet('A', ['row_id', '名称'], [['1', '甲']]), seedRows: [['1', '甲']] },
        }),
        dataMode: 'seed',
      });
      expect(result.ok).toBe(true);
      expect(auditOf(result, 'sheet_a').action).toBe('seed-only');
      expect(auditOf(result, 'sheet_a').deduplicatedSeedRows).toEqual([{ rowId: '1', contentRowIndex: 0 }]);
    });

    it('merge：完全重复跨池数据先去重，再独立验证 runtime 业务键冲突策略', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({
          sheet_a: { ...sheet('A', ['row_id', 'code', 'name'], [['1', 'C1', '铁剑']], UNIQUE_DDL), seedRows: [['1', 'C1', '铁剑']] },
        }),
        runtimeData: state({ sheet_a: sheet('A', ['row_id', 'code', 'name'], [['9', 'C1', '旧值']], UNIQUE_DDL) }),
        dataMode: 'merge',
        conflictPolicy: 'keep-current',
      });
      expect(result.ok).toBe(true);
      expect(result.mergePlan?.sheet_a.conflictRowIds).toEqual(['1']);
      expect(auditOf(result, 'sheet_a').deduplicatedSeedRows).toEqual([{ rowId: '1', contentRowIndex: 0 }]);
    });

    it('同 row_id 不同字段仍映射为 cross_pool_row_id_collision', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({
          sheet_a: { ...sheet('A', ['row_id', '名称'], [['1', '甲']]), seedRows: [['1', '乙']] },
        }),
        dataMode: 'replace',
      });
      expect(result.ok).toBe(false);
      expect(result.blockers[0].code).toBe('cross_pool_row_id_collision');
    });
  });

  describe('跨池与身份', () => {
    it('content 与 seedRows 共享身份空间，重复 row_id 阻断', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({
          sheet_a: { ...sheet('A', ['row_id', '名称'], [['1', '甲']]), seedRows: [['1', '乙']] },
        }),
        dataMode: 'replace',
      });
      expect(result.ok).toBe(false);
      expect(result.blockers[0].code).toBe('cross_pool_row_id_collision');
    });
  });

  describe('fail-closed 结构性问题', () => {
    it('行宽超过表头时阻塞（invalid_row）', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({
          sheet_a: {
            ...sheet('A', ['row_id', '名称'], [['1', '甲']]),
            content: [['row_id', '名称'], ['1', '甲', '多余列']],
          },
        }),
        dataMode: 'replace',
      });
      expect(result.ok).toBe(false);
      expect(result.blockers[0].code).toBe('invalid_row');
    });

    it('缺 content 时阻塞（invalid_row）', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({ sheet_a: { name: 'A', sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 } }),
        dataMode: 'replace',
      });
      expect(result.ok).toBe(false);
      expect(result.blockers[0].code).toBe('invalid_row');
    });

    it('跨池重复 row_id 映射为 cross_pool_row_id_collision', () => {
      const result = preflightTemplateDataImport_ACU({
        templateData: state({
          sheet_a: { ...sheet('A', ['row_id', '名称'], [['1', '甲']]), seedRows: [['1', '乙']] },
        }),
        dataMode: 'replace',
      });
      expect(result.ok).toBe(false);
      expect(result.blockers[0].code).toBe('cross_pool_row_id_collision');
    });
  });
});
