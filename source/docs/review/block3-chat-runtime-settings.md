# 块 3 复审：service/chat + service/runtime + service/settings

> 只读复审。行号以当前工作区为准。「已坐实」= 跑过探针或读穿调用链；「待坐实」= 推演结论，修前必须先写红用例。
> 探针已移出仓库，存放于会话 scratchpad：`probe-r3-orm-whitelist.cjs`（node 直跑）、`zz-review-probe-r3-sql.test.ts`（放回 `tests/service/runtime/template-vars/` 运行）、`zz-review-probe-r3-chat.test.ts`（放回 `tests/service/chat/` 运行）。

## 覆盖范围

**通读**：chat-service.ts（全文）、chat-database-purge.ts、checkpoint-delete-guard.ts、material-checkpoint-sync.ts、state-manager.ts、template-vars/sql-query-var.ts、template-vars/read-only-sql-validation.ts、settings/api-preset-service.ts（120-626）、settings/settings-service.ts（1-120、260-1442）、settings/settings-write-service.ts（1-130）、helpers-remaining.ts 的 `handleChatCompletionReady_ACU`（204-289）。

**略读**：var-store-and-tags.ts（calc 求值段 150-300）、seed-condition.ts（1-200）、agent-read-only-template-render.ts（入口与 raw SQL 段）、helpers-table-lock.ts（存储键与保存点）、plot-runtime/plot-history-preset.ts（切聊守卫）、plot-tag-utils.ts（EJS 段）、plot-task-engine.ts（只看了模板变量调用点）。为确认调用链读了 table-write-transaction.ts 的锁实现、storage-frame-v2-persist.ts 2210-2380（无根写入守卫）、chat-gateway 两个保存函数、init.ts 的 CHAT_CHANGED 处理。

**未覆盖**：helpers-data-merge.ts、mvu-analysis-gate.ts、message-handler.ts、helpers-context-tags.ts、template-vars 的 name-mapper.ts / if-block-parser.ts / cell-utils.ts、plot-runtime 其余文件、settings-readers.ts、feature-preset-reference-service.ts、api-preset-staleness.ts、character-scope.ts。

## 总结

| 级别 | 数量 |
|---|---|
| P0 | 0 |
| P1 | 2 |
| P2 | 7 |
| P3 | 2 |

两条 P1 都在模板变量上，而且都能从**聊天正文**触发：`handleChatCompletionReady_ACU` 会对最终提示词里的每条消息（包括历史中的 AI 回复和用户消息）执行 `replaceDbSqlVariables`，而 `promptTemplateSettings.enabled` 默认是开着的。所以 AI 回复里只要出现一段 `{[sql ...]}` 或 `{[db....]}`，下一轮生成组装提示词时就会被执行。

---

## 发现

**R3-01 [P1 已坐实] 只读 SQL 校验可以用 `[...]` 方括号标识符绕过，模板文本能在 live SQLite 上执行 DELETE/UPDATE/DROP**
- 位置：`src/service/runtime/template-vars/read-only-sql-validation.ts:16-62`（`stripSqlCommentsAndStrings_ACU` 只把 `' " \`` 当作引号，不认 SQLite 的 `[...]` 标识符）；执行点 `src/data/sqlite/sqlite-engine.ts:202-212`（`query()` 用 `db.exec`，会执行多条语句）。
- 现象/触发路径：剥离器遇到 `[a']` 里的 `'` 时，会把它当成字符串开头，一路吞到下一个 `'`。于是它看不到中间的 `;` 和 `DELETE`，判定为 `{valid:true}`。SQLite 则把 `[a']` 当作普通标识符，`;` 之后的写语句照样执行。三条只读入口都受影响：`{[sql "…"]}`（sql-query-var.ts:881-899）、`<if sql="…">` / `sql:` 条件（1002-1023）、ORM 的多语句门（565-588，比如 `.value("1 AS [a'] FROM t;DELETE …;SELECT 1 AS [']")`）。Agent 提示词模板（agent-read-only-template-render.ts:237-244）用的也是同一个校验器。
- 入口：`helpers-remaining.ts:252-286` 在 CHAT_COMPLETION_SETTINGS_READY（init.ts:638 注册）时，对 `data.messages` 里每条消息执行 `replaceDbSqlVariables`。这意味着 AI 在正文里写出这段文本、用户粘贴、或世界书 / 剧情任务世界书（plot-task-engine.ts:672，含数据库生成条目）里带上它，都会在下一轮生成时把 live 表数据删掉。
- 证据：探针 `zz-review-probe-r3-sql.test.ts`（真实 sql.js 引擎和真实校验器）输出：
  `P1 validate {"valid":true}`
  `P2 out "x1y" inventory before 2 after 0`（`{[sql]}` 路径）
  `P3 out "" characters before 1 after 0`（ORM `value()` 路径）
  `P4 result true characters before 1 after 0`（`<if sql>` 路径）
