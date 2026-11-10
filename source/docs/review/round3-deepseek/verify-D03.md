# D03 复核

## 概览

- 原报告：P0 2 / P1 1 / P2 1 / P3 3
- 复核后：成立 5，降级成立 1，不成立 0，需真机 1
  - 成立：D03-01（P0）、D03-04（P2）、D03-05（P3）、D03-06（P3）、D03-07（P3）
  - 降级成立：D03-02（原 P1 → P2）
  - 需真机：D03-03（原 P0，宿主删除聊天后的 id/事件顺序决定）
- 跑过的探针（均已删除）：
  - `source/tests/__probe_deepseek__/V03-refill-rollback-current-chat.test.ts`：2 个用例通过。独立重写，验证清理句柄不含聊天身份、切到聊天 B 后真实 `rollbackManualRefillRangeSnapshotAtomic_ACU` 会把 A 的快照写进 B；B 身份不同时全部跳过、A 仍保持清理态。
  - `source/tests/__probe_deepseek__/V03-terminal-progress-scope.test.ts`：2 个用例通过。验证 `runTableUpdateCommit_ACU` 在调用方不传 `chatKey` 时，切换到聊天 B 后仍接受追平终态进度提交；显式传原始 `chatKey` 的对照组被拒绝。
- 没读或没把握的范围：宿主 `saveChat()` 在聊天文件已删除后的真实行为、`CHAT_DELETED`/`CHAT_CHANGED` 的真实派发顺序；完整追平编排的端到端探针（依赖 30+ 模块，且仍会 mock 掉真实 persist，证明力有限）。

## 逐条复核

### D03-01 → 成立｜P0

- 行号核对：基本一致。`update-orchestrator.ts:5267-5292`、`5297-5321`、`5758-5763`、`5867-5881`、`chat-service.ts:2885-2888`、`2931-2989`（报告写 2931-2988，函数右花括号在 2989）、`table-write-transaction.ts:438-449` 均能在当前 HEAD 对上。
- 重走路径：
  1. 手动重填确认后，`clearManualRefillSheetDataInRange_ACU` 在聊天 A 上清理选中表并 `saveChatToHostStrict_ACU` 落盘（`chat-service.ts:2875`）。
  2. AI 请求在途时用户点开聊天 B。`CHAT_CHANGED` 同步段 `abortOnChatMutation_ACU()`（`init.ts:546`）中止在飞请求，并把 `currentChatFileIdentifier_ACU` 改成 B（`injection-engine-state.ts:146-147`）。
  3. 手动编排在 `processGroupedRuntimeChunk_ACU` 返回失败后，走 `failManualRefillSession`（`update-orchestrator.ts:6025-6028`），后者调用 `rollbackRefillCleanupOnZeroCommit`（`5297-5298`）。
  4. 该函数先 `refillRollbackHandle = null` 一次性消费句柄（`5271-5273`），再调用真实回滚。回滚在 `chat-service.ts:2936` 用**调用当下**的 `getChatArray_ACU()`，在 `2946` 用当前 isolationKey；句柄只有 `entries`/`sheetKeys`（`2885-2888`），没有任何聊天身份。
  5. 事务入口 `runTableWriteTransaction_ACU` 的 `chatKey` 缺省为当前聊天（`chat-service.ts:2943-2949` 没传 `chatKey`），`guardChatSwitch` 在 `table-write-transaction.ts:444-449` 只把“当前值”和“当前值”比较，必然通过。
  6. 结果：聊天 A 的清理不回滚；若 B 的楼层身份指纹与 A 相同，A 的清理前快照整段写进 B（包括 A 独有的其他表）；若不同，B 全部跳过、A 仍保持清理态。
