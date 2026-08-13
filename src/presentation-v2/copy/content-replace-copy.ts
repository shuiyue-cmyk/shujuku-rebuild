export const contentReplaceCopy = {
  nav: {
    basic: "基础设置",
    mode: "替换模式",
    preset: "预设",
    filter: "标签筛选",
    test: "手动测试",
  },
  panels: {
    basic: {
      title: "基础设置",
      description: "控制使用哪套 API、以及短文本和失败重试的边界。",
    },
    mode: {
      title: "替换模式",
      description:
        "无感模式：尽量将优化结果直接写回聊天，关闭则需手动确认。排查误替换时，建议关闭无感与自动应用，保留对比。",
    },
    preset: {
      title: "正文替换预设",
      description:
        "下拉框切换当前通用API，星标设为全局默认。点击按钮，可导入新预设、管理全部预设。内置默认预设无法修改，请使用「从默认新建」。",
    },
    filter: {
      title: "标签筛选",
      description:
        "按标签提取内容，提升填表准确性。提取仅保留指定范围，排除移除指定范围。",
    },
    test: {
      title: "手动测试",
      description:
        "使用当前配置测试文本，不写回聊天。失败通常为 API、提示词格式或筛选问题，请检查错误并调整配置。",
    },
  },
};
