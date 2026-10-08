# 全库复审 · 第 10B 块：presentation-v2（除 composables）与 presentation-v3

审查方式：只读审查。结论分两种：「已坐实」指有探针复现或调用链完整追踪；「待坐实」指推断。探针都放在会话 scratchpad 的 `block10b/` 子目录，已从 `source/tests` 移走。`src/presentation-v2/composables/` 属第 10A 块，本报告只在追调用链时引用，问题根因落在 composable 的只作交叉引用。

## 覆盖范围

**通读**
- `src/presentation-v2/stores/` 全部：`visualizer-store.ts`、`content-replace-store.ts`、`plot-preset-store.ts`、`api-preset-store.ts`、`theme-store.ts`、`dialog-store.ts`、`toast-store.ts`、`router-store.ts`、`persistence.ts`、`appearance-store.ts`、`dev-options-store.ts`、`ui-mode-store.ts`、`root-shell-store.ts`、`content-replace-gate.ts`、`continuation-store.ts`。
- `src/presentation-v2/bootstrap/`（`index.ts`、`mount.ts`、`host-document.ts`、`host-env.ts`、`host-renderer.ts`、`menu-button.ts`）、`theme/theme-injector.ts`、`theme/appearance-injector.ts`、`surfaces/visualizer/open-visualizer-surface.ts`、`router/`、`build/sfc-style-runtime.ts`、`build/rollup-sfc-style-injector.js`、`continuation/pending-fix-cards.ts`、`material-completion-status.ts`。
- `src/presentation-v3/`：`App.vue`、`router/page-catalog.ts`、`composables/feature-gates.ts`、`shell/*`；全部 `pages/*`（`ContinuationPage.vue` 的设置/提示词/草稿逻辑逐行读）；`parts/` 中的 `PromptSegmentsSheet`、`PlotPresetSection`、`PlotPresetSheet`、`TableTemplateSection`、`DormantDataSection`、`ContinuationMaterials`（脚本部分）、`ContinuationChat`、`ContinuationSessionFeed`、`AgentAdvancedSheet`、`JsonDraftEditor`、`WorldbookEntries`、`UpdateSettingsSection`、`ApiPresetEditor`（脚本部分）；`surfaces/VisualizerSurface.vue`、`surfaces/visualizer/VizDataView.vue`、`data-layout.ts`；`ui/` 中的 `UbSheet`、`UbDialogHost`、`UbToastHost`、`UbPresetPicker`、`UbInput`、`UbButton`、`UbFileButton`、`UbRulePairs`、`UbPromptSegments`（脚本）、`UbSelect`、`file-helpers.ts`。

**部分精读或略读**
- `presentation-v2/copy/*`：只核对了引用关系与和已删功能相关的过时文案，没有逐条核对文案与行为是否一致。
- `theme/builtin-themes.ts`、`theme/theme-types.ts`：只核对了默认主题 id 与 token 键集合。
- `parts/` 中的 `PlotTaskEditor`、`TablePresetSheet`、`TablePicker`、`WorldbookSourcePicker`、`WorldbookTargetSelect`、`ApiPresetEditor` 模板部分；`surfaces/visualizer/` 的 `VizConfigView`、`VizAssistantView`、`VizManageView`、`VizTableNav`、`VizPlacement`；`ui/` 其余展示组件：只看了事件派发与 props 契约，没有逐个核对样式与可访问性。

**为追调用链读过的块外代码**：`composables/visualizer/useVisualizerSave.ts:148-213, 495-620`、`useVisualizerConfigEditing.ts:240-300`、`useVisualizerData.ts:159-180`、`useContinuationRuntime.ts:396-468`、`useDataManagement.ts:359-380, 596-735, 860-905`、`useSqliteRuntimeDiagnostic.ts`、`usePlotPresetManagement.ts:200-320`、`usePlotWorldbookAgentControl.ts:463-560, 626-630`、`useFormFillWorldbookEntries.ts:171-203`、`usePlotWorldbookEntries.ts:63-200`、`useAgentWorldbookEntries.ts:160-177`、`useChatChangedListener.ts`、`useUiCloseGuard.ts`、`useDashboardPage.ts:1039-1080`、`useVectorIndexConfig.ts:360-400`；`service/runtime/helpers-table-lock.ts:1-90, 182-290`、`service/visualizer/visualizer-data-ops.ts:90-190`、`service/settings/api-preset-service.ts:519-565`、`service/settings/settings-service.ts:415-445`、`service/continuation/continuation-orchestrator.ts:1101-1145`、`service/chat/chat-service.ts:2085-2125`、`service/chat/chat-database-purge.ts:409-430`、`service/table/table-checkpoint-transfer.ts:337-385`、`service/flight-mode/flight-mode-transition.ts:140-215`、`service/plot/plot-logic.ts:523-553`、`shared/sheet-identity.ts:335-375`、`entry-extension.ts:100-140`。

