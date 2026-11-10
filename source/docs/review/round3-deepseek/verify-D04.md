# D04 复核

## 概览

- 原报告：P0 0 / P1 0 / P2 2 / P3 2
- 复核后：成立 4，降级成立 0，不成立 0，需真机 0
- 跑过的探针（我建的 V04 文件已全部删除；目录里其余文件是其他分组子代理的，未触碰）：
  - `tests/__probe_deepseek__/V04-rowid.test.ts`（4/4 通过）：在快照路径和 live `applyEditsWithSystemRowIds` 路径都复现「行锁 + `UPDATE ... SET row_id`」产生两行；`materializedSqlTexts` 里能看到整行插回的补偿 SQL。
  - `tests/__probe_deepseek__/V04-tools.test.ts`（2/2 通过）：复现「正文 SQL 块 + `table_sql` 空 `sql`」被归一成空 `<tableEdit>`；对照组非空工具 SQL 正常保留。
  - `tests/__probe_deepseek__/V04-prepare.test.ts`（1/1 通过）：在 `prepareAIInput_ACU` 等待世界书快照时调用真实 `abortOnChatMutation_ACU()`，控制器未被中止，且随后 `prepare` 读到切换后的世界书配置（`SIGNAL_ABORTED=false WORLDBOOK=NEW_WORLDBOOK`）。
- 复核方式：逐条重开引用行；从用户操作重走调用链；对 P2 两条都跑了独立探针；D04-03 用纯函数探针，D04-04 用全仓 grep。没有运行任何已有测试文件。

## 逐条复核

### D04-01 → 成立｜P2

- 行号核对：基本一致，两处尾行需更正：
  - `source/src/service/table/sql-table-service.ts:1052-1070`：一致；`1068-1069` 正是 REPLACE/非 INSERT 原样返回。
  - `source/src/service/table/sql-table-service.ts:1170-1233`：函数实际到 `1234` 的闭括号；隐藏列集合在 `1212`。
  - `source/src/service/table/table-lock-enforcement.ts:114-124`：一致；整行补偿在 `183-194`（报告写 183-193，少一个闭括号）。
  - `source/src/service/table/table-update-commit.ts:163-194`：一致；`assertPersistableRowIdentities_ACU` 在 `445` 被调用。
  - 调用点 `update-orchestrator.ts:2106`、`:3550`，`table-fill-staging-session.ts:103`：一致。
- 重走路径：
  1. 用户在可视化编辑器里锁住某行（写入 `settings_ACU.tableUpdateLocks` 的 `rowIds`）。
  2. 自动/手动填表，AI 输出 `UPDATE inventory SET row_id = 2, quantity = 99 WHERE row_id = 1;`。
  3. `applyEditsWithSystemRowIds` → `materializeSystemRowIdsForSqlInserts_ACU`：`UPDATE` 不命中 `REPLACE`/`INSERT` 分支，原样放行（`sql-table-service.ts:1068-1069`）。
  4. `assertNoHiddenPhysicalColumnMutations_ACU` 的 `hidden` 只来自 `getSheetColumnProjection_ACU(...).hiddenPhysicalColumns`（`:1212`），默认不含 `row_id`，因此不拦。
  5. live 路径 `runBatchWithFinalize` 的 finalize 调 `enforceTableLocksAfterSqlApply_ACU`（`sql-table-service.ts:1993-2009`）：前像有 row 1、后像只有 row 2，`rowsToRestore` 收录 row 1（`table-lock-enforcement.ts:114-124`），生成整行 `INSERT INTO ... (row_id, ...) VALUES ('1', ...)`（`:183-194`）。
  6. 补偿 SQL 追加进 `materializedSqlTexts`（`sql-table-service.ts:2015-2022`），最终 `tableData` 同时有 row 1 和 row 2。
  7. 提交侧 `assertPersistableRowIdentities_ACU` 只检查 row_id 非空且不重复（`table-update-commit.ts:178-192`），两条不同 row_id 能通过。
