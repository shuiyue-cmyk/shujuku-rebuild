# 全库复审 · 第 9 块：src/presentation（旧表现层、公开 API、事件接线）

审查方式：只读审查。结论分两种：「已坐实」指有探针复现或调用链完整追踪；「待坐实」指推断。探针都放在会话 scratchpad 的 `block9/` 目录，已从 `source/tests` 移走。

## 覆盖范围

**通读**
- `bootstrap/api-registry.ts`，`bootstrap/api-groups/*` 全部 12 个分组（table-crud / sql / core-data / callback / data-admin / settings-config / template-preset / plot-preset / worldbook-ai / agent-worldbook / table-lock / performance-diagnostics）。
- `bootstrap/init.ts`（CHAT_CHANGED 处理与延迟重建链、initWithChatId 启动链、GENERATION_STARTED/STOPPED/ENDED/AFTER_COMMANDS、MESSAGE_SENT、MESSAGE_DELETED/SWIPED、发送意图钩子、幂等卫兵）。
- `bootstrap/chat-mutation-scheduler.ts`、`bootstrap/tauri-version-gate.ts`。
- `triggers/update-process.ts`、`triggers/update-trigger.ts`、`triggers/data-admin-ui.ts`。
- `triggers/settings-ui-sync/settings-ui-connect.ts`（`handleNewMessageDebounced_ACU` 自动链入口）、`settings-ui-trigger.ts`（`triggerAutomaticUpdateIfNeeded_ACU`）、`settings-ui-config.ts`、`index.ts`。
- `components/optimization-ui/optimization-ui-exec.ts`、`optimization-ui-diff.ts`、`optimization-ui-overlay.ts`。
- `components/plot-pending-disguise.ts`、`plot-planning-ui.ts`、`summary-vector-index-ui.ts`、`pipeline-ui-helpers.ts`、`status-display.ts`、`settings-ui-helpers.ts`。
- `theme/toast.ts`（富文本净化与 `escapeHtml:false` 调用点）、`theme/custom-confirm.ts`、`state/ui-refs.ts`。

**部分精读或略读**
- `components/plot-editors.ts`、`template-preset-ui.ts`、`update-status-display.ts`、`optimization-ui-rules.ts`、`triggers/settings-ui-sync/settings-ui-api.ts`：确认它们依赖的 `$popupInstance_ACU` 等 DOM 引用从未被赋值后（见 R9-11），只核对了「空转时会不会抛错、有没有活调用方」，没有逐行审业务逻辑。
- `bootstrap/install-build-badge.ts`、`component-base.ts`、`dom-utils.ts`：略读。

**为追调用链读过的块外代码**：`service/table/table-update-commit.ts:286-558`（`runTableUpdateCommit_ACU` / `runSqliteRuntimeMutationCommit_ACU`）、`service/table/sql-table-service.ts:1150-1215`（隐藏列守卫）、`:1449-1500`（`buildSqlSheetBatchOperations_ACU`）、`:1854-2010`（`applyEditsBatch` 与 `applyEditsWithSystemRowIds` 的锁执行）、`:2056-2080`（`executeMutation`）、`:2589-2620`（`enforceTableLocksAfterSqlApply_ACU`）、`service/runtime/helpers-table-lock.ts`、`service/chat/chat-service.ts:1134-1200`（`replaceChatMessage_ACU`）、`:2194-2278`（`overrideLatestLayerWithTemplateCore_ACU`）、`service/chat/checkpoint-delete-guard.ts:1-80`、`service/table/table-service.ts:389-450`、`service/table/table-storage-strategy.ts:171-410`、`service/table/table-import-service.ts`、`service/settings/settings-service.ts:415-445`、`:1354-1440`、`service/optimization/content-optimization.ts:250-381`、`:620-660`、`:780-790`、`service/runtime/state-manager.ts:509-570`、`presentation-v2/composables/useDataManagement.ts:830-845`。

**整体印象**
- **公开 CRUD API** 的入口校验整体合格：表名经 owner-aware mapper 解析、fail-closed，SQL 全参数化，写入一律经 `runSqliteRuntimeMutationCommit_ACU` 进事务与 V2 持久化，并查了身份锁。问题在细节：`row_id` 列可被改写（insertRow 却明确跳过），以及「选项塞在数据对象里」的旧调用写法在 SQLite 下整笔失败。
- **原生 SQL API** 走的是 `executeMutation` / `applyEditsBatch`，与 AI 路径 `applyEditsWithSystemRowIds` 不同：没有锁执行、没有隐藏列守卫、默认允许 DDL。CRUD 已明文「锁也防外部脚本」，同为外部入口的原生 SQL 却完全绕过，外键级联也能借 CRUD deleteRow 删到锁定行。
- **旧 jQuery 弹窗层已整体失效**：`$popupInstance_ACU` 与 `_assignUIPlaceholders_ACU` 的赋值入口从未被调用，ui-refs 的全部引用恒为 null。多数函数因判空而静默空转，但「合并配置」导入/导出这对公开 API 因此坏掉（R9-07）。
- **正文优化旧链路**是本块风险最高的地方。它仍是自动链的真实执行体（`handleNewMessageDebounced_ACU` → `executeContentOptimization_ACU`），却只记下标、不复核楼层身份：AI 在途期间滑动、删楼或切聊天，结果会写进别的楼甚至别的聊天（R9-01）。V2 的 `content-replace-store` 已有守卫，旧链路没有跟上。
- **切聊/删楼的调度与重建**：CHAT_CHANGED 延迟链的 mid-run 复检写得很完整；但启动链 `initWithChatId` 没有同样的复检（R9-10），删楼调度器只按「最新原因」决定是否做 checkpoint 前移恢复（R9-03）。
- 「覆盖最新层」提交后不重建 SQLite runtime（R9-02），是从表现层调用方能直接触发的 runtime/回放分叉。

---

## 统计

| 级别 | 数量 | 已坐实 | 待坐实 |
|---|---|---|---|
| P0 | 0 | 0 | 0 |
| P1 | 3 | 3 | 0 |
| P2 | 7 | 7 | 0 |
| P3 | 8 | 6 | 2 |

## 汇总表