**整体印象**
- **挂载与外壳**比较干净：根 app 与 Pinia 只创建一次，主题/外观注入复用单个 `<style>` 节点，`useChatChangedListener` 只在 `App.vue` 注册一次且卸载时解绑；页面级 `watchChatChanged_ACU` 跟随组件作用域自动停止；菜单按钮的 MutationObserver、轮询、对话框倒计时、toast 计时器都有对应清理。没有发现重复挂载或监听泄漏。v3 全部模板没有 `v-html`，菜单按钮的 `innerHTML` 是常量。
- **切聊天守卫**在关键写回点基本到位：可视化编辑器草稿带 `draftContextKey`，续写页设置草稿带聊天身份，正文替换重新优化写回前比对聊天与楼层对象。
- **问题集中在「草稿生命周期」**：草稿被丢弃后又被无关操作提交（正文替换），草稿在保存在途期间被权威数据覆盖（续写设置），草稿与权威数据分叉后无基线校验地覆盖（续写大纲），草稿用下标而非身份记录（可视化锁），以及页面切换完全绕过关闭守卫。
- **作用域不一致**：世界书条目列表的「全选/全不选/Skill 全选」无视筛选词作用于全部条目；剧情推进预设库缺少 API 预设库早已具备的重名拦截。
- 数据管理页里有一整套「运行时忙碌」守卫和两块恢复诊断区块，在 v3 下都是死的。

---

## 统计

| 级别 | 数量 | 已坐实 | 待坐实 |
|---|---|---|---|
| P0 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 |
| P2 | 7 | 7 | 0 |
| P3 | 13 | 8 | 5 |

## 汇总表

| 编号 | 级别 | 状态 | 一句话 |
|---|---|---|---|
| R10B-01 | P2 | 已坐实 | 续写设置自动保存在途期间的新修改，会在保存完成刷新 `runtime.settings` 时被整份草稿重建冲掉 |
| R10B-02 | P2 | 已坐实 | 可视化编辑器的行/单元格/列锁草稿按下标记录，删行（删列）后不平移，保存时锁落到另一条 row_id 上，原本锁住的行失去保护 |
| R10B-03 | P2 | 已坐实 | 正文替换提示词编辑器「确认关闭」并不丢弃草稿，之后任意开关/数字/标签修改都会把这份已放弃的草稿写进设置并生效 |
| R10B-04 | P2 | 已坐实 | 剧情推进预设新建或重命名为已有名称时静默覆盖那个预设（重命名时原预设还保留），全局默认/聊天绑定也被改指过去 |
| R10B-05 | P2 | 已坐实 | 世界书条目列表的「全选/全不选/Skill 全选」无视筛选词，作用于全部世界书的全部条目并立即落盘；Skill 化会对全部条目发 AI 请求并写回 |
| R10B-06 | P2 | 已坐实 | 切页、切基础/高手模式、打开可视化编辑器都直接卸载当前页，绕过 `useUiCloseGuard`，API 预设表单与向量服务表单的未保存修改静默丢失 |
| R10B-07 | P2 | 已坐实 | 续写「已有资料」的大纲编辑器在 Agent 产出新 revision 后保留旧草稿，保存时无基线校验，直接覆盖 Agent 的新大纲 |
| R10B-08 | P3 | 已坐实 | 数据管理页的 `runtimeDiagnostic.busy` 在 v3 永远为 false：全部危险按钮的互斥/确认后复查都是空操作；另起 1Hz 轮询却不渲染；V2 恢复/隔离诊断区块不可达 |
| R10B-09 | P3 | 已坐实 | 删除本地数据的 `expectedPath` 在确认框之后才计算，service 侧「确认期间范围变化则中止」守卫形同虚设 |
| R10B-10 | P3 | 待坐实 | 仪表盘飞行模式开关没有在途锁，确认框可排队，连点可并发两次开启/关闭 |
| R10B-11 | P3 | 待坐实 | 输入对话框用 `@keyup.enter` 提交，中文输入法回车上屏时会提前提交半截输入 |
| R10B-12 | P3 | 已坐实 | 剧情推进/正文替换 store 忽略 `saveSettings_ACU` 的失败结果，照样返回成功并弹「已保存」 |
| R10B-13 | P3 | 已坐实 | 正文替换 store 只有一个 `busyAction` 槽，测试/重新优化/导入可并发且先结束者提前解锁按钮；从「自定义提示词」切到任一预设会无确认地丢弃自定义提示词 |
| R10B-14 | P3 | 已坐实 | 可视化数据视图删行按下标跨 await 确认框，确认期间外部刷新重载草稿会删掉另一行 |
| R10B-15 | P3 | 待坐实 | 保存进行中编辑控件不禁用：store 断言在事件处理器里抛错，输入被静默丢弃并记成 render error；`closeSurface` 在保存在途时也直接复位 `isSaving` |
| R10B-16 | P3 | 待坐实 | 主题 token 过滤只拦字面 `url(`，CSS 转义（`\75 rl(`）或 `image-set("…")` 可绕过，导入的主题文件能让界面加载外部资源 |
| R10B-17 | P3 | 已坐实 | 剧情推进页世界书条目刷新没有序号守卫，快速切换来源/勾选世界书时旧请求可覆盖新列表 |
| R10B-18 | P3 | 已坐实 | 下载/读文件工具三份重复实现且语义分叉：正文替换导出用当前 document 且同步 revoke，与 file-helpers 的 WebView2 兼容写法不一致 |
| R10B-19 | P3 | 已坐实 | 死代码与过时注释（sqlite 页可见性开关、退役 continuation-store、未引用 copy/工具函数/store 动作、指向已删 startup.ts 与油猴产物的注释等） |
| R10B-20 | P3 | 待坐实 | 路由的功能页开关只在仪表盘刷新时同步，其它途径改设置后侧栏入口可能长时间与设置不一致 |

