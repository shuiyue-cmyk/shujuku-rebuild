# SP·数据库（重构版）

SillyTavern / TauriTavern 数据库插件「SP·数据库」的干净重构版（v9.0.0）。

基于上游 [`AlbusKen/shujuku`](https://github.com/AlbusKen/shujuku)（spv8.9.2 / main）重构：保留全部对外兼容面（SQL 表格模板、剧情推进预设、skill 化、数据库可视化前端），移除原生存储模式与智能续写，**运行时零依赖酒馆助手（JS-Slash-Runner）**，并以标准扩展形式通过 GitHub 仓库地址直接安装、自带更新——不再需要手动改版本号。

## 安装

在 SillyTavern / TauriTavern 的扩展面板（Extensions）中，「Install extension」粘贴本仓库地址：

```
https://github.com/shuiyue-cmyk/shujuku-rebuild
```

仓库根目录即标准扩展产物（`manifest.json` + `index.js` + `sql-wasm.wasm`），安装后自带 GitHub 自动更新（`auto_update: true`）。

> 与旧版的关系：不再需要通过酒馆助手导入 `酒馆助手脚本-数据库本体.json`，也不需要手动维护 import URL 里的 `spv8.9.2` 版本号。

## 运行时依赖说明

- **核心功能**（SQL 表格、模板、剧情推进预设导入、skill 化、可视化前端兼容、V2 界面）**不依赖酒馆助手**。
- **可选增强**：已安装酒馆助手（JS-Slash-Runner）时，AI 主 API 调用（`TavernHelper.generateRaw`）与世界书读写走酒馆助手桥接，功能最完整；未安装时扩展照常启动，剧情推进的 AI 规划等可通过「自定义 API」模式（直接请求 `/api/backends/chat-completions/generate`）工作，缺桥接的能力会自动降级并给出提示。

## 主要变化（相对 spv8.9.2）

| 项目 | 说明 |
| --- | --- |
| 原生存储模式 | 移除。表格数据只通过 SQLite（sql.js + WASM，base64 内联）持久化 |
| 智能续写 | 移除（含 v2 页面、旧弹窗区块与循环引擎） |
| 酒馆助手硬依赖 | 移除启动门控与 `TavernHelper.generate` 钩子 |
| 正文替换解锁 | 由隐藏的 `maxRetries==49` 解锁改为高级设置中的直接开关 |
| 发布形态 | 纯标准扩展，仓库根目录直装 + GitHub 自动更新 |
| 版本号 | 9.0.0（延续 spv8.9.2 之后） |

## 兼容契约

保持不变的对外表面（详见 [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)）：

- 全局 API：`window.AutoCardUpdaterAPI`（exportTableAsJson / importTableAsJson / updateCell / updateRow / deleteRow / insertRow / openSettings / openVisualizer / manualUpdate / registerTableUpdateCallback / _notifyTableUpdate 等）、`window.AutoCardUpdaterV2API`（open / openVisualizer）
- DOM：`#acu-app-v2`、`button[data-page-id="form-fill"]`、按钮文案「全选」「一键追平所选表未填楼层」「切换到高手模式」
- 数据契约：`{ mate: {type:'chatSheets'}, sheet_*: {name, content} }`（content[0] 表头，行 1-based）
- SQL 层：物理表名拼音 slug、`_acu_sheet_meta`、`row_id INTEGER PRIMARY KEY` DDL 约定、默认 8 张模板表 + mate 覆盖
- 剧情推进预设 JSON 结构（promptGroup / plotTasks / 各速率 / loopSettings 等字段）原样兼容
- 设置持久化：`extensionSettings` 命名空间 `shujuku_v120__userscript_settings_v1`

## 本地开发

```bash
npm install
npm run typecheck     # tsc --noEmit
npm run test:parallel # vitest（并行）
npm run build         # rollup → dist/extension + 根目录直装产物
```

## 目录结构

```
├── manifest.json        # 扩展清单（根目录，直装入口）
├── index.js             # 构建产物（根目录，直装入口）
├── sql-wasm.wasm        # sql.js WASM（根目录，直装入口）
├── src/
│   ├── entry-extension.ts   # 扩展入口（零 JSR 依赖）
│   ├── data/                # 数据层：sqlite 引擎 / 网关 / 仓储 / 存储
│   ├── service/             # 服务层：表格 / 剧情推进 / skill / 世界书 / 设置
│   ├── presentation/        # 旧弹窗 UI（DOM/jQuery）
│   └── presentation-v2/     # v2 UI（Vue 3 + Pinia）
├── tests/               # vitest 单元/集成测试（~290 文件）
└── docs/COMPATIBILITY.md # 兼容契约清单
```

## 从旧版迁移

- 旧聊天中的 V1 表格数据会在加载时自动迁移为 V2 帧格式（保留既有迁移逻辑）。
- 旧设置字段（`storageMode: 'native'` 等）会被忽略（恒为 SQLite）。
- 智能续写配置（`loopSettings.quickReplyContent` 等）不再使用，数据字段保留不破坏旧预设。
