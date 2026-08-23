# 幻想·数据库

SillyTavern / TauriTavern 数据库插件「幻想·数据库」的干净重构版（v9.0.0）。

> 持续更新中，详见提交历史：https://github.com/shuiyue-cmyk/shujuku-rebuild/commits/master

基于上游 [`AlbusKen/shujuku`](https://github.com/AlbusKen/shujuku)（spv8.9.2 / main）重构：保留全部对外兼容面（SQL 表格模板、剧情推进预设、skill 化、数据库可视化前端），移除原生存储模式与智能续写，**运行时零依赖酒馆助手（JS-Slash-Runner）**，并以标准扩展形式通过 GitHub 仓库地址直接安装、自带更新——不再需要手动改版本号。

## 生理追踪（内置 BioTracker）

合并自 [`shuiyue-cmyk/st_bs_biotracker`](https://github.com/shuiyue-cmyk/st_bs_biotracker)（生理状态追踪插件），与数据库共用一套 API 配置与存储：

- **角色注册**：手动注册（繁育推演 + 注册两次调用）与自动搜寻注册（楼层扫描 + AI 角色发现 + 种族推断）
- **异步生理追踪**：after_ai 触发、增量楼层分析、完整更新模式、格式化 JSON 输出、MVU 兼容门控
- **状态系统**：生理（base/pregnant/experience/metabolism）、心理（mens/preg 双阶段）、妊娠与胎儿、孩子继承
- **时间流逝**：全角色时间推进（年/月/周/天/时/分）
- **技能与天赋**：注册时判定先天天赋并登记技能定义；技能由追踪 AI 依剧情自动发现觉醒练级（方格墙视图）
- **衣橱 / 备装**：生成备装（可增强发送风格世界书）、衣柜管理、当前穿着编辑
- **完整变量查看与编辑**：JSON 校验后写回；调试工具（在场/离场/妊娠注入等白名单工具）
- **悬浮球前端**：开启生理追踪后以收起悬浮球常驻，点击展开手机式前端；世界书随 agent 开关自动切换主流/绿灯放行模式

## 安装

在 SillyTavern / TauriTavern 的扩展面板（Extensions）中，「Install extension」粘贴本仓库地址：

```
https://github.com/shuiyue-cmyk/shujuku-rebuild
```

仓库根目录即标准扩展产物（`manifest.json` + `index.js` + `sql-wasm.wasm`），安装后自带 GitHub 自动更新（`auto_update: true`）。

> 与旧版的关系：不再需要通过酒馆助手导入 `酒馆助手脚本-数据库本体.json`，也不需要手动维护 import URL 里的 `spv8.9.2` 版本号。

## 运行时依赖说明

- **核心功能**（SQL 表格、模板、剧情推进预设导入、skill 化、可视化前端兼容、V2 界面）**不依赖酒馆助手**。
- **可选增强**：已安装酒馆助手（JS-Slash-Runner）时，世界书读写等部分能力走酒馆助手桥接；未安装时扩展照常启动，AI 调用统一走「自定义 API」（直接请求 `/api/backends/chat-completions/generate`），缺桥接的能力会自动降级并给出提示。

## 主要变化（相对 spv8.9.2）

| 项目 | 说明 |
| --- | --- |
| 原生存储模式 | 移除。表格数据只通过 SQLite（sql.js + WASM，base64 内联）持久化，不再展示存储模式 |
| 外部导入 | 移除（TXT 拆分导入页面与注入链路；世界书侧对历史「外部导入-」前缀条目的保护保留，防止误删旧数据） |
| 智能续写 | 移除（含 v2 页面、旧弹窗区块与循环引擎） |
| 严格 JSON 填表响应 | 移除（开发者选项开关、隔离提示词与 JSON 响应解析链路；填表统一走 `<tableEdit>` 协议） |
| 默认剧情推进 | 默认启用「时间召回」内置预设（原「召回+补充」双系统默认不再使用） |
| 酒馆主 API | 移除（`apiMode=tavern` 连接预设与「使用主 API」开关，AI 调用统一走自定义 API；`TavernHelper.generateRaw` 桥删除） |
| 旧 UI 入口开关 | 移除（旧 UI 菜单入口已随入口重构剥离，开发者选项中的死开关一并删除） |
| 酒馆助手硬依赖 | 移除启动门控与 `TavernHelper.generate` 钩子 |
| 正文替换解锁 | 由隐藏的 `maxRetries==49` 解锁改为高级设置中的直接开关 |
| 发布形态 | 纯标准扩展，仓库根目录直装 + GitHub 自动更新 |
| 版本号 | 9.0.0（延续 spv8.9.2 之后） |

## 更新日志（v9.0.0+）

- **多线程优化（大世界书+长聊天+大表）**：世界书递归扫描改 `Aho-Corasick` Worker（阈值自动启用，8s 超时回退）+ 长聊天逆扫与大表格式化 `setTimeout(0)` 分片，面向 `>100 条目 / >20 表 / >2000 行` 场景不卡 UI
- **Debug 增强**：高级工具 Debug 默认关闭，需显式“开始 Debug”；“停止 Debug”自动导出一次防忘记；导出包新增 `settingsSnapshot`（全量脱敏）、`worldbookDebug`（`entryCount/baseScanLen/chatLen/triggeredCount`）、`lastApiBody`（脱敏的 `buildCustomApiRequestBody` 完整请求体）、`tables.sampleRows`，`Authorization: Bearer` 等敏感头已脱敏
- **填表世界书正文接收**：`active` 明确为“全部挂载蓝灯常驻 / 绿灯关键词匹配才发 / skill 化仅正文放行才发”；下列世界书中默认已发送的自动勾选并锁定，用户仅可额外勾选未覆盖条目，去重由 `Set` 保证
- **API 预设**：`reasoning_effort` / `stream` 等随预设独立，支持 `xhigh`，`custom_exclude_body` 中与预设显式配置冲突的键已自动过滤避免误剔除；思考强度旁提示“偏小尺寸的模型拉高思考强度有助于保证输出内容正确性”

## 兼容契约

保持不变的对外表面（详见下方清单与 `source/docs/TESTING.md`）：

- 全局 API：`window.AutoCardUpdaterAPI`（exportTableAsJson / importTableAsJson / updateCell / updateRow / deleteRow / insertRow / openSettings / openVisualizer / manualUpdate / registerTableUpdateCallback / _notifyTableUpdate 等）、`window.AutoCardUpdaterV2API`（open / openVisualizer）
- DOM：`#acu-app-v2`、`button[data-page-id="form-fill"]`、按钮文案「全选」「一键追平所选表未填楼层」「切换到高手模式」
- 数据契约：`{ mate: {type:'chatSheets'}, sheet_*: {name, content} }`（content[0] 表头，行 1-based）
- SQL 层：物理表名拼音 slug、`_acu_sheet_meta`、`row_id INTEGER PRIMARY KEY` DDL 约定、默认 8 张模板表 + mate 覆盖
- 剧情推进预设 JSON 结构（promptGroup / plotTasks / 各速率 / loopSettings 等字段）原样兼容
- 设置持久化：`extensionSettings` 命名空间 `shujuku_v120__userscript_settings_v1`

## 本地开发

```bash
cd source
npm install
npm run typecheck     # tsc --noEmit
npm run test:parallel # vitest（并行）
npm run build         # rollup → source/dist/extension + 仓库根目录直装产物
```

## 目录结构

仓库根目录即直装产物（SillyTavern/TauriTavern 扩展面板粘贴本仓库地址即可安装）：

```
├── manifest.json        # 扩展清单（根目录，直装入口）
├── index.js             # 构建产物（根目录，直装入口）
├── sql-wasm.wasm        # sql.js WASM（根目录，直装入口）
├── README.md
└── source/              # 源码工程（开发/构建/测试）
    ├── package.json
    ├── rollup.config.js # 单扩展构建，产物同步到仓库根目录
    ├── src/
    │   ├── entry-extension.ts   # 扩展入口（零 JSR 依赖）
    │   ├── data/                # 数据层：sqlite 引擎 / 网关 / 仓储 / 存储
    │   ├── service/             # 服务层：表格 / 剧情推进 / skill / 世界书 / 设置
    │   │   └── workers/         # 多线程：worker-pool（Blob Worker，Aho-Corasick）
    │   ├── presentation/        # 旧弹窗 UI（DOM/jQuery）
    │   └── presentation-v2/     # v2 UI（Vue 3 + Pinia）
    ├── tests/           # vitest 单元/集成测试（~290 文件）
    └── docs/            # TESTING.md（运行时测试清单）
```

## 从旧版迁移

- 旧聊天中的 V1 表格数据会在加载时自动迁移为 V2 帧格式（保留既有迁移逻辑）。
- 旧设置字段（`storageMode: 'native'` 等）会被忽略（恒为 SQLite）。
- 智能续写配置（`loopSettings.quickReplyContent` 等）不再使用，数据字段保留不破坏旧预设。

## 支持我

我一直在用 Opencode GO 的套餐游玩酒馆，如果你喜欢这个项目，欢迎通过我的 AFF 支持我 — 使用链接一起获得5美元的额外赠金：

[https://opencode.ai/go?ref=S2XBM2KR89](https://opencode.ai/go?ref=S2XBM2KR89)