- 找过的守卫：
  - `executionSnapshotContextStillMatches_ACU`（`update-orchestrator.ts:4295-4300`）只在清理前、AI 前、每个 chunk 前检查（`5467`、`5568`、`5758`、`5868`）；检查失败只是把流程导向 `failManualRefillSession`，不会阻止回滚写当前聊天。
  - `clearManualRefillSheetDataInRange_ACU` 的 `guardChatSwitch`（`chat-service.ts:2916`）只保护清理事务本身，清理已完成并落盘。
  - 回滚的逐条指纹校验（`chat-service.ts:2956-2963`）只防“写错楼层”，不防“在错误的聊天里找同身份楼层”。
  - `rollbackRefillCleanupOnZeroCommit` 只被 `failManualRefillSession` 和零提交收尾调用；`grep` 未发现第二套上层守卫或持久化回滚日志。
- 探针：`V03-refill-rollback-current-chat.test.ts`（已删除）。模拟聊天 A 清理后把 `getChatArray_ACU()` 换成聊天 B，调用真实回滚。关键断言与结果（2/2 通过）：
  ```ts
  expect(Object.keys(handle).sort()).toEqual(['entries', 'sheetKeys']);
  expect(chatB[1].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_1.content)
    .toEqual([['row_id', '值'], ['a1', 'A旧值']]);
  expect(chatB[1].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_2.content)
    .toEqual([['row_id', '值'], ['a2', '只属于A的表数据']]);
  expect(chatA[1].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint.data.sheet_1).toBeUndefined();
  // 第二例（B 的 send_date 不同）：success=false、skippedIndexes=[1]，A 仍为 undefined
  ```
  探针把 `runTableWriteTransaction_ACU` mock 成直通任务，只隔离锁/事务外壳；被测的回滚聊天查找、指纹校验、快照恢复和 strict save 都是真实代码。真实事务“chatKey 缺省 = 当前聊天”的行为已在 `table-write-transaction.ts:438-449` 核对——切换后新开的事务必然自比通过。
- 补充或更正：原报告把“新聊天身份相同”写成已坐实的第二个后果，探针确实复现；但更普遍、无需身份相同的后果是“聊天 A 的清理永不回滚”。另外，`clearManualRefillSheetDataInRangeCore_ACU` 在 `chat-service.ts:2861` 有异步点、随后按**下标** `applyCandidateMessageFields_ACU(chat[idx], candidateChat[idx])`（`2874`）；若切换发生在清理循环内部，也可能把 A 的清理结果写到 B 的同下标楼层。这是同一“按当前 chat 解析”根因的更窄窗口，原报告已在跨组线索 3 提到，复核不改判。

### D03-02 → 降级成立｜P2

- 行号核对：一致。`update-orchestrator.ts:4650-4659`、`4721-4759`、`4822/4867/4898/4985/5055/5082/5118`、`table-update-commit.ts:313-323` 均对上。
- 重走路径：
  1. 一键追平提交了若干 bucket，进入 `verifyCommittedCatchUpReplay` 或最后的 `refreshData`。
  2. 用户切到同一角色的另一个已有聊天。`abortOnChatMutation_ACU()` 会中止 run controller；成功路径则可能已经越过循环内的 `executionSnapshotContextStillMatches_ACU`（`4567`/`4582`）。
  3. `persistCatchUpTerminalProgress` 在 `4730` 取**当前** isolationKey，在 `4731` 用 `resolveSafeTerminalTargetMessageIndex()` 读**当前** chat；`hasAnyV2Checkpoint_ACU` 只要求目标下标**及之前**存在 full/transition checkpoint（`storage-frame-v2-persist.ts:500-505`），所以新聊天只要之前填过表就可能通过。
  4. `runTableUpdateCommit_ACU` 没有传 `chatKey`（`4736-4751`）；`assertExpectedCommitScope_ACU` 在 `313-323` 用 `options.chatKey ?? currentChatKey`，期望值就是当前值，恒通过。
  5. 新聊天的 runtime 已由 delayed rebuild 载入、目标楼下标是 AI 楼层、且有 full 锚点时，`persistTableMutationLogV2Core_ACU` 的 `isManualRefillProgressOnly` 分支（`storage-frame-v2-persist.ts:2396-2404`、`2724-2726`）会把旧 run 的 `manualRefillProgress` 写到新聊天的目标楼层。
