# D07 跨组线索专项核查

> 基线 HEAD `02f7d5dc`。只读复审，未改动任何已有文件；两条探针已在本报告写完后删除（见文末）。
> 任务：逐条查证前 6 个发现组在「跨组线索」里提到、但没有作为发现条目报出的 6 条线索。成立才写发现，不成立写明排除理由。

## 概览

- 结论：**P0 0 条，P1 1 条，P2 3 条，P3 1 条**。
- 6 条线索的处置：
  1. 旧轮标志 / 代次残留压住新聊天自动填表 → **部分成立**：CHAT_CHANGED 后的旧任务会被聊天身份复检挡住（不成立）；但 `isAutoUpdatingCard_ACU` 是全局标志、`update_in_flight` 直接丢弃且不补跑，旧聊天的手动/追平轮在切聊天后仍持有标志的窗口内，新聊天首条回复不会被自动填表 → **D07-02（P2）**。标志「旧轮 finally 放开新轮」本身是第二轮 G03 已登记的设计疑虑，不重报（见「查过但判定没问题的场景」）。
  2. 手动重填清理阶段按旧下标 apply 到 live chat → **部分成立**：清理循环内 `deleteVectorIndexManifestFromTagData_ACU` 在 `deleteExternal:false` 时没有真实 I/O，删楼无法在循环内插进来；但 `saveChatToHostStrict_ACU` 失败后的按索引恢复，以及摘要向量快照 await 之后才进入清理，都会把旧下标/旧聊天写进 live chat → **D07-03（P2）**。
  3. SQL 模式不遵守「仅识别最后一对 `<tableEdit>`」→ **成立** → **D07-01（P1）**。
  4. staging 组共用 AbortController → **部分成立**：同 bucket 的目标下标相同，第二轮「同 bucket 不会误伤」的结论仍然成立；但控制器是**整个 auto staging run 共用**的，一个 bucket 的目标失效会让后续 bucket/segment（目标仍有效）直接以 aborted 结束并记失败 → **D07-04（P2）**。
  5. 合并存盘的 saved=true 与真实落盘时序 → **不成立（不报缺陷）**：向量 flush 按 chatKey 校验且在写 delta 时 strict save 会连同脏表格一起落盘；世界书刷新每步复核聊天身份、切聊天/下次加载会按盘上数据重建。只存在短暂「世界书比盘面新」的窗口，2.7 允许丢批次，且可自愈。
  6. legacy 手动填表确认文案与回滚语义不符 → **成立** → **D07-05（P3）**。
- 读过的范围：
  - **通读/重点读**：`presentation/triggers/settings-ui-sync/settings-ui-connect.ts`（240-574）、`settings-ui-trigger.ts`（130-322）、`presentation/bootstrap/init.ts`（535-592、860-935、1286-1309）、`service/runtime/state-manager.ts`（580-732）、`service/runtime/mvu-analysis-gate.ts`（关键等待/超时段）、`service/worldbook/injection-engine-state.ts`（109-202）、`service/table/update-scheduler.ts`（190-491）、`service/table/update-orchestrator.ts`（自动/手动的编排、staging、收集、重试、清理前后段）、`service/table/table-fill-target-watch.ts`、`table-fill-target-guard.ts`、`service/chat/chat-service.ts`（2400-2918）、`service/table/table-write-transaction.ts`（290-537）、`service/table/storage-frame-v2-persist.ts`（2770-2904）、`service/vector/summary-vector-index-flush-queue.ts`（92-414、687-759）、`service/ai/prompt-builder/table-edit-parser.ts`（1-160）、`service/table/table-update-commit.ts`（293-520）、`presentation/triggers/update-process.ts`（320-420）、`presentation/bootstrap/api-groups/settings-config-api.ts`（110-140）、`presentation-v3/pages/TablePage.vue`（80-98）、`presentation-v2/composables/useManualUpdate.ts`（478-586）。
  - **没读或没把握**：TT 宿主删除当前聊天 / 切聊天时的真实事件顺序（无真机）；staging 实际触发频率（依赖模板切换 / full checkpoint 布局）；摘要向量快照 IDB / 文件读取的实际耗时。
- 重点覆盖：
  - **A（删最新楼层）**：D07-01（SQL 首块）、D07-03（清理恢复）、D07-04（staging 中止）都涉及删楼/滑动的时序；D07-04 的新触发是「滑动当前 bucket 的目标、后续 bucket 仍有效」。
  - **B（删除当前聊天）**：D07-03 的聊天切换变体在宿主「删当前聊天→打开新聊天」下同样成立（旧快照写进新聊天）；已删聊天被 `saveChat` 写回属 D03-03，本条不展开。D07-02 的旧轮标志在删聊天后新开聊天时同样可能压住首条回复。
  - **C（不关闭聊天直接新开）**：D07-02、D07-03 的主场景；D07-01 与重点无关（模型输出形状）。
- 探针：
  - `tests/__probe_deepseek__/D07-refill-cleanup-restore.test.ts`（2 例，均通过，复现清理恢复的跨楼层/跨聊天写入）。
  - `tests/__probe_deepseek__/D07-sql-last-pair.test.ts`（2 例，均通过，复现 SQL 路径 first-block 与解析器 last-pair 的分叉）。
  - 两个文件均已删除（见文末）。

