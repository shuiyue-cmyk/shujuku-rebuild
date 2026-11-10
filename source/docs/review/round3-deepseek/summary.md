# DeepSeek 填表专项复审总报告

## 概览

- 基线：HEAD `02f7d5dc`（`git rev-parse --short HEAD`）。
- 范围：UnbirthDB 填表全流程——触发与调度、AI 请求与回复解析、写入与提交、存盘与回放、收尾副作用，以及相关界面；重点是填表进行到一半时删最新楼层（A）、删除当前聊天（B）、不关闭聊天直接新开聊天（C）。
- 发现阶段：D01 P1×1/P2×3；D02 P0×1/P1×1/P2×4/P3×1；D03 P0×2/P1×1/P2×1/P3×3；D04 P2×2/P3×2；D05 P1×5/P2×1/P3×2；D06 P1×2/P2×2/P3×1；D07 跨组专项 P1×1/P2×3/P3×1。合计原报 P0×3、P1×11、P2×16、P3×10（共 40 条）。
- 复核后：成立 24 条，降级成立 3 条，不成立 3 条，需真机 10 条（共 40 条结论）。按根因合并后总表 26 条（D05-06 合并 D06-02），需真机按根因合并为 7 组。
- 各组完成情况：
  - D01：完成。声明没读透：`helpers-context-tags.ts`、`service/runtime/template-vars/` 只读填表相关入口；`chat-service.ts` 的正文优化/导入导出/兼容迁移未逐行；宿主事件顺序无真机。
  - D02：完成。声明没读透：宿主 `getCurrentChatId()`/`saveChat()`/`message_id` 规则；SQLite provider 与 V2 持久化内部只读到关键段；向量归档内部只用于跨组判断。
  - D03：完成。声明没读透：宿主删除聊天后的 `saveChat()` 行为与事件顺序；`useFormFill*` 世界书写入链只抽读；provisional bridge 完整状态机只核对调用点。
  - D04：完成。声明没读透：`sql-table-service.ts` 的 load/hydrate/schema 冻结全段；`prompt-prepare.ts` 世界书候选作用域内部；宿主删除聊天事件顺序。
  - D05：完成。声明没读透：`storage-frame-v2-persist.ts` 自愈/恢复/模板协调只抽读；向量归档 runner 内部；宿主真实删除/切聊时序。
  - D06：完成。声明没读透：宿主 `CHAT_DELETED`/`CHAT_CHANGED` 先后与 `saveChat()` 时长、`GROUP_CHAT_DELETED` payload 形状；`injection-engine-custom.ts` 只抽读切聊相关段。
  - D07：完成跨组线索专项；5 条发现经 V07 复核：成立 3、不成立 1、需真机 1。
- 重点覆盖：A 由 D01/D02/D03/D04/D05/D06/D07 查过；B 由 D01/D02/D03/D04（部分）/D05/D06/D07 查过；C 由全部组查过。没有无人查过的重点。
- 复核方式：**独立子代理**。每份分组报告（D01–D07）各派一个新的冷启动子代理，原样附共同规则与第五节全文；P0/P1 建独立探针，P2/P3 读代码判定；复核报告为 `.analysis-deepseek-verify-D01.md` … `.analysis-deepseek-verify-D07.md`。协调者只做合并、去重与 P0/P1 行号/引文抽查。

## 总表（复核成立，按严重度从高到低）

> 级别以复核结论为准；D07 的 5 条已由 V07 独立复核（成立 3、不成立 1、需真机 1）。

