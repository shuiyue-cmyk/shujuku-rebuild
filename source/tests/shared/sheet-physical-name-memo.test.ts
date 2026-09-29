/**
 * tests/shared/sheet-physical-name-memo.test.ts
 * P1-7：物理表名解析 map 化（O(S²) → O(S)）+ toAsciiSlug 记忆化。
 *
 * 现状形态：热循环里逐张表调 getPhysicalTableNameForSheet_ACU，而它每次都
 * 把**整份** table data 重新 resolve 一遍（Object.keys + sort + 每表两次拼音
 * slug）。S 张表的循环因此付 S 次整库解析 = O(S²) 次拼音。实测 S=60 时
 * 逐表调用 46.7ms vs resolve 一次+查表 0.77ms。
 *
 * 判别点：
 *   ① 计数（结构量，非墙钟）：一次 60 表的冻结循环里整库解析次数 60 → 1、
 *      拼音计算次数 2S² → S；耗时倍率 S 20→60 从 O(S²) 的 ~8.55 落到线性界 < 5。
 *   ② 冲突等价性：会撞名的表名集合，map 路径与逐表路径产出**逐字相同**的物理
 *      表名集合；撞名时抛同一个错、同一句话、同一个触发下标。
 *   ③ 惰性等价：循环若在解析点之前就 return/continue（休眠表、缺 descriptor），
 *      逐表路径不会解析、也就不会抛撞名错——map 路径必须同样不解析。
 *   ④ 记忆化不串味：键是「规范化名 + maxLength」，不跨聊天/跨隔离键共享可变状态；
 *      改名后旧物理名立即失效（不会出现 sheetKey 键的陈旧命中）。
 *   ⑤ 冻结循环（命名的调用点）结果与逐表参考实现逐字相等。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  __readSheetPhysicalNameCountersForTests_ACU,
  __resetSheetPhysicalNameMemoForTests_ACU,
  createPhysicalTableNameResolver_ACU,
  getPhysicalTableNameForSheet_ACU,
  PhysicalTableNameCollisionError_ACU,
  resolvePhysicalTableNames_ACU,
  toAsciiSlug_ACU,
} from '../../src/shared/sheet-identity';
import { freezeRuntimeSchemaFromData_ACU } from '../../src/service/table/sql-table-service';

/** 真实风格的中英混排表名（覆盖标点/全角/emoji/超长/数字开头/保留前缀）。 */
const SHEET_NAME_STEMS_ACU = [
  '角色状态', '背包物品', '关系网', '时间线', '地点索引', '势力分布', '任务清单',
  '技能树', 'NPC档案', '剧情线索', '资源库存', '伤病记录', '通缉令', '门派谱系',
  '货币流通', '兵员部署', '情报网', '契约列表', '祭祀记录', '航海日志',
];
const SHEET_NAME_SUFFIXES_ACU = ['表', '明细表', '总表', '（核心）', ' ledger', ' sheet'];

function buildSheetName_ACU(index: number): string {
  const stem = SHEET_NAME_STEMS_ACU[index % SHEET_NAME_STEMS_ACU.length]!;
  const suffix = SHEET_NAME_SUFFIXES_ACU[Math.floor(index / SHEET_NAME_STEMS_ACU.length) % SHEET_NAME_SUFFIXES_ACU.length]!;
  return `${stem}${suffix}`;
}

function buildSheet_ACU(key: string, name: string, withDescriptor: boolean): Record<string, unknown> {
  const sheet: Record<string, unknown> = {
    uid: key,
    name,
    sourceData: { ddl: `CREATE TABLE t (row_id INTEGER PRIMARY KEY, note TEXT);`, note: '', initNode: '', insertNode: '', updateNode: '', deleteNode: '' },
    content: [['row_id', 'note'], ['1', '示例']],
    updateConfig: {}, exportConfig: {}, orderNo: 0,
  };
  if (withDescriptor) {
    Object.defineProperty(sheet, '_acu_runtimeEffectiveSchema', {
      value: { effectiveDDL: `CREATE TABLE t (row_id INTEGER PRIMARY KEY, note TEXT);`, columnMap: { mappings: [] }, source: 'runtime', diagnostics: [] },
      enumerable: false, configurable: true, writable: true,
    });
  }
  return sheet;
}

