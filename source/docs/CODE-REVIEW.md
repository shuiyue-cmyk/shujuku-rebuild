# 全库代码复审台账

> agent 间传阅文档（保留 文件:行号）。对用户汇报按 agent.md 三：结论先行、不贴代码。
> 方式：按模块分块顺序过，只记「有实际影响」的问题；纯风格不记。每条标 P0–P3：
> - P0 数据丢失/损坏且常见路径可触发
> - P1 数据被悄悄改写 / 功能错误，常见路径可触发
> - P2 边缘路径缺陷、资源泄漏、可维护性重大隐患
> - P3 清理项（死代码、重复实现、注释失真）
>
> 「已坐实」= 跑过探针或读穿调用链确认；「待坐实」= 推演结论，修前必须先写红用例。

## 分块计划与进度

全库约 18.3 万行（src，ts+vue）。按风险从高到低：

| # | 块 | 约行数 | 状态 |
|---|----|------|------|
| 1 | data/（storage、sqlite、repositories、gateways、models） | 9.7k | 完成（向量存储并入块 5）；全部已修（R1-07 中 sql-normalizer 一项无害不修） |
| 2A | service/table 填表流水线（orchestrator、sql-table-service、事务、调度） | 15k | 子代理完成 → `docs/review/block2a-fill-pipeline.md`；全部已修（R2A-09 为设计取舍，改正注释） |
| 2B | service/table 存储帧/回放/迁移 | 15k | 子代理完成 → `docs/review/block2b-storage-replay.md`；全部已修 |
| 3 | service/chat + service/runtime + service/settings | 17.8k | 子代理完成 → `docs/review/block3-chat-runtime-settings.md`；全部已修（R3-08 只做备份，「合法但零表模板」仍按损坏处理） |
| 4 | service/continuation + service/agent | 30k | 子代理完成 → `docs/review/block4-continuation-agent.md`；全部已修（R4-10 按风险不修） |
| 5 | service/vector + data/storage 向量部分 | 12.4k+ | 子代理完成 → `docs/review/block5-vector.md`；已修（R5-04 按产品决定不修，R5-12 rowId 部分按影响面不改） |
| 6 | service/template + template-assistant + worldbook | 13.3k | 子代理完成 → `docs/review/block6-template-worldbook.md`；已修 |
| 7 | shared/ | 9.8k | 子代理完成 → `docs/review/block7-shared.md`；全部已修（R7-11 locale 一项按风险不修） |
| 8 | service/ai、plot、optimization、flight-mode、其余小模块 | 5k | 子代理完成 → `docs/review/block8-small-services.md`；全部已修 |
| 9 | presentation（旧 bootstrap/triggers/api-groups） | 12k | 子代理完成 → `docs/review/block9-presentation-legacy.md`；无 P0；P1×3（R9-01~03）、P2×7（R9-04~10）、P3×8（R9-11~18）；全部已修（R9-15 为注释更正） |
| 10 | presentation-v2 逻辑层（stores/composables）+ presentation-v3 | 35k | 子代理完成：10A composables → `docs/review/block10a-v2-composables.md`（无 P0；P1×2 R10A-01~02、P2×11、P3×10）；10B stores 等 + v3 → `docs/review/block10b-v2-stores-v3.md`（无 P0/P1；P2×7、P3×13）；全部已修（R10A-22/23 各有少量保留项，理由见修复进度表） |

## 块 1：data/

