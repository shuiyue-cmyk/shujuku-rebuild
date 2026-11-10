# D06 复核

## 概览

- 原报告：P0 0 / P1 2 / P2 2 / P3 1。
- 复核后：**成立 1**（D06-01），**降级成立 1**（D06-02，P1 → P2），**不成立 1**（D06-05），**需真机 2**（D06-03、D06-04）。
- 跑过的探针（均已删除）：
  1. `tests/__probe_deepseek__/V06-publish-cross-chat.test.ts`：在聊天 A 拍下剩余行快照（`rowId=r1`，排除 `r2`），把 `currentChatFileIdentifier_ACU` 换成 `chat-B` 并原地替换 `chat` 数组为 B 的消息（B 的 full checkpoint 数据与 A 相同，另带一个旧 B 镜像）。调用真实 `publishSummaryVectorMirrorRowRemovalSnapshot_ACU`。结果通过：manifest 以 `chatKey:'chat-B'` 上传，rows 只有 A 的 `r1`；B 的 `summaryVectorIndexFrame.checkpoint.manifestRef` 指向 A 的 manifest，`rowCount=1`，旧 B 镜像被覆盖；`saveChatToHostStrict_ACU` 调用 1 次。
  2. `tests/__probe_deepseek__/V06-commit-post-persist.test.ts`：让 `runTableUpdateCommit_ACU` 的 persist mock 在“宿主 saveChat”期间把当前聊天从 `chat-a` 改成 `chat-b`，提交仍返回成功。结果通过：最后一次 `_set_currentJsonTableData_ACU` 发生时当前聊天已是 `chat-b`，写回的是 `chat-a` 的旧表 `oldData`。
- 没读的范围：TT 宿主删除当前聊天时 `CHAT_DELETED` / `CHAT_CHANGED` 的真实先后、`saveChat()` 的耗时、同名聊天在真实宿主中的事件参数形状；这些只影响“需真机”条目。

## 逐条复核

### D06-01 → 成立｜P1

- 行号核对：一致。`update-orchestrator.ts:5656`（拍快照）、`:5714`（发布）、`:5759`（发布后才做 `executionSnapshot` 复核）、`:6023`（提前放开填表标志）、`:6054`（`manual_refill_complete` 重建）；`summary-vector-mirror-rebuild.ts:144-154`（快照类型无 chatKey）、`:267-271`（发布时才取 `currentChatFileIdentifier_ACU`）、`:296-306`（按当前 scope 上传 manifest）、`:341-348`（只比内容指纹）。补充更正：`chat-service.ts:2521-2525` 的 `guardChatSwitch` 实际是拿锁之后、任务体之前比对（`table-write-transaction.ts:443-450`），不是函数第一行；它挡不住任务体里的 `saveChatToHostStrict_ACU` 期间切聊。
- 重走路径：用户在聊天 A 手动重填 → `snapshotManualRefillSummaryVectors_ACU` 在清理前拍下 A 的剩余行（只有 sourceTableKey/rows/packRefs/expectedBaseFingerprint）→ `clearManualRefillSheetDataInRange_ACU`（strict save）→ `establishManualRefillTemplateRoot_ACU` → `reloadStorageProvider()` → `publishManualRefillSummaryVectors_ACU`。只要在清理、建根或 reload 的任一 await 期间切到同名分支/复制聊天 B，发布时 `getChatArray_ACU()` 和 `currentChatFileIdentifier_ACU` 都已经是 B；`expectedBaseFingerprint` 只证明“表内容相同”，B 是 A 的分支时恰好能通过。`:5759` 的复核在发布之后，无法撤回；而且它走 `failManualRefillSession` 时，`rollbackManualRefillRangeSnapshotAtomic_ACU` 还会按 A 的楼层下标把 A 的清理前快照恢复进 B（指纹相同则匹配），进一步污染 B。
- 找过的守卫：
  - `grep executionSnapshotContextStillMatches_ACU`：13 处（含定义），12 个调用点；`:5568` 在清理前，下一次是 `:5759` 发布后，`5656-5714` 之间没有一次。
  - `grep guardChatSwitch`：`clearManualRefillSheetDataInRange_ACU:2916`、`commitManualRefillSheetSnapshotInRangeAtomic_ACU:2525`、`rollbackManualRefillRangeSnapshotAtomic_ACU:2949` 都有，但都只在任务体开始前比对；`publishSummaryVectorMirrorRowRemovalSnapshot_ACU` 的 `runTableWriteTransaction_ACU`（`:331-338`）没有传 `chatKey`，也没有 `guardChatSwitch`。
  - `expectedBaseFingerprint`（`:341-348`）只比表内容，不比聊天身份；manifest 在指纹校验之前就已上传（`:296-306`）。
  - `abortOnChatMutation_ACU` 只中止 AI 调用；清理、建根、`reloadStorageProvider`、发布都不看 abort 信号。
  - `reloadStorageProvider` 在切聊后加载的是 B，不会拒绝本次重填。
