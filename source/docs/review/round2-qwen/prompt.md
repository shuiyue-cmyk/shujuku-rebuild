# 任务：UnbirthDB 全库只读代码复审（协调者 + 并发子代理）

你是这次复审的**协调者**。

- **你自己不逐行审代码。**按第三节的分组，每组派一个子代理，**全部同时派出**（并发上限不够时，派不下的排队，前面的做完再接着派）。
- 子代理是冷启动的，看不到这份文档。所以派每个子代理时，提示里都要包含：**第二节「共同规则」全文（原样转发，不要删减）**，加上**该组在第三节的那一行范围和重点**。
- 全部子代理完成后，你按第四节合并结果。

这份报告会由另一位工程师逐条核查。没有证据的条目、编造的行号、把设计取舍当缺陷的条目，都会被直接判为误报。**宁可少报，不要凑数。**

---

## 一、对协调者自己的约束

- 第二节 2.1 的硬性约束同样适用于你。
- 不要为了「每组都有产出」而催子代理补条目。某组没有发现，就记「没有发现」。

---

## 二、共同规则（原样转发给每个子代理）

### 2.1 硬性约束（违反任何一条，你的报告作废）

1. **不改动仓库里任何已有文件**，不新建会被 git 跟踪的文件。唯一允许写的是你这一组的报告文件（见 2.8）。
2. **不执行任何 git 写操作**：commit / push / checkout / switch / stash / reset / restore / merge / rebase / clean 一律禁止。只读命令（log / diff / show / blame / grep）可以用。
3. 不运行 `npm install` 或 `npm run build`，不改 node_modules。
4. 需要写探针脚本验证时，放在仓库以外的临时目录，用完删掉；报告里写清探针做了什么、结果如何。
5. 看到疑似密钥、token 一类内容，不要原样抄进报告，用「某处有疑似密钥」代替。
6. 报告用简体中文，每条都写 `文件:行号`。

### 2.2 项目背景

- **是什么**：UnbirthDB，一个 TauriTavern（SillyTavern 的 Tauri 移植版）前端扩展。它在聊天消息里保存 SQL 表格数据（sql.js / SQLite），每轮 AI 回复后自动「填表」。此外还有剧情推进、决策召回、交火（向量召回）、智能续写、Agent 世界书 Skill 化、正文替换、可视化前端兼容等功能。用户基本都是无技术背景的角色扮演玩家。
- **目录**（仓库根目录就是含 `manifest.json` 的那一层）：
  - `source/src/`：全部源码，约 19.3 万行 ts / vue / js。入口是 `entry-extension.ts`。
    - `data/`：存储、sqlite、repositories、gateways、models
    - `service/`：业务层
    - `shared/`：常量、默认值、通用工具
    - `presentation/`：旧版 bootstrap、对外 API、主题、弹窗、toast
    - `presentation-v2/`：新版界面的逻辑层（pinia stores、composables、copy 文案）
    - `presentation-v3/`：新版界面的 Vue 组件（pages、parts、shell、ui）
  - `source/tests/`：vitest + jsdom，约 480 个测试文件。读测试是弄清「预期行为」最快的办法。
  - 根目录的 `index.js` 是打包产物，**不要审**。
- **命名约定**：大量函数和常量带 `_ACU` 后缀，这是历史前缀，不算问题。
- **可用命令**（在 `source/` 目录下执行）：
  - 类型检查：`npm run typecheck`
  - 单个测试：`npx vitest run tests/路径/xxx.test.ts`
  - 不要跑全量测试：耗时长，而且多个子代理同时跑会互相拖慢。

### 2.3 先读这些，避免重复劳动

1. `source/docs/CODE-REVIEW.md` 和 `source/docs/review/*.md`：2026-10-09 完成的上一轮全库复审（编号 R1-xx … R10B-xx），**列出的问题都已修复**。
   - 只需读和你这一组相关的部分。
   - 不要再报这些问题，除非你能证明修复不完整，或者后来的改动又把它弄坏了。这种情况请注明对应的原编号。
   - 标了「不修 / 保留 / 设计取舍」的条目是产品决定，不要再报。
