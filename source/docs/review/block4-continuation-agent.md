# 全库复审 · 第 4 块：续写（continuation）与 Agent / 世界书接管

审查方式：只读审查，结论分「已坐实」（探针复现或调用链完整追踪）与「待坐实」。探针均放在会话 scratchpad，未留在 `source/tests` 下。

## 覆盖范围

**全文精读**
- `src/service/continuation/continuation-orchestrator.ts`
- `src/service/continuation/agent/agent-workflow.ts`
- `src/service/continuation/agent/agent-transaction.ts`
- `src/service/continuation/agent/agent-main-loop.ts`（`plan` 主循环、固定工作流、派工结算、资料补足入口）
- `src/service/continuation/agent/agent-main-correction.ts`
- `src/service/continuation/stage-execution-engine.ts`
- `src/service/continuation/host-generation-bridge.ts`
- `src/service/continuation/continuation-runtime.ts`
- `src/service/agent/agent-worldbook-takeover.ts`
- `src/service/agent/agent-worldbook-snapshot-restore.ts`

**部分精读或略读**
- `continuation-store.ts`：精读了持久化、写队列和记忆化部分（L1330–1563）；提示词迁移链只略读。
- `agent-module-store.ts`：精读了写盘门、逐栏提交 `commitAgentModuleFieldWrites_ACU`、用户保存和清空。
- `agent-module-frame.ts`：精读了 fold、plan、逐栏 plan。
- `agent-subagent-runtime.ts`：精读了 `run` 小循环与 write_sql 端口（L470–1066）。
- `agent-conversation-store.ts`：读了写入部分。
- `agent-placeholder-resolver.ts`：只读了 `resolveAgentReadToken_ACU`。
- `agent-worldbook-config-meta.ts`：只读了 scope 变更恢复（L640–840）。
- `agent-decision-engine.ts`、`agent-skillify-service.ts`、`agent-web-client.ts`：只看了循环上界、写入点和 SSRF 守卫。
- `agent-module-sql-view.ts`：只确认了模型 SQL 不会被原样执行（全部参数化）。
- `helpers-remaining.ts`：只读了 `handleChatCompletionReady_ACU`。

**未覆盖**
- `agent-protocol.ts`、`agent-model.ts`（类型和常量）、`agent-defaults.ts`（提示词文本）。
- `agent-search.ts`、`agent-read-gate.ts`、`agent-token-budget.ts`、`agent-history-compactor.ts`、`agent-handoff-summarizer.ts`、`agent-prompt-drift.ts`、`agent-run-cache.ts`、`agent-session-log.ts`、`agent-catalog.ts`、`agent-tables.ts`、`agent-worldbook-read.ts`、`agent-user-requirements.ts`、`agent-final-review-context.ts`、`agent-checkpoint-scheduler.ts`。
- `outline-planner.ts`、`outline-schema.ts`、`outline-tags.ts`、`model.ts`、`defaults.ts`、`internal-ai-call.ts`、`api-preset.ts`、`prompt-template.ts`、`lenient-text.ts`、`stage-cursor.ts`、`host-retry-mode.ts`、`worldbook-context.ts`、`internal-ai-events.ts`、`sillytavern-host-bridge.ts`、`host-turn-adapter.ts`。
- `agent-worldbook-skill-meta.ts`、`agent-worldbook-ranking.ts`、`agent-prompt-template.ts`。
- 继续用的小锁和状态文件 `agent-worldbook-operation-lock.ts`、`agent-worldbook-snapshot-state.ts` 只看了被调用的方式。

**整体印象**：编排器的租约、epoch、AbortController 设计较严密。停止、插话、切聊天、迟到写入的守卫链完整，没发现「写进错误聊天」的路径。主循环、子代理、工作流都有硬上限，没有无界循环或重试风暴。模型 SQL 只走白名单解析和参数化写入，不会被直接执行。问题集中在两块：write_sql（逐栏即时写）这条新通道与旧领域模块之间的衔接，以及世界书接管在「条目被删」时的收敛。

---

## P1