- 探针：`V06-publish-cross-chat.test.ts`。关键断言：
  ```ts
  expect(result.success).toBe(true);
  expect(h.uploaded).toMatchObject({ chatKey: 'chat-B' });
  expect((h.uploaded.rows.rows as any[]).map((row: any) => row.rowId)).toEqual(['r1']);
  const mirror = h.chat[0].TavernDB_ACU_IsolatedData.iso.storageFrame.summaryVectorIndexFrame;
  expect(mirror.checkpoint.manifestRef).toEqual({ manifestHash: 'manifest-A', path: 'manifest-A-path', byteLength: 1 });
  expect(mirror.checkpoint.rowCount).toBe(1);
  expect(h.saveStrict).toHaveBeenCalledTimes(1);
  ```
  结果：通过（1 test passed）。这证明发布不只是“用了新 chatKey”，A 的 rows 真的落进了 B 的聊天镜像。
- 测试：`tests/service/vector/summary-vector-mirror-revision-race.integration.test.ts` 覆盖的是“同一聊天内表被并发改写”的指纹漂移；`tests/service/table/update-orchestrator.test.ts:2064-2130` 只断言 `rebuild_repair` 被调用（publish 本身在测试文件 `:328-332` 被整体 mock），没有聊天身份维度。
- 补充或更正：
  - 报告里“B 或 C（新聊天）”写得偏宽：如果 C 是全新的空聊天、没有 full checkpoint，`publish` 会在 `:251-253` 以 `unsupported_replay_base` 早退；即使建出模板临时根，若指纹与 A 的 full 数据不同，也会在 `:346-348` 以 `stale_base` 拒绝。真正能落地的是“B 是 A 的分支/复制聊天，或任何 full checkpoint 数据指纹相同的聊天”。这不影响 P1 结论，但触发条件应写窄。
  - 同一窗口里 `establishManualRefillTemplateRoot_ACU`（`chat-service.ts:2706-2816`）完全没有 chatKey 参数和聊天身份复核；如果切聊发生在它开始之前，它会把 A 的冻结模板写成 B 的临时根（跨组线索，建议 D06 协调者另立条目或并入本组修法）。
  - `publishSummaryVectorMirrorRowRemovalSnapshotNow_ACU`（`summary-vector-index-rebuild-service.ts:62-75`）在发布成功后会调用 `updateReadableLorebookEntry_ACU(true)`，用的是 B 的当前运行时/当前角色书；这不是 A 的 rows 泄漏，但会放大 D06-02 的世界书问题。
  - `manual_refill_complete` 的 `rebuildCurrentSummaryVectorIndexNow_ACU`（`:6054`）只按当前聊天/当前运行时重建；它本身不携带 A 的 rows，只有配合 D06-02 的旧运行时写回才会把 A 的表写进 B 的镜像。报告把它和发布并列，容易让读者以为它是独立的 A 数据泄漏路径。

### D06-02 → 降级成立｜P2（原 P1）

