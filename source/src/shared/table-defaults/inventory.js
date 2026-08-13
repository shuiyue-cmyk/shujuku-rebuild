/**
 * 背包物品表 — 默认表定义
 */
export const inventorySheet = {
  uid: "sheet_in05z9vz",
  name: "背包物品表",
  sourceData: {
    note: "记录主角拥有的所有物品、装备。\n- 列1: 物品名称 - 物品的名称。\n- 列2: 数量 - 拥有的数量。\n- 列3: 描述/效果 - 物品的功能或背景描述。\n- 列4: 类别 - 物品的类别（如：\u201C武器\u201D、\u201C消耗品\u201D、\u201C杂物\u201D）。",
    initNode: "游戏初始化时，根据剧情与设定添加主角的初始携带物品。",
    deleteNode: "物品被完全消耗、丢弃或摧毁时删除。\nSQL示例: DELETE FROM inventory WHERE item_name = '已消耗物品';\nSQL示例(批量): DELETE FROM inventory WHERE quantity <= 0;",
    updateNode: "获得已有的物品，使其数量增加时更新，已有物品状态变化时更新。\nSQL示例: UPDATE inventory SET quantity = quantity + 3 WHERE item_name = '治疗药水';\nSQL示例(多列): UPDATE inventory SET quantity = quantity - 1, description = '已损坏' WHERE item_name = '铁剑';",
    insertNode: "主角获得背包中没有的全新物品时添加。\nSQL示例: INSERT INTO inventory (item_name, quantity, description, category) VALUES ('新物品', 1, '物品描述', '杂物');",
    ddl: `CREATE TABLE inventory ( -- 背包物品表
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL UNIQUE, -- 物品名称
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0), -- 数量
  description TEXT, -- 描述/效果
  category TEXT -- 类别
);`
  },
  content: [
    [
      "row_id",
      "物品名称",
      "数量",
      "描述/效果",
      "类别"
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
    entryName: "背包物品表",
    entryType: "constant",
    keywords: "",
    preventRecursion: true,
    injectionTemplate: "",
    extraIndexEnabled: false,
    extraIndexEntryName: "背包物品表-索引",
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
  orderNo: 4
};