- 找过的守卫：
  - `executionSnapshotContextStillMatches_ACU` 只在循环开始前/每个 wave 前检查，终态写入前没有再次检查。
  - `verifyCommittedCatchUpReplay` 可能因新聊天 replay 与旧 runtime 不一致而返回 `integrity_failed`，从而不写终态；但若切换发生在验证之后、刷新期间，或新聊天 delayed rebuild 已载入且所选表可 replay，则验证可以通过。
  - `resolveSafeTerminalTargetMessageIndex` 要求旧目标/最后 bucket 下标处有锚点；`persist` 的 progress-only 写入还要求 `hasExistingCheckpoint`（`2399-2404`）。这两道是**触发条件**，不是聊天身份守卫。
- 探针：`V03-terminal-progress-scope.test.ts`（已删除）。没有做完整追平端到端探针（需要复制整套 update-orchestrator mock，且 persist 仍会被 mock，无法证明真实落帧）。改用聚焦探针验证“缺 chatKey 时作用域检查恒通过”这一决定性缺口，2/2 通过：
  ```ts
  mocks.currentChatKey = 'chat-b';
  const result = await runTableUpdateCommit_ACU(terminalOptions(), () => ({ success: true, tableData }));
  expect(result.success).toBe(true);
  expect(mocks.persist.mock.calls[0][0]).toMatchObject({
    targetMessageIndex: 5,
    manualRefillProgress: { runId: 'old-run-a', status: 'complete' },
  });
  // 对照：terminalOptions({ chatKey: 'chat-a' }) → success=false、包含“聊天或隔离标识已切换”、persist 未调用
  ```
  完整调用链（`orchestrateManualCatchUp_ACU` 的 7 个终态调用点 → `persistCatchUpTerminalProgress` → `runTableUpdateCommit_ACU`）已逐行读穿。
- 降级理由：原报告 P1 的“普通操作就能触发”不成立。要让旧进度真正落到新聊天，必须同时满足：切换发生在验证/刷新这个收尾窗口；新聊天 delayed rebuild 已把 runtime 载入；新聊天在旧目标下标处是 AI 楼层；旧目标或最后 bucket 下标之前已有 full/transition 锚点。任一不满足就只得到“终态进度保存失败”的报错，而不是新聊天被写。后果也仅是 `manualRefillProgress` 元数据帧（`persist` 的 progress-only 分支不追加 mutation entry、不改表数据，`storage-frame-v2-persist.ts:2724-2726`），不是表数据被覆盖。按 2.5 仍是 I1（消息字段/聊天元数据写进新聊天），但按严重度表属于“需要特定时机才能触发”，降为 P2。
- 补充或更正：原报告第 108 行说 `persistCatchUpTerminalProgress('stopped')` 也会受切聊天影响；复核认为这条路径通常先因 `currentJsonTableData_ACU` 被 `clearDerivedRuntimeState_ACU` 置空而提交失败（`runTableUpdateCommit_ACU` 要求 `applied.tableData` 非空，`table-update-commit.ts:421-425`），不会真的写新聊天。真正有写风险的是成功路径的 `complete`/`sync_pending` 终态。

### D03-03 → 需真机

- 行号核对：一致。`chat-gateway.ts:89-98`、`119-127`、`177-188`、`200-203`、`229-244`、`307-344`；`update-orchestrator.ts:5130-5133`、`6117-6124`；`init.ts:823-836` 均对上。
- 重走路径（两种宿主顺序）：
  - 顺序 1：删除当前聊天后，宿主先发 `CHAT_CHANGED`（或同步切换 `getCurrentChatId()`）。`keepChatSaveDirtyIfSameChat_ACU` 判为不同聊天，作废待存改动；bucket 提交的 `chatKey` 检查也会拒绝旧结果。这条不会把已删除文件写回，代价是这几批重填（2.7 已知取舍）。
  - 顺序 2：宿主只发 `CHAT_DELETED`，或 `CHAT_CHANGED` 晚于我方 finally；`getCurrentChatId()` 仍指向被删聊天（或返回空，按 `119-127` 仍算“同一聊天”）。此时 `forceFlushChatSave_ACU` 会调用宿主 `saveChat()`；`saveChatToHostStrict_ACU`（`307-344`）也没有任何删除/存在性检查。若宿主此时仍允许 `saveChat()` 写当前聊天，就会把内存里的旧聊天内容重新写成已删除的文件。
