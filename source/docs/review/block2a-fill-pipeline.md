# Block 2A 代码审查：填表管线（service/table）

审查日期：2026-10-07　范围：`source/src/service/table/` 下填表管线相关文件（只读审查，未改动 src/tests）。

## 阅读覆盖

**全文或核心段落精读**
- `update-orchestrator.ts`：精读 `collectGroupFillResponse_ACU`、`applyUnifiedGroupFillResponsesCore_ACU`、`processGroupedRuntimeChunkCore_ACU`、`executeAutoFillStagingGroups_ACU`、`executeCardUpdateCore_ACU`、`processUpdatesBatch_ACU`、`buildBatchMergeBase_ACU` 系列、`orchestrateManualUpdate_ACU` 前半（到 5504 行左右）
- `table-update-commit.ts`、`table-write-transaction.ts`、`update-scheduler.ts`、`table-fill-staging-session.ts`、`runtime-only-pending-flush.ts`、`runtime-only-pending-state.ts`、`table-lock-enforcement.ts`、`auto-fill-echo-guard.ts`、`manual-fill-planner.ts`、`table-update-queue.ts`、`sql-protocol-markers.ts`、`table-history.ts`
- `sql-table-service.ts`：AI 写路径（`applyEditsWithSystemRowIds`、`materializeSystemRowIdsForSqlInserts_ACU`、`assertNoHiddenPhysicalColumnMutations_ACU`、rebind、锁定强制、快照 apply、`extractTableNamesFromStatements`）

**略读**
- `table-fill-boundary-staging.ts`（精读 `commitStagedSheetsAtFullBoundaryAtomic_ACU` 和 `publishVerifiedBoundaryHead_ACU`，其余略读）
- `manual-catch-up-provisional-bridge.ts`（只读了 establish 的提交段和函数清单）
- `table-service.ts`（只看了 persist 入口和 `checkIfFirstTimeInit_ACU`）
- `table-delta.ts`、`summary-sheet-rowid-timeline.ts`、`manual-update-settings.ts`

**未覆盖**
- `orchestrateManualCatchUp_ACU`（4049–4890）与 `orchestrateManualUpdate_ACU` 后半（chunk 循环、重填末尾原子提交）只扫了调用关系，没有逐行审
- provisional bridge 的 finalize/rollback/recover 状态机
- `sql-table-service.ts` 的 load/hydrate/schema 冻结部分（`loadFromData`、`_ensureTablesFromTemplate`、`_assertRuntimeSchemaCurrent`）
- persist/replay 本体：按分工由另一个 agent 审查，本报告只在确认调用链时引用

## 关键背景（影响多条结论的严重度）

`presentation/triggers/settings-ui-sync/settings-ui-trigger.ts:278` 写的是 `useGroupedAutoUpdates = !isSqliteMode()`。也就是说，**SQLite 模式下的自动填表普通组不走分组统一提交，走的是 legacy 的 `processUpdates_ACU → processUpdatesBatch_ACU → executeCardUpdateCore_ACU`**。下面 R2A-01/03/05 说的“legacy SQL 路径”，就是 SQLite 自动填表的主路径。

## 探针说明

探针是一个临时 vitest 文件，复用 `tests/service/table/update-orchestrator.test.ts` 的 mock 头部，并用真实 `SqlTableService`（sql.js）作为共享 provider。跑完已从仓库删除，副本放在 scratchpad：`zz-probe-block2a.test.ts`。下文“证据”里引用的就是这个探针的输出。

---

## 发现

