export const advancedToolsCopy = {
  nav: {
    sql: "SQL 控制台",
    logs: "运行日志",
    debug: "Debug",
  },
  panels: {
    sql: {
      title: "SQL 控制台",
      description:
        "直接在当前聊天数据库执行 SQLite 运行库。执行报错时先检查结果区，再确认表名、列名和当前聊天是否已经加载表格。",
    },
    logs: {
      title: "运行日志",
      description:
        "查看数据库运行日志。筛选仅影响显示和导出。未看到日志请开启采集后重试。每条报错下方都附有处理建议，点「怎么处理」可展开具体步骤。",
    },
    debug: {
      title: "Debug 问题上报",
      description:
        "遇到可复现的问题时：开启 Debug → 复现问题 → 导出 Debug 数据（.json）→ 点「前往 GitHub 提交 issue」把文件作为附件提交；附件传不上时可传到自己常用的网盘，把分享链接贴进 issue（也可自行交给开发者）。导出包含版本、环境摘要（密钥脱敏）、全量日志与表结构概览。",
    },
  },
};
