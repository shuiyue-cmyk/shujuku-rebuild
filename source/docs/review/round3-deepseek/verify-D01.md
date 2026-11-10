# D01 复核

## 概览

- 原报告：P0 0 / P1 1 / P2 3 / P3 0。
- 复核后：成立 3（D01-01、D01-02、D01-04），降级成立 0，不成立 0，需真机 1（D01-03）。
- 本次没有运行任何已有测试文件，也没有运行 `npm run typecheck`；只运行了下面三个自建探针，报告写完前已全部删除。`tests/__probe_deepseek__/` 下目录里其他编号的探针属于其他复核者，未触碰。
- 结论：原报告的主干判断成立。D01-01 的 C 路径（切聊天）已用真实事务探针复现；A 路径中「删最新楼层」不会位移旧下标，属于触发条件写错，但 C 路径足以支撑该条。D01-02 的内部逻辑已复现并有对照；D01-04 的隔离残留已复现，但「这一楼不会补跑」不成立——下一轮自动填表会按表历史把漏掉的楼层一并补上。D01-03 的「删聊天文件复活 / 向量孤儿」确实取决于宿主事件顺序与 `saveChat` 落盘语义，维持需真机。

### 跑过的探针（均已删除）

- `tests/__probe_deepseek__/V01-purge-chat-switch.test.ts`：1 passed。用真实的 `runTableWriteTransaction_ACU`（未 mock），在 boundary `saveChatToHostStrict` 第一次调用时把宿主 `chat` 数组原地清空并填入新聊天、把当前聊天 id 改成 `chat-b`，再放行。关键断言：
  ```ts
  expect(h.hostChat[0].TavernDB_ACU_IsolatedData).toBeUndefined();
  expect(h.hostChat[1].TavernDB_ACU_IsolatedData).toBeDefined();
  expect(h.saveStrict).toHaveBeenCalledTimes(2);
  ```
- `tests/__probe_deepseek__/V01-init-chain.test.ts`：2 passed。第一条复现「A 的 `loadPreset` 挂起 → 切 B → A 晚排程取消 B 的链」；第二条是对照组（先让 B 的 1200ms 定时器到点再放行 A），证明 B 的链本来会执行。关键断言：
  ```ts
  expect(m.loadMessages).not.toHaveBeenCalled();
  expect(m.refresh).not.toHaveBeenCalled();
  // 对照组：
  expect(m.loadMessages).toHaveBeenCalledTimes(1);
  ```
- `tests/__probe_deepseek__/V01-quarantine-chat-switch.test.ts`：1 passed。用真实 `state-manager`，先造 normal+quiet 两个上下文判 ambiguous，再按 `resetScriptStateForNewChat_ACU` 的重置段清空上下文，最后记录新聊天的唯一 normal 上下文。关键断言：
  ```ts
  expect(oldEnded.status).toBe('ambiguous');
  expect(newEnded.status).toBe('ambiguous');
  expect(newEnded.context).toBeNull();
  ```
- D01-03 没有探针：结论依赖宿主事件顺序和 `saveChat` 的落盘行为，jsdom 无法判定；按 5.3 判「需真机」。

## 逐条复核

### D01-01 → 成立｜P1

