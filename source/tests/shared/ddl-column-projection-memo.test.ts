/**
 * tests/shared/ddl-column-projection-memo.test.ts
 * P1-p：getSheetColumnProjection_ACU 的 DDL 重解析记忆化。
 *
 * 该函数被 UI 与生成链 19 处共用（prompt 组装、模板范围投影、注入引擎、SQL 表服务、
 * 可视化器…），每次调用都要把整条 DDL 从零重解一遍（含逐列分词、注释剥离、
 * DEFAULT 表达式扫描与多趟正则）。而它的输入只有三样：
 *   ① DDL 串（sourceData.ddl）
 *   ② 表头行 content[0]
 *   ③ 隐藏列配置 sourceData.hiddenPhysicalColumns
 * 其中只有 ① 需要重解析（②③ 是逐元素读取），因此记忆化 ① 的解析产物，
 * ②③ 每次现读现算——这样既省掉整条 DDL 的重解析，又不会把可变结果对象
 * 交给多个调用方共享（本仓 v9.6.6 有过「共享引用被就地改」的事故）。
 *
 * 判别点（test-audit 2026-09-29 后）：三条失效路径、与朴素实现逐字相等、
 * 失败路径不记忆化（每次都抛、warn 每次都发）。「命中计数（同输入第二次不再重解析）」
 * 已按 junk patterns 删除（纯计数钉子；正确性由逐字等价 keeper 锁定）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ warns: [] as any[][] }));

vi.mock('../../src/shared/utils', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/shared/utils')>();
  return {
    ...actual,
    logWarn_ACU: (...args: any[]) => { h.warns.push(args); },
  };
});

import {
  getSheetColumnProjection_ACU,
  parseDDLColumnInfos_ACU,
  projectSheetRowToVisibleColumns_ACU,
  projectSheetHeadersToVisibleColumns_ACU,
  projectSheetDDLForVisibleColumns_ACU,
  __resetSheetColumnProjectionMemoForTests_ACU,
} from '../../src/shared/ddl-utils';

const BASE_DDL = [
  'CREATE TABLE inventory (',
  '  row_id INTEGER PRIMARY KEY, -- 行号',
  '  item_name TEXT, -- 名称',
  '  legacy_note TEXT, -- 旧备注',
  '  quantity INTEGER DEFAULT 0, -- 数量',
  ');',
].join('\n');

function makeSheet(overrides: {
  ddl?: string;
  headers?: any[];
  hidden?: any;
} = {}) {
  return {
    name: '库存',
    content: [overrides.headers ?? ['row_id', '名称', '旧备注', '数量'], ['1', '铁剑', '历史秘密', '3']],
    sourceData: {
      note: '',
      ddl: overrides.ddl === undefined ? BASE_DDL : overrides.ddl,
      ...(overrides.hidden === undefined ? { hiddenPhysicalColumns: ['legacy_note'] } : { hiddenPhysicalColumns: overrides.hidden }),
    },
  } as any;
}

/** 朴素参考：与优化前同形态的独立实现（DDL 每次现解，其余逐元素现读）。 */
function naiveProjection(sheet: any) {
  const headers = Array.isArray(sheet?.content?.[0]) ? sheet.content[0].map((value: any) => String(value ?? '')) : [];
  const ddlColumns = parseDDLColumnInfos_ACU(String(sheet?.sourceData?.ddl || ''));
  const rawHidden = sheet?.sourceData?.hiddenPhysicalColumns;
  if (rawHidden !== undefined && !Array.isArray(rawHidden)) throw new Error('hiddenPhysicalColumns 必须是 physical column 字符串数组。');
  const hidden = (rawHidden || []).map((value: any) => String(value ?? '').trim()).filter(Boolean);
  const hiddenCanonical = hidden.map((value: string) => value.toLowerCase());
  if (new Set(hiddenCanonical).size !== hiddenCanonical.length) throw new Error('hiddenPhysicalColumns 包含大小写不敏感的重复 physical column。');
  if (hiddenCanonical.includes('row_id')) throw new Error('row_id 不允许隐藏。');
  const canMapByIndex = ddlColumns.length === headers.length;
  const physicalNames = canMapByIndex ? ddlColumns.map((column) => column.sqlName) : headers;
  const physicalCanonical = new Set([
    ...physicalNames.map((value: string) => value.toLowerCase()),
    ...(canMapByIndex ? [] : ddlColumns.map((column) => column.sqlName.toLowerCase())),
  ]);
  const unknown = hidden.filter((value: string) => !physicalCanonical.has(value.toLowerCase()));
  if (unknown.length > 0) throw new Error(`hiddenPhysicalColumns 指向不存在的 physical column「${unknown.join('、')}」。`);
  const hiddenSet = new Set(hiddenCanonical);
  const columns = headers.map((header: string, sourceIndex: number) => {
    const physicalName = physicalNames[sourceIndex] || header;
    const ddlName = canMapByIndex ? '' : (ddlColumns[sourceIndex]?.sqlName || '');
    const hiddenFlag = hiddenSet.has(physicalName.toLowerCase())
      || (!!ddlName && hiddenSet.has(ddlName.toLowerCase()))
      || (!!header && hiddenSet.has(String(header).toLowerCase()));
    return { sourceIndex, physicalName, header, hidden: hiddenFlag };
  });
  return { columns, visibleColumns: columns.filter((column) => !column.hidden), hiddenPhysicalColumns: hidden };
}

