/**
 * romance-overrides.js — 恋爱特化默认表覆盖片段
 *
 * 只包含与原默认模板同名的表。
 * 组装新默认模板时会保留原默认表的 key/uid/orderNo，
 * 仅用这里的表结构、提示词、导出配置等内容覆盖。
 */
export const romanceDefaultSheetOverrides = {
  "sheet_global_data": {
    "uid": "sheet_global_data",
    "name": "全局数据表",
    "sourceData": {
      "note": "记录当前主角所在地点及时间相关参数。此表有且仅有一行。\n\n【列定义】\n- 列1: 全局状态 story_state\n- 列2: 当前详细地点 current_location\n- 列3: 当前次要地区 current_minor_region\n- 列4: 当前主要地区 current_major_region\n- 列5: 上轮场景时间 prev_scene_time（初始化时为NULL）\n- 列6: 经过的时间 elapsed_time\n- 列7: 当前时间 cur_time\n\n【强制约束】\n全局状态为固定字符串`全局状态`，标题性质。\n\n地点层级从小到大：详细地点 < 次要地区 < 主要地区。\n每个字段只写本级名称，不拼上级前缀。\n√ 当前详细地点填 “御苑”\n× 当前详细地点填 “东京-新宿区-御苑”\n\n时间格式：\nprev_scene_time / cur_time: YYYY-MM-DD HH:MM\nelapsed_time: {数值}{单位}，多单位用空格连。\n单位集合：[纪元,千年,百年,年,月,周,天,小时,分]\n示例：\"3小时20分\" | \"2天\" | \"3年6月\"\n\n时间计算公式：cur_time = prev_scene_time + elapsed_time\n- 初始化时prev_scene_time为NULL，cur_time直接填写初始时间，无需计算\n- 每轮推进时，将上一轮的cur_time赋值给prev_scene_time，然后填写本次的elapsed_time，最后计算得到新的cur_time",
      "initNode": "故事初始化时，插入唯一条目，记录用户开局初始时间与初始地点。禁止直接照搬示例中的地点和日期。\n\nSQL示例: INSERT INTO global_state (story_state, current_location, current_minor_region, current_major_region, prev_scene_time, elapsed_time, cur_time)\nVALUES ('全局状态', '御苑', '新宿区', '东京都', NULL, '0分', '2026-02-03 09:00');",
      "deleteNode": "禁止。",
      "updateNode": "每轮推进时更新 prev_scene_time、elapsed_time 和 cur_time；若地点变动则同步更新三级地点字段。\n\n【更新约束】\n除初始化时 prev_scene_time 可为 NULL 外，其余字段均不可写 NULL 或空串。\n\n【更新SQL示例（同日+跨日+位置变动综合覆盖）】\nSQL示例(同日推进): UPDATE global_state SET prev_scene_time = '2026-02-03 09:00', elapsed_time = '3小时', cur_time = '2026-02-03 12:00' WHERE row_id = 1;\n\nSQL示例(跨日推进): UPDATE global_state SET prev_scene_time = '2026-02-03 23:55', elapsed_time = '20分', cur_time = '2026-02-04 00:15' WHERE row_id = 1;\n\nSQL示例(含位置变动): UPDATE global_state SET current_location = '新宿车站', current_minor_region = '新宿区', current_major_region = '东京都', prev_scene_time = '2026-02-03 12:00', elapsed_time = '30分', cur_time = '2026-02-03 12:30' WHERE row_id = 1;",
      "insertNode": "禁止。",
      "ddl": "CREATE TABLE global_state ( -- 全局数据表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  story_state TEXT NOT NULL CHECK(story_state = '全局状态'), -- 全局状态\n  current_location TEXT NOT NULL, -- 当前详细地点\n  current_minor_region TEXT NOT NULL, -- 当前次要地区\n  current_major_region TEXT NOT NULL, -- 当前主要地区\n  prev_scene_time TEXT CHECK(prev_scene_time IS NULL OR prev_scene_time GLOB '????-??-?? ??:??'), -- 上轮场景时间\n  elapsed_time TEXT NOT NULL, -- 经过的时间\n  cur_time TEXT NOT NULL CHECK(cur_time GLOB '????-??-?? ??:??') -- 当前时间\n);"
    },
    "content": [
      [
        "row_id",
        "全局状态",
        "当前详细地点",
        "当前次要地区",
        "当前主要地区",
        "上轮场景时间",
        "经过的时间",
        "当前时间"
      ]
    ],
    "updateConfig": {
      "uiSentinel": -1,
      "contextDepth": -1,
      "updateFrequency": -1,
      "batchSize": -1,
      "skipFloors": -1,
      "groupId": -1
    },
    "exportConfig": {
      "enabled": false,
      "splitByRow": false,
      "entryName": "全局数据表",
      "entryType": "constant",
      "keywords": "",
      "preventRecursion": true,
      "injectionTemplate": "",
      "extraIndexEnabled": false,
      "extraIndexEntryName": "全局数据表-索引",
      "extraIndexColumns": [],
      "extraIndexColumnModes": {},
      "extraIndexInjectionTemplate": "",
      "entryPlacement": {
        "position": "at_depth_as_system",
        "depth": 2,
        "order": 10000
      },
      "extraIndexPlacement": {
        "position": "at_depth_as_system",
        "depth": 2,
        "order": 10010
      },
      "fixedEntryPlacement": {
        "position": "before_character_definition",
        "depth": 2,
        "order": 99981
      },
      "fixedIndexPlacement": {
        "position": "before_character_definition",
        "depth": 2,
        "order": 99982
      }
    },
    "orderNo": 0
  },
  "sheet_protagonist": {
    "uid": "sheet_protagonist",
    "name": "主角信息表",
    "sourceData": {
      "note": "记录主角的核心身份信息。此表有且仅有一行。\n\n【列定义】\n- 列1: 姓名 name\n- 列2: 性别 gender\n- 列3: 年龄 age\n- 列4: 外貌特征 appearance（含日常穿衣风格，写出整体印象，避免罗列数据）\n- 列5: 身份 identity_text（逗号分隔）\n- 列6: 近况 current_condition\n- 列7: 所在地点 location_name\n- 列8: 随身财物 belongings（可NULL）\n\n【强制约束】\n1. 所在地点只写地点名不带层级前缀。位置变化时同步更新。\n\n2. 近况用一句话描述主角当前的身体感觉、情绪状态或心头惦记的事。\n正常时期填\"一切如常\"，有异常时直接写具体感受，不用标签堆叠。\n√ 昨晚没睡好，脑子有点沉\n√ 刚从雨里跑回来，衣服还湿着\n\n3. 随身财物只写当前身上带着的有意义物品，不写游戏化资源。\n√ 钱包里夹着第一次看电影的票根\n√ 口袋里剩两颗橘子糖",
      "initNode": "故事初始化时，插入主角的唯一条目。",
      "deleteNode": "禁止。",
      "updateNode": "已存在的这一行，字段值变化时更新：年龄、外貌、身份、近况、所在地点、随身财物。\n\n【更新SQL示例（近况+位置变化）】\n更新SQL示例(近况变化): UPDATE protagonist_info SET current_condition = '疲劳，左膝擦伤', location_name = '御苑' WHERE row_id = 1;\n\n更新SQL示例(随身财物变化): UPDATE protagonist_info SET belongings = '钱包里夹着第一次看电影的票根，口袋里剩两颗橘子糖' WHERE row_id = 1;",
      "insertNode": "禁止。",
      "ddl": "CREATE TABLE protagonist_info ( -- 主角信息\n  row_id INTEGER PRIMARY KEY CHECK(row_id = 1), -- 行号，仅允许为 1\n  name TEXT NOT NULL, -- 姓名\n  gender TEXT NOT NULL, -- 性别\n  age INTEGER CHECK(age IS NULL OR age >= 0), -- 年龄\n  appearance TEXT NOT NULL, -- 外貌特征\n  identity_text TEXT NOT NULL, -- 身份\n  current_condition TEXT NOT NULL DEFAULT '一切如常', -- 近况\n  location_name TEXT NOT NULL, -- 所在地点\n  belongings TEXT -- 随身财物\n);"
    },
    "content": [
      [
        "row_id",
        "姓名",
        "性别",
        "年龄",
        "外貌特征",
        "身份",
        "近况",
        "所在地点",
        "随身财物"
      ]
    ],
    "updateConfig": {
      "uiSentinel": -1,
      "contextDepth": -1,
      "updateFrequency": -1,
      "batchSize": -1,
      "skipFloors": -1,
      "groupId": -1
    },
    "exportConfig": {
      "enabled": false,
      "splitByRow": false,
      "entryName": "主角信息",
      "entryType": "constant",
      "keywords": "",
      "preventRecursion": true,
      "injectionTemplate": "",
      "extraIndexEnabled": false,
      "extraIndexEntryName": "主角信息-索引",
      "extraIndexColumns": [],
      "extraIndexColumnModes": {},
      "extraIndexInjectionTemplate": "",
      "entryPlacement": {
        "position": "at_depth_as_system",
        "depth": 2,
        "order": 10000
      },
      "extraIndexPlacement": {
        "position": "at_depth_as_system",
        "depth": 2,
        "order": 10010
      },
      "fixedEntryPlacement": {
        "position": "at_depth_as_system",
        "depth": 2,
        "order": 99990
      },
      "fixedIndexPlacement": {
        "position": "at_depth_as_system",
        "depth": 2,
        "order": 99991
      }
    },
    "orderNo": 2
  },
  "sheet_important_non_romance": {
    "uid": "sheet_important_non_romance",
    "name": "重要角色表",
    "sourceData": {
      "note": "记录所有对当前剧情产生作用的重要角色。\n\n【列定义】\n- 列1: 姓名 name（全表唯一）\n- 列2: 性别 gender\n- 列3: 年龄 age\n- 列4: 一句话介绍 brief_intro\n- 列5: 外貌特征 appearance\n- 列6: 穿着打扮 outfit_text\n- 列7: 所在地点 location_name\n- 列8: 在场状态 presence_status（在场/离场）\n- 列9: 人际关系 relation_text\n- 列10: 过往经历 past_experience\n- 列11: 交互选项 interaction_options\n\n【强制约束】\nbrief_intro仅允许客观事实类内容，严禁出现任何性格标签概述，如\"开朗\"\"冷漠\"\"温柔\"等；客观内容范畴包括但不限于：角色核心身份、与剧情强相关的客观行为、与关键人物的客观关联、非性格类核心特征。\n√ 经营城南杂货铺 / 曾救过主角的性命 / 艾莉丝的亲生兄长\n× 性格孤僻的杂货铺老板 / 温柔且救过主角 / 偏执的艾莉丝兄长\n\noutfit_text仅写外在可见的服饰、饰品、妆容、持握物等可视元素，禁止写固有的长相特征、气质、气场等非视觉内容。\n√ 深灰立领风衣配黑皮手套 / 左手无名指戴着一枚银色蛇纹戒\n× 散发出高贵的气场、看起来像个军人\n\ninteraction_options必须同时遵循下述要求\n1.不使用第一人称\"我\"\n2.动作发起方为主角，接收方为角色\n3.必须是具体、有代入感的实际行动，避免干瘪的单词\n√ 向他打听失踪案线索 / 假装偶遇并搭话套取信息 / 故意打翻水杯制造冲突\n× 交谈 / 打听\n\n【relation_text 格式规则】（强制）\n1. 格式必须是：角色名:关系描述\n   - 必须显式写出\"角色名:\"前缀，禁止省略角色名直接写关系内容。\n   - 同一角色有多个关系标签/描述时，标签之间用英文逗号 , 分隔。\n   - 不同角色之间用英文分号 ; 分隔。\n   - 关系描述去除人称，使用简短陈述。\n2. 主要记录该角色与主角及其他重要角色之间的客观关联，至少包含与主角的关系。\n   √ 主角:曾帮其修过自行车,旧识\n   √ 主角:认识;艾莉丝:室友兼闺蜜\n   √ 主角:校长身份,从未直接交谈;艾莉丝:监护人\n   × 曾帮主角修过自行车                    ← 缺少角色名前缀\n   × 主角:认识;室友兼闺蜜                  ← 第二段缺少角色名\n   × 主角:旧识,艾莉丝:室友                 ← 不同角色错用逗号\n   × 主角:曾帮其修过自行车;旧识            ← 同一角色多标签错用分号",
      "initNode": "故事开始时为当前已知的重要角色分别插入条目。\n\n【格式约束】\nrelation_text 必须写\"角色名:关系描述\"；同一角色多项描述用英文逗号 , 分隔；不同角色之间用英文分号 ; 分隔。\n\nSQL示例: INSERT INTO important_non_romance (name, gender, age, brief_intro, appearance, outfit_text, location_name, presence_status, relation_text, past_experience, interaction_options) VALUES ('校长', '男', 60, '学院校长', '白发，手持手杖，目光深邃', '深灰立领风衣配黑皮手套', '校长室', '离场', '主角:曾帮其修过自行车,旧识;艾莉丝:监护人', '据说知晓学院的许多秘密，很少露面。', '向他打听失踪案线索');",
      "deleteNode": "默认禁止删除。已出场但暂时无剧情、暂时离场、关系状态变化、身份变化的角色，都必须保留在本表，只更新 presence_status、relation_text、past_experience、interaction_options 等字段。仅当角色明确永久离开当前剧情，且后续不再需要追踪时，才允许删除。\nSQL示例(永久离开且不再追踪):DELETE FROM important_non_romance WHERE name = '艾莉丝';",
      "updateNode": "已存在的重要角色，字段变化时更新。\n\n【格式约束】\nrelation_text 必须写\"角色名:关系描述\"；同一角色多项描述用英文逗号 , 分隔；不同角色之间用英文分号 ; 分隔。\n\nSQL示例(普通字段更新): UPDATE important_non_romance SET presence_status = '离场', interaction_options = '向他打听失踪案线索' WHERE name = '校长';\nSQL示例(单角色多描述): UPDATE important_non_romance SET relation_text = '主角:曾帮其修过自行车,近期开始留意主角动向' WHERE name = '校长';\nSQL示例(多角色关系): UPDATE important_non_romance SET relation_text = '主角:旧识,旧情人;艾莉丝:监护人;神田:旧部下' WHERE name = '校长';",
      "insertNode": "新重要角色登场时新增。\n\n【格式约束】\nrelation_text 必须写\"角色名:关系描述\"；同一角色多项描述用英文逗号 , 分隔；不同角色之间用英文分号 ; 分隔。至少包含与主角的关系。\n\nSQL示例: INSERT INTO important_non_romance (name, gender, age, brief_intro, appearance, outfit_text, location_name, presence_status, relation_text, past_experience, interaction_options) VALUES ('黑市商人', '男', 45, '经营城南杂货铺', '左眼带有刀疤', '深灰立领风衣配黑皮手套', '城南杂货铺', '在场', '主角:曾救过其性命,长期供货人', '长期在地下黑市进行交易。', '假装偶遇并搭话套取信息');",
      "ddl": "CREATE TABLE important_non_romance ( -- 重要角色表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  name TEXT NOT NULL UNIQUE, -- 姓名\n  gender TEXT, -- 性别\n  age INTEGER CHECK(age IS NULL OR age >= 0), -- 年龄\n  brief_intro TEXT NOT NULL, -- 一句话介绍\n  appearance TEXT, -- 外貌特征\n  outfit_text TEXT, -- 穿着打扮\n  location_name TEXT, -- 所在地点\n  presence_status TEXT NOT NULL DEFAULT '在场' CHECK(presence_status IN ('在场', '离场')), -- 在场状态\n  relation_text TEXT NOT NULL, -- 人际关系\n  past_experience TEXT, -- 过往经历\n  interaction_options TEXT -- 交互选项\n);"
    },
    "content": [
      [
        "row_id",
        "姓名",
        "性别",
        "年龄",
        "一句话介绍",
        "外貌特征",
        "穿着打扮",
        "所在地点",
        "在场状态",
        "人际关系",
        "过往经历",
        "交互选项"
      ]
    ],
    "updateConfig": {
      "uiSentinel": -1,
      "contextDepth": -1,
      "updateFrequency": -1,
      "batchSize": -1,
      "skipFloors": -1,
      "groupId": -1
    },
    "exportConfig": {
      "enabled": true,
      "splitByRow": true,
      "entryName": "重要角色表",
      "entryType": "keyword",
      "keywords": "姓名",
      "preventRecursion": true,
      "injectionTemplate": "",
      "extraIndexEnabled": true,
      "extraIndexEntryName": "重要角色表-索引",
      "extraIndexColumns": [
        "姓名",
        "一句话介绍"
      ],
      "extraIndexColumnModes": {
        "姓名": "both",
        "一句话介绍": "index_only"
      },
      "extraIndexInjectionTemplate": "以下为已经登场过的重要角色：\n<重要角色索引>\n$1\n</重要角色索引>",
      "entryPlacement": {
        "position": "at_depth_as_system",
        "depth": 10000,
        "order": 10000
      },
      "extraIndexPlacement": {
        "position": "at_depth_as_system",
        "depth": 10000,
        "order": 8010
      },
      "fixedEntryPlacement": {
        "position": "at_depth_as_system",
        "depth": 10000,
        "order": 99985
      },
      "fixedIndexPlacement": {
        "position": "at_depth_as_system",
        "depth": 10000,
        "order": 99986
      }
    },
    "orderNo": 5
  },
  "sheet_summary": {
    "uid": "sheet_summary",
    "name": "纪要表",
    "sourceData": {
      "note": "轮次日志。每轮交互结束后立刻插入一条新记录。\n\n【列定义】\n- 列1: 编码索引 code_index（AM0001起递增，全表唯一）\n- 列2: 时间跨度 time_span\n- 列3: 概览 summary（≤30字）\n- 列4: 纪要 chronicle_text（240-480字）\n- 列5: 重要对话 key_dialogue（可NULL）\n\n【强制约束】\n1.编码索引格式 AMXXXX，从0001开始递增。\n2.时间跨度格式为 \"YYYY-MM-DD HH:MM ~ YYYY-MM-DD HH:MM\"，覆盖本轮事件的实际时间范围。\n3.概览一句话概括本轮纪要内容，≤30字。\n\n4.纪要规范：\n- 以第三方视角中立客观记录正文发生的一切，移除所有修辞与对话。不滥用环境描写、不进行动作细节分析、不加评论，不抒情，不升华。\n- 用词直白生活化，避免正式措辞（如“达成协议”“确立计划”）。\n- 结尾必须开放，在事件自然流动中结束，不得归纳状态或做出封闭式收束。\n违例：故事仍在继续 / 新的篇章开启 / 二人关系迈入新阶段 / 未来等待着他们。\n- 多轮交互整合为一条记录。\n- 禁止内容：极端情绪（崩溃、狂喜、绝望等）、夸张、比喻、升华、情绪总结、支配欲、掌控欲、总结性收尾。\n\n5.重要对话仅摘录直接推动剧情转折、揭示关键信息、改变人物关系/决策或构成承诺/誓约/约定的原文台词，标明说话人。排除寒暄、重复、情绪感叹。通常3句，最多5句，总token不超过150。",
      "initNode": "故事初始化时，插入一条新记录用于记录剧情。",
      "deleteNode": "禁止。",
      "updateNode": "禁止。",
      "insertNode": "每轮交互结束后插入一条新记录。\n\n【强制约束】\ncode_index、time_span、summary、chronicle_text 均 NOT NULL，不可写 NULL 或空串。\ntime_span 格式必须为 YYYY-MM-DD HH:MM ~ YYYY-MM-DD HH:MM。\ncode_index 格式必须为 AM0001 这种四位编号，且全表唯一。\n\nSQL示例：INSERT INTO chronicle (code_index, time_span, summary, chronicle_text, key_dialogue) VALUES ('AM0036', '2026-02-04 08:00 ~ 2026-02-04 08:30', '一句话概括', '本轮纪要内容...', NULL);",
      "ddl": "CREATE TABLE chronicle ( -- 纪要表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  code_index TEXT NOT NULL UNIQUE CHECK(code_index GLOB 'AM[0-9][0-9][0-9][0-9]'), -- 编码索引\n  time_span TEXT NOT NULL CHECK(time_span GLOB '????-??-?? ??:?? ~ ????-??-?? ??:??'), -- 时间跨度\n  summary TEXT NOT NULL, -- 概览\n  chronicle_text TEXT NOT NULL, -- 纪要\n  key_dialogue TEXT -- 重要对话\n);"
    },
    "content": [
      [
        "row_id",
        "编码索引",
        "时间跨度",
        "概览",
        "纪要",
        "重要对话"
      ]
    ],
    "updateConfig": {
      "uiSentinel": -1,
      "contextDepth": -1,
      "updateFrequency": -1,
      "batchSize": -1,
      "skipFloors": -1,
      "groupId": -1
    },
    "exportConfig": {
      "enabled": true,
      "splitByRow": true,
      "entryName": "纪要",
      "entryType": "keyword",
      "keywords": "编码索引",
      "preventRecursion": true,
      "injectionTemplate": "<记忆回溯>\n$1\n</记忆回溯>",
      "extraIndexEnabled": true,
      "extraIndexEntryName": "纪要索引",
      "extraIndexColumns": [
        "编码索引",
        "时间跨度",
        "概览"
      ],
      "extraIndexColumnModes": {
        "编码索引": "both",
        "时间跨度": "both",
        "概览": "index_only"
      },
      "extraIndexInjectionTemplate": "<已发生的事件概览>\n$1\n</已发生的事件概览>",
      "entryPlacement": {
        "position": "at_depth_as_system",
        "depth": 999,
        "order": 10000
      },
      "extraIndexPlacement": {
        "position": "at_depth_as_system",
        "depth": 1000,
        "order": 10010
      },
      "fixedEntryPlacement": {
        "position": "at_depth_as_system",
        "depth": 9999,
        "order": 99987
      },
      "fixedIndexPlacement": {
        "position": "at_depth_as_system",
        "depth": 9999,
        "order": 99988
      }
    },
    "orderNo": 10
  }
};