**R2A-01 [P1 已坐实] SQLite 自动填表（legacy SQL 路径）不校验目标表授权：AI 可以改非目标表，改动会写进 live SQLite 并以 operation 形式持久化**
- 位置：`update-orchestrator.ts:3298-3439`（`executeCardUpdateCore_ACU` 的 SQL 分支）；对比 `update-orchestrator.ts:1852-1893`（统一路径有授权过滤）和 `:3501-3511`（legacy 非 SQL 路径有授权校验）
- 现象/触发路径：调度层按组传 `targetSheetKeys`（例如只授权 `sheet_0`）。AI 的 SQL 里写了 `UPDATE <其他表>`，只要该表在模板内（`requireKnownTables`），就会被 `applyEditsWithSystemRowIds` 在 live 引擎上执行。`buildSqlSheetBatchOperationsFromText_ACU` 按语句目标表分类，把非目标表的 `sql_sheet_batch` 也收进 `operations` 并持久化。`keysToPersist` 虽然过滤掉了非目标表，但这只影响 afterData 快照的键，挡不住 operation。
- 证据：探针 P1，target 为 `['sheet_0']`，AI 输出 `UPDATE other SET v='越权' WHERE row_id=1`：
  `result={"success":true,"modifiedKeys":["sheet_1"]}`，引擎中 sheet_1 = `[["1","越权"]]`，持久化 ops = `[["sql_sheet_batch","sheet_1",["UPDATE feimubiaobiao SET v = '越权' WHERE row_id = 1"]]]`。
  现有测试 `update-orchestrator.test.ts:1579`（“legacy core 拒绝 parsedKeys 中的非 targetSheetKeys”）只覆盖非 SQL 分支，可见意图是拒绝；SQL 分支漏掉了。另外 writeSet 锁只覆盖目标表，非目标表的写入不在锁内。
- 修法方向：在 SQL 分支执行前，复用统一路径 1852-1893 的授权逻辑（按 `getTouchedSheetKeysFromSqlText_ACU` 丢弃或拒绝），最好抽成同一个函数供两条路径共用。

**R2A-02 [P1 待坐实（代码路径已确认，宿主并发未实测）] 边界 staging 汇合和 provisional bridge 用“整聊天数组替换”提交，会吞掉 await 窗口里新增或编辑的消息**
- 位置：`table-fill-boundary-staging.ts:808-810`（克隆快照）→ `:832` await 候选回放 → `:916` await 提交锁 → `:920-921` `chat.length = 0; chat.push(...candidateChat)` → `saveChatToHostStrict_ACU()`；`manual-catch-up-provisional-bridge.ts:627-633`、`:855`、`:963` 是同样的模式
- 现象/触发路径：`candidateChat` 是在两次全聊天回放和等提交锁之前同步克隆的整份聊天。如果这段时间宿主往 `chat` 里 push 了新消息（填表在后台跑，用户继续发言或 AI 正在生成），或者用户编辑/swipe 了某条消息，提交时整数组会被替换成旧快照再严格保存，新消息和编辑就丢了。`assertCandidateWriteSurface_ACU` 比较的是 `liveChatClone` 和 `candidateChat`，两者都来自同一个旧快照，检测不到 live 侧的变化。此外，所有消息对象都会被换成 JSON 克隆，宿主或其他模块持有的引用会失效。
- 证据：完整调用链如上。`commitStagedSheetsAtFullBoundaryAtomic_ACU` 被 `settleStagedBoundaryAndPublish_ACU`（自动填表跨根 staging 和手动重填都会走）调用。没有找到填表期间阻止宿主生成或发言的机制（`isAutoUpdatingCard_ACU` 只拦截本扩展的外部写入）。
- 修法方向：提交时只回写目标楼层的 `TavernDB_ACU_IsolatedData`（类似 persist 层的 `replacementIsolatedDataByMessageIndex`）。或者在持锁后比对 live chat 的长度和消息指纹，不一致就 fail-closed。

**R2A-03 [P2 已坐实] SQL 先提交到 live 引擎，后面的新鲜度检查或持久化一旦抛异常，运行时不回滚也不重载，留下“孤儿行”**
- 位置：`table-update-commit.ts:355-406`，`requiresRuntimeReload` 只在 `saveResult.saved === false` 时置位（401 行）；`table-service.ts:267` 的 `assertFresh` 和 `storage-frame-v2-persist.ts:2709` 等处是 throw，不是返回 `saved:false`；`update-orchestrator.ts:2063-2064` 失败时只把 JSON 视图重置为 baseSnapshot，不碰引擎
- 现象/触发路径：runtime SQL 的 apply 在 `runCommit` 内直接 `engine.runBatchWithFinalize` 并 COMMIT。之后任何 throw 都会让引擎保留这批行，而聊天里没有：基线过期（例如 AI 等待期间发生 `reloadStorageProvider` 导致 all-revision bump）、persist 内部异常、`beforePersist` 抛错、`assertPersistableRowIdentities_ACU` 失败、`buildSqlSheetBatchOperationsFromText_ACU` 失败（这一种返回 `'model'`，还会触发重试）。下一轮填表的基底取 live runtime（`readLiveSqliteRuntimeMergeBase_ACU`），AI 会把孤儿行当成已存在。重载之后这些行消失，基于它们的 UPDATE 在回放里也会落空。legacy 路径连 JSON 视图都不重置，界面上看起来像已保存。
- 证据：探针 P2，persist mock 抛出 `runtime revision conflict`：`result.success=false`，引擎 sheet_0 = `[["1","孤儿行"]]`，`reloadCalls=0`，JSON 视图也是 `[["1","孤儿行"]]`。对照组 P2b（`saved:false`）：`reloadCalls=1`。
- 修法方向：两条路取一。(1) 在 `runTableUpdateCommit_ACU` 的 catch 里，只要 apply 已经成功返回（引擎已变更）就一律 reload；(2) apply 前先 `createRuntimeSnapshot()`，失败时 `restoreRuntimeSnapshot()`。另外，`assertFresh` 应该在 apply 改引擎之前就检查一次。