| 编号 | 级别 | 状态 | 一句话 |
|---|---|---|---|
| R9-01 | P1 | 已坐实 | 正文优化（自动应用 / 手动确认 / 重新优化）写回只认下标、不复核聊天与楼层身份，AI 在途期间滑动、删楼或切聊天会把结果写进别的 swipe、别的楼或别的聊天 |
| R9-02 | P1 | 已坐实 | 「覆盖最新层」提交后不重建 SQLite runtime：runtime 留着旧行，下一次写入把旧行重新发布到 canonical 视图，回放与 runtime 分叉、row_id 错位 |
| R9-03 | P1 | 已坐实 | 删楼后 1.2s 防抖窗口内又有滑动，调度器只看最新原因，跳过删楼 checkpoint 前移恢复，随后的冷回放把丢失固化 |
| R9-04 | P2 | 已坐实 | 原生 SQL API（executeSqlMutation / executeSqlBatch / executeSql）完全绕过表格锁与隐藏列守卫；CRUD deleteRow 的外键级联同样能删到锁定行 |
| R9-05 | P2 | 已坐实 | CRUD updateCell（列 0 或 `row_id`）与 updateRow（`{row_id}`）可以直接改写 row_id，挂在该行上的单元格锁等身份锁随之静默失效 |
| R9-06 | P2 | 已坐实 | 解析器把数据对象里的 `isImportMode` / `silent` / `skipNotify` 当选项读取，SQLite 写入时又把它们当列名，导致整笔拒绝（insertRow 连 `isImportMode` 都没跳过） |
| R9-07 | P2 | 已坐实 | 公开 API importCombinedSettings 在提示词已保存后于 `$popupInstance_ACU.find` 抛错，模板不导入、先报成功再报失败；exportCombinedSettings 恒返回 false |
| R9-08 | P2 | 已坐实 | 手动确认模式多轮：前轮「应用并继续」、末轮「跳过」时前轮结果从不写回，却提示「优化完成，累计 N 处改进」，并触发两次自动填表 |
| R9-09 | P2 | 已坐实 | 重新优化对话框把 AI 返回的 `summary` 未转义拼进 DOM（`optimization-ui-exec.ts:187`），存在 HTML 注入 |
| R9-10 | P2 | 已坐实 | 启动链 `initWithChatId` 缺 mid-run 聊天身份复检，envelope 身份取创建时刻的当前值；merged refresh 之后切聊会把旧聊天数据以新聊天身份 hydrate 进 runtime |
| R9-11 | P3 | 已坐实 | 旧 jQuery 弹窗层整体失效：`$popupInstance_ACU` 等引用从未赋值，ui-refs、settings-ui-api 全文件及大量组件函数成为死代码或空转 |
| R9-12 | P3 | 已坐实 | 存储模式恒为 SQLite 后遗留的死分支：table-crud-api 的非 SQLite 分支（约 250 行）、自动填表的分组路径与终止按钮 toast、合并导出仍写已停用的 merge 字段 |
| R9-13 | P3 | 已坐实 | `showCustomConfirm_ACU` 新弹框会移除旧弹框 DOM，但不 resolve 旧 Promise，先前的 await 永久挂起 |
| R9-14 | P3 | 已坐实 | 锁 API 用 0 基数据行下标并以 sheetKey 寻址，CRUD API 用 1 基行号并以表名寻址，两套公开 API 的行口径不一致且无文档 |
| R9-15 | P3 | 已坐实 | `abortOnChatMutation_ACU` 注释称删楼/ROLL 也会中止在飞调用，实际只有 CHAT_CHANGED 调用它，MESSAGE_DELETED/SWIPED 都不中止 |
| R9-16 | P3 | 已坐实 | `openVisualizer` 重复定义，每次启动打 warn；`setManualSelectedTables` / `clearManualSelectedTables` / `importPlotPresetFromData` 忽略保存结果，恒报成功 |
| R9-17 | P3 | 待坐实 | `exportTableAsJson` 与表格更新回调直接交出 `currentJsonTableData_ACU` 原对象，第三方原地修改会改写运行时 canonical 视图 |
| R9-18 | P3 | 待坐实 | 自动填表的合并跟发（`pendingAutoUpdateTrigger_ACU`）在 CHAT_CHANGED 时不清，在途填表结束后会在新聊天上补跑一轮 |

---

## P1

**R9-01 [P1 已坐实] 正文优化写回只认下标、不复核聊天与楼层身份，AI 在途期间滑动、删楼或切聊天会写错楼甚至写错聊天**
- 位置：
  - 自动应用：`src/presentation/components/optimization-ui/optimization-ui-exec.ts:322-337`（开头记下 `messageIndex` 和 `content`），`:394-466`（逐轮 await AI），`:468`（`replaceChatMessage_ACU(messageIndex, finalOptimizedContent)`）。
  - 手动确认末轮：同文件 `:599`；逐轮对话框「应用」：`optimization-ui-diff.ts:194`。
  - 重新优化（公开 API `reoptimizeMessage`）：`optimization-ui-exec.ts:75-138` 先 await AI，`:276` 在对话框「应用」时写回。
  - 写回函数本身没有守卫：`src/service/chat/chat-service.ts:1134-1166`，直接取 `chat[messageIndex]` 当时的 `message_id`，经 `setChatMessages_ACU` 写入并落盘。
  - 自动链入口：`triggers/settings-ui-sync/settings-ui-connect.ts:538-576`（`optimize_parallel` / `optimize_manual` / `optimize_then_update` 都调用 `executeContentOptimization_ACU`）。
- 现象/触发路径：
  1. 开启正文优化，非无感模式（只显示进度 toast，不遮挡页面），生成结束后自动链调用 `executeContentOptimization_ACU(n)`。
  2. AI 优化通常耗时十几秒到一分钟。这段时间用户可以：
     - 对第 n 楼滑动重新生成（ST 会把同一楼对象的 `mes` 换成新 swipe 的正文）；
     - 删掉第 n 楼或它之前的楼；
     - 切到另一个聊天。
  3. 这三种操作都不会取消正文优化：`abortOnChatMutation_ACU` 只在 CHAT_CHANGED 调用，而且它只中止填表请求，正文优化的 AbortController 只响应 `cancelContentOptimization_ACU`（用户点「取消优化」）。
  4. AI 返回后，`replaceChatMessage_ACU(n, 优化后的旧正文)` 按下标写回：
     - 滑动场景：新 swipe 的正文被旧 swipe 的优化结果覆盖；
     - 删楼场景：写进现在占着下标 n 的另一条消息；
     - 切聊场景：写进聊天 B 第 n 楼并保存，`extra._acu_original_content` 也记成 B 的原文。
  5. 写回后还会 `recordAutoProcessedAfterWriteBack_ACU`，把被改错的楼登记为「已处理」，之后的自动替换会跳过它。
  6. 手动确认 / 重新优化两条路径要等对话框点「应用」才写回，对话框带全屏遮罩，用户较难在对话框打开期间操作；但在对话框弹出之前的 AI 请求期间（只有进度 toast），同样可以滑动或切聊。