- 行号核对：一致。`table-update-commit.ts:302-321`（`assertExpectedCommitScope_ACU`）、`:444`（持久化前最后一次 scope 复核）、`:475-481`（persist 成功后无条件 `_set_currentJsonTableData_ACU`）；`storage-frame-v2-persist.ts:2817-2822`（strict/coalesced 都 await 宿主保存）；`update-scheduler.ts:451-453`（组完成后无条件 load + refresh）；`settings-ui-trigger.ts:114-121`（refresh 读 `getStorageProvider().getCurrentData() || currentJsonTableData_ACU`，再刷新世界书并通知）；`pipeline.ts:135-139`（dataOverride 先 `_set_currentJsonTableData_ACU(mergedData)`）、`:120-131`（入口才固化身份）、`:237-247`（按当前角色解析注入目标）。补充更正：`sql-table-service.ts:1540-1541` 的 `_readCanonicalView_ACU()` 对非隔离新 provider 直接返回全局 `currentJsonTableData_ACU`，所以刷新时读到的就是刚被写回的旧表，不需要“provider 尚未 hydrate 返回 null”这个额外前提。
- 重走路径：自动填表普通组（或 staging post 段）进入 `runTableUpdateCommit_ACU`，`chatKey` 是 AI 开始前冻结的 `executionScope.chatKey`（`update-orchestrator.ts:3486-3501` / `:3684-3698`）。`assertExpectedCommitScope_ACU` 在 `:444` 通过后，`persistTablesToChatMessage_ACU` 内部 `saveChatToHostCoalesced_ACU`/`Strict` await 宿主 `saveChat()`；用户此时开始新聊天，`CHAT_CHANGED` 同步清空 `currentJsonTableData_ACU` 并 dispose provider，但 persist 返回后 `:481` 仍把本次提交的旧表写回全局运行时。随后调度层 `refreshData` 在 `:115` 读到这份旧表，`refreshCommittedWorldbook_ACU(oldData)` 以“当前聊天 B”的身份进入 pipeline；`dataOverride` 在 `:138` 再次写回旧表，`:238` 解析到的注入目标是 B 的角色书，`chatStillCurrent` 入口固化的就是 B（不会发现数据属于 A），于是旧表内容写进 B 的世界书。`:120-131` 的逐步骤复核只能防“函数内再次切聊”，防不了“入口前数据已经属于旧聊天”。
- 找过的守卫：
  - `grep assertExpectedCommitScope_ACU`：7 处（含定义），6 个调用点（`提交前/迁移后/未落盘变更写回后/应用前/持久化前/stage 应用前`），没有持久化后。
  - `grep beginChatSaveCoalescing_ACU`：只有 `update-orchestrator.ts:3973`（legacy 批处理）、`:4800`（手动追平）、`:5346`（手动填表）；`executeAutoFillStagingGroups_ACU` 和普通自动组都没有开窗。
  - staging 的 pre/post 段确实传了 `syncAfterCommit:false`（`:3264`、`:3303`），所以组内 `refreshCommittedWorldbook_ACU` 不会跑；但 `update-scheduler.ts:451-453` 的 `refreshData` 不受这个开关控制，仍然会跑。
  - `refreshCommittedWorldbook_ACU`（`update-orchestrator.ts:364-372`）只接收 tableData，没有来源 chatKey；pipeline 的 `chatStillCurrent` 只比 identifier/isolation，且入口固化发生在旧数据已经产生之后。
  - `_set_currentJsonTableData_ACU` 本身（`state-manager.ts:569`）没有任何聊天校验。
- 探针：`V06-commit-post-persist.test.ts`。关键断言：
  ```ts
  expect(result.success).toBe(true);
  expect(mocks.persist).toHaveBeenCalledTimes(1);
  const last = mocks.setCalls[mocks.setCalls.length - 1];
  expect(last.chatKey).toBe('chat-b');
  expect(last.data).toEqual(oldData);
  ```
  结果：通过。这坐实了“persist 返回后无条件写回旧数据、且写回时当前聊天已是 chat-b”。
