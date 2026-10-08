# 全库复审 · 第 10A 块：presentation-v2/composables（界面逻辑层）

审查方式：只读审查。结论分两种：「已坐实」指有探针复现或调用链完整追踪；「待坐实」指推断。探针都放在会话 scratchpad，已从 `source/tests` 移走。服务层（第 1–8 块）不再复审，只记录 composable 对它们的误用。

## 覆盖范围

**通读**
- `useManualUpdate.ts`、`useDataManagement.ts`、`useDashboardPage.ts`
- `visualizer/useVisualizerSave.ts`、`visualizer/useVisualizerData.ts`、`visualizer/useVisualizerConfigEditing.ts`、`visualizer/useVisualizerAssistant.ts`
- `useTableTemplatePresets.ts`、`useTablePresetManagement.ts`、`templateFollowGlobalFlow.ts`、`useTemplateRecoveryGuard.ts`
- `usePlotWorldbookAgentControl.ts`、`usePlotPresetManagement.ts`、`usePlotTaskEditing.ts`
- `useFormFillSettings.ts`、`useFormFillWorldbookEntries.ts`、`usePlotWorldbookEntries.ts`（与前者逐行 diff）、`useAgentWorldbookEntries.ts`、`useFormFillInjectionTarget.ts`、`useFormFillWorldbookConfig.ts`、`useWorldbookSelector.ts`
- `useVectorIndexConfig.ts`、`useVectorApiConfig.ts`
- `useContinuationRuntime.ts`、`useContinuationMaterials.ts`、`useContinuationSession.ts`
- `useSqlConsole.ts`、`useSqliteRuntimeDiagnostic.ts`、`useDormantData.ts`
- `useChatChangedListener.ts`、`useTemplateRuntimeChangeListener.ts`、`useUiCloseGuard.ts`、`useApiPresetStaleness.ts`、`useApiPresetManagement.ts`

**部分精读或略读**
- `useDebugPanel.ts`：精读了导出 payload 的脱敏和订阅清理；采集开关的模块级状态只核对了生命周期。
- `useLogViewer.ts`：只核对了订阅、rAF 清理和导出。
- `log-error-hints.ts`、`debug-issue-link.ts`、`client-header-presets.ts`、`worldbook-entry-display.ts`：纯映射或数据表，只扫了是否有副作用。
- `usePlotWorldbookConfig.ts`、`useApiPresetSelectOptions.ts`、`useDevOptions.ts`：略读。

**为追调用链读过的块外代码**
- 页面：`presentation-v3/pages/DataMgmtPage.vue`（全部 script）、`DashboardPage.vue:100-170`、`TablePage.vue:240-265`、`VectorIndexPage.vue:270-305`、`AdvancedToolsPage.vue:200-210`、`FormFillPage.vue:180-190`、`surfaces/VisualizerSurface.vue:100-120,290-330`、`parts/TableTemplateSection.vue`、`parts/ContinuationMaterials.vue:640-680`。
- store：`stores/dialog-store.ts`（队列与取消）、`stores/visualizer-store.ts:280-300,390-500,580-680`、`stores/plot-preset-store.ts:285-330`。
- 服务：`chat/chat-service.ts:1844-1870,2085-2126`、`settings/settings-service.ts:1256-1274`、`runtime/helpers-table-lock.ts:235-400`、`runtime/state-manager.ts:514-552`、`worldbook/pipeline.ts:1129-1190`、`worldbook/injection-engine-state.ts:236-308`、`worldbook/injection-engine-custom.ts:216-240`、`shared/host-compat/native-st-backend.ts:175-192`、`vector/vector-memory-config.ts:13-29,262-290`、`continuation/agent/agent-module-store.ts:1467-1512`、`flight-mode/flight-mode-transition.ts:190-330`、`template-assistant/service.ts:1944-1995`、`table/update-orchestrator.ts:5048-5130,5935-5960`、`visualizer/visualizer-source-revision.ts`、`visualizer/visualizer-data-ops.ts:100-200`、`presentation-v3/ui/file-helpers.ts`。

**整体印象**
- **切聊天守卫分布不均**。手动填表/追平、SQL 控制台、可视化器「保存数据/保存模板到当前聊天」、续写运行时、续写资料都在 await 前后复核聊天身份，做得扎实。问题集中在「页面弹确认框 → composable 执行」这条缝：`dialog-store` 不随切聊天取消弹窗，绝大多数危险操作（删除/硬清空/恢复 Checkpoint/模板破坏性确认/关闭飞行模式/恢复默认）在确认后直接对「当前聊天」执行，没有任何身份复核。数据删除路径甚至在确认后重算 `expectedPath`，把服务层专门为这一 TOCTOU 设计的守卫架空了（R10A-01）。
- **可视化器的保存分流有一个吞改动的口子**：「保存数据到当前消息」只在有行级增量时才拒绝混入模板变化；只有锁改动或删表时，它照样执行并用 `markSaved('data')` 把未提交的模板改动吸收进基线（R10A-02）。AI 改表助手产出的「加列并填值」草稿则两条保存路径都拒绝（R10A-05）。
- **几个 composable 绕开了服务层已有的安全写法**：Agent 世界书批量编辑直接用 gateway 整本读改写（R10A-07），向量 API 配置在校验前就改了活引用（R10A-08），续写资料编辑没有修订号比对（R10A-09）。
- **全局设置编辑缓冲被页面级 refresh 静默重置**（R10A-12），世界书条目勾选在读取失败时被当作「条目已不存在」清空并落盘（R10A-06）。
- 资源清理（订阅、计时器、rAF、scope dispose）整体到位，没有发现泄漏。
- 重复实现较多：两套模板预设 composable、两套世界书条目 composable、三份「破坏性确认 + stale 单次重试」、六份 `downloadJson`，其中五份没有采用仓内已知的 WebView2 兼容写法（R10A-13）。