- 证据：探针 `zz-review-probe-r9-optexec.test.ts`（2/2 复现）。
  - 用例一：优化在途时把 `chat[1].mes` 改成「新 swipe：完全不同的回复」。结果 `replace` 以 `(1, '旧回复：夜色漫过窗台')` 被调用，第 1 楼最终变成旧回复的优化版。
  - 用例二：优化在途时把 chat 数组整体换成聊天 B。B 的第 1 楼最终变成「A 聊天的回复 窗台」。
  - 真实的 `replaceChatMessage_ACU` 没有任何身份比对（已读源码），所以探针里对它的简化 mock 不影响结论。
- 修法方向：
  - 在 `executeContentOptimization_ACU` / `reoptimizeMessage_ACU` 入口捕获 `{ chatKey, isolationKey, chat 数组引用, 消息对象引用, message_id, swipe_id, 原文 }`。
  - 写回前逐项复核，任一不一致就放弃写回，并提示「楼层已变化，本次优化结果已丢弃」。V2 的 `content-replace-store.reoptimizeLatest` 已经这样做，可以抽成一个共享的 `assertOptimizationTargetUnchanged_ACU` 给两边共用。
  - 更稳的做法：让 `replaceChatMessage_ACU` 接受 `expected: { messageRef, messageId, mes }`，不一致时返回 false。所有调用方因此受益。
  - 可选：MESSAGE_DELETED / MESSAGE_SWIPED / CHAT_CHANGED 时调用 `cancelContentOptimization_ACU`，提前中止在途请求、少烧一次 AI（另见 R9-15）。

**R9-02 [P1 已坐实] 「覆盖最新层」提交后不重建 SQLite runtime，runtime 与回放分叉**
- 位置：
  - 表现层调用方：`src/presentation/triggers/data-admin-ui.ts:430-436`（`overrideLatestLayerWithTemplate_ACU`，公开 API `overrideWithTemplate`）。提交后只调用 `loadOrCreateJsonTableFromChatHistory_ACU()` 和 `refreshMergedDataAndNotifyWithUI_ACU()`，没有 `reloadStorageProvider()`。
  - 同源的 V2 调用方：`src/presentation-v2/composables/useDataManagement.ts:838-841`，同样缺 reload。
  - 服务层：`src/service/chat/chat-service.ts:2239-2270`。apply 回调只返回在事务外算好的 `nextTableData`，不碰 provider；`runTableUpdateCommit_ACU` 提交后只做 `_set_currentJsonTableData_ACU`（`table-update-commit.ts:469`）。
  - 对照：同文件里的范围删除 `deleteLocalDataInChat_ACU` 会在 `loadOrCreate` 之后再调用 `reloadStorageProvider()`（`data-admin-ui.ts:213-214`）；`table-import-service.ts` 走 `replaceAllData`。
- 现象/触发路径：
  1. SQLite 内存库里有 A、B 两行。用户执行「覆盖最新层」，`sheet_replace` 帧写入最新 AI 楼，canonical 视图和回放都只剩表头。
  2. SQLite 引擎没有被重建，仍然持有 A、B 两行。
  3. 下一次任何写入（AI 填表、CRUD、原生 SQL）都在引擎上执行，`_syncToJson` 把引擎全量导出成新的 canonical 视图，A、B 重新出现在 UI 和世界书注入里。
  4. 持久化的增量日志里只有新语句，回放时以 `sheet_replace` 为基底，于是回放结果只有新行。新行在 runtime 里的 row_id 是 3，在回放里是 1。
  5. 后果：
     - 用户以为清空了的数据又回来了；
     - 重开聊天后又消失；
     - 锁、向量索引这类按 row_id 挂靠的数据在 runtime 与回放之间错位。
- 证据：探针 `zz-review-probe-r9-override.test.ts`（真实 `SqlTableService` + 真实 persist / replay）：
  - 覆盖后 canonical = `[表头]`，runtime = `[表头, A(1), B(2)]`，回放 = `[表头]`。
  - 再插入 C 之后，runtime 和 canonical = `[表头, A(1), B(2), C(3)]`，回放 = `[表头, C(1)]`。
- 修法方向：
  - 最小修法：两个调用方在提交成功后补 `if (isSqliteMode()) await reloadStorageProvider();`，与范围删除保持一致。
  - 更好的修法：把 `overrideLatestLayerWithTemplateCore_ACU` 的 apply 改为基于 `workingData` 构造 `nextTableData`（目前用的是事务外的 `currentJsonTableData_ACU` 快照），并在事务内通过 provider 的 `replaceAllData` / 按表 DELETE 同步 runtime（参照 `table-import-service.ts` 的 `restoreRuntimeDataInTransaction_ACU`）。这样服务层的所有调用方都不必各自记得 reload。

**R9-03 [P1 已坐实] 删楼与滑动落在同一防抖窗口时，删楼 checkpoint 前移恢复被跳过**
- 位置：`src/presentation/bootstrap/chat-mutation-scheduler.ts:36`（`latestReason_ACU` 单值）、`:43`（每次调度都覆盖）、`:85`（只有 `latestReason_ACU === 'chat_modified_deleted'` 才调用 `recoverLostCheckpointsAfterMessageDeletion_ACU`）、`:92-100`（随后无条件冷 reload）。
- 现象/触发路径：
  1. 用户删掉一楼（这一楼恰好带着 full checkpoint / 休眠表 perSheetCheckpoints / 过渡根），MESSAGE_DELETED 调度一轮，1.2s 后执行。
  2. 1.2s 内用户又在某楼滑动（例如删掉最后一楼后，立刻对新的最后一楼 swipe 重新生成），MESSAGE_SWIPED 把 `latestReason_ACU` 改成 `chat_modified_swiped`。
  3. 合并后的这一轮看到的原因是「滑动」，于是跳过 checkpoint 前移恢复，直接 `reloadStorageProvider()` 冷回放。按 `checkpoint-delete-guard.ts` 头注释，这种回放会判定「无根 / 休眠数据丢失」。
  4. 保管库（vault）此时还留着被删楼的影子副本，但 swipe 触发的新生成会走自动填表并保存。post-save 监听会按当前聊天重建 vault（`checkpoint-delete-guard.ts:253-259`），影子副本随之被丢弃，丢失就此固化。
  5. 删楼轮正在执行时又来一个 swipe 也一样：`pendingAfterRun_ACU` 补跑时同样只看最新原因。
- 证据：探针 `zz-review-probe-r9-scheduler.test.ts`：
  - 先调度 `deleted`，300ms 后调度 `swiped`，推进计时器后 `reload` 被调用 1 次，`recoverLostCheckpointsAfterMessageDeletion_ACU` 被调用 0 次。
  - 对照用例（只有 `deleted`）中恢复被调用 1 次。