- 测试：`tests/service/table/table-update-commit.test.ts:108-137` 覆盖“AI 等待期间切聊天后 fail-loud”，但切聊发生在 migration/apply 之前；没有“persist 的 host save 期间切聊天”的用例。`tests/service/table/update-scheduler.test.ts` 没有断言 `refreshData` 在切聊后的行为；`tests/service/worldbook/pipeline.test.ts:1954-1978` 只从函数入口之后切聊天。
- 补充或更正：
  - 报告把世界书刷新归到调度层 `refreshData`；对普通（非 staging）组，`update-orchestrator.ts:3674-3676` 还有一条更直接的路径：commit 成功后立刻 `refreshCommittedWorldbook_ACU(commitResult.tableData)`，同样没有来源身份。staging 段因为 `syncAfterCommit:false` 才只剩调度层那条。
  - 世界书污染是否“持久”取决于宿主 `saveChat()` 是否超过 1.2s：小于 1.2s 时，`CHAT_CHANGED` 的延迟重建（`init.ts:441`）会用 B 的数据再刷一次世界书，可能把错误内容纠正；大于 1.2s 时，延迟重建已完成，`:481` 的旧数据在它之后写回，随后调度层刷新会把旧表写进 B 的书且没有后续纠正。后半段这一步需要真机确认 saveChat 时长；前半段（运行时被旧表覆盖）已由探针坐实，且会被回调/UI 在刷新前读到。因此按“降级成立 P2”处理，不按原 P1 的“已坐实世界书污染”处理。
  - `_set_isAutoUpdatingCard_ACU(false)` 在 `:6023`（手动重填）和调度层 `setAutoUpdating(false)`（`update-scheduler.ts:452`）都会提前放开“正在填表”标志；如果切聊后的新一轮填表已经开始，旧轮 finally 的 `_set_isAutoUpdatingCard_ACU(false)`（`update-orchestrator.ts:6120`）还会清掉新一轮的标志和终止锁存（跨组线索 5，建议与本条一起修）。

### D06-03 → 需真机

- 行号核对：一致。`summary-vector-index-chat-deletion-gc.ts:98-124`（入口；`:105-108` 当前聊天守卫，`:110-114` 枚举 fail-safe，`:115-118` 同名存活守卫，`:120-123` 一次性清理）、`:36-38`（24h 启动清扫节流）、`:75-92`（先删热缓存/flush 任务，再 Safe GC）、`:129-158`（启动 60s 孤儿清扫）；`init.ts:825-833`（CHAT_DELETED 延迟 5s 只调用一次）、`:844-850`（启动 60s 清扫）；`summary-vector-index-storage-service.ts:107`（10 分钟 grace）、`:1168-1174`、`:1228-1234`（未过 grace 一律 retain）、`:1152-1156`（prepared 一律 retain）；`vector-index-hot-cache.ts:1117-1130`（`clearSummaryVectorFlushTasksByScope_ACU` 只删任务）；`summary-vector-mirror-writer.ts:533-536`（代次校验）、`:611`（strict save）、`:634`（finalize）；`summary-vector-index-flush-queue.ts:652-661`（带墓碑的 invalidate，与删除路径的无锁 delete 不同）。
- 重走路径（两种宿主顺序）：
  1. CHAT_DELETED 先到、5s 内没有 CHAT_CHANGED 或宿主不自动打开别的聊天 → `currentChatFileIdentifier_ACU` 仍是已删聊天名 → `:105-108` 直接 `target_is_current_chat` 跳过，之后没有任何重试。
  2. CHAT_CHANGED 先到 → 进入 Safe GC；被删聊天最近一次填表产生的 pack/manifest 的 `createdAt` 在 10 分钟内 → `:1170`/`:1229` 一律 retain，删除数量为 0；本会话没有针对该 chatKey 的第二次清理。启动清扫要等下一次启动的 60s，且受 24h 节流（`:132-133`）。
  3. 在途 flush：`clearSummaryVectorFlushTasksByScope_ACU` 只 delete 任务，不写 `invalidated` 墓碑；如果 runner 已经在 `:535` 通过代次校验、删除发生在它进入 `:540` 提交之前，runner 仍会 `:611` strict save 和 `:634` finalize，文件在清理之后变成 published 孤儿。
