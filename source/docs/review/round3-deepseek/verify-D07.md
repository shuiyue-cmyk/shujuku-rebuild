# D07 复核

## 概览

- 原报告：P0 0 / P1 1 / P2 3 / P3 1。
- 复核后：**成立 3，降级成立 0，不成立 1，需真机 1**。
  - 成立：D07-01（P1）、D07-03（P2）、D07-05（P3）。
  - 需真机：D07-02（P2，代码事实成立，触发时序依赖宿主生成事件与旧轮收尾时长）。
  - 不成立：D07-04（报告写的「同一次 staging run 内后续 bucket」路径被失败 bucket 的 fail-fast 先行截断，共用 controller 不是决定性原因；真实残余在跨 staging chunk，见补充）。
- 跑过的探针（均已删除，只跑探针，未跑任何已有测试文件）：
  1. `source/tests/__probe_deepseek__/V07-refill-restore.test.ts`：2 个用例通过，复现「保存期间删楼/切聊天 → cleanup 失败恢复按下标写错楼层」。
  2. `source/tests/__probe_deepseek__/V07-sql-first-block.test.ts`：3 个用例通过，复现「解析器取最后一对 / SQL 收集取第一块 / 第一块 SQL 真被执行 / 空首块走 JSON 分支后抛基础设施错误」。
  3. `source/tests/__probe_deepseek__/V07-shared-abort.test.ts`：1 个用例通过，复现「一个目标失效会 abort 共用 controller，即使另一个目标仍有效」；该探针只证明 watch 层，不证明报告写的跨 bucket 后果。
- 读过的范围：
  - **通读**：`service/table/table-fill-target-watch.ts`、`service/table/table-fill-target-guard.ts`、`service/table/table-fill-staging-session.ts` 的关键段、`service/chat/chat-service.ts` 的 `clearManualRefillSheetDataInRangeCore_ACU` / `clearManualRefillSheetDataInRange_ACU` / 清理回滚段、`presentation/triggers/settings-ui-sync/settings-ui-trigger.ts` 的自动触发与 finally、`service/table/update-scheduler.ts` 的前置检查与分组调度。
  - **重点抽读**：`update-orchestrator.ts` 的 `collectGroupFillResponse_ACU`（1464-1717）、`applyUnifiedGroupFillResponsesCore_ACU` 的 SQL / JSON 分支与 bucket 循环（1900-3070）、`executeAutoFillStagingGroups_ACU`（3107-3331）、`executeCardUpdateCore_ACU`（3339-3900）、`orchestrateManualUpdate_ACU` 的清理/复检/收尾（5345-5764、6020-6124）、`orchestrateManualCatchUp_ACU`（4780-5134）；`presentation-v3/pages/TablePage.vue`、`presentation-v2/composables/useManualUpdate.ts`、`presentation/triggers/update-process.ts`、`presentation/bootstrap/api-groups/settings-config-api.ts`、`data/gateways/chat-gateway.ts` 的 strict save、`service/runtime/state-manager.ts` 的标志与终止段。
  - **用 `git log -L` 核对历史**：`update-orchestrator.ts` 的 `<tableEdit>` 提取在 `92c558d2` 由「最后一个完整标签对」改成 strict JSON / else 的 first-match，`711486c8` 删 strict JSON 后保留 first-match；这是 D07-01 的回归来源。
- 重点覆盖：
  - **A（删最新楼层）**：查过。D07-03 变体 1 用探针复现；D07-04 的「后续 bucket」路径复核判定不成立（fail-fast 先截断）。
  - **B（删除当前聊天）**：部分查过。D07-03 变体 2 依据 2.3「宿主复用 chat 数组」；D07-02 的旧轮标志在删聊天后新开聊天时同样适用，但触发需真机。
  - **C（不关闭聊天直接新开）**：查过。D07-02、D07-03 的主场景；D07-01 与重点无关。
- 没读或没把握：TT 宿主删除/切聊天时 `MESSAGE_*` 与 `CHAT_CHANGED` 的真实派发顺序；宿主 `saveChat()` 真实失败频率；摘要向量快照的实际 I/O 时长；完整 staging run 的宿主事件时序（未做整链探针，靠代码读穿）。
- 未改动任何已有文件；未执行 git 写操作；探针文件已全部删除（`source/tests/__probe_deepseek__/` 已清空）。

## 逐条复核

### D07-01 → 成立｜P1