---

## P2

**R10B-01 [P2 已坐实] 续写设置：自动保存在途期间的新修改会被保存完成后的草稿重建冲掉**
- 位置：
  - `src/presentation-v3/pages/ContinuationPage.vue:799-802`（800ms 防抖）、`:813-845`（`saveSettingsNow`，await `runtime.saveSettings`）
  - `:970-979`（`watch([runtimeSettingsIdentity, runtime.settings])`：持久化 JSON 一变就 `settingsDraft.value = cloneSettings(settings)`）
  - `:981-985`（草稿深度 watch 触发防抖保存）
  - `src/presentation-v2/composables/useContinuationRuntime.ts:396-414`（`saveSettings` 成功后 `refresh()`，`runtime.settings` 换成新对象）
- 现象/触发路径：
  1. 用户在设置或伪 Role 提示词里输入，停顿超过 800ms，自动保存开始，`runtime.saveSettings(candidate)` 进入 await（写首楼信封 + 保存聊天）。
  2. 保存在途期间用户继续输入，草稿 D2 包含新字符。
  3. 保存完成 → `refresh()` → `runtime.settings` 变成 candidate 的持久化结果 → 第 970 行的 watch 发现「持久化内容变了」，用它整份重建 `settingsDraft`。
  4. D2 里的新输入被覆盖；随后防抖到期时草稿已等于 `lastPersistedSettingsJson`，不会再保存。文本框内容跳回，最后几个字丢失。
  5. `runtime.busy` 为真时（其它续写操作在途）`saveSettingsNow` 会反复重排，只是推迟了同一结局。
- 证据：探针 `block10b/zz-review-probe-r10b-cont.test.ts`（基于现有 `continuation-page.test.ts` 的 mock 骨架）。第一次保存挂起期间把「故事总纲卷数」改成 `long`，放行保存后下拉框回到 `medium`，`saveSettings` 只被调用 1 次且没有任何一次携带 `long`。
- 修法方向：
  - 保存发起时记下 `submittedJson`；保存成功后，只有当前草稿仍等于 `submittedJson` 才用持久化结果重建草稿，否则只更新 `lastPersistedSettingsJson` 并保留草稿、立即再排一次保存。
  - 或者把「外部变更才重建」的判断改成比较 `persistedJson` 与「本页最后一次提交的 JSON」，自己的保存回声不触发重建。

**R10B-02 [P2 已坐实] 可视化编辑器锁草稿按下标记录，删行/删列后不平移，锁漂移到别的 row_id**
- 位置：
  - `src/presentation-v2/stores/visualizer-store.ts:427-437`（`deleteRow` 只 splice 内容，不动 `tableLockDrafts`）
  - `:481-532`（`getLockDraft` / `toggleRowLock` / `toggleCellLock`：`rows: number[]`、`cells: 'r:c'[]` 都是数据行下标）
  - `src/presentation-v3/surfaces/visualizer/VizDataView.vue:48, 214-232, 366-377`（锁按钮与删行都按 `row.index`）
  - 保存：`src/presentation-v2/composables/visualizer/useVisualizerSave.ts:202-213`（`saveLockDrafts` 用保存时的 `tempData` 把下标解析成身份）、`src/service/runtime/helpers-table-lock.ts:72-77, 235-286`
  - 同类：`useVisualizerConfigEditing.ts:269-299`（`deleteColumn` 同样不平移 `cols` 与 `cells`，第 10A 块）
- 现象/触发路径：
  1. 用户在编辑器里锁住第 3 行（row_id r3，下标 2），然后删除第 1 行。
  2. 草稿里锁仍是下标 2，此时 `content[3]` 已是 r4；界面上「整行已锁定」立刻显示在 r4 上，r3 显示为未锁。
  3. 保存时 `saveTableLocksForSheet_ACU` 按当前内容把下标 2 解析为 r4，持久化身份锁变成 r4；r3 的保护消失，之后的 AI 填表可以改写 r3。
  4. service 层已经专门把锁存储改成身份键来消除「插行/删行后锁漂移」（`helpers-table-lock.ts` 文件头注释），编辑器草稿又把漂移带回来了。
- 证据：探针 `block10b/zz-review-probe-r10b-lock-drift.test.ts`。四行表锁住下标 2 并锁单元格 `(2,0)`，`deleteRow(0)` 后草稿仍为 `[2]`；按保存路径调用 `saveTableLocksForSheet_ACU` 后持久化结果为 `rowIds: ['r4']`、`cells: [['r4','名字']]`。
- 修法方向：
  - 草稿改存身份（row_id / 列名），与 service 存储模型一致；渲染时再按当前内容解析成下标。
  - 最小修：`deleteRow` 删除目标下标的行锁与该行的单元格锁，并把大于目标的下标减一；`deleteColumn` 同理处理 `cols` 与 `cells` 的列部分。

**R10B-03 [P2 已坐实] 正文替换：已在编辑器里「确认关闭」的提示词草稿，会被之后任意设置修改写进设置**
- 位置：
  - `src/presentation-v2/stores/content-replace-store.ts:385-406`（`saveToSettings` 每次都写 `cfg.promptGroup = normalizePromptGroup(this.promptGroup)`）
  - `:407-425`（`setBoolean` / `setString`（`apiPreset`、`extractTags`、`excludeTags`）/ `setNumber` 都走 `saveToSettings`）
  - `:446-456`（编辑器的增删改只改 store 草稿并置 `promptDirty`）
  - `src/presentation-v3/pages/ContentReplacePage.vue:295-298`（`closePromptSheet` 只隐藏面板）
  - `src/presentation-v3/parts/PromptSegmentsSheet.vue:88-100`（确认文案「确定要关闭吗？」，确认后只 emit `close`）