2. `source/docs/UPSTREAM-DRIFT.md`：与上游扩展的差异记录，里面的取舍同样不算缺陷。
3. 上一轮复审之后有约 78 个提交、新增约 1.1 万行。用 `git log --oneline 2e83b108..HEAD -- <你这组的路径>` 和 `git diff 2e83b108 HEAD -- <路径>` 找出你这一组的新改动，**新改动优先读透**。

### 2.4 范围规则

- 你这一组负责的文件，以协调者给你的范围为准（路径都相对于 `source/src/`）。
- 为了弄清调用链，可以读其它组的文件。但**只报根因在你这一组文件里的问题**。
- 发现根因在别组文件里的疑点，不要展开查，写进报告的「跨组线索」一节，交给协调者处理。
- 时间不够时，宁可把新改动和高风险路径读透，也不要走马观花。报告里如实写明哪些读了、哪些没读。

### 2.5 要找什么

只记**有实际影响**的问题：

- 数据丢失、损坏，或被悄悄改写（表格数据、设置、世界书、聊天消息字段）
- 功能结果错误，或与界面文案 / 注释承诺的不一致
- 竞态与时序问题：切换聊天、手动终止（AbortSignal）、并发请求、重入、在途保存被覆盖、旧请求结果写进新状态
- 错误处理：吞掉异常导致静默失败、失败后仍提示成功、失败不回滚
- 资源泄漏：定时器、事件监听、AbortController、对象 URL 没有释放
- 安全：XSS（`innerHTML`、拼接 HTML、用户 / AI 内容进 DOM）、密钥进日志或报错文本、不受信内容被当成指令或 SQL 执行
- 边界值：空表、0 条、超长、非法数字输入、NaN、上下限钳制错误
- 重复实现之间的分叉：同一逻辑有多份拷贝，其中一份修了、另一份没修

**不要报**：

- 纯风格、命名、格式、注释措辞、「可以更优雅」
- 「建议补测试」，除非你能指出一段高风险逻辑完全没有覆盖，并说明具体会漏掉什么
- 性能猜测，除非你能给出量级（例如每次发送多出 N 次请求、O(n²) 在 n = 几千时卡多久）
- 2.6 列出的设计取舍

### 2.6 已知的设计取舍（不是缺陷，不要报）

- 存储键 `TavernDB_ACU_IsolatedData`、npm 包名 `shujuku-rebuild`、`__userscript_settings_v1` 和 `__userscripts` 都是刻意不改的。
- 版本号 `Unbirth A.D. 6386` 不是 semver，这是刻意的；工作区里 `manifest.json` 和 `source/package.json` 的未提交改动也是刻意留着的。
- `index.js` 每次打包哈希都不同（内嵌构建时间），这是正常的。
- vitest 全局 `testTimeout` 设为 60 秒，这是刻意的。
- 决策召回：
  - 自定义接口的 Key 可以留空（留空时不发 Authorization 头）。
  - 400 / 401 / 402 / 403 / 404 / 413 / 422 不重试，其中 401 / 402 / 403 / 404 会让其它组立即停止；请求超时也不重试。
  - 整次召回有总时限（90 秒 × 判定次数），到时未完成的组按失败处理，但整次结果仍算成功，照常带上固定保留的纪要。
  - 请求数与纪要条数成线性关系。
  - 替换剧情推进的 recall 任务后，不再保留时间召回的分组。
  - 只替换「启用任务数 ≥ 2，且标签恰好只有 `recall`」的任务。
- 本机没有真机环境，所以测试全是 jsdom 下的单元 / 集成测试，这一点本身不算问题。

如果你认为某条取舍本身会造成实际危害，可以写进报告的「设计层面的疑虑」，但不要计入缺陷编号。

### 2.7 证据要求（核查会逐条比对）