- 行号核对：一致。`source/src/service/chat/chat-service.ts:1291-1325`（算 boundary、await boundary checkpoint、收集 orphan）、`:1396-1428`（按 `indicesToPurge` 删字段并 strict save）、`:685-737`（boundary checkpoint 内部 strict save）、`source/src/service/table/update-scheduler.ts:456-458`（自动填表末尾调用 purge）、`source/src/service/table/table-write-transaction.ts:444-450`（`guardChatSwitch`）。
- 重走路径：`executeAutoUpdatePlan_ACU` 在 `setAutoUpdating(false)` 和 `refreshData()` 之后调用 `ops.purgeOldLayerData()`（`update-scheduler.ts:452-458`）。`purgeOldLayerData_ACU` 用 `guardChatSwitch: true` 进入事务，但事务只在**拿锁之后、任务开始之前**比较一次 `currentChatFileIdentifier_ACU`（`table-write-transaction.ts:444-450`）。任务内部先算 `boundary`，再 `await ensureV2BoundaryCheckpointForRetainedBufferCore_ACU(... save: true)`；后者在 `writeV2BoundaryCheckpointBeforePurge_ACU` 成功后 `await saveChatToHostStrict_ACU()`（`chat-service.ts:735-737`）。这段宿主全量存盘可能持续数秒。用户此时点另一个聊天：宿主原地清空并复用同一个 `chat` 数组（2.3 的事实），`chat-service.ts:1285` 捕获的 `chat` 引用仍指向该数组。存盘返回后，`purgeOldLayerDataCore_ACU` 没有重新核对聊天身份，直接按旧 `indicesToPurge` 循环 `const msg = chat[idx]`（`chat-service.ts:1396-1397`），删到的就是新聊天同下标的楼层；随后 `saveChatToHostStrict_ACU()`（`:1428`）把新聊天落盘。
- 找过的守卫：
  - `guardChatSwitch`：只在 `runTableWriteTransaction_ACU` 拿锁后检查一次（`:444-450`），检查完就进入 `task`；任务内所有 `await` 之后没有第二次身份核对。
  - `assertFresh`：只校验表版本 / 运行时 revision（`:467-513`），不感知聊天切换；而且 purge 的 `writeSet` 是 `all`，基线是进入时捕获的，不提供聊天身份保护。
  - `getChatArray_ACU()`：直接返回 `SillyTavern_API_ACU?.chat`（`chat-gateway.ts:19-21`），切聊天复用同一数组，所以 `chat` 不是旧聊天的私有副本。
  - `saveChatToHostStrict_ACU()`：只检查 `saveChat` 可用与 pagehide（`chat-gateway.ts:307-344`），没有聊天身份复核或删除墓碑。
  - 调用方 `executeAutoUpdatePlan_ACU` 在调用 purge 前没有传 chatKey 或回调做二次核对。
  - `purgeOldLayerDataCore_ACU` 内 `chat[anchorIndex]` 的存在性检查（`:1317`）只判断下标有没有楼，不判断是不是原来那一楼。
- 探针：`V01-purge-chat-switch.test.ts`，1 passed。关键是使用真实事务，证明 `guardChatSwitch` 在任务内不会再次触发；数组替换发生在第一次 strict save 内。结果：新聊天 `#0` 的 `TavernDB_ACU_IsolatedData` 被删除，`#1` 保留，strict save 调用 2 次。
- 补充或更正：
  - 原报告 A 路径写「删掉最新楼层」不准确。`indicesToPurge` 是保留边界之前的旧下标；删除**末尾**楼层不会改变这些下标，循环删的仍是同一批旧楼，不会误删幸存楼层。真正会位移旧下标的是「在 boundary save 期间删除锚点之前的楼」——这会把旧锚点之后的幸存楼层顶到旧下标上；若旧 `anchor-1` 本身带数据，刚写好的 boundary checkpoint 也会被顶进待删集合。C 路径（切聊天）不受影响，已由探针坐实。
  - 触发前提补充：`retainRecentLayers` 默认是 100（`settings-service.ts:1172`），需要 AI 楼层数达到 `retain + 20` 缓冲（默认 120 层）才进入 purge；用户把保留层数调低后窗口更容易出现。原报告的触发描述没有写这个门槛。
  - 严重度：原报告 P1。探针显示新聊天 `#0` 的整楼本地表数据被删并落盘；若该楼是唯一 full checkpoint，按 2.9 应算 P0（数据丢失）。另外，若新聊天该楼带交火向量 manifest，`collectVectorIndexGcScopesFromMessage_ACU` 会把它记入 `vectorGcScopes`，strict save 成功后外置向量文件也会被 GC（`chat-service.ts:1404`、`:1444-1448`），后果不止聊天字段。建议协调者按 P0/P1 边界再定；本次复核不改变「成立」判断。