## 发现

### D07-01 [P1｜已坐实（静态代码 + 解析器探针）｜其他（模型输出形状）｜I5] SQL 模式取第一个 `<tableEdit>`，默认「仅识别最后一对」被绕过：草稿 SQL 会被直接执行；草稿为空时整轮以基础设施错误失败且不重试

> 严重度取 P1：默认设置在 SQL 模式下被绕过，草稿 DML 可能静默改写表格。若按 D04-01 的「需特定模型输出」口径，可降为 P2；不改变成立结论。

- **位置**：
  - `source/src/service/table/update-orchestrator.ts:1651`（SQL 模式用 `aiResponse.match(/<tableEdit>([\s\S]*?)<\/tableEdit>/i)` 取**第一个**块）
  - `source/src/service/ai/prompt-builder/table-edit-parser.ts:55-75`（`extractTableEditInner_ACU` 默认 `useLastPairOnly = settings_ACU.tableEditLastPairOnly !== false`，取**最后一对**）
  - `source/src/service/table/update-orchestrator.ts:3468-3477`（SQLite 模式下 `tableEditText` 非空且非 SQL → 直接按 model 错误返回）
  - `source/src/service/table/update-orchestrator.ts:3480-3511`、`:3550`（SQL 分支把 `collectResult.tableEditText` 交给 `applyEditsWithSystemRowIds` 执行）
  - `source/src/service/table/update-orchestrator.ts:3701`（首块为空时落到 JSON 分支的 `parseAndApplyTableEditsToData_ACU(aiResponse, ...)`）
  - `source/src/service/ai/prompt-builder/table-edit-parser.ts:154-158`（JSON 分支拿到最后一对 SQL 后抛 `SQLite SQL tableEdit must be applied through table update commit model.`）
  - `source/src/service/runtime/state-manager.ts:522`（`tableEditLastPairOnly: true` 默认值）；`source/src/presentation-v3/pages/TablePage.vue:91-95`（UI 文案「仅识别最后一对…忽略前面思维链或草稿里的旧指令」）
- **触发**：SQLite 模式下自动/手动填表，模型在同一条回复里输出两个 `<tableEdit>` 块（草稿块 + 正式 SQL 块）。这是该设置本来就要处理的模型行为。
- **现象（两种输入分别验证）**：
  1. **两个非空块，第一个是 SQL 草稿**：`tableEditText` = 第一块；`:1652` 的隐藏列检查使用它，`:3511` 也把 `collectResult.tableEditText` 赋给 `tableEditSqlText`，`:3550` 的 `applyEditsWithSystemRowIds([tableEditSqlText])` 执行**第一块**，第二块被忽略。若草稿是 `DELETE`/`UPDATE`/`INSERT`，会静默改写表格；用户以为只执行了最后一对。
  2. **两个非空块，第一个是非 SQL 草稿**：`:3468-3477` 以「SQLite 填表仅接受 SQL tableEdit」返回 model 错误；第二块合法 SQL 从未被读取，整轮按模型错误重试/失败。
  3. **第一个块为空、第二个是 SQL**：`tableEditText=''`，`:3471` 与 `:3480` 都不进 SQL 分支，落到 `:3701` 的 JSON 分支；`parseAndApplyTableEditsToData_ACU` 用默认 last-pair 取出第二个 SQL，在 `table-edit-parser.ts:155-158` 抛出普通 `Error`。`runTableUpdateCommit_ACU` 把普通 Error 归为 `infrastructure`（`table-update-commit.ts:504-519`），`executeCardUpdateCore_ACU` 对非 model 直接返回、不重试（`update-orchestrator.ts:3848-3855`），整组失败。
- **原因**：SQL 提取点没有走 `extractTableEditInner_ACU`，而是自己写了一个 first-match 正则；两边对 `tableEditLastPairOnly` 的口径不一致。
- **已排除**：grep 了全部 `<tableEdit>` 提取点，只有 `table-edit-parser.ts:61/71` 和 `update-orchestrator.ts:1651` 两处；SQL 模式没有其它 last-pair 兜底。`tableEditLastPairOnly` 默认 true，UI 明确承诺忽略前面的草稿。JSON 分支的 last-pair 行为已由 `tests/service/ai/table-edit-parser.test.ts:105-112` 锁定，但 SQL 路径没有对应用例。
- **测试**：`table-edit-parser.test.ts` 只测解析器，不测 SQL 提取；`update-orchestrator.test.ts` 把 `parseAndApplyTableEditsToData_ACU` / AI 调用 mock 掉，SQL 首块/空首块的分支没有覆盖。探针 `D07-sql-last-pair.test.ts` 直接比较了「解析器取最后一对」与「orchestrator 首块正则」：两例均通过（见文末）。
- **修法方向**：SQL 提取也调用 `extractTableEditInner_ACU(aiResponse)`（尊重 `tableEditLastPairOnly`），再 `.trim()`；若提取为空再按现有「缺 tableEdit」路径处理。保留 `:1652` 的 SQL 判定与隐藏列检查不变。
- **与以前复审的关系**：D04 跨组线索 1 已提到同一根因（D02 路径），但没有作为发现条目报出；本条是独立查证后的成立条目。