| 编号 | 级别 | 重点 | 不变量 | 标题 | 位置 | 复核依据（探针 / 读穿调用链） | 备注（重复 / 降级 / 抽查结果） |
|---|---|---|---|---|---|---|---|
| D03-01 | P0 | B/C | I1、I6 | 手动重填零提交回滚按当前聊天执行：旧聊天的清理永不回滚；新聊天楼层指纹相同时会被写入旧快照 | `source/src/service/table/update-orchestrator.ts:5267-5292`、`:5297-5321`；`source/src/service/chat/chat-service.ts:2885-2888`、`:2931-2989`；`source/src/service/table/table-write-transaction.ts:438-449` | V03 真实回滚探针 2/2：B 收到 A 的清理前快照，A 仍保持清理态；显式指纹不同时 B 跳过、A 也不恢复 | 抽查行号与引文一致。与 D07-03 同族但写点不同（本条是零提交回滚，D07-03 是清理 apply/失败恢复） |
| D01-01 | P1 | A/C | I1、I3、I6 | 保留层清理在 boundary checkpoint 存盘期间不复核聊天/楼层，按旧下标删掉新聊天或幸存楼层的表数据 | `source/src/service/chat/chat-service.ts:1291-1325`、`:1396-1428`；`source/src/service/table/update-scheduler.ts:456-458` | V01 真实事务探针：新聊天 `#0` 的 `TavernDB_ACU_IsolatedData` 被删并 strict save；`#1` 保留 | 抽查一致。复核者指出若新聊天 `#0` 是唯一 full checkpoint，按 2.9 可判 P0；本次按复核结论保留 P1，修法应按 P0 防护 |
| D02-01 | P1 | C | I1 | 自动填表计划没有 run 级聊天身份：切聊天后旧计划的后续组/批仍按旧 indices 继续，可写到新聊天或另一个已有聊天 | `source/src/service/table/update-scheduler.ts:372-414`；`source/src/service/table/update-orchestrator.ts:3985`、`:4000-4002`、`:4042-4047`、`:3381`、`:615-620`；`source/src/service/table/table-fill-target-guard.ts:77-82` | V02 真实 `processUpdatesBatch` + `persist` 探针：旧下标 0/2 落到新聊天开场白/已有 AI 楼，`saved:true` | 原 P0 降为 P1：新聊天只有开场白时旧下标大于 0 多在 `loadBatchBaseData` 越界抛错；可复现路径是旧首楼为 0 或切到已有长聊天。抽查一致 |
| D05-04 | P1 | A | I3、I6 | 存盘合并把删楼守卫保管库捕获推迟到整轮结束：窗口内删掉承载新 checkpoint 的楼层，前移恢复拿不到产物，幸存楼层的填表数据丢失 | `source/src/data/gateways/chat-gateway.ts:145-148`、`:212-223`；`source/src/service/chat/checkpoint-delete-guard.ts:279-285`、`:399-416` | V05 真实保管库探针 2/2：窗口内写 full checkpoint 后删楼，`recovered:false`；对照删楼前再捕获则 `recovered:true` | 抽查一致。26e453e6 与删楼守卫 S0-4 的交互 |
| D05-05 | P1 | 其他 | I1 | 提交作用域守卫对未传 `chatKey` 的调用方恒通过：外部 CRUD/SQL、模板覆盖、追平终态、runtime-only 写回可能落到新聊天 | `source/src/service/table/table-update-commit.ts:302-324`；`source/src/presentation-v2/composables/useSqlConsole.ts:197-212`；`source/src/presentation/bootstrap/api-groups/sql-api.ts:558-574`；`table-crud-api.ts:613-634`；`source/src/service/chat/chat-service.ts:2297-2315`；`source/src/service/table/update-orchestrator.ts:4736-4755`；`runtime-only-pending-flush.ts:174-193` | V05 真实 `runTableUpdateCommit` + 真实 persist 探针：缺省 `chatKey` 时旧表落到 B；显式传 `chatKey:'chat-a'` 时 `precondition` 拒绝 | 抽查一致。G04-01 修复不完整 |
| D06-01 | P1 | B/C | I1 | 手动重填收尾的向量“剩余行发布”不带来源聊天身份：切到同内容聊天后，旧聊天的 summary 行会发布进新聊天的向量镜像 | `source/src/service/table/update-orchestrator.ts:5656`、`:5714`、`:5759`；`source/src/service/vector/summary-vector-mirror-rebuild.ts:144-154`、`:238-268` | V06 真实发布探针：manifest 以 `chatKey:'chat-B'` 上传，B 的镜像指向 A 的 manifest，`rowCount=1` | 抽查一致。触发需 B 为 A 的分支/复制，或 full checkpoint 内容指纹相同；全新空聊天会在 `unsupported_replay_base` 早退 |
| D07-01 | P1 | 其他 | I5 | SQL 模式取第一个 `<tableEdit>`，绕过“仅识别最后一对”：草稿 SQL 会被执行；首块为空时整轮以基础设施错误失败且不重试 | `source/src/service/table/update-orchestrator.ts:1651`；`source/src/service/ai/prompt-builder/table-edit-parser.ts:55-75`、`:154-158`；`source/src/presentation-v3/pages/TablePage.vue:91` | V07 探针 3/3：解析器取最后一对、collect 取第一块、live SQL 执行器收到第一块；空首块走 JSON 分支抛 `infrastructure` | 抽查一致。`92c558d2` 把旧 last-pair 改成 first-match，属回归；触发需模型输出两块且首块为合法 SQL |
| D01-02 | P2 | C | I4、I6 | 旧聊天的 `CHAT_CHANGED` 处理器晚排程时，代次守卫会把新聊天的唯一重建链一起取消，新聊天表格空白、自动填表报 `runtime_not_ready` | `source/src/presentation/bootstrap/init.ts:177-221`、`:578-587`；`source/src/service/runtime/plot-runtime/plot-history-preset.ts:64-84`；`source/src/service/table/update-scheduler.ts:242-244` | V01 探针 2/2：A 的 `loadPreset` 挂起、B 先排程、A 晚排程后 B 的 `loadMessages`/`refresh` 均未调用；对照组 B 会调用 | 抽查一致。需 A 的慢 await 在 B 排程后 1200ms 内返回 |
| D01-04 | P2 | C | I4 | 配对歧义的 60s 隔离不随切聊天复位：新聊天的 `GENERATION_ENDED` 仍被判 ambiguous，首条回复不立即填表 | `source/src/service/runtime/state-manager.ts:107`、`:317-323`、`:341-349`、`:370-372`；`source/src/service/worldbook/injection-engine-state.ts:175-182`；`source/src/presentation/bootstrap/init.ts:944-950` | V01 探针：按 `resetScriptStateForNewChat` 清空上下文后，新聊天唯一 normal 上下文仍返回 ambiguous | 抽查一致。复核更正：漏掉的楼层会在下一次自动填表按历史缺口补跑，不是永久丢失；隔离 60s 内新聊天所有 ENDED 都会被拦 |
| D02-03 | P2 | A | I3 | 删楼后尚未开始的后续组/批不重新校验计划下标：目标守卫在删楼后才拍快照，挡不住位移，可错写到位移后的 AI 楼 | `source/src/service/table/update-scheduler.ts:381-386`；`source/src/service/table/update-orchestrator.ts:3985`、`:4000-4002`、`:4042-4047`、`:4074-4086`、`:3381`、`:615-620`；`source/src/service/table/table-fill-target-guard.ts:72-82`；`source/src/presentation/bootstrap/init.ts:1290-1310` | V02 探针：group_a 目标 4、group_b 目标 6，删掉第 5 楼后 group_b 仍写第 6 楼（原第 7 楼旁白），`failedGroups===0` | 抽查一致。只在删楼发生在后续组 AI 请求开始前、且旧下标落在 AI 楼时发生 |
| D02-05 | P2 | 其他 | I5 | 自动填表按调度签名分组、不按表级 API 预设分组：同组多表只用第一张表的 preset，第二张表的配置被静默忽略 | `source/src/service/table/update-scheduler.ts:157`、`:164-184`、`:381-386`；`source/src/service/table/update-orchestrator.ts:4063-4071`、`:2810-2815` | 读穿调用链 + grep 四个 preset 解析点：自动路径两处都取 `sheetKeys[0]`，手动/追平逐个表处理 | 抽查一致。手动路径 `:5434-5441` 明确按 preset 拆组，自动路径行为分叉 |
| D03-02 | P2 | C | I1 | 一键追平终态 `manualRefillProgress` 写入不绑定 chatKey：切到另一个聊天后旧计划进度可能落到新聊天，并被存储策略当成数据证据 | `source/src/service/table/update-orchestrator.ts:4650-4659`、`:4721-4759`、`:4822`、`:4867`、`:4898`、`:4985`、`:5055`、`:5082`、`:5118`；`source/src/service/table/table-update-commit.ts:313-323` | V03 聚焦探针 2/2：缺省 `chatKey` 时终态提交被接受并写 `manualRefillProgress`；显式传原 chatKey 被拒 | 原 P1 降为 P2：需切换发生在验证/刷新收尾窗口、新聊天已载入 runtime、旧目标下标是 AI 楼且有 full/transition 锚点；只写进度元数据，不覆盖表数据 |
| D03-04 | P2 | C | I1、I3 | 手动重填最后一个 chunk 后的 `loadAllChatMessages` 窗口切聊天：最终单表 checkpoint 按新聊天提交，套用旧范围/旧模板 | `source/src/service/table/update-orchestrator.ts:5998`、`:6025-6048`；`source/src/service/chat/chat-service.ts:2519-2526`、`:2532-2545` | 读穿调用链：最后一次 `executionSnapshot` 在 `:5867-5881`，之后无复核；最终提交只带 `guardChatSwitch`、不带 `chatKey` | 抽查一致。窗口窄；若新聊天 runtime 未载入，常见分支是返回 null 并失败，不会写 B，但 A 的最终 checkpoint 缺失 |
| D04-01 | P2 | 其他 | I3 | AI 的 SQL 可以 `UPDATE ... SET row_id=...`：行锁补偿把被改号的行整行插回，表格出现重复行；无锁时 row_id 被静默改写 | `source/src/service/table/sql-table-service.ts:1052-1070`、`:1170-1234`；`source/src/service/table/table-lock-enforcement.ts:114-124`、`:183-194`；`source/src/service/table/table-update-commit.ts:163-194` | V04 探针 4/4：快照/live 路径均出现 `[["row_id"...],["1","铁剑","3"],["2","铁剑","99"]]` | 抽查一致。触发需模型写出 `UPDATE ... SET row_id`；默认提示词只禁止 INSERT 带 row_id。有 UNIQUE 约束时可能整批 fail-closed |
| D04-02 | P2 | C/B | I4 | 切聊天/删聊天发生在提示词准备窗口时不会中止旧轮：旧请求照发，`prepareAIInput` 读到新聊天的世界书/角色/`<if>` 数据，新聊天填表被压后 | `source/src/service/ai/prompt-builder/prompt-api-call.ts:83-89`；`prompt-prepare.ts:450-472`、`:481-503`、`:554`；`prompt-api-call.ts:128-144`、`:237-248`；`source/src/service/runtime/state-manager.ts:613-643`；`source/src/presentation/bootstrap/init.ts:546` | V04 探针：`prepare` 等待世界书快照时调用真实 `abortOnChatMutation`，控制器未中止，且随后读到 `NEW_WORLDBOOK` | 抽查一致。提交层 chatKey/targetGuard 会拒绝落盘，故不判 I1；C 场景角色不变时混合内容影响较小，B 场景更明显 |
| D05-06 | P2 | 其他/C | I1、I5 | 提交在宿主存盘期间切聊天：persist 成功后不复核聊天，把旧表写回新聊天运行时；世界书刷新可能进一步把旧表写进新聊天世界书（D06-02） | `source/src/service/table/table-update-commit.ts:444`、`:475-481`；`source/src/service/table/storage-frame-v2-persist.ts:2817-2822`；`source/src/service/table/update-orchestrator.ts:364-372`；`source/src/service/worldbook/pipeline.ts:120-139`、`:237-247` | V05 探针：strict 存盘 resolve 前切到 B，提交仍成功且 `_set_currentJsonTableData_ACU` 收到 A 的旧表；V06 探针复现同一写回 | **合并 D05-06 + D06-02（D06-02 由 P1 降为 P2）**。D06-02 的世界书污染取决于宿主 `saveChat` 超过 1.2s，需真机；运行时污染已坐实 |
| D07-03 | P2 | B/C | I1、I3 | 手动重填清理/失败恢复按下标写 live chat：strict save 失败会把旧楼层/旧聊天快照写进别的楼层或新聊天；摘要向量快照后进入清理也缺聊天复检 | `source/src/service/chat/chat-service.ts:2849-2875`、`:2892-2897`；`source/src/service/table/update-orchestrator.ts:5650-5663`、`:5758-5764` | V07 探针 2/2：删楼后快照写错楼层；切聊天后旧快照写进新聊天 | 抽查一致。与 D03-01 同族但写点更早；变体 2 需在 `:5759` 复检前又切回 A 才不自愈 |
| D02-07 | P3 | 其他 | I5 | `contextDepth` 的“AI prompt 上下文窗口”只剩一个死变量：设置值与提示词窗口脱钩 | `source/src/service/table/update-scheduler.ts:125`、`:135-138`；`source/src/service/table/update-orchestrator.ts:4042-4047` | 读码 + grep：`contextScopeIndices` 只在日志使用，提示词上下文是本批切片 | 抽查一致。`threshold > 0` 仍决定是否参与自动更新，数值大小不再影响提示词窗口 |
| D03-05 | P3 | 其他 | I5 | 零提交失败提示重复拼接“已回滚清理” | `source/src/service/table/update-orchestrator.ts:5278`、`:5316`；`source/src/presentation-v2/composables/useManualUpdate.ts:563`、`:576` | 读码：编排层拼进 `error`，UI 失败分支再追加一次 | 抽查一致 |
| D03-06 | P3 | 其他 | — | `establishProvisionalBridge_ACU` 已无生产调用方，旧临时根建立路径与 staging 新路径分叉 | `source/src/service/table/manual-catch-up-provisional-bridge.ts:489`；`source/src/service/table/update-orchestrator.ts:4496-4559` | grep 全仓：生产代码零调用，仅 legacy 集成测试调用 | 抽查一致。恢复路径仍在用，不能整模块删除 |
| D03-07 | P3 | 其他 | — | 26e453e6 的存盘合并优化对一键追平不生效：bucket 因 `replaceExistingIncremental:true` 仍逐个 strict save | `source/src/service/table/update-orchestrator.ts:4916-4922`、`:2983-2988`、`:4800`、`:5131`；`source/src/service/table/storage-frame-v2-persist.ts:2816-2820` | 读码：replacement 非空即 strict；测试 mock 绕过了真实 persist | 抽查一致。性能/测试口径问题，不是数据缺陷 |
| D04-03 | P3 | 其他 | I5 | 原生工具模式正文 `<tableEdit>` 遇到 `table_sql({"sql":""})` 会被静默丢弃，并按零操作成功提交 | `source/src/service/ai/prompt-builder/table-fill-tools.ts:119-143`；`prompt-api-call.ts:274-289`；`table-edit-parser.ts:137-152`；`update-orchestrator.ts:2274-2289` | V04 纯函数探针 2/2：返回 `"<tableEdit>\n\n</tableEdit>"`，正文 SQL 消失；非空工具 SQL 对照正常 | 抽查一致。触发需可选工具模式（默认关闭）+ 模型自相矛盾输出 |
| D04-04 | P3 | 其他 | — | `isImportMode` 是死参数，`parseAndApplyTableEdits_ACU` 运行时零调用 | `source/src/service/ai/prompt-builder/table-edit-parser.ts:129`、`:623-628`；调用方 `update-orchestrator.ts:2263`、`:3701`、`table-fill-staging-session.ts:126` | grep 全仓：函数体不引用参数；`parseAndApplyTableEdits_ACU` 仅 re-export/测试使用 | 抽查一致。`parseAndApplyTableEditsToData_ACU` 仍是生产入口，不要一起删 |
| D05-07 | P3 | 其他 | I6、I1 | in-flight 回放去重 key 只用 chat 数组对象身份；TT 切聊天复用同一数组，注释声称的跨聊隔离不成立 | `source/src/service/table/storage-frame-v2-replay.ts:60-109`、`:2963-3000` | 读码：key 只有 WeakMap 令牌/isolation/maxIndex/模板指纹；同数组换内容不失效 | 抽查一致。只有 schema 迁移 `crypto.subtle.digest` 让出时窗口可达 |
| D05-08 | P3 | 其他 | I4 | runtime-only 待落盘登记从不随聊天切换/删除清理 | `source/src/service/table/runtime-only-pending-state.ts:44-51`、`:83-105`、`:122-129` | 读码 + grep：生产代码只有按表条件化清除，没有按 scope 清空 | 抽查一致。最坏多一次写回，不直接损坏数据 |
| D07-05 | P3 | 其他 | I5 | legacy 手动填表确认文案仍承诺“执行失败或终止时回滚到操作前”，实际只有零提交才回滚 | `source/src/presentation/triggers/update-process.ts:360`；`source/src/presentation/bootstrap/api-groups/settings-config-api.ts:132-139`；`source/src/service/table/update-orchestrator.ts:5267-5270`；`source/src/presentation-v2/composables/useManualUpdate.ts:510` | V07 读码：确认框文案与 `rollbackRefillCleanupOnZeroCommit` 的零提交条件矛盾 | 抽查一致。legacy API 仍可由第三方脚本/控制台到达 |

