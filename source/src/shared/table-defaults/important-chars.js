/**
 * 重要角色表 — 默认表定义
 */
export const importantCharsSheet = {
  uid: "sheet_NcBlYRH5",
  name: "重要角色表",
  sourceData: {
    note: "记录所有关键NPC的详细信息和动态状态。\n- 列1: 姓名 - NPC的名字。\n- 列2: 性别/年龄 - NPC的生理性别和年龄。\n- 列3: 一句话介绍 \u2013 用不超过15字概括角色身份背景，不含主观评价。\n- 列4: 外貌特征 - 对NPC外貌和当前衣着的详细描述，对女性角色可包含身材描写；对男性角色无需描写。\n- 列5: 持有的重要物品 - NPC拥有的关键重要物品列表，用分号分隔。\n- 列6: 是否离场 - 判断该角色是否能直接与主角互动，填写\u201C是\u201D或\u201C否\u201D。\n- 列7: 过往经历 - 记录角色背景与关键事件，随剧情增量更新，不超过300字，超过时需压缩。",
    initNode: "游戏初始化时为当前在场的重要人物分别插入一个条目。",
    deleteNode: "禁止删除。",
    updateNode: "已有角色的状态、关系、想法或经历变化时更新；若角色死亡需在姓名旁标注（已死亡）。\nSQL示例: UPDATE important_characters SET is_absent = '是', past_experience = '新增经历...' WHERE name = '角色名';",
    insertNode: "剧情中有未记录的重要人物登场时添加。\nSQL示例: INSERT INTO important_characters (name, gender_age, brief_intro, appearance, key_items, is_absent, past_experience) VALUES ('角色名', '女/20', '简介', '外貌描述', '物品', '否', '经历');",
    ddl: `CREATE TABLE important_characters ( -- 重要角色表
  row_id INTEGER PRIMARY KEY, -- 行号
  name TEXT NOT NULL UNIQUE, -- 姓名
  gender_age TEXT, -- 性别/年龄
  brief_intro TEXT, -- 一句话介绍
  appearance TEXT, -- 外貌特征
  key_items TEXT, -- 持有的重要物品
  is_absent TEXT NOT NULL DEFAULT '否' CHECK(is_absent IN ('是', '否')), -- 是否离场
  past_experience TEXT -- 过往经历
);`
  },
  content: [
    [
      "row_id",
      "姓名",
      "性别/年龄",
      "一句话介绍",
      "外貌特征",
      "持有的重要物品",
      "是否离场",
      "过往经历"
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
    enabled: true,
    splitByRow: true,
    entryName: "重要人物表",
    entryType: "keyword",
    keywords: "姓名",
    preventRecursion: true,
    injectionTemplate: "",
    extraIndexEnabled: true,
    extraIndexEntryName: "重要人物表-索引",
    extraIndexColumns: [
      "姓名",
      "一句话介绍"
    ],
    extraIndexColumnModes: {
      "姓名": "both",
      "一句话介绍": "index_only"
    },
    extraIndexInjectionTemplate: "以下为已经登场过的角色：\n<已登场角色>\n$1\n</已登场角色>",
    entryPlacement: {
      position: "at_depth_as_system",
      depth: 10000,
      order: 10000
    },
    extraIndexPlacement: {
      position: "at_depth_as_system",
      depth: 10000,
      order: 8000
    },
    fixedEntryPlacement: {
      position: "at_depth_as_system",
      depth: 10000,
      order: 99983
    },
    fixedIndexPlacement: {
      position: "at_depth_as_system",
      depth: 10000,
      order: 99984
    }
  },
  orderNo: 2
};