- 行号核对：一致。`source/src/service/table/update-orchestrator.ts:1651` 的 first-match、`source/src/service/ai/prompt-builder/table-edit-parser.ts:55-75` 的 last-pair、`:3468-3480`、`:3511`、`:3550`、`:3701`、`:3848-3855`、`:154-158`、`state-manager.ts:522`、`TablePage.vue:91-95` 均与报告一致。
- 重走路径：
  1. `collectGroupFillResponse_ACU` 在 1647 只检查标签存在，1651 用 `/<tableEdit>([\s\S]*?)<\/tableEdit>/i` 取**第一块**；`tableEditText` 随 `GroupFillResponse_ACU` 返回（1667）。
  2. legacy 主路径（自动普通组走 `processUpdates_ACU → processUpdatesBatch_ACU → executeCardUpdateCore_ACU`）在 3468 只用 `isSqlContent(firstBlock)` 判断；首块是 SQL 时，3480 的 `isSqlTableEdit` 为真，3511 把 `collectResult.tableEditText` 赋给 `tableEditSqlText`，3550 交给 `provider.applyEditsWithSystemRowIds([tableEditSqlText], ...)`。第二块从未被读。
  3. staging/统一路径同样直接用 `response.tableEditText`（`applyUnifiedGroupFillResponsesCore_ACU` 的 1937-1959、2075-2106 段），没有重新提取 last-pair。
  4. 首块为空时：1651 得 `''`，1652 跳过隐藏列检查；legacy 3468 的 `tableEditText.trim()` 为假，3480 的 `isSqlContent('')` 为假，落到 3701 的 `parseAndApplyTableEditsToData_ACU(aiResponse, ...)`；解析器默认 last-pair 取到后面的 SQL，在 `table-edit-parser.ts:155-158` 抛普通 `Error`；`table-update-commit.ts:504-519` 归为 `infrastructure`；`executeCardUpdateCore_ACU:3848-3855` 对非 model 直接返回、不重试。
- 找过的守卫：
  - `isSqlContent` 只判断“首块是否为 SQL”，不判断“是否最后一对”；非 SQL 首块会在 3468 被拒绝（model 错误、可重试），SQL 首块则直接执行。
  - `assertNoHiddenPhysicalColumnMutations_ACU`（1656）校验的也是首块，不是最后一对。
  - `table-fill-tools.ts:114-142` 只在原生工具调用时合成**一个** `<tableEdit>`；正文路径仍可能含多块，且不会在 `prompt-api-call.ts` 里被归一化。
  - grep 全库 `<tableEdit>` 提取点：只有 `table-edit-parser.ts:61/71` 与 `update-orchestrator.ts:1651`；SQL 模式没有其它 last-pair 兜底。
- 探针：`V07-sql-first-block.test.ts`（3 例通过）。关键断言：
  ```ts
  expect(parsed?.inner).toContain('UPDATE');          // 解析器默认最后一对
  expect(response.tableEditText).toContain('DELETE'); // collect 取第一块
  expect(executed).toContain('DELETE');
  expect(executed).not.toContain('UPDATE');           // live SQL 执行器收到第一块
  expect(collected.tableEditText).toBe('');           // 空首块
  expect(result.error).toContain('SQLite SQL tableEdit must be applied through table update commit model');
  ```
  说明：探针在 `runTableUpdateCommit_ACU` 边界做了 mock，让 task 执行并返回成功；`provider.applyEditsWithSystemRowIds` 是真正的 live SQL 引擎入口，因此「第一块被执行」已坐实。provider 结果之后到落盘的链路由既有测试 `tests/service/table/update-orchestrator.test.ts:6303`（SQL 统一执行边界允许 INSERT OR REPLACE 覆盖已有行）覆盖；两段合起来即「提取 → 执行 → 持久化」。
- 补充或更正：
  - 报告「与以前复审的关系」只写了 D04 跨组线索 1；实际历史是：`92c558d2` 把旧代码的 `lastIndexOf('</tableedit>')` / `lastIndexOf('<tableedit>')`（最后一个完整标签对）改成 strict JSON / else 的 first-match，`711486c8` 删 strict JSON 后保留 first-match。也就是说，这是**回归**，不是单纯「设置没覆盖 SQL 分支」。
  - 报告说「空首块……整组失败」在 legacy 路径成立；统一路径（`applyUnifiedGroupFillResponsesCore_ACU:2262-2264`）同样会走 JSON 分支并抛同一个异常，结论不变。
  - P1 的触发前提是「模型输出两个块且首块是合法 SQL」；如果认为这属于特定模型输出，可降到 P2，但数据被静默改写的后果不变，本复核维持 P1。