## 需真机确认

> 以下条目的代码侧缺口已由复核者读穿，但“是否真的写坏/写回”取决于 TT 2.4.0 的 `CHAT_DELETED`/`CHAT_CHANGED` 先后、`getCurrentChatId()` 过渡态、`saveChat()` 对已删除文件的行为。步骤从复核报告原样摘录。

### 1. 删除当前聊天后，我方存盘把已删除的聊天文件重新写出（D01-03 P2、D02-02 P1、D03-03 P0、D05-01 P1）
- 疑点：`CHAT_DELETED` 只安排 5 秒后的向量清理，不 abort 在途填表、不清存盘合并、不设“已删除”墓碑；strict/coalesced 存盘只按当前聊天 id 归属。
- 验证步骤：
  1. 选一个有多条 AI 回复的聊天，点一次「重新填表」或等自动填表，确认界面出现「正在填表」。
  2. 填表还没结束时，打开左侧聊天管理，删除当前这个聊天。等 10 秒，再打开同一角色卡。
  3. 正常：被删聊天不在列表里；回到角色卡看到的是新聊天或空聊天，旧表格数据没有回来。
  4. 有问题：聊天列表里又出现同名聊天，或点进去还能看到删除前最后几楼的表格数据；按 F12 打开控制台，搜索 `ChatGateway`、`删楼守卫`、`saveChat`，若看到删除后仍有保存/补存日志，记录时间点。