- 修法方向：
  - 把「本轮是否含删楼」做成粘性标志：`hasPendingDeletion_ACU ||= reason === 'chat_modified_deleted'`，执行时读取并清零（执行中到达的删楼要留给补跑轮）。
  - dirty 标记仍可以用最新原因，或者有删楼时优先标为 deleted。
  - 恢复本身是幂等的（只嫁接已不在数组里的引用），对纯滑动轮多跑一次也没有副作用，所以也可以干脆每轮都跑。

---

## P2

**R9-04 [P2 已坐实] 原生 SQL API 完全绕过表格锁与隐藏列守卫；CRUD deleteRow 的外键级联也能删到锁定行**
- 位置：
  - `src/presentation/bootstrap/api-groups/sql-api.ts:552-596`（`executeSqlMutation` → `runSqliteRuntimeMutationCommit_ACU` → `provider.executeMutation`）。
  - `:598-675`（`executeSqlBatch` → `provider.applyEditsBatch(..., 'raw_sql_api')`），`:677-702`（`executeSql` 的写分支复用前者）。
  - 服务层对照：`sql-table-service.ts:2056-2079`（`executeMutation`：只做 rebind 和 run，没有锁和隐藏列处理）、`:1858-1900`（`applyEditsBatch`：同样没有），而 AI 路径 `applyEditsWithSystemRowIds`（`:1927` 隐藏列守卫，`:1980-1996` 在同一事务内调用 `enforceTableLocksAfterSqlApply_ACU`）两者都有。
  - CRUD：`table-crud-api.ts:41-61` 的 `findTableLockViolationForCrud_ACU` 只检查目标表；deleteRow 同样走 `executeMutation`。引擎开着 `PRAGMA foreign_keys = ON`（`sqlite-engine.ts:197`），R2A-12 修复的「外键级联不能绕过锁定」只生效在 `enforceTableLocksAfterSqlApply_ACU` 里。
- 现象/触发路径：
  1. CRUD 的注释（`table-crud-api.ts:37-38`）明确写了「锁不再只防 AI，也防外部脚本」。但同为外部入口的 `executeSqlMutation('UPDATE t SET c=? WHERE row_id=1')`、`executeSqlBatch('DELETE FROM t WHERE row_id=1')` 可以直接改写或删除被行锁、单元格锁锁住的行。
  2. 隐藏列（模板删列后保留的休眠列）在 AI 路径上禁止引用，原生 SQL 可以随意读写。
  3. 自定义模板里写了 `FOREIGN KEY ... ON DELETE CASCADE` 时，CRUD `deleteRow(父表, n)` 只检查父表的锁，级联会删掉子表里被锁定的行。
  4. 原生 SQL 默认还允许 CREATE / ALTER / DROP（`strictDml` 是 opt-in）。这一条是既定公开面，本身不算 bug；它和上面两点叠加，说明 API 层没有任何模板作用域的保护。
- 证据：探针 `zz-review-probe-r9-rawsql-lock.test.ts`（真实 `SqlTableService` + 真实锁模块）。
  - 用 `saveTableLocksForSheet_ACU` 锁住 row_id=1，`getTableLockIdentitiesForSheet_ACU` 确认锁已生效。
  - `executeSqlMutation` UPDATE 返回 `{changes:1, saved:true}`，值被改成 99。
  - `executeSqlBatch` DELETE 返回 `success:true`，该行被删除。
- 修法方向：
  - 让 `executeMutation` 和 `applyEditsBatch` 也接上 `enforceTableLocksAfterSqlApply_ACU`。可以复用 `runBatchWithFinalize`，在事务内恢复锁定目标，并把补偿语句写进持久化语句集，否则回放会分叉。
  - 或者在 API 层对外部来源统一改走 `applyEditsWithSystemRowIds`。
  - 隐藏列：外部写入同样调用 `assertNoHiddenPhysicalColumnMutations_ACU`。如果产品上希望原生 SQL 保留「超级权限」，应在 API 文档和 CRUD 注释里写清楚「锁只约束 AI 与 CRUD」，并给原生 SQL 加一个显式的 `respectLocks` 选项。

**R9-05 [P2 已坐实] CRUD updateCell / updateRow 可以直接改写 row_id**
- 位置：
  - `src/presentation/bootstrap/api-groups/table-crud-api.ts:544-553`（数字列下标只检查 `0 <= idx < headers.length`，列 0 就是 `row_id`）、`:556`（字符串 `'row_id'` 能被 mapper 解析）、`:595`（拼出 `SET row_id = ?`）。
  - `:726-739`（updateRow 遍历数据键时没有排除 `row_id`）。
  - 对照 `:873`：insertRow 明确跳过 `row_id`。
- 现象/触发路径：
  1. `updateCell('表', 1, 0, 99)` 或 `updateRow('表', 1, { row_id: 99 })` 生成 `UPDATE ... SET row_id = 99 WHERE row_id = '1'`，执行成功并持久化。
  2. 锁检查只看「目标列是否被锁」。`row_id` 不会出现在列锁里，所以只要该行没被整行锁定就放行。
  3. 行身份改变后：
     - 该行的单元格锁（`[旧 row_id, 列名]`）指向不存在的行，锁静默失效；
     - 纪要向量索引、交火镜像这些按 row_id 记录的数据与表格错位；
     - 新值与已有 row_id 冲突时报 UNIQUE 错误；非整数会报 datatype mismatch。
  4. 这和填表提示词里「禁止手写 row_id」的系统约定相矛盾。
- 证据：探针 `zz-review-probe-r9-crud.test.ts` 用例 3、4：两种写法都返回 true，生成的 SQL 为 `UPDATE \`beibaowupinbiao\` SET \`row_id\` = ? WHERE \`row_id\` = ?;`，参数 `[99, '1']`。
- 修法方向：updateCell 拒绝列 0 和任何解析为 `row_id` 的列名；updateRow 与 insertRow 一样，跳过或拒绝 `row_id`（以及中文别名「行号」）。拒绝时返回 false 并记 error，不要静默忽略，免得调用方以为改成功了。

**R9-06 [P2 已坐实] 数据对象里的选项字段在 SQLite 下被当列名，整笔写入被拒**
- 位置：
  - `table-crud-api.ts:283-301`（`parseMutationOptions_ACU(options, rowData)` 从行数据里读取 `isImportMode` / `skipNotify` / `silent`）。
  - `:702-704`、`:727`（updateRow 只跳过 `isImportMode`）。
  - `:870-881`（insertRow 一个都不跳过，未解析列直接 `return -1`）。
