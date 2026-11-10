# D02 复核

## 概览

- 原报告：P0 1 / P1 1 / P2 4 / P3 1。
- 复核后：成立 3（D02-03、D02-05、D02-07），降级成立 1（D02-01），不成立 1（D02-06），需真机 2（D02-02、D02-04）。
- 总体判断：报告抓到的「自动填表缺少 run 级聊天身份」和「计划下标不重新绑定楼层身份」两条根因是真实存在的；但 D02-01 的 P0 场景被写宽了——新聊天刚打开时，旧下标大于新聊天长度会在 `loadBatchBaseData_ACU` 里直接抛错，根本走不到 AI 和提交；真正能复现跨聊天写入的是「旧计划首楼为 0」或「切到已有长聊天」这类更窄的路径，因此降为 P1。D02-06 是第二轮已经逐字评估过、明确按「纯措辞」不单列的旧结论，按 2.6 不应重报。

### 跑过的探针（均位于 `source/tests/__probe_deepseek__/`，报告完成后已删除）

1. `V02-d02-01-orchestrator.test.ts`（4 个用例全部通过）
   - 用例 1：新聊天只有 1 楼时，用旧下标 5 调 `loadBatchBaseData_ACU` 直接抛错。
   - 用例 2：`executeAutoUpdatePlan_ACU` 两组，group_a 中止并切到新聊天；group_b 仍按旧下标 0 调用真实 `processUpdatesBatch_ACU` + `executeCardUpdateCore_ACU`，最终 `persistTablesToChatMessage_ACU` 收到 `targetMessageIndex: 0`，且新聊天第 0 楼是 AI 开场白。
   - 用例 3：同上但切到一个已有 3 楼（下标 2 是 AI 楼）的聊天；persist 收到 `targetMessageIndex: 2`。
   - 用例 4：group_a 目标 4、group_b 目标 6，删掉第 5 楼后 group_b 仍写第 6 楼；此时第 6 楼已经是原第 7 楼（旁白），persist 目标仍是 6，`failedGroups === 0`。
2. `V02-d02-01-persist.test.ts`（1 个用例通过）
   - 直接调真实 `persistTableMutationLogV2_ACU`，目标下标 0 是当前聊天唯一 AI 楼（开场白），无聊天身份快照；结果 `{"saved":true,"messageIndex":0}`，开场白上真的挂上了 V2 frame。
3. `V02-d02-02-coalescer.test.ts`（2 个用例通过）
   - 删除聊天后 `getCurrentChatId()` 仍返回旧 id：窗口结束的 `endChatSaveCoalescing_ACU()` 调用宿主 `saveChat()` 1 次。
   - 删除后 `getCurrentChatId()` 返回 null：`keepChatSaveDirtyIfSameChat_ACU` 的 null 分支仍按同一聊天处理，同样调用 `saveChat()`。
4. `V02-d02-04-echoguard.test.ts`（1 个用例通过）
   - 以新聊天 chatKey 登记旧楼 messageId 后，新聊天同 messageId 的楼被 `shouldSkipDuplicateAutoTableFill_ACU` 判为回声；不同 id 不命中。

## 逐条复核

### D02-01 → 降级成立｜P1

