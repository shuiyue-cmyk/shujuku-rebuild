# D05 复核

## 概览

- 原报告：P0 0 / P1 5 / P2 1 / P3 2。
- 复核后：成立 5，降级成立 0，不成立 0，需真机 3。
  - 成立：D05-04（P1）、D05-05（P1）、D05-06（P2）、D05-07（P3）、D05-08（P3）。
  - 需真机：D05-01、D05-02、D05-03（D05-02/03 的代码机制已用探针复现；D05-01 只完成代码链核对。三条结论都卡在宿主删除/切聊的过渡态）。
- 跑过的探针（均已删除）：
  1. `V05-checkpoint-vault.test.ts`：2 例通过。复现「窗口内写入 full checkpoint 后删楼，保管库无产物 → 恢复失败」及对照。
  2. `V05-commit-cross-chat.test.ts`：3 例通过。用**真实** `runTableUpdateCommit_ACU` + 真实 `persistTablesToChatMessage_ACU` / `persistTableMutationLogV2_ACU`，证明缺省 `chatKey` 时提交会落到新聊天；显式 `chatKey` 会被拒；strict 存盘期间切聊后仍写回旧运行时。
  3. `V05-coalescer-empty.test.ts`：3 例通过。复现「旧 id + 空数组」补存写空文件、`getCurrentChatId` 空串被当 `null`、`this_chid` 回退三种归属误判。
- 行号核对：报告引用的行号全部与 HEAD 02f7d5dc 一致；仅 D05-05 需要补充 `table-update-commit.ts:313` 的提前 return 分支（见该条「补充或更正」）。

## 逐条复核

### D05-01 → 需真机

- 行号核对：一致。
  - `source/src/presentation/bootstrap/init.ts:823-843`：`CHAT_DELETED` / `GROUP_CHAT_DELETED` 只注册 5s 后的向量清理。
  - `source/src/presentation/bootstrap/init.ts:544-546`：`abortOnChatMutation_ACU()` 只在 `CHAT_CHANGED` 处理体里调用。
  - `source/src/service/runtime/state-manager.ts:624-640`：注释与实现都写明这是 `CHAT_CHANGED` 专用整体中止。
  - `source/src/data/gateways/chat-gateway.ts:145-160`：两个普通存盘入口直接调用宿主 `saveChat`，没有「聊天已被删除」墓碑。
  - `source/src/service/table/storage-frame-v2-persist.ts:2789-2795、2816-2821`：只复核数组引用、宿主聊天身份和目标楼对象，删除整聊天不在复核范围。
- 重走路径：
  - 顺序一：宿主先 `CHAT_DELETED`，文件已删、`chat` 数组尚未换、`currentChatFileIdentifier_ACU` 仍是旧聊天，随后才 `CHAT_CHANGED`。这段窗口内插件没有中止，填表请求/提交可以继续；coalesced 或 strict 存盘调用宿主 `saveChat()`，宿主以「当前聊天文件名」整份写盘，刚删的文件可能被重建。
  - 顺序二：宿主先 `CHAT_CHANGED`（或删文件后立刻同步换聊天），`abortOnChatMutation_ACU` 先中止请求，随后提交层的 `chatKey` 复核也会拒绝；此时不成立。
  - 还需要第三种宿主行为：只发 `CHAT_DELETED`、过一段时间才打开别的聊天。这种情况下窗口更长，风险最大。
- 找过的守卫：
  - `abortOnChatMutation_ACU` / `abortAllActiveRequests_ACU`：只在 `CHAT_CHANGED` 调用，删聊天不触发。
  - `cancelPendingAutoTasks_ACU`：只在 `MESSAGE_DELETED` / `MESSAGE_SWIPED` 的聊天变更回调里调用；`CHAT_DELETED` 处理器没有接。
  - `abortTableFillRequestsWithStaleTarget_ACU`：只处理目标楼层失效，不处理整聊天删除。
  - `chat-gateway` 的 strict/coalesced/raw 存盘入口均无「目标聊天仍存在」检查。
  - `persist` 的 2789 身份复核只看数组引用与 `getActiveChatStorageIdentity_ACU`；删除聊天且宿主尚未更新上下文时两者都可能仍是旧值。