- 找过的守卫：
  - `CHAT_DELETED` 只注册了 5 秒后的向量清理（`init.ts:825-836`），不 abort 填表、不清理存盘合并状态、不标记聊天已删除。
  - `CHAT_CHANGED` 的同步段只 abort 在飞请求、销毁派生运行时（`init.ts:546`、`561-568`），不触碰 `chatSaveDirtyChatKey_ACU`。
  - `runTableWriteTransaction` 的 `guardChatSwitch` 在“删除但不切换”时没有可比较的变化，挡不住 strict save。
  - 向量清理自身在 `summary-vector-index-chat-deletion-gc.ts:105-108` 有一条“目标即当前聊天则跳过”的守卫；删除后宿主若仍认为它是当前聊天，5 秒清理会直接跳过，这会让“文件复活但向量已清理”的时序更不确定，而不是更安全。
- 判定：需真机。代码侧能确定的是“没有任何删除/存在性检查”；是否真的重写文件取决于宿主删除当前聊天后的 `getCurrentChatId()`、`chat` 数组、`CHAT_CHANGED`/`CHAT_DELETED` 派发顺序和 `saveChat()` 的拒绝行为。jsdom 下无法判定。
- 玩家可照做的验证步骤：
  1. 打开一个有 10 条以上 AI 回复、表格里有数据的聊天，先手动填表一次，确认表格数据存在。
  2. 点「一键追平」；当右下角进度提示出现「正在保存」「正在填表」或「第 N 批」时，立刻打开左侧角色菜单里的「聊天管理 / 聊天记录」，删除当前打开的这条聊天。
  3. 删除后先看宿主有没有自动打开另一个聊天或新建聊天；再回到该角色的聊天列表，看刚删掉的聊天名有没有重新出现。
  4. 如果它重新出现，点开它，检查表格：正常应没有这条聊天；若出现且表格是删除前的数据（或清理后的半截表），就是问题复现。
  5. 同时按 F12 打开控制台，搜索 `存盘合并`、`补存`、`[ChatGateway]`、`saveChat`。删除后如果仍看到这些日志，说明我方在删除后仍尝试存盘；若没有任何日志且聊天没有复活，说明宿主走的是安全的顺序 1。
- 补充或更正：原报告把“追平存盘合并窗口里还有待存改动”作为主要触发。复核发现追平的每个 bucket 因为 `replaceExistingIncremental` 实际走 strict save（见 D03-07），并不产生 coalesced 待存改动；追平更现实的写回点是 `update-orchestrator.ts:4756` 的终态 strict save。手动重填则确实有 coalesced 待存改动和最终快照 strict save（`chat-service.ts:2677`）。这不改变“缺少删除检查”的结论，只修正触发路径。

### D03-04 → 成立｜P2