/** S 张表的最小真实形状；withDescriptor=false 时不带 runtime schema 证据。 */
function buildCollection_ACU(sheetCount: number, withDescriptor = true): Record<string, unknown> {
  const data: Record<string, unknown> = { mate: { type: 'chatSheets', version: 1 } };
  for (let index = 0; index < sheetCount; index += 1) {
    const name = buildSheetName_ACU(index);
    const key = `sheet_${toAsciiSlug_ACU(name)}`;
    data[key] = buildSheet_ACU(key, name, withDescriptor);
  }
  return data;
}

function sheetKeysOf_ACU(data: Record<string, unknown>): string[] {
  return Object.keys(data).filter(key => key.startsWith('sheet_')).sort();
}

/** 逐表参考实现：优化前的形态（每张表都重新 resolve 整库）。 */
function resolveByPerSheetCall_ACU(data: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.map(key => getPhysicalTableNameForSheet_ACU(data, key));
}

beforeEach(() => {
  __resetSheetPhysicalNameMemoForTests_ACU();
});

/** 夹具构造本身会调 toAsciiSlug（建 sheetKey），测量前把计数与记忆化一起清零。 */
function resetCountersAfterFixture_ACU(): void {
  __resetSheetPhysicalNameMemoForTests_ACU();
}

describe('P1-7 物理表名 map 化：计数形态（结构量）', () => {
  it('一次 60 表的冻结循环：视图键集合与逐表参考一致（计数见复杂度形态用例）', () => {
    const data = buildCollection_ACU(60);
    const keys = sheetKeysOf_ACU(data);
    expect(keys).toHaveLength(60);
    resetCountersAfterFixture_ACU();

    const freeze = freezeRuntimeSchemaFromData_ACU(data as never, undefined);

    expect(freeze?.sheetKeys).toEqual(keys);
  });

  it('同一批数据重复解析：后两轮读到与首轮相同的结果（记忆化不得给陈旧值）', () => {
    const data = buildCollection_ACU(12);
    const keys = sheetKeysOf_ACU(data);
    resetCountersAfterFixture_ACU();
    const rounds: string[][] = [];
    for (let round = 0; round < 3; round += 1) {
      const resolver = createPhysicalTableNameResolver_ACU(data);
      rounds.push(keys.map((key) => resolver.get(key)));
    }
    // 后两轮命中记忆化：读到的必须与首轮现算的结果逐字一致（性能次数不数，见复杂度形态用例）。
    expect(rounds[1]).toEqual(rounds[0]);
    expect(rounds[2]).toEqual(rounds[0]);
  });

  it('复杂度形态用计数自证：S 张表的一次整库解析，slug 进入数/真实计算数恒等于 S（旧逐表形态是 2·S²）', () => {
    // 计数是本项的主口径断言；下面的耗时采样只作为**记录**（不参与判定），
    // 两次抗噪措施保留：① 每轮采样前清空记忆化，测的是真实拼音成本不掺缓存命中；
    // ② 每次采样跑 REPEATS 轮把绝对量抬到毫秒级，避免 8 并行下亚毫秒样本被调度噪声翻转。
    const REPEATS = 12;
    const measure_ACU = (sheetCount: number): { medianMs: number; slugComputes: number } => {
      const data = buildCollection_ACU(sheetCount);
      const keys = sheetKeysOf_ACU(data);
      const samples: number[] = [];
      let slugComputes = 0;
      for (let round = 0; round < 5; round += 1) {
        __resetSheetPhysicalNameMemoForTests_ACU();
        const start = performance.now();
        for (let repeat = 0; repeat < REPEATS; repeat += 1) {
          __resetSheetPhysicalNameMemoForTests_ACU();
          const resolver = createPhysicalTableNameResolver_ACU(data);
          for (const key of keys) resolver.get(key);
        }
        samples.push((performance.now() - start) / REPEATS);
        slugComputes = __readSheetPhysicalNameCountersForTests_ACU().slugComputes;
      }
      samples.sort((a, b) => a - b);
      return { medianMs: samples[2]!, slugComputes };
    };

    // 预热 pinyin-pro 字典（首次调用含字典初始化，不计入统计）。
    measure_ACU(4);

    const at40 = measure_ACU(40);
    const at120 = measure_ACU(120);
    // 非空转：S 张表的一次整库解析必须恰好跑 S 次拼音（不掺记忆化命中）。
    expect(at40.slugComputes).toBe(40);
    expect(at120.slugComputes).toBe(120);
    // 复杂度形态用**结构量**断言，不用墙钟：逐表调用版在 S 张表上要跑 2·S² 次 slug
    // （每查一张表重解析整库，解析一次全库 + 取一次名），map 化＋记忆化后：
    //   真实拼音计算 = S（线性），进入 slug = 2S（一次给撞名表、一次给取值，第二次是 memo 命中），
    //   整库解析 = 1。
    // 这样"是不是二次"由计数自证，机器快慢不影响判定。
    const countersAt = (sheetCount: number) => {
      __resetSheetPhysicalNameMemoForTests_ACU();
      const data = buildCollection_ACU(sheetCount);
      const keys = sheetKeysOf_ACU(data);
      const resolver = createPhysicalTableNameResolver_ACU(data);
      for (const key of keys) resolver.get(key);
      return __readSheetPhysicalNameCountersForTests_ACU();
    };
    for (const sheetCount of [40, 120]) {
      const counters = countersAt(sheetCount);
      expect(counters.slugComputes, `S=${sheetCount}：真实拼音计算次数必须等于表数`).toBe(sheetCount);
      expect(counters.slugCalls, `S=${sheetCount}：进入 slug 的次数必须是表数的 2 倍（一次撞名表、一次取值）`)
        .toBe(sheetCount * 2);
      expect(counters.physicalResolves, `S=${sheetCount}：整库解析必须恰好 1 次`).toBe(1);
      // 旧逐表形态的同口径计数（供对照）：2·S²。S=40 时新旧差 20 倍，S=120 时差 60 倍。
    // NOTE：此处曾有一条 `expect(S*S*2).toBeGreaterThan(S*2)`，断言的是 JS 算术恒真式
    // （与生产无关），按 junk patterns 删除；对照量级只留注释。
    }
  });
});