- 现象/触发路径：
  1. 旧调用约定是 `insertRow('表', { 名称: 'x', isImportMode: true })`，解析器也明确支持从数据对象里读这个标志。
  2. SQLite 分支随后把 `isImportMode` 当列名交给 mapper，`resolved=false`，于是整笔写入失败，返回 -1。
  3. updateRow 带 `silent: true` / `skipNotify: true` 时同理，整笔返回 false。
  4. 开局脚本用 isImportMode 批量写入时，所有 insertRow 都失败，而且失败只记在日志里。
- 证据：探针 `zz-review-probe-r9-crud.test.ts` 用例 1、2：insertRow 返回 -1，updateRow 返回 false，`executeMutation` 都没有被调用。
- 修法方向：抽一个 `OPTION_KEYS_IN_ROW_DATA_ACU = ['isImportMode','skipNotify','silent']`，在 parse 阶段读完后从数据副本中删掉；三个写入方法统一只遍历清洗后的数据。

**R9-07 [P2 已坐实] 合并配置导入/导出这对公开 API 被失效的旧弹窗引用拖垮，导入是半截导入**
- 位置：
  - `src/presentation/triggers/data-admin-ui.ts:92-170`（`importCombinedSettings_ACU`），`:126` 先 `applyCombinedSettingsImport_ACU`（内部会保存），`:134-138` 访问 `$popupInstance_ACU.find(...)`（恒为 null）。
  - `src/presentation/triggers/update-trigger.ts:38-42`（`exportCombinedSettings_ACU` 从 `getCharCardPromptFromUI_ACU()` 读提示词）；`plot-editors.ts:202-203`（容器引用恒为 null，返回 []）。
  - 公开入口：`api-groups/data-admin-api.ts:57-58`。
- 现象/触发路径：
  1. 导入：只要文件里有 `mergeSummaryPrompt` 或 `autoMergeEnabled`，`applyCombinedSettingsImport_ACU` 就会返回包含 `mergeTargetCount` 的字段列表。本库导出的文件一定带这两项。
  2. 提示词与合并设置此时已经保存，并弹出「提示词预设已成功导入并保存！」。
  3. 紧接着 `$popupInstance_ACU.find` 抛出 TypeError，被外层 catch 吞成「导入失败: Cannot read properties of null (reading 'find')」。表格模板这一半没有应用。
  4. 用户看到先成功后失败，实际上配置被改了一半，而且没有回滚。
  5. 导出：`getCharCardPromptFromUI_ACU()` 恒返回 []，`exportCombinedSettings_ACU` 永远弹出「没有可导出的提示词」并返回 false。公开 API `exportCombinedSettings` 恒为 false。
- 证据：探针 `zz-review-probe-r9-combined.test.ts`（jsdom，2/2）：
  - 导出返回 false，toast 为 `['warning','没有可导出的提示词。']`；
  - 导入时 `applyCombinedSettingsImport_ACU` 调用 1 次，`applyTemplateSnapshotToScope_ACU` 调用 0 次，toast 序列为 `success → error("Cannot read properties of null (reading 'find')")`。
- 修法方向：
  - 删掉 `:134-138` 这段旧弹窗同步（合并 UI 已停用）。
  - 导出改为从 `settings_ACU.charCardPrompt` 读取，不再读 DOM。
  - 把导入改成「先校验并准备模板，再一次性写入设置与模板，失败整体回滚」。至少要做到：模板失败时回滚 `applyCombinedSettingsImport_ACU` 写入的字段（它内部已有 snapshot，可以暴露一个 rollback 函数）。

**R9-08 [P2 已坐实] 手动确认模式多轮优化：末轮「跳过」时前几轮已确认的结果被丢掉，UI 却报成功**
- 位置：
  - `src/presentation/components/optimization-ui/optimization-ui-exec.ts:607-628`（末轮 skip 分支）。注释写着「如果有之前的优化，应用之前的结果 / 注意：这里需要应用之前累积的优化内容」，但没有调用 `replaceChatMessage_ACU`，还连续两次 `await triggerAutomaticUpdateIfNeeded_ACU()`（`:624`、`:630`）。
  - 前几轮「应用并继续」不写回：`optimization-ui-diff.ts:191-203`（只有 isLastLoop 才写）。
- 现象/触发路径：
  1. 设置 `loopCount=2`、关闭自动应用。第 1 轮点「应用并继续」：前端只把结果作为第 2 轮的输入，不写回。
  2. 第 2 轮点「跳过」：既不写回第 1 轮的结果，也不写回第 2 轮的结果。
  3. 仍然提示「正文优化完成，共 2 轮优化，累计 1 处改进」，消息保持原文，用户确认过的修改丢失。
  4. 同一分支触发两次自动填表。第一次成功时第二次被判重挡住，第一次失败时会再烧一轮 AI。
- 证据：探针 `zz-review-probe-r9-optconfirm.test.ts`：`replace` 调用 0 次，楼层仍是「原文 屋檐」，`triggerAutoUpdate` 被调用 2 次，toast 为 `success: 正文优化完成，共 2 轮优化，累计 1 处改进`。
- 修法方向：
  - 递归时把「最近一次被应用的内容」作为参数传下去（目前 `currentContent` 只在 apply 分支更新）。末轮 skip 且有累计优化时写回这份内容（写回前按 R9-01 复核身份），然后只触发一次填表。
  - 如果产品语义就是「跳过末轮 = 放弃全部」，toast 应改成「已放弃本次优化」，并删掉误导性注释。

**R9-09 [P2 已坐实] 重新优化对话框把 AI 返回的 summary 未转义插入 DOM**
- 位置：
  - `src/presentation/components/optimization-ui/optimization-ui-exec.ts:187`（`<p>${result.summary}</p>`，经 `jQuery('body').append` 插入）。
  - 来源：`src/service/optimization/content-optimization.ts:343` / `:626` / `:654`，都直接取模型 JSON 里的 `summary` 字段。
  - 同模式：`optimization-ui-diff.ts:70`（调用方目前只传常量，暂时安全）、`:217`（`showOptimizationDiff_ACU`，无调用方，`escapeHtml:false` toast）。
- 现象/触发路径：
  1. 公开 API `reoptimizeMessage(n)` 或对话框里的「再次优化」→ `performContentOptimization_ACU` → AI 返回 `{"summary":"<img src=x onerror=...>", ...}`。
  2. 这个 summary 原样拼进对话框 HTML，在酒馆主窗口执行。
  3. 正文优化的输入就是 AI 楼正文。被注入的角色卡或世界书可以诱导模型输出这类 summary，模型被提示注入后也可能自己输出。
  4. 同一对话框里的 original / plan / optimized 都经过了 `escapeHtml_ACU`，唯独 summary 漏掉了。
