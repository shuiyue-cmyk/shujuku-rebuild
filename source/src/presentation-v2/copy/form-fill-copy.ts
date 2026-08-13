export const formFillCopy = {
  nav: {
    status: "表格状态",
    update: "自动更新",
    manual: "手动填表",
    filter: "标签筛选",
    prompt: "提示词",
  },
  panels: {
    status: {
      title: "表格状态",
      description:
        "查看表格更新进度。更新中断时，可依据「上次更新」调整「自动更新设置」。",
    },
    update: {
      title: "自动更新设置",
      description: "控制自动填表的各项参数。正常情况下不必手动修改高级参数。",
    },
    filter: {
      title: "标签筛选",
      description:
        "按标签提取内容，提升填表准确性。提取仅保留指定范围，排除移除指定范围。",
    },
    prompt: {
      title: "填表提示词",
      description:
        "控制AI如何理解与写入表格。建议保持默认或导入他人的填表提示词，不建议手动修改。",
    },
    manual: {
      title: "手动填表",
      description:
        "可按指定上下文重填所选表，也可按已提交前沿追平尚未填写的后缀楼层。填表 API 使用「自动更新设置」中的配置。",
      runLabel: "执行手动填表",
      catchUpLabel: "一键追平所选表未填楼层",
      catchUpBusyLabel: "追平中...",
      catchUpBoundary:
        "追平只补每张表已提交连续前沿之后的后缀缺口，不扫描历史前沿之前的内部空洞。",
      syncPending:
        "追平数据已保存，但世界书同步待重试。",
      syncRetryLabel: "仅同步重试",
    },
  },
};