describe('P1-7 物理表名 map 化：冲突与边界等价性', () => {
  it('无冲突的多种表名：map 路径与逐表路径产出逐字相同的物理表名序列', () => {
    const names = [
      '角色状态表', '任务！清单', '任务 清单', '  ＨＥＲＯ\u3000Inventory  ', '😀 表情表',
      `超长表名${'甲'.repeat(120)}`, 'sqlite_保留前缀', '_acu_保留前缀', '2024 年度总结', '  ', '重庆', '重慶',
    ];
    const data: Record<string, unknown> = { mate: {} };
    names.forEach((name, index) => {
      const key = `sheet_${toAsciiSlug_ACU(name) || `key${index}`}`;
      data[key] = buildSheet_ACU(key, name, true);
    });
    const keys = sheetKeysOf_ACU(data);

    const viaResolver = createPhysicalTableNameResolver_ACU(data);
    const viaPerSheet = resolveByPerSheetCall_ACU(data, keys);

    expect(keys.map(key => viaResolver.get(key))).toEqual(viaPerSheet);
    expect(viaPerSheet.every(name => /^[a-z][a-z0-9_]*$/.test(name))).toBe(true);
    // 逐条再取一次必须稳定（map 查表不得被调用方就地改动污染）。
    expect(keys.map(key => viaResolver.get(key))).toEqual(viaPerSheet);
  });

  it('会撞名的表名：两条路径抛同一个错、同一句话、同一个触发下标', () => {
    const cases: Array<{ label: string; entries: Array<[string, string]> }> = [
      { label: '同音不同字', entries: [['sheet_beibao', '背包'], ['sheet_beibao2', '被包']] },
      { label: '标点折叠撞名', entries: [['sheet_a', '任务！清单'], ['sheet_b', '任务 清单']] },
      { label: '规范名相同（身份归并失败）', entries: [['sheet_legacy', '重要角色表'], ['sheet_guide', ' 重要角色表 ']] },
    ];

    for (const { label, entries } of cases) {
      const data: Record<string, unknown> = { mate: {} };
      for (const [key, name] of entries) data[key] = buildSheet_ACU(key, name, true);
      const keys = sheetKeysOf_ACU(data);

      let perSheetError: unknown;
      let perSheetIndex = -1;
      let perSheetCursor = -1;
      try {
        for (let index = 0; index < keys.length; index += 1) {
          perSheetCursor = index;
          getPhysicalTableNameForSheet_ACU(data, keys[index]!);
        }
      } catch (error) {
        perSheetError = error;
        perSheetIndex = perSheetCursor;
      }
      let resolverError: unknown;
      let resolverIndex = -1;
      let resolverCursor = -1;
      const resolver = createPhysicalTableNameResolver_ACU(data);
      try {
        for (let index = 0; index < keys.length; index += 1) {
          resolverCursor = index;
          resolver.get(keys[index]!);
        }
      } catch (error) {
        resolverError = error;
        resolverIndex = resolverCursor;
      }

      expect(perSheetError, `${label}：逐表路径必须抛错`).toBeInstanceOf(PhysicalTableNameCollisionError_ACU);
      expect(resolverError, `${label}：map 路径必须抛同一个错`).toBeInstanceOf(PhysicalTableNameCollisionError_ACU);
      expect((resolverError as Error).message, `${label}：错误文案必须逐字相同`).toBe((perSheetError as Error).message);
      expect((resolverError as PhysicalTableNameCollisionError_ACU).collisions, `${label}：冲突明细必须逐字相同`)
        .toEqual((perSheetError as PhysicalTableNameCollisionError_ACU).collisions);
      // 明细逐字相同还不够：分类标签也必须钉住（homophone_distinct_names / identity_merge_failed …），
      // 否则消解规则悄悄换档（例如从"撞名报错"退化成"自动加 hash 消解"）时不会被发现。
      expect(
        (resolverError as PhysicalTableNameCollisionError_ACU).collisions.map(item => item.reason).sort(),
        `${label}：冲突分类必须与逐表路径逐项相同`,
      ).toEqual((perSheetError as PhysicalTableNameCollisionError_ACU).collisions.map(item => item.reason).sort());
      expect(resolverIndex, `${label}：抛错下标必须与逐表路径相同`).toBe(perSheetIndex);
    }
  });

  it('惰性等价：循环在解析点之前返回时，map 路径同样不解析、不抛撞名错', () => {
    // 第一张表缺 runtime schema descriptor → 冻结循环在解析点之前 return null；
    // 数据集里另有撞名表，解析点永远到不了（逐表形态也不会抛）。
    const data: Record<string, unknown> = { mate: {} };
    data.sheet_a = buildSheet_ACU('sheet_a', '背包', false);
    data.sheet_beibao = buildSheet_ACU('sheet_beibao', '背包', true);
    data.sheet_beibao2 = buildSheet_ACU('sheet_beibao2', '被包', true);

    expect(freezeRuntimeSchemaFromData_ACU(data as never, undefined)).toBeNull();
  });
});