- 找过的守卫：`grep cleanupSummaryVectorIndexForDeletedChat_ACU|sweepOrphanSummaryVectorIndexFiles_ACU` 只有 `init.ts` 两处调用；`cleanupUnreachableSummaryVectorIndexFiles_ACU` 没有“已确认删除的 scope 跳过 grace”的入口（`summary-vector-index-types.ts:469-472` 只有 scopeHints）；同名存活守卫是必要的（跨角色同名共享 scope），问题不在它；当前聊天守卫与一次性语义才是缺口。
- 探针：未写探针（P2，按规则可只读代码）。现有 `tests/service/vector/summary-vector-index-chat-deletion-gc.test.ts` 把 `cleanupUnreachableSummaryVectorIndexFiles_ACU` 整个 mock 掉，只断言“被调用/没被调用”，没有真实 grace、没有在途 runner、没有两种事件顺序。
- 需真机验证步骤（玩家照做）：
  1. 打开酒馆，进入一个已开启“交火纪要向量索引”、且最近 10 分钟内刚自动填过表的角色聊天。
  2. 点右上角聊天管理 → 删除当前聊天（不要先关闭聊天）；宿主会自动打开或新建另一个聊天。
  3. 等 10 秒，按 F12 打开 Console，搜索 `[交火向量索引] 聊天删除清理`。正常应看到 `聊天删除清理完成` 且 `deletedFiles` 大于 0；如果看到 `target_is_current_chat`、`same_name_chat_alive` 或 `deletedFiles=0`，说明本次没有清掉最新文件。
  4. 再等 10 分钟（不要重启），在向量索引页查看外置文件统计，或到酒馆的 user/files 目录看 `TavernDB_ACU_vector_v2pack_*` / `..._v2manifest_*`。正常应在下一次启动后的孤儿清扫中消失；如果重启后等 60 秒仍在、且 Console 出现 `throttled` 或没有清扫日志，就是 I2 违规。
  5. 正常/异常判定：已删聊天的 pack/manifest 不应再出现在文件列表，也不应被任何存活聊天引用；删除后本会话内一直保留、且没有第二次清理尝试，即为问题。
- 补充或更正：如果 registry 里已经没有该 chatKey 的可解析条目，`collectRegistryScopesByChatKeys_ACU` 返回空数组，`cleanupScopesEverywhere_ACU` 在 `:90` 直接 `return 0`，连文件都不尝试回收（只清了 IDB/任务）——这比报告写的“grace 保留”更彻底，建议一并纳入修法（按 chatKey 扫 scope 前缀，而不是只依赖 registry 身份）。另外 `clearSummaryVectorFlushTasksByScope_ACU` 走的是无锁 delete 版本，不会留下 `invalidated` 墓碑；修法应改为 `invalidateSummaryVectorFlushTaskStrict_ACU` 或等 runner settle 后二次扫描。

### D06-04 → 需真机

- 行号核对：一致。`pipeline.ts:120-131`（入口只固化 `currentChatFileIdentifier_ACU` + isolation）、`:135-139`（dataOverride 先写全局运行时）、`:237-247`（`getInjectionTargetLorebook_ACU()` 在入口之后解析，返回后只比聊天名）；`injection-engine-state.ts:147`（identifier = `cleanChatName_ACU(chatFileName)`）；`shared/utils.ts:16-23`（剥路径/扩展名）；`summary-vector-index-chat-deletion-gc.ts:11-14`（注释明确“聊天文件名不含角色作用域，跨角色可重名”）；对照 `template-state-reset.ts:190`（初始化路径确实比了 `chat[0]` 对象和 storage identity）。
- 重走路径：角色 A 与 B 各有一个同名聊天文件（例如都叫 `Chat`）。A 的填表提交后，`refreshCommittedWorldbook_ACU` 被调用（或在它 `await getInjectionTargetLorebook_ACU()` 期间），用户切到 B。`refreshChatKey` 仍是 `Chat`，`chatStillCurrent` 全程为真；`dataOverride` 是 A 的表，`:238` 解析到的 `primaryLorebookName` 是 B 的绑定书，后续 `updateImportantPersonsRelatedEntries_ACU` / `updateSummaryTableEntries_ACU` / `updateOutlineTableEntry_ACU` / `updateCustomTableExports_ACU` 全部写进 B 的书。`injection-engine-custom.ts:794-796` 还会把 `knownCustomEntryNames` 写进全局 settings 并 `saveSettings_ACU`，之后的清理会按这份名单在 B 的书里删条目。
- 找过的守卫：`chatStillCurrent` 只比两个字符串；`refreshMergedDataAndNotify_ACU:701-710` 的 stale 判定同样只比 identifier/isolation；`getActiveChatStorageIdentity_ACU` 也只是宿主 chat id（同名）；没有角色 avatar/绑定书参与身份；`getInjectionTargetLorebook_ACU` 自己按当前角色解析，无法证明目标书属于快照角色。R6-06 修的是“函数内 identifier 变了就放弃”，没有覆盖“同名不同角色”。
- 探针：未写探针（P2，代码缺口已读穿；需要真机确认同名聊天存在与切换时机）。现有 `tests/service/worldbook/pipeline.test.ts:1954-1978` 只把 `mockCurrentChatFileIdentifier` 改成 `other-chat`（不同名），所以拦不住同名盲区。
- 需真机验证步骤（玩家照做）：
  1. 准备两个角色 A、B，在聊天管理里把各自的聊天文件都重命名为同一个名字（例如 `Chat`）。
  2. 在 A 里触发一次会刷新世界书的填表（手动填表或等自动填表）；当界面提示正在填表/正在刷新世界书时，立刻从宿主聊天列表切到 B 的同名聊天。
  3. 打开 B 的角色绑定世界书或注入目标书，看是否出现 A 的表内容（`TavernDB-ACU-ReadableDataTable`、纪要/总结/人物条目）；按 F12 在 Console 搜索 `[Worldbook]`，看是否有写入 B 书的记录。
  4. 正常：B 的书保持 B 自己的内容，或只被 B 的数据刷新；异常：A 的表/条目出现在 B 的书里，或 B 的 `knownCustomEntryNames` 被写成 A 的条目名。
  5. 窗口很窄（在 `await getInjectionTargetLorebook_ACU()` 附近，通常几十毫秒），一次没复现可重复 2–3 次；如果始终无法复现，至少说明该路径在真机上难以触发，但不能据此判定代码无缺陷。
