import { describe, expect, it } from 'vitest';
import { reconcileChatTemplate_ACU } from '../../../src/service/template/chat-template-reconciler';
import { buildDefaultTableTemplateObject_ACU, buildOriginalDefaultTableTemplateObject_ACU } from '../../../src/shared/table-defaults/index.js';
import { getSheetColumnProjection_ACU } from '../../../src/shared/ddl-utils';

function sheet(key: string, name: string, headers: string[], ddlColumns: string, rows: Array<Array<string | null>> = [['1', '铁剑']]): any {
  return {
    uid: key, name, orderNo: 0, content: [headers, ...rows],
    sourceData: { ddl: `CREATE TABLE inventory (\n  ${ddlColumns.replace(/ -- ([^,\n]+), /g, ', -- $1\n  ')}\n);` }, updateConfig: {}, exportConfig: {},
  };
}

function state(sheets: Record<string, any>): any {
  return { mate: { type: 'chatSheets', version: 1 }, ...sheets };
}

describe('reconcileChatTemplate_ACU', () => {
  it('按 canonical 表名复用旧 key，按 canonical 列名继承数据并为空新增列生成 V2 contract', async () => {
    const baseline = state({
      sheet_legacy: sheet('sheet_legacy', ' 背包 ', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY,\n  item_name TEXT -- 名称'),
    });
    const template = state({
      sheet_imported: sheet('sheet_imported', '背包', ['row_id', '名称', '品质'], 'row_id INTEGER PRIMARY KEY,\n  item_name TEXT, -- 名称\n  quality TEXT -- 品质'),
    });
    const original = structuredClone({ baseline, template });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_legacy.uid).toBe('sheet_legacy');
    expect(plan.candidateData.sheet_legacy.content).toEqual([['row_id', '名称', '品质'], ['1', '铁剑', null]]);
    expect(plan.candidateData.sheet_imported).toBeUndefined();
    expect(plan.sheetChanges).toEqual([expect.objectContaining({
      kind: 'rebase', sheetKey: 'sheet_legacy',
      sheetData: expect.objectContaining({ content: [['row_id', '名称', '品质'], ['1', '铁剑', null]] }),
    })]);
    expect({ baseline, template }).toEqual(original);
  });

  it('新增表 introduction 保留模板自带数据；旧表默认走 hide，仅硬删除才需确认', async () => {
    const baseline = state({ sheet_old: sheet('sheet_old', '旧表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY, value TEXT -- 值') });
    const template = state({ sheet_new: sheet('sheet_new', '新表', ['row_id', 'value'], 'row_id INTEGER PRIMARY KEY, value TEXT', [['9', '示例']]) });

    // 默认行为（语义1）：切换默认走 hide，不再要求删除确认。
    const defaultPlan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });
    expect(defaultPlan.blockers).toEqual([]);
    expect(defaultPlan.hiddenSheetKeys).toEqual(['sheet_old']);
    expect(defaultPlan.deletedSheetKeys).toEqual([]);
    expect(defaultPlan.candidateData.sheet_xin_biao.content).toEqual([['row_id', 'value'], ['9', '示例']]);
    expect(defaultPlan.sheetChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'introduction', sheetKey: 'sheet_xin_biao' }),
      expect.objectContaining({ kind: 'hide', sheetKey: 'sheet_old' }),
    ]));

    // 显式硬删除仍需 destructiveChangeConfirmed 显式确认。
    const rejected = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false, hardDeleteMissingSheets: true });
    expect(rejected.blockers.join('\n')).toContain('删除表');
    expect(rejected.sheetChanges).toEqual([]);

    const accepted = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: true, hardDeleteMissingSheets: true });
    expect(accepted.blockers).toEqual([]);
    expect(accepted.deletedSheetKeys).toEqual(['sheet_old']);
    expect(accepted.candidateData.sheet_xin_biao.content).toEqual([['row_id', 'value'], ['9', '示例']]);
    expect(accepted.sheetChanges).toEqual([expect.objectContaining({ kind: 'introduction', sheetKey: 'sheet_xin_biao' })]);
  });

  it('旧表无数据且新模板同名表有数据时，采用模板数据', async () => {
    // 与“是否首楼、是否已初始化”无关，只看该表当前有没有数据。
    const baseline = state({
      sheet_rules: sheet('sheet_rules', '系统规则表', ['row_id', '规则名称'],
        'row_id INTEGER PRIMARY KEY,\n  rule_name TEXT -- 规则名称', []),
    });
    const template = state({
      sheet_rules2: sheet('sheet_rules2', '系统规则表', ['row_id', '规则名称'],
        'row_id INTEGER PRIMARY KEY,\n  rule_name TEXT -- 规则名称', [
          [null as any, '属性说明'],
          [null as any, '升级公式'],
        ]),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_rules.content).toEqual([
      ['row_id', '规则名称'],
      ['1', '属性说明'],
      ['2', '升级公式'],
    ]);
  });

  it('旧表已有数据时忽略模板自带数据，以旧表为主', async () => {
    const baseline = state({
      sheet_rules: sheet('sheet_rules', '系统规则表', ['row_id', '规则名称'],
        'row_id INTEGER PRIMARY KEY,\n  rule_name TEXT -- 规则名称', [['1', '旧数据']]),
    });
    const template = state({
      sheet_rules2: sheet('sheet_rules2', '系统规则表', ['row_id', '规则名称'],
        'row_id INTEGER PRIMARY KEY,\n  rule_name TEXT -- 规则名称', [[null as any, '模板数据']]),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_rules.content).toEqual([['row_id', '规则名称'], ['1', '旧数据']]);
  });

  it('两边都无数据时保持表头空表', async () => {
    const baseline = state({
      sheet_rules: sheet('sheet_rules', '系统规则表', ['row_id', '规则名称'],
        'row_id INTEGER PRIMARY KEY,\n  rule_name TEXT -- 规则名称', []),
    });
    const template = state({
      sheet_rules2: sheet('sheet_rules2', '系统规则表', ['row_id', '规则名称'],
        'row_id INTEGER PRIMARY KEY,\n  rule_name TEXT -- 规则名称', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_rules.content).toEqual([['row_id', '规则名称']]);
  });


  it('模板声明 columnAliases 时，列改名仍能继承数据', async () => {
    const baseline = state({
      sheet_g: sheet('sheet_g', '表', ['row_id', '上轮场景时间'],
        'row_id INTEGER PRIMARY KEY,\n  last_round_time TEXT -- 上轮场景时间', [['1', 'T0']]),
    });
    // 新模板把显示名改成「前一轮时间」，并声明它的旧名。
    const template = state({
      sheet_g2: sheet('sheet_g2', '表', ['row_id', '前一轮时间'],
        'row_id INTEGER PRIMARY KEY,\n  last_round_time TEXT -- 前一轮时间'),
    });
    template.sheet_g2.sourceData.columnAliases = { last_round_time: ['上轮场景时间'] };

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    // 数据跟着新显示名继承过来，没有变成空值。
    expect(plan.candidateData.sheet_g.content).toEqual([['row_id', '前一轮时间'], ['1', 'T0']]);
    // 旧列没有被降级成隐藏列。
    expect(plan.candidateData.sheet_g.sourceData.hiddenPhysicalColumns || []).toEqual([]);
    expect(plan.audit[0].inheritedColumns).toContain('前一轮时间');
  });

  it('同一逻辑表改名时累积旧表名，并允许后续模板以显式 tableAliases 认回旧 key', async () => {
    const baseline = state({
      sheet_protagonist: sheet('sheet_protagonist', '主角信息', ['row_id', '名称'],
        'row_id INTEGER PRIMARY KEY, 名称 TEXT'),
    });
    const renamed = state({
      sheet_protagonist: sheet('sheet_protagonist', '主角信息表', ['row_id', '名称'],
        'row_id INTEGER PRIMARY KEY, 名称 TEXT'),
    });
    renamed.sheet_protagonist.sourceData.tableAliases = ['主角信息'];

    const first = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: renamed, destructiveChangeConfirmed: false, storageMode: 'native' });
    expect(first.blockers).toEqual([]);
    expect(first.candidateData.sheet_protagonist.sourceData.tableAliases).toEqual(['主角信息']);

    const laterTemplate = state({
      sheet_protagonist_later: sheet('sheet_protagonist_later', '人物档案', ['row_id', '名称'],
        'row_id INTEGER PRIMARY KEY, 名称 TEXT'),
    });
    laterTemplate.sheet_protagonist_later.sourceData.tableAliases = ['主角信息表'];
    const second = await reconcileChatTemplate_ACU({
      baselineData: first.candidateData,
      templateData: laterTemplate,
      destructiveChangeConfirmed: false,
      storageMode: 'native',
    });

    expect(second.blockers).toEqual([]);
    expect(second.candidateData.sheet_protagonist.name).toBe('人物档案');
    expect(second.candidateData.sheet_protagonist.sourceData.tableAliases)
      .toEqual(['主角信息', '主角信息表']);
  });

  it('模板中的 tableAliases 与其他表身份冲突时在协调前 fail closed', async () => {
    const template = state({
      sheet_alpha: sheet('sheet_alpha', '甲表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY, 值 TEXT'),
      sheet_beta: sheet('sheet_beta', '乙表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY, 值 TEXT'),
    });
    template.sheet_alpha.sourceData.tableAliases = ['角色表'];
    template.sheet_beta.sourceData.tableAliases = [' 角色表 '];

    const plan = await reconcileChatTemplate_ACU({ baselineData: state({}), templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers.join('\n')).toContain('表别名规范化重复');
    expect(plan.sheetChanges).toEqual([]);
  });

  it('改名后自动累积别名，再改一次仍能顺别名链继承', async () => {
    const baseline = state({
      sheet_g: sheet('sheet_g', '表', ['row_id', '上轮场景时间'],
        'row_id INTEGER PRIMARY KEY,\n  last_round_time TEXT -- 上轮场景时间', [['1', 'T0']]),
    });
    const template1 = state({
      sheet_g2: sheet('sheet_g2', '表', ['row_id', '前一轮时间'],
        'row_id INTEGER PRIMARY KEY,\n  last_round_time TEXT -- 前一轮时间'),
    });
    template1.sheet_g2.sourceData.columnAliases = { last_round_time: ['上轮场景时间'] };

    const first = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template1, destructiveChangeConfirmed: false });
    expect(first.blockers).toEqual([]);
    // 数据已按声明继承，且旧显示名被累积进该物理列的别名。
    expect(first.candidateData.sheet_g.content).toEqual([['row_id', '前一轮时间'], ['1', 'T0']]);
    expect(first.candidateData.sheet_g.sourceData.columnAliases.last_round_time).toContain('上轮场景时间');

    // 第二次改名：无需再次声明，靠累积的别名链认回。
    const template2 = state({
      sheet_g3: sheet('sheet_g3', '表', ['row_id', '上轮场景时间'],
        'row_id INTEGER PRIMARY KEY,\n  last_round_time TEXT -- 上轮场景时间'),
    });
    const second = await reconcileChatTemplate_ACU({
      baselineData: first.candidateData,
      templateData: template2,
      destructiveChangeConfirmed: false,
    });
    expect(second.blockers).toEqual([]);
    expect(second.candidateData.sheet_g.content).toEqual([['row_id', '上轮场景时间'], ['1', 'T0']]);
  });

  it('没有别名声明时不猜：列改名仍按新增列处理，旧列隐藏保留', async () => {
    const baseline = state({
      sheet_g: sheet('sheet_g', '表', ['row_id', '上轮场景时间'],
        'row_id INTEGER PRIMARY KEY,\n  last_round_time TEXT -- 上轮场景时间', [['1', 'T0']]),
    });
    const template = state({
      sheet_g2: sheet('sheet_g2', '表', ['row_id', '无关新列'],
        'row_id INTEGER PRIMARY KEY,\n  unrelated TEXT -- 无关新列'),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    // 新列为空，旧列作为隐藏列保留原值——不把两列混为一谈。
    expect(plan.candidateData.sheet_g.content).toEqual([['row_id', '无关新列', '上轮场景时间'], ['1', null, 'T0']]);
    expect(plan.candidateData.sheet_g.sourceData.hiddenPhysicalColumns).toEqual(['last_round_time']);
  });


  it('canonical 相同但模板物理列名不同时，沁用既有物理列名，不随模板改名', async () => {
    // 列身份由 canonical 显示名判定；物理列名一旦确立就不能变。
    // 否则历史 log 里按旧物理名书写的 SQL 回放时会撞 "has no column named ..."。
    const baseline = state({
      sheet_g: sheet('sheet_g', '全局数据表', ['row_id', '上轮场景时间', '当前时间'],
        'row_id INTEGER PRIMARY KEY,\n  last_round_time TEXT, -- 上轮场景时间\n  current_time TEXT -- 当前时间', [['1', 'T0', 'T1']]),
    });
    // 模板用同样的显示名，但物理列名不同。
    const template = state({
      sheet_g2: sheet('sheet_g2', '全局数据表', ['row_id', '上轮场景时间', '当前时间'],
        'row_id INTEGER PRIMARY KEY,\n  prev_scene_time TEXT, -- 上轮场景时间\n  cur_time TEXT -- 当前时间'),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    const ddl = plan.candidateData.sheet_g.sourceData.ddl as string;
    // 沁用旧物理名，不采用模板的新名。
    expect(ddl).toContain('last_round_time');
    expect(ddl).toContain('current_time');
    expect(ddl).not.toContain('prev_scene_time');
    expect(ddl).not.toContain('cur_time');
    // 数据与显示名不变。
    expect(plan.candidateData.sheet_g.content).toEqual([['row_id', '上轮场景时间', '当前时间'], ['1', 'T0', 'T1']]);
  });

  it('沁用旧物理列名时保留模板列的类型与约束', async () => {
    const baseline = state({
      sheet_g: sheet('sheet_g', '表', ['row_id', '数量'],
        'row_id INTEGER PRIMARY KEY,\n  old_qty TEXT -- 数量', [['1', '3']]),
    });
    const template = state({
      sheet_g2: sheet('sheet_g2', '表', ['row_id', '数量'],
        'row_id INTEGER PRIMARY KEY,\n  new_qty INTEGER NOT NULL DEFAULT 0 -- 数量'),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    const ddl = plan.candidateData.sheet_g.sourceData.ddl as string;
    // 列名沁用旧名，但类型/约束/DEFAULT 采用模板的。
    expect(ddl).toMatch(/old_qty INTEGER NOT NULL DEFAULT 0/);
    expect(ddl).not.toContain('new_qty');
  });


  it('模板缺失旧列时保留并隐藏；新增 NOT NULL 无 literal default 时仍 fail closed', async () => {
    const baseline = state({
      sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', '名称', '备注'], 'row_id INTEGER PRIMARY KEY,\n  item_name TEXT, -- 名称\n  note TEXT -- 备注', [['1', '铁剑', '旧备注']]),
    });
    const dropTemplate = state({
      sheet_new: sheet('sheet_new', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY,\n  item_name TEXT -- 名称'),
    });
    const unconfirmed = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: dropTemplate, destructiveChangeConfirmed: false });
    expect(unconfirmed.blockers).toEqual([]);
    expect(unconfirmed.candidateData.sheet_legacy.content).toEqual([['row_id', '名称', '备注'], ['1', '铁剑', '旧备注']]);
    expect(unconfirmed.candidateData.sheet_legacy.sourceData.hiddenPhysicalColumns).toEqual(['note']);
    expect(unconfirmed.audit[0]).toMatchObject({ deletedColumns: [], hiddenColumns: ['备注'], destructiveChangeConfirmed: false });

    const restored = await reconcileChatTemplate_ACU({
      baselineData: unconfirmed.candidateData,
      templateData: baseline,
      destructiveChangeConfirmed: false,
    });
    expect(restored.blockers).toEqual([]);
    expect(restored.candidateData.sheet_legacy.content).toEqual([['row_id', '名称', '备注'], ['1', '铁剑', '旧备注']]);
    expect(restored.candidateData.sheet_legacy.sourceData.hiddenPhysicalColumns).toEqual([]);
    expect(getSheetColumnProjection_ACU(restored.candidateData.sheet_legacy).visibleColumns.map(column => column.header)).toEqual(['row_id', '名称', '备注']);

    const baselineWithoutDrop = state({
      sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY,\n  item_name TEXT -- 名称'),
    });
    const requiredTemplate = state({
      sheet_new: sheet('sheet_new', '背包', ['row_id', '名称', '品质'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称, quality TEXT NOT NULL -- 品质'),
    });
    const invalidDefault = await reconcileChatTemplate_ACU({ baselineData: baselineWithoutDrop, templateData: requiredTemplate, destructiveChangeConfirmed: false });
    // rebase 语义下：新增 NOT NULL 无 DEFAULT 列以空串回填，TEXT NOT NULL 接受 '' → 协调成功。
    expect(invalidDefault.blockers).toEqual([]);
    expect(invalidDefault.candidateData.sheet_legacy.content).toEqual([['row_id', '名称', '品质'], ['1', '铁剑', '']]);
  });

  it('不同显示名即使模板声明 key 已被占用，也作为派生 key 的新表引入', async () => {
    const baseline = state({ sheet_taken: sheet('sheet_taken', '旧表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY, value TEXT -- 值') });
    const template = state({ sheet_taken: sheet('sheet_taken', '新表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY, value TEXT -- 值') });
    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false, storageMode: 'native' });
    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_xin_biao).toMatchObject({ uid: 'sheet_xin_biao', name: '新表' });
    expect(plan.hiddenSheetKeys).toEqual(['sheet_taken']);
  });

  it('同一模板 key 下显示名变化仍视为新表，不自动继承旧表', async () => {
    const baseline = state({
      sheet_DpKcVGqg: sheet('sheet_DpKcVGqg', '主角信息', ['row_id', '姓名'], 'row_id INTEGER PRIMARY KEY,\n  name TEXT -- 姓名', [['1', '助手']]),
    });
    const template = state({
      sheet_DpKcVGqg: sheet('sheet_DpKcVGqg', '主角信息表', ['row_id', '姓名'], 'row_id INTEGER PRIMARY KEY,\n  name TEXT -- 姓名', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false, storageMode: 'native' });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_zhu_jue_xin_xi_biao).toMatchObject({ uid: 'sheet_zhu_jue_xin_xi_biao', name: '主角信息表' });
    expect(plan.candidateData.sheet_zhu_jue_xin_xi_biao.content).toEqual([['row_id', '姓名']]);
    expect(plan.hiddenSheetKeys).toEqual(['sheet_DpKcVGqg']);
  });

  it('不同名称的表使用显示名派生 key，与模板声明 key 无关', async () => {
    const baseline = state({
      sheet_stable: sheet('sheet_stable', '订单', ['row_id', '编号'], 'row_id INTEGER PRIMARY KEY,\n  order_no TEXT -- 编号', [['1', 'A-1']]),
    });
    const template = state({
      sheet_stable: sheet('sheet_stable', '订单表', ['row_id', '编号'], 'row_id INTEGER PRIMARY KEY,\n  order_no TEXT -- 编号', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false, storageMode: 'native' });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_ding_dan_biao.uid).toBe('sheet_ding_dan_biao');
    expect(plan.hiddenSheetKeys).toEqual(['sheet_stable']);
  });

  it('稳定 key 与精确表名分别命中不同历史表时 fail closed，禁止静默串表', async () => {
    const baseline = state({
      sheet_stable: sheet('sheet_stable', '主角信息', ['row_id', '姓名'], 'row_id INTEGER PRIMARY KEY,\n  name TEXT -- 姓名', [['1', '稳定 key 数据']]),
      sheet_other: sheet('sheet_other', '主角信息表', ['row_id', '姓名'], 'row_id INTEGER PRIMARY KEY,\n  name TEXT -- 姓名', [['2', '同名表数据']]),
    });
    const template = state({
      sheet_stable: sheet('sheet_stable', '主角信息表', ['row_id', '姓名'], 'row_id INTEGER PRIMARY KEY,\n  name TEXT -- 姓名', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: true });

    expect(plan.blockers.join('\n')).toContain('无法唯一协调');
    expect(plan.sheetChanges).toEqual([]);
    expect(plan.deletedSheetKeys).toEqual([]);
    expect(plan.candidateData.sheet_stable.content[1][1]).toBe('稳定 key 数据');
    expect(plan.candidateData.sheet_other.content[1][1]).toBe('同名表数据');
  });

  it.each([
    ['精确名称项在前', ['sheet_other', 'sheet_DpKcVGqg']],
    ['历史别名项在前', ['sheet_DpKcVGqg', 'sheet_other']],
  ])('多个模板表中只有显式匹配项继承历史 Sheet，其他项按显示名作为新表引入：%s', async (_label, order) => {
    const baseline = state({
      sheet_DpKcVGqg: sheet('sheet_DpKcVGqg', '主角信息', ['row_id', '姓名'], 'row_id INTEGER PRIMARY KEY,\n  name TEXT -- 姓名', [['1', '历史数据']]),
    });
    const entries: Record<string, any> = {
      sheet_other: sheet('sheet_other', '主角信息', ['row_id', '姓名'], 'row_id INTEGER PRIMARY KEY,\n  name TEXT -- 姓名', []),
      sheet_DpKcVGqg: sheet('sheet_DpKcVGqg', '主角信息表', ['row_id', '姓名'], 'row_id INTEGER PRIMARY KEY,\n  name TEXT -- 姓名', []),
    };
    const template = state(Object.fromEntries(order.map(key => [key, entries[key]])));

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false, storageMode: 'native' });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_DpKcVGqg.content).toEqual([
      ['row_id', '姓名'],
      ['1', '历史数据'],
    ]);
    expect(plan.candidateData.sheet_zhu_jue_xin_xi_biao).toMatchObject({ uid: 'sheet_zhu_jue_xin_xi_biao', name: '主角信息表' });
  });

  it('同一稳定 key 下 physical column 未变时允许表头改名并继承历史数据', async () => {
    const baseline = state({
      sheet_stable: sheet('sheet_stable', '全局数据表', ['row_id', '主角当前所在地点'], 'row_id INTEGER PRIMARY KEY,\n  current_location TEXT -- 主角当前所在地点', [['1', '御苑']]),
    });
    const template = state({
      sheet_stable: sheet('sheet_stable', '全局数据表', ['row_id', '当前详细地点'], 'row_id INTEGER PRIMARY KEY,\n  current_location TEXT -- 当前详细地点', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_stable.content).toEqual([['row_id', '当前详细地点'], ['1', '御苑']]);
    expect(plan.audit[0]).toMatchObject({ inheritedColumns: ['当前详细地点'], addedColumns: [], deletedColumns: [] });
  });

  it('不同 key 的模板仍禁止用同名 physical column 将删除列重解释为新字段', async () => {
    const baseline = state({
      sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', '备注'], 'row_id INTEGER PRIMARY KEY, note TEXT -- 备注', [['1', '旧备注']]),
    });
    const template = state({
      sheet_imported: sheet('sheet_imported', '背包', ['row_id', '品质'], 'row_id INTEGER PRIMARY KEY, note TEXT -- 品质', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: true });

    expect(plan.blockers.join('\n')).toContain('同名 physical column');
    expect(plan.sheetChanges).toEqual([]);
  });

  it('不同 key 的 physical column 仅大小写不同时仍按 SQLite 身份冲突 fail closed', async () => {
    const baseline = state({
      sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', '备注'], 'row_id INTEGER PRIMARY KEY,\n  Note TEXT -- 备注', [['1', '旧备注']]),
    });
    const template = state({
      sheet_imported: sheet('sheet_imported', '背包', ['row_id', '品质'], 'row_id INTEGER PRIMARY KEY,\n  note TEXT -- 品质', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: true });

    expect(plan.blockers.join('\n')).toContain('同名 physical column');
    expect(plan.sheetChanges).toEqual([]);
    expect(plan.deletedSheetKeys).toEqual([]);
  });

  it('旧默认模板切换到当前默认模板时协调稳定 key、历史表名与同 physical 列的显示名变更', async () => {
    const original = buildOriginalDefaultTableTemplateObject_ACU() as any;
    const current = buildDefaultTableTemplateObject_ACU() as any;
    const globalKey = 'sheet_dCudvUnH';
    const protagonistKey = 'sheet_DpKcVGqg';
    const skillsKey = 'sheet_lEARaBa8';
    const baseline = state({
      [globalKey]: structuredClone(original[globalKey]),
      [protagonistKey]: structuredClone(original[protagonistKey]),
      [skillsKey]: structuredClone(original[skillsKey]),
    });
    baseline[globalKey].content.push(['1', '御苑', '2026-02-03 09:00', null, '0分']);
    baseline[protagonistKey].name = '主角信息';
    baseline[protagonistKey].content.push(['1', '助手', '女/18', '红发', '研究员', '旧经历', '理性']);
    baseline[skillsKey].content[0][3] = '技能等级';
    baseline[skillsKey].sourceData.ddl = baseline[skillsKey].sourceData.ddl.replace('-- 等级/阶段', '-- 技能等级');
    baseline[skillsKey].content.push(['1', '分析', '主动', 'Lv.1', '定位问题']);
    const template = state({
      [globalKey]: structuredClone(current[globalKey]),
      [protagonistKey]: structuredClone(current[protagonistKey]),
      [skillsKey]: structuredClone(current[skillsKey]),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: true });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData[globalKey].content).toEqual([
      current[globalKey].content[0],
      ['1', null, '御苑', null, null, null, '0分', '2026-02-03 09:00'],
    ]);
    expect(plan.candidateData[skillsKey].content).toEqual([
      current[skillsKey].content[0],
      ['1', '分析', '主动', 'Lv.1', '定位问题'],
    ]);
    const introducedProtagonistKey = 'sheet_zhu_jue_xin_xi_biao';
    expect(plan.candidateData[introducedProtagonistKey].name).toBe('主角信息表');
    expect(getSheetColumnProjection_ACU(plan.candidateData[introducedProtagonistKey]).visibleColumns.map(column => column.header)).toEqual(current[protagonistKey].content[0]);
    expect(plan.hiddenSheetKeys).toContain(protagonistKey);
    expect(plan.deletedSheetKeys).toEqual([]);
    expect(plan.audit.find(item => item.sheetKey === globalKey)).toMatchObject({
      inheritedColumns: expect.arrayContaining(['当前详细地点', '上轮场景时间', '经过的时间', '当前时间']),
      addedColumns: expect.arrayContaining(['全局状态', '当前次要地区', '当前主要地区']),
      deletedColumns: [],
    });
    expect(plan.audit.find(item => item.sheetKey === skillsKey)).toMatchObject({
      inheritedColumns: expect.arrayContaining(['等级/阶段']),
      addedColumns: [],
      deletedColumns: [],
    });
    expect(plan.audit.find(item => item.sheetKey === introducedProtagonistKey)).toMatchObject({
      match: 'introduced',
      templateSheetKey: protagonistKey,
      inheritedColumns: [],
      addedColumns: current[protagonistKey].content[0].slice(1),
    });
  });

  it('以 V2 replay 作为 candidate 事实来源，BOOLEAN DEFAULT TRUE 使用 SQLite 单元格表示', async () => {
    const baseline = state({
      sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', 'item_name'], 'row_id INTEGER PRIMARY KEY, item_name TEXT', [['1', '铁剑']]),
    });
    const template = state({
      sheet_imported: sheet('sheet_imported', '背包', ['row_id', 'item_name', 'equipped'], 'row_id INTEGER PRIMARY KEY, item_name TEXT, equipped BOOLEAN NOT NULL DEFAULT TRUE'),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_legacy.content).toEqual([['row_id', 'item_name', 'equipped'], ['1', '铁剑', '1']]);
    expect((plan.sheetChanges[0] as any).sheetData.content).toEqual(plan.candidateData.sheet_legacy.content);
    expect(plan.audit[0]).toMatchObject({ affectedRowCount: 1, fills: [{ physicalName: 'equipped', kind: 'literal_default', literal: '1' }] });
  });

  it.each([
    { label: '非数组行', rows: [['1', '铁剑'], 'bad-row' as any], expected: '不是数组' },
    { label: '短行', rows: [['1']], expected: '宽度' },
    { label: '超宽行', rows: [['1', '铁剑', '多余']], expected: '宽度' },
    { label: '空 row_id', rows: [['', '铁剑']], expected: 'row_id 为空' },
    { label: '重复 row_id', rows: [['1', '铁剑'], ['1', '木剑']], expected: 'row_id 重复' },
  ])('历史基线存在$label时 fail closed', async ({ rows, expected }) => {
    const baseline = state({ sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称', rows as any) });
    const template = state({ sheet_imported: sheet('sheet_imported', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称') });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers.join('\n')).toContain(expected);
    expect(plan.sheetChanges).toEqual([]);
  });

  it('模板缺失列与新增列并存时保留旧值、隐藏旧列并以 null 填充新列', async () => {
    const baseline = state({ sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', 'item_name', 'note'], 'row_id INTEGER PRIMARY KEY, item_name TEXT, note TEXT', [['1', '铁剑', '旧备注']]) });
    const template = state({ sheet_imported: sheet('sheet_imported', '背包', ['row_id', 'item_name', 'quality'], 'row_id INTEGER PRIMARY KEY, item_name TEXT, quality TEXT', []) });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: true });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_legacy.content).toEqual([['row_id', 'item_name', 'quality', 'note'], ['1', '铁剑', null, '旧备注']]);
    expect(plan.candidateData.sheet_legacy.sourceData.hiddenPhysicalColumns).toEqual(['note']);
    expect(plan.sheetChanges[0]).toMatchObject({
      kind: 'rebase',
      sheetKey: 'sheet_legacy',
      sheetData: { content: [['row_id', 'item_name', 'quality', 'note'], ['1', '铁剑', null, '旧备注']] },
    });
  });

  it('模板数据行 row_id 为 null（真实模板形态）时仍能带数据引入', async () => {
    // 真实模板里作者不写 row_id，首列是 null（不是空串）。
    const templateSheet = sheet('sheet_rules', '系统规则表', ['row_id', '规则类别', '规则名称'],
      'row_id INTEGER PRIMARY KEY,\n  rule_category TEXT, -- 规则类别\n  rule_name TEXT -- 规则名称', [
        [null as any, '六维属性', '属性说明'],
        [null as any, '经验', '升级公式'],
      ]);
    const plan = await reconcileChatTemplate_ACU({ baselineData: state({}), templateData: state({ sheet_rules: templateSheet }), destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_xi_tong_gui_ze_biao.content).toEqual([
      ['row_id', '规则类别', '规则名称'],
      ['1', '六维属性', '属性说明'],
      ['2', '经验', '升级公式'],
    ]);
    expect(plan.sheetChanges).toEqual([expect.objectContaining({ kind: 'introduction', sheetKey: 'sheet_xi_tong_gui_ze_biao' })]);
  });


  it('新增表 introduction 保留模板自带数据行，content 优先于 seedRows', async () => {
    // 模板自带数据 = 作者的格式意图，引入时即随 checkpoint 落盘；
    // seedRows 不再随 sheet 落盘（数据已在 content 中），避免二次注入撞 row_id。
    const templateSheet = sheet('sheet_new', '新表', ['row_id', 'value'], 'row_id INTEGER PRIMARY KEY, value TEXT', [['9', '示例']]);
    templateSheet.seedRows = [['9', 'seed']];
    const plan = await reconcileChatTemplate_ACU({ baselineData: state({}), templateData: state({ sheet_new: templateSheet }), destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_xin_biao).toMatchObject({ content: [['row_id', 'value'], ['9', '示例']] });
    expect(plan.candidateData.sheet_xin_biao.seedRows).toBeUndefined();
  });

  it('新增表无 content 数据行时，退回使用模板 seedRows 作为初始数据', async () => {
    const templateSheet = sheet('sheet_new', '新表', ['row_id', 'value'], 'row_id INTEGER PRIMARY KEY, value TEXT', []);
    templateSheet.seedRows = [['9', 'seed']];
    const plan = await reconcileChatTemplate_ACU({ baselineData: state({}), templateData: state({ sheet_new: templateSheet }), destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_xin_biao).toMatchObject({ content: [['row_id', 'value'], ['9', 'seed']] });
    expect(plan.candidateData.sheet_xin_biao.seedRows).toBeUndefined();
  });

  it('模板数据行缺少 row_id 时自动补齐稳定 row_id，不再拒绝引入', async () => {
    // 模板作者通常不手写 row_id：首列为空串/缺失。引入必须成功并补齐 1..n。
    const templateSheet = sheet('sheet_new', '系统规则表', ['row_id', 'rule_name', 'rule_desc'],
      'row_id INTEGER PRIMARY KEY, rule_name TEXT, rule_desc TEXT', [
        ['', '六维属性', '力量/敏捷/体质'],
        ['', '初始分配', '总值36点'],
      ]);
    const plan = await reconcileChatTemplate_ACU({ baselineData: state({}), templateData: state({ sheet_new: templateSheet }), destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_xi_tong_gui_ze_biao.content).toEqual([
      ['row_id', 'rule_name', 'rule_desc'],
      ['1', '六维属性', '力量/敏捷/体质'],
      ['2', '初始分配', '总值36点'],
    ]);
  });

  it('模板已显式给出 row_id 时保留原值，并从当前最大身份后为缺失行分配', async () => {
    const templateSheet = sheet('sheet_new', '系统规则表', ['row_id', 'rule_name'],
      'row_id INTEGER PRIMARY KEY, rule_name TEXT', [
        ['5', '已有ID'],
        ['', '待分配'],
      ]);
    const plan = await reconcileChatTemplate_ACU({ baselineData: state({}), templateData: state({ sheet_new: templateSheet }), destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_xi_tong_gui_ze_biao.content).toEqual([
      ['row_id', 'rule_name'],
      ['5', '已有ID'],
      ['6', '待分配'],
    ]);
  });

  it('模板数据行末尾省略单元格时按表头宽度补齐', async () => {
    const templateSheet = sheet('sheet_new', '系统规则表', ['row_id', 'a', 'b'],
      'row_id INTEGER PRIMARY KEY, a TEXT, b TEXT', [['', '只有A']]);
    const plan = await reconcileChatTemplate_ACU({ baselineData: state({}), templateData: state({ sheet_new: templateSheet }), destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_xi_tong_gui_ze_biao.content).toEqual([['row_id', 'a', 'b'], ['1', '只有A', '']]);
  });


  it('新增表完全无数据时仍为 header-only 空壳', async () => {
    const templateSheet = sheet('sheet_new', '新表', ['row_id', 'value'], 'row_id INTEGER PRIMARY KEY, value TEXT', []);
    const plan = await reconcileChatTemplate_ACU({ baselineData: state({}), templateData: state({ sheet_new: templateSheet }), destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_xin_biao).toMatchObject({ content: [['row_id', 'value']] });
  });

  it('rebase 语义下 sourceData 字段删除可通过整表 checkpoint 表达', async () => {
    const baselineSheet = sheet('sheet_legacy', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称');
    baselineSheet.sourceData.note = '旧说明';
    const templateSheet = sheet('sheet_imported', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称');
    const plan = await reconcileChatTemplate_ACU({ baselineData: state({ sheet_legacy: baselineSheet }), templateData: state({ sheet_imported: templateSheet }), destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    // 模板 sourceData 不含 note → checkpoint.data 的 sourceData 也不再包含该字段。
    expect(plan.candidateData.sheet_legacy.sourceData.note).toBeUndefined();
  });

  it('合法 physical rename 可与独立隐藏和新增列一起回放', async () => {
    const baseline = state({
      sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', '名称', '备注'], 'row_id INTEGER PRIMARY KEY,\n  item_name TEXT, -- 名称\n  note TEXT -- 备注', [['1', '铁剑', '旧备注']]),
    });
    const template = state({
      sheet_imported: sheet('sheet_imported', '背包', ['row_id', '名称', '品质'], 'row_id INTEGER PRIMARY KEY,\n  item_title TEXT, -- 名称\n  quality TEXT -- 品质', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: true });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_legacy.content).toEqual([['row_id', '名称', '品质', '备注'], ['1', '铁剑', null, '旧备注']]);
    expect(plan.candidateData.sheet_legacy.sourceData.hiddenPhysicalColumns).toEqual(['note']);
    expect(plan.sheetChanges[0]).toMatchObject({ kind: 'rebase', sheetKey: 'sheet_legacy' });
    expect(plan.audit[0].physicalColumnMappings).toEqual([{ fromPhysicalName: 'item_name', toPhysicalName: 'item_title' }]);
  });

  it('删列与新增列复用同一 physical 名称时仍 fail closed，不能把旧值改解释为新字段', async () => {
    const baseline = state({
      sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', '备注'], 'row_id INTEGER PRIMARY KEY, note TEXT -- 备注', [['1', '旧备注']]),
    });
    const template = state({
      sheet_imported: sheet('sheet_imported', '背包', ['row_id', '品质'], 'row_id INTEGER PRIMARY KEY, note TEXT -- 品质', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: true });

    expect(plan.blockers.join('\n')).toContain('同名 physical column');
    expect(plan.sheetChanges).toEqual([]);
    expect(plan.deletedSheetKeys).toEqual([]);
  });

  it('匹配表的最终 replay candidate 不携带 baseline seedRows', async () => {
    const baselineSheet = sheet('sheet_legacy', '背包', ['row_id', 'item_name'], 'row_id INTEGER PRIMARY KEY, item_name TEXT', [['1', '铁剑']]);
    baselineSheet.seedRows = [['seed', '种子']];
    const template = state({
      sheet_imported: sheet('sheet_imported', '背包', ['row_id', 'item_name', 'quality'], 'row_id INTEGER PRIMARY KEY, item_name TEXT, quality TEXT', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: state({ sheet_legacy: baselineSheet }), templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_legacy.seedRows).toBeUndefined();
    expect((plan.sheetChanges[0] as any).sheetData.seedRows).toBeUndefined();
  });

  it('blocker 结果返回已剥离运行时字段的 baseline，而非半构造候选', async () => {
    const baselineSheet = sheet('sheet_legacy', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称', [['1'] as any]);
    baselineSheet.seedRows = [['seed', '种子']];
    const baseline = state({ sheet_legacy: baselineSheet });
    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: state({}), destructiveChangeConfirmed: false });

    expect(plan.blockers.join('\n')).toContain('宽度');
    expect(plan.candidateData.sheet_legacy.content).toEqual(baselineSheet.content);
    expect(plan.candidateData.sheet_legacy.seedRows).toBeUndefined();
  });

  it('原生模式导入无 DDL 模板时不执行 SQLite 门禁', async () => {
    const nativeTemplate = sheet('sheet_new', '全局数据表', ['row_id', '地点'], 'row_id INTEGER PRIMARY KEY, location TEXT', []);
    nativeTemplate.sourceData = {};

    const plan = await reconcileChatTemplate_ACU({
      baselineData: state({}),
      templateData: state({ sheet_new: nativeTemplate }),
      destructiveChangeConfirmed: false,
      storageMode: 'native',
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_quan_ju_shu_ju_biao.content).toEqual([['row_id', '地点']]);
    expect(plan.candidateData.sheet_quan_ju_shu_ju_biao.sourceData).toEqual({});
    expect(plan.sheetChanges).toEqual([expect.objectContaining({ kind: 'introduction', sheetKey: 'sheet_quan_ju_shu_ju_biao' })]);
  });

  it('原生模式匹配旧表时只按表头继承，不解析错误 DDL', async () => {
    const baselineSheet = sheet('sheet_live', '全局数据表', ['row_id', '地点', '旧列'], 'row_id INTEGER PRIMARY KEY, location TEXT, old_value TEXT', [['1', '御苑', '历史']]);
    baselineSheet.sourceData.ddl = 'not sql';
    const templateSheet = sheet('sheet_imported', '全局数据表', ['row_id', '地点', '新列'], 'row_id INTEGER PRIMARY KEY, location TEXT, new_value TEXT', []);
    templateSheet.sourceData.ddl = '';

    const plan = await reconcileChatTemplate_ACU({
      baselineData: state({ sheet_live: baselineSheet }),
      templateData: state({ sheet_imported: templateSheet }),
      destructiveChangeConfirmed: false,
      storageMode: 'native',
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_live.content).toEqual([['row_id', '地点', '新列'], ['1', '御苑', null]]);
    expect(plan.audit[0]).toMatchObject({ inheritedColumns: ['地点'], addedColumns: ['新列'], deletedColumns: ['旧列'] });
  });


  it('仅 introduction 的 DDL 与表头不一致时，由 DDL/表头预检阶段阻断', async () => {
    const invalidTemplate = sheet('sheet_new', '新表', ['row_id', '显示名称'], 'row_id INTEGER PRIMARY KEY, physical_name TEXT', []);
    const plan = await reconcileChatTemplate_ACU({ baselineData: state({}), templateData: state({ sheet_new: invalidTemplate }), destructiveChangeConfirmed: false });

    expect(plan.blockers.join('\n')).toContain('完整 replay candidate DDL/表头预检失败');
    expect(plan.blockers.join('\n')).toContain('sheet_xin_biao');
    expect(plan.sheetChanges).toEqual([]);
    expect(plan.candidateData.sheet_xin_biao).toBeUndefined();
    expect(plan.audit.every(item => item.operations.length === 0)).toBe(true);
  });

  it('ASCII 展示表头通过 DDL 注释映射后可携带数据完成真实 SQLite hydrate', async () => {
    const battleSheet = sheet(
      'sheet_zhan_dou_zhuang_tai_ji_lu',
      '战斗状态记录',
      ['row_id', 'HP/RP', 'EN'],
      'row_id INTEGER PRIMARY KEY, hp_rp TEXT, en TEXT',
      [['1', '10/20', '8']],
    );
    battleSheet.sourceData.ddl = `CREATE TABLE battle_status (
  row_id INTEGER PRIMARY KEY, -- 行号
  hp_rp TEXT, -- HP/RP
  en TEXT -- EN
);`;

    const plan = await reconcileChatTemplate_ACU({
      baselineData: state({}),
      templateData: state({ sheet_zhan_dou_zhuang_tai_ji_lu: battleSheet }),
      destructiveChangeConfirmed: false,
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_zhan_dou_zhuang_tai_ji_lu.content).toEqual([
      ['row_id', 'HP/RP', 'EN'],
      ['1', '10/20', '8'],
    ]);
    expect(plan.sheetChanges).toEqual([
      expect.objectContaining({ kind: 'introduction', sheetKey: 'sheet_zhan_dou_zhuang_tai_ji_lu' }),
    ]);
  });

  it('hidden physical column 无效时由列投影预检阶段阻断', async () => {
    const invalidProjection = sheet('sheet_new', '新表', ['row_id', 'value'], 'row_id INTEGER PRIMARY KEY, value TEXT', []);
    invalidProjection.sourceData.hiddenPhysicalColumns = ['missing_column'];

    const plan = await reconcileChatTemplate_ACU({ baselineData: state({}), templateData: state({ sheet_new: invalidProjection }), destructiveChangeConfirmed: false });

    expect(plan.blockers.join('\n')).toContain('完整 replay candidate 列投影预检失败');
    expect(plan.blockers.join('\n')).toContain('missing_column');
    expect(plan.sheetChanges).toEqual([]);
    expect(plan.candidateData.sheet_xin_biao).toBeUndefined();
  });

  it('通过预检但违反 SQLite CHECK 的数据由真实 hydrate 阶段阻断', async () => {
    const invalidRow = sheet('sheet_new', '新表', ['row_id', 'Score'], 'row_id INTEGER PRIMARY KEY, score INTEGER', [['1', '-1']]);
    invalidRow.sourceData.ddl = `CREATE TABLE score_table (
  row_id INTEGER PRIMARY KEY, -- 行号
  score INTEGER CHECK(score > 0) -- Score
);`;

    const plan = await reconcileChatTemplate_ACU({ baselineData: state({}), templateData: state({ sheet_new: invalidRow }), destructiveChangeConfirmed: false });

    expect(plan.blockers.join('\n')).toContain('完整 replay candidate SQLite hydrate 失败');
    expect(plan.blockers.join('\n')).toContain('SQLite 写入失败：第 2 条语句失败（INSERT INTO xinbiao）');
    expect(plan.blockers.join('\n')).toContain('CHECK constraint failed: score > 0');
    expect(plan.sheetChanges).toEqual([]);
    expect(plan.candidateData.sheet_xin_biao).toBeUndefined();
  });

  it('audit 与实际 change set 对账，包含 schema、metadata、introduction 和 hide/delete 摘要', async () => {
    const baselineSheet = sheet('sheet_old', '旧表', ['row_id', 'value'], 'row_id INTEGER PRIMARY KEY, value TEXT', []);
    baselineSheet.sourceData.ddl = 'CREATE TABLE old_table (row_id INTEGER PRIMARY KEY, value TEXT);';
    const matchedBaseline = sheet('sheet_legacy', '背包', ['row_id', 'item_name'], 'row_id INTEGER PRIMARY KEY, item_name TEXT', [['1', '铁剑']]);
    matchedBaseline.orderNo = 3;
    const templateMatched = sheet('sheet_imported', '背包', ['row_id', 'item_name', 'quality'], 'row_id INTEGER PRIMARY KEY, item_name TEXT, quality TEXT', []);
    templateMatched.orderNo = 4;
    const templateNew = sheet('sheet_new', '新表', ['row_id', 'value'], 'row_id INTEGER PRIMARY KEY, value TEXT', []);
    templateNew.sourceData.ddl = 'CREATE TABLE new_table (row_id INTEGER PRIMARY KEY, value TEXT);';

    // 默认路径（语义1）：缺失表 sheet_old 走 hide，不再产出 delete。
    const defaultPlan = await reconcileChatTemplate_ACU({
      baselineData: state({ sheet_old: baselineSheet, sheet_legacy: matchedBaseline }),
      templateData: state({ sheet_imported: templateMatched, sheet_new: templateNew }),
      destructiveChangeConfirmed: false,
    });

    expect(defaultPlan.blockers).toEqual([]);
    expect(defaultPlan.candidateData.sheet_old).toBeUndefined();
    const matchedAudit = defaultPlan.audit.find(item => item.sheetKey === 'sheet_legacy');
    expect(matchedAudit).toMatchObject({
      baselineSheetKey: 'sheet_legacy', templateSheetKey: 'sheet_imported', canonicalName: '背包', metadataChangedFields: ['orderNo'],
    });
    expect(matchedAudit?.operations).toEqual([{ kind: 'rebase' }]);
    expect(defaultPlan.audit.find(item => item.sheetKey === 'sheet_xin_biao')?.operations).toEqual([{ kind: 'introduction' }]);
    expect(defaultPlan.audit.find(item => item.sheetKey === 'sheet_old')?.operations).toEqual([{ kind: 'hide' }]);

    // 显式硬删除路径：hardDeleteMissingSheets=true + destructiveChangeConfirmed=true，产出 delete。
    const hardDeletePlan = await reconcileChatTemplate_ACU({
      baselineData: state({ sheet_old: baselineSheet, sheet_legacy: matchedBaseline }),
      templateData: state({ sheet_imported: templateMatched, sheet_new: templateNew }),
      destructiveChangeConfirmed: true,
      hardDeleteMissingSheets: true,
    });
    expect(hardDeletePlan.audit.find(item => item.sheetKey === 'sheet_old')?.operations).toEqual([{ kind: 'delete' }]);

  });

  it('Phase 1：跨 key + 零数据 + physical 同名 + 异显示名 → 覆盖切换，不阻断、结构取模板、key 保持', async () => {
    // 计划 6.1-1/5/8：真实样本 global-state.js → romance-overrides.js（表名同为「全局数据表」，
    // 显示名「主角当前所在地点」→「当前详细地点」，physical 同名 current_location，key 不同）。
    const baseline = state({
      sheet_dCudvUnH: sheet('sheet_dCudvUnH', '全局数据表', ['row_id', '主角当前所在地点'],
        'row_id INTEGER PRIMARY KEY,\n  current_location TEXT -- 主角当前所在地点', []),
    });
    const template = state({
      sheet_global_data: sheet('sheet_global_data', '全局数据表', ['row_id', '当前详细地点'],
        'row_id INTEGER PRIMARY KEY,\n  current_location TEXT -- 当前详细地点', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    // 覆盖语义：结构整体取模板（表头 = 模板可见列），旧列不保留。
    expect(plan.candidateData.sheet_dCudvUnH.content).toEqual([['row_id', '当前详细地点']]);
    expect(plan.candidateData.sheet_dCudvUnH.sourceData.hiddenPhysicalColumns).toBeUndefined();
    // 不重新分配 key：旧 key 继续使用，模板 key 不出现。
    expect(plan.candidateData.sheet_dCudvUnH.uid).toBe('sheet_dCudvUnH');
    expect(plan.candidateData.sheet_global_data).toBeUndefined();
    // rebase change 落在旧 key 上。
    expect(plan.sheetChanges).toEqual([expect.objectContaining({ kind: 'rebase', sheetKey: 'sheet_dCudvUnH' })]);
    expect(plan.audit[0]).toMatchObject({ templateSheetKey: 'sheet_global_data', resolvedSheetKey: 'sheet_dCudvUnH' });
    // audit 如实记录：旧列全部丢弃，无隐藏列，零行受影响。
    expect(plan.audit[0]).toMatchObject({
      sheetKey: 'sheet_dCudvUnH',
      inheritedColumns: [],
      addedColumns: ['当前详细地点'],
      deletedColumns: ['主角当前所在地点'],
      hiddenColumns: [],
      affectedRowCount: 0,
    });
  });

  it('Phase 1：零数据覆盖且模板自带数据行 → 模板行按目标可见列落地', async () => {
    // 计划 6.1-2：模板自带数据行是模板结构的一部分，覆盖后随结构落地。
    const baseline = state({
      sheet_dCudvUnH: sheet('sheet_dCudvUnH', '全局数据表', ['row_id', '主角当前所在地点'],
        'row_id INTEGER PRIMARY KEY,\n  current_location TEXT -- 主角当前所在地点', []),
    });
    const template = state({
      sheet_global_data: sheet('sheet_global_data', '全局数据表', ['row_id', '当前详细地点'],
        'row_id INTEGER PRIMARY KEY,\n  current_location TEXT -- 当前详细地点', [
          [null as any, '御苑'],
        ]),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_dCudvUnH.content).toEqual([
      ['row_id', '当前详细地点'],
      ['1', '御苑'],
    ]);
  });

  it('Phase 1：零数据 + 旧表带残留 hiddenPhysicalColumns / columnAliases → 覆盖后投影不报指向不存在列', async () => {
    // 计划 6.1-3/4：旧表残留的隐藏列与别名不得进入新结构，否则投影预检会因
    // 「指向不存在的 physical column」失败。
    const baselineSheet = sheet('sheet_dCudvUnH', '全局数据表', ['row_id', '主角当前所在地点'],
      'row_id INTEGER PRIMARY KEY,\n  current_location TEXT -- 主角当前所在地点', []);
    baselineSheet.sourceData.hiddenPhysicalColumns = ['ghost_col'];
    baselineSheet.sourceData.columnAliases = { ghost_col: ['旧显示名'] };
    const template = state({
      sheet_global_data: sheet('sheet_global_data', '全局数据表', ['row_id', '当前详细地点'],
        'row_id INTEGER PRIMARY KEY,\n  current_location TEXT -- 当前详细地点', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: state({ sheet_dCudvUnH: baselineSheet }), templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    expect(plan.candidateData.sheet_dCudvUnH.sourceData.hiddenPhysicalColumns).toBeUndefined();
    expect(plan.candidateData.sheet_dCudvUnH.sourceData.columnAliases).toBeUndefined();
  });

  it('Phase 1：同一协调中空表覆盖、有数据表继承（逐表判定）', async () => {
    // 计划 6.1-6：逐表判定，不能因整聊天有数据就让空表被迫走迁移路径。
    const baseline = state({
      sheet_dCudvUnH: sheet('sheet_dCudvUnH', '全局数据表', ['row_id', '主角当前所在地点'],
        'row_id INTEGER PRIMARY KEY,\n  current_location TEXT -- 主角当前所在地点', []),
      sheet_notes: sheet('sheet_notes', '纪要表', ['row_id', '事件'],
        'row_id INTEGER PRIMARY KEY,\n  event TEXT -- 事件', [['1', '旧事件']]),
    });
    const template = state({
      sheet_global_data: sheet('sheet_global_data', '全局数据表', ['row_id', '当前详细地点'],
        'row_id INTEGER PRIMARY KEY,\n  current_location TEXT -- 当前详细地点', []),
      sheet_notes2: sheet('sheet_notes2', '纪要表', ['row_id', '事件', '结论'],
        'row_id INTEGER PRIMARY KEY,\n  event TEXT, -- 事件\n  conclusion TEXT -- 结论', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });

    expect(plan.blockers).toEqual([]);
    // 空表覆盖：结构 = 模板，旧列丢弃。
    expect(plan.candidateData.sheet_dCudvUnH.content).toEqual([['row_id', '当前详细地点']]);
    // 有数据表继承：事件列继承，新增列 null，旧行保留。
    expect(plan.candidateData.sheet_notes.content).toEqual([['row_id', '事件', '结论'], ['1', '旧事件', null]]);
    const globalAudit = plan.audit.find(item => item.sheetKey === 'sheet_dCudvUnH');
    expect(globalAudit).toMatchObject({ deletedColumns: ['主角当前所在地点'], hiddenColumns: [], affectedRowCount: 0 });
    const notesAudit = plan.audit.find(item => item.sheetKey === 'sheet_notes');
    expect(notesAudit).toMatchObject({ inheritedColumns: ['事件'], hiddenColumns: [], affectedRowCount: 1 });
  });


  it('Phase 1 证明：删除全部数据后连续切换多个不同 key 预设均成功，覆盖后 schema 可投影', async () => {
    // 计划 6.3-1/6.2-1：零数据锚点（删除全部数据后的状态）连续切换 3 个不同 key 的预设，
    // 每次都是跨 key + physical 同名/不同名混合，全部不应被 blocker 阻断；
    // 覆盖后的 candidate 需通过顶层 DDL/表头预检、列投影预检与真实 SQLite hydrate。
    const presets = [
      // 预设 1：global-state 结构（key sheet_dCudvUnH）
      state({
        sheet_dCudvUnH: sheet('sheet_dCudvUnH', '全局数据表', ['row_id', '主角当前所在地点'],
          'row_id INTEGER PRIMARY KEY,\n  current_location TEXT -- 主角当前所在地点', []),
      }),
      // 预设 2：romance-overrides 结构（key sheet_global_data，physical 撞 current_location）
      state({
        sheet_global_data: sheet('sheet_global_data', '全局数据表', ['row_id', '当前详细地点'],
          'row_id INTEGER PRIMARY KEY,\n  current_location TEXT -- 当前详细地点', []),
      }),
      // 预设 3：第三个不同 key，完全不同的列结构
      state({
        sheet_world_state: sheet('sheet_world_state', '全局数据表', ['row_id', '世界时间', '季节'],
          'row_id INTEGER PRIMARY KEY,\n  world_clock TEXT, -- 世界时间\n  season TEXT -- 季节', []),
      }),
    ];

    // 初始状态 = 零数据锚点（模拟 deleteLocalDataInChatCore_ACU 全范围删除后的 header-only）。
    let baseline = presets[0];
    for (const preset of presets) {
      const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: preset, destructiveChangeConfirmed: false });
      expect(plan.blockers).toEqual([]);
      const matchedKey = Object.keys(baseline).find(key => key.startsWith('sheet_'))!;
      const templateKey = Object.keys(preset).find(key => key.startsWith('sheet_'))!;
      // 覆盖后结构 = 模板可见列，旧列不残留。
      expect(plan.candidateData[matchedKey].content[0]).toEqual(preset[templateKey].content[0]);
      // 无隐藏列残留（覆盖语义：旧结构不保留）。
      expect(plan.candidateData[matchedKey].sourceData.hiddenPhysicalColumns).toBeUndefined();
      baseline = plan.candidateData;
    }
  });

  it('Phase 1 证明：覆盖后历史结构完全移除，replay 不会因旧列消失而撞 no such column', async () => {
    // 计划 6.2-2/2.7-1：覆盖后 candidate 的 DDL 只含目标列；旧 physical 列不在 DDL 中，
    // 因此后续 SQL 回放不会引用已不存在的列。此断言与顶层真实 SQLite hydrate 共同构成
    // “覆盖后当前边界可 hydrate 目标 schema，历史旧列不可再被引用”的证明。
    const baseline = state({
      sheet_dCudvUnH: sheet('sheet_dCudvUnH', '全局数据表', ['row_id', '主角当前所在地点'],
        'row_id INTEGER PRIMARY KEY,\n  current_location TEXT -- 主角当前所在地点', []),
    });
    const template = state({
      sheet_global_data: sheet('sheet_global_data', '全局数据表', ['row_id', '当前详细地点'],
        'row_id INTEGER PRIMARY KEY,\n  current_location TEXT -- 当前详细地点', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false });
    expect(plan.blockers).toEqual([]);

    // 覆盖后 DDL 只含目标物理列 current_location，不含任何旧列残留。
    const ddl = plan.candidateData.sheet_dCudvUnH.sourceData.ddl as string;
    expect(ddl).toContain('current_location');
    // 投影只返回目标可见列。
    const projection = getSheetColumnProjection_ACU(plan.candidateData.sheet_dCudvUnH);
    expect(projection.visibleColumns.map(column => column.header)).toEqual(['row_id', '当前详细地点']);
    expect(projection.hiddenPhysicalColumns).toEqual([]);
  });


  it('Phase 2：非空表跨 key 冲突时 blocker 文案陈述真实原因并含定位信息', async () => {
    // 计划 5/9-5：有数据表（50 行）仍 fail-closed，但文案必须说明是 DDL 重复列名冲突，
    // 并列出 key 对、冲突 physical 名、两侧显示名与 baseline 行数。
    const baseline = state({
      sheet_legacy: sheet('sheet_legacy', '背包', ['row_id', '备注'],
        'row_id INTEGER PRIMARY KEY, note TEXT -- 备注', [['1', '旧备注']]),
    });
    const template = state({
      sheet_imported: sheet('sheet_imported', '背包', ['row_id', '品质'],
        'row_id INTEGER PRIMARY KEY, note TEXT -- 品质', []),
    });

    const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: true });

    expect(plan.blockers).not.toEqual([]);
    const blockerText = plan.blockers.join('\n');
    expect(blockerText).toContain('重复列名 DDL');
    expect(blockerText).toContain('同名 physical column');
    expect(blockerText).toContain('baselineKey=sheet_legacy → templateKey=sheet_imported');
    expect(blockerText).toContain('physical=note');
    expect(blockerText).toContain('隐藏列「备注」→ 目标列「品质」');
    expect(blockerText).toContain('baseline 行数=1');
    expect(plan.sheetChanges).toEqual([]);
  });

});

  describe('SQLite 缺失 DDL fallback', () => {
    function noDdlSheet(key: string, name: string, headers: string[], rows: Array<Array<string | null>> = []): any {
      const s = sheet(key, name, headers, 'row_id INTEGER PRIMARY KEY, placeholder TEXT', rows);
      s.sourceData = { note: '无 DDL，依赖运行时 fallback' };
      return s;
    }

    it('baseline 有数据且无 DDL、template 有合法 DDL 时生成 fallback DDL 并保留数据', async () => {
      const baseline = state({
        sheet_legacy: noDdlSheet('sheet_legacy', '背包', ['row_id', '名称'], [['1', '铁剑']]),
      });
      const template = state({
        sheet_imported: sheet('sheet_imported', '背包', ['row_id', '名称', '品质'], 'row_id INTEGER PRIMARY KEY,\n  item_name TEXT, -- 名称\n  quality TEXT -- 品质', []),
      });
      const original = structuredClone({ baseline, template });

      const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false, storageMode: 'sqlite' });

      expect(plan.blockers).toEqual([]);
      // 数据保留：名称列继承，新品质列填 null。
      expect(plan.candidateData.sheet_legacy.content).toEqual([['row_id', '名称', '品质'], ['1', '铁剑', null]]);
      // 原无 DDL 表获得合法 fallback DDL：首列 row_id INTEGER PRIMARY KEY。
      const ddl = plan.candidateData.sheet_legacy.sourceData.ddl as string;
      expect(ddl).toContain('row_id INTEGER PRIMARY KEY');
      expect(ddl).toContain('TEXT');
      // 输出为 rebase，而非 introduction / hide。
      expect(plan.sheetChanges).toEqual([expect.objectContaining({ kind: 'rebase', sheetKey: 'sheet_legacy' })]);
      // 输入不被修改。
      expect({ baseline, template }).toEqual(original);
    });

    it('baseline 与 template 都无 DDL 时两侧均生成 fallback 后成功协调', async () => {
      const baseline = state({
        sheet_legacy: noDdlSheet('sheet_legacy', '背包', ['row_id', '名称'], [['1', '铁剑']]),
      });
      const template = state({
        sheet_imported: noDdlSheet('sheet_imported', '背包', ['row_id', '名称', '品质']),
      });

      const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false, storageMode: 'sqlite' });

      expect(plan.blockers).toEqual([]);
      expect(plan.candidateData.sheet_legacy.content).toEqual([['row_id', '名称', '品质'], ['1', '铁剑', null]]);
      expect(plan.candidateData.sheet_legacy.sourceData.ddl).toContain('row_id INTEGER PRIMARY KEY');
    });

    it('多个已有数据表同时无 DDL 时不再逐表报“列数不一致”', async () => {
      const baseline = state({
        sheet_a: noDdlSheet('sheet_a', '全局数据表', ['row_id', '值'], [['1', 'A']]),
        sheet_b: noDdlSheet('sheet_b', '重要角色表', ['row_id', '名称'], [['2', 'B']]),
        sheet_c: noDdlSheet('sheet_c', '主角状态表', ['row_id', '状态'], [['3', 'C']]),
      });
      const template = state({
        sheet_a2: sheet('sheet_a2', '全局数据表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY, value TEXT', []),
        sheet_b2: sheet('sheet_b2', '重要角色表', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, name TEXT', []),
        sheet_c2: sheet('sheet_c2', '主角状态表', ['row_id', '状态'], 'row_id INTEGER PRIMARY KEY, status TEXT', []),
      });

      const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false, storageMode: 'sqlite' });

      expect(plan.blockers).toEqual([]);
      expect(plan.candidateData.sheet_a.sourceData.ddl).toContain('row_id INTEGER PRIMARY KEY');
      expect(plan.candidateData.sheet_b.sourceData.ddl).toContain('row_id INTEGER PRIMARY KEY');
      expect(plan.candidateData.sheet_c.sourceData.ddl).toContain('row_id INTEGER PRIMARY KEY');
      expect(plan.candidateData.sheet_a.content[1]).toEqual(['1', 'A']);
    });

    it('非空非法 DDL 不被覆盖，仍 fail closed', async () => {
      const bad = sheet('sheet_legacy', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, item_name TEXT', [['1', '铁剑']]);
      bad.sourceData.ddl = 'CREATE TABLE inventory (item_name TEXT);'; // 缺 row_id INTEGER PRIMARY KEY
      const template = state({
        sheet_imported: sheet('sheet_imported', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, item_name TEXT', []),
      });

      const plan = await reconcileChatTemplate_ACU({ baselineData: state({ sheet_legacy: bad }), templateData: template, destructiveChangeConfirmed: false, storageMode: 'sqlite' });

      expect(plan.blockers).not.toEqual([]);
      expect(plan.blockers.join('\n')).toContain('DDL 与表头列数不一致');
      expect(plan.sheetChanges).toEqual([]);
      // 原 DDL 未被 fallback 覆盖。
      expect(bad.sourceData.ddl).toBe('CREATE TABLE inventory (item_name TEXT);');
    });

    it('native 模式不生成 DDL', async () => {
      const baseline = state({
        sheet_legacy: noDdlSheet('sheet_legacy', '背包', ['row_id', '名称'], [['1', '铁剑']]),
      });
      const template = state({
        sheet_imported: noDdlSheet('sheet_imported', '背包', ['row_id', '名称', '品质']),
      });

      const plan = await reconcileChatTemplate_ACU({ baselineData: baseline, templateData: template, destructiveChangeConfirmed: false, storageMode: 'native' });

      expect(plan.blockers).toEqual([]);
      expect(plan.candidateData.sheet_legacy.content).toEqual([['row_id', '名称', '品质'], ['1', '铁剑', null]]);
      // native 不写 DDL：sourceData.ddl 保持 undefined（原 helper 只在 sourceData 有 note）。
      expect(plan.candidateData.sheet_legacy.sourceData.ddl).toBeUndefined();
    });
  });


describe('reconcileChatTemplate_ACU 生命周期感知（阶段2）', () => {
  function makeLifecycle(statusBySheetKey: Record<string, { status: 'active' | 'hidden' | 'never_seen' | 'indeterminate'; [key: string]: unknown }>): any {
    const keys = Object.keys(statusBySheetKey);
    return {
      statusBySheetKey,
      activeSheetKeys: keys.filter(k => statusBySheetKey[k].status === 'active').sort(),
      hiddenSheetKeys: keys.filter(k => statusBySheetKey[k].status === 'hidden').sort(),
      indeterminateSheetKeys: keys.filter(k => statusBySheetKey[k].status === 'indeterminate').sort(),
      neverSeenSheetKeys: keys.filter(k => statusBySheetKey[k].status === 'never_seen').sort(),
    };
  }

  it('hidden 表被模板重新包含时显式 reveal，而非伪装 introduction（保持稳定 key）', async () => {
    const baseline = state({
      sheet_other: sheet('sheet_other', '其他表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY, value TEXT -- 值'),
    });
    const template = state({
      sheet_bei_bao: sheet('sheet_bei_bao', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY,\n  item_name TEXT -- 名称'),
    });
    // 历史：sheet_bei_bao 曾被 hide（稳定 key 由显示名派生）。
    const lifecycle = makeLifecycle({
      sheet_other: { status: 'active' },
      sheet_bei_bao: { status: 'hidden', lastTimelineKind: 'sheet_hide' },
    });

    const plan = await reconcileChatTemplate_ACU({
      baselineData: baseline, templateData: template, destructiveChangeConfirmed: false, lifecycle,
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.sheetChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'reveal', sheetKey: 'sheet_bei_bao' }),
    ]));
    expect(plan.sheetChanges.some(change => change.kind === 'introduction' && change.sheetKey === 'sheet_bei_bao')).toBe(false);
    // 稳定 key 保持：不派生新 key，不伪装新表。
    expect(plan.candidateData.sheet_bei_bao).toBeDefined();
  });

  it('indeterminate 表被模板包含时阻止提交（fail-closed）', async () => {
    const baseline = state({
      sheet_other: sheet('sheet_other', '其他表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY, value TEXT -- 值'),
    });
    const template = state({
      sheet_bei_bao: sheet('sheet_bei_bao', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY,\n  item_name TEXT -- 名称'),
    });
    const lifecycle = makeLifecycle({
      sheet_other: { status: 'active' },
      sheet_bei_bao: { status: 'indeterminate' },
    });

    const plan = await reconcileChatTemplate_ACU({
      baselineData: baseline, templateData: template, destructiveChangeConfirmed: false, lifecycle,
    });

    expect(plan.blockers.join('\n')).toContain('indeterminate');
    expect(plan.sheetChanges).toEqual([]);
  });

  it('active 但基线缺失的表被模板包含时按 introduction 继续（覆盖风险由提交层权威判定）', async () => {
    const baseline = state({
      sheet_other: sheet('sheet_other', '其他表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY, value TEXT -- 值'),
    });
    const template = state({
      sheet_bei_bao: sheet('sheet_bei_bao', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY,\n  item_name TEXT -- 名称'),
    });
    // lifecycle 是历史 timeline 归并，不是「当前是否活跃」的权威来源。它与同一时点的
    // replay 基线不一致时，协调层若 fail-closed，用户重新读取表格也无法改变历史事实，
    // 错误必然复现（不可自救死局）。活数据保护由 persist 端 activeHas /
    // introductionHistoryEvidence_ACU 用权威事实执行。
    const lifecycle = makeLifecycle({
      sheet_other: { status: 'active' },
      sheet_bei_bao: { status: 'active' },
    });

    const plan = await reconcileChatTemplate_ACU({
      baselineData: baseline, templateData: template, destructiveChangeConfirmed: false, lifecycle,
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.sheetChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'introduction', sheetKey: 'sheet_bei_bao' }),
    ]));
    // 稳定 key 仍按显示名派生，不新造 key。
    expect(plan.candidateData.sheet_bei_bao).toBeDefined();
  });

  it('隐藏表中 indeterminate 表被隐藏时阻止（不静默隐藏未知历史）', async () => {
    const baseline = state({
      sheet_bei_bao: sheet('sheet_bei_bao', '背包', ['row_id', '名称'], 'row_id INTEGER PRIMARY KEY, item_name TEXT -- 名称'),
    });
    const template = state({
      sheet_other: sheet('sheet_other', '其他表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY, value TEXT -- 值'),
    });
    const lifecycle = makeLifecycle({
      sheet_bei_bao: { status: 'indeterminate' },
      sheet_other: { status: 'active' },
    });

    const plan = await reconcileChatTemplate_ACU({
      baselineData: baseline, templateData: template, destructiveChangeConfirmed: false, lifecycle,
    });

    expect(plan.blockers.join('\n')).toContain('indeterminate');
    expect(plan.sheetChanges).toEqual([]);
  });

  it('never_seen 表维持 introduction；无 lifecycle 输入时退回基线猜测（兼容）', async () => {
    const baseline = state({
      sheet_other: sheet('sheet_other', '其他表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY, value TEXT -- 值'),
    });
    const template = state({
      sheet_xin_biao: sheet('sheet_xin_biao', '新表', ['row_id', '值'], 'row_id INTEGER PRIMARY KEY,\n  value TEXT -- 值'),
    });
    const lifecycle = makeLifecycle({
      sheet_other: { status: 'active' },
      sheet_xin_biao: { status: 'never_seen' },
    });

    const withLifecycle = await reconcileChatTemplate_ACU({
      baselineData: baseline, templateData: template, destructiveChangeConfirmed: false, lifecycle,
    });
    expect(withLifecycle.blockers).toEqual([]);
    expect(withLifecycle.sheetChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'introduction', sheetKey: 'sheet_xin_biao' }),
    ]));

    // 无 lifecycle：退回既有行为，仍 introduction。
    const withoutLifecycle = await reconcileChatTemplate_ACU({
      baselineData: baseline, templateData: template, destructiveChangeConfirmed: false,
    });
    expect(withoutLifecycle.blockers).toEqual([]);
    expect(withoutLifecycle.sheetChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'introduction', sheetKey: 'sheet_xin_biao' }),
    ]));
  });
});