- 现象/触发路径：
  1. 用户打开「编辑正文替换提示词」，改了几段（或点了「载入默认提示词」，提示文案写着「保存后才会生效」），然后点关闭并确认放弃。
  2. 面板关了，store 里的草稿和 `promptDirty=true` 原样保留，页面徽章显示「已自定义提示词」。
  3. 用户随后切一下「显示优化对比」、改最小长度或改提取标签，`saveToSettings` 把这份已放弃的草稿写进 `contentOptimizationSettings.promptGroup` 并 `saveSettings_ACU`，之后的自动正文替换用的就是它。
  4. 被写入的可能是缺少 `$CONTENT` 的半成品，正文替换随即失效；如果是在编辑某个预设时放弃，当前提示词会变成与预设不一致的「自定义提示词」。
  5. 填表页、交火页的同类面板也不清草稿，但它们的 composable 按字段落盘，不会被其它开关顺带提交（已核对 `useVectorIndexConfig.ts:360-400`）。正文替换 store 是唯一把整份草稿一起写回的地方。
- 证据：探针 `block10b/zz-review-probe-r10b-cr.test.ts`。`updatePromptSegment(0, …)` 后直接 `setBoolean('showDiff', false)`，设置里的 `promptGroup[0].content` 变成草稿内容，`promptDirty` 被清成 false。
- 修法方向：
  - `saveToSettings` 拆成「基础字段保存」与「提示词保存」，开关/数字/标签只写各自字段；`promptGroup` 只在 `savePromptGroup*` / 预设切换时写。
  - 面板确认关闭时调用 store 的 `discardPromptDraft()`（从 settings 重新载入 `promptGroup`、清 `promptDirty`）。

**R10B-04 [P2 已坐实] 剧情推进预设：新建或重命名撞上已有名称时静默覆盖那个预设**
- 位置：
  - `src/presentation-v2/stores/plot-preset-store.ts:285-330`（`savePreset`：`idxByNew >= 0` 时直接 `list[idxByNew] = normalized`，第 297 行的「真重命名」分支要求 `idxByNew < 0`）
  - `:308-319`（`oldName !== newName` 时把 `lastUsedPresetName` 与当前聊天绑定从旧名改指新名）
  - `src/presentation-v2/composables/usePlotPresetManagement.ts:252-264, 278-296`（`validate` 只查空名与任务数）
  - 对照：`src/service/settings/api-preset-service.ts:527-535` 对同样场景拒绝覆盖，注释写明是为了避免静默销毁已有预设
  - `:362-394`（`importPresetFromJson` 同名直接覆盖；若被覆盖的正是当前生效预设且不是导入的第一个，运行时 `plotSettings` 不会重新应用）
- 现象/触发路径：
  1. 编辑预设 A，把名字改成已存在的 B 并保存 → B 的内容被 A 的内容覆盖，A 仍在列表里；全局默认若是 A，会改指 B；当前聊天绑定 A 的也改指 B。用户原来的 B 永久丢失。
  2. 「从默认新建」后把名字改成已有的 B 保存 → B 被默认内容覆盖。
  3. 两种情况都 toast「剧情推进预设已保存。」。
- 证据：探针 `block10b/zz-review-probe-r10b-plot.test.ts`（基于现有 `plot-preset-store.test.ts` 的 mock）。用例一：A(`记忆召回`,任务 t1) 重命名为 B(`低速推进`,任务 t2) 后列表为 `['记忆召回:t1','低速推进:t1']`，`lastUsedPresetName` 变为 `低速推进`；用例二：新建同名 B 后 B 的任务变成新建内容。
- 修法方向：在 store（或 service）里与 API 预设一致：新名已存在且不是 `originalName` 时返回失败并给出「名称已存在」；导入遇到同名时先确认，覆盖到当前生效预设时同步应用到运行时。

**R10B-05 [P2 已坐实] 世界书条目列表的批量选择按钮无视筛选词**
- 位置：
  - `src/presentation-v3/parts/WorldbookEntries.vue:3-22`（筛选框与「全选/全不选/Skill 全选/Skill 全不选/对所选 Skill 化」在同一工具栏）、`:178-188`（筛选只作用于渲染的 `filteredGroups`）
  - 事件不带筛选范围：`TablePage.vue:28-29`、`PlotPage.vue:49-50`、`AgentPage.vue:77-79`
  - 实现：`useFormFillWorldbookEntries.ts:171-203`、`usePlotWorldbookEntries.ts:176-200`（遍历全部 `groups` 写 `enabledEntries` 并 `saveSettings_ACU`）、`useAgentWorldbookEntries.ts:160-173`
- 现象/触发路径：
  1. 填表页或剧情推进页，用户搜索「角色」后点「全不选」，本意是取消这几条；实际所有世界书的所有条目选择被清空并立即落盘，无撤销。点「全选」同理会勾上筛选外、用户刻意排除的条目。
  2. Agent 页搜索后点「Skill 全选」再点「对所选 Skill 化」，选中的是当前范围内全部可 Skill 化条目；确认框只有通用文案、不显示条数。确认后会对全部条目逐条调用 Skill API，并把 Skill 元数据写进世界书条目（已有元数据的跳过）。