每一条发现必须满足：

1. **位置准确**：`文件:行号` 必须真实存在。行号以当前 HEAD 为准，写之前再打开文件确认一次。
2. **查过调用方**：用 grep 找出全部调用点，确认上游没有守卫或归一化已经挡住；报告里写明查了哪些。
3. **触发路径具体**：从用户能做的操作讲起（例如「在决策召回页把每组条数填成 0 后发送」），给出具体输入和错误结果。
4. **引用代码**：贴出能说明问题的关键代码，不超过 8 行。
5. **标明把握程度**：
   - 「已坐实」：跑过探针或测试，或者完整读穿了调用链，结果确定。
   - 「待坐实」：属于推演，写清楚还缺哪一步验证。
6. **说明测试情况**：现有哪个测试与它相关，为什么没能拦住。

严重度：

| 级别 | 含义 |
|---|---|
| P0 | 数据丢失或损坏，且常见路径就能触发 |
| P1 | 数据被悄悄改写，或功能结果错误，常见路径就能触发 |
| P2 | 边缘路径的缺陷、资源泄漏、可维护性上的重大隐患 |
| P3 | 清理项：死代码、分叉的重复实现、与代码不符的注释 |

### 2.8 输出

把你这一组的完整报告写进仓库根目录的 **`.analysis-qwen-review-Gxx.md`**（xx 是组号，例如 `G03`；这类文件名已被 gitignore，不会污染仓库）。如果你没有写文件的权限，就把完整报告作为最终回复返回，由协调者代为写入。

报告结构：

```
# G03 填表流水线与运行时

## 概览
- 结论：P0 x 条，P1 x 条，P2 x 条，P3 x 条（一句话总评）
- 读过的范围：按文件列出，标明「通读」或「抽读」
- 没读或没把握的范围
- 跑过的命令及结果

## 发现

### G03-01 [P1｜已坐实] 一句话标题，说清后果
- 位置：source/src/xxx/yyy.ts:120-135（涉及多处就全部列出）
- 触发：用户做什么、在什么条件下
- 现象：具体输入 → 错误结果
- 原因：解释并贴出关键代码（≤8 行）
- 已排除：查过哪些调用方和守卫，为什么挡不住
- 测试：相关测试文件，以及为什么没覆盖到
- 修法方向：一两句话
- 与上一轮复审的关系：新问题 / R?-?? 修复不完整 / R?-?? 回归

## 跨组线索
（根因疑似在别组文件里的点：写位置和一句话疑点）

## 设计层面的疑虑（不计入缺陷）

## 复核过但判定没问题的可疑点
（你怀疑过、查证后排除的点，写明排除理由，便于核查者避免重复查证）
```

按严重度从高到低排列，编号连续。写完后从头到尾自查一遍：每个行号都打开文件核对过，每条都写了触发路径和已排除项。做不到的，降为「待坐实」，或者直接删掉。

**返回给协调者的最终回复只需要简短一段**：各级别条数、每条的编号和标题、跨组线索列表。详细内容都在文件里。

---

## 三、分组（13 组，路径相对于 `source/src/`）

★ 表示上一轮复审后改动较多，优先级最高。