- 探针：本条没有写探针。原因：结论取决于宿主在删除文件、清空数组、换聊天 id、派发事件之间的真实顺序；jsdom 里只能自定义顺序，证明不了 TT 2.4.0 的顺序。代码事实（`CHAT_DELETED` 不中止、不设墓碑）已完整读穿。
- 补充或更正：报告引用的 ST `public/script.js` 的 `delChat → replaceCurrentChat` 顺序不在本仓库内，我无法核对，只能当作外部假设。若 TT 的删除流程先发 `CHAT_CHANGED`，本条不成立；若先删文件且保留旧 id/旧数组，则成立。
- 真机验证步骤（玩家可照做）：
  1. 选一个有多条 AI 回复的聊天，点一次「重新填表」或等自动填表，确认界面出现「正在填表」。
  2. 填表还没结束时，打开左侧聊天管理，删除当前这个聊天。等 10 秒，再打开同一角色卡。
  3. 正常：被删聊天不在列表里；回到角色卡看到的是新聊天或空聊天，旧表格数据没有回来。
  4. 有问题：聊天列表里又出现同名聊天，或点进去还能看到删除前最后几楼的表格数据；按 F12 打开控制台，搜 `ChatGateway`、`删楼守卫`、`saveChat`，若看到删除后仍有保存/补存日志，记录时间点。
- 测试：`tests/presentation/bootstrap/init.test.ts` 只验证 `chatDeletedHandler` 被注册；没有任何「删除聊天 + 在途填表 + 存盘」的集成测试。

### D05-02 → 需真机

- 行号核对：一致。
  - `source/src/data/gateways/chat-gateway.ts:89-98`：`currentChatSaveKey_ACU` 只读 `getCurrentChatId()` / `chatId` / `this_chid`。
  - `source/src/data/gateways/chat-gateway.ts:120-127`：`keepChatSaveDirtyIfSameChat_ACU`，id 为 `null` 或相同都算同一聊天。
  - `source/src/data/gateways/chat-gateway.ts:177-188`：120s 兜底定时器。
  - `source/src/data/gateways/chat-gateway.ts:212-223`：窗口内只记脏、立即返回。
  - `source/src/data/gateways/chat-gateway.ts:229-244`：`forceFlushChatSave_ACU`。
  - `source/src/data/gateways/chat-gateway.ts:255-259`：页面隐藏补存。
- 重走路径：
  - 填表窗口内有脏改动（正常，coalesced 只记脏）。
  - 宿主删除当前聊天。若宿主先 `clearChat({clearData:true})` 清空 `chat` 数组，再 `await fetch('/api/characters/chats')`，最后才设置新聊天名/id，则存在「旧聊天 id + 空数组」窗口。
  - 此间任一冲洗点（120s 定时器、`pagehide`/`visibilitychange`、本轮 `endChatSaveCoalescing_ACU`）会调用 `forceFlushChatSave_ACU`；`keepChatSaveDirtyIfSameChat_ACU` 看到 id 未变（或为 `null`）返回 true，随后宿主 `saveChat()` 以旧文件名写空数组，删除的聊天文件被重建为空聊天。
  - 若宿主先换 id 再清数组，`keep...` 会作废旧脏，本条不成立。
- 找过的守卫：
  - `keepChatSaveDirtyIfSameChat_ACU` 只比较 id；没有 `chat[0]` 消息对象快照，也没有检查数组是否为空/是否已换。
  - `runTrackedFullChatSave_ACU` 的 `sameChat` 在 save 前计算，同样只看 id。
  - `saveChatToHostRaw_ACU` / `saveChatToHostStrict_ACU` 都不检查「聊天是否已被删除」。
  - `CHAT_DELETED` 没有清脏或设墓碑。
- 探针：`V05-coalescer-empty.test.ts` 第 1 例，模拟「窗口内有脏 → 宿主清空 chat 数组、id 仍 chat-a → forceFlush」。结果为真：
  ```ts
  expect(mocks.host.files.has('chat-a')).toBe(true);
  expect(JSON.parse(mocks.host.files.get('chat-a')!)).toEqual([]);
  ```
  这证明代码在「旧 id + 空数组」下必然写空文件；仍缺宿主是否真会进入该窗口。
- 补充或更正：报告说「宿主先删文件、清空数组、再换 id」是 ST release 的流程；仓库无宿主源码，不能当既定事实。另：`key === null` 时 `keepChatSaveDirtyIfSameChat_ACU` 也返回 true，所以即使宿主的 id 在过渡态变成空值/`null`，同样会保存，不只是「id 相同」。
- 真机验证步骤：
  1. 打开一个聊天，触发自动填表/手动填表，确认「正在填表」。
  2. 填表进行中，在聊天管理里删除当前聊天。删除对话框确认后，立刻（不要等填表结束）观察聊天列表。
  3. 正常：被删聊天彻底消失；随后打开的新聊天没有旧表格，也没有空白的同名聊天。
  4. 有问题：列表里重新出现同名聊天，点进去是 0 条消息/只有文件头；或随后打开的另一聊天消息变少/变空。按 F12，在控制台搜 `存盘合并`、`补存`、`ChatGateway`，看删除后是否还有「补存」日志。