- 行号核对：一致。`update-orchestrator.ts:5998`、`6025-6048`、`6036-6048`；`chat-service.ts:2519-2526`、`2532-2545` 均对上。
- 重走路径：
  1. 手动重填最后一个 chunk 成功，`5998` 的 `await loadAllChatMessages_ACU()` 是最后一个 chunk 之后、最终提交之前的主要异步窗口（`6013-6021` 的 staging 收尾若失败会直接走失败分支，不会到最终提交）。
  2. 用户在该窗口切到聊天 B。`executionSnapshotContextStillMatches_ACU` 最后一次检查在 `5867-5881`（每个 chunk 的 AI 调用前），之后没有再次检查。
  3. `manualRefillEnabled` 分支在 `6035-6048` 直接取 `getRuntimeTableDataSnapshot_ACU()` 并调用 `commitManualRefillSheetSnapshotInRangeAtomic_ACU({ targetMessageIndices: contextScopeIndices, ... })`；`contextScopeIndices`、`targetKeys`、`frozenManualRefillTemplateData` 都来自聊天 A。
  4. 该提交函数在 `chat-service.ts:2519-2526` 只传 `guardChatSwitch: true`、不传 `chatKey`；事务入口自比通过。函数内部在 `2527` 重新读当前 chat，用旧下标在 B 上找 `completedMessageIndex`/anchor（`2532-2545`）。
  5. 若 B 有足够的 AI 楼层、V2 锚点，且 delayed rebuild 已把 `currentJsonTableData_ACU` 载入，就会在 B 上建立/复用根、按旧下标 rebase per-sheet checkpoint，并把 B 的 runtime 数据写成“重填完成”快照。若 runtime 未载入，`getRuntimeTableDataSnapshot_ACU` 返回 null，走 `failManualRefillSession`，不会写 B，但 A 的最终单表 checkpoint 也不会落地。
- 找过的守卫：
  - 循环内 `executionSnapshotContextStillMatches_ACU` 只覆盖到最后一个 chunk 的 AI 调用前；最后一个 chunk 完成后没有下一次检查。
  - `commitManualRefillSheetSnapshotInRangeAtomic_ACU` 的 `guardChatSwitch` 只保护事务入口，入口之后才读当前 chat，且没有原始 chatKey。
  - `refreshMergedDataAndNotify_ACU` 的聊天身份检查只保护世界书刷新，不保护最终快照写入。
  - `failManualRefillSession` 只在失败/零提交时回滚；本场景 `committedBucketCount>0`，不会撤销已提交 bucket，也不会阻止最终提交。
- 探针：未做。窗口太窄，且完整重填编排的 mock 成本高；按 P2 规则用读码判定。路径上的每个函数都在当前 HEAD 打开核对过，没有发现聊天身份守卫。
- 补充或更正：原报告说“新聊天 checkpoint 拓扑会被一段不属于它的重填结果改写”。复核补充：更常见的分支是 `getRuntimeTableDataSnapshot_ACU()` 返回 null（delayed rebuild 未完成），此时不会写 B，而是 `failManualRefillSession` 报“无法从运行时导出完整恢复快照”；A 已提交的 bucket 保留，但最终单表 checkpoint 缺失。`6013-6021` 的 staging 收尾也是异步的，但它失败会直接走失败分支，所以真正能走到“最终提交”的窗口仍是 `5998` 之后的同步段；结论不变。

### D03-05 → 成立｜P3

- 行号核对：一致。`update-orchestrator.ts:5278`、`5316`；`useManualUpdate.ts:563`、`576`。
- 重走路径：手动重填清理后首个 AI 调用失败（如 404），零提交，回滚成功。`rollbackRefillCleanupOnZeroCommit` 返回 `rollbackNote: '本次未写入任何数据，已回滚清理'`（`5278`）；`failManualRefillSession` 把它拼进 `result.error`（`5316`）。UI 在失败分支无条件追加 `rollbackNote`（`576`，文案自带句号），于是同一句话出现两遍。
- 找过的守卫：`finishToast`（`useManualUpdate.ts:303-312`）只做 toast 更新，没有去重；成功+回滚分支（`571-575`）用三元表达式避开了重复，只有 `success:false` 分支会重复；`abortRequested` 分支走另一条文案，不受影响。
- 探针：未做（P3 可用读码判定）。
- 补充或更正：无。

### D03-06 → 成立｜P3

- 行号核对：一致。`manual-catch-up-provisional-bridge.ts:489` 是 `establishProvisionalBridge_ACU` 定义；`update-orchestrator.ts:4496-4559` 已改用 staging scope。
- 重走路径：`grep -rn "establishProvisionalBridge_ACU" source/src` 只命中定义本身和 `chat-service.ts:2702` 的注释；生产代码没有任何调用。只有 `source/tests/service/table/catch-up-provisional-bridge.integration.test.ts` 在调用。
- 找过的守卫/调用方：`recoverProvisionalBridgeSession_ACU`、`hasActiveProvisionalBridgeAnywhere_ACU`、`readActiveProvisionalBridge_ACU`、`authorizeManualCatchUpBucketWrite_ACU` 仍被生产路径使用；本条只针对 `establishProvisionalBridge_ACU`，不是整模块死代码。
- 探针：未做（P3）。
- 补充或更正：无。