### D07-02 [P2｜已坐实（代码路径）；触发时序待真机｜C/B｜I4、I5] 自动填表遇到 `isAutoUpdatingCard_ACU` 为真直接丢弃、不登记补跑；旧聊天的手动/追平轮在切聊天后仍持有全局标志时，新聊天首条回复不会被自动填表

- **位置**：
  - `source/src/presentation/triggers/settings-ui-sync/settings-ui-trigger.ts:176-190`（`checkAutoUpdatePreConditions_ACU` 返回 `update_in_flight` → `logAutoFillSkip_ACU('preconditions_failed', …)` → `return`，没有设置 `pendingAutoUpdateTrigger_ACU`）
  - `source/src/presentation/triggers/settings-ui-sync/settings-ui-trigger.ts:143-151`（只有 `autoUpdateTriggerInFlight_ACU` 为真时才登记 pending；`isAutoUpdatingCard` 为真但 trigger 不在飞时不登记）
  - `source/src/service/table/update-scheduler.ts:236-238`（`isAutoUpdatingCard` → `update_in_flight`）
  - `source/src/service/runtime/state-manager.ts:646-653`（`isAutoUpdatingCard_ACU` 是模块级布尔，没有 chatKey / runId 归属；任何持有者置 false 都会清锁存）
  - `source/src/presentation/bootstrap/init.ts:546-551`（CHAT_CHANGED 只 `abortOnChatMutation_ACU()` + `clearAutoFillDebounce_ACU()`，不复位也不兜底释放该标志）
  - `source/src/service/table/update-orchestrator.ts:4792`、`:5130-5133`（手动追平置位/收尾）；`:5774`、`:6117-6120`（手动重填置位/收尾）
  - `source/src/service/worldbook/injection-engine-state.ts:147`、`:170-173`（切聊天只更新 chatKey、清 runtime，不动 `isAutoUpdatingCard_ACU`）
- **触发**：聊天 A 里用户点了手动重填（或一键追平），破坏性清理 / AI 批次进行中；用户不关闭聊天，直接点开聊天 B（同一角色新聊天或另一个已有聊天）。A 的轮次在切聊天后还要走失败收尾（回滚清理、`loadAllChatMessages`、`reloadStorageProvider`、`refreshData`），这段时间 `isAutoUpdatingCard_ACU` 仍为 true。此时 B 有一条 AI 回复结束，`GENERATION_ENDED` → `handleNewMessageDebounced_ACU` → `triggerAutomaticUpdateIfNeeded_ACU`。
- **现象**：前置检查读到 `update_in_flight`，只记一条 `preconditions_failed` 诊断就返回；没有 pending、没有定时器、没有在 A 的 finally 之后补跑。B 的这条回复不会被自动填表，直到用户再发一条消息（下一次 `GENERATION_ENDED`）或手动补填。表格与 B 的最新楼层不一致，且界面只显示「跳过」日志，没有用户可见提示。
- **原因**：两个问题叠加：
  1. 「正在填表」是全局单标志，不按聊天归属；切聊天不会释放，也没有像「终止填表」那样的 30s 兜底。
  2. 自动填表入口把「已有填表在跑」当成可丢弃事件；只有「另一个自动 trigger 在飞」才有合并补跑，手动/追平持有标志时没有补跑。`_set_isAutoUpdatingCard_ACU(false)` 的「一轮结束」通知目前只被 Go 用量显示订阅（`presentation-v3/parts/OpencodeGoUsage.vue:99`），没有填表补跑订阅者。
- **已排除**：
  - 如果旧轮是**自动填表**：`triggerAutomaticUpdateIfNeeded_ACU` 自己就在飞，B 的触发会走 `:143-151` 登记 pending；旧轮 finally 在 `:306-319` 按 scope 判断，B 的 pending 会补跑（R9-18 的跨聊天用例锁住了「旧 pending 不落到新聊天」，但 B 自己的 pending 是允许的）。所以本条只针对手动/追平持有标志的窗口。
  - 正常 abort 路径（AI 请求可中止）会让旧轮很快收尾，窗口通常只有几秒；本条是「恰好在这个窗口内 B 的回复结束」的时序缺陷，不是永久卡死。下一个 `GENERATION_ENDED` 会恢复。
  - `CHAT_CHANGED` 后旧任务在 MVU/物化等待中继续跑的疑虑不成立，见「查过但判定没问题的场景」1。