- 行号核对：一致。报告引用的 `update-scheduler.ts:372-414`、`:381-386`，`update-orchestrator.ts:3985`、`:4000-4002`、`:4042-4047`、`:3381`、`:615-620`，`table-fill-target-guard.ts:77-82`，`storage-frame-v2-persist.ts:2249-2257` 都能找到对应代码。另补两处报告漏掉的关键行：`source/src/service/table/update-orchestrator.ts:812-814`（`loadBatchBaseData_ACU` 直接对 `chatHistory[j]` 取 `.is_user`，下标越界会抛 TypeError）和 `:4055-4057`（自动模式先看本批最后一个 AI 楼长度，越界时为 0 会 `continue`）。
- 重走路径：
  1. 自动入口 `settings-ui-trigger.ts:250-277` 只给 `executeAutoUpdatePlan_ACU` 传了 `processUpdates` 和 `processStagingGroupedUpdates`，**没有传 `processGroupedUpdates`**；普通组走 `update-scheduler.ts:381-386` 的 legacy `processUpdates`，与报告的前提一致。
  2. group_a 的 AI 请求在途时 `CHAT_CHANGED` 调 `abortOnChatMutation_ACU`（`init.ts:546`，`state-manager.ts:636-643`），group_a 返回 `aborted`；`executeAutoUpdatePlan_ACU` 的循环只在失败组列表里记一笔（`update-scheduler.ts:405-411`），继续 group_b。
  3. group_b 的 `processUpdatesBatch_ACU` 重新 `getChatArray_ACU()`（`update-orchestrator.ts:3985`），拿到宿主复用后的新聊天数组；`indices` 仍是旧计划。随后 `loadBatchBaseData_ACU` 用旧的首个下标遍历当前聊天。
  4. **关键分叉**：若旧首个下标 **大于** 新聊天长度（例如旧计划目标 5、新聊天只有开场白 0），`chatHistory[j]` 是 undefined，`loadBatchBaseData_ACU` 在 `:812-814` 直接抛错；`processUpdatesBatch_ACU` 没有捕获它，异常冒泡到 `Promise.allSettled`，group_b 计为失败，AI 与 persist 都不会发生。这是新聊天场景下最常见的结局，也是报告没有验证的一步。
  5. 只有旧首个下标 ≤ 新聊天长度、且目标位置确为 AI 楼时，才会走到 `executeCardUpdateCore_ACU` 的重新捕获（`:3381`、`:615-620`）和提交。此时 `assertExpectedCommitScope_ACU`（`table-update-commit.ts:302-324`）比较的是「切聊天之后捕获的 chatKey」与当前 chatKey，必然一致；`captureTableFillTargetGuard_ACU` 也是切聊天之后拍的新快照，旧下标越界时 `:81` 放行。
- 找过的守卫：
  - `assertExpectedCommitScope_ACU`：只在提交前比较本批捕获的 `chatKey` / `isolationKey`，group_b 是切聊天后才捕获，挡不住。
  - `collectGroupFillResponse_ACU` / `watchTableFillTarget_ACU`：只登记“已经开始 AI 请求”的组；尚未开始的 group_b 没有 watch，`MESSAGE_DELETED`/`CHAT_CHANGED` 的 `abortTableFillRequestsWithStaleTarget_ACU` 也查不到它。
  - `captureTableFillTargetGuard_ACU`：快照是当前聊天，旧下标大于快照长度时直接返回 `true`（`table-fill-target-guard.ts:81`），不是计划身份守卫。
  - `executeAutoUpdatePlan_ACU` / `settings-ui-trigger.ts`：没有 plan 级 chatKey、首楼消息对象或 `message_id` 快照；`executeAutoUpdatePlan_ACU` 组间也不检查 `isTableFillStopRequested_ACU`/聊天身份。
  - `loadBatchBaseData_ACU` 的越界抛错只是偶然的 fail-fast，不是设计守卫；它只覆盖「旧首个下标 > 新聊天长度」，不覆盖旧下标落在新聊天已有 AI 楼的情况。
- 探针：`V02-d02-01-orchestrator.test.ts` 4 个用例全部通过；`V02-d02-01-persist.test.ts` 1 个用例通过。关键断言（≤8 行）：
  ```ts
  expect(() => loadBatchBaseData_ACU(newChat, 5, '', ['sheet_1'], { sheet_1: { name: '表B', content: [['row_id']] } })).toThrow();
  // 新聊天场景：旧计划首楼 0 → 新聊天开场白 0
  expect(persistOptions.targetMessageIndex).toBe(0);
  expect(persistOptions.tableData.sheet_1.content).toContainEqual(['2', '来自旧计划']);
  // 已有聊天场景：旧下标 2 → 该聊天 AI 楼 2
  expect(persistOptions.targetMessageIndex).toBe(2);
  // 真实 persist：目标 0 是当前聊天唯一 AI 楼时 saved=true
  expect(result.saved).toBe(true);
  ```
- 补充或更正：
  - 报告标题「新开聊天后，旧计划的后续组/批会把结果写进新聊天」写宽了。按实际代码，新聊天只有开场白时，旧首楼下标大于 0 会在 `loadBatchBaseData_ACU` 抛错或阈值 `continue`；报告 step 5 所说「等新聊天在该下标生成 AI 回复后」不成立，因为目标下标在发 AI 请求之前就被读取了，越界时根本不会发请求。
  - 真正可复现的路径比报告窄：a) 旧计划首个下标为 0（例如新加的表从未填过，且表/全局 `batchSize=1`，或计划恰好只有 0 楼），新聊天开场白长度超过 `autoUpdateTokenThreshold`，会写到新聊天 0 楼；b) 切到**已有**且有足够楼层的聊天，旧下标落在该聊天的 AI 楼上，会写到那个聊天（探针用例 3）。后者不是「新开聊天」，但同属 I1，修法应一并覆盖。
  - 严重度从 P0 降为 P1：数据确实会被悄悄写到另一个聊天，但报告描述的新聊天常规路径大多在 `loadBatchBaseData` 前失败，触发条件比报告苛刻。