**R2A-04 [P2 已坐实（代码路径）] 持久化失败触发的 `reloadStorageProvider` 会冲掉 runtime-only（skipChatSave）未落盘的行，包括 flush 自己正要写回的那批**
- 位置：`table-update-commit.ts:399-402, 427-433`；`runtime-only-pending-flush.ts:171-279`；`table-storage-strategy.ts:308-342`（`initStorageProvider({ forceNewFlight: true })` 从聊天重新回放）
- 现象/触发路径：runtime-only flush 本身也走 `runTableUpdateCommit_ACU`。它的 persist 一旦返回 `saved:false`（例如兼容只读历史门闸、镜像不变量、写时严格探针），就会 `reloadStorageProvider()` 从聊天重建运行时，而待写回的行只存在于运行时，会被直接丢掉。flush 失败分支随后又补登记了 pending（275 行），但运行时已经没有差异，下一次 flush 判定“与回放一致”就清掉登记。结果是前端脚本写入的行静默丢失。任何普通填表提交的 `saved:false` 也会同样冲掉尚未 flush 成功的 runtime-only 行（flush 失败时只记 warn、继续提交，见 `table-update-commit.ts:231-238`）。
- 证据：调用链如上；reload 行为由现有测试 `table-update-commit.test.ts:244-272` 确认（`saved:false` 后 `reload` 被调用）。`runtime-only-pending-flush.test.ts` mock 掉了 `runTableUpdateCommit_ACU`，没有覆盖这一交互。
- 修法方向：flush（`source:'system'` 且 `skipRuntimeOnlyPendingFlush`）失败时不 reload。或者 reload 前把 pending 表的运行时内容取出来，reload 后重新注入并保留登记。

**R2A-05 [P2 已坐实] legacy SQL 路径绕过隐藏列守卫：守卫检查的是“未去 HTML 注释标记”的原文，执行的是去标记后的文本**
- 位置：`update-orchestrator.ts:1496-1499`（collect 阶段用 `splitSqlStatements(tableEditText)` 检查原文）；`sql-table-service.ts:1904-1923`（`applyEditsWithSystemRowIds` 执行的是 `normalizeSqlStatementsForRuntimeLog_ACU` 的结果，内部不再调用 `assertNoHiddenPhysicalColumnMutations_ACU`）；统一路径在 `update-orchestrator.ts:1831` 有二次校验，legacy 路径没有
- 现象/触发路径：`<!--` 里含 `--`，守卫的 tokenizer 会把它当成行注释，跳过同一行后面的内容；`stripHtmlCommentMarkersOutsideSqlLiterals_ACU` 去掉 `<!--` 之后，那段文本就成了真实 SQL。
- 证据：探针 P3，`hiddenPhysicalColumns:['secret']`，AI 输出 `UPDATE test SET v = 'b', <!-- secret = '被改'\n WHERE row_id = 1`：原文守卫结果为 `pass`，规范化后再守卫抛出“不允许引用隐藏物理列：secret”；legacy 实际执行 `success:true`，引擎行 = `["1","b","被改"]`。
- 修法方向：把守卫放进 `applyEditsWithSystemRowIds`（对规范化和 rebind 后的最终语句）作为唯一安全边界；collect 阶段的检查也改成对 `normalizeSqlStatementsForRuntimeLog_ACU` 的结果做。动词白名单（拒绝 DROP/PRAGMA/ATTACH/BEGIN/COMMIT）经核对在两处都生效，且 `splitSqlStatements` 总会在 `;` 处切分，没有发现多语句注入。