- 证据：调用链如上，按钮 emit 不带参数，三个 composable 的实现都遍历全部 `groups.value`。
- 修法方向：
  - `WorldbookEntries` 在有筛选词时把 `filteredGroups` 里的 `(bookName, uid)` 集合随事件发出，composable 只改这些条目；或在筛选激活时把按钮文案改成「全选筛选结果」并据此实现。
  - Skill 化确认框显示将处理的条目数。

**R10B-06 [P2 已坐实] 页面切换绕过关闭守卫，表单内未保存的修改静默丢失**
- 位置：
  - `src/presentation-v3/shell/NavList.vue:50-53`（`go` 直接 `router.setActivePage`）
  - `src/presentation-v3/App.vue:49-53`（页面 `:key` 含 `activePageId`，切页即卸载）、`:5-6`（可视化编辑器激活时 `v-else` 整个外壳卸载）、`:146-150`（切基础/高手模式 → `ensureActiveVisible`）、`:152-163`（只有关闭 UI 走 `canCloseUi`）
  - `src/presentation-v2/composables/useUiCloseGuard.ts`（守卫只被 `closeApp` 消费）
  - 受影响的页内草稿：`src/presentation-v3/parts/ApiPresetEditor.vue:246-255`（`draft` 是组件内 reactive，`:380-388` 只注册了关闭守卫）；`src/presentation-v3/pages/VectorIndexPage.vue:30-74`（向量服务表单，需点「保存向量服务」）；`TableTemplateSection.vue:95-104`（在基础配置页点「打开可视化表格编辑器」会卸载同页的 API 表单）
- 现象/触发路径：用户在 API 页改了 URL / 密钥 / 模型（底栏显示「有未保存的修改」），然后点侧栏其它页、或切到基础模式、或在基础配置页点「打开可视化表格编辑器」 → 组件卸载，修改丢失，没有任何提示。同样的修改在点右上角关闭时会弹「你有未保存的 API 修改」确认。
- 证据：调用链如上；`canCloseUi` 在全库只有 `App.vue:153` 一处调用。续写页自己在 `onBeforeUnmount` 冲刷防抖保存（`ContinuationPage.vue:944-952`），说明卸载丢草稿是已知风险，但其它页没有处理。
- 修法方向：在 router store 的 `setActivePage` / `ensureActiveVisible` 与打开可视化编辑器的入口前统一跑一遍守卫（例如新增 `canLeavePage()`，复用同一个 guard 集合）；被拒绝时不切换。

**R10B-07 [P2 已坐实] 续写大纲编辑器：草稿与权威 revision 分叉后，保存直接覆盖 Agent 的新大纲**
- 位置：
  - `src/presentation-v3/parts/ContinuationMaterials.vue:622-647`（`syncOutlineDraft` / `saveOutline` 只发出大纲内容）、`:669-672`（revision 变化时，草稿 dirty 就不同步，也不提示）
  - `src/presentation-v2/composables/useContinuationRuntime.ts:466-468`（`saveActiveOutline` 只传 `{ outline }`）
  - `src/service/continuation/continuation-orchestrator.ts:1101-1116`（`replaceActiveOutline` 只拒绝运行中任务，不校验调用方基于哪个 revision）
- 现象/触发路径：
  1. 任务运行中，用户在「阶段大纲」的原始 JSON 里开始改（草稿基于 revision N）。
  2. Agent 重新规划，产出 revision N+1；上方只读大纲随之更新，下方编辑器因 dirty 保留 N 的草稿，没有任何「底稿已过期」提示。
  3. 任务暂停/停止后用户点「保存大纲」→ 以 N 为底的内容替换掉 N+1，Agent 的重规划静默丢失。
- 证据：调用链如上，UI 与 service 都没有 base revision 参与比较。
- 修法方向：编辑开始时记录 `baseRevision`；revision 变化且草稿 dirty 时标记「底稿已过期」并禁用保存（参照 `AgentAdvancedSheet.vue:218-227` 的 `promptDraftStale` 做法），或把 `expectedRevision` 传给 `replaceActiveOutline` 由 service fail-closed。

---

## P3

**R10B-08 [P3 已坐实] 数据管理页：运行时忙碌守卫恒为假、无用轮询、两块诊断区块不可达**
- 位置：`src/presentation-v3/pages/DataMgmtPage.vue:27-44, 90, 113-140, 191-206`；`src/presentation-v2/composables/useSqliteRuntimeDiagnostic.ts:33, 44-66, 68-77`；`DataMgmtPage.vue:47-80`；`useDataManagement.ts:578-620`。
- `busy` 只在 `reload()` 里置真，而 v3 没有任何入口调用 `reload`、也不渲染健康快照。结果：
  - 「删除所有本地数据」「恢复默认配置」「提交合并候选」「应用 Checkpoint 修复」只在自己的 action 在途时禁用，彼此不互斥（例如恢复 Checkpoint 在途时仍能点删除）。注释「每次危险操作在确认框关闭后再查一次运行时忙碌」对应的 `runtimeBusy()` 恒返回 false。service 侧 `runTableWriteTransaction_ACU`（exclusive）会串行化大部分写入，因此记为 P3。
  - 页面挂着一个 1 秒一次的 `getStorageRuntimeHealth_ACU()` 轮询，结果不渲染；可见性门控用的是当前 `document` 而不是 host document，扩展跑在 iframe 时门控失效，UI 关着也一直轮询。
  - `v2RecoverySummary` / `v2IsolationDiagnostics` 只由 `prepareV2Recovery` / `scanV2IsolationDiagnostics` 赋值，v3 没有调用入口，对应两个区块永远不出现；隔离诊断文案里的「请诊断 V2 数据恢复」也无处可点。