- 测试情况：`tests/service/chat/chat-service.test.ts` 的 purge 用例都是单聊天、不切聊天/不删楼；`tests/presentation/chat-mutation-scheduler.test.ts` 不覆盖 purge。没有测试模拟「boundary save 期间宿主替换 chat 数组」，所以拦不住。

### D01-02 → 成立｜P2

- 行号核对：一致。`source/src/presentation/bootstrap/init.ts:177-221`（`initChainGeneration_ACU` + running 补跑）、`:578-587`（`await loadPresetAndCleanCharacterData_ACU()` 之后才 `scheduleInitChainRun_ACU(1200, ...)`）、`source/src/service/runtime/plot-runtime/plot-history-preset.ts:64-84`（旧聊天带 chat 级剧情快照时 `await saveChatToHost_ACU()`）、`source/src/service/table/update-scheduler.ts:242-244`（`currentJsonTableData` 为空报 `runtime_not_ready`）。
- 重走路径：A 的 CHAT_CHANGED handler 进入 `handleChatChangedEvent_ACU`，在 `loadPresetAndCleanCharacterData_ACU()` 的 `await saveChatToHost_ACU()` 处挂起。用户切 B：B 的 handler 走完同步段并 `scheduleInitChainRun_ACU(1200, 'CHAT_CHANGED', () => runChatChangedDelayedRebuild_ACU('chat-b'))`，代次记为 N。A 的宿主存盘返回后，A 的 handler 继续执行到 `scheduleInitChainRun_ACU(1200, ..., () => runChatChangedDelayedRebuild_ACU('chat-a'))`，代次 N+1。B 的定时器到点时 `scheduledGeneration !== initChainGeneration_ACU` 直接 return（`init.ts:191-194`）；A 的定时器跑 body 时 `runChatChangedDelayedRebuild_ACU` 发现 `currentChatFileIdentifier_ACU` 已是 B，早退（`:420-423`）。B 没有 `loadAllChatMessages` / `refreshMergedDataAndNotify` / hydrate。
- 找过的守卫：
  - `handleChatChangedEvent_ACU` 在 `await loadPreset...` 之后没有核对 `currentChatFileIdentifier_ACU === chatFileName` 再排程；`:587` 无条件排程。
  - `scheduleInitChainRun_ACU` 的代次是「后调用者更大」，不是「聊天更新」；旧 handler 晚调用会覆盖新聊天的代次（`:182-186`）。
  - `initChainRunning_ACU` 补跑只在链**已经开始执行**时登记（`:198-202`）；本场景 B 的定时器还没跑，不走补跑。
  - `runChatChangedDelayedRebuild_ACU` 的身份检查只能防止旧链写错，不能替 B 补一条链。
  - `recoverDelayedRebuildFailure_ACU` 只在抛错时触发；A/B 都没抛错。
- 探针：`V01-init-chain.test.ts`，2 passed。第一条模拟 A 的 `loadPreset` 挂起、B 快速完成，断言 `m.loadMessages` / `m.refresh` 都没被调用。第二条对照组先让 B 的 1200ms 定时器到点再放行 A，断言 B 的链确实调用了 `loadMessages`——证明第一条的「0 次」不是测试基建造成的假阴性。
- 补充或更正：
  - 触发条件比原报告更窄：A 的 handler 必须在 B 排程后的 1200ms 内恢复，才会把 B 的定时器判为过期；如果 A 的 `saveChat` 拖过 B 的 1200ms，B 的链已经开始执行，代次变化不会中止它（代次只在启动时检查）。因此需要「A 的慢 await 在 B 切换后不久返回」这一时机。原报告没有强调这个 1200ms 窗口，但结论方向正确。
  - 真实宿主是否允许两个 CHAT_CHANGED handler 并发，取决于宿主是否串行化切换；上游 ST 的 `eventSource.emit` 会 await listener，但点击另一个聊天可以再起一次 `openCharacterChat`，本仓库没有宿主源码，建议真机确认。不过 2.4 已把「快速来回切换聊天」列为场景，且探针已证明内部状态机会被旧 handler 反超。