- 测试情况：`table-edit-parser.test.ts` 只锁解析器 last-pair；`update-orchestrator.test.ts:1550` 只锁「非 SQL 首块被拒绝」，没有覆盖「SQL 首块被执行」或「空首块」。

### D07-02 → 需真机｜P2（原级）

- 行号核对：一致。`settings-ui-trigger.ts:143-151`（只有 auto trigger 在飞才登记 pending）、`:176-190`（`update_in_flight` 直接 return）、`update-scheduler.ts:236-238`、`state-manager.ts:646-653`、`init.ts:546-551`、`update-orchestrator.ts:4792` / `:5130-5133` / `:5774` / `:6117-6120`、`injection-engine-state.ts:147` / `:170-173` 均核对过。
- 重走路径：
  1. 手动重填在 5774 置 `_set_isAutoUpdatingCard_ACU(true)`，手动追平在 4792 置位；`CHAT_CHANGED` 只 `abortOnChatMutation_ACU()` + `clearAutoFillDebounce_ACU()`（`init.ts:546-551`），`resetScriptStateForNewChat_ACU` 只更新 chatKey/runtime，不动该标志。
  2. 旧轮在切聊天后收尾期间，B 的 `GENERATION_ENDED` → `handleNewMessageDebounced_ACU` → `triggerAutomaticUpdateIfNeeded_ACU`；`evaluateNewMessageAction_ACU` 虽接收 `isAutoUpdatingCard` 但函数体未使用它（`message-handler.ts:190-243`），所以会走到 `checkAutoUpdatePreConditions_ACU`；`isAutoUpdatingCard` 为真 → `update_in_flight` → 只记 `preconditions_failed` 并 return，没有设置 `pendingAutoUpdateTrigger_ACU`。
  3. `autoUpdateTriggerInFlight_ACU` 为 false（这是手动/追平轮，不是自动 trigger），所以不会走 143-151 的合并补跑；`_set_isAutoUpdatingCard_ACU(false)` 的“本轮结束”通知只有 `OpencodeGoUsage.vue:99` 订阅（grep `onTableFillRunEnded_ACU` 仅 3 处，无填表补跑订阅者），没有定时器/回调在标志释放后补跑。
- 找过的守卫：
  - `pendingAutoUpdateTrigger_ACU` 只服务自动 trigger 的合并（143-151），手动/追平持有标志时不会登记。
  - `CHAT_CHANGED` 不释放该标志，也没有 30s 兜底（30s 只在用户点“终止”时挂，`state-manager.ts:680-694`）。
  - 没有周期性自动填表定时器（grep `setInterval` 只命中无关的 chatId 轮询/页面时钟）。
  - 旧轮正常 abort 路径通常让窗口很短；但如果 AI 请求不响应中止（本库填表没有传输超时/空闲看门狗，D04 设计疑虑已记），窗口可被拉长。
- 探针：未做。jsdom 下无法构造「宿主在旧轮持锁期间派发 B 的 GENERATION_ENDED」；本条靠完整读穿 `settings-ui-trigger` + `state-manager` + `init` 调用链判定。代码事实（不登记 pending、无补跑订阅）已坐实；是否触发取决于宿主生成事件与旧轮收尾时序。
- 补充或更正：
  - 报告说「窗口通常只有几秒」；若旧轮是正常可中止的 AI 请求，确实如此，B 的回复通常来不及在这个窗口内结束。真正可复现的窗口是：旧轮卡在不可中止的收尾（`loadAllChatMessages`、`reloadStorageProvider`、`refreshData`、`endChatSaveCoalescing`）或 AI 请求挂死；这一点应在真机步骤里说明，否则玩家可能看不到。
  - 报告说「新聊天首条回复不会被自动填表，直到用户再发一条消息」——如果 B 开了 MVU 额外解析，`MVU_ANALYSIS_ENDED` 的 W5 重跑可能补上；没有 MVU 时才是“等下一楼”。这不改变成立方向，但影响复现。