### 2. 删除当前聊天时“旧 id + 空数组”窗口把文件重建为空聊天（D05-02 P1）
- 疑点：`keepChatSaveDirtyIfSameChat_ACU` 只看宿主当前聊天 id；删除流程清空 `chat` 数组后、换 id 前，120s 兜底/pagehide/收尾补存会以旧文件名写空数组。
- 验证步骤：
  1. 打开一个聊天，触发自动填表/手动填表，确认「正在填表」。
  2. 填表进行中，在聊天管理里删除当前聊天。删除确认后立刻观察聊天列表（不要等填表结束）。
  3. 正常：被删聊天彻底消失；随后打开的新聊天没有旧表格，也没有空白的同名聊天。
  4. 有问题：列表里重新出现同名聊天，点进去是 0 条消息/只有文件头；或随后打开的另一聊天消息变少/变空。按 F12 搜 `存盘合并`、`补存`、`ChatGateway`，看删除后是否还有“补存”日志。

### 3. 宿主读不到聊天 id（空串/回退 `this_chid`）时补存覆盖另一个已有聊天（D05-03 P1）
- 疑点：`getCurrentChatId()` 返回空串时 `??` 不会回退；`this_chid` 只区分角色，不区分同一角色的两个聊天；空数组窗口会把 B 写成 `[]`。
- 验证步骤：
  1. 同一角色准备两个已有聊天 A、B，B 里有多条消息。打开 A，触发填表。
  2. 填表进行中按 F12，在控制台依次输入 `SillyTavern.getContext().getCurrentChatId` 和 `SillyTavern.getContext().chatId`，回车看返回值；记下是否为 `undefined`/空串。
  3. 立刻切到同角色的 B（不要等填表结束）。等 5 秒，检查 B 的消息列表。
  4. 正常：B 的楼层数量不变，表格数据正常。
  5. 有问题：B 变空/少楼；控制台搜 `存盘合并`，若出现「补存」且 B 被写成 `[]`，即为本条。若第 2 步两个值都正常，则 `this_chid` 回退路径不成立，只需观察空串窗口。