- 测试情况：`tests/presentation/bootstrap/init.test.ts` 覆盖单次 CHAT_CHANGED、同名聊天连续事件、running 占用补跑（`:966-1025`），但没有「两个不同聊天的 handler 交错，旧 handler 晚于新 handler 排程」的用例；原报告已指出这一点，核实无误。

### D01-03 → 需真机｜P2

- 行号核对：一致。`source/src/presentation/bootstrap/init.ts:823-843`（唯一的 CHAT_DELETED / GROUP_CHAT_DELETED 监听，只挂 5s 向量清理）、`:544-551`（只有 CHAT_CHANGED 会 `abortOnChatMutation_ACU()` + 清防抖）、`source/src/data/gateways/chat-gateway.ts:119-127`（合并存盘只按聊天 id 作废旧改动）、`:307-344`（strict save 直接调宿主 `saveChat`）、`source/src/service/vector/summary-vector-index-chat-deletion-gc.ts:105-119`（目标等于当前聊天或仍存活时跳过）。
- 重走路径（两种宿主顺序）：
  1. **CHAT_DELETED 先到、稍后才切聊天**：自动填表请求在途或已进入提交/存盘时，删除当前聊天。我们的 handler 只 `setTimeout(5000)` 做向量清理，不 abort、不取消自动任务、不给存盘合并设墓碑。填表结果回来后仍可能在旧聊天对象上提交，`saveChatToHostStrict_ACU()` 在宿主 `getCurrentChatId()` 仍指向被删聊天时调用宿主 `saveChat`；按 2.3，这有可能把文件重新写出。
  2. **先切到新聊天、再发 CHAT_DELETED**：`abortOnChatMutation` 已中止请求；但如果此刻已有一条 strict save / 合并补存排进宿主，宿主仍可能在删除落盘之后执行它；之后 5s 的向量清理看到文件又存活或当前聊天仍是它，就跳过，留下孤儿向量。
- 找过的守卫：
  - `abortOnChatMutation_ACU` 的唯一生产调用点是 `handleChatChangedEvent_ACU`（grep 全仓）；CHAT_DELETED / GROUP_CHAT_DELETED 没有其它监听或中止逻辑。
  - `cancelPendingAutoTasks_ACU` 只在 GENERATION_STARTED/STOPPED、MESSAGE_DELETED/SWIPED 调用，CHAT_DELETED 不调用。
  - 存盘合并的归属判定只在「当前聊天 id 与新聊天不同」时作废旧改动（`chat-gateway.ts:120-127`）；被删聊天仍是 current 时 key 相同，会正常补存。
  - strict save 没有「聊天已删除」的全局墓碑（`chat-gateway.ts:307-344`）；宿主保存队列/`saveChat` 的实际落盘语义不在本仓库。
  - 向量清理自己的 fail-safe（目标即当前聊天 / 同名存活 / 枚举失败一律跳过）会放大问题，但它属于 D06。
- 探针：无。结论依赖宿主先发 CHAT_DELETED 还是先发 CHAT_CHANGED、以及 `saveChat()` 在聊天被删后是新建文件、写到新聊天还是抛错；jsdom 无法判定，按 5.3 判「需真机」。
- 补充或更正：
  - 上游 ST release 的 `delChat()` 实现是「删除文件 → 如果删的是当前聊天，先 `replaceCurrentChat()`（内部 `clearChat({clearData:true})` + `getChat()`，会发 CHAT_CHANGED）→ 最后才 `eventSource.emit(CHAT_DELETED)`」。如果 TT 2.4.0 沿用这个顺序，原报告的「顺序一」就不成立，实际是顺序二；此时在途 AI 请求多半已在 CHAT_CHANGED 被中止，主要剩「已在途的 strict save 与删除落盘的先后」这一竞态。该外部参考不作为判定依据，TT 仍需真机确认。
  - 如果真机证实文件会被重新写出，这不是 P2 的资源残留，而是 I2 的数据损坏，应按 P0/P1 处理；当前因未坐实维持 P2。