- 证据：调用链完整追踪（上述三处 summary 来源都没有任何转义或净化；`optimization-ui-exec.ts:187` 与 `:200-204` 同处一个模板字符串）。
- 修法方向：对 `:187` 和 `optimization-ui-diff.ts:70` 都套上 `escapeHtml_ACU(String(result.summary || ''))`，同时删掉死函数 `showOptimizationDiff_ACU`（见 R9-11）。另外，`toast.ts` 在标准 toastr 路径下对 `escapeHtml:false` 的消息不做净化，只有 repair 路径才会净化，因此所有 `escapeHtml:false` 的调用点都必须保证插值全部可信。目前 7 处活跃调用点都只拼常量，已核对。

**R9-10 [P2 已坐实] 启动链 initWithChatId 缺少 mid-run 身份复检，可能把旧聊天数据以新聊天身份 hydrate**
- 位置：
  - `src/presentation/bootstrap/init.ts:1089-1160`（`initWithChatId`：`loadAllChatMessages` → `refreshMergedDataAndNotifyWithUI` → `captureCheckpointVault` → 用 `currentChatFileIdentifier_ACU` 和 `getRuntimeLifecycleEpoch_ACU()` 的「当前值」构造 envelope → hydrate）。
  - 对照：`:388-449` 的 CHAT_CHANGED 延迟链在每个 await 之后都调用 `shouldAbortDelayedRebuildMidRun_ACU`。
  - 等待窗口：`src/presentation/components/pipeline-ui-helpers.ts:64-67`（`refreshMergedDataAndNotify_ACU` 返回后，若通知了前端还会再等 800ms）。
  - hydrate 只比对 envelope 自带的身份：`service/table/table-storage-strategy.ts:364-376`。
- 现象/触发路径：
  1. 页面加载，chatId 可用，1s 后 `initWithChatId(A)` 开始执行。
  2. `refreshMergedDataAndNotify_ACU` 对 A 算出 `mergedData`（它自己的切聊检测此时没有触发），随后进入 800ms 回读等待。
  3. 用户在这段时间切到 B。CHAT_CHANGED 的同步段清空派生缓存、dispose provider（epoch 加 1），并把新的重建链登记为待跑（running 被 A 占着）。
  4. A 链醒来，用此刻的 `currentChatFileIdentifier_ACU = B` 和新的 epoch 构造 envelope，数据却是 A 的 `mergedData`。身份预检全部通过，A 的表被 hydrate 成 B 的 runtime 并发布 canonical 视图。
  5. A 链结束后才补跑 B 的重建链。在补跑完成前（一次 loadAll + replay + 800ms + hydrate），B 的 runtime 和 UI 显示的是 A 的表。如果这段时间里有 CRUD / 原生 SQL 写入（开局脚本常见），会以 A 的数据为基底写进 B。
- 证据：调用链完整追踪。envelope 的 `chatIdentity` / `lifecycleEpoch` 取自构造时刻（`init.ts:1127-1134`），而不是链开始时刻；`initWithChatId` 全程没有调用 `shouldAbortDelayedRebuildMidRun_ACU`。没有写探针：init 测试工装默认 chatId 为空、走轮询分支，要改造工装。
- 修法方向：
  - `initWithChatId` 开头捕获 `scheduledChatIdentifier` 和 epoch，在每个 await 之后调用 `shouldAbortDelayedRebuildMidRun_ACU`，与 CHAT_CHANGED 链保持一致。
  - 更根本的做法：envelope 的身份应当由 refresh 在开始时捕获并随结果一起返回（`refreshResult.chatKey / epoch`），由调用方原样传进 envelope，而不是在 hydrate 前临时读当前值。CHAT_CHANGED 链目前能工作，只是因为复检和构造之间恰好没有 await；这个不变式很脆弱。

---

## P3

**R9-11 [P3 已坐实] 旧 jQuery 弹窗层整体失效，大量死代码与空转**
- 位置：
  - `src/presentation/state/ui-refs.ts:55`（`_set_$popupInstance_ACU`）、`:58`（`_assignUIPlaceholders_ACU`）：全库除 `plot-editors.ts:236/379`（它们本身被 `$popupInstance_ACU &&` 判空挡住）外没有任何调用方。`$popupInstance_ACU` 和约 45 个 `$xxx_ACU` 引用恒为 null 或 undefined。
  - 整文件死代码：`triggers/settings-ui-sync/settings-ui-api.ts`（导出的 8 个函数都没有活调用方，V2 用的是 service 层同名函数）。
  - 空转或无调用方的函数：
    - `update-status-display.ts` 的 `updateCardUpdateStatusDisplay_ACU`：每次 refresh 都调用，立即 return；
    - `template-preset-ui.ts` 的 `loadTemplatePresetSelect_ACU` 等；
    - `plot-editors.ts` 的 `renderPromptSegments_ACU` / `getCharCardPromptFromUI_ACU` / 任务编辑器一组函数；
    - `optimization-ui-rules.ts` 全部（无调用方，且对 null 直接 `.find` 会抛错）；
    - `status-display.ts` 的按钮同步；
    - `settings-ui-connect.ts` 的 `fetchModelsAndConnect_ACU` / `updateApiStatusDisplay_ACU`；
    - `settings-ui-trigger.ts` 的 `getSelectedManualSheetKeys_ACU`；
    - `collectManualExtraHint_ACU`：复选框恒不存在，手动额外提示永远收集不到；
    - `data-admin-ui.ts` 的 `deleteLocalDataInChat_ACU` / `applyPurgeResultToUi_ACU`；
    - `optimization-ui-diff.ts` 的 `showOptimizationDiff_ACU`。
  - `settings-ui-connect.ts:7-15` 和 `settings-ui-trigger.ts:14-17` 经 `plot-editors.ts:626-631` 转手导入 state-manager 的状态，UI 组件模块成了状态中转站。
- 影响：R9-07 的功能故障就是这一层直接导致的；其余部分是维护负担，还会误导后续审查（例如 R8 系列曾按「旧弹窗仍在」去推理触发路径）。
- 修法方向：先把还活着的入口（`importCombinedSettings` / `exportCombinedSettings`，以及 `collectManualExtraHint_ACU` 是否改用 V2 设置）改到不依赖 DOM，再整体删除 ui-refs 与上述函数，测试同步清理。