- 需真机验证步骤（给玩家）：
  1. 在聊天 A 里选一张表点「手动填表」（或「一键追平」），确认后让进度框保持显示；如果 A 的填表几秒就结束，本条不会触发，需要让 A 的请求变慢（用很慢的模型/网络，或选范围很大的表）。
  2. 在 A 的进度框还在时，切到聊天 B（同一个角色新开聊天或另一个聊天），在 B 里发一条消息，等 AI 回复完整出现。
  3. 回复出来后看 B 的表格页：正常情况下，最新一楼应在几秒内自动填上（表格出现这一楼的新行/新字段）；有问题的表现是**这一楼一直不填**，要等你在 B 再发一条消息、下一轮回复结束才补上。
  4. 按 F12 打开控制台，搜索 `preconditions_failed` 或 `update_in_flight`：如果 B 的回复结束时出现这条日志，而且之后没有自动补跑，就坐实本条。
  5. 正常/异常判定：B 的回复结束后表格自动更新 = 正常；只有再发一条消息才补上 = 异常。若 A 的填表在 B 回复前已结束，则本次不算触发，需要重试并让 A 的请求更慢。

### D07-03 → 成立｜P2

- 行号核对：一致。`chat-service.ts:2829-2897`（`chat` 捕获、快照、候选克隆、`applyCandidateMessageFields_ACU`、strict save、catch 恢复）、`:2910-2917`（事务只传 isolation，`guardChatSwitch`）、`update-orchestrator.ts:5650-5663`（摘要向量快照后紧接清理）、`:5758-5764`（清理后复检）均核对过。
- 重走路径（探针已复现）：
  1. `clearManualRefillSheetDataInRangeCore_ACU` 在 2829 取 `getChatArray_ACU()` 的当前数组引用，2840-2843 按**下标**拍消息字段快照；2850-2869 在 `candidateChat` 克隆上清理；2874 用 `applyCandidateMessageFields_ACU(chat[idx], candidateChat[idx])` 把候选写回 live chat；2875 才 `saveChatToHostStrict_ACU()`。
  2. strict save 在途时用户删掉目标前面的一楼，数组位移；save 抛错后 2895 的 `snapshots.forEach((snapshot, idx) => restoreMessageFieldSnapshot_ACU(chat[idx], snapshot))` 仍按旧下标恢复，把旧目标楼的快照写进当前同下标的另一楼。切聊天时宿主复用同一个 `chat` 数组，则把旧聊天快照写进新聊天同下标楼层。
  3. `saveChatToHostStrict_ACU` 确实会抛：`chat-gateway.ts:307-343` 在 `saveChat` 不可用、宿主 save 拒绝、以及 pagehide 后返回时抛错；不是只返回 false。
- 找过的守卫：
  - `runTableWriteTransaction_ACU:444-450` 的 `guardChatSwitch` 只在任务入口前比较一次；`clearManualRefillSheetDataInRange_ACU` 没传 `chatKey`，所以入口比较的是“进入时”的当前聊天；save 在任务内部、比较之后发生，挡不住 save 期间的删楼/切聊天。
  - `rollbackManualRefillRangeSnapshotAtomic_ACU:2953-2962` 按身份指纹恢复，能跳过错位楼层；但这是“零提交回滚”路径，清理失败 catch 不走它，仍用 `chat[idx]`。
  - `applyCandidateMessageFields_ACU:2414-2425` 只按字段写对象，没有消息身份校验。
- 探针：`V07-refill-restore.test.ts`（2 例通过）。关键断言：
  ```ts
  await expect(clearManualRefillSheetDataInRange_ACU([1], ['sheet_0'])).rejects.toThrow('模拟宿主保存失败');
  expect(chat[1].mes).toBe('ai2');
  expect(sheet0Value(chat[1])).toBe('AI1');   // ai2 被写成 ai1 的快照
  expect(chat[1].mes).toBe('B-ai1');
  expect(sheet0Value(chat[1])).toBe('AAI1');  // B 被写成 A-ai1 的快照
  ```
  探针 mock 了 `runTableWriteTransaction_ACU` 让 task 直接执行；这不影响结论：真实事务的 `guardChatSwitch` 在 task 之前，save 失败后的恢复在 task 内部，守卫本来就看不到。