- 找过的守卫：
  - `rebindSqlMutationIdentifiers_ACU`（`sql-table-service.ts:417-460`）只重绑表名/列名，并做 INSERT 未知列检查，没有 `SET row_id` 禁令。
  - `assertNoHiddenPhysicalColumnMutations_ACU` 不检查 `row_id`（前面第 4 点）。
  - `applyEditsBatch` 的外部写入整笔拒绝只覆盖 `manual_crud`/`raw_sql_*`（`table-update-commit.ts:196-205`、`:293-300`），AI 的 `group_fill` 不受这条拦截。
  - `authorizeSqlStatementsForTargets_ACU` 只做目标表授权；`table-fill-target-guard` 只看楼层/回复版本；都与 row_id 无关。
  - `applyEditsWithSystemRowIds` 的 `_assertRuntimeSchemaCurrent` 只校验 schema 摘要，不校验行身份。
- 探针：`V04-rowid.test.ts`（已删除）关键断言与结果：
  ```ts
  expect(result.workingData?.sheet_0?.content).toHaveLength(3);
  expect(result.workingData?.sheet_0?.content.slice(1)).toEqual([
    ['1', '铁剑', '3'], ['2', '铁剑', '99'],
  ]);
  // live 路径：expect(live.tableData?.sheet_0?.content).toHaveLength(3);
  ```
  实际快照路径与 live 路径都返回 `[["row_id","item_name","quantity"],["1","铁剑","3"],["2","铁剑","99"]]`；live 的 `materializedSqlTexts` 为 `UPDATE ...; INSERT INTO "beibaowupinbiao" ("row_id", ...) VALUES ('1', ...);`。无锁路径 `UPDATE ... SET row_id = 42` 直接改成 42，`revertedByLocks` 为空。
- 补充或更正：
  - 报告说「`table-edit-parser.test.ts` 把 SQL 分支 mock 掉了」不准确；真正没覆盖的是 `sql-table-service.test.ts` 的「锁定差异回滚（S0-2）」只测了业务列 UPDATE / DELETE，没有「UPDATE row_id」。
  - 如果目标表业务列有 UNIQUE 约束，整行补偿 INSERT 可能撞唯一约束，结果是整批 fail-closed 而不是出现两行；无论哪种，都是本条缺陷的用户可见后果，但报告「一定出现重复行」应理解为「无唯一约束时」。
  - 报告给的是 P2。触发需要模型写出 `UPDATE ... SET row_id`（默认提示词只禁止 INSERT 带 row_id，`fill-prompt.js:43` 的 UPDATE 段确实没有禁令），不是普通玩家直接操作，维持 P2；若线上实际观察到，可考虑 P1。

### D04-02 → 成立｜P2

- 行号核对：基本一致，起止行有几处 1-2 行漂移：
  - `prompt-api-call.ts:83-89`：一致（登记在 83-84，`throwIfAborted` 在 89）。
  - `prompt-prepare.ts:450-472`：一致（`resolvePreTakeoverWorldbookSnapshot_ACU` 在 451，`getCurrentWorldbookConfig_ACU` 在 472）。
  - `prompt-prepare.ts:481-503`、`:554`：一致。
  - `prompt-api-call.ts:129-144`：实际 `$U`/`$C` 读取在 128-144；`prompt-api-call.ts:239-247`：实际 `<if>` 上下文在 237-248。
  - `state-manager.ts:613-643`、`init.ts:546`、`update-orchestrator.ts:1542-1551`/`:1622-1628`：一致。