**R2A-06 [P2 已坐实] legacy SQL 路径首次初始化时，用模板覆盖“AI 未改动的表”，持久化快照与 live 引擎分叉，并原地改写了 provider 的 canonical 视图**
- 位置：`update-orchestrator.ts:3383-3404`
- 现象/触发路径：`checkIfFirstTimeInit_ACU()` 为 true（聊天中还没有任何 V2 表数据）时，对每个 AI 没改的表执行 `runtimeData[sheetKey] = 模板表`。`runtimeData` 就是 provider 刚发布的 canonical 视图对象（`sql-table-service.ts:1989`），等于原地修改了共享视图。引擎里已有的行（前端脚本 skipChatSave 写入、flush 没成功等情况）不会进入首个 full checkpoint，重载后丢失。统一路径（1996-1998）没有这段逻辑，两条路径行为不一致。
- 证据：探针 P4，sheet_1 在 live 运行时有一行 `["1","原值"]`，AI 只改 sheet_0：persist 的 sheet_1 = `[["row_id","v"]]`，`targetSheetKeys=["sheet_1","sheet_0"]`；引擎 sheet_1 仍是 `[["1","原值"]]`，JSON 视图 = `[["row_id","v"]]`。
- 修法方向：SQL 路径直接用 live 运行时导出（种子行已经在 `loadFromData` 时物化），去掉模板覆盖，和统一路径保持一致；至少要先 clone 再改。

**R2A-07 [P2 已坐实] 多个跨根 staging 组放进同一次 `executeAutoFillStagingGroups_ACU` 时，第一组汇合后，后续组的“边界前”结果被静默丢弃**
- 位置：`update-orchestrator.ts:3063-3111`（`settleStagingBoundary` 置 `stagingSession=null`、`boundaryCommitted=true`），`:3085` 之后传 `stagingSession: undefined`
- 现象/触发路径：`maxConcurrentGroups ≥ 2`，并且有 ≥2 个需要 staging 的组。第一组的 post 段触发汇合后，第二组的 pre 段带着 `commitMode:'stage_only'` 但没有 session 去执行，在 `applyUnifiedGroupFillResponsesCore_ACU` 里落进 `runTableUpdateCommit_ACU` 的 stage_only 分支：只设置运行时 JSON（SQLite 下还会在 live 引擎上执行 SQL），不写聊天，也不会再汇合。之后 post 段推进了调度前沿，边界前那些楼层被当成“已填”。
- 证据：探针 P5，两组 A/B（不同表，indices [1,5]，full 根在 3）：`success:true`，4 次 AI 调用，`boundaryCommits=1`，persist 只有 `[5,["sheet_0"]],[5,["sheet_1"]]`。B 在楼层 1 的结果既没有持久化，也没有进入汇合。
- 修法方向：每个组独立建 staging run，或者所有组的 pre 段都跑完再统一汇合，然后再跑 post 段。

**R2A-08 [P2 待坐实] SQLite 自动填表时，`processUpdatesBatch_ACU` 在每个组结束时把全局 `isAutoUpdatingCard` 置 false，并发组下其他组还在跑**
- 位置：`update-orchestrator.ts:3728-3729, 3853-3856`；`update-scheduler.ts:367-404`（无 `processGroupedUpdates` 时按 `Promise.allSettled` 并发跑 `processUpdates`）
- 现象/触发路径：`maxConcurrentGroups ≥ 2` 时，先结束的组会把标志清掉，其余组仍在填表。这时外部写入闸门（`assertNoActiveFillForExternalMutation_ACU`）失效，新的自动填表或手动更新也能通过 in-flight 检查并开始，形成重叠填表。即使串行执行，组与组之间（下一组的 migration/flush await 之前）也有短暂的空窗。同样，`_set_wasStoppedByUser_ACU(false)` 在组开始和结束时都会重置用户的停止信号。
- 证据：调用链如上；没有做并发探针。
- 修法方向：in-flight 标志由调度层（`executeAutoUpdatePlan_ACU`）统一持有，或者改成引用计数；`processUpdatesBatch_ACU` 被调度层调用时不要碰这两个全局标志。

