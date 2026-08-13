/**
 * 纪要表 — 默认表定义
 */
export const chronicleSheet = {
  uid: "sheet_3NoMc1wI",
  name: "纪要表",
  sourceData: {
    note: "轮次日志，每轮交互后必须立即插入一条新记录。\n- 列1: 时间跨度 - 本轮事件发生的精确时间范围。\n- 列2: 地点 - 本轮事件发生的地点，从大到小描述。\n- 列3: 纪要 - 以第三方视角客观记录本轮事件，不得加入推测、情绪化语言、负面解读或主观判断。内容必须基于正文明确发生的事实，不得补充未出现的情节，不少于300字，结尾部分禁止进行总结或者升华。\n- 列4: 概要 - 30字以内，一句话概括纪要内容。\n- 列5: 编码索引 - 格式为 AMXXXX，XXXX从0001递增。\n",
    initNode: "故事初始化时，插入一条新记录用于记录初始化剧情。",
    deleteNode: "禁止删除。",
    updateNode: "禁止操作。",
    insertNode: "每轮交互结束后插入一条新记录。\n时间跨度格式必须为 YYYY-MM-DD HH:MM ~ YYYY-MM-DD HH:MM。\nSQL示例: INSERT INTO chronicle (time_span, location, chronicle_text, summary, code_index) VALUES ('2024-03-15 14:00 ~ 2024-03-15 15:00', '王城·中央广场', '本轮纪要内容...', '一句话概括', 'AM0002');",
    ddl: `CREATE TABLE chronicle ( -- 纪要表
  row_id INTEGER PRIMARY KEY, -- 行号
  time_span TEXT NOT NULL CHECK(time_span GLOB '????-??-?? ??:?? ~ ????-??-?? ??:??'), -- 时间跨度
  location TEXT NOT NULL, -- 地点
  chronicle_text TEXT NOT NULL, -- 纪要
  summary TEXT, -- 概览
  code_index TEXT NOT NULL UNIQUE CHECK(code_index GLOB 'AM[0-9][0-9][0-9][0-9]') -- 编码索引
);`
  },
  content: [
    [
      "row_id",
      "时间跨度",
      "地点",
      "纪要",
      "概览",
      "编码索引"
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
    entryName: "纪要",
    entryType: "keyword",
    keywords: "编码索引",
    preventRecursion: true,
    injectionTemplate: "<记忆回溯>\n$1\n</记忆回溯>",
    extraIndexEnabled: true,
    extraIndexEntryName: "纪要索引",
    extraIndexColumns: [
      "概览",
      "编码索引"
    ],
    extraIndexColumnModes: {
      "概览": "index_only",
      "编码索引": "both"
    },
    extraIndexInjectionTemplate: "<已发生的事件概览>\n$1\n</已发生的事件概览>",
    entryPlacement: {
      position: "at_depth_as_system",
      depth: 999,
      order: 10000
    },
    extraIndexPlacement: {
      position: "at_depth_as_system",
      depth: 1000,
      order: 10010
    },
    fixedEntryPlacement: {
      position: "at_depth_as_system",
      depth: 9999,
      order: 99987
    },
    fixedIndexPlacement: {
      position: "at_depth_as_system",
      depth: 9999,
      order: 99988
    }
  },
  orderNo: 6
};