- 测试：`tests/data/gateways/chat-save-coalescer.test.ts:224-234` 只覆盖「切到另一个 chat id」；`tests/data/gateways/chat-save-coalescer.test.ts:236-246` 只覆盖页面隐藏；没有覆盖「id 不变、数组先清空」的删除过渡态。

### D05-03 → 需真机

- 行号核对：一致。
  - `source/src/data/gateways/chat-gateway.ts:89-98`：`getCurrentChatId()` 不可用时回退 `api.chatId`，再回退 `api.this_chid`。
  - `source/src/data/gateways/chat-gateway.ts:120-127`：id 相同/为 `null` 即同一聊天。
  - `source/src/data/gateways/chat-gateway.ts:177-188、229-244、255-259`：补存触发点同上。
- 重走路径：
  - `openCharacterChat(B)` 先 `await clearChat({clearData:true})` 清空数组，再设置 `characters[this_chid].chat = B`，再 `await getChat()` 拉楼层；在拉取完成前，存在「B 的文件名已生效、数组为空」窗口。
  - 若此间 `getCurrentChatId()` 返回空串（不是 `undefined`），`viaGetter ?? api.chatId` 不会回退到 `chatId`，`String(key)===''` 使 key 变成 `null`；`keepChatSaveDirtyIfSameChat_ACU` 对 `null` 返回 true，补存仍会执行，宿主以 B 的文件名写空数组，B 的原有楼层被清空。
  - 若 `getCurrentChatId` 整个缺失、但 `api.chatId` 存在，则代码用 `chatId`，能识别切换；只有 `getCurrentChatId` 和 `chatId` **同时**缺失，才会退到 `this_chid`。同一角色的 A/B 两个聊天 `this_chid` 相同，于是误判同一聊天。
- 找过的守卫：
  - 合并补存只认 `currentChatSaveKey_ACU`；`chat-history.ts:64-71` 的 `getActiveChatStorageIdentity_ACU` 只用于持久化身份，不参与合并补存。
  - `keepChatSaveDirtyIfSameChat_ACU` 没有首楼对象/数组内容证据。
  - `markChatSaveDirty_ACU` 的切换作废同样只比较 id，id 为 `null` 时不清。
- 探针：`V05-coalescer-empty.test.ts` 第 2、3 例：
  - 第 2 例：`getCurrentChatId()` 返回 `''`、`chatId='chat-b'`、保存文件名已切 B、数组为空；`forceFlush` 后 `expect(mocks.host.files.get('chat-b')).toBe('[]')`。
  - 第 3 例：`getCurrentChatId`/`chatId` 都读不到、`this_chid=3`、切到同角色 B；同样把 B 写成 `[]`。
  两例均通过。证明代码路径；缺的是 TT 2.4.0 在真实过渡态是否返回空串/是否两者都缺。
- 补充或更正：报告把前提写成「TT 不暴露 `getCurrentChatId`」；实际还有更宽的空串路径（`??` 不会跳过空串）。但 `this_chid` 回退比报告写的更苛刻：必须 `getCurrentChatId` 与 `chatId` 同时缺失；`@types/iframe/exported.sillytavern.d.ts:392-393` 声明了 `chatId` 和 `getCurrentChatId`，所以「回退 `this_chid`」在正常 TT 上大概率不成立。级别取决于真机：若只是空串窗口，P1；若两者都缺且同角色多聊天，才接近 P0。
- 真机验证步骤：
  1. 同一角色准备两个已有聊天 A、B，B 里有多条消息。打开 A，触发填表。
  2. 填表进行中按 F12，在控制台依次输入 `SillyTavern.getContext().getCurrentChatId` 和 `SillyTavern.getContext().chatId`，回车看返回值；记下是否为 `undefined`/空串。
  3. 立刻切到同角色的 B（不要等填表结束）。等 5 秒，检查 B 的消息列表。
  4. 正常：B 的楼层数量不变，表格数据正常。
  5. 有问题：B 变空/少楼；控制台搜 `存盘合并`，若出现「补存」且 B 被写成 `[]`，即为本条。若第 2 步两个值都正常，则 `this_chid` 回退路径不成立，只需观察空串窗口。
- 测试：`tests/data/gateways/chat-save-coalescer.test.ts:8-12` 把 `currentChatId` 置 `null` 只是测试夹具注释，不是 TT 不暴露 id 的证据；该文件没有覆盖「同一角色两个聊天」和「空数组窗口」。

### D05-04 → 成立｜P1