- 补充或更正：`injection-engine-custom.ts:794-796` 的 `knownCustomEntryNames` 是全局 settings，不是按角色/聊天隔离的；即使 `primaryLorebookName` 解析正确，A 的条目名也会影响 B 后续的清理。这一点比报告写的“写进 B 的 settings”更准确（是全局设置被污染，不只是 B 的）。另外 `refreshChatKey` 只在函数入口取一次，若切到同名角色发生在入口之后、`getInjectionTargetLorebook_ACU` 返回之前，才会命中；若切聊发生在 `:238` 之后，后续写入仍落在 A 的书（不会跨角色），所以不要把整个刷新窗口都当成危险窗口。

### D06-05 → 不成立

- 决定性证据：回调拿到的始终是**通知时刻的当前运行时快照**，不是“旧轮结果”：
  ```ts
  const dataToSend = currentJsonTableData_ACU ? JSON.parse(JSON.stringify(currentJsonTableData_ACU)) : {};
  ...
  _notifyTableUpdate: function(meta?: Partial<TableUpdateNotifyMeta_ACU>) {
      notifyTableUpdateCallbacksSafely_ACU(ctx, { persisted: meta?.persisted !== false });
  }
  ```
  （`callback-api.ts:41`、`:100-102`）。`settings-ui-trigger.ts:114-121` 也是先 `refreshCommittedWorldbook_ACU(data)`（把当前聊天数据收敛到运行时）再 `_notifyTableUpdate()`。因此自动填表被切聊中止后触发的通知，数据是 B 的当前表，不是 A 的旧表；第三方做一次刷新不会把 A 的数据同步到外部。唯一会把 A 的旧表推给回调的是 D06-02 的 `:481` 写回，那已经在 D06-02 计数，不应在 D06-05 重复计一次。