- 补充或更正：
  - 变体 2（清理前摘要向量快照 await 期间切聊天）没有做整链探针，只读代码：`:5568` 的最后复检在 `:5656` 快照之前，快照之后到 `:5660` 清理之间没有聊天/消息身份复检；如果用户在快照 await 期间切到 B，清理会按旧下标在 B 上执行。若用户留在 B，`:5759` 的复检通常会触发 `failManualRefillSession`，并用 B 自己的清理前快照回滚 B（能自愈）；只有用户在 `:5759` 之前又切回 A 时，复检通过，B 的清理不会回滚。报告已写明这个“切回 A”的条件，成立结论不依赖它，但复现难度比变体 1 高。
  - 变体 1 需要宿主保存失败（磁盘/权限/宿主 API 拒绝等），普通操作不一定触发；P2 的“特定时机”定级合适。
- 测试情况：`tests/service/chat/chat-service.test.ts:3752-3778` 锁的是 rollback 路径按身份指纹跳过错位楼层；`:3716-3750` 锁的是清理成功 + rollback 成功；没有覆盖「清理 strict save 失败 catch 按 `chat[idx]` 恢复」这条路径。

### D07-04 → 不成立

- 行号核对：报告引用的行号都存在：`settings-ui-trigger.ts:244`、`:261-267`、`update-orchestrator.ts:2893-2896`、`:2942-2945`、`:3053-3065`、`:3252`、`:3271-3275`、`:3293`、`:3310-3314`、`table-fill-target-watch.ts:30-43`。行号无漂移；问题在因果判断。
- 决定性证据：
  ```ts
  // update-orchestrator.ts:3053-3059
  if (aborted || (!bucketSucceeded && isStopped())) { aborted = true; break; }
  if (!bucketSucceeded) {
      // 连续前沿模型不允许跨过失败 bucket 继续提交，否则会制造无法自动追平的内部空洞。
      break;
  }
  ```
  ```ts
  // update-orchestrator.ts:3271-3275
  if (!preResult.success) {
      failedGroups.add(group.key);
      firstError = firstError || preResult.error || '边界前 staging 提交失败。';
      return failFastAfterSegmentError(firstError);
  }
  ```
  当前 bucket 的目标被滑动后，`collectGroupFillResponse_ACU` 本身已经返回 `success:false, aborted:true`（1472-1489/2914-2926）；即使把 controller 改成 per-bucket/per-job，bucket 循环仍会在 3057-3059 的 `!bucketSucceeded` 分支 break，`executeAutoFillStagingGroups_ACU` 仍会在 3271-3275 fail-fast，后续 bucket/segment 仍然不会执行。共用 controller 只是把 break 的原因从“bucket 失败”换成“signal aborted”，并没有造成额外的有效请求被中止。
- 重走路径：自动普通组走 `processUpdates`，各自 controller（不受影响）；staging 组走 `processStagingGroupedUpdates`。一个 staging 组内多个 bucket 是串行的；当前 bucket 的 watch 只在该 bucket 的 `collectGroupFillResponse_ACU` 期间登记（1486），它失效时该 bucket 的所有 job 目标下标相同（bucket key 含 `finalSaveTargetIndex`，2640），一起失效是正确语义。后续 bucket 从未开始，不是“被共用 controller 中止”，而是“当前 bucket 失败后被 fail-fast 禁止跨过”。报告说“后续楼层本来可以正常填”与 3057-3059 的明确设计相反。
- 找过的守卫：
  - 3053-3059 的 `!bucketSucceeded` break：与 signal 无关。
  - 3271-3275 / 3310-3314 的 `failFastAfterSegmentError`：任何 pre/post 段失败都会把所有 `normalizedGroups` 标失败。
  - 2923-2926 的 `collectFailed`：当前 bucket 的 stale 响应已经让 bucket 失败。
  - 报告引用的 `isStopped()`（3053）不是唯一出路；它只是提前把 `aborted` 置真，失败结论不变。
- 探针：`V07-shared-abort.test.ts`（1 例通过）只证明“一个 stale target 会 abort 共用 controller，另一个 target 仍有效也会读到 aborted”。这不能证明报告的跨 bucket 后果；真正的 staging run 未做整链探针（需要大量 mock），靠上述代码读穿判定。
- 补充或更正（不计入本条，仅提示）：共用 controller 的真实残余风险在**跨 staging chunk**，不是同一次 run 内的后续 bucket：`autoGroupedAbortController` 在 `settings-ui-trigger.ts:244` 创建后传给每一次 `processStagingGroupedUpdates` 调用；`update-scheduler.ts:422-426` 在每个 chunk 失败后仍继续下一个 chunk；下一个 chunk 进入 `executeAutoFillStagingGroups_ACU:3252` 时读到已 aborted 的 controller，会直接返回 `abortedResult()`，即使它的目标仍然有效。这个路径需要同一自动 trigger 内存在多个 `requiresBoundaryStaging` 组，且前一个组的目标被滑动/删除；报告没有区分“同 run 后续 bucket”与“后续 chunk”，建议另开条目或并入 D02/D04。若协调者认为该残余仍然算 D07-04，则应按“降级成立 P2/P3 + 更正触发路径”处理；本复核按报告原文的“同 run 后续 bucket”判不成立。

