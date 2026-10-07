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
| 1 | data/（storage、sqlite、repositories、gateways、models） | 9.7k | 完成（向量存储并入块 5） |
| 2A | service/table 填表流水线（orchestrator、sql-table-service、事务、调度） | 15k | 子代理完成 → `docs/review/block2a-fill-pipeline.md`；P1 已修，P2 待修 |
| 2B | service/table 存储帧/回放/迁移 | 15k | 子代理完成 → `docs/review/block2b-storage-replay.md`；P1 已修，P2 待修 |
| 3 | service/chat + service/runtime + service/settings | 17.8k | 子代理完成 → `docs/review/block3-chat-runtime-settings.md`；P1 待修 |
| 4 | service/continuation + service/agent | 30k | 子代理完成 → `docs/review/block4-continuation-agent.md`；P1 与 R4-05 已修 |
| 5 | service/vector + data/storage 向量部分 | 12.4k+ | 未开始 |
| 6 | service/template + template-assistant + worldbook | 13.3k | 未开始 |
| 7 | shared/ | 9.8k | 未开始 |
| 8 | service/ai、plot、optimization、flight-mode、其余小模块 | 5k | 未开始 |
| 9 | presentation（旧 bootstrap/triggers/api-groups） | 5.4k | 未开始 |
| 10 | presentation-v2 逻辑层（stores/composables）+ presentation-v3 | 28k | 未开始 |

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

**R1-03 [P2] `clearTableFieldsForIsolation_ACU` 就地改写缓存容器**
- `src/data/repositories/chat-message-data-repo.ts:1461-1470`：对 `parseIsolatedDataField` 返回的对象（字符串形态时是 WeakMap 缓存的解析结果，对象形态时是消息原对象）直接 `delete`。
- 与同文件 1750 行注释所立的「整体换字段、不就地改」契约相悖；字符串形态下解析缓存与消息字段短暂不一致。当前调用方无快照回滚，暂无实害，属契约破口。

**R1-04 [P2] `hasAnyTableData_ACU` 只认 V1 `independentData`，不认 V2 `storageFrame`**
- `chat-message-data-repo.ts:1527-1532`。唯一调用方 `table-history.ts:231-238` 已先判 V2 storageFrame 再回落，故当前无实害；函数名与语义不符，后续新调用方易踩。

**R1-05 [P2] SQL 分句器多处复制、且都不识别 `--` / `/* */` 注释**
- 复制品：`sql-table-service.ts:2770 splitSqlStatements`、`storage-frame-v2-replay.ts:1200`（逐字复制）、`restricted-sql-dml.ts:98`、`presentation/bootstrap/api-groups/sql-api.ts:248`、`sql-normalizer.ts`（也不认块注释、双引号标识符）。
- 风险：AI 写 `-- 更新角色; 补充` 这类带分号的注释会被切断成坏语句；写入期与回放期若某处修了另一处没修，回放与原执行结果分叉。
- 建议：收敛为 shared 单一实现 + 共用测试。

**R1-06 [P3] 油猴（userscript）模式分支全部是死代码**
- `entry-extension.ts:17` 恒 `_forceExtensionMode()`；`tavern-storage.ts:31-77,121-156,167-177` 的 bridge 注入 / `import('./script.js')` 等永不执行。其他 `isExtensionMode()` 分支同理（共 8 处）。

**R1-07 [P3] 小项**
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
| R2A-04 flush 失败重载冲掉待写回行 | P2 | 部分修：flush 提交声明 applyMutatesRuntime:false，不再重载。普通提交失败重载仍会冲掉未 flush 的行（未修） | table-update-commit.test「不得重载」 |
| R2A-06 legacy 首次初始化用模板覆盖运行时 | P2 | 已修：先克隆共享视图；仅运行时缺表时用模板补 | update-orchestrator.test「首次初始化：AI 未改动」 |
| R2B-02 in-flight 等待方丢兼容诊断字段 | P2 | 已修：等待方返回完整结果深拷贝；去重 key 改为仅显式 updateRuntimeState:false | replay.test「等待方拿到」「未显式声明」 |
| R2B-03 回放重算 random()/now | P2 | 已修：涉及非确定性函数（含 DDL DEFAULT）的表改以执行后快照 sheet_replace 落盘 | update-orchestrator.test「随机/当前时间」 |
| R2A-08 并发组提前清全局填表标志 | P2 | 已修：processUpdatesBatch 只在自己置位时复位标志与停止信号 | update-orchestrator.test「外层调度已持有」「本批自己持有」 |
| R4-01 逐栏写证据楼层上限用旧水位 | P1 | 已修：上限改为本次结算目标（当轮末楼），与整行事务同口径 | agent-module-store.test「结算窗口内的新 AI 楼」 |
| R4-02 逐栏写齐的条目不进领域数组 | P1 | 已修：提交层把写齐记录转整行 upsert，走同一事务校验/修订号推进后落快照；不合规留草稿并经 partials[].promotionError 回给模型；工作流按修订号增长记 complete_changed。帧层 T2 锁定不变 | agent-module-store.test「提升为正式领域条目」×4、「固定工作流：维护子代理只用 write_sql」 |
| R4-03 资料补足开放 write_sql 必然 STALE | P1 | 已修：补足通道不再开放 write_sql，只收整行契约由编排器提交 | agent-material-repair-channel.test |
| R4-04 接管期间删条目后恢复永不收敛 | P1 | 已修：宿主已删除的条目直接从接管账本剔除（含旧版残留 pending）；scope 恢复不再把已删除计入 skipped | agent-worldbook-takeover.test「条目被删除」×2、snapshot-restore.test |
| R4-05 补足裁剪漏 chronologyPatches | P2 | 已修 | agent-workflow.test「R4-05」 |

修 R1-01 时全量发现运行时 content 单元格可能是真数值（非字符串），escapeValue 已兼容。
R2B-08/09（迁移、混合提交、batch 写入的整聊天克隆替换）与上面同一模式但无 await 窗口，未改，留作 P3。

待修：R2A-07（多 staging 组汇合后丢 pre 段）、R2B-04/05/06（待坐实）、R3-01/02（P1，模板变量 SQL/JS 白名单可绕过）及块 3 P2、R4-06（待坐实）/07/08、各块 P3。
R4-02 遗留：模型放弃补齐时，草稿（partial）不会阻止水位推进——只在提升路径堵住了「写齐却看不见」，「没写齐就收工」仍按旧口径。
