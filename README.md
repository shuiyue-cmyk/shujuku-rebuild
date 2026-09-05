# TTonly·数据库

TauriTavern 数据库插件「TTonly·数据库」的干净重构版。

> **⚠️ 支持范围变更公告**：自本版起，本插件**仅适配 TauriTavern（TT）**，不再为 SillyTavern（ST 酒馆）提供适配、更新支持或兼容性保证。ST 用户请继续使用上游 [`AlbusKen/shujuku`](https://github.com/AlbusKen/shujuku)。在 ST 上安装本版可能出现功能异常，问题反馈将不予处理。

> 持续更新中，详见提交历史：https://github.com/shuiyue-cmyk/shujuku-rebuild/commits/master

基于上游 [`AlbusKen/shujuku`](https://github.com/AlbusKen/shujuku)（spv8.9.2 / main）重构，**运行时零依赖酒馆助手**，以标准扩展形式通过 GitHub 地址直接安装、自带更新。

## 功能

- **SQL 表格**：默认 8 张表（可自定义增删列），SQLite 持久化，支持 `INSERT/UPDATE/DELETE`，模板预设一键切换
- **填表**：正文接收 / 跟随角色卡 / 手动选择三种世界书来源，支持按表分组自动/手动填表与一键追平
- **剧情推进**：内置“时间召回”预设，支持自定义预设导入与速率设置
- **世界书与 Skill 化**：支持常量/关键词触发，Skill 化条目可由 Agent 接管并受正文放行控制
- **可视化前端**：表格查看、剧情推进、世界书管理均在 V2 面板内完成
- **API 预设**：每个预设独立保存 `stream` / `reasoning_effort`（含 `xhigh`）/ 温度等，填表/剧情/追踪可分别指定预设
- **高级工具**：SQL 控制台、运行日志查看与导出、Debug 一键采集（默认关闭，停止时自动导出）

## 安装

在 TauriTavern 的扩展面板粘贴本仓库地址安装：

```
https://github.com/shuiyue-cmyk/shujuku-rebuild
```

后续更新走 TT 扩展面板（`auto_update: true`），开箱即用，无需额外导入脚本。

## 支持我

我一直在用 Opencode GO 的套餐游玩酒馆，如果你喜欢这个项目，欢迎通过我的 AFF 支持我 — 使用链接一起获得5美元的额外赠金：

[https://opencode.ai/go?ref=S2XBM2KR89](https://opencode.ai/go?ref=S2XBM2KR89)