### 4. 自动填表成功后切聊天，旧楼 messageId 登记到新聊天，压掉新聊天首条回复（D02-04 P2）
- 疑点：`recordAutoTableFillProcessedForFloor_ACU` 在收尾时才取当前 chatKey；新聊天同号 messageId 会被判成回声，直接 `duplicate_auto_fill_ended`。
- 验证步骤：
  1. 用同一角色开一个**短**聊天 A：只有开场白加一次“用户发言 + AI 回复”，让最新 AI 楼是第 2 楼（记下界面显示第几条）。
  2. 确认这条回复自动填表成功（表格页出现该楼数据；F12 搜 `已登记第` 能看到完成记录）。
  3. 在填表刚完成、界面还在刷新时，点「开始新聊天」；新聊天打开后只发一条消息，等 AI 回复出来。
  4. 正常：新回复几秒内出现「正在填表」并更新表格。有问题：F12 出现 `duplicate_auto_fill_ended`，且提示楼号/消息 id 与新回复一致。

### 5. 删除刚填过表的聊天后，最新向量文件/清单未被清理（D06-03 P2）
- 疑点：`cleanupSummaryVectorIndexForDeletedChat_ACU` 在目标等于当前聊天时直接跳过；Safe GC 的 10 分钟 grace 会保留最新 pack/manifest；清理只发一次、无重试。
- 验证步骤：
  1. 打开一个已开启“交火纪要向量索引”、且最近 10 分钟内刚自动填过表的角色聊天。
  2. 点右上角聊天管理 → 删除当前聊天（不要先关闭聊天）；宿主会自动打开或新建另一个聊天。
  3. 等 10 秒，按 F12 打开 Console，搜索 `[交火向量索引] 聊天删除清理`。正常应看到 `聊天删除清理完成` 且 `deletedFiles` 大于 0；如果看到 `target_is_current_chat`、`same_name_chat_alive` 或 `deletedFiles=0`，说明本次没有清掉最新文件。
  4. 再等 10 分钟（不要重启），在向量索引页查看外置文件统计，或到酒馆 user/files 目录看 `TavernDB_ACU_vector_v2pack_*` / `..._v2manifest_*`。正常应在下一次启动后的孤儿清扫中消失；如果重启后等 60 秒仍在、且 Console 出现 `throttled` 或没有清扫日志，就是 I2 违规。

