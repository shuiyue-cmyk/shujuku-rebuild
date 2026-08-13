/**
 * 全局数据表 — 默认表定义
 */
export const globalStateSheet = {
  uid: "sheet_dCudvUnH",
  name: "全局数据表",
  sourceData: {
    note: "记录当前主角所在地点及时间相关参数。此表有且仅有一行。\n- 列1: 主角当前所在地点 - 主角当前所在的具体场景名称。\n- 列2: 当前时间 - 游戏世界的当前时间。格式：\u201CYYYY-MM-DD HH:MM\u201D，初始化时如果剧情没有明确具体的日期和时间，则必须根据世界观和设定自行设定一个明确的日期时间。\n- 列3: 上轮场景时间 - 上一轮交互结束时的时间。\n- 列4: 经过的时间 - 根据当前与上轮时间计算得出的文本描述（如：\u201C几分钟\u201D）。",
    initNode: "插入一条关于当前世界状态的记录。",
    deleteNode: "禁止删除。",
    updateNode: "当主角从当前所在区域离开时，更新所在地点。每轮必须更新时间。\nSQL示例: UPDATE global_state SET current_location = '新地点', prev_scene_time = cur_time, cur_time = '2024-03-15 16:00', elapsed_time = '约1小时' WHERE row_id = 1;",
    insertNode: "禁止操作。",
    ddl: `CREATE TABLE global_state ( -- 全局数据表
  row_id INTEGER PRIMARY KEY, -- 行号
  current_location TEXT NOT NULL, -- 主角当前所在地点
  cur_time TEXT NOT NULL CHECK(cur_time GLOB '????-??-?? ??:??'), -- 当前时间
  prev_scene_time TEXT CHECK(prev_scene_time IS NULL OR prev_scene_time GLOB '????-??-?? ??:??'), -- 上轮场景时间
  elapsed_time TEXT -- 经过的时间
);`
  },
  content: [
    [
      "row_id",
      "主角当前所在地点",
      "当前时间",
      "上轮场景时间",
      "经过的时间"
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
    entryName: "全局数据表",
    entryType: "constant",
    keywords: "",
    preventRecursion: true,
    injectionTemplate: "",
    extraIndexEnabled: false,
    extraIndexEntryName: "全局数据表-索引",
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
      position: "before_char",
      depth: 2,
      order: 99981
    },
    fixedIndexPlacement: {
      position: "before_char",
      depth: 2,
      order: 99980
    }
  },
  orderNo: 0
};