- 修法方向：互斥条件改用 `busy`（含 `flow.busyAction`），确认后复查同一条件；删除 `useSqliteRuntimeDiagnostic` 的引入或补回诊断 UI；恢复诊断要么补「诊断」按钮，要么删掉区块。

**R10B-09 [P3 已坐实] 删除本地数据的「确认期间范围变化」守卫形同虚设**
- 位置：`DataMgmtPage.vue:257`（确认前算 `path`，只用于选文案）、`:271, 285, 311`（确认后调用 `flow.deleteLocalData('all')`）；`useDataManagement.ts:870-873`（`expectedPath` 在此刻重新计算）；`service/chat/chat-service.ts:2110-2120`。
- service 用 `expectedPath !== path` 检测「确认期间范围变化」，但 UI 传入的 `expectedPath` 是确认之后与 service 同一时刻算的，二者永远相等。若确认期间 AI 楼层数下降（宿主侧删楼等），用户只确认过一次的「按范围删除」会变成两级确认才允许的硬清空。
- 修法方向：页面把确认前的 `path` 作为参数传给 `deleteLocalData`，composable 透传给 service。

**R10B-10 [P3 待坐实] 飞行模式开关没有在途锁**
- 位置：`src/presentation-v3/pages/DashboardPage.vue:118-164`；`useDashboardPage.ts:1039-1056`。
- `setFlightMode` 是长 await（模板提交 + 状态写入），开关在此期间仍可点；关闭方向的确认框可排队，连点两次再连续确认会并发两次 `disableFlightMode_ACU`。开启方向第二次通常会以 `big_summary_sheet_key_conflict` 失败并弹错误 toast。
- 修法方向：页面持有 `flightModeBusy`，在途时禁用该开关并忽略重复事件。

**R10B-11 [P3 待坐实] 输入对话框在中文输入法回车时提前提交**
- 位置：`src/presentation-v3/ui/UbDialogHost.vue:24-31`（`@keyup.enter="dialog.submitActive()"`）。
- 回车上屏时，keyup 阶段 `isComposing` 已为 false，对话框会在用户还没打完时提交。受影响的有新增表格、新增列、重命名预设、全局模板命名等 prompt。
- 修法方向：改为 `@keydown.enter`，并在 `event.isComposing || event.keyCode === 229` 时忽略。

**R10B-12 [P3 已坐实] store 忽略设置保存失败仍报成功**
- 位置：`plot-preset-store.ts:205, 216, 231, 327, 347, 358, 391`；`content-replace-store.ts:241-243`（`persist` 丢弃返回值）及 `savePromptGroup` / `savePreset` 等的成功 toast。
- `saveSettings_ACU` 可能返回 `{ saved: false, code: 'storage_error' }`，这些动作仍返回 true 并提示「已保存」。对照 `api-preset-store` 通过 service 的事务结果传播失败。
- 修法方向：检查 `saved`，失败时提示并（必要时）回滚内存。

**R10B-13 [P3 已坐实] 正文替换 store 的忙碌状态与预设切换**
- 位置：`content-replace-store.ts:584-590, 594-621, 629-647, 664-692`；`ContentReplacePage.vue:37-39, 55-63, 118`；`:486-504`（`selectPreset`）。
- `busyAction` 只有一个槽：「执行优化测试」在途时还能点「重新优化最近一次」或导入，后启动者覆盖槽位，先结束者把槽清空，按钮提前解锁，可重复提交。
- 当前是未存为预设的「自定义提示词」时，在选择器里点任一预设或「默认预设」会立即覆盖并保存，自定义提示词无确认地永久丢失。
- 修法方向：在途时统一禁用相关按钮（或按动作分别计数）；从自定义提示词切走前确认，或提示先「另存为预设」。

**R10B-14 [P3 已坐实] 可视化数据视图删行按下标跨确认框**
- 位置：`src/presentation-v3/surfaces/visualizer/VizDataView.vue:366-377`；`VisualizerSurface.vue:322-325`；`visualizer-store.ts:594-624`。
- 点删除时只记下标，await 确认框期间若后台填表提交触发外部刷新（草稿干净时会重载），确认后删掉的是重载后该下标处的另一行，保存后删错 row_id。
- 修法方向：点击时捕获 row_id，确认后按 row_id 查回下标再删；找不到则放弃。