| 组 | 名称 | 负责范围 | 约行数 | 重点 |
|---|---|---|---|---|
| G01 ★ | 决策召回 · 剧情推进 · 正文替换 | `service/decision-recall/`、`service/plot/`、`service/runtime/plot-runtime/`、`service/optimization/`、`presentation/components/optimization-ui/`、`shared/decision-recall-defaults.ts`、`shared/decision-gate-defaults.ts`、`presentation-v2/stores/` 下的 `decision-recall-store.ts` `content-replace-store.ts` `content-replace-gate.ts` `plot-preset-store.ts`、`presentation-v2/composables/usePlot*.ts`、`presentation-v3/pages/` 下的 `DecisionRecallPage.vue` `PlotPage.vue` `ContentReplacePage.vue`、`presentation-v3/parts/Plot*.vue` | 1.35 万 | 决策召回是全新功能：并发、重试、总时限、中止、多次判定取平均、替换 recall 任务的匹配、设置钳制、界面与设置同步；正文替换的第二判定服务 |
| G02 ★ | AI 请求与 API 设置 | `service/ai/`、`service/settings/`、`service/flight-mode/`、`service/workers/`、`service/host/`、`service/loop/`、`service/summary/`、`presentation-v2/stores/api-preset-store.ts`、`presentation-v2/composables/` 下的 `useApiPreset*.ts` `saved-api-endpoints.ts` `client-header-presets.ts`、`presentation-v3/pages/ApiPage.vue`、`presentation-v3/parts/ApiPresetEditor.vue` | 1.0 万 | 经酒馆转接发送、Claude / Gemini 协议转换、思考强度字段、测试连接、后台请求标记、预设密钥与模型取值、错误信息里是否带出密钥 |
| G03 ★ | 填表流水线与运行时 | `service/table/` 下的 `update-orchestrator` `sql-table-service` `update-scheduler` `table-update-commit` `table-write-transaction` `table-fill-boundary-staging` `table-fill-staging-session` `table-fill-target-guard` `manual-catch-up-provisional-bridge` `manual-fill-planner` `auto-fill-echo-guard` `table-lock-enforcement` `table-delta` `table-service` `table-history` `sql-protocol-markers`（均为 .ts）；`service/runtime/` 根目录全部文件和 `service/runtime/template-vars/`；`presentation-v2/composables/` 下的 `useManualUpdate.ts` `useFormFill*.ts`；`presentation-v3/pages/FormFillPage.vue`、`presentation-v3/parts/UpdateSettingsSection.vue` | 2.5 万 | 重新生成 / 删楼 / 切换回复版本后的填表守卫，并发更新组，手动填表与一键追平，填表失败重试，表格锁 |
| G04 | 存储帧 · 回放 · 迁移 | `service/table/` 下除 G03 所列以外的全部文件（storage-frame-v2-*、storage-v2-migration、mixed-storage-*、table-v2-recovery-service、schema-migration-*、checkpoint 相关、runtime-only-*、table-import-service 等）、`shared/canonical-*.ts` | 1.7 万 | 写入期与回放期结果是否一致，V1→V2 迁移是否丢数据，恢复路径，模板切换 |
| G05 | 数据层 · 聊天 · 数据管理 | `data/`、`service/chat/`、`presentation-v2/composables/` 下的 `useDataManagement.ts` `useDormantData.ts` `useSqlConsole.ts`、`presentation-v3/pages/DataMgmtPage.vue`、`presentation-v3/parts/DormantDataSection.vue` | 1.6 万 | 存取往返是否改写数据，隔离槽，删楼 / 删聊天清理，SQL 控制台 |
| G06 | 智能续写编排 | `service/continuation/` 根目录全部文件、`presentation-v2/continuation/`、`presentation-v2/composables/useContinuation*.ts`、`presentation-v3/pages/ContinuationPage.vue`、`presentation-v3/parts/Continuation*.vue` | 1.15 万 | 宿主生成桥接、阶段游标、大纲、重试模式、中止与切聊天 |
| G07 | 续写 Agent 内核 | `service/continuation/agent/` | 1.86 万 | 主循环、子代理运行时、模块存储与事务、协议解析、占位符解析。`agent-default-prompts-*.ts` 这类提示词文本只看拼装和占位符是否出错，不审措辞 |
| G08 ★ | Agent · 世界书 | `service/agent/`、`service/worldbook/`、`presentation-v2/composables/` 下的 `useAgentWorldbookEntries.ts` `useFavoriteWorldbooks.ts` `useWorldbookSelector.ts` `worldbook-entry-*.ts`、`presentation-v3/pages/AgentPage.vue`、`presentation-v3/parts/` 下的 `AgentAdvancedSheet.vue` `Worldbook*.vue` | 1.15 万 | 常用世界书（新功能），删聊天 / 新开聊天后的 Skill 世界书清理，世界书写回是否覆盖他人条目 |
| G09 | 模板 · 改表助手 · 可视化 | `service/template/`、`service/template-assistant/`、`service/visualizer/`、`presentation-v2/composables/visualizer/`、`presentation-v2/composables/` 下的 `useTable*.ts` `useTemplate*.ts` `templateFollowGlobalFlow.ts` `template-destructive-confirm.ts`、`presentation-v2/stores/visualizer-store.ts`、`presentation-v2/surfaces/`、`presentation-v3/surfaces/`、`presentation-v3/pages/TablePage.vue`、`presentation-v3/parts/` 下的 `Table*.vue` `JsonDraftEditor.vue` | 2.0 万 | 模板预设切换与恢复，改表助手的结构 / 数据草稿应用，可视化编辑保存 |
| G10 | 向量 · 交火 | `service/vector/`、`presentation-v2/composables/useVector*.ts`、`presentation-v3/pages/VectorIndexPage.vue` | 1.35 万 | 纪要索引与召回门槛，向量文件清理与 GC，切聊天时的在途请求 |
| G11 | 共享层 | `shared/` 下除 G01、G04 所列以外的全部文件（含子目录） | 1.2 万 | 被全库依赖的工具函数：边界值、抛错语义、与调用方约定是否一致 |
| G12 | 旧版界面与对外 API | `presentation/`（除 `components/optimization-ui/`），以及仓库根目录 `src/presentation/` 下的 3 个文件（判断是否还被引用） | 1.1 万 | 对外 API 是否交出内部对象、弹窗与 toast 改动（`theme/host-dialog.ts`、`toast.ts`）、`bootstrap/init.ts` 启动流程、XSS |
| G13 ★ | 新版界面外壳 · 主题 · 通用组件 | `presentation-v2/` 和 `presentation-v3/` 下未被其它组认领的全部文件（bootstrap、build、router、theme、copy、其余 stores 和 composables、`App.vue`、shell、ui、其余 pages 和 parts） | 1.4 万 | Claude 界面风格（`shell/ClaudeStyle.vue`、`theme/host-claude-skin.ts`、`effective-theme.ts`），路由与功能开关，关闭守卫，主题 token 过滤 |