- **测试**：`tests/presentation/triggers/settings-ui-trigger.test.ts:70-82` 只断言 `preconditions_failed` 后不构建/不执行计划，没有断言「标志清除后补跑」；`:84-104` 的合并补跑只覆盖 `autoUpdateTriggerInFlight`。`tests/service/table/update-scheduler.test.ts:71-75` 只验证 `update_in_flight` 原因码。没有「手动轮持有标志 + 另一聊天回复结束」的用例。
- **修法方向**：给「正在填表」加聊天归属（或至少记录持有者的 chatKey）；自动入口在 `update_in_flight` 且当前聊天不是持有者时，登记一个带 chatKey 的 pending，在标志释放时按当前聊天补跑一次；或者切聊天时给旧轮设一个有限兜底释放（类似 30s，但不要无条件清掉仍在写的轮次）。更彻底的是把「一轮填表」做成带 runId/chatKey 的对象，释放时只清自己的。
- **与以前复审的关系**：D03 跨组线索 2 已描述同一现象（并称「永久跳过」，实际下一次回复可恢复）；D01 也提到切聊天不复位标志（`.analysis-deepseek-review-D01.md:192`）；第二轮 G03 把 30s 强制释放无归属列为设计疑虑（`source/docs/review/round2-qwen/G03.md:240`）。本条把「丢弃触发、无补跑」作为独立缺陷报出，不重复报 30s 归属问题。

### D07-03 [P2｜已坐实（探针复现）｜B/C｜I1、I3] 手动重填清理/恢复按下标写 live chat：strict save 失败时会把旧楼层/旧聊天的快照写进别的楼层或新聊天；摘要向量快照 await 之后才进入清理，切聊天时清理可能落到新聊天

- **位置**：
  - `source/src/service/chat/chat-service.ts:2849-2875`（在 `candidateChat` 克隆上清理，`:2874` 用 `applyCandidateMessageFields_ACU(chat[idx], candidateChat[idx])` 直接写 live chat；`:2875` 才 `saveChatToHostStrict_ACU()`）
  - `source/src/service/chat/chat-service.ts:2892-2897`（strict save 失败 → `snapshots.forEach((snapshot, idx) => restoreMessageFieldSnapshot_ACU(chat[idx], snapshot))`，仍按下标）
  - `source/src/service/chat/chat-service.ts:2910-2917`（`runTableWriteTransaction_ACU` 只传 isolation，不传期望 chatKey；`guardChatSwitch` 只在事务入口比较一次）
  - `source/src/service/table/update-orchestrator.ts:5650-5663`（先 `await snapshotManualRefillSummaryVectors_ACU(...)`，紧接着调用 `clearManualRefillSheetDataInRange_ACU`；两者之间没有聊天身份/消息身份复检）
  - `source/src/service/table/update-orchestrator.ts:5758-5764`（清理、模板根、reload、向量发布之后才做下一次 `executionSnapshot` 复检）
- **触发**：
  1. **保存失败变体**：手动重填（`clearBeforeUpdate:true`）的清理阶段，`saveChatToHostStrict_ACU` 在途；用户删掉目标楼层前面的一楼，或直接切到另一个聊天；随后宿主保存失败（磁盘/完整性冲突/pagehide/`saveChat` 不可用）。
  2. **清理前切聊天变体**：重填范围包含纪要/总结表且开了交火向量镜像；`snapshotManualRefillSummaryVectors_ACU` 读 manifest 的 await 期间用户切聊天；随后清理在**新聊天**上按旧下标执行。同角色新聊天通常有同名表，`purgeSheetKeysFromMessageForIsolation_ACU` 会命中并删掉新聊天的这些表数据。
- **现象（探针已复现变体 1）**：
  - 聊天 A 有 `[ai0, ai1(目标), ai2]`，清理目标 index=1；保存期间删掉 ai0，数组变成 `[ai1, ai2]`；保存失败后 catch 把 index=1 的快照（ai1 的清理前数据）写进现在的 `chat[1]`（ai2）——ai2 的表格被 ai1 的数据覆盖。
  - 若保存期间切到聊天 B（宿主复用同一个 chat 数组），catch 把 A 的快照写进 B 的同下标楼层——旧聊天的表格数据进入新聊天（I1）。
  - 变体 2 中，清理本身在新聊天上删除选中表数据并 strict save；随后 `:5759` 的复检通常会触发回滚，但如果用户在复检前又切回 A，复检通过，B 的清理不会被回滚；一旦 A 侧提交过任何 bucket，`rollbackRefillCleanupOnZeroCommit`（`:5268`）不会执行，B 的数据永久缺失。
- **原因**：清理/恢复都以「调用当下的 `getChatArray_ACU()` + 下标」定位，没有保存目标消息对象/身份指纹；`guardChatSwitch` 只保护事务入口，不保护 `saveChatToHostStrict` 这个真实异步窗口。清理前的最后一个聊天身份检查（`:5568`）在摘要向量快照（`:5656`）之前，快照之后没有复检。
- **已排除**：
  - 线索原文说的「清理循环内 `deleteVectorIndexManifestFromTagData_ACU`（`:2861`）期间用户删楼」**不成立**：该调用传 `deleteExternal:false`，`deleteVectorIndexManifestFromTagData_ACU` 内只有同步赋值（`chat-service.ts:184-202`），没有真实 I/O；循环内的 `await` 只是微任务，用户事件（宏任务）插不进来。
  - 成功路径不会因为 save 期间删楼而写错：`:2874` 的 apply 在 `:2875` 之前同步完成，已按当时的下标命中正确消息；即使删楼，被清理的仍是同一批消息对象。
  - 普通非重填的手动更新没有破坏性清理，不走这段。