### 6. 跨角色同名聊天切换时，旧聊天数据写进新角色世界书（D06-04 P2）
- 疑点：`currentChatFileIdentifier_ACU` 只等于 `cleanChatName(chatFileName)`，不含角色作用域；`chatStillCurrent` 只比字符串，跨角色同名无法识别。
- 验证步骤：
  1. 准备两个角色 A、B，在聊天管理里把各自的聊天文件都重命名为同一个名字（例如 `Chat`）。
  2. 在 A 里触发一次会刷新世界书的填表（手动填表或等自动填表）；当界面提示正在填表/正在刷新世界书时，立刻从宿主聊天列表切到 B 的同名聊天。
  3. 打开 B 的角色绑定世界书或注入目标书，看是否出现 A 的表内容（`TavernDB-ACU-ReadableDataTable`、纪要/总结/人物条目）；按 F12 在 Console 搜索 `[Worldbook]`，看是否有写入 B 书的记录。
  4. 正常：B 的书保持 B 自己的内容，或只被 B 的数据刷新；异常：A 的表/条目出现在 B 的书里，或 B 的 `knownCustomEntryNames` 被写成 A 的条目名。
  5. 窗口很窄（在 `await getInjectionTargetLorebook_ACU()` 附近，通常几十毫秒），一次没复现可重复 2–3 次；如果始终无法复现，至少说明该路径在真机上难以触发，但不能据此判定代码无缺陷。

