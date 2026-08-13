/**
 * 主角技能表 — 默认表定义
 */
export const protagonistSkillsSheet = {
  uid: "sheet_lEARaBa8",
  name: "主角技能表",
  sourceData: {
    note: "记录主角获得的所有技能项目。\n- 列1: 技能名称 - 技能的名称。\n- 列2: 技能类型 - 技能的类别（如：\u201C被动\u201D、\u201C主动\u201D）。\n- 列3: 等级/阶段 - 技能的当前等级或阶段。\n- 列4: 效果描述 - 技能在当前等级下的具体效果。",
    initNode: "游戏初始化时，根据设定为主角添加初始技能。",
    deleteNode: "技能因剧情被剥夺或替换时删除。\nSQL示例: DELETE FROM protagonist_skills WHERE skill_name = '被剥夺的技能';",
    updateNode: "已有技能被升级时更新其等级/阶段和效果描述。\nSQL示例: UPDATE protagonist_skills SET skill_level = 'Lv.3', effect_desc = '新效果描述' WHERE skill_name = '火球术';",
    insertNode: "主角获得新的技能时添加。\nSQL示例: INSERT INTO protagonist_skills (skill_name, skill_type, skill_level, effect_desc) VALUES ('新技能', '主动', 'Lv.1', '效果描述');",
    ddl: `CREATE TABLE protagonist_skills ( -- 主角技能表
  row_id INTEGER PRIMARY KEY, -- 行号
  skill_name TEXT NOT NULL UNIQUE, -- 技能名称
  skill_type TEXT NOT NULL CHECK(skill_type IN ('被动', '主动')), -- 技能类型
  skill_level TEXT, -- 等级/阶段
  effect_desc TEXT -- 效果描述
);`
  },
  content: [
    [
      "row_id",
      "技能名称",
      "技能类型",
      "等级/阶段",
      "效果描述"
    ]
  ],
  updateConfig: {
    uiSentinel: -1,
    contextDepth: -1,
    updateFrequency: -1,
    batchSize: -1,
    skipFloors: -1
  },
  exportConfig: {
    enabled: false,
    splitByRow: false,
    entryName: "主角技能表",
    entryType: "constant",
    keywords: "",
    preventRecursion: true,
    injectionTemplate: "",
    extraIndexEnabled: false,
    extraIndexEntryName: "主角技能表-索引",
    extraIndexColumns: [],
    extraIndexColumnModes: {},
    extraIndexInjectionTemplate: "",
    entryPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 10000
    },
    extraIndexPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 10010
    },
    fixedEntryPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 99990
    },
    fixedIndexPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 99991
    }
  },
  orderNo: 3
};