- 行号核对：一致。
  - `source/src/data/gateways/chat-gateway.ts:145-148`：只有真存盘后才 `notifyPostChatSaveListeners_ACU`。
  - `source/src/data/gateways/chat-gateway.ts:212-223`：填表批在窗口内只记脏、不触发 post-save。
  - `source/src/service/chat/checkpoint-delete-guard.ts:279-285`：保管库只在 post-save 监听里重新捕获。
  - `source/src/service/chat/checkpoint-delete-guard.ts:399-416`：恢复只遍历保管库已有条目，`!entryHasArtifacts_ACU(entry)` 直接跳过。
  - `source/src/service/chat/checkpoint-delete-guard.ts:20-24`：注释写「生成 / 填表落盘耗时远大于该窗口，实际不可达」。
  - `source/src/service/table/storage-frame-v2-persist.ts:2433-2440`：首次填表写 full checkpoint。
  - `source/src/service/table/storage-frame-v2-persist.ts:2816-2821`：非 strict 的普通填表批走 coalesced。
- 重走路径：
  1. 一个聊天第一次填表（或某个批在目标楼层新建 full checkpoint），`beginChatSaveCoalescing_ACU()` 已开窗。
  2. 批次提交把 full checkpoint 写进目标楼层的**内存帧**；`saveChatToHostCoalesced_ACU` 只记脏，不真存盘，因此没有 post-save 捕获。
  3. 用户在整轮结束前删掉承载该 checkpoint 的楼层。`MESSAGE_DELETED` 的 `noteMessagesPresentAtDeletion_ACU` 只登记幸存楼层，不读取/补捕获被删楼层的产物；1.2s 后 `recoverLostCheckpointsAfterMessageDeletion_ACU` 遍历的 vault 仍是上一次真存盘时的快照，其中没有这份新 checkpoint（或只有旧产物）。
  4. 恢复返回 `recovered:false`；本轮 finally 的 `endChatSaveCoalescing_ACU` 把「没有该楼层」的聊天写盘。若同批的较早 AI 楼层幸存，它的数据只在这份被删 checkpoint 里（batch size 默认 2、一次提交写到 `finalSaveTargetIndex`），刷新后就没有回放根，形成半截数据。
- 找过的守卫：
  - `noteMessagesPresentAtDeletion_ACU` 只把当前 `chat` 里还存在的消息加入 `knownMessages`，不克隆产物。
  - `captureCheckpointVaultForCurrentChat_ACU` 的调用点只有：启动/`CHAT_CHANGED` 延迟链、post-save、恢复成功后；删楼不触发 `CHAT_CHANGED`，coalesced 不触发 post-save。
  - `persistTableMutationLogV2Core_ACU` 的 strict 分支只在 `strictSave || replacement || temporaryBaselineUpgrade || provisionalConvergenceReplay`；普通填表批都不满足，走 2820 的 coalesced。
  - `MESSAGE_DELETED` 的 `abortTableFillRequestsWithStaleTarget_ACU` 只中止在途请求；已经提交到内存的 checkpoint 不会撤回，也不会补捕获。
- 探针：`V05-checkpoint-vault.test.ts`，2 例通过。
  - 场景 1：先捕获（目标楼只有 log-only 帧），再在内存帧写入 full checkpoint，然后删楼；结果：
    ```ts
    expect(result.recovered).toBe(false);
    expect(ai1.TavernDB_ACU_IsolatedData).toBeUndefined();
    ```
  - 对照：删楼前再捕获一次（模拟批次真存盘的 post-save），恢复成功：
    ```ts
    expect(result.recovered).toBe(true);
    expect(ai1.TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint?.data).toEqual(checkpointData);
    ```
  这直接验证了「捕获时机被合并窗口推迟 → 删除承载新 checkpoint 的楼层后恢复失败」。生产端是否进入该时序由 `update-orchestrator.ts:3973` 的 `beginChatSaveCoalescing_ACU()` / `:4103` 的 `endChatSaveCoalescing_ACU()` 与普通填表批的非 strict 分支保证，已读穿。
- 测试：`tests/service/chat/checkpoint-delete-guard.test.ts` 只测「捕获后再删楼」的理想时序，以及「保管库过期后宿主追加的楼可作落点」；没有测「捕获之后、下一次保存之前写入的新 checkpoint」。`tests/data/gateways/chat-save-coalescer.test.ts` 只测存盘次数/归属，不涉及保管库。
- 修法方向：写 full checkpoint（以及 per-sheet / 过渡根）的批次不得延迟存盘，强制 strict；或把保管库捕获挂到「表格提交成功」而不是「宿主保存成功」，在提交后、用户删楼前把变化楼层的产物克隆进 vault。
- 与以前复审的关系：新问题。26e453e6 的存盘合并把删楼守卫 S0-4 注释里的「实际不可达」前提破坏；这不是 2.7 的「窗口内未补存批次可重填」取舍，因为收尾补存会把缺少回放根的幸存楼层写盘，留下半截数据。