---

## 四、合并（协调者在全部子代理完成后执行）

1. **确认齐全**：13 个 `.analysis-qwen-review-Gxx.md` 都在。某组失败或超时，就重派一次；仍失败的，在总报告里写明该组没有完成。
2. **处理跨组线索**：逐条看各组的「跨组线索」。
   - 负责那个文件的组已经报了同一问题的，只记一笔「已由 Gxx-yy 覆盖」。
   - 没报的，派一个小子代理专门查证（同样带上第二节全文），结果写进 `.analysis-qwen-review-G14-cross.md`，编号用 `G14-xx`。
3. **去重**：不同组报了同一个根因的，在总表里只保留一条，注明重复的编号。
4. **抽查**：对每一条 P0、P1，你亲自打开文件核对两点：行号存在，引用的代码与实际一致。不一致的，在总表里标「行号或引文不符」，并降为「待坐实」。不要改动组报告的正文。
5. **写总报告**：写进仓库根目录的 **`.analysis-qwen-review.md`**，结构如下。详细内容留在各组文件里，总报告只放索引。

```
# Qwen 全库复审总报告

## 概览
- 总计：P0 x 条，P1 x 条，P2 x 条，P3 x 条（去重后）
- 各组完成情况：13 组逐行列出（完成 / 部分完成 / 失败），以及各自声明「没读」的范围

## 总表（按严重度从高到低）
| 编号 | 级别 | 把握 | 标题 | 位置 | 备注（重复 / 抽查结果） |

## 跨组线索处理结果

## 设计层面的疑虑汇总
```

6. 最后在对话里回复一段摘要：各级别条数，以及全部 P0、P1 的编号和标题。
