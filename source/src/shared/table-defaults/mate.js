/**
 * mate 元数据 — 默认定义
 */
export const mateConfig = {
  type: "chatSheets",
  version: 1,
  updateConfigUiSentinel: -1,
  globalInjectionConfig: {
    readableEntryPlacement: {
      position: "before_char",
      depth: 2,
      order: 99981
    },
    wrapperPlacement: {
      position: "before_char",
      depth: 2,
      order: 99980
    }
  }
};
