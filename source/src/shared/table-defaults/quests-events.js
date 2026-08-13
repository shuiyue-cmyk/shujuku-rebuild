/**
 * 任务与事件表 — 默认表定义
 */
export const questsEventsSheet = {
  uid: "sheet_etak47Ve",
  name: "任务与事件表",
  sourceData: {
    note: "记录所有当前正在进行的任务。\n- 列1: 任务名称 - 任务的标题。\n- 列2: 任务类型 - \u201C主线任务\u201D或\u201C支线任务\u201D。\n- 列3: 发布者 - 发布该任务的角色或势力。\n- 列4: 详细描述 - 任务的目标和要求。\n- 列5: 当前进度 - 对任务完成度的简要描述。\n- 列6: 任务时限 - 完成任务的剩余时间。\n- 列7: 奖励 - 完成任务可获得的奖励。\n- 列8: 惩罚 - 任务失败的后果。",
    initNode: "游戏初始化时，根据剧情与设定添加一条主线剧情。",
    deleteNode: "任务完成、失败或过期时删除。\nSQL示例: DELETE FROM quests_events WHERE quest_name = '已完成的任务';",
    updateNode: "任务取得关键进展时进行更新。\nSQL示例: UPDATE quests_events SET current_progress = '已完成第一阶段', time_limit = '剩余3天' WHERE quest_name = '拯救公主';",
    insertNode: "主角接取或触发新的主线或支线任务时添加。\nSQL示例: INSERT INTO quests_events (quest_name, quest_type, issuer, detail_desc, current_progress, time_limit, reward, penalty) VALUES ('新任务', '支线任务', '村长', '任务描述', '刚接取', '7天', '金币100', '声望降低');",
    ddl: `CREATE TABLE quests_events ( -- 任务与事件表
  row_id INTEGER PRIMARY KEY, -- 行号
  quest_name TEXT NOT NULL UNIQUE, -- 任务名称
  quest_type TEXT NOT NULL CHECK(quest_type IN ('主线任务', '支线任务')), -- 任务类型
  issuer TEXT, -- 发布者
  detail_desc TEXT, -- 详细描述
  current_progress TEXT, -- 当前进度
  time_limit TEXT, -- 任务时限
  reward TEXT, -- 奖励
  penalty TEXT -- 惩罚
);`
  },
  content: [
    [
      "row_id",
      "任务名称",
      "任务类型",
      "发布者",
      "详细描述",
      "当前进度",
      "任务时限",
      "奖励",
      "惩罚"
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
    entryName: "任务与事件表",
    entryType: "constant",
    keywords: "",
    preventRecursion: true,
    injectionTemplate: "",
    extraIndexEnabled: false,
    extraIndexEntryName: "任务与事件表-索引",
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
  orderNo: 5
};