**R4-01 [P1 已坐实] 逐栏写（write_sql）的证据楼层上限用的是旧结算水位，结算窗口内的新楼层一律被拒**
- 位置：`src/service/continuation/agent/agent-module-store.ts:893`（plantedIndex），`:897`（revealIndex），`:904`（evidenceIndexes），`:883`（报错附带的「本次引用上限」）
- 现象/触发路径：
  1. hook-cognition-maintainer 的任务是结算 `settledThroughIndex+1 … 末楼` 这段未结算正文。
  2. 它调用 write_sql 时，`fieldCommitProblem_ACU` 要求楼层号 `<= folded.snapshot.settledThroughIndex`，也就是本轮结算之前的旧水位。
  3. 结果是新伏笔的 `planted_index`、新揭示的 `reveal_index`、年代学的 `evidence_indexes` 只要指向本轮要结算的楼层就被拒，只能引用已经结算过的旧楼层。
  4. 回执还会告诉模型「本次引用上限 0」，诱导它换成旧楼层号。
  5. 对比整行事务路径：`applyChronologyDelta_ACU` 的上限是 `settledIndex`（当轮末楼，见 `agent-transaction.ts:512`）；hooks 整行路径则不校验 plantedIndex 的上限。两条路径对同一意图判定相反。
- 证据：探针 `r4-fieldwrite-invisible.probe.test.ts`。水位 0、新楼层 1，`INSERT ... planted_index=1` 被拒，理由是「本次引用上限 0」，记录只停在 partial。现有测试（`agent-module-store.test.ts:573-625`、`agent-dual-mode-s11.test.ts:190`）里快照水位都等于末楼，没有覆盖「结算窗口内楼层」这个场景。
- 修法方向：逐栏提交的上限改为本次结算目标（调用方传入 `settledIndex`，即当轮末楼），与事务路径同口径；白名单仍用 `isAiFloor_ACU`。

**R4-02 [P1 已坐实] write_sql 写入的条目永远不进领域数组，下游读不到；工作流却按「无变化」完成并推进结算水位**
- 位置：
  - `agent-workflow.ts:638-648`：usedFieldWrites 分支，按 revision 是否增长判断模块是否已写入。
  - `agent-workflow.ts:701-708`：推进 `settledThroughIndex`。
  - `agent-module-store.ts:1003-1006`：注释写明「有意不移植上游的领域提升」。
  - `agent-subagent-runtime.ts:618`（提示词鼓励用 write_sql）、`:499`（把 complete 记录称为「已是正式条目」）、`:694`（用了 write_sql 后最终契约必须为空）。
  - `agent-placeholder-resolver.ts:787-810`：`$HOOKS_LEDGER` 等读口只读 `snapshot.hooks` 等领域数组。
- 现象/触发路径：
  1. 固定工作流（`agent-main-loop.ts:1717`）、手动派工（`:2069`）、资料补足（`:590`）都给可写子代理开了 write_sql。提示词和协议纠错（`agent-subagent-runtime.ts:1058`）都主动引导模型改用 write_sql。
  2. 逐栏 delta 只进分栏视图（`fieldUpserts`），即使栏目写齐变成 complete，也不投影到 `hooks/infoGap/chronology/storyArc` 领域数组，而且不推进模块 revision。
  3. 用了 write_sql 之后，最终契约必须是空 delta（余量会被弹回，`assertFieldWriteSettleable_ACU` 也会拒）。所以这批内容没有任何通道能进入领域数组。
  4. 工作流看到 revision 没变，`appliedModules` 为空；`deliverContract` 也报 `complete_no_change`。工作流于是记 `no_change`，并把结算水位推进到末楼。
  5. 后果：`$HOOKS_LEDGER`、`$INFO_GAP`、`$CHRONOLOGY`、`$STORY_ARC`（以及大纲侧 `continuation-runtime.ts:152-161` 的固定注入）读不到这批结算结果；水位已经越过这些楼，下轮也不会再结算。等于这一段正文的结算结果对所有消费者静默丢失，只有知道确切 ID 的 `$FIELD:` 读取能看到。
  6. arc-architect 走手动派工路径时同样受影响：`hasActiveStoryArc_ACU` 只看领域数组，`renderArcSqlBootstrap_ACU` 却告诉模型「已是正式条目」。
- 证据：
  - 探针 `r4-fieldwrite-invisible.probe.test.ts`：write_sql 写入一条字段齐全的 H002（status=complete）后，`result.snapshot.hooks.length === 0`，`renderAgentHooksByIds_ACU` 只输出「当前修订号=0」，`settledThroughIndex` 从 0 推进到 1，步骤记为 `hook-cognition-maintainer:no_change`。
  - `agent-module-field-s1.test.ts:104-121` 在帧层把「complete 也不投影」锁成了设计行为。但端到端的后果（读不到、水位照推）没有任何测试覆盖。因此这条结论是「帧层按设计，集成层是缺陷」。