---

## 统计

| 级别 | 数量 | 已坐实 | 待坐实 |
|---|---|---|---|
| P0 | 0 | 0 | 0 |
| P1 | 2 | 2 | 0 |
| P2 | 11 | 10 | 1 |
| P3 | 10 | 10 | 0 |

## 汇总表

| 编号 | 级别 | 状态 | 一句话 |
|---|---|---|---|
| R10A-01 | P1 | 已坐实 | 数据管理的删除/硬清空/恢复 Checkpoint 确认后不复核聊天身份；删除在确认后重算 `expectedPath`，服务层「确认期间范围变化」守卫失效，按范围删除可被升级为硬清空 |
| R10A-02 | P1 | 已坐实 | 可视化器「保存数据」在只有锁改动或删表时放行未提交的模板改动，并用 `markSaved('data')` 吸收进基线，模板改动静默丢失；删表只硬删数据、不提交模板删除 |
| R10A-03 | P2 | 已坐实 | 「保存模板到全局」在命名/覆盖确认弹窗之后不复核聊天，旧聊天的锁草稿写进新聊天的锁作用域，模板按新聊天应用 |
| R10A-04 | P2 | 已坐实 | 其余确认弹窗 TOCTOU：模板破坏性确认、跟随全局、关闭飞行模式、恢复默认、删除交火索引，确认后都作用于「此刻的当前聊天」 |
| R10A-05 | P2 | 已坐实 | AI 改表助手草稿同时含 schema 变更和行级增量（如「加一列并填值」）时，数据保存和模板保存都拒绝，只能丢弃 |
| R10A-06 | P2 | 已坐实 | 填表/剧情推进世界书条目勾选：某本书读取失败（服务层返回空数组）时，勾选被当作失效条目清空并落盘，恢复后也回不来 |
| R10A-07 | P2 | 已坐实 | Agent 世界书三个批量编辑直接用 gateway 整本读 → 改 → 整本写回，读写之间的并发修改被旧快照覆盖；单本失败被吞掉 |
| R10A-08 | P2 | 已坐实 | 向量 API 配置保存先改活引用再校验，校验失败时非法配置已在内存生效，下一次任意 `saveSettings_ACU` 就会落盘；保存结果也不检查 |
| R10A-09 | P2 | 已坐实 | 续写资料面板只在挂载/切聊天时读取，Agent 运行期间编辑并保存某模块，会用陈旧草稿整体覆盖 Agent 期间写入的条目（无修订号比对） |
| R10A-10 | P2 | 已坐实 | 剧情推进预设新建或改名时不检查重名，store 按新名覆盖另一个同名预设，改名时旧预设还会残留 |
| R10A-11 | P2 | 已坐实 | SQL 控制台 Ctrl+Enter 绕过忙碌态，按住或连按会重复执行写语句；提交后切聊天时提示「已拒绝执行」，实际已经提交 |
| R10A-12 | P2 | 已坐实 | 填表提示词、交火关键词提示词的未保存编辑在切聊天（以及保存向量 API）时被 `refresh()` 静默重置，关闭守卫也随之失效 |
| R10A-13 | P2 | 待坐实 | 五个 composable 的 JSON 下载在 click 后立即 revoke 且挂在当前 document，仓内已注明这会让 WebView2 取消下载；Checkpoint/恢复备份导出可能静默失败却提示成功 |
| R10A-14 | P3 | 已坐实 | 可视化器改表名时立即把表级 API 预设覆盖迁到新名并落盘，草稿丢弃后覆盖跟着丢；重名时会覆盖另一张表的设置 |
| R10A-15 | P3 | 已坐实 | 可视化器改列名不同步 `exportConfig.extraIndexColumns/Modes`，额外索引静默漏掉该列 |
| R10A-16 | P3 | 已坐实 | AI 改表助手切表/重载时只翻 `assistantIsRunning`，旧会话仍在飞；新旧会话并存时旧会话的 finally/catch 会改写新会话状态 |
| R10A-17 | P3 | 已坐实 | Skill 化的防重入只在入口检查，`busy` 在 refresh + 确认之后才置位，连点会排队两个确认并并发跑两批 |
| R10A-18 | P3 | 已坐实 | 硬清空收尾 `applyPurgeOutcome` 未 await：忙碌态提前解除，刷新异常变成未处理 rejection 且不提示 |
| R10A-19 | P3 | 已坐实 | 手动填表「终止」调用 `abortAllActiveRequests_ACU` 会连带中止剧情推进请求；确认框取消后 `refresh()` 也会清空用户填的额外要求 |
| R10A-20 | P3 | 已坐实 | 数据管理页的「V2 恢复诊断/隔离域诊断」分节已无入口可触发，而模板守卫和错误文案仍指引用户「去数据管理中诊断」 |
| R10A-21 | P3 | 已坐实 | 切换注入目标时旧书清理失败被吞掉仍提示「成功切换」；注入新目标失败变成未处理 rejection；世界书选择器的失败分支不可达 |
| R10A-22 | P3 | 已坐实 | 死代码：`saveCurrentDataToChat`、`useDataManagement` 的隐藏入口函数、`useTableTemplatePresets` 的三个全局预设操作与未用 import、`pushSavedMessage` 空函数等 |
| R10A-23 | P3 | 已坐实 | 重复实现与误导命名：两套模板预设/世界书条目 composable、三份破坏性确认重试、`ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU` 名不副实、剧情任务 id 用 `Date.now()` 等 |

---

## P1