### D05-05 → 成立｜P1

- 行号核对：一致，另补充 `table-update-commit.ts:313`。
  - `source/src/service/table/table-update-commit.ts:302-324`：`assertExpectedCommitScope_ACU`。
  - `:334、:395、:397、:413、:444`：五个阶段的复核调用。
  - `source/src/presentation-v2/composables/useSqlConsole.ts:197-212`：SQL 控制台不传 `chatKey`。
  - `source/src/presentation/bootstrap/api-groups/sql-api.ts:558-574`、`table-crud-api.ts:613-634`：外部 SQL/CRUD 不传 `chatKey`。
  - `source/src/service/chat/chat-service.ts:2297-2315`：模板覆盖不传 `chatKey`。
  - `source/src/service/table/update-orchestrator.ts:4736-4755`：追平终态不传 `chatKey`。
  - `source/src/service/table/runtime-only-pending-flush.ts:174-193`：runtime-only 写回不传 `chatKey`。
- 重走路径（用真实持久化验证）：
  1. 调用方只传 `isolationKey`（上述调用方大多如此），不传 `chatKey`。
  2. `runTableUpdateCommit_ACU` 入口、迁移后、未落盘写回后、应用前、持久化前，`expectedChatKey` 每次都取「当时的 `currentChatFileIdentifier_ACU`」当期望值；切换前后永远相等。
  3. 在 `ensureLegacyStorageMigratedBeforeWrite_ACU` 的 await 期间切到聊天 B（TT 复用同一 `chat` 数组）。事务的 `chatKey` 在切换后取到 B；`persistTablesToChatMessage_ACU` 在 `table-service.ts:168` 再取 `getChatArray_ACU()`，也是 B；目标索引沿用旧请求的 `targetMessageIndex`，于是把旧聊天的 `tableData`/operations 写进 B 的同序号 AI 楼层。
  4. 对 `targetMessageIndex=-1` 的 SQL/CRUD，则写到 B 的最新 AI 楼层；SQL 控制台随后还会在 `useSqlConsole.ts:212-218` 给出「这条 SQL 已在原聊天提交」的反向文案（实际落在新聊天）。
- 找过的守卫：
  - `table-update-commit.ts:313`：`if (options.chatKey === undefined && options.isolationKey === undefined) return;`。两个都缺时连比较都不做；上述调用方都传了 `isolationKey`，所以走到后面的「期望值=当前值」恒真式。
  - `persistTableMutationLogV2Core_ACU` 的 2790/3143 复核：`getActiveChatStorageIdentity_ACU(chat)` 在 persist 开始时才取当前身份；切换发生在它之前时，准备身份就是 B，前后一致，发现不了。
  - `getChatArray_ACU() !== chat`：TT 复用同一个数组对象，引用相等，也发现不了。
  - `ensureNoActiveProvisionalBridgeForCurrentScope_ACU`、`runTableWriteTransaction_ACU` 的锁都按「切换后」的 B 取键，不会拒绝。
- 探针：`V05-commit-cross-chat.test.ts`，3 例通过；其中第 1 例使用真实 `runTableUpdateCommit_ACU` + 真实 `persistTablesToChatMessage_ACU` + 真实 `persistTableMutationLogV2_ACU`，只 mock 了迁移 await 点：
  ```ts
  expect(result.success).toBe(true);
  expect(mocks.chat[1].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint?.data?.sheet_0?.content)
    .toEqual(tableData.sheet_0.content);
  expect(aiA.TavernDB_ACU_IsolatedData?.['']?.storageFrame?.checkpoint).toBeUndefined();
  ```
  第 2 例显式传 `chatKey:'chat-a'`：
  ```ts
  expect(result.errorCategory).toBe('precondition');
  expect(mocks.saveChatStrict).not.toHaveBeenCalled();
  ```
  即：缺省 `chatKey` 时真实落盘到 B；显式传时才被拒。这已经超过「守卫恒通过」的层面，是实际跨聊写入。