- 后果：live 引擎里的行被删，界面和下一次导出看到的都是删后的状态；而操作日志里没有这次删除，冷回放会把行恢复。结果是运行时和持久化历史静默分叉。
- 修法方向：剥离器补上 `[...]` 标识符（与 SQLite 词法一致）。更根本的做法是只读路径不用 `exec`，改用 `prepare` 只编译首条语句，并要求剩余尾部为空（sql.js 的 `iterateStatements` 可以数出语句条数）。另外应在执行前确认语句只读。

**R3-02 [P1 已坐实] ORM 表达式的 JS 白名单可以用「计算属性 + 标签模板」绕过，任意提示词消息里的 `{[db....]}` 都能执行任意 JS**
- 位置：`src/service/runtime/template-vars/sql-query-var.ts:49-64`（`isSafeDbExpression_ACU`），执行点 837、985（`new Function('db', 'return ' + fullExpr)`）。
- 现象/触发路径：白名单只把 `'…'` 和 `"…"` 替换成占位符，不处理反引号模板字符串。参数括号 `\([^()]*\)` 里允许方括号和反引号，黑名单是按字面量匹配的。所以 `self[\`Func\`+\`tion\`]` 能拼出 `Function`，再用标签模板 `` ` `` 免括号调用；函数体里写 `globalThis`，就能避开对 `globalThis`、`fetch`、`document.` 等词的过滤。触发入口与 R3-01 相同：聊天历史里的 AI 回复也会经过 `evaluateOrmExpression` / `evaluateDbCondition`（`<if db>`、`db:` 条件）。
- 证据：`probe-r3-orm-whitelist.cjs` 逐字复制了白名单代码，输出：
  `payload: db.t.where(self[\`Func\`+\`tion\`]\`globalThis.PWNED=1\`\`\`)`
  `isSafeDbExpression_ACU = true` / `globalThis.PWNED = 1`。对照组直接写 `Function` 会被拦。
- 说明：剧情任务世界书在进入这里之前已经过宿主 EJS（plot-tag-utils.ts:18-40），那条路径本来就等同于可执行代码。但 `handleChatCompletionReady_ACU` 不经过 EJS，H2 白名单是那里唯一的防线，而这道防线被绕过了。威胁面是「AI 输出 / 被注入的文本 → 页面 JS」，在 Tauri webview 里还能进一步调用宿主能力。
- 修法方向：不要再用 `new Function` 执行用户文本，改为像 `agent-read-only-template-render.ts` 那样自己解析方法链（方法名白名单加字面量参数）。退一步，也至少要禁止反引号和 `[` 出现在参数里，并对 `\u` 转义做规范化后再匹配黑名单。

**R3-03 [P2 已坐实] `{[sql]}` / `<if sql>` 会把合法的只读 SELECT（`CASE … END`、`REPLACE(...)`）当作写语句拒绝**
- 位置：`read-only-sql-validation.ts:6-10, 70-73`（关键词表里有 `END`、`REPLACE`，按整词匹配）。
- 现象：`SELECT CASE WHEN quantity>0 THEN 'y' ELSE 'n' END FROM inventory` 和 `SELECT REPLACE(item_name,'剑','刀') FROM inventory` 都返回 `write_or_maintenance_statement`，模板渲染出空串。ORM 和 db.expr 路径已经专门避开了这个问题（sql-query-var.ts:36-45 的注释），raw 路径没有改；SQL 控制台用 `isReadOnlySqlStatement_ACU` 判断读写，也会把这类查询误判为写。
- 证据：探针输出 `P5 case {"valid":false,…}`、`P5 replace {"valid":false,…}`、`P5 render ""`。现有用例 `read-only-sql-validation.test.ts` 没有锁定这种拒绝行为。
- 修法方向：与 R3-01 一起改。用「单语句 + 首关键字 SELECT/WITH/EXPLAIN + CTE 内不出现 DML 首关键字」的语法判定，代替全文整词黑名单。

**R3-04 [P2 已坐实] 「删除当前标识数据」（mode=current）会连带删掉其他隔离标识的旧版顶层数据和 Identity**
- 位置：`src/service/chat/chat-service.ts:1961-1996`（`deleteLocalDataInChatCoreInner_ACU`）。
- 现象/触发路径：判断是否删除时，隔离关闭的分支只要消息上有任意 `TavernDB_ACU_Data/SummaryData/IndependentData/IsolatedData` 就会删（1971-1975），不看 `TavernDB_ACU_Identity`。隔离开启的分支只要当前 tag 有槽就会删。确定要删之后，顶层旧版字段和 Identity 会被无条件清除（1981-1996），并没有用同文件 239 行已有的 `isLegacyMatchForIsolation_ACU` 守卫。典型受害场景：用户以前开过隔离（旧版数据带 `Identity='tag_B'`），后来关掉隔离，在关闭状态下点「删除当前」，tag_B 的旧版表数据就被一起删了。
- 证据：探针 PA：`PA deleted 1 tag_B legacy data still there = false identity= undefined`；PA2（tag_A 有槽、同楼的顶层数据归 tag_B）：`still there = false`。现有用例只覆盖了 IsolatedData 槽隔离，没有覆盖顶层旧版字段。
- 修法方向：顶层旧版字段的删除改为由 `isLegacyMatchForIsolation_ACU(msg, isolationConfig)` 把关（与 `clearAllAiTableDataForCheckpointRestore_ACU` 同口径）。

**R3-05 [P2 已坐实] 保留层清理（purgeOldLayerData）删除其他标识的旧版 V1 顶层数据时不做孤儿检查，与当前标识「有孤儿即中止」的口径不一致**
- 位置：`chat-service.ts:1549-1557`（`collectAllSheetDataFromMessage_ACU` 只收集归属当前隔离配置的顶层旧版数据），`1366-1379`（孤儿检查），`1385-1424`（锚点前所有楼层整字段删除）。
- 现象：如果锚点前某楼的旧版顶层数据归属当前标识，而且之后没有保留楼层，清理会以 legacy-v1 为由中止，数据得以保留；归属其他标识（或隔离开关状态不同）的同类数据根本不进入检查，直接被删掉，是永久丢失。
- 证据：探针 PB 用 24 个 AI 楼、retain=3 的聊天，在第 1 楼放旧版顶层数据：`PB other-identity legacy kept = false | same-identity legacy kept = true`。
- 修法方向：孤儿检查对顶层旧版数据按它自己的 Identity 归组（用 Identity 推导 isoKey），不再只看当前配置。至少应在发现非当前标识的旧版顶层数据时也 fail-closed。

**R3-06 [P2 已坐实] 手动重填建立「模板临时根」后如果零提交回滚，聊天里会留下两个 full checkpoint，而回滚仍然报告成功**
- 位置：`chat-service.ts:2824-2925`（`establishManualRefillTemplateRoot_ACU`，根落在 `fallbackRootIndex`，也就是最早的 V2 帧，可能在重填范围之外）；`3138-3190`（`rollbackManualRefillRangeSnapshotAtomic_ACU` 只恢复清理句柄里那些楼层）；调用顺序见 `update-orchestrator.ts:5498-5533`。
- 现象/触发路径：重填范围覆盖了唯一的根（例如 periodic 或 compaction 根），根之前还留有 V2 帧（periodic 前滚不清理旧帧，retain=0 时也不会清理）。这时清理会删掉根，临时根被建在范围外更早的楼层。如果之后 AI 首次调用就失败（零提交），回滚会把范围内的原根恢复回来，但范围外的临时根不会被撤掉。
- 证据：探针 PC：`PC establish {"success":true,…,"targetMessageIndex":1}` → `PC rollback {"success":true,…}` → `PC full checkpoints at [1,3] invariant: … 存在 2 个 full checkpoint（#1(manual)、#3(periodic)）`。
- 后果：回放只认最后一个根，数据暂时还对；但单根不变量已经被破坏。之后手动重填的最终提交会报「存在多个整库 full checkpoint」，各写入门闸里的 `assertSingleActiveFullCheckpointV2_ACU` 也会 fail-closed，要等到下一次边界前滚降级旧根才能自愈。
- 修法方向：建立临时根时把根楼层的字段快照也并入回滚句柄（或者由 orchestrator 记下临时根，回滚时一并撤销）；回滚完成后再做一次单根断言，失败就如实返回 `success:false`。另外 `establishManualRefillTemplateRoot_ACU` 不在任何写事务内（2845 起直接读写 chat），建议也包进 exclusive 事务。

**R3-07 [P2 已坐实] 数据管理「按表删除」选中全部表并覆盖根楼层后，会留下没有根的空 V2 帧，后续所有填表写入都被拒绝**
- 位置：`chat-service.ts:2128-2139`（按表删除复用 `clearManualRefillSheetDataInRange_ACU`）；`chat-message-data-repo.ts:720-725`（checkpoint.data 里没有 sheet 时会删除整个 checkpoint）；拒绝点在 `storage-frame-v2-persist.ts:2346-2353`（`usesImplicitMigrationCheckpoint`）。
- 现象：执行后各楼留下 `{version:2, logEntries:[]}` 空信封，`resolveTableStorageStrategy_ACU` 判为 `v2`；由于没有 artifact，也走不到 `temporaryBaselineUpgrade` 升级，之后的普通写入一律报错，提示「请先执行 V2 恢复诊断」。整楼删除路径（1931 起）的注释明确写了必须回到「从未填表」状态、不能留下空 frame；手动重填路径则用 `establishManualRefillTemplateRoot_ACU` 做了补救。唯独按表删除两样都没有做。
- 证据：探针 PD：`frames [[0,true,true,null],[1,false,false,null],[2,true,true,null]] strategy {"mode":"v2"}`；chat[0] 和 chat[2] 都只剩 `{"version":2,"logEntries":[],"headRevision":null}`。
- 修法方向：按表删除提交前，如果检测到当前隔离键已经没有 full checkpoint，且帧里也没有 artifact，就把空信封一并删掉（回到 pristine 状态）；或者照手动重填的做法，用当前模板重建根。

**R3-08 [P2 已坐实（读码）] profile 模板一旦解析失败，会被默认模板直接覆盖，而且不做备份**
- 位置：`src/service/settings/settings-service.ts:928-973`（`loadTemplateFromStorage_ACU`）。
- 现象：`safeJsonParse_ACU` 失败（返回 null），或者格式不符合 `mate + sheet_*`（例如用户删光了所有表）时，会走到 958-973 行：`_set_TABLE_TEMPLATE_ACU(DEFAULT…)` 后执行 `writeProfileTemplateToStorage_ACU(code, …)`，把同一个键覆盖掉。设置项在同样的情形下有 H1 旁路备份（profile-repo.ts:58-68 的 `.bak`），模板没有，用户的自定义模板就此永久丢失。
- 修法方向：覆盖前先把原串备份到 `.bak`（复用 `backupProfileSettingsRawBeforeDegradation_ACU` 的写法）；对「合法但没有表」的模板不要当作损坏处理。

**R3-09 [P2 待坐实] 维护类事务不复核聊天归属；删楼守卫会用旧聊天的消息引用加上新聊天的 chatKey 重建保管库**
- 位置：`src/service/table/table-write-transaction.ts:425-430`（锁按调用时刻的 `currentChatFileIdentifier_ACU` 取键）；`chat-service.ts` 中各维护函数都在拿到锁之后才 `getChatArray_ACU()`，但不比对聊天身份（只有 `chat-database-purge.ts:427/478` 做了这件事）；`checkpoint-delete-guard.ts:375, 417, 580-581`。
- 现象/触发路径：删楼恢复在 375 行锁外就取了 `chat`，然后等待 exclusive 锁（例如有填表正持有 shared 锁）。等待期间如果切换了聊天，任务恢复执行后会把产物嫁接进旧数组；580 行保存的是**当前宿主聊天**；581 行 `captureCheckpointVaultForCurrentChat_ACU(chat)` 则用旧数组的消息引用加上新的 `currentChatFileIdentifier_ACU` 写入 vault，覆盖掉 post-save 监听刚刚正确捕获的结果。此后如果新聊天在插件下一次保存之前发生删楼，`recoverLost…` 会把 vault 里所有旧聊天产物都判为「被删」，嫁接进新聊天并严格保存，造成跨聊天污染。`deleteLocalDataInChatCore_ACU` 等函数在锁等待跨越切聊时，也会在新聊天上执行用户在旧聊天里确认过的删除。
- 证据：调用链已读穿；未做并发探针。
- 修法方向：维护类事务在进入时记录 `getActiveChatStorageIdentity_ACU`，拿到锁后复核（照 purge 的写法）；删楼守卫的 581 行改为不传 `chat`，或在 chatKey 与数组身份不一致时跳过。

**R3-10 [P3 已坐实] 死代码：四个导出只有测试在调用，其中一个与自身文档相矛盾**
- `clearTableDataAtFloors_ACU`（chat-service.ts:2266-2335）、`clearManualRefillIncrementalDataInRange_ACU`（2337-2443）、`replaceManualRefillSheetBaselineInRangeAtomic_ACU`（2928-3025）、`saveCurrentDataForTable_ACU`（1231-1284，只在 update-process.ts:30 被 re-export，没有调用方）。
- `clearTableDataAtFloors_ACU` 的按表分支走 `purgeTargetSheetKeysFromMessage_ACU` → `purgeSheetKeysFromMessage_ACU`（3192），后者会删**所有隔离槽**里的同名表（chat-message-data-repo.ts:1236-1278），与函数注释「不影响同一消息上其他隔离标签的数据」相反。目前没有调用方，但一旦被接线就会造成跨标识删除。建议直接删除这几组函数和对应用例。

**R3-11 [P3] 小项**
- `deleteLocalDataInChatCoreInner_ACU` 先用非严格的 `saveChatToHost_ACU`（宿主 `saveChat` 缺失时只告警就返回），再删除外置向量文件（chat-service.ts:2066-2069），与注释「保存失败不删、宁可泄漏」不一致。应改用 `saveChatToHostStrict_ACU`。
- `establishManualRefillTemplateRoot_ACU` 的注释写的是「strict save 成功后才 apply」，实际先 apply 后保存（2915-2916）；失败分支能原位恢复，所以无实害，但注释失真。
- 每次手动重填清理、提交、建根，以及每次删楼恢复，都会把整个聊天（含正文）JSON 深克隆一次（`cloneCandidateChat_ACU` 2529、checkpoint-delete-guard.ts:417）。属于 R2B-09 同类问题，长聊天下有明显开销。
- 表格锁 `tableUpdateLocks` 按 `chatKey::isolationKey` 存在 profile 设置里（helpers-table-lock.ts:32-46），删聊天后不回收，profile 负载会随聊天数单调增长。