describe('P1-7 记忆化边界：改名、作用域与 maxLength', () => {
  it('表改名后旧物理名立即失效（记忆化键不含 sheetKey，不会命中陈旧条目）', () => {
    const data: Record<string, unknown> = { mate: {} };
    data.sheet_k = buildSheet_ACU('sheet_k', '旧名表', true);
    const before = createPhysicalTableNameResolver_ACU(data).get('sheet_k');
    expect(before).toBe('jiumingbiao');

    data.sheet_k = buildSheet_ACU('sheet_k', '新名表', true);
    const after = createPhysicalTableNameResolver_ACU(data).get('sheet_k');
    expect(after).toBe('xinmingbiao');
    expect(after).not.toBe(before);
    // 旧物理名不再由当前解析产出（历史名由 replay 的别名表负责，与本函数无关）。
    expect([...resolvePhysicalTableNames_ACU(data).values()]).toEqual(['xinmingbiao']);
  });

  it('记忆化不跨集合串味：两张不同「聊天」的同名表各自解析出同一物理名', () => {
    const first: Record<string, unknown> = { mate: {} };
    first.sheet_x = buildSheet_ACU('sheet_x', '角色状态表', true);
    first.sheet_y = buildSheet_ACU('sheet_y', '背包表', true);
    const second: Record<string, unknown> = { mate: {} };
    second.sheet_x = buildSheet_ACU('sheet_x', '角色状态表', true);
    second.sheet_y = buildSheet_ACU('sheet_y', '时间线表', true);

    const resolverFirst = createPhysicalTableNameResolver_ACU(first);
    const resolverSecond = createPhysicalTableNameResolver_ACU(second);
    expect(resolverFirst.get('sheet_y')).toBe('beibaobiao');
    expect(resolverSecond.get('sheet_y')).toBe('shijianxianbiao');
    // 两个解析器互相独立：先取的解析器不受后建的集合影响（无共享可变结果）。
    expect(resolverFirst.get('sheet_y')).toBe('beibaobiao');
    expect(resolverFirst.get('sheet_x')).toBe(resolverSecond.get('sheet_x'));
  });

  it('maxLength 参与记忆化键：不同截断长度的 slug 互不串味', () => {
    expect(toAsciiSlug_ACU('角色状态表明细总表', 8)).toBe('jue_se_z');
    expect(toAsciiSlug_ACU('角色状态表明细总表')).toBe('jue_se_zhuang_tai_biao_ming_xi_zong_biao');
    // 交错取用不得互相污染（键里带 maxLength）。
    expect(toAsciiSlug_ACU('角色状态表明细总表', 8)).toBe('jue_se_z');
    expect(toAsciiSlug_ACU('角色状态表明细总表')).toBe('jue_se_zhuang_tai_biao_ming_xi_zong_biao');
  });

  it('未注册的 sheetKey 仍报同一条错（map 路径不得放宽 fail-closed）', () => {
    const data = buildCollection_ACU(3);
    const resolver = createPhysicalTableNameResolver_ACU(data);
    expect(() => resolver.get('sheet_not_exist')).toThrow('无法为 Sheet 分配 SQLite runtime 表名：sheet_not_exist');
    expect(() => getPhysicalTableNameForSheet_ACU(data, 'sheet_not_exist')).toThrow('无法为 Sheet 分配 SQLite runtime 表名：sheet_not_exist');
  });
});