- 修法方向：二选一。
  - 补上「complete 记录提升为领域条目」（即上游的 domainUpserts），并按提升结果推进 revision 和判定 appliedModules。
  - 或在 TT 侧不对结算类角色开放 write_sql，改回整行契约。
  - 无论选哪种，`appliedModules` 和完成态都不能在「只有草稿」时报 `complete_*`，水位也不能推进。

**R4-03 [P1 已坐实] 定向资料补足只要子代理用了 write_sql 就必然失败报错，而草稿已经落盘**
- 位置：
  - `agent-main-loop.ts:590-593`：补足时 writeSql 直接写 `chat.length-1`。
  - `continuation-orchestrator.ts:179-181`：资料指纹 = sha256(JSON.stringify(整份快照))。
  - `continuation-orchestrator.ts:532-535`：提交前比对指纹。
  - `agent-module-frame.ts:503`：`applyDelta_ACU` 会改写 `updatedAt`。
- 现象/触发路径：
  1. `repairPendingMaterials` 的设计是「引擎只返回候选，编排器在复核锚点、任务和指纹后才提交」。
  2. 但补足通道给子代理开了 write_sql，`commitAgentModuleFieldWrites_ACU` 会在子代理运行期间直接写楼层并 `saveChat`，绕过了编排器的锚点和指纹复核。
  3. 逐栏 delta 一折叠，快照的 `updatedAt` 就变了，所以 `materialAuthorityFingerprint_ACU(currentSnapshot) !== baseFingerprint` 必然成立。编排器随即抛出 `CONTINUATION_INTERNAL_REQUEST_STALE`「资料补足期间模块 revision、pending 或完成状态已变化」。
  4. 用户看到补足失败，但草稿已经写进楼层；pendingFixes 也没有清（叠加 R4-02，revision 不变）。每次重试都重复这个过程，白白消耗模型调用。
- 证据：
  - 探针 `r4-repair-fieldwrite.probe.test.ts`：write_sql committed 后 revisions 全部不变、`hooks` 为空、`updatedAt` 改变，指纹因此改变。
  - 编排器的 `repairPendingMaterials` 没有任何测试（`partial-completion-tt-red.test.ts:43` 只断言了方法存在）。
- 修法方向：补足通道不开放 write_sql（只收整行契约，由编排器统一提交）。如果保留，指纹必须排除 `updatedAt`，并把逐栏写纳入编排器的锚点复核之后再提交。

**R4-04 [P1 已坐实] 接管期间删除任一被接管的世界书条目后，「退出接管」再也清不掉状态；接管保持 active，用户恢复后的条目在每轮最终提示词里被持续过滤**
- 位置：
  - `agent-worldbook-takeover.ts:1457-1498`：restore 先把全部条目标成 pending，`remainingBooks` 来自 pending 快照。
  - `agent-worldbook-takeover.ts:978-983`：条目不存在时记 skipped。
  - `agent-worldbook-takeover.ts:1059-1066`：`collectRecoveredPendingSnapshotUpdates_ACU` 跳过不存在的条目。
  - `agent-worldbook-takeover.ts:1461`：下一次 restore 过滤掉 pending 条目。
  - 后果落点：`src/service/runtime/helpers-remaining.ts:219-236`。
- 现象/触发路径：
  1. 接管生效后，用户在世界书里删掉某条已被接管（禁用）的条目，这在整理世界书时很常见。
  2. 用户关闭 Agent 世界书或点退出接管，第一次 restore：其余条目正常恢复；被删条目记 skipped，并以 `takeoverStatus:'pending'` 留在账本里，账本仍是 `active:true`。
  3. 之后的每次 restore 都会把 pending 条目排除在恢复集合之外，同时又因条目不存在而不算「已恢复」，所以永远无法收敛，结果是 `no_active_snapshot` 却仍然 active。
  4. `isWorldbookTakeoverActive_ACU()` 恒为 true。`handleChatCompletionReady_ACU` 每轮都会把所有「Agent 控制范围」的 skill 条目（包括刚恢复的用户条目）从最终提示词里过滤掉，除非被绿灯放行。效果是用户的世界书静默失效，而且没有 UI 出口能恢复。
  5. scope 变更走的另一条恢复路径（`agent-worldbook-config-meta.ts:704-719`）在 skipped>0 时回滚并拒绝变更，同样被卡住：用户也换不了世界书范围。
  6. 「comment 被用户改过」这种 skipped 情况设计上是保留恢复依据，不受影响：条目注释里的 meta 会把它重新合并成 applied，下次能恢复，探针已验证。只有「条目已删除」没有任何收敛路径。