- **测试**：`tests/service/chat/chat-service.test.ts:3752-3778` 覆盖的是 **rollback** 时按身份指纹跳过错位楼层（R3-09 同族），不是清理失败 catch 的按索引恢复；`:3716-3750` 只覆盖清理成功 + rollback 成功。探针 `D07-refill-cleanup-restore.test.ts` 的 2 例均通过，直接复现了「删楼后快照写错楼层」和「切聊天后旧快照写进新聊天」（见文末）。
- **修法方向**：清理前为目标消息保存 `{ message 对象 / 稳定 id + 正文指纹 }`；`:2874` 的 apply 和 `:2895` 的 restore 都改为按身份定位（找不到就跳过并报告），不要用 `chat[idx]`。`clearManualRefillSheetDataInRange_ACU` 增加 `expectedChatKey`（或首楼消息身份）参数，事务入口与 save 前各复核一次；`:5656` 的摘要向量快照之后、`:5660` 清理之前再补一次 `executionSnapshotContextStillMatches_ACU` / 消息身份复检。
- **与以前复审的关系**：D03-01 报的是「零提交回滚按当前聊天执行」，本条是**清理 apply / 失败恢复**这个更早的写点；D03 跨组线索 3 已提到但未作为发现条目。两者同属「破坏性清理只认当下聊天」的族，修法可合并。

### D07-04 [P2｜已坐实（代码路径）；宿主事件顺序待真机｜A｜I3、I5；与 2.7「只中止目标失效请求」冲突] auto staging 整轮共用一个 AbortController：当前 bucket 的目标失效会让后续目标仍有效的 bucket/segment 直接以 aborted 结束并记失败

- **位置**：
  - `source/src/presentation/triggers/settings-ui-sync/settings-ui-trigger.ts:244`（整个自动触发只创建一个 `autoGroupedAbortController`）
  - `source/src/presentation/triggers/settings-ui-sync/settings-ui-trigger.ts:261-267`（把它传给 `executeAutoFillStagingGroups_ACU`，覆盖整个 staging run）
  - `source/src/service/table/update-orchestrator.ts:3252`、`:3259`、`:3293`、`:3300`（pre/post 每个 segment 都复用同一个 `options.abortController`）
  - `source/src/service/table/update-orchestrator.ts:2893-2896`、`:2942-2945`（同一个 bucket 的所有 job 都收到这个 controller）
  - `source/src/service/table/table-fill-target-watch.ts:30-43`（任一目标失效就 `watch.controller.abort()`；共用 signal 的只记一次）
  - `source/src/service/table/update-orchestrator.ts:2672`、`:2684-2688`、`:3053-3065`（signal 已 aborted 时后续 bucket 直接 break，返回 `aborted: true`）
  - `source/src/service/table/update-orchestrator.ts:3271-3275`、`:3282-3288`、`:3310-3314`（任一段失败 → `failFastAfterSegmentError`，把所有 normalizedGroups 标失败）
- **触发**：自动填表计划含 `requiresBoundaryStaging` 的组（跨 full checkpoint 的 pre 段），且该组有多个 bucket。用户在当前 bucket 正在填第 j 楼时，滑动第 j 楼（不是最后一楼）；宿主的 `MESSAGE_SWIPED` 在数组已更新后派发，`isCurrent(j)` 因 `swipe_id` 变化判失效，`table-fill-target-watch` 中止共用 controller。后续 bucket 目标是 j+1、j+2…，滑动不改变数组下标，它们的目标仍然有效。
- **现象**：共用 signal 已 aborted；后续 bucket 在 `isStopped()`（`:2672`）或 segment 入口的 `signal.aborted`（`:3252`/`:3293`）直接返回 aborted，不调用 AI、不提交。`executeAutoFillStagingGroups_ACU` 把本次 staging run 的所有组标为失败，UI 提示「N 组失败」。用户看到的是「填表失败」，但后续楼层本来可以正常填；这些楼层要等下一次自动触发或手动补填。
- **原因**：abort 粒度是「整个 auto staging run」而不是「当前 job / 当前 bucket」。`table-fill-target-watch` 的注释承诺「判定失效的当场中止；提交时会被接受的请求不会被中止」，但共用 controller 让这个承诺只在同一 bucket 内成立。
- **已排除**：
  - **同 bucket 内**不会误伤：bucket key 含 `finalSaveTargetIndex`（`update-orchestrator.ts:2640`），同一 bucket 的所有 job 目标下标相同；目标失效时它们一起失效。第二轮 G03 的「共享 AbortController 不会连累同批其他组」在这个范围内仍然成立。
  - 普通（非 staging）自动组走 `ops.processUpdates`，每个组各自 `new AbortController`（`presentation/triggers/update-process.ts:220` 一带），不受本条影响。
  - 手动重填的 staging 没有传 `abortController`（`update-orchestrator.ts:5886-5893`、`:5923-5935`），各 job 自己新建，不受本条影响。
  - 若宿主在更新 `chat` 数组**之前**派发 `MESSAGE_SWIPED`，guard 会读到旧的 `swipe_id` 而不中止；这只会退回「提交阶段拒收」，不会产生本条；真机需确认事件顺序（G03 跨组线索 6 同款）。