- 重走路径：
  1. 自动填表启动后，`processUpdatesBatch` 置 `isAutoUpdatingCard_ACU = true`（`update-orchestrator.ts:3964-3968`）。
  2. `collectGroupFillResponse_ACU` 先登记目标楼层 watch（`:1486`），然后进入 `prepareAIInput_ACU`（`:1542`）。
  3. `prepare` 在 `await resolvePreTakeoverWorldbookSnapshot_ACU()`（`prompt-prepare.ts:451`）处让出事件循环；此时用户点「开始新聊天」或删当前聊天，CHAT_CHANGED 进来。
  4. `handleChatChangedEvent_ACU` 先 `abortOnChatMutation_ACU()`（`init.ts:546`），后者遍历 `activeAbortControllers_ACU`（`state-manager.ts:596`、`:613-620`、`:636-643`）。填表的控制器此刻还没登记：登记发生在 `callCustomOpenAI_ACU` 开头（`prompt-api-call.ts:83-84`），而 `prepare` 在它之前。因此控制器不被 abort。
  5. `prepare` 继续；越过 451 的 await 后，`getCurrentWorldbookConfig_ACU()`（`:472`）读当前聊天配置；`$U`/`$C` 在 `callCustomOpenAI_ACU` 里读当前角色（`:128-144`）；`<if>` 用 `currentJsonTableData_ACU`（`:237-248`）。这些都可能已经是新聊天/新角色的数据，而 `$0`（`job.baseSnapshot`）和 `$1`（`job.messagesForContext`）仍是旧聊天。
  6. `callCustomOpenAI_ACU` 的 `abortSignal.throwIfAborted()` 通过（控制器没被 abort），请求照发。
  7. 结果回来后在提交层被拒：`assertExpectedCommitScope_ACU` 的 targetGuard/chatKey 检查（`table-update-commit.ts:302-323`，在 `:334`、`:413`、`:444` 复检）会因聊天/隔离标识或目标楼层不匹配抛 `precondition`，不会写进新聊天。
  8. 旧轮期间新聊天的自动填表：`autoUpdateTriggerInFlight_ACU`/`isAutoUpdatingCard_ACU` 会把新触发合并等待（`settings-ui-trigger.ts:143-151`、`:176-190`），旧轮收尾后按新 scope 补跑；若旧请求永久悬挂，则一直等（这是报告「设计疑虑」里的无超时问题，不是本条独有）。
- 找过的守卫：
  - `getChatMutationAbortSignal_ACU`：`prepare` 只在 `createLorebookReadContext_ACU({ isActive: () => options?.signal?.aborted !== true })`（`prompt-prepare.ts:467`）里用到 `options.signal`，而且这个 `signal` 是填表自己的控制器，不是全局 chat mutation 信号；`prepare` 内没有 `throwIfAborted`、没有 chatKey/隔离标识复核（grep 只在 467 命中）。
  - `table-fill-target-watch.abortTableFillRequestsWithStaleTarget_ACU`：只在 `MESSAGE_DELETED` / `MESSAGE_SWIPED` 调（`init.ts:1286-1294`），CHAT_CHANGED 不调；且 watch 只在目标楼层失效时 abort，聊天切换不是它的触发条件。
  - `clearAutoFillDebounce_ACU`：只清防抖定时器，不中止已进入 prepare 的请求。
  - `resetScriptStateForNewChat_ACU`：会重置 `currentJsonTableData_ACU` 等状态，但不 abort 填表控制器。
  - 提交层 chatKey/targetGuard 双检确实存在，能挡住落盘，但发生在 AI 请求之后，挡不住「白烧请求」和「prepare 混上下文」。
- 探针：`V04-prepare.test.ts`（已删除）把 `resolvePreTakeoverWorldbookSnapshot_ACU` 挂起，等 `prepare` 进入等待窗口后调用真实 `abortOnChatMutation_ACU()`，再把模拟的 `getCurrentWorldbookConfig_ACU` 切到新聊天、把世界书内容改为 `NEW_WORLDBOOK`。关键断言：
  ```ts
  expect(mockSnapshotCalled).toBe(true);
  abortOnChatMutation_ACU();
  mockWorldbookContent = 'NEW_WORLDBOOK';
  ...
  expect(controller.signal.aborted).toBe(false);
  expect(result?.worldbookContent).toBe('NEW_WORLDBOOK');
  ```
  实际输出 `SIGNAL_ABORTED=false WORLDBOOK=NEW_WORLDBOOK`。这证明：prepare 的控制器不在 CHAT_CHANGED 的中止集合里，且 prepare 会读到切换后的全局配置。探针没有模拟真实宿主事件，宿主事件顺序仍是 B 场景的待真机项（见下）。