### D07-05 → 成立｜P3

- 行号核对：一致。`presentation/triggers/update-process.ts:360` 的确认文案；`presentation/bootstrap/api-groups/settings-config-api.ts:132-139` 的 `AutoCardUpdaterAPI.manualUpdate` 仍转调 `handleManualUpdate_ACU`；`update-orchestrator.ts:5267-5270` 的 `rollbackRefillCleanupOnZeroCommit` 只在 `committedBucketCount <= 0` 时回滚；`useManualUpdate.ts:510` 的 V2 文案已准确。
- 重走路径：第三方脚本/控制台调用 `AutoCardUpdaterAPI.manualUpdate()` → `handleManualUpdate_ACU()` 弹确认框（360）→ 用户点“确认并继续” → `orchestrateManualUpdate_ACU(..., { clearBeforeUpdate: true })`；中途失败/终止时若之前提交过至少一个 bucket（含只落进度的伪提交），`rollbackRefillCleanupOnZeroCommit` 直接返回，不复原已清理的旧数据。确认框承诺的“执行失败或终止时会回滚”不成立。
- 找过的守卫：
  - 主 UI 的 V2 手动填表走 `useManualUpdate.ts`，文案是准确的；`handleManualUpdate_ACU` 只经公开 API 到达（grep `handleManualUpdate_ACU` 仅 API 与测试），不是主按钮。
  - `api-registry.ts:76` 把 `AutoCardUpdaterAPI` 挂到顶层 window，第三方脚本/控制台可达；不是死代码。
  - `rollbackManualRefillRangeSnapshotAtomic_ACU` 的身份校验只保证“不写错楼层”，不改变“已提交就不回滚”的语义。
- 探针：未做（P3 文案，读代码足够）。现有 `tests/presentation/triggers/update-process.test.ts:76-91` 只断言确认框出现、删除范围、不可恢复风险、范围外不删除；没有断言最后一句“执行失败或终止时会回滚”。
- 补充或更正：报告说“中途失败或被终止，且此前已提交过至少一个 bucket（含只落进度、未写数据的伪提交）”；伪提交计入 `committedBucketCount` 的代码在 `update-orchestrator.ts:3013-3025` / `4792` 一带，描述准确。P3 是文案分叉，不是数据缺陷。
- 与以前复审的关系：新问题；D03 跨组线索 5 已提到同一文案，但未作为发现条目。

## 跨组线索

1. **D07-01 的根因在 `service/table/update-orchestrator.ts:1651`（D02 文件）**：SQL 提取没有走 `extractTableEditInner_ACU`；`92c558d2` 的回归把 last-pair 改成 first-match。建议 D02/D04 一起修。
2. **D07-02 的根因在 `presentation/triggers/settings-ui-sync/settings-ui-trigger.ts:176-190` + `service/runtime/state-manager.ts:646-653`（D01/D02 文件）**：全局填表标志没有聊天归属，自动入口对 `update_in_flight` 不登记补跑。
3. **D07-03 的根因在 `service/chat/chat-service.ts:2874/2895`（D03 文件）**：清理 apply 与失败恢复按 `chat[idx]`，建议和 D03-01 的“零提交回滚按当前聊天”一起改成消息身份契约。
4. **D07-04 的真实残余在 `settings-ui-trigger.ts:244/267` + `update-scheduler.ts:422-426`（D02/D01 文件）**：共享 controller 跨 staging chunk 复用，前一个 chunk 的 stale abort 会让后续独立 chunk 的 `executeAutoFillStagingGroups_ACU:3252` 直接 aborted；与报告写的同 run 后续 bucket 不是同一条路径。
5. **D07-05 的入口在 `presentation/bootstrap/api-groups/settings-config-api.ts:132-139`（G12/D03 文件）**：legacy `manualUpdate` 仍可达，文案需与 V2 `useManualUpdate.ts:510` 对齐。