### D03-07 → 成立｜P3

- 行号核对：一致。`update-orchestrator.ts:4916-4922`（追平 bucket 传 `replaceExistingIncremental: true`）、`2983-2988`（展开为对象）、`4800`/`5131`（开/关合并窗口）；`storage-frame-v2-persist.ts:2816-2820`（replacement 非空即 strict save）均对上。
- 重走路径：一键追平的每个 bucket 都带 `replaceExistingIncremental: true`；`applyUnifiedGroupFillResponses_ACU` 在 `2983-2988` 把它展开成非空 `{ targetMessageIndices, targetSheetKeys }`。`persistTableMutationLogV2Core_ACU` 的 `normalizeIncrementalReplacement_ACU`（`storage-frame-v2-persist.ts:403-428`）只要对象合法就返回非空，`replacement` 非空 → `2816` 的 strict 分支 → 每个 bucket 都 `saveChatToHostStrict_ACU`。合并窗口内没有 coalesced 存盘。
- 找过的守卫：手动重填/普通手动填表传 `replaceExistingIncremental: false`（`5892`），确实走 coalesced；缺口只在追平。
- 测试：`update-orchestrator.test.ts:8674-8699` 把 `persistTablesToChatMessage_ACU` mock 成直接调用 `saveChatToHostCoalesced_ACU`，绕过了真实 persist 的 `replacement` 分支，所以断言“一轮只真存一次”通过，但生产路径不会这样走。
- 探针：未做（P3）。
- 补充或更正：这是性能/注释与测试口径不一致，不是数据缺陷。复核确认 `26e453e6` 的提交说明本身有“strict 存盘照旧直存”的限定，因此更准确的说法是“追平的 replacement 属于 strict 存盘，合并窗口对追平没有实际收益，测试用 mock 把这条差异掩盖了”。级别仍为 P3。

## 跨组线索（复核后）

1. `presentation/bootstrap/init.ts:823-836`：`CHAT_DELETED` 只安排 5 秒向量清理，不 abort、不清理存盘合并、不标记 chatKey 已删除。D03-03 的代码侧根因；是否真重写取决于宿主，需真机。
2. `presentation/triggers/settings-ui-sync/settings-ui-trigger.ts:176-190`：`isAutoUpdatingCard_ACU` 为真时直接 `return`，没有重试。旧轮在切聊天后仍持有全局标志（`state-manager.ts:646-653`，切聊天不释放），新聊天的自动填表可能被跳过。属于 I4，建议与 D01/D02 一起看。
3. `service/chat/chat-service.ts:2819-2898`：`clearManualRefillSheetDataInRangeCore_ACU` 在候选克隆上按**下标**清理，最后 `applyCandidateMessageFields_ACU(chat[idx], candidateChat[idx])` 直接应用到 live chat；清理循环内的异步点或 strict save 期间切聊天/删楼，可能把清理写到别的楼层。D03-01 的同根因更窄窗口。
4. `service/table/update-orchestrator.ts:6053-6059` + `service/vector/summary-vector-index-rebuild-service.ts`：重填完成后的向量索引重建只按当前聊天工作，没有原 run 的 chatKey 复核；删除当前聊天或切聊天后可能为已删除聊天写回向量文件，或把新聊天重建一遍。B 类“向量清理与在途归档谁先谁后”，根因在向量服务。
5. `presentation/triggers/update-process.ts:360`：legacy 手动填表确认文案仍写“执行失败或终止时会回滚到本次操作前的状态”，与当前“只有零提交才回滚”的语义不一致。legacy 入口仍可达（`settings-config-api.ts:132-139`）。
6. `service/table/table-write-transaction.ts:444-449`：`guardChatSwitch` 只在事务入口比较一次，且缺省 `chatKey` 时用当前值自比。D03-01/02/04 的共同根因；建议把“期望 chatKey”改成事务的通用契约。