**R10A-01 [P1 已坐实] 数据管理的删除/硬清空/恢复 Checkpoint 在确认后不复核聊天身份；删除路径在确认后重算 `expectedPath`，服务层守卫被架空**
- 位置：
  - `src/presentation-v3/pages/DataMgmtPage.vue:255-312`（`onDeleteLocalData`：`:257` 在弹框前算 `path` 只用来选文案，确认后调用 `flow.deleteLocalData('all')`，不传 `path`）
  - `src/presentation-v2/composables/useDataManagement.ts:870-886`（`deleteLocalData`：`:871` 在执行时重新调用 `resolveDeletionPath`，把结果作为 `expectedPath` 下传）
  - `src/service/chat/chat-service.ts:2110-2120`（服务层「预期路径与实际不一致即中止」的守卫，注释写明「删除范围在确认期间发生变化」）
  - `DataMgmtPage.vue:208-253` → `useDataManagement.ts:686-692`（恢复 Checkpoint：两个弹框之后直接对当前聊天执行，会「清空当前聊天全部 AI 楼层、所有隔离标识的本地表格数据」）
  - `src/presentation-v2/stores/dialog-store.ts:249-255`（弹窗排队，切聊天不取消）
  - `src/presentation-v2/composables/useChatChangedListener.ts:84-100`（页面在 CHAT_CHANGED 后 1.5s 才刷新，窗口进一步拉长）
- 现象/触发路径：
  1. 用户在聊天 A 设置起止楼层 1~50（A 有 60 个 AI 楼），点「删除所有本地数据」。页面判定为按范围删除，只弹一次确认，文案写明「聊天级模板 scope 与 guide 容器保留」。
  2. 确认框打开期间，用户切到只有 ≤50 个 AI 楼的聊天 B（或在 A 里删掉十几楼）。
  3. 点确认后，`deleteLocalData` 按「此刻」重新判定，`isFullRangeDeletionRequest_ACU` 为真，于是以 `expectedPath: 'purge'` 调用服务层。服务层看到预期与实际一致，直接对 B 执行硬清空：所有隔离标识的数据、首楼字段、聊天级模板 scope 与 guide 全部删除，不可恢复。用户只确认过一次，而且确认的是另一个聊天的「按范围删除」。
  4. 即使不升级为硬清空，按范围删除和按表删除也同样落到 B 上；恢复 Checkpoint 更彻底，会清空 B 全部 AI 楼层的表格数据。
- 证据：探针 `zz-probe-r10a-datamgmt.test.ts`。确认前 `resolveDeletionPath('all') === 'range'`；模拟确认期间范围变为全量后调用 `deleteLocalData('all')`，`deleteLocalDataWithScope_ACU` 收到的参数是 `('all', 1, 50, 'purge')`。
- 修法方向：
  - 页面在弹框前就冻结一份执行快照（聊天 identity、隔离键、`expectedPath`、`sheetKeys`、起止楼层），作为参数传给 `deleteLocalData` / `restoreTableCheckpoint`；composable 不再自行重算 `expectedPath`。
  - composable 在执行前比对 identity，不一致时 fail-closed 并提示重新确认。更彻底的做法是让 `deleteLocalDataWithScope_ACU`、`restoreTableCheckpointToLatestAi_ACU` 接受 `expectedChatIdentity`。
  - 可选：`dialog-store` 在切聊天时把未决的危险确认一律按取消处理。

**R10A-02 [P1 已坐实] 可视化器「保存数据到当前消息」在只有锁改动或删表时，放行并吞掉未提交的模板改动；删表只硬删数据，模板删除永远不提交**
- 位置：
  - `src/presentation-v2/composables/visualizer/useVisualizerSave.ts:533-551`（只有 `hasDataChanges && hasPendingTemplateChanges` 才拒绝）
  - `:573-583`（删表走 `purgeSheetKeysFromChatHistoryHard_ACU`，只删数据与首楼旧 guide 字段）
  - `:610`（`visualizer.markSaved('data')`）
  - `src/presentation-v2/stores/visualizer-store.ts:454-464`（`markSaved` 把 `templateBaseData` 设为当前 `tempData`，清空 `deletedSheetKeys` 与 dirty）
  - 触发入口：`VisualizerSurface.vue:104-113`（主按钮）、`:301-314`（关闭守卫的「保存」也走这条路径）
- 现象/触发路径：
  1. 用户在编辑器里改了表名、改了列或调整了表顺序（模板层改动），又切了一个行锁，然后点主按钮「保存数据到当前消息」，或者关闭编辑器时选「保存」。
  2. 因为没有行级增量，混合拦截不触发。保存锁草稿后执行 `markSaved('data')`，模板基线被设成含改动的 `tempData`，dirty 清零，提示「表格锁设置已保存」。
  3. 此后点「保存模板到当前聊天」，分类结果是「模板结构没有变化」。模板改动从未提交，重新打开编辑器后全部消失。
  4. 删表同理：数据路径只对该表做全历史硬删，聊天模板 scope 里这张表还在。`markSaved` 之后模板路径看不到删除意图，重新载入后这张表会以空表形式回来（「重新出现」这一步是按代码推断的）。
- 证据：探针 `zz-probe-r10a-viz.test.ts`：
  - 用例「锁改动 + 未提交模板改名」：`saveToChat()` 返回 true，`templateBaseData` 中的表名已经变成新名；随后 `saveTemplateToCurrentChat()` 返回 false，`commitCurrentFloorTemplateChanges_ACU` 未被调用，提示「模板结构没有变化。」
  - 用例「数据路径删表」：调用了 `purgeSheetKeysFromChatHistoryHard_ACU(['sheet_delete'])`，随后的模板保存不提交任何东西。
- 修法方向：
  - 数据路径只要检测到 `hasPendingTemplateChanges`（不管有没有行级增量）就拒绝，并提示先保存模板；或者只把锁/数据相关的状态标为已保存，不动 `templateBaseData`。
  - 删表统一交给模板路径（现有测试已经要求模板路径「不走独立 hard purge」），数据路径遇到 `deletedSheetKeys` 时应提示改用模板保存，而不是只删数据。
  - 关闭守卫的「保存」按钮应根据草稿内容选择保存路径，或者在含模板改动时禁用。