- 现有测试为什么没拦住：`update-scheduler.test.ts:670-687` 的「多组部分失败」里 `processUpdates` 是纯 mock，没有聊天身份概念；`update-orchestrator.test.ts:1503` 只测目标楼自身被删、请求被 watch 中止；没有「一组失败后切聊天、下一组用旧下标继续」的用例。
- 修法方向：在构建计划时冻结 `{chatKey, isolationKey, 首楼消息对象/指纹}`，每个组、每个批、每次提交前复核；不一致就整轮中止并返回稳定的 `chat_changed`。也可以把 plan 的 chatKey 显式传进 `processUpdatesBatch_ACU`/`executeCardUpdateCore_ACU`，让提交层拒绝跨聊天批次，而不是靠 `loadBatchBaseData` 的越界异常碰巧挡住。
- 与以前复审的关系：新问题。R9-18/G14 的复核覆盖的是防抖、等 MVU、楼层解析阶段的跨聊天；没有覆盖「计划已经开始执行」之后的组/批。

### D02-02 → 需真机｜P1

- 行号核对：一致。`init.ts:825-836`（`CHAT_DELETED`/`GROUP_CHAT_DELETED` 只接向量清理，延迟 5 秒）、`update-orchestrator.ts:4102-4104`（每组 `finally` 补存）、`chat-gateway.ts:194-203`（`endChatSaveCoalescing_ACU` 无条件 flush）、`:229-244`（`forceFlushChatSave_ACU`）、`:109-127`（dirty 归属只认 chat id）都对得上。
- 重走路径：
  1. 自动/手动填表进入运行窗口，`beginChatSaveCoalescing_ACU` 计数 +1；每批的普通存盘只 `markChatSaveDirty_ACU` 记下 dirty，窗口内不立即写盘。
  2. 宿主删除当前聊天时，本仓库唯一的 `CHAT_DELETED` 监听是 `init.ts:834-836` 的向量清理；填表侧没有中止、没有清 coalescer、没有把该 chat id 标成已删除。
  3. 如果宿主只发 `CHAT_DELETED`、暂不切走当前 id（或把 id 置空但不触发 `CHAT_CHANGED`），在途 AI 请求不会被 `abortOnChatMutation_ACU` 中止（它只挂在 `CHAT_CHANGED`）；组结束的 `endChatSaveCoalescing_ACU` 走到 `forceFlushChatSave_ACU`，`keepChatSaveDirtyIfSameChat_ACU` 看到 key 相同（`chat-gateway.ts:123`）或 key 为 null（`:121`）都返回 true，于是调用宿主 `saveChat()`。
  4. 按共同规则 2.3，宿主当前 id 还指着刚被删的聊天时，`saveChat()` **有可能**把那个文件重新写出来。这一步在仓库里没有宿主源码，无法在本机坐实。
  5. 若宿主先 `CHAT_DELETED` 再立即 `CHAT_CHANGED`，旧 dirty 会被 `keepChatSaveDirtyIfSameChat_ACU` 作废（这一步是正确的），但后续组又会在新聊天上执行，退回 D02-01 的跨聊天问题。
- 找过的守卫：
  - `init.ts:834-836`：只清向量，不碰填表/存盘。
  - `keepChatSaveDirtyIfSameChat_ACU`：只比较当前 chat id，删除不会改变 id；id 为 null 时还按同一聊天处理。
  - `forceFlushChatSave_ACU`：没有任何“当前聊天文件是否还存在”的探测。
  - `assertExpectedCommitScope_ACU`：只比较 `currentChatFileIdentifier_ACU` 与捕获值；删除聊天不会改变这个值（宿主是否同步清 id 未知）。
  - `purgeOldLayerData_ACU` 的 `guardChatSwitch` 只按聊天 id 复核，不处理“被删聊天”的收尾。
- 探针：`V02-d02-02-coalescer.test.ts` 2 个用例通过。关键断言（≤8 行）：
  ```ts
  gateway.beginChatSaveCoalescing_ACU();
  await gateway.saveChatToHostCoalesced_ACU();       // 窗口内只记 dirty
  await gateway.endChatSaveCoalescing_ACU();
  expect(host.saveChat).toHaveBeenCalledTimes(1);    // id 不变
  // id 被宿主置空时：
  host.currentId = null;
  await gateway.endChatSaveCoalescing_ACU();
  expect(host.saveChat).toHaveBeenCalledTimes(1);
  ```
  探针只证明“我方会调用 saveChat”，不能证明宿主一定把已删除文件写回；所以判需真机。