**R10B-15 [P3 待坐实] 保存进行中仍可编辑，store 断言抛错被当作渲染错误**
- 位置：`visualizer-data-ops.ts:100-108`（`isSaving` 时抛错）；`VizDataView.vue:293-297`、`VizManageView` / `VisualizerSurface.vue:78-85` 的移动/删除等事件直接调 store；`mount.ts:44-58`（`errorHandler` 记成 `[ACU-V2] render error`）；`visualizer-store.ts:633-664`（`closeSurface` 复位 `isSaving`）。
- 保存期间编辑控件不禁用，输入事件里 `updateCell` 抛错，文本框显示的字符没有进入草稿，用户无提示；运行日志多一条误导性的 render error。关闭守卫选「丢弃草稿」会在保存在途时把 `isSaving` 复位，在途保存的收尾（`replaceVisualizerTemporaryRowIds_ACU`、`markSaved`）随后作用到已关闭或重新载入的 store 上。
- 修法方向：保存期间禁用数据/结构/管理视图的编辑控件与关闭按钮；保存流程持有会话 token，收尾前比对 `openTick`/`draftContextKey`。

**R10B-16 [P3 待坐实] 主题 token 过滤可被 CSS 转义绕过**
- 位置：`src/presentation-v2/stores/theme-store.ts:114-122`；`theme/theme-injector.ts:15-20`；`App.vue:253-260`（`--ub-bg` 等 token 进入 `background`）。
- 过滤只拦字面 `url\s*\(`。按 CSS 语法，带转义的 `\75 rl(…)` 仍会被解析为 url token，`image-set("https://…")` 的字符串也会被当作图片地址。别人分享的主题文件因此能让界面请求外部资源（泄漏 IP/在线状态）。没有在浏览器里实测。
- 修法方向：token 值改为白名单（颜色函数、`color-mix`、`var()`、数字/长度、`rgba` 等），或禁止 `\`、引号和 `image-set` / `src(`。

**R10B-17 [P3 已坐实] 剧情推进页世界书条目刷新缺少序号守卫**
- 位置：`src/presentation-v3/pages/PlotPage.vue:103-123`；对照 `TablePage.vue:214-232` 的 `entriesRefreshSeq`；`usePlotWorldbookEntries.ts:63-80` 内部也没有守卫。
- 快速切换来源或连续勾选世界书时，较慢的旧请求晚到会覆盖新列表，列表与当前选择不一致。
- 修法方向：照搬 TablePage 的序号守卫，或放进 composable。

**R10B-18 [P3 已坐实] 下载/读文件工具重复实现且语义分叉**
- 位置：`content-replace-store.ts:245-265`（用当前 `document`，`click()` 后同步 `revokeObjectURL`）；`PlotPresetSection.vue:154-171`（内联一份）；`src/presentation-v3/ui/file-helpers.ts:6-33`（host document + 延迟 1s revoke，注释说明是为了兼容 WebView2）。
- 正文替换的预设导出在 WebView2 宿主下可能因为同步 revoke 而下载失败，扩展跑在 iframe 时下载节点也挂错 document。
- 另：续写资料模块名称有三份映射（`pending-fix-cards.ts:4-11`、`ContinuationMaterials.vue:454-457`、`CONTINUATION_MATERIAL_MODULE_LABELS_ACU`），同一模块显示为「信息差」/「认知与信息差」、「故事年代学」/「故事年代学账本」。
- 修法方向：统一用 `file-helpers.ts`；模块标签收敛到一处。

**R10B-19 [P3 已坐实] 死代码与过时注释**
- 死代码（生产代码无引用）：
  - `router-store.ts:39, 63-65, 89, 144-147` 与 `page-types.ts:23`：`isSqliteMode` 恒为 true、`setSqliteMode` 无调用、`requiresSqlite` 无页面使用。
  - `stores/continuation-store.ts` 整个文件（只剩一个抛错的退役函数，只有测试引用）。
  - `copy/shared-copy.ts` 整个文件；`copy/data-mgmt-copy.ts` 的 `isolation` 与 `backup.description`（v3 只用 `cleanup` 与 `backup.sqliteRuntime`）。
  - `content-replace-store.ts:70, 505-537, 575-577`：`presetNameDraft`、`savePreset()`、`deletePreset()`、`exportSelectedPreset()`（v3 页面改用按名操作）。
  - `plot-preset-store.ts:229-233, 353-359`：`clearChatOverride`、`resetCurrentToDefaults`。
  - `visualizer-store.ts:372-374`：`selectGlobalConfig`。
  - `bootstrap/host-env.ts:41-48`：`acuGetComputedStyle`、`acuMatchesMedia`。
  - `material-completion-status.ts:44-53`：`resolveMaterialLoadError_ACU`。
  - `root-shell-store.ts` 的 `mountCount` 只增不读。
  - `useDataManagement` 返回的 `applyIsolation` / `removeHistory` / `deleteCurrentIsolationEntries` / `importCombinedSettings` / `overrideLatestLayerWithTemplate` / `prepareV2Recovery` / `scanV2IsolationDiagnostics` 在 v3 无入口（属第 10A 块，这里只记录 v3 侧不可达）。
- 过时注释：
  - `bootstrap/menu-button.ts:4` 指向不存在的「startup.ts 中的旧菜单按钮」；`bootstrap/index.ts:4-5` 列出已不存在的 `src/index.ts`、`entry-extension-plus-assistantembedded.ts`。
  - `build/rollup-sfc-style-injector.js:7` 仍写「油猴 IIFE」产物。
  - `stores/persistence.ts:8` 写「阶段 0 仅覆盖 theme + router」，实际已有 uiMode / appearance / devOptions。
  - `content-replace-gate.ts:11-13`、`plot-preset-store.ts:361` 仍以「旧 UI」为现存对象描述。

**R10B-20 [P3 待坐实] 功能页开关只在仪表盘刷新时同步**
- 位置：`router-store.ts:54-61, 148-158`；`presentation-v3/composables/feature-gates.ts`；唯一调用方 `DashboardPage.vue:103-105`。
- router store 创建时读一次设置，之后只有仪表盘 `refreshAll` 调 `syncFeaturePageGates_UB`。导入合并设置、恢复默认、续写页自身开关等其它途径改设置后，侧栏入口要等回到仪表盘才更新；入口被隐藏时当前页也不会被 `ensureActiveVisible` 收回。
- 修法方向：在 `useChatChangedListener` 的延迟刷新和设置导入/重置成功后统一调用一次 gate 同步，或让 gate 直接 computed 自设置（需要设置变更信号）。

---

## 已核对、判定为非问题（供后续复审参考）

- **挂载与生命周期**：`mount.ts` 只在首次打开创建 app/Pinia，后续开关只切 display；`entry-extension.ts` 的实例互斥保证 `bootstrapAcuV2` 只跑一次。`themeStore.$subscribe` / `appearanceStore.$subscribe` 各注册一次。`useChatChangedListener` 只在 `App.vue` 注册，`onBeforeUnmount` 解绑并清两个计时器。菜单按钮的 Observer 在安装成功或放弃时断开，短轮询有上限。`UbSheet` / `UbDialogHost` 卸载时清 leave 计时器；dialog 倒计时 interval 在切换/取消时清；toast 计时器在 dismiss/prune/clear 时清；可视化外部刷新合并计时器在 `closeSurface` 清。续写页倒计时按需启停并在卸载时停。
- **XSS**：v3 全部 SFC 没有 `v-html`；`menu-button.ts:208` 的 `innerHTML` 是常量；`host-renderer.ts` 的 `insertStaticContent` 只处理编译期静态模板。`showAcuV2Toast_ACU` 回退宿主 toastr 时文本来自插件固定文案（`init.ts:262`、`storage-frame-v2-replay.ts:3445`）。
- **可视化编辑器草稿隔离**：`loadSnapshot` 深拷贝运行时数据，编辑只改 `tempData`；`refreshSpecialIndexDraft` 只改草稿；保存按 row_id 增量提交并核对 `draftContextKey`（切聊天后 `invalidateDraftContext` 使保存 fail-closed）；外部刷新在草稿脏时只记冲突。
- **数据视图分页**：`pageWindow` 截断合法，`row.index = win.start + offset` 是全表下标，锁/编辑/删除在分页下不错位（错位问题只在 R10B-02 / R10B-14 的跨变更场景）。
- **正文替换重新优化**：写回前比对聊天数组、聊天 id、楼层对象与 `message_id`（与第 8 块结论一致）。
- **续写页切聊天**：`ensureCurrentDraftChat` 与 `saveSettingsNow` 的前后身份比对、`settingsIdentity` 与 `settings` 联合 watch，防止 A 聊天的迟到结果重建 B 的草稿；卸载时冲刷防抖保存。
- **剧情推进任务级 API 覆盖**：编辑器里改任务 API 立即按 taskId 全局保存、不随预设草稿丢弃，`PlotTaskEditor.vue:107` 已写明「全局保存，不写入预设」，属设计。
- **Agent 高级设置**：提示词草稿在底层变化且已脏时锁定保存（`promptDraftStale`），确认关闭会重置草稿，是本块里草稿处理的正确范例。
- **API 预设编辑器**：切换预设前对脏草稿确认；保存走 service 事务、重名被 service 拒绝（错误文案被 store 吞成「预设保存失败。」，体验问题，未单列）。
- **危险操作确认**：Checkpoint 导入、硬清空（两级）、按表删除、混合存储提交、V2 恢复、恢复默认、删除各类预设、删表/删列/删行、删主题、Agent 恢复/Skill 化/清除 Skill 元数据都有确认框；`UbButton` 的 `busy` 会同时禁用按钮。
- **store 与 service 的共享对象**：`api-preset-store`、`plot-preset-store`、`content-replace-store` 读设置时都 `clone`，写回时用归一化后的新对象，没有发现 UI 原地改写 `settings_ACU` 嵌套对象后漏保存的情况。

## 探针（scratchpad，已从 `source/tests` 移走）

目录：`C:\Users\zouyu\AppData\Local\Temp\claude\C--Users-zouyu-Downloads--------shujuku-rebuild\6f204fcf-f837-4e7c-9427-27ef9dd3e747\scratchpad\block10b`

| 文件 | 原放置位置 | 覆盖 | 结果 |
|---|---|---|---|
| `zz-review-probe-r10b-cont.test.ts` | `source/tests/presentation-v3/` | R10B-01 | 1/1 通过（复现） |
| `zz-review-probe-r10b-lock-drift.test.ts` | `source/tests/` | R10B-02 | 1/1 通过（复现） |
| `zz-review-probe-r10b-cr.test.ts` | `source/tests/presentation-v2/content-replace/` | R10B-03 | 1/1 通过（复现） |
| `zz-review-probe-r10b-plot.test.ts` | `source/tests/presentation-v2/plot/` | R10B-04 | 2/2 通过（复现） |

运行方式：把文件放回「原放置位置」一列的目录（import 路径以该目录为基准），在 `source/` 下执行 `npx vitest run <路径>`。