- 合同层面：`docs/TESTING.md:43` 对 `registerTableUpdateCallback` 的约定只有“表格更新后触发（前端自动刷新）”，没有“每次提交/每个 run 的归属”承诺；`TableUpdateNotifyMeta_ACU` 的 `persisted` 语义是“当前数据是否已写进聊天帧”（`callback-api.ts:18-25`），不是“本轮填表成功”。自动填表失败/被中止后仍然通知，属于“让 UI 刷新到当前真实状态”，不是“失败了还提示成功”。仓库内也没有任何消费 `registerTableUpdateCallback` 的第三方实现可证明会被误导。
- 行号核对：报告引用的 `callback-api.ts:22-29`、`:41`、`:100-102`，`settings-ui-trigger.ts:114-121`，`update-scheduler.ts:451-453`，`useManualUpdate.ts:540-543` 都真实存在，事实部分成立；但“第三方会把新聊天数据当成旧轮结果”是推测，且与“回调数据永远是当前聊天”的现有合同相矛盾，故不成立。
- 补充或更正：如果产品希望回调能区分 run/聊天，可以新增可选的 `chatKey/isolationKey/runId` 字段；这是 API 增强，不是当前缺陷。当前 `persisted:true` 只表示“当前快照已持久化”，不要把它当作本轮成功标志。
- 测试：`tests/presentation/bootstrap/init.test.ts` 与回调相关测试只断言注册/注销/深拷贝，不覆盖切聊；但如上所述，缺的不是测试而是“回调必须带 run 身份”的合同——现有文档没有这个承诺。

## 设计层面的疑虑（不计入缺陷）

1. **聊天身份只有文件名一层**：`currentChatFileIdentifier_ACU` 同时被表格、世界书、向量 scope、回调、GC 当作全局身份。跨角色同名聊天、分支聊天、改名聊天都会撞在同一个字符串上。D06-04 是这条设计的一个具体缺口；即使修了 D06-04，其他按 chatKey 共享 scope 的地方（R5-04 已决定不修）仍然需要逐一确认。建议长期加一个“角色 avatar + 首楼消息对象”的复合身份，至少作为快照字段透传。
2. **strict save 不校验聊天归属**：`saveChatToHostStrict_ACU` 只负责落盘，不检查“调用开始时是哪个聊天”。D06-01、D06-02 以及跨组线索里的 `establishManualRefillTemplateRoot_ACU` 都依赖调用方自己复核。建议在 gateway 层提供 `saveChatToHostStrictForScope_ACU({chatKey,isolationKey})`，或至少在每次 strict save 返回后强制调用方复核，避免新增路径再漏。

## 查过但判定没问题的场景

- **`expectedBaseFingerprint` 的同聊天并发保护**：`summary-vector-mirror-rebuild.ts:341-348` 能正确拒绝“快照之后同一聊天的表被并发改写”（`tests/service/vector/summary-vector-mirror-revision-race.integration.test.ts` 覆盖）；它的问题只是不区分聊天。
- **writer/rebuild 的代次与墓碑**：`summary-vector-mirror-writer.ts:533-536` 在提交前校验 `expectedFlushScopeKey + generation`，`summary-vector-index-flush-queue.ts:652-661` 的 invalidate 会写墓碑；R5-07/R5-10 主体在位。只有“校验通过后、提交前被无锁 delete”这个窄竞态属于 D06-03。
- **flush 队列切聊跳票与恢复**：`scheduleFlushTaskTimer_ACU` 触发前比对 live chatKey，`restoreSummaryVectorIndexFlushQueueForCurrentChat_ACU` 在 CHAT_CHANGED 延迟链恢复；`tests/service/vector/summary-vector-index-flush-queue.test.ts:413-425` 覆盖。
- **同名存活守卫**：`summary-vector-index-chat-deletion-gc.ts:115-118` 在枚举到同名存活聊天时跳过，避免删掉另一个角色同名聊天的共享 scope；逻辑本身正确。
- **回调深拷贝**：`callback-api.ts:41` 每轮克隆，R9-17 在位；回调抛错被逐个 catch，不会打断填表。
- **`OpencodeGoUsage.vue`**：`onTableFillRunEnded_ACU` 在卸载时注销，debounce timer 清理，`generation` 丢迟到结果；未发现泄漏或跨聊天数据问题。
- **R6-06 的不同名切聊保护**：`pipeline.ts:120-131` 的逐步骤复核对“identifier 变成另一个名字”有效；`tests/service/worldbook/pipeline.test.ts:1954-1978` 覆盖。D06-04 只是同名盲区。
- **`updateCustomTableExports_ACU` 的目标书透传**：`primaryLorebookName` 在入口解析一次并透传给三个条目更新器；函数内后续切聊不会把旧数据写到“新解析出的书”。解析那一刻的同名盲区见 D06-04。