### 7. 旧聊天的手动/追平轮持有全局“正在填表”标志时，新聊天首条回复被跳过（D07-02 P2）
- 疑点：`isAutoUpdatingCard_ACU` 没有聊天归属；自动入口遇到 `update_in_flight` 直接 return，只有自动 trigger 在飞才登记 pending；手动/追平持锁时没有补跑。
- 验证步骤：
  1. 在聊天 A 里选一张表点「手动填表」（或「一键追平」），确认后让进度框保持显示；如果 A 的填表几秒就结束，本条不会触发，需要让 A 的请求变慢（用很慢的模型/网络，或选范围很大的表）。
  2. 在 A 的进度框还在时，切到聊天 B（同一个角色新开聊天或另一个聊天），在 B 里发一条消息，等 AI 回复完整出现。
  3. 回复出来后看 B 的表格页：正常情况下，最新一楼应在几秒内自动填上（表格出现这一楼的新行/新字段）；有问题的表现是**这一楼一直不填**，要等你在 B 再发一条消息、下一轮回复结束才补上。
  4. 按 F12 打开控制台，搜索 `preconditions_failed` 或 `update_in_flight`：如果 B 的回复结束时出现这条日志，而且之后没有自动补跑，就坐实本条。
  5. 正常/异常判定：B 的回复结束后表格自动更新 = 正常；只有再发一条消息才补上 = 异常。若 A 的填表在 B 回复前已结束，则本次不算触发，需要重试并让 A 的请求更慢。

## 复核判为不成立的条目

| 编号 | 原级别 | 不成立的理由（一句话） |
|---|---|---|
| D02-06 | P2 | 第二轮 G03 已逐字评估同一条链并明确按“纯提示措辞、不改数据”不单列；后续组的收尾是终止后的正常清理，没有新数据后果，属于已有结论，不应重报。 |
| D06-05 | P3 | 回调数据始终是“通知时刻的当前运行时快照”，不是旧轮结果；自动填表被切聊中止后通知的是 B 的当前表，第三方刷新不会把 A 的数据同步出去；唯一会把 A 旧表推给回调的是 D05-06/D06-02 的写回，已在那条计数。 |
| D07-04 | P2 | 同一 staging run 内后续 bucket 的失败并非共用 controller 造成：当前 bucket 失败后 `update-orchestrator.ts:3053-3059` 的 `!bucketSucceeded` 已 break，`executeAutoFillStagingGroups_ACU` 的 fail-fast 也会终止后续；共用 controller 只改变 break 原因，不改变结果。 |