---

## P2

**R10A-03 [P2 已坐实] 「保存模板到全局」在确认弹窗后不复核聊天，旧聊天的锁草稿写进新聊天**
- 位置：`useVisualizerSave.ts:1191-1218`（`saveTemplateToGlobal` 只在入口检查一次草稿归属）、`:350-392`（`saveGlobalTemplateSnapshot`：`:356-366` await 命名或覆盖确认，之后直接 upsert 并 `applyTemplatePresetToCurrent_ACU`）、`:1207`（`saveLockDrafts`）→ `src/service/runtime/helpers-table-lock.ts:235-249,373-379`（锁作用域按调用当刻的聊天与隔离键计算）。
- 现象/触发路径：同一文件的「保存模板到当前聊天」在每个 await 后都调用 `saveContextStillMatches`，这里却没有。弹窗期间切到聊天 B 后确认：
  - 全局预设被写成 A 的草稿结构（这一点符合用户意图）；
  - `applyTemplatePresetToCurrent_ACU` 以 B 为当前聊天执行模板切换；
  - A 的 `tableLockDrafts` 按行索引解析成 row_id 后，覆盖写入 B 同 sheetKey 的锁设置，B 原有的锁被替换；
  - `reloadStorageProvider` 与刷新也作用于 B，最后还会 `recordGlobalTemplateSaved`。
- 证据：探针 `zz-probe-r10a-viz.test.ts`「保存到全局：确认弹窗期间切聊天」：`applyTemplatePresetToCurrent_ACU` 与 `saveTableLocksForSheet_ACU` 被调用时，当前聊天都已是 `chat-b`。
- 修法方向：在 `saveGlobalTemplateSnapshot` 的弹窗之后、`saveLockDrafts` 之前各调用一次 `saveContextStillMatches(saveContextKey)`，不一致时 `rejectChangedSaveContext()`。

**R10A-04 [P2 已坐实] 其余「确认弹窗 → 执行」TOCTOU：确认后作用于此刻的当前聊天**
- 位置与现象：
  - 模板破坏性确认：`useTableTemplatePresets.ts:440-469`、`useTablePresetManagement.ts:154-189`、`templateFollowGlobalFlow.ts:61-77`。第一次提交返回 A 的「删除表/列需要显式确认」blockers；弹窗期间切聊天后确认，会以 `destructiveChangeConfirmed: true` 对 B 重新提交。B 的破坏性变更没有展示给用户，就被一并确认并硬删。
  - 关闭飞行模式：`DashboardPage.vue:117-152` → `useDashboardPage.ts:1039-1056` → `flight-mode-transition.ts:289-330`。确认的是 A 的「永久删除大总结表」，执行时作用于 B（B 也开着飞行模式时，B 的大总结表被硬删）。开关在执行期间没有忙碌态，可以重复触发。
  - 恢复默认：`useDataManagement.ts:735-830` 是多步 await 序列，每一步都现读当前聊天（如 `:767-771` 先 `saveChat`，`:774-782` 的 `clearCurrentChatTemplateSnapshots_ACU` 默认参数取调用当刻的聊天）。中途切聊天会把后半程清理落到 B；回滚检测到跨聊天后直接放弃（`:190-192`），A 只做了一半，B 被清了一半。
  - 删除交火索引：`VectorIndexPage.vue:283-290` → `useVectorIndexConfig.ts:549-566`（派生数据，可重建，影响较小）。
- 证据：`dialog-store.ts` 没有任何监听聊天切换的取消逻辑，上述调用方在确认后也没有 identity 复核，调用链完整。
- 修法方向：
  - 抽一个公用的 `captureUiChatContext()` / `assertUiChatContext()`，在每个确认点之后复核；
  - 破坏性确认的重试要绑定第一次提交时的聊天与 blockers 指纹，不一致时不得带 `destructiveChangeConfirmed: true` 重提；
  - 飞行模式开关加忙碌态。

**R10A-05 [P2 已坐实] AI 改表助手的「加列并填值」类草稿应用后无路可存**
- 位置：`visualizer/useVisualizerAssistant.ts:301-345`（`recordAssistantCandidateDataOps` 按列位置对比，记录行级插入/更新/删除）、`:771-796`（应用后草稿同时含 schema 变化和 pendingDataOps）；`useVisualizerSave.ts:547-550`（数据保存拒绝混入模板变化）、`:770-773`（模板保存拒绝存在数据增量）。
- 现象/触发路径：
  1. 助手编译器允许同一草稿里同时出现 `patch_sheet_schema` 和 `patch_sheet_content`（`template-assistant/compiler.ts:829-850`）。
  2. 用户请求「新增一列『情绪』并为每行填上」，应用后，数据保存提示「请先保存模板，再保存数据」，模板保存提示「存在未保存的数据增量」，两条路径互相等待，只能丢弃草稿。
  3. 另外，列删除或列重排后，`recordAssistantCandidateDataOps` 仍按位置逐列对比，会以新表头的列名记录一批伪更新（数值相同或错位）。因为保存被拦，不会落盘，但会让增量队列失真。
- 证据：探针 `zz-probe-r10a-viz.test.ts`「同一草稿既有 schema 变更又有行级增量」：两次保存都返回 false，两条错误提示依次出现。
- 修法方向：
  - 应用草稿时，如果同一张表同时有 schema 变化和内容变化，把内容变化并入模板路径（rebase 整表），不记录行级增量；
  - 或者在助手侧拆成两步：先应用并保存结构，再应用内容；
  - 行级对比应按列名映射，不要按位置对比。

