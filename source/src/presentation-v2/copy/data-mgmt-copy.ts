export const dataMgmtCopy = {
  panels: {
    isolation: {
      title: "数据隔离",
      description:
        "按标识分开设置、模板及数据。留空为默认。输入新标识并应用后切换。内容不对时，请回到原标识重选。",
    },
    backup: {
      title: "备份与恢复",
      description:
        "控制当前配置备份导入与导出。合并导入覆盖提示词与模板，不直接改写已有楼层。模板覆盖会使用当前聊天生效的模板改写最新 AI 楼层。特殊导出：导出包含聊天填表数据的表格模板，非纯表格数据，可在「表格模板」模块导入。Checkpoint 则用于完整备份和恢复当前聊天当前标识的表格、模板与指导表。需注意：若没有恢复默认模板或切换无数据表格模板，进行其他聊天时可能出现数据污染。",
      sqliteRuntime: {
        title: "SQLite 运行时诊断",
        description:
          "仅显示当前聊天内存运行时的脱敏健康快照。重新初始化只重建内存数据库，不会修改聊天、Checkpoint、模板或世界书。",
        reloadLabel: "重新初始化当前聊天 SQLite 运行时",
        reloadSuccess: "当前聊天 SQLite 内存运行时已重新初始化。",
        reloadDegraded: "SQLite 内存运行时重初始化后降级为 native；请查看脱敏状态快照。",
        reloadFailed: "SQLite 内存运行时重新初始化失败；请查看脱敏状态快照。",
        healthSnapshot: {
          status: "状态",
          expectedMode: "期望模式",
          activeMode: "实际模式",
          source: "加载来源",
          loadToken: "加载序号",
          failureCode: "失败代码",
          unavailable: "无",
        },
      },
    },
    cleanup: {
      title: "删除与清理",
      description:
        "此处用于清理当前聊天楼层里的插件本地数据，或把数据库模板、提示词与当前聊天快照缓存恢复到默认状态；不会影响聊天正文。自动保留策略只会在自动更新结束后清理旧楼层；本地数据删除按钮会立即按 AI 楼层范围删除。",
    },
  },
};