- 真机验证步骤（玩家可照做）：
  1. 打开一个有表格数据的聊天，点一次「填表」（或等自动填表），在右下角/填表面板显示「正在填表」时，打开左侧聊天管理列表，删除当前这个聊天。**先不要点别的聊天**，观察聊天列表：被删的聊天是否在几秒内又出现。
  2. 再重复一次：等 AI 回复刚出来、表格还没填完时，删除当前聊天，然后**立刻**点另一个聊天。观察新聊天是否正常、被删聊天是否复活。
  3. 按 F12 打开控制台，搜索 `[交火向量索引] 聊天删除清理`。如果 5 秒后出现 `聊天删除清理跳过：目标即当前聊天` 或 `仍存在同名存活聊天`，说明向量清理没有执行；如果被删聊天又出现在列表里，说明文件被重新写出。
  4. 正常结果：被删聊天一直消失；新聊天表格正常；控制台没有上述跳过日志（或日志显示已清理）。异常结果：被删聊天重新出现在聊天列表/`data/default-user/chats/...` 下；或新聊天表格缺表/缺行；或控制台持续报向量清理跳过。

### D01-04 → 成立｜P2

- 行号核对：一致（`state-manager.ts:317-323` 的函数从 317 开始，原报告写 316-323 属一行偏差，代码一致）。`source/src/service/runtime/state-manager.ts:107`（单槽隔离）、`:317-323`（先查隔离）、`:341-349`（歧义 check + 清空上下文）、`:370-372`（设 `now + GENERATION_CONTEXT_TTL_MS_ACU`）；`source/src/service/worldbook/injection-engine-state.ts:175-182`（重置上下文但没清隔离）；`source/src/presentation/bootstrap/init.ts:944-950`（ambiguous 直接 return）。
- 重走路径：聊天 A 里同时存在 normal + quiet 两个非 dry-run 上下文，ENDED 到达时 `resolveGenerationContextForEnded_ACU` 无法唯一配对，设 `generationEndMatchQuarantineUntil_ACU = now + 60000` 并返回 ambiguous。用户切到 B：`markChatChangedForEndedGate_ACU` 只清 `lastEndedFloorSignature`，`resetScriptStateForNewChat_ACU` 只清 `lastGeneration` / `generationSeq` / `activeGenerations`（`injection-engine-state.ts:175-182`），隔离值原样保留。B 的 `GENERATION_STARTED` 记录唯一 normal 上下文；ENDED 到达时 resolver 在配对之前先命中隔离（`state-manager.ts:346-349`），直接返回 ambiguous，`init.ts:945-950` 不进入自动填表链。
- 找过的守卫：
  - `isGenerationEndMatchQuarantined_ACU` 的到期清零只在 `now >= until` 时发生；切聊天没有任何清零路径（grep 全仓只有设置、到期清零两处）。
  - `markChatChangedForEndedGate_ACU` 只清 `lastEndedFloorSignature_ACU`（`:120-125`）。
  - `resetScriptStateForNewChat_ACU` 的重置段（`:175-182`）确实只清上下文相关字段。
  - 没有别的调用方在 CHAT_CHANGED 时清 `generationEndMatchQuarantineUntil_ACU`。