## 设计层面的疑虑（不计入缺陷）

1. **全局 `isAutoUpdatingCard_ACU` 没有聊天/轮次归属**：第二轮 G03 已登记 30s 强制释放的归属问题；D07-02 是它在跨聊天时“丢触发且无补跑”的新后果。即使把 D07-02 的入口补跑修好，建议仍把“一轮填表”做成带 runId/chatKey 的对象，释放时只清自己的。
2. **staging 的 fail-fast 与“只中止失效目标”的语义边界**：D07-04 报告想说的是“后续有效 bucket 不该被 abort”，但代码的 3057-3059 明确禁止跨过失败 bucket 继续提交，以避免内部空洞。两者是设计冲突：要真正让后续 bucket 继续，必须同时改 fail-fast 和数据一致性策略，不能只换 controller。建议在文档里写清“目标失效 = 本次 staging run 失败，下一轮重填”，避免复审再次把它当缺陷。
3. **手动重填清理的回滚句柄只在内存**：D07-03 的失败恢复写错楼层之外，清理本身已经是 strict 落盘；如果编排器在清理后被杀/切聊天，回滚 handle 丢失，旧数据只能靠备份。这是既有设计取舍（D03 设计疑虑），不是本轮新问题。
4. **填表请求无传输超时/空闲看门狗**：D04 设计疑虑已记；它会把 D07-02 的“几秒窗口”拉长到无限，建议和 D07-02 的补跑一起考虑。

## 查过但判定没问题的场景

1. **D07-04 同一次 staging run 内后续 bucket 会不会被共用 controller 额外误伤？** 不会。当前 bucket 的 stale 响应已经让 `collectFailed`（2923-2926）成立；即使 controller 不共用，3057-3059 的 `!bucketSucceeded` 也会 break，3271-3275 仍 fail-fast。共用 controller 只改变 break 的原因，不改变结果。
2. **D07-01 的原生工具路径会不会也取错块？** 不会。`table-fill-tools.ts:114-142` 在有工具调用时会把 residual 正文块剔除并合成一个 `<tableEdit>`，只有正文多块路径受影响；工具路径不受 D07-01 影响。
3. **D07-03 清理循环内的 `deleteVectorIndexManifestFromTagData_ACU` 是否会给用户删楼留出宏任务窗口？** 不会。`deleteExternal:false` 时只有同步赋值（`chat-service.ts:184-202`），`await` 只产生微任务；用户删楼是宏任务，插不进循环。真正的异步窗口是循环后的 `saveChatToHostStrict_ACU`（2875）和循环前的摘要向量快照（`update-orchestrator.ts:5656`）。
4. **D07-03 的 `guardChatSwitch` 能不能挡住 save 期间的切聊天？** 不能。`table-write-transaction.ts:444-450` 只在 task 入口前比较；save 在 task 内部，比较已经完成。清理函数也没有传期望 chatKey。
5. **D07-05 的主 UI 是否也会看到错误文案？** 不会。V2 `useManualUpdate.ts:510` 已改成准确表述；只有 legacy `AutoCardUpdaterAPI.manualUpdate` 路径用 360 的旧文案。
6. **D07-02 的自动填表在“旧轮是自动填表”时会不会也丢？** 不会。自动轮在飞时，第二次自动 trigger 会走 143-151 的 `pendingAutoUpdateTrigger` 合并；旧轮 finally（306-319）在 scope 匹配时补跑。D07-02 只针对手动/追平持有全局标志的窗口。
7. **D07-01 的 first-block 是否被 `assertNoHiddenPhysicalColumnMutations_ACU` 拦住？** 不会。它校验的是第一块的隐藏列，不是“最后一对”；第一块若是合法 DML，仍会通过。
8. **D07-04 的普通组是否受共用 controller 影响？** 不会。普通组走 `processUpdates`，各自新建 controller（`update-process.ts` 的 `proceedWithCardUpdate_ACU` 一带）；共用 controller 只在 staging 路径。

## 探针清理确认

- `source/tests/__probe_deepseek__/V07-refill-restore.test.ts` 已删除。
- `source/tests/__probe_deepseek__/V07-sql-first-block.test.ts` 已删除。
- `source/tests/__probe_deepseek__/V07-shared-abort.test.ts` 已删除。
- 未改动任何已有文件；未执行 git 写操作；未跑任何已有测试文件。