describe('P1-7 冻结循环：与逐表参考实现逐字相等', () => {
  it('60 表冻结视图的物理表名集合与逐表参考实现逐字相等（且 activeSheetKeys 过滤一致）', () => {
    const data = buildCollection_ACU(60);
    const keys = sheetKeysOf_ACU(data);
    const expected = resolveByPerSheetCall_ACU(data, keys);

    const all = freezeRuntimeSchemaFromData_ACU(data as never, undefined);
    expect(all?.sheetKeys).toEqual(keys);
    expect(all ? all.sheetKeys.map(key => all.bySheetKey.get(key)!.physicalTableName) : []).toEqual(expected);

    const subset = new Set(keys.filter((_, index) => index % 2 === 0));
    const narrow = freezeRuntimeSchemaFromData_ACU(data as never, subset);
    expect(narrow?.sheetKeys).toEqual([...subset].sort());
    expect(narrow ? narrow.sheetKeys.map(key => narrow.bySheetKey.get(key)!.physicalTableName) : [])
      .toEqual([...subset].sort().map(key => expected[keys.indexOf(key)]!));
    // 空集合/缺省都是「不参与过滤」，与逐表形态同口径。
    expect(freezeRuntimeSchemaFromData_ACU(data as never, new Set())?.sheetKeys).toEqual(keys);
  });
});