**R10A-06 [P2 已坐实] 世界书条目勾选在读取失败时被清空并落盘**
- 位置：`useFormFillWorldbookEntries.ts:77-88,136`、`usePlotWorldbookEntries.ts:86-103`；上游 `src/service/worldbook/pipeline.ts:1150`（书不在可用列表中时返回 `[]`）、`:1186`（单本读取异常时返回 `[]`）。
- 现象/触发路径：
  1. `loadEntries` 把已勾选的 uid 与本次读到的可见条目求交集，不一致就写回并 `saveSettings_ACU`。
  2. 服务层把「读取失败」和「书里没有条目」都表示为空数组，于是 TT 未就绪、世界书 API 抖动、书暂时不在列表中这些情况，都会让该书的勾选被清空并持久化。之后读取恢复，勾选也回不来。
  3. 剧情推进版更糟：首次加载本应「默认全选」，一次失败就会写入空数组，以后再也不会走首次默认，剧情推进从此不再使用这本书的任何条目。
- 证据：探针 `zz-probe-r10a-wbentries.test.ts`：预置 `enabledEntries.CharBook = [1, 2]`，mock 读取返回 `{ CharBook: [] }`，`loadEntries` 后变为 `[]` 并调用了 `saveSettings_ACU`；读取恢复后两条都是未勾选状态。
- 修法方向：
  - 服务层区分「读取失败」与「空书」（例如返回 `failedBooks`）；
  - composable 只在该书读取成功且条目列表非空时才清理失效 uid，首次默认也只在读取成功时写入。

**R10A-07 [P2 已坐实] Agent 世界书批量编辑整本读改写，覆盖并发修改**
- 位置：`useAgentWorldbookEntries.ts:279-313`、`:316-351`、`:354-399`（三个批量函数都执行 `getLorebookEntries_ACU(book)` → 对全部条目 map → `setLorebookEntries_ACU(book, 全部条目)`）；`src/shared/host-compat/native-st-backend.ts:180-192`（按 uid 把传入对象的全部字段 `Object.assign` 回去）。
- 现象/触发路径：
  1. composable 绕过服务层，直接调用 data gateway，并把整本书所有条目（包括没改动的）作为 patch 写回。R7-02 修复的按书互斥锁只覆盖 set 内部，覆盖不到 get 与 set 之间的窗口。
  2. 如果这个窗口里填表的世界书同步刚更新了 TavernDB 条目内容（注入目标默认就是角色主世界书，和用户的 Skill 条目常在同一本书），或者 Agent 接管刚翻转了 enabled，就会被旧快照回滚。
  3. 多本书时每本都有一个这样的窗口。单本失败只 `logError`，返回的计数仍按成功的书累计，界面不知道有书失败。
- 证据：调用链如上，`setLorebookEntries` 的合并语义已核对。是否真的会并发属于推断，机制已坐实（与 R7-02 同口径）。
- 修法方向：
  - 只把改动的条目以最小 patch（`{ uid, enabled: true }` / `{ uid, type: '' }`）写回；
  - 或者改用服务层带锁的批量更新函数；
  - 把每本书的失败汇总返回，交给 UI 提示。

**R10A-08 [P2 已坐实] 向量 API 配置保存：校验前就改了活引用，校验失败时已生效，并会被下一次保存落盘**
- 位置：`useVectorApiConfig.ts:64-88`；`src/service/vector/vector-memory-config.ts:262-269`（`getCurrentVectorMemoryConfig_ACU` 返回 `globalMeta_ACU.vectorMemoryConfigGlobal` 的活对象）；同文件 `:13-29` 已有带回滚的 `updateGlobalVectorMemoryConfigFields_ACU`。
- 现象/触发路径：
  1. 用户清空「向量化 URL」后点保存：先把空串写进活配置，再校验，校验失败返回 false，界面提示缺字段，看上去「没保存」。
  2. 实际上内存配置已经是空 URL，交火召回立即失效；之后任何一次无关的 `saveSettings_ACU`（比如切个开关）都会把它持久化。
  3. 成功分支也不检查 `saveSettings_ACU()` 的返回值，存储失败时同样提示「已保存」。
- 修法方向：在副本上组装并校验，通过后再调用 `updateGlobalVectorMemoryConfigFields_ACU(patch)`（它自带失败回滚），并按返回值提示。

**R10A-09 [P2 已坐实] 续写资料编辑用陈旧草稿整体覆盖 Agent 期间写入的内容**
- 位置：`useContinuationMaterials.ts:84-105`（`reload`）、`:117-155`（`save` 只比对聊天身份）；`src/service/continuation/agent/agent-module-store.ts:1467-1512`（`replaceAgentModuleSnapshotByUser_ACU` 以 `{...current, ...raw}` 整模块替换，并递增全部修订号，不接受 base revision）；`parts/ContinuationMaterials.vue:649-676`（只在挂载、手动重载、切聊天时调用 `reload`）。
- 现象/触发路径：
  1. 续写任务在跑，用户打开资料面板，此时草稿是 T0 的快照。
  2. Agent 的维护子代理在 T1 往 hooks 里加了几条伏笔。
  3. 用户在 T2 改了 hooks 的一条并保存：整个 hooks 数组被 T0 版本加用户改动替换，T1 新增的伏笔消失。同时修订号被推进，Agent 仍在飞的写集也会被拒。
  4. 服务层注释（`:1484`）只防了「子代理旧写集覆盖用户」，没有防反方向。
- 修法方向：`reload` 时记录各模块的 `revisions[module]`，保存时作为 `expectedRevision` 传给服务层，不一致时拒绝并提示重新载入；或者在 Agent 运行期间禁用资料编辑。

**R10A-10 [P2 已坐实] 剧情推进预设新建或改名不查重，静默覆盖另一个预设**
- 位置：`usePlotPresetManagement.ts:252-264`（`validate` 只查空名和任务数）、`:278-296`；`src/presentation-v2/stores/plot-preset-store.ts:294-305`。
- 现象/触发路径：
  1. 新建时把名字改成已有预设名，或编辑预设 X 时改名为已有的 Y。store 命中 `idxByNew >= 0`，用当前草稿替换 Y，没有任何确认。
  2. 改名场景下 X 本身原样保留，结果是 Y 丢了、X 多了一份。
  3. 如果 Y 正是当前生效预设，运行时设置也会被同步覆盖（`:321-325`）。