- 补充或更正：报告引用的 `table-update-commit.ts:314-318` 是「传了 `isolationKey` 时的恒真式」；若 `chatKey` 和 `isolationKey` 都不传，313 行直接 return，更弱。修法建议在函数入口冻结 `entryChatKey = options.chatKey ?? currentChatFileIdentifier_ACU` 与 `entryIsolationKey`，所有阶段与冻结值比较；同时把宿主实时身份（`getCurrentChatId()` / `getActiveChatStorageIdentity_ACU` + 首楼对象）纳入复核；runtime-only flush 把 `scope.chatKey` 传进提交层。
- 测试：`tests/service/table/table-update-commit.test.ts:115-139` 的切聊用例显式传了 `chatKey:'chat-a'`，只覆盖「已传 chatKey」分支；没有任何 `chatKey` 缺省 + 迁移/回放期间切换的用例。
- 与以前复审的关系：R9-10 / G04 系列只修了已传 `chatKey` 和 persist 内部复核；这是同一守卫在缺省参数与事件滞后上的残留缺口。G04-01 修复不完整。

### D05-06 → 成立｜P2

- 行号核对：一致。
  - `source/src/service/table/table-update-commit.ts:444`：持久化前最后一次 `assertExpectedCommitScope_ACU`。
  - `:446-466`：调用 `persistTablesToChatMessage_ACU`。
  - `:480-481`：persist 成功后无条件 `requiresRuntimeReload = false; _set_currentJsonTableData_ACU(cloneTableData_ACU(applied.tableData));`。
- 重走路径：
  - `strictSave`（模板覆盖、追平终态、导入、手动重填等）在 `storage-frame-v2-persist.ts:2816-2817` 直接 `await saveChatToHostStrict_ACU()`；大聊天一次整份存盘可达数秒。
  - 存盘 await 期间切到聊天 B。`persist` 在写帧前（2790）已复核过；存盘成功后没有再次复核。提交层回到 480-481 时，把旧聊天的 `applied.tableData` 写进全局 `currentJsonTableData_ACU`。
  - `CHAT_CHANGED` 的 1.2s 延迟重建如果在这次写回之前完成，旧数据会覆盖 B 的运行时视图；直到下一次全量刷新才恢复。若重建在写回之后完成，则会被盖回 B，问题窗口较短。
- 找过的守卫：
  - 444 的复核在 persist 之前；`storage-frame-v2-persist.ts:2790` 的复核也在 strict 存盘 await 之前。
  - 480-481 没有任何 `assertExpectedCommitScope_ACU`，也没有比较 `getChatArray_ACU()` 是否仍是 persist 时的数组。
  - `runCommit` 的 `assertFresh` 是运行时 revision 校验，不是聊天身份校验，且同一数组复用时引用不变。
- 探针：`V05-commit-cross-chat.test.ts` 第 3 例，真实 persist + strict 存盘桩在 resolve 前切到 B：
  ```ts
  expect(result.success).toBe(true);
  expect(mocks.saveChatStrict).toHaveBeenCalledTimes(1);
  expect(mocks.setCurrentData).toHaveBeenCalledTimes(1);
  expect(mocks.setCurrentData.mock.calls[0][0]).toMatchObject({
    sheet_0: { content: tableData.sheet_0.content },
  });
  ```
  结果通过：提交成功，且在聊天已切到 B 后仍把旧 A 的表快照写进运行时。
- 测试：`tests/service/table/table-update-commit.test.ts` 的切换用例都发生在迁移阶段（persist 之前）；`tests/service/table/storage-frame-v2-persist.test.ts` 的「保存回放期间切换聊天」只断言不写旧帧、不存盘，没有覆盖「提交层在 persist 成功后写运行时」。
- 修法方向：persist 成功后（尤其 strict 分支）再调用一次 `assertExpectedCommitScope_ACU`；不一致时跳过 `_set_currentJsonTableData_ACU`，必要时触发当前聊天重建。P2 是因为它污染的是运行时视图，最终可能被延迟重建覆盖；若用户在覆盖前继续编辑，存在放大为错写新聊天表数据的风险，修法仍应按 P1 级防护做。

### D05-07 → 成立｜P3

- 行号核对：一致。
  - `source/src/service/table/storage-frame-v2-replay.ts:60-109`：`buildInflightReplayKey_ACU` 只含数组 WeakMap 令牌、isolationKey、maxMessageIndex、模板结构指纹和选项。
  - `source/src/service/table/storage-frame-v2-replay.ts:2963-3000`：同 key 的第二个调用方直接 `await existing` 并拿启动方结果。
  - `source/src/service/table/storage-frame-v2-replay.ts:63-68`：注释承认 `String(chat)` 的等长碰撞，并称 WeakMap「跨数组共享被禁」。