- 需真机验证步骤（玩家可照做）：
  1. 选一个较长的聊天（至少 6~8 条 AI 回复），确认自动填表已开启；正常发一条消息，等 AI 回复出来，看到右下角/状态区出现「正在填表」。
  2. 填表还在进行时，打开酒馆左侧的聊天列表（聊天管理/历史），找到当前正在使用的这个聊天，直接点删除，**不要先切换到别的聊天**；如果弹出确认，确认删除。
  3. 看聊天列表：被删的聊天是否仍然消失。正常应当是彻底消失；如果有问题，它会重新出现在列表里，或者过几秒后又出现。
  4. 如果宿主自动打开了另一个聊天，等填表结束，打开表格页，检查新聊天里的表格是否出现了旧聊天才有的行/数值；同时按 F12 打开控制台，搜索 `存盘合并`、`saveChat`、`ChatGateway`。
  5. 正常：被删聊天不回来，新聊天表格只有自己的数据。有问题：被删聊天“复活”，或新聊天表格出现旧聊天的行。
- 补充或更正：报告的「情况 1」依赖宿主只发 `CHAT_DELETED`、且 `getCurrentChatId()` 仍指向被删聊天；若宿主删除后立即发 `CHAT_CHANGED`，这段会退化成 D02-01 的跨聊天问题，不会重写旧文件。报告标「待坐实（需真机）」是正确的，复核维持需真机，但后果上限仍是 P1，不能在没有真机证据时判成已坐实。
- 现有测试为什么没拦住：`tests/data/gateways/chat-save-coalescer.test.ts:225` 只覆盖「记下改动后切到别的聊天 → 冲洗时作废」；`init.test.ts:364-377` 只断言 `CHAT_DELETED` handler 已注册，没有行为用例；`checkpoint-delete-guard.test.ts` 覆盖的是被删楼层的 checkpoint 前移，不是聊天文件删除。

### D02-03 → 成立｜P2

- 行号核对：一致。`update-scheduler.ts:381-386`、`update-orchestrator.ts:3985`、`:4000-4002`、`:4042-4047`、`:4074-4086`、`:3381`、`:615-620`、`table-fill-target-guard.ts:72-82`、`init.ts:1290-1310` 都存在且引用准确。
- 重走路径：
  1. 自动填表计划有 group_a（目标 4）和 group_b（目标 6），默认 `maxConcurrentGroups=1`，group_a 的 AI 请求在途。
  2. 用户删掉第 5 楼（位于 4 和 6 之间）。`MESSAGE_DELETED` 的 `cancelPendingAutoTasks_ACU` 只清防抖/递增事件代次（`settings-ui-connect.ts:250-255`），`abortTableFillRequestsWithStaleTarget_ACU` 只遍历 `activeWatches_ACU`；group_a 的目标 4 没变，不会被中止。
  3. group_a 正常提交。group_b 开始，`collectGroupFillResponse_ACU` 在此时才 `captureTableFillTargetGuard_ACU`（`update-orchestrator.ts:615-620`），快照是删楼后的聊天；旧下标 6 现在指向原第 7 楼（若它是 AI 楼），守卫认为“同一条回复”，提交层 `assertExpectedCommitScope_ACU` 也按删楼后的捕获值比较，不会拒绝。
  4. 旧计划的结果被写到原第 7 楼，而不是计划目标原第 6 楼；表格与剩余楼层的对应关系错位。
- 找过的守卫：
  - `abortTableFillRequestsWithStaleTarget_ACU` / `table-fill-target-watch.ts`：只对已在途的请求按目标下标判定；group_b 尚未开始，没有 watch。
  - `cancelPendingAutoTasks_ACU` 的事件代次：只被 `handleNewMessageDebounced_ACU` 的防抖/等 MVU/楼层解析阶段消费；`processUpdatesBatch_ACU` 不读它。
  - `assertExpectedCommitScope_ACU`：targetGuard 是本批开始时捕获的，删楼发生在捕获之前，比较的是“删楼后同一条回复”。
  - 计划层 `TableUpdateItem.indices` 只有整数下标，没有 `message_id`/消息对象快照，无法在后续批次重新绑定。