**R2A-09 [P3 待坐实] `buildBatchMergeBase_ACU` 在 `liveRuntimeAuthoritative` 分支无视 `maxMessageIndex`，和函数内注释的约束矛盾**
- 位置：`update-orchestrator.ts:1247-1250` 与 `:1262-1265`
- 现象：注释写“有历史边界时不能让 SQLite latest runtime 越过 maxMessageIndex”，但前面的分支已经直接返回了 live runtime。测试 `update-orchestrator.test.ts:7044` 把“基底 = live runtime”固定为预期行为，所以这是设计选择。代价是：对历史楼层填表时（手动更新的上下文范围、追平的非 staging 段），AI 看到的是未来状态，增量写在较早楼层，回放时可能对不上（UPDATE 命中 0 行是静默的）。
- 修法方向：至少更新注释；对 `saveTargetIndex` 明显早于聊天末尾的 bucket，考虑回落到 bounded replay 或加一层校验。

**R2A-10 [P3 已坐实] `findSqlFailureGroupKey_ACU` 的语句计数口径和引擎不一致**
- 位置：`update-orchestrator.ts:1019-1033`，对照 `sql-table-service.ts:1965`
- 现象：引擎报错里的“第 N 条”是物化并 `filter(Boolean)` 之后的序号（空的 INSERT SELECT 被剔除，锁补偿语句追加在末尾），而这里按 `normalizeSqlStatementsForRuntimeLog_ACU` 的原始条数累加，错误可能归到错误的组。只影响错误提示和重试反馈的归属。
- 修法方向：让 `applyEditsWithSystemRowIds` 抛出带组下标的错误。

**R2A-11 [P3 已坐实] 死代码 / 误导性参数**
- `orchestrateManualUpdate_ACU` 的 `processBatch` 参数完全没用到（函数体内 0 次调用），实际走的是 `processGroupedRuntimeChunk_ACU`。`presentation-v2/composables/useManualUpdate.ts:550-570` 为它构造的 `runProcessBatch → executeCardUpdateCore_ACU` 也是死代码。
- `executeCardUpdateCore_ACU` 的 SQL 路径和 `applyUnifiedGroupFillResponsesCore_ACU` 的 runtime SQL 路径，在授权、守卫、首次初始化、编号这几处已经实际分叉（R2A-01/05/06），属于重复实现漂移的典型。建议 SQLite 自动填表也统一走分组统一提交路径（`settings-ui-trigger.ts:278`）。

**R2A-12 [P3 待坐实] SQL 锁定强制只覆盖语句的直接 mutation 目标表**
- 位置：`sql-table-service.ts:1975`（`modifiedKeysForLocks` 来自 `extractTableNamesFromStatements`，只取目标表）
- 现象：引擎开着 `PRAGMA foreign_keys = ON`。如果作者 DDL 用了 `ON DELETE CASCADE` 或触发器，删除父表行级联到被锁的子表行时，子表不在 `modifiedKeys` 里，锁不会回滚。模板很少用外键，影响面小。
- 修法方向：对所有带锁的表做前后像比对，或者在模板校验阶段禁止 FK cascade 和触发器。

---

## 统计

| 级别 | 数量 | 编号 |
|---|---|---|
| P0 | 0 | — |
| P1 | 2 | R2A-01（已坐实）、R2A-02（待坐实） |
| P2 | 6 | R2A-03、04、05、06、07（已坐实）、R2A-08（待坐实） |
| P3 | 4 | R2A-09、10、11、12 |

## 核对过、未发现问题的点
- AI SQL 动词白名单：`assertNoHiddenPhysicalColumnMutations_ACU` 会拒绝非 INSERT/REPLACE/UPDATE/DELETE 语句；`splitSqlStatements` 无条件在 `;` 处切分，每段只有一条语句，没有找到通过注释或引号把 DROP、ATTACH、PRAGMA、BEGIN/COMMIT 塞进批次的办法。统一路径对 rebind 之后的语句做了二次校验。
- `runBatch` / `runBatchWithFinalize` 用 BEGIN/COMMIT/ROLLBACK 包住整批，锁补偿语句在同一事务里执行。
- `ReadWriteLock_ACU` 和 `runCommit` 在异常路径上都有 finally 释放；`acquireTransactionLocks_ACU` 获取到一半失败时会回滚已拿到的锁。
- `table-history.ts` 的多表单次逆扫是 O(消息数 × 表数)，没有 O² 问题。