## 协调者存疑

1. **D01-01 的级别**：复核结论为 P1，但复核者明确指出“新聊天 `#0` 的整楼本地表数据被删并落盘；若该楼是唯一 full checkpoint，按 2.9 应算 P0；若该楼带交火向量 manifest，外置向量也会被 GC”。我保留 P1 以尊重复核结论，但建议按 P0 级防护修复，并在真机上确认是否已造成不可恢复的数据丢失。
2. **D05-06/D06-02 的级别**：合并后按 P2 记录。D06-02 的“旧表写进新聊天世界书”后半段依赖宿主 `saveChat` 超过 1.2s，复核者因此降级；如果真机确认大聊天存盘经常超过 1.2s，这条应按 P1 处理。
3. **D02-01 的触发面**：复核者把“新开聊天”收窄为“旧首楼为 0 或切到已有长聊天”，但仍确认可真实落盘。协调者认为“切到另一个已有聊天”同样违反 I1，修复时不应只覆盖新开聊天。
4. **D07-04 的跨 staging chunk 残余**：复核判 D07-04 原文（同一次 run 内后续 bucket）不成立，但复核者在补充里给出另一条真实路径——`autoGroupedAbortController` 在 `settings-ui-trigger.ts:244` 创建后跨多个 `processStagingGroupedUpdates` chunk 复用，前一个 chunk 的 stale abort 会让下一个本可执行的 chunk 在 `executeAutoFillStagingGroups_ACU:3252` 直接返回 aborted。该路径没有经过发现阶段的独立探针，按规则只能记在这里，建议并入 D02/D04 的 staging 中止粒度一起修。

## 设计层面的疑虑汇总

1. **聊天身份只有文件名一层**：`currentChatFileIdentifier_ACU` 同时被表格、世界书、向量 scope、回调、GC 当作全局身份；跨角色同名、分支、改名聊天都会撞在同一个字符串上。D06-04 只是其中一个具体缺口。
2. **“正在填表”是全局单布尔**：`isAutoUpdatingCard_ACU` 没有 chatKey/runId 归属，切聊天不释放，也没有像“终止填表”那样的 30s 兜底；旧轮 finally 可能清掉新一轮刚拿到的标志（第二轮 G03 已登记为设计疑虑）。
3. **破坏性清理的回滚句柄只在内存里**：`clearManualRefillSheetDataInRange_ACU` 用 strict save 把清理立即落盘，回滚完全依赖 orchestrator 局部变量；切聊天、应用被杀或编排器异常退出时，旧聊天的清理没有可恢复的持久化证据。
4. **存盘合并用“宿主可读的聊天 id”作为唯一归属凭据**：TT 复用 `chat` 数组、先清后填的流程与这个假设天然冲突；建议用 `chat[0]` 消息对象 + `getCurrentChatId()` 双证据，id 读不到时宁可立即真存。
5. **strict save 不校验聊天归属**：`saveChatToHostStrict_ACU` 只负责落盘，不检查“调用开始时是哪个聊天”；D06-01、D06-02 及 `establishManualRefillTemplateRoot_ACU` 都依赖调用方自己复核。建议在 gateway 层提供带 scope 的 strict save。
6. **填表请求没有传输超时/空闲看门狗**：服务商半开连接时 fill promise 永久挂起，`isAutoUpdatingCard_ACU` 一直为 true；30s 只强制放开标志，promise 仍悬挂。
7. **“上下文层数”设置语义与 UI 脱节**：`contextDepth` 只作为 `> 0` 的布尔门槛，`contextScopeIndices` 是死变量；如果已决定废弃，应同时移除 UI/模板配置，避免用户误以为模型能看到更多历史。
8. **删楼守卫的“实际不可达”注释已被存盘合并破坏**：`checkpoint-delete-guard.ts:20-24` 的残余竞态结论建立在“填表落盘耗时远大于窗口”上；合并窗口把一次保存推迟到整轮结束，这个前提不再成立。
9. **staging 的 fail-fast 与“只中止失效目标”的语义边界**：`update-orchestrator.ts:3053-3059` 明确禁止跨过失败 bucket 继续提交（避免内部空洞），因此“后续有效 bucket 应继续”不能只靠更换 controller；若产品希望继续，需要同时改 fail-fast 与数据一致性策略。跨 chunk 复用同一个 controller 的残余（见协调者存疑 4）则应单独修。