- 探针：`V02-d02-01-orchestrator.test.ts` 用例 4 通过；group_a 目标 4、group_b 目标 6，删掉第 5 楼，group_b 的 persist 收到 `targetMessageIndex: 6`，而 `chat[6].mes` 已经是原第 7 楼的 600 字旁白；`failedGroups === 0`。关键断言（≤8 行）：
  ```ts
  mockChatArrayForSeedStage.splice(5, 1);             // 删掉两组之间的第 5 楼
  // group_b 仍按旧 indices [6] 执行
  expect(persistOptions.targetMessageIndex).toBe(6);
  expect(mockChatArrayForSeedStage[6].mes).toBe('旁白'.repeat(300)); // 原第 7 楼
  expect(result.failedGroups).toBe(0);
  ```
- 补充或更正：报告说「如果落在 user 楼或越界，persist 返回 no AI message / 整轮失败」是准确的；探针补上了「落在连续 AI 楼时真的会错写」这一半。触发条件需要删楼发生在 group_b 的 AI 请求开始之前，且删楼后旧下标落在 AI 楼；不是每次删楼都发生。
- 现有测试为什么没拦住：`table-fill-target-watch.test.ts` 只测「在途请求目标失效当场中止 / 仍有效的不动」；`update-orchestrator.test.ts:1503` 只测目标楼自身被删；没有「多组顺序执行 + 删除中段楼 + 后续组旧下标位移」的用例。
- 修法方向：计划生成时为每个目标下标记录消息身份（`message_id` 或对象指纹），每批开始和提交前比对“这些下标是否仍映射到同一条消息”，不一致就整轮中止或用身份重新绑定；不能只在删楼后重新拍一次守卫。
- 与以前复审的关系：新问题。2.7 的既定取舍是「删楼不整体中止，只中止目标失效的在途请求」，但未开始的后续批次重新绑定目标身份并不在取舍范围内。

### D02-04 → 需真机｜P2

- 行号核对：一致。`settings-ui-trigger.ts:157-167`、`:283-288`，`auto-fill-echo-guard.ts:157-167`、`:137-150`，`optimization-cache-storage.ts:259-277`，`message-handler.ts:110-127` 都存在且引用准确。
- 重走路径：
  1. 触发开始时 `autoFillTargetFloor = resolveLatestAiFloor_ACU(...)`（`settings-ui-trigger.ts:157`）只记了 `messageIndex`/`messageId`，没有记下当时的聊天 id。
  2. 所有组成功后，收尾的 `loadAllChatMessages` / `refreshData` / `purgeOldLayerData` 期间用户切到新聊天；`recordAutoTableFillProcessedForFloor_ACU(autoFillTargetFloor)`（`:283-284`）此时才执行，`auto-fill-echo-guard.ts:165` 取的是**当前** `currentChatFileIdentifier_ACU`，于是旧楼的 `messageId` 被登记到新聊天的 chatKey 下。
  3. 新聊天自己的自动填表在 `settings-ui-trigger.ts:157-167` 调 `shouldSkipDuplicateAutoTableFill_ACU`；如果新聊天最新 AI 楼的 `messageId` 恰好与旧楼相同，`findChainProcessedEntry_ACU`（`optimization-cache-storage.ts:259-277`）按 messageId + 当前 chatKey 命中，直接 `duplicate_auto_fill_ended` 返回，绕过 `pendingAutoUpdateTrigger` 的补跑。
- 找过的守卫：
  - `handleNewMessageDebounced_ACU` 虽在 `settings-ui-connect.ts:265-274` 捕获了 `scheduledChatKey`，但只用于防抖/MVU/楼层解析；`triggerAutomaticUpdateIfNeeded_ACU` 没有接收这个 key，登记时也无从比对。
  - `findChainProcessedEntry_ACU` 的 chatKey 兜底只在两侧都有值且不同时拒绝；登记和查询都用“当前” key，必然一致。
  - `recordAutoTableFillProcessedForFloor_ACU` 没有“记录来源聊天”的字段，无法在查询时反查目标楼属于哪个聊天。
- 探针：`V02-d02-04-echoguard.test.ts` 1 个用例通过。关键断言（≤8 行）：
  ```ts
  mockChatKey.value = 'chat-B';
  recordAutoTableFillProcessedForFloor_ACU({ messageIndex: 2, messageId: 2 });
  expect(shouldSkipDuplicateAutoTableFill_ACU({ messageIndex: 2, messageId: 2 })).toBe(true);
  expect(shouldSkipDuplicateAutoTableFill_ACU({ messageIndex: 2, messageId: 3 })).toBe(false);
  ```
  该探针只证明“messageId 相同就会跨聊天命中”；**能不能真的同号取决于宿主 `message_id` 的分配规则**。仓库里 `native-st-backend.ts:336` 把对外 API 的 `message_id` 映射为数组下标，但原始宿主消息对象是否按楼层/序号复用 `message_id`，没有宿主源码无法确认；`message-handler.ts:110-127` 明确兼容“稳定 id”和“事件值就是下标”两种宿主。所以判需真机，不能按已坐实处理。