- 重走路径：
  - TT 切聊天复用同一个 `chat` 数组对象（2.3 宿主事实），`chatIdentityToken_ACU(chat)` 不变；`maxMessageIndex` 同为 latest、模板结构指纹相同、compat/alias 选项相同，两次只读回放 key 相同。
  - 只读回放要跨用户切聊存活，必须在中途真正让出事件循环。`yieldBudgetMs`/`signal` 已被 93-94 行排除；但 `sheet_schema_migrate` operation 的 `sha256_ACU`（`table-schema-migration.ts:427-428`）会 `await crypto.subtle.digest`，这是可让出的异步点。此时 A 的回放未 settle，切到 B 后的冷回放若在 digest 完成前发起，会命中同一个 in-flight key，拿到 A 的 `data/baseKind`。
  - 普通无 schema 迁移的回放基本同步完成，窗口极小；所以只标 P3。
- 找过的守卫：
  - `evidence` 复用路径有 `headRevisionDigest`，内容变化会失效；in-flight 快路径没有内容摘要。
  - `structureMappingDigest` 是模板结构指纹，与两个聊天的表格数据无关。
  - `updateRuntimeState:true`、`yieldBudgetMs`、`signal`、`captureBoundaries`、`onEntryApplied` 都退出去重，确实缩小了窗口；但没有覆盖「同一数组、内容换成另一个聊天、schema 迁移 digest 让出」这一形态。
- 测试：`tests/service/table/` 下的 evidence/in-flight 测试只覆盖「同一聊天内容原地变化」与「不同数组」；没有覆盖「同一数组对象、内容换成另一个聊天」。
- 补充或更正：注释原文并没有直接承诺「同数组跨聊天隔离」；它说的是「跨数组共享被禁」。真正的缺陷是：TT 恰好复用同一个数组，WeakMap 只解决了不同数组的碰撞，而注释把这一保护写成了对 TT 也足够的结论。修法：in-flight key 加入 `computeReplayHeadRevisionDigest_ACU(chat, isolationKey)` 或 `currentChatFileIdentifier_ACU + chat[0]` 对象引用；取不到身份时退出去重（fail-open）。

### D05-08 → 成立｜P3

- 行号核对：一致。
  - `source/src/service/table/runtime-only-pending-state.ts:44-51`：模块级 `pendingByScope_ACU`。
  - `:83-105`：按 scope 累加。
  - `:122-129`：`clearRuntimeOnlyPendingSheets_ACU` 不传 scope 可全清。
- 重走路径：
  - 外部 API 的 `skipChatSave` 写入调用 `markRuntimeOnlyPendingSheets_ACU({chatKey, isolationKey}, ...)`，登记留在模块 Map。
  - 用户切走/删除该聊天；`CHAT_CHANGED` / `CHAT_DELETED` 没有任何调用清理 `pendingByScope_ACU`。全仓 grep 生产代码只有 `runtime-only-pending-flush.ts` 的按表条件化清除（`clearRuntimeOnlyPendingSheetKeys_ACU`），没有按聊天 scope 清空。
  - 内存随聊天数缓慢增长；若之后重新打开同一文件名（或复制/改名成同名聊天），旧 scope 会被 `hasRuntimeOnlyPendingSheets_ACU` 当作仍有待落盘内容，触发一次多余的写回尝试。通常回放比对一致会清掉，最坏多一次写，不会直接损坏数据。
- 找过的守卫：
  - `clearRuntimeOnlyPendingSheetKeys_ACU` 只清本次处理的表，不会清其他聊天 scope。
  - `CHAT_CHANGED` 的 `clearAutoFillDebounce_ACU` / `cancelPendingChatMutationRefresh_ACU` 都不碰这个 Map。
  - `resetChatSaveCoalescerForTests_ACU` 只重置存盘合并，不重置 runtime-only 登记。
- 测试：没有覆盖「登记后切聊天/删聊天再重开同名聊天」的测试；`runtime-only-pending-flush.test.ts` 只测同 scope 的 flush。
- 修法方向：在 `CHAT_CHANGED` / `CHAT_DELETED` 收尾清理该聊天 scope，或给 `pendingByScope_ACU` 加 LRU/上限；不需要改 flush 语义。

## 跨组线索

（复核时确认位置存在，但未展开；不计入 D05 缺陷编号。）