- 补充或更正：
  - 报告把 C/B 都写进触发。C（同一角色「开始新聊天」）时 `$U`/`$C`/角色世界书绑定通常不变，所以「混入新聊天资料」并非必然；真正确定的是旧请求照发、`<if>` 看到的 `currentJsonTableData_ACU` 会变（切聊时被 `resetScriptStateForNewChat_ACU` 清成 null，1200ms 延迟重建后变成新聊天数据）、以及白烧一次请求。B（删当前聊天后宿主打开别的聊天）里新聊天角色可能不同，混合更明显，但「宿主先发哪个事件、是否自动开新聊天」仍需真机；这不影响本条核心「prepare 窗口不在中止范围」成立。
  - 报告说「已坐实（读穿调用链，未跑探针）」，我补了探针，核心结论成立。
  - 报告引用的 `settings-ui-trigger.ts:143-151、:176-190` 与代码一致；新聊天触发是被合并等待而不是永久丢失（旧轮结束时按 `pendingAutoUpdateScopeKey_ACU === currentAutoUpdateScopeKey_ACU()` 补跑），只有旧请求永久悬挂时才会一直等。

### D04-03 → 成立｜P3

- 行号核对：核心两处一致，一处需更正：
  - `table-fill-tools.ts:119-143`、`:140-142`：一致。
  - `prompt-api-call.ts:274-289`：一致（`resolveTableFillToolTurn_ACU` 在 282）。
  - 报告把「零操作语义」标在 `update-orchestrator.ts:1647-1651`：这四行实际是「缺标签就重试」和 `tableEditText` 提取；真正的零操作提交在 `table-edit-parser.ts:137-152`（空块返回 true）和 `update-orchestrator.ts:2274-2289`（`zeroOpRejection` 只处理 `success=false` 且 `failedEdits===0` 的另一种情况）。代码位置应以此为准。
- 重走路径：
  1. 设置开启「填表原生工具调用」（默认关闭）且非流式，`callCustomOpenAI_ACU` 把主段换成工具版（`prompt-api-call.ts:110-126`、`:274-289`）。
  2. AI 正文写 `<tableEdit>UPDATE t SET a=1 WHERE row_id=1;</tableEdit>`，同时调用 `table_sql({"sql":""})`。
  3. `resolveTableFillToolTurn_ACU`：`calls` 非空（121-123），`parts` 为空（138），`content.replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '')` 把正文块剥掉（140），返回 `` `<tableEdit>\n\n</tableEdit>` ``（141-142）。
  4. `collectGroupFillResponseCore_ACU` 只检查 `aiResponse.includes('<tableEdit>') && ...includes('</tableEdit>')`（`update-orchestrator.ts:1647-1651`），提取出的 `tableEditText` 为空字符串，随后走 JSON 分支。
  5. `parseAndApplyTableEditsToData_ACU` 对空块返回 true（`table-edit-parser.ts:147-152`），`parsedKeys` 回退为 `job.targetSheetKeys`（`update-orchestrator.ts:2267`），`appliedEdits` 非 0，`modifiedKeys` 仍登记目标表（`:2311`），提交保存的是未改动的快照。
  6. 自动入口在 `failedGroups === 0` 时登记该楼已自动填表（`settings-ui-trigger.ts:283-287`），于是就出现「正文修改丢失、但本轮算成功/该楼算已填」。
- 找过的守卫：
  - `resolveTableFillToolTurn_ACU` 只在参数非 JSON（130）、缺 `sql` 字段（136）时 `ok:false`；`sql` 为空串是合法值，没有「空工具 + 正文有块」的特判。
  - `collectGroupFillResponseCore_ACU` 没有空块/空 SQL 的拒绝；`tableEditMinResponseLength` 也拦不住，因为合成后的文本仍包含 `<tableEdit>` 标签且可能达到长度阈值。
  - `table-edit-parser` 的空块零操作是既有设计（注释明说勿改回模型重试），问题在于工具归一化把「正文有块」变成了「空块」。
  - `shouldUseTableFillNativeTools_ACU` 只控制开关/流式，不参与内容校验。
- 探针：`V04-tools.test.ts`（已删除）：
  ```ts
  const resolved = resolveTableFillToolTurn_ACU({
    content: '分析完毕\n<tableEdit>UPDATE t SET a = 1 WHERE row_id = 1;</tableEdit>',
    toolCalls: [{ name: 'table_sql', arguments: '{"sql":""}' }],
  });
  expect((resolved as any).text).toBe('分析完毕\n<tableEdit>\n\n</tableEdit>');
  ```
  实际 `{"ok":true,"text":"分析完毕\n<tableEdit>\n\n</tableEdit>","viaTool":true}`；对照用例非空 `sql` 时工具结果保留、正文块被剔除（符合预期）。
