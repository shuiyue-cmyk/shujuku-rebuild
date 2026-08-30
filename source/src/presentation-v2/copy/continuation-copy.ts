export const continuationCopy = {
  panels: {
    conditions: {
      title: "循环条件",
      description: "控制续写条件与续写时间。",
    },
    prompts: {
      title: "循环提示词",
      description:
        "按顺序自动发送，队列结束后将从头循环。为空无法启动，请确保至少一条可发送内容。",
    },
    controls: {
      title: "运行控制",
      description:
        "启动后自动填入下一条提示词并发送，每次 AI 回复后继续。停止仅停止后续，不影响已发送内容。",
    },
  },
};
