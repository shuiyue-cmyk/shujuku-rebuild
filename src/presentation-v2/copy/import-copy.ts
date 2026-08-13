export const importCopy = {
  panels: {
    worldbookTarget: {
      title: "写入目标",
      description:
        "导入内容写入的世界书。建议选独立世界书，避免与角色卡混用，方便后续整理。",
    },
    splitEncoding: {
      title: "拆分与编码",
      description:
        "文件按字符数分段，每段一条目。非 UTF-8 文件请选对编码，否则导入乱码。",
    },
    tableSelection: {
      title: "写入表格选择",
      description:
        "须使用特殊制卡表格模板，AI依表结构生成内容。生产前至少勾选一项表格，否则「写入」不可用。",
    },
    operations: {
      title: "状态 / 操作区",
      description:
        "操作顺序：先按「选择并拆分」载入txt文件，再按「写入」把内容写入世界书。「清空缓存」仅丢弃未写入内容。「删除条目」移除已写入的条目。",
    },
  },
};