1. **旧自动填表 run 在新聊天上继续跑**（`source/src/service/table/update-orchestrator.ts:3985`、`:3993-4101`）：`processUpdatesBatch_ACU` 只取一次 `chatHistory`，批循环只检查 `isTableFillStopRequested_ACU()`，不检查聊天身份；`CHAT_CHANGED` 只中止在途 AI 请求，不中止已进入循环的 run。建议 D02 复核。
2. **删除当前聊天时向量清理可能被跳过且不重试**（`source/src/service/vector/summary-vector-index-chat-deletion-gc.ts:105-109`）：`chatKey === getCurrentChatKey_ACU()` 时直接返回 `target_is_current_chat`；若 TT 先发 `CHAT_DELETED`、后发 `CHAT_CHANGED`，清理被跳过；`init.ts:825-832` 只延迟 5s 调一次，没有重试。
3. **合并存盘时向量镜像/世界书刷新早于真落盘**（`source/src/service/table/storage-frame-v2-persist.ts:2892-2898`、`update-orchestrator.ts:364-373`）：`persistTableMutationLogV2_ACU` 在 `saved=true`（合并分支只是记脏）后立即 `scheduleSummaryVectorMirrorFlushAfterPersist_ACU`；提交方随后刷新世界书。UPSTREAM-DRIFT 的「不可逆外置副作用一律在 strict 存盘之后」对这条路径不成立。
4. **`getCurrentChatId()` 读不到时的持久化身份**（`source/src/data/storage/chat-history.ts:64-71`）：返回 `'__host_without_chat_id__'`，同一宿主下所有聊天同值；如果 TT 缺这个 API，`getActiveChatStorageIdentity_ACU` 的复核也会一起失效，会放大 D05-03。

## 设计层面的疑虑（不计入缺陷）

- 存盘合并用「宿主可读的聊天 id」作为唯一归属凭据，本质上信任宿主在任意过渡态都能给出稳定 id；TT 复用 `chat` 数组、先清后填的流程与这个假设天然冲突。建议把「是否存在未落盘改动」与「这些改动属于哪段聊天」拆开：后者用 `chat[0]` 消息对象 + `getCurrentChatId()` 双证据；id 读不到时宁可立即真存，不要延迟。
- 120s 兜底定时器只按「上次真存盘时间」计时，宿主自己的保存（用户发消息等）不会更新这个时钟，也不会触发保管库捕获；合并窗口内用户发消息时，宿主保存虽然把内存改动带上了盘，插件仍会在 120s 后重复整份保存，且删楼守卫仍认为这些产物未捕获。
- strict 存盘的「页面卸载」检测只看 `window`/`pagehide`，宿主保存队列的完成与真实落盘之间没有可观测的确认；大聊天 + 宿主队列时，strict 的「成功后做不可逆副作用」仍建立在「宿主 resolve 即落盘」的假设上。

## 查过但判定没问题的场景

- **删楼后目标楼被换/删除**：`targetGuard` 在提交前/持久化前两次检查，`persistTableMutationLogV2Core` 2790-2795 再比对目标消息对象；已覆盖（`table-update-commit.test.ts` 与 `storage-frame-v2-persist.test.ts` 均有用例）。
- **填表主路径显式 `chatKey`**：fill/collect 路径在迁移后、apply 前、持久化前都会复核；batch 路径还在 3142-3151 逐个目标楼与根楼复核消息身份。D05-05 只影响未传 `chatKey` 的入口。
- **正常切聊天时的合并脏标记**：id 变化会触发 `keepChatSaveDirtyIfSameChat_ACU` 作废旧脏（`chat-save-coalescer.test.ts:224-234`）；这是文档化取舍，不算缺陷。
- **coalesced 存盘失败**：`saveChatToHostCoalesced_ACU` 在窗口外会抛给调用方，persist 回滚内存帧；窗口内只记脏，失败由后续冲洗点重试。脏标记不会把失败伪装成成功（`chat-save-coalescer.test.ts:106-113、212-221`）。
- **strict 存盘先于不可逆副作用**：`persistTableMutationLogV2Core` 2816 的分支正确；`saveChatToHostStrict_ACU` 的 pagehide 卸载检测也在。只有合并分支的「saved 但在内存」被向量/世界书调用方误用（跨组线索 3）。
- **回放 evidence 复用**：`validateV2ReplayEvidenceFresh_ACU` 同时比对数组引用、isolationKey、`headRevisionDigest`、模板结构指纹和 options 指纹；只有 in-flight 去重缺内容身份（D05-07）。
- **目标楼层在回放期间被删（前面楼层）**：单写路径 2793 与 batch 路径 3146-3151 会因对象身份不符拒绝；batch 路径还额外比对根楼。
- **`this_chid` 回退在正常唯一聊天场景**：同一角色只开一个聊天时 id 不变，合并不受影响；问题只在切到同角色另一个聊天且宿主读不到 id 时（D05-03）。
- **D05-04 的对照时序**：如果 checkpoint 写入后、删楼前发生过一次真存盘，post-save 捕获会拿到新产物，恢复成功；探针场景 2 已覆盖，说明问题确实来自「捕获被推迟」而不是恢复逻辑本身。