- 修法方向：`validate` 检查 `name !== originalName && 已存在同名`，拒绝或二次确认；store 在改名撞名时也应 fail-closed。

**R10A-11 [P2 已坐实] SQL 控制台快捷键绕过忙碌态，写语句可被重复执行；提交后切聊天时提示「已拒绝执行」**
- 位置：`useSqlConsole.ts:153-244`（`executeCurrent` 没有 `busyAction` 重入检查）；`presentation-v3/pages/AdvancedToolsPage.vue:204-209`（Ctrl+Enter 直接调用，按钮的 `:busy` 只禁用了按钮本身）；`useSqlConsole.ts:210-214`。
- 现象/触发路径：
  1. 执行 `INSERT ...` 时连按或按住 Ctrl+Enter（键盘自动重复），每次都会排进一个新的 `runSqliteRuntimeMutationCommit_ACU`。事务层把它们串行化，但每次都会提交，于是插入重复行、重复递增计数。
  2. `runSqliteRuntimeMutationCommit_ACU` 返回后如果聊天已切换，界面提示「聊天已切换，旧 SQL 已拒绝执行」，但这条 SQL 已经在 A 上提交。用户回到 A 再执行一次，就重复写入。
- 修法方向：`executeCurrent` 入口加 `if (busyAction.value) return`；切聊天后的提示按 `commitResult.success` 区分「已在原聊天提交」与「未执行」。

**R10A-12 [P2 已坐实] 全局提示词的未保存编辑被页面级 refresh 静默重置**
- 位置：`useFormFillSettings.ts:386-410`（`refresh` 无条件重写 `promptSegments` 并清 `promptDirty`）← `TablePage.vue:249-258`（`watchChatChanged_ACU(refreshAll)`）；`useVectorIndexConfig.ts:251-288` ← `VectorIndexPage.vue:273`（保存向量 API 后调用 `vector.refresh()`）、`:294-301`（切聊天）。
- 现象/触发路径：
  1. 填表提示词和交火关键词提示词都是全局设置，与聊天无关。
  2. 用户在提示词抽屉里改到一半，切聊天或在同页保存了向量 API，编辑缓冲被换回已保存的版本，dirty 清零。
  3. `TablePage` 的关闭守卫靠 `promptDirty` 判断，于是连「未保存」提示也没有了。
- 修法方向：`refresh` 在 `promptDirty` 为真时保留编辑缓冲（只刷新其它字段），或拆成 `refreshSettings()` / `reloadPrompt()` 两个入口；全局设置页面不需要在切聊天时重载提示词。

**R10A-13 [P2 待坐实] JSON 下载立即 revoke 且挂在当前 document，Checkpoint 等导出可能静默失败**
- 位置：`useDataManagement.ts:239-250`（Checkpoint 导出、V2 恢复备份导出、混合存储快照导出都走这里）、`useTableTemplatePresets.ts:156-166`、`useTablePresetManagement.ts:68-78`、`visualizer/useVisualizerAssistant.ts:553-568`、`useFormFillSettings.ts:660-685`。对照：`useDebugPanel.ts:116-128` 注释写明「WebView2/部分内核在 click 后立即 revoke 会取消下载」；`presentation-v3/ui/file-helpers.ts:1-33` 已有挂在 host document、延迟 revoke 的 `downloadJsonFile_UB`。
- 现象：这五处都是 `a.click()` 后同步 `URL.revokeObjectURL`，并且挂在 `document` 而不是 host document。在 Windows 版 TT（WebView2）或扩展跑在 iframe 的宿主里，下载可能被取消，界面却已经提示「已导出」。这里最要紧的是 Checkpoint 备份和 V2 恢复原始 frame 备份，用户会以为自己有了备份。
- 待坐实点：没有在 WebView2 真机上复现，依据是仓内注释和已有修复。
- 修法方向：统一改用 `downloadJsonFile_UB(getAcuHostDocument(), …)`，删掉各处的私有 `downloadJson`。

---

## P3

**R10A-14 [P3 已坐实] 可视化器改表名时，立即把表级 API 预设覆盖迁到新名并落盘**
- 位置：`visualizer/useVisualizerConfigEditing.ts:233-237`。
- 表名只是草稿，但 `tableApiPresetOverridesByName` 是在改名的那一刻就迁移并 `saveSettings_ACU`。之后丢弃草稿或模板保存失败，表名回到旧名，覆盖却挂在新名上，这张表的 API 预设静默回落到整体配置。`renameSheet` 也不查重：改成另一张表的名字时，会覆盖那张表的覆盖设置。
- 修法：覆盖迁移放到模板保存成功之后执行，或在保存时按「旧名 → 新名」映射统一迁移。

**R10A-15 [P3 已坐实] 改列名不同步额外索引列配置**
- 位置：`useVisualizerConfigEditing.ts:241-255`（`updateHeader`）；消费方 `src/service/worldbook/injection-engine-custom.ts:216-220` 按表头名匹配 `extraIndexColumns`。
- 改列名后 `extraIndexColumns` 和 `extraIndexColumnModes` 仍是旧名，这一列从额外索引中静默消失；原来是 `index_only` 的列还会回到主条目里。`renameSheet` 已经同步了 `entryName`，列名这边漏了。