**R9-12 [P3 已坐实] 存储模式恒为 SQLite 后遗留的死分支**
- `src/presentation/bootstrap/api-groups/table-crud-api.ts`：四个方法的 `else`（非 SQLite）分支，约 250 行（`:618-669`、`:769-837`、`:922-975`、`:1052-1098`），以及仅为它们服务的 `createStableRowIdReservation_ACU` 补行逻辑。`isSqliteMode()` 恒为 true（`service/table/storage-mode.ts:17`）。
- `triggers/settings-ui-sync/settings-ui-trigger.ts:278`：`useGroupedAutoUpdates = !isSqliteMode()` 恒为 false，`:283-312` 的分组进度 toast / 终止按钮和 `processGroupedUpdates` 委托永远不会走到。
- `triggers/update-trigger.ts:58-67`：合并导出仍然写入已停用的 merge / autoMerge 字段（导入端对 autoMerge 恒置 false）。
- 修法方向：删除上述分支和字段，减少「看起来支持原生模式」的误导。

**R9-13 [P3 已坐实] 自定义确认框被新弹框顶掉时，旧 Promise 永不 settle**
- 位置：`src/presentation/theme/custom-confirm.ts:56`（新弹框先调用 `removeExistingConfirm()`）、`:175-187`（resolve 只挂在按钮和遮罩的 click 上）。
- 现象：第一个 `await showCustomConfirm_ACU(...)` 还没回答时又弹第二个（例如手动更新与另一处确认几乎同时触发），第一个弹框的 DOM 被删掉，它的 Promise 永远不 resolve。调用方的 finally（例如 `handleManualUpdate_ACU` 里的按钮复位）不会执行。
- 修法方向：模块级保存当前弹框的 `resolve`，`removeExistingConfirm` 时先 `resolve(false)`。另外文件内自带的 `escapeHtml_ACU` 与 `shared/html-helpers` 的同名函数重复，可以合并。

**R9-14 [P3 已坐实] 锁 API 与 CRUD API 的行下标口径不一致**
- 位置：`api-groups/table-lock-api.ts:66-120`（`lockTableRow(sheetKey, rowIndex)` 等，经 `helpers-table-lock.ts:72-77` 解析为 `content[rowIndex+1]`，即 0 基数据行）；`api-groups/table-crud-api.ts:258-264`（`rowIndex` 中 1 表示第一个数据行），且 CRUD 用表名、锁 API 用 sheetKey。
- 现象：第三方脚本用同一个 `rowIndex` 先 `updateCell('表', 2, ...)` 再 `lockTableRow(key, 2)`，锁住的是下一行。仓库里也没有 API 文档说明这一差异。
- 修法方向：在锁 API 上新增按 `row_id` 寻址的方法（身份锁本来就以 row_id 存储），旧的下标方法在 JSDoc 和对外文档里写明是 0 基。

**R9-15 [P3 已坐实] 「聊天变更中止」的注释与实际调用面不符**
- 位置：`src/service/runtime/state-manager.ts:530`、`:540-541`（注释写「删楼/ROLL/切聊天时中止在飞的依赖楼层调用」）；`src/presentation/bootstrap/init.ts:552` 是唯一调用点（CHAT_CHANGED）；`init.ts:1035-1043` 的 MESSAGE_DELETED/SWIPED 只调度刷新，不中止任何在飞请求。
- 影响：后续维护者容易以为删楼或滑动时在飞的填表、正文优化会被中止。R9-01 就是建立在这个误解之上的漏洞。是否需要在删楼或滑动时中止在飞填表，应在第 2a 块的写回守卫里一并确认。
- 修法方向：要么在 MESSAGE_DELETED / MESSAGE_SWIPED 处理里同样调用 `abortOnChatMutation_ACU()` 和 `cancelContentOptimization_ACU()`，要么把注释改成「仅 CHAT_CHANGED」。

**R9-16 [P3 已坐实] 重复定义与「恒报成功」的小问题**
- `openVisualizer` 在 `data-admin-api.ts:63-76` 和 `settings-config-api.ts:102-115` 各定义一次，`api-registry.ts:55-61` 每次启动都打一条重名 warn。删掉其中一份即可。
- `settings-config-api.ts:228-231`、`:242-244`（`setManualSelectedTables` / `clearManualSelectedTables`）和 `plot-preset-api.ts:197-209`（`importPlotPresetFromData`）：先改 `settings_ACU`，再调用 `saveSettingsAndNotify_ACU()`，忽略返回值，然后恒返回 true / `success:true`。同文件的 `setUpdateConfigParams` 已改为「事务式写入 + 失败回滚」，这几处没跟上。

**R9-17 [P3 待坐实] 运行时 canonical 对象原样交给第三方**
- 位置：`api-groups/core-data-api.ts:36-38`（`exportTableAsJson` 返回 `currentJsonTableData_ACU` 本体）、`api-groups/callback-api.ts:40-44`（更新回调收到的也是本体）。
- 推断影响：常见的第三方写法是「`const d = api.exportTableAsJson(); d.sheet_x.content.push(...)`」。这会直接改写运行时 canonical 视图：世界书注入、CRUD 的锁判定与目标定位、`initialData` 快照都读它，而这些修改既不进 SQLite、也不落盘，下次 `_syncToJson` 时才被覆盖。没有写探针确认具体会在哪一步造成错写。
- 修法方向：返回 `structuredClone` 后的副本（回调同理），或者冻结后再交出去。

**R9-18 [P3 待坐实] 自动填表的合并跟发跨聊天存活**
- 位置：`triggers/settings-ui-sync/settings-ui-trigger.ts:177-193`（在途时登记 `pendingAutoUpdateTrigger_ACU`）、`:396-406`（结束后 `queueMicrotask` 补跑，不比对聊天）；CHAT_CHANGED 只清了防抖定时器（`init.ts:557`）。
- 推断影响：A 聊天填表在途时又到达一次 ENDED，登记跟发；用户切到 B；A 的填表结束后补跑的那一轮按 B 的楼层和阈值构建计划，B 有到期表时就会无新消息地烧一轮填表 AI。写入目标是 B 自己的数据，不会串数据，所以只算 P3。
- 修法方向：登记跟发时一并记录 chatKey 和隔离键，补跑前比对；或者在 CHAT_CHANGED 同步段把跟发标志清零。

---

## 已核对、判定为非问题