- 需真机验证步骤（玩家可照做）：
  1. 用同一角色开一个**短**聊天 A：只有开场白加一次“用户发言 + AI 回复”，让最新 AI 楼是第 2 楼（界面显示第 1 条 AI 回复；如果开场白也算一条，就记下它是第几条）。
  2. 确认这条回复自动填表成功（表格页出现该楼的数据；F12 控制台搜索 `已登记第` 能看到“已登记…自动填表完成记录”）。
  3. 在填表刚完成、界面还在刷新的时候，点「开始新聊天」；新聊天打开后只发一条消息，等 AI 回复出来。
  4. 看新聊天的这条回复是否自动填表：正常应在几秒内出现「正在填表」并更新表格；如果 F12 控制台出现 `duplicate_auto_fill_ended`，且提示的楼号/消息 id 和新回复一致，就是本问题。
  5. 为确认不是别的原因，再在另一条新聊天里重复一次；正常应当每次都能自动填表。
- 补充或更正：报告把「host message_id 按楼层/序号分配时会重号」当作触发条件，但没有给出 TT 2.4.0 的实际证据；`native-st-backend` 的 `message_id: index` 是对外兼容 API 的映射，不等于宿主原始消息对象。因此维持「待坐实/需真机」，不判成立。
- 现有测试为什么没拦住：`auto-fill-echo-guard.test.ts` 的跨聊天用例是「先以 chat-A 登记，再改 chatKey 查询」，两侧不同所以不命中；没有覆盖「登记时已经切到新聊天、旧楼 messageId 写到新 chatKey」的方向。`settings-ui-trigger.test.ts` 没有“成功后切聊天再登记”的用例。

### D02-05 → 成立｜P2

- 行号核对：一致。`update-scheduler.ts:157`（`scheduleSignature` 只含 groupId/threshold/frequency/skip/rawBatch）、`:164-184`（分组 key 不含 preset）、`:381-386`（`requestOptions: null`），`update-orchestrator.ts:4063-4071`（只取 `effectiveTargetSheetKeys[0]` 的表名）、`:2810-2815`（grouped 路径同样第一张表），手动路径 `:5434-5441`（按 preset 拆组）都在。
- 重走路径：
  1. 同一角色卡两张表使用相同自动配置（`groupId=-1`、相同 threshold/frequency/skip/batch），但在可视化器分别设置不同的表级 API 预设。
  2. `buildAutoUpdatePlan_ACU` 的 `scheduleSignature` 不含表级 preset，分组 key 只由 `scheduleSignature + indices + batchSize + staging` 组成，两张表被合进同一个 `UpdateGroup`。
  3. `processUpdatesBatch_ACU` 收到的 `requestOptions` 是调度层传的 null，于是用 `effectiveTargetSheetKeys[0]` 的第一张表名解析 preset（`:4066-4071`），整组两张表都用这个 preset；第二张表的 preset 被静默忽略。
  4. 自动 staging 的 grouped 路径在 `:2811` 同样只取 `sheetKeys[0]`；手动路径在 `:5434-5441` 明确把 preset 放进 group key 拆组，注释还写着「不同 preset 必须拆组，禁止静默采用第一张表配置」。
- 找过的守卫：
  - `resolveTableApiPresetOverride_ACU` 本身按表名逐个解析，没有问题；问题在自动路径的分组和组内只取第一张表。
  - 调度层 `executeGroupChunk` 的 `requestOptions` 固定 null（`update-scheduler.ts:343`），没有为组内每张表传不同 preset。
  - 自动路径没有像手动路径那样把 preset 放进 `TableUpdateItem`/`UpdateGroup` 或分组 key。