**R10A-16 [P3 已坐实] AI 改表助手切表或重载时只翻运行标志，旧会话仍在飞**
- 位置：`visualizer/useVisualizerAssistant.ts:905-915`（watch 里 `invalidate()` 后直接把 `assistantIsRunning` 置为 false）、`:624-712`（`run` 的 catch/finally）、`:53,640`（`guardController` 是模块级变量，`run` 时被替换）。
- 切表后用户可以立刻发起新会话。旧会话被 invalidate 后在下一个检查点抛出 `Stopped`，它的 catch 会追加一条 error turn、改写 `assistantErrorMessage`，finally 会把 `assistantIsRunning` 置为 false，而此时新会话还在跑，于是界面允许第三个会话并发发起。这是 UI 状态错乱，应用草稿时有指纹门禁，不会写坏数据。
- 修法：每个 run 持有自己的 runId，catch/finally 只在 runId 仍是当前值时才改共享状态；watch 里不要直接翻 `assistantIsRunning`。

**R10A-17 [P3 已坐实] Skill 化防重入无效**
- 位置：`usePlotWorldbookAgentControl.ts:527-533`。入口检查 `busy`，但 `busy` 要等 `await refresh()` 和 `await dialog.confirm()` 之后才置位，确认后也没有再检查（同文件 `restore`（`:465-469`）和 `clearSkillMeta`（`:627-631`）都做了二次检查）。连点会排队两个确认框，两次都确认就会并发跑两批 Skill 化，重复调用 AI，并发写同一批条目；`activeSkillifyAbort` 会被后一批覆盖，前一批在卸载时也无法中止。注释（`:528`）写的「若已在飞直接拒绝」与实际不符。

**R10A-18 [P3 已坐实] 硬清空收尾未 await**
- 位置：`useDataManagement.ts:893-895` 调用 `applyPurgeOutcome(outcome.result)` 时没有 await，定义见 `:945`。`busyAction` 在刷新完成前就被清空；`refreshMergedDataAndNotify_ACU` 抛错时会变成未处理的 rejection，外层 catch 收不到，用户看不到失败提示。

**R10A-19 [P3 已坐实] 手动填表「终止」的范围过大；取消确认会清空额外要求**
- 位置：`useManualUpdate.ts:313-318` → `src/service/runtime/state-manager.ts:522-528`（中止所有登记的 controller，剧情推进 `plot-entry.ts:93` 也在其中）；`useManualUpdate.ts:445-451,578-581`。
- 用户终止手动填表时，会连带中止正在进行的剧情推进规划。另外 `runManualUpdate` 的 finally 无条件调用 `refresh()`，其中执行 `manualExtraHint.value = ''`，用户在确认框里点「取消」，或因切聊天被拦下时，填好的额外要求也会被清空。

**R10A-20 [P3 已坐实] V2 恢复诊断入口已隐藏，但页面残留分节，错误文案仍指向它**
- 位置：`presentation-v3/pages/DataMgmtPage.vue:47-80`（「V2 数据恢复诊断」「V2 隔离域恢复诊断」两个分节只在 `v2RecoverySummary` 或 `v2IsolationDiagnostics` 有值时显示，而能填充它们的 `prepareV2Recovery` / `scanV2IsolationDiagnostics`（`useDataManagement.ts:578-621`）在 v3 已没有任何调用方，测试 `data-mgmt-page.test.ts:364-391` 也确认入口是刻意隐藏的）；指引文案：`useTemplateRecoveryGuard.ts:13-16`「请先在数据管理中诊断并完成恢复收敛」、`useTableTemplatePresets.ts:180-185`「请先在数据管理中检查并恢复 V2 历史后重试」。
- 用户被引导去一个已经不存在的入口。要么恢复一个最小诊断入口，要么改写文案并删掉死分节和对应函数。

**R10A-21 [P3 已坐实] 注入目标切换与世界书选择器的错误处理**
- `useFormFillInjectionTarget.ts:72-80`：旧目标的 `deleteAllGeneratedEntries_ACU` 失败只记日志，随后照常切换并提示「数据注入目标已成功切换！」。旧书里的 TavernDB 条目残留，如果旧书仍处于激活状态，提示词里会出现新旧两份表格数据。
- `:92-95`：`updateReadableLorebookEntry_ACU` 抛错时没有 catch，变成调用方的未处理 rejection，没有失败提示，而新目标已经落盘。
- `useWorldbookSelector.ts:31-41`：两个请求各自 `.catch` 成默认值，外层 catch 永远不可达，读取失败会显示为「没有世界书」。

**R10A-22 [P3 已坐实] 死代码**
- `visualizer/useVisualizerSave.ts:395-493` 的 `saveCurrentDataToChat` 没有调用方，而且它把提交失败当成功返回 `'saved'`。`buildOrderedData` 的 `renumberOrder` / `applySpecialIndex` 默认分支（`:176-200`）和 `applySpecialIndexSequenceFromDrafts`（`:161-174`）随之成为死代码，两个调用方都显式传了 false。
- `useDataManagement.ts`：`applyIsolation`、`removeHistory`、`deleteCurrentIsolationEntries`、`importCombinedSettings`、`exportCombinedSettings`、`exportJsonData`、`overrideLatestLayerWithTemplate`、`scanV2IsolationDiagnostics`、`prepareV2Recovery`，以及 `isolationCode`、`isolationHistory*`、`currentIsolationLabel`、`isolationModeLabel`、`tableCount`，都只剩测试在用（v3 页面刻意隐藏了入口）。`buildCombinedExportPayload` 仍会导出 `autoMergeEnabled`，这与 R8-03 的清理方向相反。
- `useTableTemplatePresets.ts`：`saveGlobalAs`、`renameGlobalPreset`、`deleteGlobalPreset` 无调用方（UI 用的是 `useTablePresetManagement` 的同名能力）；`:26` 的 `deleteLocalDataInChatCore_ACU` 未使用；`runtimeDiffersFromLibrary`、`chatSnapshotDiffersFromLibrary` 页面没有消费。
- `useVectorIndexConfig.ts:290-292` 的 `pushSavedMessage` 是空函数，有 9 处调用。

