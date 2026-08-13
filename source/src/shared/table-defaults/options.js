/**
 * 选项表 — 默认表定义
 */
export const optionsSheet = {
  uid: "sheet_OptionsNew",
  name: "选项表",
  sourceData: {
    note: "记录每轮主角可以进行的动作选项。此表有且仅有一行。\n- 列1: 选项一 \u2013 以第三人称描述主角可采取的合理行动，偏向策略或推进剧情。\n- 列2: 选项二 \u2013 以第三人称描述主角可采取的中立行动，不偏向任何立场。\n- 列3: 选项三 \u2013 以第三人称描述主角可采取的善意行动，体现帮助、保护或安抚。\n- 列4: 选项四 \u2013 以第三人称描述主角可采取的 NSFW 相关行动，但必须符合剧情逻辑，不得代替主角说话。\n所有选项必须使用第三人称（如\u201C主角尝试\u2026\u201D，\u201C主角决定\u2026\u201D），不得代替主角发言；必须紧扣当前剧情；四个选项需风格明确、互不重复。",
    initNode: "游戏初始化时，生成四个初始选项。",
    deleteNode: "禁止删除。",
    updateNode: "每轮交互后必须更新此表，根据当前剧情生成新的四个选项覆盖原有内容。\nSQL示例: UPDATE options SET option_1 = '新选项一', option_2 = '新选项二', option_3 = '新选项三', option_4 = '新选项四' WHERE row_id = 1;",
    insertNode: "禁止操作。",
    ddl: `CREATE TABLE options ( -- 选项表
  row_id INTEGER PRIMARY KEY, -- 行号
  option_1 TEXT NOT NULL, -- 选项一
  option_2 TEXT NOT NULL, -- 选项二
  option_3 TEXT NOT NULL, -- 选项三
  option_4 TEXT NOT NULL -- 选项四
);`
  },
  content: [
    [
      "row_id",
      "选项一",
      "选项二",
      "选项三",
      "选项四"
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
    entryName: "选项表",
    entryType: "constant",
    keywords: "",
    preventRecursion: true,
    injectionTemplate: "",
    extraIndexEnabled: false,
    extraIndexEntryName: "选项表-索引",
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
    },
    injectIntoWorldbook: false
  },
  orderNo: 7
};