- 探针：未建探针（P2，完整读代码即可判定）。已用 grep 核对全部解析点：`:2812`、`:4068`、`:4232`、`:5429`；自动路径的两处（2812/4068）都取第一张表，手动/追平两处（4232/5429）逐个表处理。
- 现有测试为什么没拦住：`update-orchestrator.test.ts:4971` 只覆盖 `orchestrateManualUpdate_ACU` 的「不同 preset 拆组」；`update-scheduler.test.ts` 的分组用例只覆盖不同 groupId、同组不同频率等，没有 preset 维度；`update-orchestrator.test.ts:4911` 的「表有覆盖预设」只覆盖单表。
- 补充或更正：报告说自动 staging 组也会合并不同 preset 的表，这一点成立；但普通自动组实际走的是 legacy `processUpdates`（`settings-ui-trigger.ts:250-277` 没传 `processGroupedUpdates`），报告在 D02-01 已说明，这里不影响结论。
- 修法方向：在 `TableUpdateItem`/`UpdateGroup` 里带上该表解析后的 `tableApiPreset`，把 preset 加入分组 key（不同 preset 不合并），并在 `processUpdatesBatch`/grouped 路径按组传 `requestOptions`；如果设计上必须合并，至少检测组内 preset 不一致并告警/拆组，不能静默用第一张表。
- 与以前复审的关系：新问题。G09-04 是表级预设的读取口径，不是自动填表分组。

### D02-06 → 不成立

- 决定性证据：第二轮复审的 `source/docs/review/round2-qwen/G03.md:259` 已经逐字评估过同一条链：
  > `processUpdatesBatch_ACU:3976-3978` 用户终止时返回 `{success:false, error:'填表任务已由用户终止。'}` 而不带 `aborted:true`，于是 legacy 路径会弹一个 error 级 toast（`update-process.ts:307-309`）、调度层把它计成「N 组失败」（`update-scheduler.ts:402-408`）。只是提示级别/措辞不准（用户主动终止被报成失败），不改数据、不影响 `settings-ui-trigger.ts:283` 的判重登记（那里另有 `!wasStoppedByUser_ACU` 兜底），按 2.5「不要报纯措辞」不单列。
- 行号核对：报告引用的当前行号（`update-orchestrator.ts:3997-3998`、`update-process.ts:313-315`、`update-scheduler.ts:436-445`、`settings-ui-trigger.ts:291-298`）都对，但行号漂移后的代码语义与 G03 记录的完全一致，没有出现新的数据后果。
- 重走路径：用户点终止 → 当前组 `processUpdatesBatch_ACU` 返回 `success:false` 且无 `aborted` → `processUpdates_ACU` 弹 error toast → 调度层继续后续组，后续组在批次顶层看到终止锁存又返回同样的失败 → 每组一次 error toast，最后 trigger 再弹「N 组失败」。这条路径在 G03 已经完整描述，并明确决定不单列。
- 报告新增的「后续组各自开关一次存盘合并窗口 / 执行最终 `loadAllChatMessages` / `refreshData` / `purgeOldLayerData`」：这些是终止后正常收尾，`processUpdatesBatch_ACU` 的 `finally` 和 `executeAutoUpdatePlan_ACU:451-458` 本来就走；没有证明它们造成数据错误或新聊天误写（误写属于 D02-01/03 的根因）。这不足以把一条纯提示语义问题升级成新缺陷。
- 结论：按 2.6「标了不修 / 保留 / 设计取舍 / 待真机的条目是已有结论，不要再报」以及 G03 明确的「不单列」，D02-06 不成立。若协调者想重新审视“终止是否应显示为失败”的产品语义，那是新决策，不是本轮新发现。
- 现有测试：`update-orchestrator.test.ts:1112` 只覆盖单组终止后不执行后续批次；`update-scheduler.test.ts` 没有终止/中止组间传播的用例——这与 G03 的判断一致，不构成新证据。

### D02-07 → 成立｜P3

