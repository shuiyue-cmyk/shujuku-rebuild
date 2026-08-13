/**
 * 主角信息 — 默认表定义
 */
export const protagonistInfoSheet = {
  uid: "sheet_DpKcVGqg",
  name: "主角信息表",
  sourceData: {
    note: "记录主角的核心身份信息。此表有且仅有一行。\n- 列1: 人物名称 - 主角的名字。\n- 列2: 性别/年龄 - 主角的生理性别和年龄。\n- 列3: 外貌特征 - 对主角外貌的客观文字描写。\n- 列4: 职业/身份 - 主角在社会中的主要角色。\n- 列5: 过往经历 - 记录主角的背景故事和后续的关键经历，随剧情增量更新，不超过300字，超过时需压缩。\n- 列6: 性格特点 - 对主角核心性格的概括。",
    initNode: "游戏初始化时，插入主角的唯一条目。",
    deleteNode: "禁止删除。",
    updateNode: "'过往经历'列会根据剧情发展持续增量更新，当主角各项状态发生改变时更新。\nSQL示例: UPDATE protagonist_info SET past_experience = '更新后的经历内容', occupation = '新职业' WHERE row_id = 1;",
    insertNode: "禁止操作。",
ddl: `CREATE TABLE protagonist_info ( -- 主角信息表
  row_id INTEGER PRIMARY KEY, -- 行号
  char_name TEXT NOT NULL, -- 人物名称
  gender_age TEXT, -- 性别/年龄
  appearance TEXT, -- 外貌特征
  occupation TEXT, -- 职业/身份
  past_experience TEXT, -- 过往经历
  personality TEXT -- 性格特点
);`
  },
  content: [
    [
      "row_id",
      "人物名称",
      "性别/年龄",
      "外貌特征",
      "职业/身份",
      "过往经历",
      "性格特点"
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
    entryName: "主角信息",
    entryType: "constant",
    keywords: "",
    preventRecursion: true,
    injectionTemplate: "",
    extraIndexEnabled: false,
    extraIndexEntryName: "主角信息-索引",
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
  orderNo: 1
};