- 补充或更正：
  - 后果是「悄悄丢改动 + 记为成功」，属于功能缺陷而非纯清理；但触发要求可选工具模式（默认关闭）加模型自相矛盾输出（正文写 SQL 又说空工具），维持报告 P3 可以接受；如果真机遇到，应按 P2 处理。
  - 报告「界面提示成功」需要看具体 UI 路径；代码能确认的是自动填表会把该楼登记为已填（`settings-ui-trigger.ts:283-287`），以及 JSON 分支会按目标表提交未变化的数据。

### D04-04 → 成立｜P3

- 行号核对：一致：
  - `table-edit-parser.ts:129`（`parseAndApplyTableEditsToData_ACU(..., isImportMode = false)`）。
  - `table-edit-parser.ts:623-628`（`parseAndApplyTableEdits_ACU(..., isImportMode = false)` 只透传）。
  - 调用方 `update-orchestrator.ts:2263`、`:3701`，`table-fill-staging-session.ts:126`。
- 重走路径：
  - `grep isImportMode` 在 `table-edit-parser.ts` 只命中 129、623、628 三处，函数体内没有任何引用。
  - `grep parseAndApplyTableEdits_ACU`：生产代码只有 `service/ai/prompt-builder/index.ts:14` 的 re-export；运行时代码零调用，剩余命中在测试。
  - 因此调用方传 `options.isImportMode` 没有任何行为差异，导入语义实际由 `skipChatSave`/持久化层控制。
- 找过的守卫：本条是清理项，不存在功能守卫。删除 `parseAndApplyTableEdits_ACU` 时需要同步改 `tests/integration/ai-fill-table.test.ts`、`tests/service/ai/table-edit-parser.test.ts` 等测试引用；`isImportMode` 只删参数即可。
- 探针：无（P3，纯 grep 判定）。
- 补充或更正：
  - 报告说「生产代码零调用」准确；更精确的说法是「运行时零调用，仍由 index.ts 再导出且被测试使用」。
  - `isImportMode` 是死参数；但 `parseAndApplyTableEditsToData_ACU` 本身仍是生产入口（`update-orchestrator.ts:2263`、`:3701`、`table-fill-staging-session.ts:126`），不要把它一起删掉。

## 设计层面的疑虑（复核补充，不计入缺陷）

- 与 D04-02 相关：`postChatCompletion_ACU` 不设传输超时（`api-call.ts:639-645` 的注释与函数签名明说），如果服务商半开连接导致 fill promise 永久悬挂，新聊天会一直停在 `isAutoUpdatingCard_ACU === true` 的等待状态，直到下一次聊天变更或用户点「终止」（30s 只强制放开标志，promise 仍悬挂）。这不是 D04-02 独有的根因，但会放大它的后果。
- 与 D04-01 相关：锁定补偿把「row_id 被改号」误判成「行被删除」。即使拒绝 `SET row_id`，任何未来允许改号的功能都会再次触发同类「整行插回」；锁身份判定最好同时保留业务内容或旧 row_id 的映射。

## 查过但判定没问题的场景（复核补充）

- D04-02 的「旧时间线不会写进新聊天」：`assertExpectedCommitScope_ACU` 的 chatKey/隔离标识检查（`table-update-commit.ts:313-323`）在 `:334`、`:413`、`:444` 三次复检，确实能让 D04-02 保持在 P2 而不是 I1/P0。
- D04-01 的「外部手动 SQL 改 row_id」：`applyEditsBatch` 的外部写入整笔拒绝（`table-update-commit.ts:196-205`、`:293-300`）和 `detectOnly` 锁守卫会挡住；本条只针对 AI 的 `group_fill` 路径。
- D04-03 的「工具 SQL 非空」：正文明里的块会被剔除、工具结果优先，这是设计内的双写保护；只有「所有工具都为空 + 正文有非空块」才会吞改动。