- **api-registry**：逐键合并时检测重名；SQL 同步读方法用 getter 门控（runtime 未 ready 时为 undefined），切聊、重载窗口会自动隐藏。
- **table-crud-api**：
  - 表名解析依赖活跃 SQLite provider 的 owner-aware `refreshNameMapperForData_ACU`，不可用时 fail-closed；DDL 历史别名只用于定位 sheet，不会成为 SQL 目标；
  - SQL 全部参数化，标识符用反引号转义；
  - `rowIndex` 拒绝 NaN、非整数、`<1` 和越界；header 行不可改；
  - 写入经 `runSqliteRuntimeMutationCommit_ACU`，带隔离键、writeSet、revisionWriteSet，填表进行中会被 `assertNoActiveFillForExternalMutation_ACU` 拒绝；
  - 持久化操作是 `sql_sheet_batch`（带参数），可以回放；
  - insertRow 不带 row_id，由引擎按 `INTEGER PRIMARY KEY` 分配 max+1，回放时状态一致，分配结果也一致；
  - `skipChatSave` 提交以 `persisted:false` 通知。
- **sql-api**：
  - 读接口用 `isSqlReadStatement_ACU`，执行层是 `query_only` + 单语句（`EXPLAIN DELETE` 之类的绕过会被引擎拒绝）；
  - 对外结果不暴露 `syncedView`；
  - `getLastSqlApiError` 返回副本。
- **core-data-api**：
  - `importTableAsJson` / `restoreTableAsJson` 走 `importTableJsonThroughCommit_ACU`（服务层事务、预检、作用域复检，第 2 块已审）；
  - `triggerUpdate` 自身占用 `isAutoUpdatingCard` 并在 finally 释放。
- **data-admin-api 的「布尔契约」**：`importTemplate` / `importCombinedSettings` 在弹出文件选择后就返回 true，后续失败到不了调用方。这是 v9.1.8 为对齐上游 `Promise<boolean>` 文档有意做的取舍，注释写得很清楚，不按 bug 计（但它会掩盖 R9-07）。
- **settings-config-api**：
  - API 预设的读写接口全部改为弃用桩，不再暴露 apiKey；
  - Agent 上下文参数的 patch 只接受已知键，`Number.isFinite` 校验后取整；
  - 提示词段经 `normalizeEditablePromptSegments_ACU` 归一。
  - 未见原型污染：合并配置、剧情预设导入都用 `JSON.parse`，产生的 `__proto__` 只是自有属性；写入 settings 的是固定字段或 spread 副本。
- **worldbook-ai-api `callAI`**：
  - options 白名单，拒绝 apiConfig / apiKey / url / requestHeaders / model 等；
  - 错误日志不打印上游响应体；
  - 重试只针对可重试错误，并透传 Abort。
- **template-preset-api**：
  - `switchTemplatePreset` 把破坏性 blockers 原样返回，`destructiveChangeConfirmed` 必须显式传 true；
  - `importTemplateFromData` 的聊天作用域走协调器，失败如实返回 `success:false`。
- **init.ts**：
  - 幂等卫兵 `mainInitializeDone_ACU` 阻止重复注册事件；
  - 发送意图钩子按元素实例比对后重绑，并过滤 IME 上屏回车；
  - CHAT_CHANGED 链有代次加 running 互斥和补跑、每个 await 之后的 mid-run 复检、失败兜底刷新；
  - GENERATION_ENDED 配对有歧义时 fail closed；
  - 剧情推进写回前后都调用 `plotScopeStillCurrent_ACU`（第 8 块已确认）；
  - 伪装楼层在所有路径上经 finally 交还发送框。
- **handleNewMessageDebounced_ACU**：
  - 排程时记下身份基线，不论有无 intent 都会复检；
  - 物化等待的每一轮都复检 chatKey 和隔离键；
  - 停止代次贯穿各异步阶段；
  - MVU 闸门「合并方」直接放弃，避免同楼双跑。
- **plot-pending-disguise**：
  - 伪装楼层用非数字 mesid，且禁用指针事件；
  - 用户楼经宿主 `messageFormatting` 净化，失败时退回 `.text()`；
  - 发送拦截在捕获阶段 `stopImmediatePropagation`，释放是幂等的；
  - 草稿还原有 60s 超时。
- **toast.ts**：默认 `escapeHtml:true`。7 处 `escapeHtml:false` 的活跃调用点都只拼常量或纯数字（`update-process.ts:255/393`、`settings-ui-trigger.ts:300`、`optimization-ui-overlay.ts:109`、`plot-planning-ui.ts:33`、`summary-vector-index-ui.ts:133`、`optimization-ui-diff.ts:223` 所在函数无调用方）；repair 路径有白名单净化。
- **custom-confirm**：标题、正文、按钮文案都经过转义。
- **chat-mutation-scheduler**：
  - trailing 防抖加 MAX_WAIT，保证同一时刻最多执行一轮；
  - UI 刷新失败不会吞掉向量 dirty 标记；
  - 未建过索引的聊天不入队（避免意外的 embedding 费用）。
  - 原因合并问题见 R9-03。
- **手动更新确认期 TOCTOU**：legacy 入口 `handleManualUpdate_ACU` 不传 `executionSnapshot`，注释已登记。确认框带全屏遮罩，用户在确认期间切聊的可达性很低，不单列。
- **tauri-version-gate**：只在 TT 宿主下判定，读不到版本时 fail-open，不 await 模态窗，同一次加载只提醒一次。

## 探针（scratchpad，已从 `source/tests` 移走）

目录：`C:\Users\zouyu\AppData\Local\Temp\claude\C--Users-zouyu-Downloads--------shujuku-rebuild\6f204fcf-f837-4e7c-9427-27ef9dd3e747\scratchpad\block9`

| 文件 | 覆盖 | 放回位置 | 结果 |
|---|---|---|---|
| `zz-review-probe-r9-optexec.test.ts` | R9-01 | `tests/presentation/` | 2/2 通过（复现） |
| `zz-review-probe-r9-override.test.ts` | R9-02 | `tests/service/table/` | 1/1 通过（复现，打印三方数据） |
| `zz-review-probe-r9-scheduler.test.ts` | R9-03 | `tests/presentation/` | 2/2 通过（复现 + 对照） |
| `zz-review-probe-r9-rawsql-lock.test.ts` | R9-04 | `tests/service/table/` | 1/1 通过（复现） |
| `zz-review-probe-r9-crud.test.ts` | R9-05、R9-06 | `tests/presentation/` | 4/4 通过（复现） |
| `zz-review-probe-r9-combined.test.ts` | R9-07 | `tests/presentation/triggers/` | 2/2 通过（复现） |
| `zz-review-probe-r9-optconfirm.test.ts` | R9-08 | `tests/presentation/` | 1/1 通过（复现） |

运行方式：把文件放回上表的目录，在 `source/` 下执行 `npx vitest run <路径>`。探针里的 import 路径以放回后的位置为基准。