## 设计层面的疑虑（不计入缺陷）

- **清理是持久化副作用，回滚句柄只存在内存里**：`clearManualRefillSheetDataInRange_ACU` 用 strict save 把清理立即落盘，回滚完全依赖 orchestrator 局部变量；切聊天、应用被杀或编排器异常退出时，旧聊天的清理没有可恢复的持久化证据。R3-06 只解决了同一聊天内的双根问题。建议按 chatKey + 消息指纹持久化一份回滚日志。
- **追平的终态进度是“恢复辅助元数据”，但被当成可有可无的收尾**：缺失或写错聊天时，UI 只把错误拼进 `result.error`，用户很难判断旧聊天的恢复信息是否完整。建议把终态进度失败做成结构化 `progress_metadata_failed` 并在对应聊天里提示，而不是只在当前聊天弹 toast。
- **存盘合并窗口与用户提示脱节**：设计取舍允许切聊天丢未补存批次，但 UI 仍用内存里的 `committedBucketCount` 说“保留了”。建议由编排层给出 `savedToDiskCount` / `chatChanged`，不要由 UI 猜测。

## 查过但判定没问题的场景

1. **A：手动重填中删掉最新楼层（正在填的那一楼）**。`table-fill-target-watch` 会 abort 目标失效的请求；`TableFillTargetGuard.isCurrent` 在提交阶段拒绝；零提交回滚只恢复身份匹配的楼层，被删楼层的数据随楼层一起消失，剩余楼层不会被写入。属 2.7 已接受语义。
2. **A：一键追平中删掉当前波次的目标楼层**。追平走同一套 `collectGroupFillResponse_ACU`/target guard；删楼后该 bucket 失败，前序 bucket 保留，终态进度找不到锚点就只报错不写数据。没有把结果写到别的楼层。
3. **A：普通手动填表（非重填）删楼**。没有清理，失败路径不触发 `rollbackRefillCleanupOnZeroCommit`；每个 chunk 的 `captureFillExecutionScope_ACU` + target guard 会拦住旧结果。
4. **确认框返回时聊天已换（V2 UI）**。`useManualUpdate.ts:504-507`/`656-659`/`680-686` 在确认前后比较 `chatIdentity::isolationKey`，`runtimeTargetsStillMatch` 再比 runtime 表集合；G12-02 已覆盖这里，复核没有发现回归。
5. **追平确认期间删楼**。UI 的 `prepareManualCatchUpPlan_ACU` 结果只用于确认文案；`orchestrateManualCatchUp_ACU` 在 `4398` 会按当前聊天重新规划，不会直接把确认前的冻结下标用于执行。
6. **跨根 staging 汇合（C）**。`commitStagedSheetsAtFullBoundaryAtomic_ACU`（`table-fill-boundary-staging.ts:696-699`）在事务内重新比较 `currentChatFileIdentifier_ACU`/isolationKey，切换后返回 `staging_scope_changed`，不会把旧聊天的 staging 快照折叠进新聊天。D03-02 的终态进度是例外。
7. **最终 `refreshData`/世界书同步（C）**。`refreshMergedDataAndNotify_ACU`（`worldbook/pipeline.ts:699-719`）自己在多次 await 后比较 chatKey/isolationKey，切聊天时返回 `stale:true`，不会把旧聊天数据写成新聊天的世界书条目。
8. **追平中用户点“终止”**。`requestCatchUpAbort` abort 的是 run-scoped controller；已提交 bucket 在同聊天下由 `endChatSaveCoalescing` 补存，终态写 `stopped`。同聊天路径提示与结果一致。

## 附：探针清理确认

- 已删除 `source/tests/__probe_deepseek__/V03-refill-rollback-current-chat.test.ts` 与 `source/tests/__probe_deepseek__/V03-terminal-progress-scope.test.ts`；没有修改任何已有文件。