- 探针：`V01-quarantine-chat-switch.test.ts`，1 passed。先造 A 的 ambiguous，再按 reset 清空，再记录 B 的唯一上下文；断言 B 仍然 ambiguous、context 为 null，隔离截止时间仍在 60s TTL 内。
- 补充或更正：
  - 原报告说「这一楼不会补跑（W3 没有登记，后续也不会重试）」不成立。`buildAutoUpdatePlan_ACU` 用 `history.lastTrackedUpdateAiFloor` 计算缺口（`update-scheduler.ts:116-143`），漏掉的楼层没有推进这个历史前沿；B 的下一次自动填表会把「漏掉的那一楼 + 新一楼」一起放进 `indicesToUpdate` 补跑（前提是下一轮满足 frequency/threshold）。所以真实后果是「首条回复的填表被延迟到下一次自动填表」，不是永久丢失。若用户之后不再发消息，才需要手动补填。
  - 影响范围也比原报告大：隔离 60s 内 B 的**所有** ENDED 都会被拦下并清空 `activeGenerations`，不是只丢第一条；60s 后自然恢复。
  - 如果安装了 MVU，`mag_variable_update_ended` 触发的 W5 重跑（`init.ts:1042-1045` → `handleNewMessageDebounced_ACU('MVU_ANALYSIS_ENDED')`）不经过 generation 配对，可能在下一轮自动填表之前就把该楼补上；无 MVU / MVU 未派发该事件的环境仍按上一段的下一次自动填表补跑。这条不改变「首条回复当下不填」的结论。
  - 严重度维持 P2：属于特定时机（A 出现配对歧义 + 60s 内切到 B 并生成）下的功能延迟，不是永久卡死。
- 测试情况：`tests/service/runtime/state-manager.test.ts` 覆盖了歧义隔离的「同批 fail closed」和 baseline 过期，但没有「切聊天复位上下文后，新聊天的唯一上下文仍被隔离拦截」的用例；原报告已指出，核实无误。

## 跨组线索（只复核与 D01 相关的部分）

- `source/src/service/table/update-scheduler.ts:456-458`：D01-01 的窗口确实在 purge 调用处；建议 D02 复核时确认 purge 回调是否带计划构建时的 chatKey。原报告这条线索成立。
- `source/src/data/gateways/chat-gateway.ts:119-127`、`:307-344`：D01-03 的「最后一公里」确实没有删除墓碑；是否真会复活需真机，建议 D05 一并看。
- `source/src/service/vector/summary-vector-index-chat-deletion-gc.ts:105-119`：D01-03 的向量清理 fail-safe 确实会跳过「目标即当前聊天」，但只有在宿主延迟切聊天或文件被复活时才会留下孤儿；属于 D06，本次不另计。
- `source/src/service/table/update-orchestrator.ts:6013-6042`：原报告给 D03 的手动重填 settle 线索未在本次复核范围内，未验证。

## 查过但判定没问题的场景

- `runTableWriteTransaction_ACU` 的 `guardChatSwitch` 在**拿锁时**是有效的：如果聊天在进入事务前已经切换，会抛 `TableWriteChatSwitchedError_ACU`；问题只在任务内长 await 之后不再复核。
- `purgeOldLayerDataCore_ACU` 的 boundary checkpoint 失败分支会回滚并中止清理（`chat-service.ts:1308-1311`、`:738-755`），不会在失败时继续删旧楼层。
- `purgeOldLayerDataCore_ACU` 的 strict save 失败分支会回滚已删字段（`:1426-1443`）；但宿主 `saveChat` 通常自己吞错并 resolve（`chat-gateway.ts:307-344` 只检测 pagehide），所以这条回滚不能防住「已落盘」之外的逻辑错误。
- `handleChatChangedEvent_ACU` 同步段的 `abortOnChatMutation_ACU`、`clearAutoFillDebounce_ACU`、`clearDerivedRuntimeState_ACU`、`cancelPendingChatMutationRefresh_ACU` 接线完整；D01-02 的问题在延迟排程，不在同步段。
- `MESSAGE_DELETED` / `MESSAGE_SWIPED` 的 `cancelPendingAutoTasks_ACU` + `abortTableFillRequestsWithStaleTarget_ACU` + 删楼保管库复核（`checkpoint-delete-guard.ts:399-430`）没有发现新的跨聊误删路径。
- `initChainRunning_ACU` 的补跑逻辑本身是对的：链已经开始执行时，后来的排程会登记并在 finally 补跑；D01-02 是「定时器还没跑就被代次取代」，不经过补跑。
- `generationEndMatchQuarantineUntil_ACU` 的 60s 到期清零本身正确；D01-04 的问题是切聊天没有清零，不是 TTL 实现错误。