- **测试**：`tests/service/table/table-fill-target-watch.test.ts:54-63` 的「同一个中止信号被多组共用时只中止一次」明确把共用 signal 当成预期，但没有覆盖「abort 后下一个 bucket 仍有效」；`update-orchestrator.test.ts` 的 staging 用例没有构造「当前 bucket 滑动、后续 bucket 有效」的时序。
- **修法方向**：按 job 或按 bucket 建子控制器（`AbortSignal.any([runStopSignal, jobController.signal])`），`table-fill-target-watch` 只 abort 目标失效的那个 job；或者每个 bucket 进入时新建 controller，run 级停止信号单独传递。至少不要把已 aborted 的 controller 继续传给后续 bucket，并在 `collectFailed` 时只把真正 stale 的 group 记失败。
- **与以前复审的关系**：D04 跨组线索 2 已提到「同 bucket 其他组被中止」，但同 bucket 目标下标相同，实际误伤发生在**跨 bucket/segment**；第二轮 G03 的结论只覆盖同 bucket。本条是新证据下的修正。

### D07-05 [P3｜已坐实｜其他｜I5] legacy 手动填表确认文案仍承诺「执行失败或终止时回滚到操作前」，实际只有零提交才回滚

- **位置**：
  - `source/src/presentation/triggers/update-process.ts:360`（确认框正文「执行失败或终止时会回滚到本次操作前的状态。」）
  - `source/src/presentation/bootstrap/api-groups/settings-config-api.ts:132-139`（`AutoCardUpdaterAPI.manualUpdate` 仍调用 `handleManualUpdate_ACU`）
  - `source/src/service/table/update-orchestrator.ts:5267-5270`（`rollbackRefillCleanupOnZeroCommit` 只在 `committedBucketCount <= 0` 时回滚）
  - `source/src/presentation-v2/composables/useManualUpdate.ts:510`（V2 UI 已改为「只有本次一个批次都没提交时，才会自动回滚清理」）
- **触发**：第三方脚本 / 控制台调用 `AutoCardUpdaterAPI.manualUpdate()`，用户在确认框点「确认并继续」；重填中途失败或被终止，且此前已提交过至少一个 bucket（含只落进度、未写数据的伪提交）。
- **现象**：确认框承诺回滚到操作前；实际 `committedBucketCount > 0` 时 `rollbackRefillCleanupOnZeroCommit` 直接返回，不复原已清理的旧数据。用户按文案以为数据已恢复，实际没有。
- **原因**：V2 UI 的文案在 `useManualUpdate.ts:510` 已改准，legacy 入口 `update-process.ts:360` 没有同步；两套入口文案分叉。
- **已排除**：普通玩家点 V2 界面的「手动填表」走 `useManualUpdate.ts`，文案是准确的；`handleManualUpdate_ACU` 只经公开 API 到达（G12 笔记也确认 legacy 入口只由第三方脚本调用），不是主 UI 按钮。仍属可到达的对外 API。
- **测试**：`tests/presentation/triggers/update-process.test.ts:76-91` 断言了确认框出现、删除范围、不可恢复风险和范围外不删除，但**没有**断言最后一句「执行失败或终止时会回滚」；也就是说，这句文案与 `rollbackRefillCleanupOnZeroCommit` 的语义分叉没有用例守护。没有覆盖「已提交后失败」的提示。
- **修法方向**：把 `:360` 的最后一句话改成与 `useManualUpdate.ts:510` 一致；或者把 legacy `manualUpdate` 直接转调 V2 的手动更新编排（带 `executionSnapshot`），同时删除这份旧文案。
- **与以前复审的关系**：新问题（P3 文案分叉）；与 G12-02 的 legacy 入口保护是同一入口，但那条修的是确认后的聊天身份复核，不是文案。

## 跨组线索

1. **手动重填清理前的摘要向量快照窗口**（根因在 `update-orchestrator.ts:5656-5660`）：这是 D07-03 的变体 2。它不属于 D03-01 的「回滚按当前聊天」，而是「清理本身按当前聊天」。摘要向量快照只在「重填范围含纪要/总结表 + 交火向量镜像开启」时才有真实 I/O；没有这个配置时清理紧跟在同步检查之后，窗口不可达。建议 D03/D02 一起把 `expectedChatKey` 作为 `clearManualRefillSheetDataInRange_ACU` 的必填契约，并在快照后补一次复检。
2. **自动填表计划未绑定聊天快照**（D04 跨组线索 3）：`settings-ui-connect.ts:369` 的身份复检之后，到 `processUpdatesBatch` 取 `chatHistory` 之间仍有 `executeAutoUpdatePlan` / 迁移 / flush 等 await；切聊天发生在复检之后时，旧计划可能按新聊天执行。这不在 D07 的 6 条线索内，未展开；建议 D01/D02 复核。
3. **MVU 闸门是全局单等待**（D01 已记）：切聊天后旧聊天的 MVU 解析未结束时，新聊天的自动填表会等同一个 `pendingGateWait_ACU`，最长 240s 兜底。D01 已作为建议记录，未计缺陷；本条不重复报。

## 设计层面的疑虑