已读：sqlite-engine、sql-normalizer、sync-bridge、schema-mapper、tavern-storage、config-storage、chat-message-data-repo。
未读：gateways/*、storage/chat-history、optimization-cache-storage、vector-index-*（并入块 5）、profile-repo、isolation-repo、target-keys-diagnostics、sql-wasm-locator。

### 发现

**R1-01 [P1 已坐实｜已修] 载入聊天时纯数字文本被改写（前导零/小数尾零丢失）**
- 修复：只有「转数值再转回逐字相同」的安全整数出裸字面量，其余加引号（INTEGER/REAL 列仍由亲和性转数值）。用例 `sync-bridge.test.ts`「数字样文本往返」，修前红（另发现 `0.30000000000000004`→`0.3`）。
- `src/data/sqlite/schema-mapper.ts:459-465` `escapeValue` 把匹配 `^-?\d+(\.\d+)?$` 的字符串输出为裸数字字面量。
- SQLite 对 TEXT 亲和列存的是数字的文本形式：探针（sql.js）结果 `"007"→"7"`、`"08"→"8"`、`"1.50"→"1.5"`、`"-0"→"0"`、20 位数字→`"1.23456789012346e+19"`。
- 触发：每次 hydrate（聊天载入/回放）→ 下次 export 落盘即永久改写。典型受害：月份/编号/时刻 "08"、"007"、金额 "1.50"。
- 修法方向：按目标列声明类型决定（row_id 与 INTEGER/REAL 声明列才出裸数字，其余一律加引号）；或全部走参数绑定（runBatch 已支持 paramsList）。
- 红用例：schema-mapper/sync-bridge 往返 `"08"` 断言不变。

**R1-02 [P3｜已修] 楼层清空（整槽模式）后读不到向量 manifest，即时删除外置向量文件这步落空**
- 修复：清空前先取槽，清后槽不在时用清前槽收集 manifest。用例 `chat-service.test.ts`「整槽模式」，修前红。
- `src/service/chat/chat-service.ts:2297-2306`：先 `clearTableFieldsForIsolation_ACU` 删掉整个隔离槽，再 `readIsolatedTagData_ACU` 读槽收集 manifest → 恒为 null。
- 已核：`summary-vector-index-chat-deletion-gc.ts` 的可达性 GC（flush 后按 scope 节流）会回收无引用对象，故只是「延迟回收」而非永久泄漏。降为 P3。
- 修法方向：清空前先读 tagData 收集 manifest。

**R1-03 [P2｜已修] `clearTableFieldsForIsolation_ACU` 就地改写缓存容器**
- `src/data/repositories/chat-message-data-repo.ts:1461-1470`：对 `parseIsolatedDataField` 返回的对象（字符串形态时是 WeakMap 缓存的解析结果，对象形态时是消息原对象）直接 `delete`。
- 与同文件 1750 行注释所立的「整体换字段、不就地改」契约相悖；字符串形态下解析缓存与消息字段短暂不一致。当前调用方无快照回滚，暂无实害，属契约破口。

**R1-04 [P2｜已修] `hasAnyTableData_ACU` 只认 V1 `independentData`，不认 V2 `storageFrame`**
- `chat-message-data-repo.ts:1527-1532`。唯一调用方 `table-history.ts:231-238` 已先判 V2 storageFrame 再回落，故当前无实害；函数名与语义不符，后续新调用方易踩。

**R1-05 [P2｜已修] SQL 分句器多处复制、且都不识别 `--` / `/* */` 注释**
- 复制品：`sql-table-service.ts:2770 splitSqlStatements`、`storage-frame-v2-replay.ts:1200`（逐字复制）、`restricted-sql-dml.ts:98`、`presentation/bootstrap/api-groups/sql-api.ts:248`、`sql-normalizer.ts`（也不认块注释、双引号标识符）。
- 风险：AI 写 `-- 更新角色; 补充` 这类带分号的注释会被切断成坏语句；写入期与回放期若某处修了另一处没修，回放与原执行结果分叉。
- 建议：收敛为 shared 单一实现 + 共用测试。

**R1-06 [P3｜已修] 油猴（userscript）模式分支全部是死代码**
- `entry-extension.ts:17` 恒 `_forceExtensionMode()`；`tavern-storage.ts:31-77,121-156,167-177` 的 bridge 注入 / `import('./script.js')` 等永不执行。其他 `isExtensionMode()` 分支同理（共 8 处）。

**R1-07 [P3｜已修（sql-normalizer 一项不修）] 小项**
- `sqlite-engine.ts:202-227` `query()` 用 `exec` 会执行多语句、只返回首个结果集；需在块 2 确认 AI/控制台只读 SQL 是否先经单语句校验（`read-only-sql-validation.ts` 有 `hasMultipleStatements_ACU`，待核对所有入口都走它）。
- `sqlite-engine.ts:434-442` `loadFromBinary` 先 dispose 再 `new Database(data)`，坏数据时旧库已丢；需看调用方是否把它当可失败操作。
- `sql-normalizer.ts:347-352` UPDATE 正则在字符串值里含 ` where ` 时截断，结果是「不规范化」而非改坏，无害。
- `sync-bridge.ts:564-574` 错误脱敏正则以首个 `→` 截断，用户数据含 `→` 时会把部分 VALUES 漏进日志。
- `tavern-storage.ts:263` `new Promise(async …)` 反模式（当前各分支都 resolve，无实害）。

### 待块 2 核对的跨块疑点
- 休眠表（非 SQL 活动模板表）在 hydrate 时被跳过、export 时自然缺席；需确认 `sql-table-service.ts` `_syncToJson` 合并回上份视图，否则休眠表数据会在一次填表后从视图消失。

## 修复进度（跨块）

| 编号 | 级别 | 状态 | 回归用例 |
|---|---|---|---|
| R1-01 数字样文本 hydrate 改写 | P1 | 已修 | sync-bridge.test「数字样文本往返」 |
| R1-02 整槽清空漏收向量 manifest | P3 | 已修 | chat-service.test「整槽模式」 |
| R2B-01 V2 恢复整体替换聊天 | P1 | 已修：只回写目标楼层当前隔离槽，失败逐字段回滚 | table-v2-recovery-service.test「等锁期间宿主追加消息」 |
| R2A-01 legacy SQL 路径不校验目标表授权 | P1 | 已修：执行前重绑+授权，统一路径与 legacy 共用 authorizeSqlStatementsForTargets_ACU | update-orchestrator.test「legacy SQL 目标表授权」 |
| R2A-02 边界汇合/临时桥整体替换聊天 | P1 | 已修：boundary 只回写原根楼层隔离槽；bridge 三处按「表格字段有变化的楼层」回写并校验窗口内未变，资料随迁改在 live 上做并可回滚 | boundary-staging.integration「宿主追加消息」、provisional-bridge.integration「窗口内宿主」 |
| R2A-05 legacy 路径绕过隐藏列守卫 | P2 | 已修：守卫移入 applyEditsWithSystemRowIds，对去标记+重绑后的最终语句校验 | update-orchestrator.test「隐藏物理列守卫」 |
| R2A-03 SQL 已入引擎后抛异常留孤儿行 | P2 | 已修：apply 成功后至落盘成功前任何失败都重载；apply 返回 runtimeMutated 时也重载 | table-update-commit.test「收敛」×2 |
| R2A-04 flush 失败重载冲掉待写回行 | P2 | 已修：flush 提交声明 applyMutatesRuntime:false，不再重载；普通提交失败时若有未写回的 runtime-only 登记且聊天未变，按提交前快照恢复运行时（sqlite 另行 hydrate），恢复不了才整体重载 | table-update-commit.test「不得重载」「R2A-04」×3 |
| R2A-06 legacy 首次初始化用模板覆盖运行时 | P2 | 已修：先克隆共享视图；仅运行时缺表时用模板补 | update-orchestrator.test「首次初始化：AI 未改动」 |
| R2B-02 in-flight 等待方丢兼容诊断字段 | P2 | 已修：等待方返回完整结果深拷贝；去重 key 改为仅显式 updateRuntimeState:false | replay.test「等待方拿到」「未显式声明」 |
| R2B-03 回放重算 random()/now | P2 | 已修：涉及非确定性函数（含 DDL DEFAULT）的表改以执行后快照 sheet_replace 落盘 | update-orchestrator.test「随机/当前时间」 |
| R2A-08 并发组提前清全局填表标志 | P2 | 已修：processUpdatesBatch 只在自己置位时复位标志与停止信号 | update-orchestrator.test「外层调度已持有」「本批自己持有」 |
| R4-01 逐栏写证据楼层上限用旧水位 | P1 | 已修：上限改为本次结算目标（当轮末楼），与整行事务同口径 | agent-module-store.test「结算窗口内的新 AI 楼」 |
| R4-02 逐栏写齐的条目不进领域数组 | P1 | 已修：提交层把写齐记录转整行 upsert，走同一事务校验/修订号推进后落快照；不合规留草稿并经 partials[].promotionError 回给模型；工作流按修订号增长记 complete_changed。帧层 T2 锁定不变 | agent-module-store.test「提升为正式领域条目」×4、「固定工作流：维护子代理只用 write_sql」 |
| R4-03 资料补足开放 write_sql 必然 STALE | P1 | 已修：补足通道不再开放 write_sql，只收整行契约由编排器提交 | agent-material-repair-channel.test |
| R4-04 接管期间删条目后恢复永不收敛 | P1 | 已修：宿主已删除的条目直接从接管账本剔除（含旧版残留 pending）；scope 恢复不再把已删除计入 skipped | agent-worldbook-takeover.test「条目被删除」×2、snapshot-restore.test |
| R4-05 补足裁剪漏 chronologyPatches | P2 | 已修 | agent-workflow.test「R4-05」 |
| R3-01 模板只读 SQL 可用 [方括号] 绕过并执行写语句 | P1 | 已修：校验器认 [..] 标识符；executeQuery（模板/控制台/对外 API 唯一只读入口）在引擎层只允许单语句并以 query_only 执行 | read-only-sql-validation.test「方括号」、sqlite-engine.test「readOnly」、sql-table-service.test「executeQuery 拒绝」 |
| R3-02 ORM 表达式 JS 白名单可绕过执行任意 JS | P1 | 已修：弃用 new Function，改为自带解释器（方法链 + 字面量参数 + 末尾比较），只能调 db 静态函数与构建器公开方法 | sql-query-var.test「绕过载荷」「只能调用构建器公开方法」「解释器支持的合法语法」 |
| R3-03 CASE…END / REPLACE() 被当写语句拒 | P2 | 已修：词表去掉 END/REPLACE，WITH 按顶层主语句判定；写入兜底在引擎层 | read-only-sql-validation.test「R3-03」 |
| R3-04 删除当前连带删别的标识旧数据 | P2 | 已修：顶层旧版字段与 Identity 按 isLegacyMatchForIsolation 把关（mode=all 除外） | chat-service.test「块 3 复审」R3-04×3 |
| R3-05 保留层清理删别的标识旧数据 | P2 | 已修：非当前标识的顶层旧版字段与 Identity 原样保留（不中止整次清理） | chat-service.test R3-05 |
| R3-06 重填临时根零提交回滚留双根 | P2 | 已修：建根前快照并入回滚句柄；回滚后复核单根，不成立如实报失败 | chat-service.test R3-06 |
| R3-07 按表全删后无根空帧挡住填表 | P2 | 已修：无整库根且剩余帧全空时移除空信封 | chat-service.test R3-07 |
| R3-08 模板解析失败被默认覆盖无备份 | P2 | 已修：覆盖前备份到 .bak | profile-repo.test、settings-service.test「R3-08」 |
| R3-09 维护事务等锁跨切聊 | P2 | 已修：事务新增 guardChatSwitch（chat-service 维护类与删楼恢复启用）；删楼恢复另复核聊天数组身份 | table-write-transaction.test「guardChatSwitch」、checkpoint-delete-guard.test「聊天数组被替换」 |
| R3-10 死代码跨标识清表 | P3 | 已修：删除 clearTableDataAtFloors_ACU、clearManualRefillIncrementalDataInRange_ACU、replaceManualRefillSheetBaselineInRangeAtomic_ACU、saveCurrentDataForTable_ACU（update-process 的 re-export 无任何调用方，不在 window API 上）及其专属私有函数与用例 | — |
| R3-11 删向量文件前非严格保存 | P3 | 已修：有向量文件待删时严格保存 | chat-service.test「走严格保存」 |
| R6-01 全删生成条目误删别的环境/外部条目 | P1 | 已修：去掉按当前配置前缀兜底判定，只认本插件生成条目 | pipeline.test「块 6 复审：生成条目判定」 |
| R6-02 合并世界书内容混入别的隔离环境条目 | P1 | 已修：剥当前隔离前缀后判定，排除其他环境前缀与本插件生成条目 | pipeline.test「块 6 复审」 |
| R6-03 非隔离删自定义导出误删隔离条目 / 合并条目漏前缀 | P2 | 已修 | injection-engine-custom.test「块 6 复审：自定义导出」 |
| R6-04 导出模板 $ 符号被展开 | P2 | 已修：回调替换 | 同上 |
| R6-05 改表助手 v3 整表替换丢本地隐藏列/别名 | P2 | 已修 | compiler.test「v3 整表替换保留本地隐藏列与别名」 |
| R6-06 世界书派生刷新不复核聊天身份 | P2 | 已修：入口固化身份与注入目标并透传，每步前复核，不一致整体放弃；合并刷新切聊天时丢弃结果（stale） | pipeline.test「块 6 复审：世界书派生刷新期间切换聊天」 |
| R6-07 跟随全局/全局切换后翻转 scope 打到别的聊天 | P2 | 已修：翻转前比对提交前的聊天身份与首楼，不一致放弃并给 postCommitWarning | template-preset-service.test「块 6 复审：协调提交期间切到别的聊天」×2 |
| R6-08 模板预设库保存失败报成功 | P2 | 已修 | template-preset-service.test「块 6 复审：预设库持久化失败」 |
| R6-09 seed 迁移三处问题 | P2 | 已修：运行时数据改取 state-manager；回滚只恢复 guide/scoped 两容器且只对已提交计划；提交不再强制 chat_override | template-seed-pollution-migration-flow.test |
| R6-10 merge 计划重复 row_id | P2 | 已修：preflight 遇 row_id 被占用直接 blocker；落候选前再兜底 | template-data-preflight.test「块 6 复审」 |
| R6-11 纪要索引 endsWith 改别人的条目 | P2 | 已修：按当前隔离前缀精确匹配 | injection-engine-entries.test「块 6 复审」×2 |
| R6-12 删除生成条目两份副本 | P3 | 已修：合并为 pipeline 一份 | — |
| R6-13 绕过协调器的作用域直写函数 | P3 | 已修：删除（含仅供其使用的辅助函数与 import） | — |
| R6-14 开场白抑制死分支 | P3 | 已修：删除分支 | — |
| R5-01 镜像 flush/重建失败整块回滚吞掉并发提交 | P1 | 已修：改为锁内登记的字段级撤销日志，只撤销仍是自己写入值的镜像/legacy 字段；旧镜像对象不再原地改动 | summary-vector-mirror-review-block5.test「R5-01」×3 |
| R5-02 每次 flush 全表重嵌、召回下载全部历史 pack | P2 | 已修：refresh 前比对写入时源文本哈希（manifest 行与 row_add 记录哈希，旧 manifest 回读 pack textHash），只重嵌变化行；resolver 只输出 head 行仍引用的 pack | 同上「R5-02」×3、resolver.test 期望更新 |
| R5-03 重建失败回收删掉在用 manifest | P2 | 已修：manifest 与 pack 同口径先读后写，已存在则复用（createdNew:false），不降级、不回收 | summary-vector-mirror-manifest-reuse.test |
| R5-04 GC 可达性只看当前聊天（分支/改名聊天的引用被删） | P2 | 不修（产品决定）：选省空间，保持及时回收；分支/改名聊天的向量索引被回收后需重建（向量化费用很低） | — |
| R5-05 镜像不可用时 fold 抛错阻塞 compaction | P2 | 已修：head 非 ok / pack 或 chunk 读不到时剥掉镜像让下次 flush 自动 initial 重建，不再抛错 | summary-vector-mirror-fold-degrade.test |
| R5-06 迁移旧交火索引写出召回不读的旧指针 | P2 | 已修：对外 API 与 v2 页面入口改为按当前纪要表重建新版镜像（会清旧字段） | data-admin-ui-legacy-vector.test |
| R5-07 writer 与 rebuild 无互斥 | P2 | 已修：提交前比对镜像结构签名，embedding 期间被改写即放弃交回队列 | 同上「R5-07」 |
| R5-08 legacy realign 死代码 | P3 | 已修：删除三个函数及只被其使用的 import（legacy 整套是否下线另议） | — |
| R5-09 全部复用时维度赋值空操作 | P3 | 已修：取复用 pack 的实际维度 | manifest-reuse.test「R5-09」 |
| R5-10 flush 代次墓碑在新链路失效 | P3 | 已修：提交前校验代次，失效按 flush_scope_invalidated 跳过 | 同上「R5-10」 |
| R5-11 删除索引在纯 V2 楼层回滚为空操作 | P3 | 已修：写时复制后整体赋值 | chat-service.test「R5-11」 |
| R5-12 纪要表选取依赖键顺序 / rowId 口径 | P3 | 部分：选取改为纪要表>总结表>总体大纲并全仓共用；rowId 口径未改（缺 row_id 的行已在加载时被清理，实际影响小） | scope-resolver-priority.test |
| R2A-07 多 staging 组汇合后丢 pre 段 | P2 | 已修：三阶段——所有组边界前段先全部进 staging，统一汇合一次，再跑所有组边界后段 | update-orchestrator.test「R2A-07」 |
| R2B-04 删表与唤醒/重建/隐藏同批提交丢数据 | P2 | 已修：硬删新基底并入本批唤醒/重建表的最终数据（飞行模式停用即此组合）；与隐藏同批仍拒绝（隐藏快照无处安放，提示分两次提交） | persist.test「R2B-04」×2、flight-mode-lifecycle 集成 |
| R2B-05 追加操作只校验到当前楼层，后续楼层回放坏掉 | P2 | 已修：后面还有本隔离槽帧时追加一次全量严格回放，失败即拒 | persist.test「R2B-05」 |
| R2B-06 兼容过渡 checkpoint 等锁期间聊天变化仍落盘 | P2 | 已修：计划前记录聊天形状（长度+head 摘要），提交时不一致即放弃 | replay.test「R2B-06」 |
| R4-06 固定工作流在途期间楼层变化仍落盘 | P2 | 已修：准备阶段后锚定各楼层引用/swipe/正文，前缀刷新与落盘前复核，变化即按 STALE 中止 | agent-main-loop.test「R4-06」 |
| R4-08 会话段写在工具/隐藏楼层 | P2 | 已修：落在尾部及以前最近的 AI 楼；后面已有会话段的楼时仍写尾部，保持顺序 | agent-conversation-store.test「R4-08」×2 |
| R7-01 正文单引号被改写 | P1 | 已修：删除单引号处理，正文原样写回 | text-optimization.test「R7-01」×2 |
| R7-02 原生世界书后端并发读改写互相覆盖 | P2 | 已修：按书名串行化 load→save 临界区，create 在临界区内重算 uid；前一个失败不阻塞后续 | native-st-backend.test「R7-02」×2 |
| R7-03 屏蔽词子串匹配静默排除正常条目 | P2 | 已修：英文屏蔽词按整词匹配（Scott/cottage 不再中招）；中文仍按子串，但命中条目在页面列出并标注「提示词类，默认不发送」，用户逐条勾选后填表/剧情推进/Agent 均放行；首次默认勾选与全选不连带勾上 | utils.test、worldbook-entry-selection.test、plot-task-engine.test、exposure-tt.test、两个条目列表 test |
| R7-04 受限 DML 把字符串里的 where 当关键字 | P2 | 已修：引号感知地找字符串外第一个 WHERE | restricted-sql-dml.test「R7-04」×3 |
| R7-05 隔离标识 default 与默认槽撞 scope | P2 | 已修：default（不分大小写）设为保留名，切换时拒绝并提示；已在用 default 的老数据不做迁移 | data-constants.test、use-data-management.test「R7-05」 |
| R7-06 deepMerge 吞掉 source 对象 | P3 | 已修：两侧都是普通对象才递归 | utils.test「R7-06」 |
| R7-07 DDL 列注释按行正则解析错位/改坏 | P3 | 已修：引号/括号感知的逐行扫描，注释归属行内最后一个列定义；改名只改归属行，不归属时原样返回 | schema-mapper.test「R7-07」×4 |
| R7-08 canMergeTemplateSheet 恒真且无调用方 | P3 | 已修：删除 | — |
| R7-09 写路径列重绑扫描过宽 | P3 | 已修：跳过目标表名限定链与 VALUES 子句；INSERT 列清单只认表名后紧跟的括号 | sql-mutation-table-rebind.test「R7-09」×3 |
| R7-10 首列业务表头 id 被当身份列 | P3 | 已修：id 列的值全为空或纯数字才当身份列，否则插入新身份列 | canonical-row-normalizer.test「R7-10」×2 |
| R7-11 小项 | P3 | 已修：正整数归一化、删转义解析死代码、注释错位、导入暂存等事务完成且打开失败可重试。不修：世界书书名排序的 locale 依赖——签名已写进接管条目，改排序会让现有接管一次性失配，风险大于跨设备收益 | utils.test、idb-import-temp.test |
| R8-01 飞行模式补偿切聊后打到新聊天（硬删） | P1 | 已修：入口锚定聊天（数组/首楼/文件标识/隔离键），补偿前不一致直接放弃并报可操作错误；协调提交新增 expectedChatContext，首楼不符 fail-closed | flight-mode-transition-chat-switch.test |
| R8-02 内部 AI 120s 墙钟超时掐断长生成 | P1 | 已修：流式改为空闲超时（等响应头、相邻数据块之间各 120s，逐块读取续期）；非流式按输出上限 20 tok/s 估算放宽，不低于 120s | api-call.test「R8-02」×2、prompt-api-call.test「R8-02」 |
| R8-03 已停用的自动合并纪要仍在每次填表后白烧请求 | P2 | 已修：删除自动/手动填表后的自动合并触发链与整个合并模块；导入设置时 autoMergeEnabled 恒为关 | settings-service.test、update-orchestrator.test、update-scheduler.test「R8-03」 |
| R8-04 DSL 解析前全文归一化改写单元格 | P2 | 已修：归一化只作用于 JSON 字符串之外；字符串内的全角冒号/\n/'+' 原样交给 JSON.parse；跨行字符串拼接保留换行 | table-edit-parser.test「R8-04」×3 |
| R8-05 正文优化把正文里的 $5/$C/$& 当占位符替换 | P2 | 已修：正文与占位符值先换成 nonce token，模板解释器跑完再还原（与填表同一套守卫，已抽到共享模块）；正文里的模板标签也不再被执行 | content-optimization.test「R8-05」 |
| R8-06 清空剧情推进排除规则后被恢复默认 | P2 | 已修：只在字段缺失时补默认规则，空数组按用户选择保留 | plot-logic.test「R8-06」 |
| R8-07 流式解析只认两种协议的结束信号 | P2 | 已修：finish_reason、Responses 的 response.completed、Gemini 的 finishReason 均视为结束，并解析 Responses/Gemini 的文本增量；无任何结束信号仍按截断处理。未在真机抓流确认 TT 对这几种协议是否透传 | prompt-api-call.test「R8-07」×4 |
| R8-08 非 2xx 不带 status，续写对 401/403/404 照样重试 | P3 | 已修：抛带 status 的 AgentApiHttpError；续写重试对带状态码的错误按 408/429/5xx 才重试 | api-call.test、internal-ai-call.test「R8-08」 |
| R8-09 重新优化按楼号回退到别的楼层 | P3 | 已修：有 messageId 却找不到时不按楼号回退 | plot-logic.test「R8-09」 |
| R8-10 引号归一化缺弯引号、改写「」『』 | P3 | 已修：只在标准双引号字符串之外把 ＂「」『』 当定界符转换；字符串内的对白括号原样保留；弯引号按既有约定不转换 | json-sanitizer.test「R8-10」 |
| R8-11 正文优化取消后排队的重试仍发出 | P3 | 已修：每轮登记 AbortController，取消即中断在途请求；按取消代次在每次请求/退避前后复核（旧取消不误伤新一轮） | content-optimization.test「R8-11」×2 |
| R8-12 剧情推进标记随聊天文件落盘 | P3 | 已修：改为按消息对象登记在 WeakMap，写入时清掉旧版残留字段 | plot-orchestrator.test、plot-history-preset.test |
| R8-13 填表占位符吃掉 $10/$100 | P3 | 已修：占位符加右边界（后跟数字/字母不算），已核默认提示词无依赖；正文优化同口径 | prompt-api-call.test「R8-13」 |
| R8-14 死代码 | P3 | 已修：删除 getOptimizationApiConfig_ACU 与合并模块 | — |
| R1-03 清隔离槽就地改缓存容器 | P2 | 已修：浅拷贝后整体换字段，解析缓存与原容器不被改动 | chat-message-data-repo.test「R1-03」×2 |
| R1-04 hasAnyTableData 不认 V2 帧 | P2 | 已修：指定隔离键时同样认 V2 storageFrame（判据同 isV2TagData_ACU） | chat-message-data-repo.test「R1-04」 |
| R1-05 SQL 分句器多处复制、不识别注释 | P2 | 已修：收敛为 shared/sql-statement-splitter 唯一实现（引号/方括号/反引号感知，-- 与 /* */ 视为空白并剥除）；sql-table-service、回放、受限 DML、SQL API 全部委托；AI 输出先去 HTML 注释标记再分句 | sql-statement-splitter.test |
| R1-06 油猴模式死代码 | P3 | 已修：删除 iframe 模式探测、设置桥注入与动态 import、各处油猴分支；存储键名 __userscript_settings_v1 / __userscripts 保持不变 | tavern-storage.test、runtime-env.test |
| R1-07 小项 | P3 | 已修：loadFromBinary 先建新库并读一次 schema 再释放旧库；落库失败诊断按最后一个「→」切分不再漏出正文；配置缓存加载去掉 new Promise(async)。query 多语句：只读入口已由引擎逐条编译拒绝，已无问题。sql-normalizer 截断无害，不修 | sqlite-engine.test「R1-07」、sync-bridge.test「R1-07」 |
| R2A-09 live 基底无视 maxMessageIndex | P3 | 设计取舍：SQL 就在 live 库执行，基底必须与之一致（否则重复 INSERT）；改正自相矛盾的注释 | — |
| R2A-10 SQL 失败归错分组 | P3 | 已修：执行方按实际执行语句换算出 failedGroupIndex 随错误抛出，编排层优先采用；兜底倒推改用与 SQL 一一对应的分组列表（原先传的是含被屏蔽分组的全量列表） | sql-table-service.test、update-orchestrator.test「R2A-10」 |
| R2A-11 手动填表死参数与死代码 | P3 | 已修：删除 orchestrateManualUpdate_ACU 从未调用的 processBatch 参数及两个入口为它构造的回调 | — |
| R2A-12 外键级联绕过锁定 | P3 | 已修：锁定比对覆盖所有表（无锁表即时跳过），级联改到被锁子表时补偿；补偿撞外键则整批 fail-closed | sql-table-service.test「R2A-12」 |
| R2B-07 硬删表写出第二个 full 根 | P3 | 已修：终态根写入后同事务把同隔离键其余 full 降级为帧内 data_replace fallback（降级逻辑抽为 v2-full-checkpoint-downgrade 与混合提交共用），候选校验同口径 | storage-frame-v2-persist.test「仅删表」、flight-mode-lifecycle.test |
| R2B-08 迁移/混合提交整聊天克隆替换 | P3 | 已修：chat-table-field-swap 只逐条替换表格字段，消息对象身份不变，失败回滚还原原字段引用 | mixed-storage-commit.test、storage-v2-migration.test「R2B-08」、chat-table-field-swap.test |
| R2B-09 batch 写入每批深克隆整个聊天 | P3 | 已修：batch 候选只浅拷贝要改写的消息；硬删候选、删表模拟、临时根降级改为只深拷贝表格字段。另修：临时根降级严格保存失败时未还原根消息（与其文档契约不符） | storage-frame-v2-persist.test「R2B-09」「降级严格保存失败」 |
| R2B-10 回放再分句让参数错位 | P3 | 已修：带参数的操作按存储语句一一对应，切出不是恰好一条即 fail-closed（原先会静默绑错参数写出空值） | storage-frame-v2-replay.test「R2B-10」×2 |
| R4-07 两套世界书恢复实现 | P2 | 已修：逐条目决策、patch 构造与恢复判定收敛到 agent-worldbook-restore-core；pending 条目不再被恢复覆盖、用户改过注释的条目两条路径都整条跳过；剩余两处差异（缺指纹策略、剥离口径）改为显式策略参数 | agent-worldbook-snapshot-restore.test |
| R4-09 SQL 视图冗余校验 | P3 | 已修：删除与 JSON 链重复的整表 SQL 视图物化校验（逐列写闸门不变） | agent-module-sql-view-materialization-once.test |
| R4-10 时间线无上限 | P3 | 不修：阶段游标与 progressSelections 直接按时间线下标寻址，截断会让存量游标错位，收益未量化 | — |
| R4-11 重规划中止控制器登记在租约外 | P3 | 已修：登记移入租约回调内，外层 finally 注销 | — |
| R10A-01 确认弹窗期间切聊天，危险操作落到新聊天 | P1 | 已修：弹窗请求记录所属聊天，切聊天时自动取消旧聊天的全部弹窗；删除本地数据/恢复 Checkpoint 在弹窗前冻结聊天与删除路径，执行前复核 | dialog-store.test、use-chat-changed-listener.test、use-data-management.test「R10A-01」 |
| R10A-02 可视化器「保存数据」吞掉未提交的模板改动与删表 | P1 | 已修：只有锁改动时也拒绝混入模板改动；删表一律引导走「保存模板到当前聊天」原子提交，数据路径不再单独硬删；删除从未被调用的旧保存函数 | use-visualizer-save.test「R10A-02」×2 |
| R10A-03 保存模板到全局：确认后不复核聊天 | P2 | 已修：命名/覆盖确认后核对聊天，切了就不写预设、不切模板、不写锁 | use-visualizer-save.test「R10A-03」 |
| R10A-04 其余确认 → 执行 TOCTOU | P2 | 已修：三处模板破坏性确认合并为一份实现，确认后复核聊天并重算待删清单，清单变了不带确认标志提交；关闭飞行模式加忙碌态与聊天复核；恢复默认每一步后复核，中途切聊天即停；删除交火索引复核聊天 | template-destructive-confirm.test、dashboard-page.test、use-data-management.test、use-vector-index-delete-scope.test「R10A-04」 |
| R9-01 正文优化按下标写回，滑动/删楼/切聊天后写错楼 | P1 | 已修：读取正文时拍下楼层快照（消息对象、message_id、swipe_id、正文、聊天标识），自动应用/手动确认/重新优化三条写回路径都按快照复核，写回函数也支持带快照拒绝；末轮对话框与执行层的重复写回合并为一次 | chat-service.test、optimization-ui-write-target.test「R9-01」 |
| R9-02 覆盖最新层后 SQLite 内存库不重建 | P1 | 已修：服务层提交成功后在 SQLite 模式重建内存库，两个调用方都受益；重建失败如实报错 | chat-service.test「R9-02」×2 |
| R9-03 删楼与滑动同窗口时跳过删楼恢复 | P1 | 已修：「本轮含删楼」改为粘性标志，执行时读取并清零；执行中到达的删楼留给补跑轮；切聊天清掉旧聊天的标志 | chat-mutation-scheduler.test「R9-03」×3 |
| R9-08 手动确认多轮：后续轮次结束时丢掉已确认结果 | P2 | 已修：末轮无需优化、请求失败（及不可达的末轮跳过）时写回此前已确认的内容，填表只触发一次。注：末轮对话框本就没有「跳过」按钮，可达的丢失路径是前两种 | optimization-ui-write-target.test「R9-08」×2 |
| R9-09 重新优化对话框 summary 未转义 | P2 | 已修：两处对话框的 summary 都转义 | optimization-ui-write-target.test「R9-09」 |
| R9-04 原生 SQL API 绕过锁与隐藏列守卫 | P2 | 已修：原生 SQL 写入口与 CRUD 提交路径统一过锁定比对，改到锁定行即整批拒绝并回滚 | sql-external-write-lock-guard.test「R9-04」 |
| R9-05 CRUD 可改写 row_id | P2 | 已修：updateCell 写列 0/row_id、updateRow 带 row_id 一律拒绝 | table-crud-api.test「R9-05」 |
| R9-06 数据对象里的选项字段被当选项又当列名 | P2 | 已修：数据对象里的 isImportMode/silent/skipNotify 不再进 SQL，照常写入 | table-crud-api.test「R9-06」 |
| R9-07 旧公开 API 合并导入/导出失效 | P2 | 已修：导出读设置里的提示词；导入改为「写设置 → 应用模板」原子流程，模板失败整体回滚设置，与 V2 共用一份实现 | combined-settings-legacy.test「R9-07」 |
| R9-10 启动链中途切聊天 | P2 | 已修：启动链在加载消息与 merged refresh 之后复核聊天身份，切聊天即停在原地，不再以新聊天身份 hydrate 旧数据 | init.test「R9-10」 |
| R9-11 旧 jQuery 弹窗层整体失效 | P3 | 已修：删除 ui-refs、settings-ui-api、plot-editors、template-preset-ui、update-status-display、optimization-ui-rules 六个文件及各处空转函数（模型探活、状态卡片、按钮状态、手动选表、旧删除入口、优化摘要 toast）；运行态改从 state-manager 直接导入；手动额外提示改为每次清空 | update-process.test「R9-11」 |
| R9-12 SQLite 恒定后的死分支 | P3 | 已修：删除 CRUD 四个方法的非 SQLite 分支、自动填表分组进度框与终止按钮路径；合并导出不再写合并总结/自动合并字段（导入仍兼容旧文件） | combined-settings-legacy.test「R9-12」 |
| R9-13 新确认框顶掉旧框时旧 Promise 永不 settle | P3 | 已修：被顶掉的确认框按取消 settle | custom-confirm.test「R9-13」 |
| R9-14 锁 API 与 CRUD API 行口径不一致 | P3 | 已修：锁 API 头部写明 0 基数据行/sheetKey 口径，新增按 row_id 锁行的入口 | table-lock-api.test「R9-14」 |
| R9-15 中止注释与实际不符 | P3 | 已修：改正注释（只有切聊天中止在飞调用） | — |
| R9-16 openVisualizer 重复定义、保存结果被忽略 | P3 | 已修：删除重复定义；手动选表的两个入口与剧情预设导入检查保存结果，失败回滚并如实返回 | data-admin-api.test、settings-config-api.test、plot-preset-api.test「R9-16」 |
| R9-17 导出与回调交出运行时原对象 | P3 | 已修：对外交出 JSON 深拷贝 | core-data-api-export-copy.test「R9-17」 |
| R9-18 合并跟发切聊天后在新聊天补跑 | P3 | 已修：登记跟发时记下聊天与隔离域，补跑前比对，不一致即作废 | settings-ui-trigger.test「R9-18」 |
| R10A-05 改表助手结构+数据混合草稿无法保存 | P2 | 已修：应用前拦下「加列并填值」类混合草稿并提示分两步；纯结构/纯数据照常；列重排按列名比对不记伪更新 | use-visualizer-assistant.test「R10A-05」 |
| R10A-06 世界书读取失败时清空勾选 | P2 | 已修：读取失败或空书时不动勾选、不落盘；首次加载失败不写空默认 | use-form-fill-worldbook-entries.test、use-plot-worldbook-entries.test「R10A-06」 |
| R10A-07 Agent 世界书批量编辑整本覆盖 | P2 | 已修：只写回改动条目的改动字段（宿主按 uid 合并），不再整本覆盖；单本失败如实汇报 | use-agent-worldbook-entries.test「R10A-07」 |
| R10A-08 向量 API 配置先改后校验 | P2 | 已修：在副本上校验，通过才写入；保存失败回滚并如实报错 | vector-api-config.test「R10A-08」 |
| R10A-09 续写资料陈旧草稿覆盖 Agent 写入 | P2 | 已修：保存带载入时的模块修订号，服务层修订已推进即拒绝 | use-continuation-materials.test、agent-module-store.test「R10A-09」 |
| R10A-10 剧情预设新建/改名不查重 | P2 | 已修：重名一律拒绝 | plot-preset-store.test「R10A-10」 |
| R10A-11 SQL 控制台重复执行、提交后误报拒绝 | P2 | 已修：执行入口统一重入闸；提交后切聊天如实提示「已提交」 | use-sql-console-reentry.test「R10A-11」 |
| R10A-12 refresh 冲掉未保存的提示词编辑 | P2 | 已修：有未保存编辑时 refresh 不覆盖草稿 | use-form-fill-settings-native-tools.test、use-vector-index-delete-scope.test「R10A-12」 |
| R10A-13 下载立即 revoke 且挂当前 document | P2 | 已修：新版界面统一用 host-download（挂 host document、延迟 revoke），删除五份重复实现 | host-download-conventions.test「R10A-13」 |
| R10A-14 改表名立即迁移表级 API 预设覆盖 | P3 | 已修：改名只改草稿，保存成功时才按改名映射迁移覆盖；重名不覆盖他表设置 | table-api-preset-rename.test、use-visualizer-config-editing.test「R10A-14」 |
| R10A-15 改列名不同步额外索引列 | P3 | 已修：改列名同步 extraIndexColumns/Modes | use-visualizer-config-editing.test「R10A-15」 |
| R10A-16 改表助手旧会话改写新会话状态 | P3 | 已修：每次运行带 runId，旧会话的结果与收尾一律丢弃 | use-visualizer-assistant.test「R10A-16」 |
| R10A-17 Skill 化连点并发 | P3 | 已修：确认期间即占忙碌位，确认后复查 | use-plot-worldbook-agent-control.test「R10A-17」 |
| R10A-18 硬清空收尾未 await | P3 | 已修：await 收尾，刷新异常捕获并提示，忙碌态等刷新结束才解除 | use-data-management.test「R10A-18」 |
| R10A-19 手动填表终止连带中止剧情推进 | P3 | 已修：剧情推进的请求单独登记，填表终止时保留；确认框取消不再清空额外要求 | state-manager.test、useManualUpdate.test「R10A-19」 |
| R10A-20 恢复诊断无入口 | P3 | 已修：数据管理页补上「历史恢复诊断」入口 | data-mgmt-page.test「R10A-20」 |
| R10A-21 注入目标切换吞错 | P3 | 已修：旧书清理失败给出警告；注入失败捕获并提示；选择器读取失败显示错误态 | use-form-fill-injection-target.test「R10A-21」 |
| R10A-22 死代码 | P3 | 已修：删除数据管理隐藏入口函数与对应状态、模板预设三个无调用方的全局操作与未用 import、向量配置空函数、可视化器保存的死分支；合并导出不再写自动合并字段。保留：模板预设的「与库不同」两个状态（同一计算也供标签后缀，且有测试覆盖） | combined-settings-legacy.test「R10A-22」 |
| R10A-23 重复实现与误导命名 | P3 | 已修：剧情任务 id 同毫秒不再相撞、删任务清理他任务的依赖引用；预设管理加重入闸；恢复守卫改名 ensureTemplateRecoveryReady 并去掉白做的 guide 数据构建；条件模板恒开启改在加载设置时归一，总览刷新不再写设置。三份破坏性确认此前已合并（R10A-04）；下载重复见 R10A-13。保留：填表/剧情两套世界书条目 composable（默认勾选与默认已发送语义不同，共用部分已抽到 worldbook-entry-scope）、两套模板预设 composable（分别服务聊天模板区与预设管理，删除语义分叉的死函数已删） | use-plot-task-editing.test、table-preset-management.test、settings-service.test、dashboard-page.test「R10A-23」 |
| R10B-01 续写设置自动保存在途时新输入被冲掉 | P2 | 已修：记下在途提交的草稿，保存回声不重建草稿，草稿已变则保留并再排一次保存 | continuation-page.test「R10B-01」 |
| R10B-02 锁草稿删行/删列后不平移 | P2 | 已修：删行/删列时同步平移锁草稿下标 | visualizer-store.test、use-visualizer-config-editing.test「R10B-02」 |
| R10B-03 放弃的提示词草稿被后续保存写入 | P2 | 已修：确认关闭即丢弃草稿；基础设置保存只写基础字段 | content-replace-store.test「R10B-03」 |
| R10B-04 剧情预设重名覆盖、导入覆盖当前预设 | P2 | 已修：重名拒绝；导入前列出会被覆盖的预设并确认，覆盖了当前预设时重新应用 | plot-preset-store.test「R10B-04」 |
| R10B-05 全选无视筛选 | P2 | 已修：全选/全不选/Skill 全选只作用于当前筛选结果；Skill 化确认文案写明条目数 | worldbook-entries.test 等「R10B-05」 |
| R10B-06 切页/切模式/开编辑器绕过关闭守卫 | P2 | 已修：三处入口先过页内未保存守卫；外部 API 打开编辑器同样受守卫 | shell.test、table-preset-management.test、open-visualizer-surface.test「R10B-06」 |
| R10B-07 大纲编辑器无基线覆盖 Agent 新大纲 | P2 | 已修：编辑器记下载入基线，Agent 产出新版后提示过期并拒绝保存；服务层按阶段与修订号核对 | continuation-page.test、continuation-orchestrator.test「R10B-07」 |
| R10B-08 数据管理页诊断忙碌态恒为 false | P3 | 已修：删除空转的运行时诊断与 1Hz 轮询，危险按钮统一用真实忙碌态 | data-mgmt-page.test「R10B-08」 |
| R10B-10 飞行模式开关无在途锁 | P3 | 已修（随 R10A-04） | dashboard-page.test |
| R10B-11 输入法回车提前提交 | P3 | 已修：组字期间的回车不提交 | ub-dialog-host-ime.test「R10B-11」 |
| R10B-12 store 忽略保存失败 | P3 | 已修：保存失败原地回滚并返回失败，不再弹「已保存」 | content-replace-store.test、plot-preset-store.test「R10B-12」 |
| R10B-13 正文替换单忙碌槽、切预设丢自定义提示词 | P3 | 已修：在途时拒绝其它耗时操作；从未存为预设的自定义提示词切走前确认 | content-replace-page.test「R10B-13」 |
| R10B-14 数据视图删行跨确认框按下标 | P3 | 已修：按 row_id 定位，确认后重新查找 | open-visualizer-surface.test「R10B-14」 |
| R10B-15 保存中编辑控件不禁用、关闭复位保存态 | P3 | 已修：保存中禁用编辑区，保存在途时不允许关闭 | open-visualizer-surface.test「R10B-15」 |
| R10B-16 主题 token 过滤可被转义绕过 | P3 | 已修：拒绝反斜杠转义、各类资源函数（含厂商前缀）与协议 URL | theme-store.test「R10B-16」 |
| R10B-17 剧情页条目刷新无序号守卫 | P3 | 已修：加载序号守卫，旧请求结果丢弃 | use-plot-worldbook-entries.test「R10B-17」 |
| R10B-18 下载工具重复实现 | P3 | 已修：并入 host-download，约定测试禁止新版界面另写下载 | host-download-conventions.test「R10B-18」 |
| R10B-19 死代码与过时注释 | P3 | 已修：删除侧栏 SQLite 可见性开关、退役续写 store、正文替换按草稿名操作的三个动作、剧情预设两个无调用动作、可视化器/宿主环境/资料状态/外壳 store 的未用函数与计数、数据管理文案未用分节；改正菜单按钮、启动入口、样式注入、持久化、正文替换开关、预设导入的过时注释。复核：shared-copy 仍被四个文案文件引用，保留 | — |
| R10B-20 功能页开关只在仪表盘刷新时同步 | P3 | 已修：切聊天、重新打开界面、导入合并设置、恢复默认后按设置整体同步入口，入口被隐藏时收回当前页 | router-store.test「R10B-20」 |

修 R1-01 时全量发现运行时 content 单元格可能是真数值（非字符串），escapeValue 已兼容。

待修：无。块 1–10 全部收口（不修/保留项均已注明理由）。
R4-02 遗留：模型放弃补齐时，草稿（partial）不会阻止水位推进——只在提升路径堵住了「写齐却看不见」，「没写齐就收工」仍按旧口径。

测试稳定性：重型页面套件首个用例冷导入整张 V2 模块图单跑 11–15s，贴着原全局 15s 上限，本机并行全量必超时（发布基线同样失败）；全局 testTimeout 调为 60s。