- 行号核对：一致。`update-scheduler.ts:135-138`（`contextScopeIndices = effectiveAiIndices.slice(-threshold)` 只在 `:138` 的日志里出现）、`:125`（`threshold` 只作为 `> 0` 的布尔门槛）、`update-orchestrator.ts:4042-4047`（提示词上下文是本批 `chatHistory.slice`，没有 `contextScopeIndices`）、`tests/service/table/update-scheduler.test.ts:340-359`（只断言填表范围不裁剪，注释仍称 contextDepth 是 AI prompt 上下文窗口）都对。
- 重走路径：用户把某张表的「上下文层数」从 3 改成 10；`buildAutoUpdatePlan_ACU` 里 `threshold` 变成 10，但 `indicesToUpdate = unupdatedAiIndices` 完全不受影响，`contextScopeIndices` 算出来后只写日志；`processUpdatesBatch_ACU` 构建 `messagesForContext` 用的是 `firstMessageIndexOfBatch..lastMessageIndexOfBatch` 的批次切片，不读 `contextScopeIndices`。AI 看到的上下文因此没有变化。
- 找过的消费点：grep `contextScopeIndices` 只有 `update-scheduler.ts:136/138`；grep `contextDepth` 的其余使用是模板默认值、归一化、编辑器字段和手动路径的独立 `manualUpdateContextDepth`，没有自动提示词构建消费它。
- 探针：未建探针（P3，代码路径确定；`contextScopeIndices` 只有日志一处使用，属于可由静态阅读确认的死变量）。
- 补充或更正：报告把问题描述成「设置值与提示词窗口脱钩」是准确的；但要注意这不是“设置完全无效”——`threshold > 0` 仍决定这张表是否参与自动更新（`:125`），只是数值大小不再影响提示词窗口。若产品已决定废弃该字段，修法应同时移除 UI/配置，避免用户误以为能看到更多上下文。
- 现有测试为什么没拦住：`update-scheduler.test.ts:340` 只验证“contextDepth 不裁剪填表范围”，没有验证提示词窗口；也没有测试把 contextDepth 3→10 后 `prepareAIInput` 的入参是否变化。
- 修法方向：要么把 `contextScopeIndices` 接进提示词上下文（保留“填表范围=完整缺口”的 §5.6 语义），要么承认设置已废弃并从 UI/模板配置中移除；同时删掉死变量和过时注释。
- 与以前复审的关系：新问题（§5.6 改造留下的半截）。

## 补充说明（不计入缺陷编号）

1. **D02-01 的修正触发路径**：如果协调者只关心“新开聊天”，实际可复现路径是 `batchSize=1`（或计划恰好只有下标 0）+ 新聊天开场白长度超过 `autoUpdateTokenThreshold`；如果关心“切到任何聊天”，探针用例 3 已证明切到已有聊天且旧下标落在 AI 楼时会直接写错聊天。后者同样违反 I1，建议合并到同一条修法。
2. **D02-02 的宿主前提**：本机没有宿主源码，无法判断 `CHAT_DELETED` 与 `CHAT_CHANGED` 的先后、`saveChat()` 对已删除文件的行为。报告已经标「待真机」，复核维持。
3. **D02-04 的 message_id 前提**：`native-st-backend.ts:336` 的 `message_id: index` 是对外 API 的映射，不能直接证明原始宿主消息对象会跨聊天复用 `message_id`；这一点是判「需真机」而不是「成立」的原因。

## 查过但判定没问题的场景

- **目标楼自身被删 / 滑动 / 重新生成**：`collectGroupFillResponse_ACU` 在请求前后都查 `targetGuard.isCurrent`，`watchTableFillTarget_ACU` 在 `MESSAGE_DELETED`/`MESSAGE_SWIPED` 时当场中止；提交层 `assertExpectedCommitScope_ACU` 再查一次。单目标楼失效链路完整。
- **删楼 / 滑动不整体中止**：2.7 的既定取舍；本轮只报“未开始的后续批次不重新绑定目标身份”，没有要求整体中止。
- **存盘合并窗口切聊天作废旧改动**：`markChatSaveDirty_ACU` / `keepChatSaveDirtyIfSameChat_ACU` 在聊天 id 变化时清 dirty，`chat-save-coalescer.test.ts:225` 覆盖；不是问题（删除聊天另见 D02-02）。
- **`handleNewMessageDebounced_ACU` 的排程期 chatKey 复核**：R9-18 的防抖/楼层层解析阶段复检是完整的；D02-01/03 报的是它之后的执行阶段。
- **`table-fill-target-watch` 的注销与去重**：`unwatch` 在 `finally` 调用，`abortTableFillRequestsWithStaleTarget_ACU` 用 Set 去重；未发现泄漏。
- **`executeAutoUpdatePlan_ACU` 的 stored `postCommitWarnings` 分支**：`update-scheduler.ts:398-401` 从 `result.value?.success` 里挖对象的写法在 `processUpdates_ACU` 返回 boolean 时是死分支，但只是防御性代码，不影响本轮结论，未单列。

## 自查

- 每个判定都重新打开过对应 `文件:行号`；D02-01 另补了 `update-orchestrator.ts:812-814`、`:4055-4057` 两处关键行。
- 所有探针都只放在 `source/tests/__probe_deepseek__/V02-*`，跑完已删除；没有运行任何既有测试文件。
- 没有修改仓库已有文件，没有执行 git 写操作。