1. **「正在填表」标志没有聊天/轮次归属**：`isAutoUpdatingCard_ACU` 是单布尔；正常路径由持有者 finally 释放，但「终止填表」30s 强制释放之后旧轮仍在跑，旧轮 finally 会清掉新一轮刚拿到的标志。第二轮 G03 已登记为设计疑虑（并建议把归属判定统一到调度层），不是本轮新发现；D07-02 只报它造成的「跨聊天丢触发」这一新后果。
2. **世界书短暂领先盘面**：`persistTableMutationLogV2_ACU` 在合并存盘分支 `saved=true` 后立刻 `scheduleSummaryVectorMirrorFlushAfterPersist_ACU`，随后 `refreshCommittedWorldbook_ACU` 用本轮快照写世界书；若这批脏改动后来因切聊天被作废（2.7 允许），世界书可能短暂比盘上表格新。下一次 CHAT_CHANGED 的 `refreshMergedDataAndNotifyWithUI_ACU` / 启动恢复会用盘上数据重写世界书（`pipeline.ts:842`），向量 flush 也会按 chatKey 拒绝或 strict save 把脏表格一起落盘，所以没有持久不一致；只建议在文档里明确这个短暂窗口，不计缺陷。
3. **legacy 入口没有 `executionSnapshot`**：`update-process.ts:408` 的注释明确说 legacy 手动填表不启用确认期 TOCTOU 防护。这使 D07-05 的文案问题之外，legacy API 在确认期间切聊天时也缺少 V2 同款保护；G12 已记录，未升级为本轮缺陷。

## 查过但判定没问题的场景

1. **线索 1 前半：CHAT_CHANGED 不 bump `autoTaskEventEpoch_ACU`，旧任务停在 MVU/物化等待会不会在新聊天上继续跑？** 不会。
   - CHAT_CHANGED 同步段先 `abortOnChatMutation_ACU()` 中止在飞请求，再 `clearAutoFillDebounce_ACU()` 清防抖（`init.ts:546-551`）；`resetScriptStateForNewChat_ACU` 在第一个 await 之前就把 `currentChatFileIdentifier_ACU` 改成新聊天（`injection-engine-state.ts:147`）。
   - 旧任务恢复后有两道身份检查：MVU 闸门之后、`loadAllChatMessages` 之后在 `settings-ui-connect.ts:369-395` 比对 `currentChatFileIdentifier_ACU` 与排程时的 chatKey；物化等待的每次重试在 `:407-418` 比对 `intent.chatKey` + isolation。任一不符即 `logAutoFillSkip_ACU('chat_changed')` 返回。
   - 无 intent 的路径没有物化等待；有 intent 的路径才等，且每轮都复检。`autoTaskEventEpoch` 不 bump 不影响这条，因为聊天身份是更硬的闸；epoch 只负责生成/删楼/滑动这类同一聊天内的事件。
   - 测试：`tests/presentation/triggers/settings-ui-connect.test.ts:78-92` 锁住了「intent 缺失时切聊天，旧 debounce 不在新聊天上填表」；物化等待的复检没有单独用例，但代码路径已读穿。残余风险是「宿主不派发 CHAT_CHANGED 就换聊天」（D04 跨组线索 3 已记），不是本线索的代码缺陷。
2. **线索 1 中段：旧轮 finally 的 `_set_isAutoUpdatingCard_ACU(false)` 会不会放开新一轮刚拿到的标志？** 正常路径不会；只有第二轮已登记的两个窗口会。
   - 正常自动填表：`executeAutoUpdatePlan_ACU` 在入口 `setAutoUpdating(true)`，本轮结束才 `setAutoUpdating(false)`；`autoUpdateTriggerInFlight_ACU` 防止第二个自动 trigger 并发，新的自动轮不可能在旧轮 finally 之前拿到标志。
   - `processUpdatesBatch_ACU` 已有 `ownsAutoUpdatingFlag`（`update-orchestrator.ts:3964-3968`、`:4102-4107`），先结束的组不会清外层标志（R2A-08 修复在位）。
   - 会出问题的两个窗口是：(a) 用户点「终止填表」后 30s 强制释放标志，旧轮仍在跑（`state-manager.ts:687-693`，第二轮 G03 设计疑虑）；(b) 手动重填在 `:5351` 检查到 `:5774` 置位之间的规划/清理窗口，自动填表可以插进来（第二轮 G03 跨组线索 3）。两者都是已有结论；本轮没有新证据证明修复不完整，故不重复报。D07-02 报的是这个全局标志在跨聊天时造成的「丢触发」，不是归属释放本身。