const FIXTURES: Array<[string, any]> = [
  ['标准隐藏列', makeSheet()],
  ['无隐藏列', makeSheet({ hidden: undefined })],
  ['空隐藏数组', makeSheet({ hidden: [] })],
  ['多个隐藏列', makeSheet({ hidden: ['legacy_note', 'quantity'] })],
  ['大小写不同的隐藏名', makeSheet({ hidden: ['LEGACY_NOTE'] })],
  ['DDL 与表头列数不一致', makeSheet({ headers: ['row_id', '名称', '旧备注'] })],
  ['无 DDL（native 模式按表头名判隐藏）', makeSheet({ ddl: '' })],
  ['非法 DDL 文本', makeSheet({ ddl: '这不是 CREATE TABLE' })],
  ['表头含 null 占位与数字', makeSheet({ headers: [null, '名称', 0, '数量'] })],
  ['模板范围投影：表头少于 DDL 列', makeSheet({ headers: ['row_id', '名称'] })],
];

describe('getSheetColumnProjection_ACU DDL 解析记忆化', () => {
  beforeEach(() => {
    h.warns = [];
    __resetSheetColumnProjectionMemoForTests_ACU();
  });

  // NOTE(test-audit 2026-09-29)：此处曾有「同输入第二次调用不再重解析 DDL」，
  // 断言 ddlParses/memoHits 精确计数（19 处共用只付一次解析成本）。
  // 输出正确性由下条「与朴素实现逐字相等」keeper 锁定，纯计数用例整条删除。

  it('与朴素实现对同一批 fixture 逐字相等（含异常文案）', () => {
    FIXTURES.forEach(([name, sheet]) => {
      const expected = (() => { try { return naiveProjection(sheet); } catch (error) { return `throw:${(error as Error).message}`; } })();
      const actual = (() => { try { return getSheetColumnProjection_ACU(sheet); } catch (error) { return `throw:${(error as Error).message}`; } })();
      expect(actual, name).toEqual(expected);
    });
  });

  it('失效路径①：改 DDL 后重新解析并给出新投影', () => {
    const before = getSheetColumnProjection_ACU(makeSheet());
    const changedDdl = BASE_DDL.replace('quantity INTEGER DEFAULT 0, -- 数量', 'quantity REAL, -- 数量');
    const after = getSheetColumnProjection_ACU(makeSheet({ ddl: changedDdl }));

    expect(after).toEqual(naiveProjection(makeSheet({ ddl: changedDdl })));
    expect(after.visibleColumns.map((column) => column.physicalName))
      .toEqual(before.visibleColumns.map((column) => column.physicalName));
  });

  it('失效路径②：改表头行走命中缓存也必须现算（列数不一致时隐藏列改按表头名判定）', () => {
    getSheetColumnProjection_ACU(makeSheet());
    const mismatched = makeSheet({ headers: ['row_id', '名称', '旧备注'] });

    const projection = getSheetColumnProjection_ACU(mismatched);

    // DDL 串没变 → 命中缓存（不重解析）；但表头变了，投影必须跟着变。
    expect(projection).toEqual(naiveProjection(mismatched));
    expect(projection.columns.map((column) => column.header)).toEqual(['row_id', '名称', '旧备注']);
    expect(projection.columns.map((column) => column.hidden)).toEqual([false, false, true]);
    expect(h.warns.filter((args) => String(args[0]).includes('列数不一致'))).toHaveLength(1);
  });

  it('失效路径③：改隐藏列配置立即改变可见列', () => {
    const sheet = makeSheet();
    const first = getSheetColumnProjection_ACU(sheet);
    expect(first.visibleColumns).toHaveLength(3);

    const more = makeSheet({ hidden: ['legacy_note', 'quantity'] });
    const second = getSheetColumnProjection_ACU(more);

    expect(second).toEqual(naiveProjection(more));
    expect(second.visibleColumns).toHaveLength(2);
    expect(second.hiddenPhysicalColumns).toEqual(['legacy_note', 'quantity']);
  });

  it('失败路径不记忆化：非法隐藏列配置每次都抛，且「列数不一致」warn 每次都发', () => {
    const mismatched = makeSheet({ headers: ['row_id', '名称', '旧备注'] });
    getSheetColumnProjection_ACU(mismatched);
    getSheetColumnProjection_ACU(mismatched);
    expect(h.warns.filter((args) => String(args[0]).includes('列数不一致'))).toHaveLength(2);

    const broken = [
      [makeSheet({ hidden: 'legacy_note' as any }), '必须是 physical column 字符串数组'],
      [makeSheet({ hidden: ['legacy_note', 'LEGACY_NOTE'] }), '大小写不敏感的重复'],
      [makeSheet({ hidden: ['row_id'] }), 'row_id 不允许隐藏'],
      [makeSheet({ hidden: ['missing_col'] }), '指向不存在的 physical column'],
    ] as const;

    broken.forEach(([sheet, message]) => {
      expect(() => getSheetColumnProjection_ACU(sheet)).toThrow(message);
      expect(() => getSheetColumnProjection_ACU(sheet)).toThrow(message);
    });
  });

  it('同一次调用的结果对象不被复用：调用方改自己的副本不影响下次取值', () => {
    const sheet = makeSheet();
    const first = getSheetColumnProjection_ACU(sheet);
    first.visibleColumns.push({ sourceIndex: 99, physicalName: 'x', header: 'x', hidden: false });
    first.hiddenPhysicalColumns.push('tampered');

    const second = getSheetColumnProjection_ACU(sheet);
    expect(second.visibleColumns).toHaveLength(3);
    expect(second.hiddenPhysicalColumns).toEqual(['legacy_note']);
    expect(second).toEqual(naiveProjection(sheet));
  });

  it('下游投影入口（DDL / 行 / 表头）仍逐字一致', () => {
    const sheet = makeSheet();
    expect(projectSheetRowToVisibleColumns_ACU(sheet, sheet.content[1])).toEqual(['1', '铁剑', '3']);
    expect(projectSheetHeadersToVisibleColumns_ACU(sheet)).toEqual(['row_id', '名称', '数量']);
    const projectedDdl = projectSheetDDLForVisibleColumns_ACU(sheet);
    expect(projectedDdl).not.toContain('legacy_note');
  });
});