- 证据：探针 `r4-takeover-restore-stuck.probe.test.ts`，第二个用例：删除条目后连续两次 restore，`mockStateSnapshot.current.active === true`，`getPlotAgentWorldbookSnapshot_ACU().active === true`，账本里残留 `takeoverStatus:'pending'`。第一个用例证明「改注释再改回」能正常恢复，排除了误报。
- 修法方向：restore 时，宿主确认已不存在的条目（`!currentEntry`）应直接从账本剔除，视为已完成，不要留成 pending。scope 恢复也应把「条目不存在」与「注释被改」区分开，不再因前者拒绝。

---

## P2

**R4-05 [P2 已坐实] 定向补足的写集裁剪漏掉 `chronologyPatches`，只要模型多发一个年代学 patch，整次补足就失败**
- 位置：`agent-workflow.ts:241-261`（`restrictMaintainerOutput_ACU` 用 `...output.delta` 透传了 `chronologyPatches`），`agent-transaction.ts:57-61`（`assertWritePermission_ACU` 在模块隔离之外直接抛错）
- 现象/触发路径：
  1. 用户只选 hooks 补足。maintainer 的权限是 hooks/infoGap/chronology，它返回的 delta 里顺手带了 `chronologyPatches`。
  2. 裁剪函数清掉了 hookPatches、infoGapPatches 等，唯独漏了 chronologyPatches。
  3. 事务以 `targetModules=['hooks']` 做权限检查，抛出「未授权模块：chronology」。这个抛错不受 tolerant 模式保护，导致合法的 hooks 写入一起作废，目标模块记 failed。
- 证据：探针 `r4-repair-chronology-leak.probe.test.ts` 输出 `repaired [] failed ['hooks']`，pending 的 lastError 是「子代理试图写入未授权模块：chronology」。
- 修法方向：裁剪函数补上 `chronologyPatches: allowed.has('chronology') ? … : []`。更稳妥的做法是用 `collectTouchedModules` 同源的字段表统一裁剪。

**R4-06 [P2 待坐实] 固定工作流全程没有「聊天楼层未变」守卫，结束时还会按当前聊天重算前缀指纹；在途期间末楼被编辑或 swipe 时，结算结果会挂到新内容上**
- 位置：`agent-main-loop.ts:1645-1772`（对比 `runDelegations` 在 `:1937-1942`、`:2079`、`:2245` 有 `assertChatUnchanged_ACU`），`:1688`（`settledIndex` 在开头固定），`:1763-1765`（`refreshAgentModuleSnapshotChatPrefix_ACU(nextSnapshot, chat)`）
- 现象/触发路径：
  1. 工作流里依次跑 maintainer、planner、composer、终审，可能持续数分钟。
  2. 这期间用户编辑末楼正文，或 swipe 末楼（同一个对象被原地改写），租约和身份校验都不会发现。
  3. 结束时，结算结果是按旧正文得出的，却用新正文重算指纹，前缀守卫被「洗白」。帧的 delta 还按写入时的 swipeId 落盘，结果资料被归到新 swipe 名下。
  4. 删楼或追加楼通常会因 targetIndex 和指纹变化被拦住，主要风险在原地编辑和 swipe。
- 证据：调用链已追踪，工作流路径没有任何楼层引用或内容比对；没有写探针复现时序。
- 修法方向：在工作流开始时快照「末楼引用 + swipe_id + mes 哈希」（`agent-main-correction.ts:51-53` 已有同款写法），落盘前复核；不一致就按 STALE 拒绝。指纹改为沿用工作流开始时的值，不在结束时重算。

**R4-07 [P2 已坐实] 世界书恢复逻辑有两份实现，语义已经分叉**
- 位置：`agent-worldbook-takeover.ts:952-1052`（`restoreSnapshotEntries_ACU`），`agent-worldbook-snapshot-restore.ts:119-220`（`restoreAgentWorldbookSnapshotEntries_ACU`，供 scope 变更使用）
- 现象/触发路径：两份实现在以下方面不一致。
  - pending 条目：前者跳过，后者照常恢复，会把从未被禁用过的条目的 keys/type 覆盖成快照值。
  - 注释被改过的条目：前者保留接管 meta（保留恢复依据），后者剥掉 meta 再计 skipped。后者随后整体回滚，所以目前结果勉强一致，但依赖回滚成功。
  - 剥离 meta 的函数不同：Strict 与 Loose。
  - 「已恢复」的判定口径不同：集合比较 keys，与 JSON 全等比较。
- 证据：两段代码逐行对照。
- 修法方向：抽成一个共用的恢复核心，scope 变更路径只额外负责回滚。