**R10A-23 [P3 已坐实] 重复实现与误导命名**
- 两套模板预设 composable（`useTableTemplatePresets` / `useTablePresetManagement`），删除预设的语义已经分叉：前者直接删除，后者先回退全局与当前聊天。另外后者的 `run`（`:135-147`）没有前者 `:367-373` 注释里专门补上的重入拒绝。
- `useFormFillWorldbookEntries` 与 `usePlotWorldbookEntries` 约 220 行逐行同构（R10A-06 就要两处同修）。
- 「破坏性确认 + stale 单次重试」有三份：`useTableTemplatePresets.ts:440-469`、`useTablePresetManagement.ts:154-189`、`templateFollowGlobalFlow.ts:54-77`。文件头注释说「避免出现第三份复制」，实际已经三份。
- `downloadJson` 有六份（见 R10A-13）。
- `useTemplateRecoveryGuard.ts` 的 `ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU` 早已不删任何数据：`guideData` 参数被 `void` 掉，`dataWasReset` 恒为 false。各调用方仍在为它构建 guide 数据（`useTableTemplatePresets.ts:217-228,476,517-522,662-664`、`useTablePresetManagement.ts:214-218`、`templateFollowGlobalFlow.ts:47-50`），白做序列化。
- `usePlotTaskEditing.ts:150-152` 新任务 id 为 `plotTask${Date.now()}`，同一毫秒内重复添加会撞 id，`selectTask` / `patchCurrent` 会改到前一个；`deleteCurrentTask`（`:205-213`）不清理其它任务 `dependsOnTaskIds` / `blocksTaskIds` 中对被删任务的引用。
- `useDashboardPage.ts:210-220,1028-1031`：总览页每次 refresh 都会强制 `promptTemplateSettings.enabled = true` 并保存。目前没有 UI 能关闭它，所以没有可见影响，但这是读路径里的隐式写。

---

## 已核对、判定为非问题

- `useManualUpdate`：手动重填和追平都在弹框前冻结 runtime 表集合与聊天/隔离上下文，确认后复核，并把 `executionSnapshot` 传给 orchestrator；额外要求的全局变量由 orchestrator 的 finally 清空（`update-orchestrator.ts:5955`）。追平的「仅同步重试」作用于当前聊天的派生刷新，无害。
- `useVisualizerSave.saveTemplateToCurrentChat`：每个 await（schema 选择、危险确认、降级预检、提交）之后都复核 `saveContextStillMatches`，并用草稿快照比对拦截确认期间的草稿变化；数据路径按 row_id 操作，在 `visualizer-data-ops` 内多处复核上下文。外部数据变化时编辑器显示冲突横幅，「下次保存以这里为准」是明示的设计。
- `useVisualizerData.loadFromCurrentContext`：每个 await 后复核 contextKey，revision 在数据就绪时读取。
- `useSqlConsole`：执行前后都复核上下文，历史按聊天和隔离键过滤（重复执行和提示措辞见 R10A-11）。
- `useContinuationRuntime`：view token（identity + epoch）贯穿所有异步结果；停止不走 busy 闸并递增 stopEpoch；状态订阅随 scope dispose 退订。`useContinuationMaterials` 的保存前后都比对聊天身份和聊天数组引用（陈旧草稿问题见 R10A-09）。`useContinuationSession` 的订阅在卸载时退订。
- `useTableTemplatePresets.run` 有重入拒绝；模板操作的 `AbortController` 随 scope dispose 中止。
- `usePlotWorldbookAgentControl.writeControlPatch` 在初始化完成前拒绝写入，避免默认值覆盖已保存配置；`restore` / `clearSkillMeta` 确认后二次检查 busy。
- `useAgentWorldbookEntries.loadEntries` 有代际 guard，旧响应不会覆盖新数据。
- 资源清理：`useDashboardPage`（日志订阅）、`useDebugPanel`、`useLogViewer`（订阅与 rAF）、`useSqliteRuntimeDiagnostic`（interval，且带可见性门控）、`useApiPresetStaleness`、`useTemplateRuntimeChangeListener`、`useChatChangedListener`（两个计时器与宿主事件）、`useUiCloseGuard` 都在卸载时清理，没有发现泄漏。
- `useDebugPanel` 导出：密钥字段全掩码，复合键后缀（`embeddingApiKey` 等）、请求头字符串、日志正文都过脱敏；表格快照按列名脱敏。
- `useDataManagement.importCombinedSettings` / `resetAllDefaults`：失败时回滚 settings；`resetAllDefaults` 的回滚在检测到跨聊天时拒绝跨聊天回滚（跨聊天本身的问题见 R10A-04）。
- `useDormantData`：唤醒前检查 busy，结果按 `saved` 判定，失败不改本地状态。
- `useApiPresetManagement`：草稿与预设互转保留 `undefined`（跟随全局）语义，与 A2 修复一致。

## 探针（scratchpad，已从 `source/tests` 移走）

目录：`C:\Users\zouyu\AppData\Local\Temp\claude\C--Users-zouyu-Downloads--------shujuku-rebuild\6f204fcf-f837-4e7c-9427-27ef9dd3e747\scratchpad\block10a`

| 文件 | 覆盖 | 放回位置 | 结果 |
|---|---|---|---|
| `zz-probe-r10a-datamgmt.test.ts` | R10A-01 | `source/tests/presentation-v2/data-mgmt/` | 1/1 通过（复现） |
| `zz-probe-r10a-viz.test.ts` | R10A-02（2 例）、R10A-03、R10A-05 | `source/tests/presentation-v2/visualizer/` | 4/4 通过（复现） |
| `zz-probe-r10a-wbentries.test.ts` | R10A-06 | `source/tests/presentation-v2/form-fill/` | 1/1 通过（复现） |

运行方式：把文件放回对应目录，然后在 `source/` 下执行 `npx vitest run tests/<相对路径>`（探针里的 import 路径以放回位置为基准）。