3. **线索 3：SQL 模式是否完全不遵守 last-pair？** 不是「完全」：JSON 分支的 `extractTableEditInner_ACU` 仍按设置取最后一对；问题只在 SQL 分支的 first-match 提取。D07-01 已按「SQL 分支」限定范围，不说整个填表管线都忽略设置。
4. **线索 4：同 bucket 里目标仍有效的组会不会被中止？** 不会。bucket key 含 `finalSaveTargetIndex`（`update-orchestrator.ts:2640`），同一 bucket 的所有 job 目标下标相同；目标失效时一起失效。第二轮 G03 的结论在这个范围内成立。D07-04 的误伤只发生在「后续 bucket/segment 目标仍有效」的跨 bucket 场景。
5. **线索 5：合并存盘的 `saved=true` 与向量/世界书时序是否会造成持久不一致？** 不会。
   - 向量：`flushSummaryVectorIndexTaskNow_ACU` 先比对 `task.chatKey === activeChatKey`（`summary-vector-index-flush-queue.ts:403-414`），切聊天直接 `flush_scope_mismatch`、不写新聊天；真正写 delta 时 `saveChatToHostStrict_ACU()`（`summary-vector-mirror-writer.ts:611`）会把同一聊天里尚未落盘的表格改动一起写盘；没有 delta 时不会写向量。
   - 世界书：`updateReadableLorebookEntry_ACU` 入口固化 chatKey/isolation，每一步前复核（`pipeline.ts:120-130`、`:163`、`:239`），切聊天后放弃剩余步骤；回到原聊天或下次加载时，`refreshMergedDataAndNotifyWithUI_ACU` 从盘上数据重写世界书（`pipeline.ts:842`）。
   - 因此最多出现「世界书短暂比盘面新」的窗口，符合 2.7 的「允许丢批次」，不会把旧改动写进新聊天、也不会写出已删聊天。只有「世界书比盘面新且用户永远不再打开该聊天」的理论残留，但世界书条目本身也按聊天/角色重建，未见用户可见危害；不计缺陷。
6. **线索 6：legacy 入口是否已经不可达？** 仍可达。`AutoCardUpdaterAPI.manualUpdate` 在 `api-registry.ts:76` 挂到顶层 window，`settings-config-api.ts:132-139` 直接转调 `handleManualUpdate_ACU`；主 UI 不调用它，但第三方脚本/控制台可以。所以 D07-05 按 P3 报，不按「死代码」排除。
7. **`clearManualRefillSheetDataInRangeCore_ACU` 的 per-message `await` 是否会给用户删楼留出窗口？** 不会。`:2861` 的 `await deleteVectorIndexManifestFromTagData_ACU(..., { deleteExternal:false })` 内部没有 I/O（`chat-service.ts:184-202`），只产生微任务；用户删楼是宏任务，无法插进循环。真正的异步窗口是循环后的 `saveChatToHostStrict_ACU`（`:2875`）和循环前的 `snapshotManualRefillSummaryVectors_ACU`（`update-orchestrator.ts:5656`），分别对应 D07-03 的两个变体。
8. **`abortTableFillRequestsWithStaleTarget_ACU` 的共享 signal 测试是否已经覆盖 D07-04？** 没有。现有用例 `table-fill-target-watch.test.ts:54-63` 只断言「共用 signal 只计一次中止」，没有断言「后续 bucket 是否还会执行」；`update-orchestrator` 的 staging 用例没有构造跨 bucket 的 abort 时序。

## 探针记录（均已删除）

### 1. `tests/__probe_deepseek__/D07-refill-cleanup-restore.test.ts`（2 例，通过）

模拟：`clearManualRefillSheetDataInRange_ACU([1], ['sheet_0'])` 的 `saveChatToHostStrict_ACU` 在途时，分别 (a) `chat.shift()` 删除第一楼后抛错，(b) 用 `chat.splice` 把同一个数组换成另一个聊天的楼层后抛错。关键断言：

```ts
await expect(clearManualRefillSheetDataInRange_ACU([1], ['sheet_0'])).rejects.toThrow('模拟宿主保存失败');
expect(chat.length).toBe(2);
expect(chat[1].mes).toBe('ai2');
expect(sheetValue(chat[1])).toBe('AI1');   // ai2 被写成 ai1 的快照
expect(chat[0].mes).toBe('B-ai');
expect(sheetValue(chat[0])).toBe('A');     // 新聊天被写成旧聊天快照
```

结果：两例均通过，确认 `:2874` / `:2895` 的按下标写入在数组变动后会把快照写到别的楼层/聊天。报告写完前已删除该文件。

### 2. `tests/__probe_deepseek__/D07-sql-last-pair.test.ts`（2 例，通过）

模拟：`extractTableEditInner_ACU(text)` 与 `update-orchestrator.ts:1651` 的 first-block 正则处理同一条含两个 `<tableEdit>` 的回复。关键断言：

```ts
expect(extractTableEditInner_ACU(text)?.inner).toContain('UPDATE'); // 解析器取最后一对
expect(firstBlock(text)).toContain('DELETE');                       // SQL 路径取第一块
expect(isSqlContent(firstBlock(text))).toBe(true);                  // 草稿 SQL 会被执行
expect(firstBlock('<tableEdit></tableEdit><tableEdit>UPDATE ...')).toBe('');
expect(isSqlContent('')).toBe(false);                               // 空首块不进 SQL 分支
```

结果：两例均通过，确认 first-block / last-pair 的分叉与空首块路径。报告写完前已删除该文件。

## 附：探针清理确认

- `source/tests/__probe_deepseek__/D07-refill-cleanup-restore.test.ts` 已删除。
- `source/tests/__probe_deepseek__/D07-sql-last-pair.test.ts` 已删除。
- 未改动任何已有文件；未执行 git 写操作。