**R4-08 [P2 已坐实] Agent 会话记录写在物理末楼，没有做 AI 楼解析；与资料帧的落点规则不一致**
- 位置：`agent-conversation-store.ts:435-447`、`:455-464`（`chat.length - 1`）
- 现象/触发路径：
  1. 资料帧专门避开了 TT 2.3.0 的工具楼和隐藏楼（`resolveFrameFloor_ACU`），理由写得很清楚：这类楼可以被用户单独删除，删了数据就跟着消失。
  2. 会话段和压缩标记却仍然写在物理末楼。末楼是工具楼时，会话记录（包括用户插话、已经报「已接收」的消息）就挂在随时可能被删的楼上。
  3. 宿主在途时用户插话（disposition `queued_after_host`）：消息挂到正在流式输出的 AI 楼上。若这一楼因标签缺失或正文过短被 regenerate 删掉，这条消息也一起丢失。
- 证据：代码追踪。没有测试固定工具楼场景下的行为。（「删掉承载楼，会话随之回退」本身是注释里写明的设计，这里只针对落点规则不一致。）
- 修法方向：会话段落点复用 `resolveFrameFloor_ACU` 的「≤ 末楼的最近 AI 楼」规则；在途插话推迟到确认后再落盘，或落到指令楼之前的稳定楼。

---

## P3

**R4-09 [P3 已坐实] `*ViaSql_ACU` 校验变体会吞掉所有错误，注释写的「fail-closed」实际是 fail-open，而且每次 apply 都物化一次 sql.js**
- 位置：`agent-transaction.ts:1017-1072`
- 现象：`verifyAgentModuleRowsViaSql_ACU` 失败或复算不一致时被 `catch {}` 吞掉，照常返回 JSON 链的结果，所以这层校验对结果没有任何影响。但每次结算、修复、约束登记都要建一个 sql.js 库、建表、写全部行，纯属开销。
- 修法方向：要么删掉，要么改成真正的 fail-closed：不一致时抛 `CONTINUATION_AGENT_WRITE_REJECTED`。

**R4-10 [P3 待坐实] 首楼信封随任务寿命无界增长，每次读写都要深校验和克隆全量**
- 位置：`continuation-store.ts:1387-1405`（每次 read 都 structuredClone），`:1465`（每次写都全量 validate），orchestrator 的各处 `timeline: [...task.timeline, …]`
- 现象：timeline 每轮追加 2–3 条，所有阶段的全部 revision（含完整大纲）永久保留；一轮里有多次 `readPersisted` 和多次写入。长任务下单次操作的成本线性增长，总成本接近 O(n²)。量级取决于使用时长，没有实测。
- 修法方向：timeline 设上限或归档；已完成阶段只保留活动 revision。

**R4-11 [P3 已坐实] `replanRemaining` 在拿租约之前就登记了 AbortController，拿租约失败时这条登记残留在表里**
- 位置：`continuation-orchestrator.ts:1153-1155`（`finally` 在 `withLease_ACU` 的回调里面）
- 现象：`withLease_ACU` 抛 BUSY 时 controller 不会被删除。影响很小：下一次 invalidate 或 continue 会覆盖它。
- 修法方向：登记移到租约回调内部。

---

## 已确认无问题（供后续复审参考）
- 切聊天、停止、插话：租约 epoch、`getChatIdentity` 校验、AbortController 三者同时作废；所有写信封的地方都在 `updatePersistedAtomically` 内复核租约，没找到写进错误聊天的路径。
- 主循环有 `totalCallLimit = maxIterations + maxReads + 4`；子代理有 `maxCalls` 和 transportBudget；工作流的修复和终审受 `reviseLimit`（≥1）约束。没有无界循环。
- 模型 SQL 只经白名单解析成意图再参数化写入，不存在原样执行；`$FIELD` 的 id 拒绝 `__proto__` 等键；web 抓取有 SSRF 守卫（`agent-web-client.ts:263-275`、`:492+`）。
- 绿灯放行只接受账本里存在、且非 pending 的 uid（`buildAllowedFinalGreenlightKeySet_ACU`），模型输出无法放行账本以外的条目。

## 探针（scratchpad，已从 `source/tests` 删除）
- `r4-fieldwrite-invisible.probe.test.ts`（R4-01 / R4-02）
- `r4-repair-fieldwrite.probe.test.ts`（R4-03）
- `r4-takeover-restore-stuck.probe.test.ts`（R4-04；用例 1 用来排除「改注释」误报，用例 2 复现「删条目」卡死）
- `r4-repair-chronology-leak.probe.test.ts`（R4-05）
