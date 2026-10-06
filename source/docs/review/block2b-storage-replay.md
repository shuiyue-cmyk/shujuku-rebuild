# 块 2B 复审：存储帧 / 回放 / 迁移（service/table）

> 只读复审。行号以当前工作区为准。「已坐实」= 跑过探针或读穿调用链；「待坐实」= 推演结论，修前必须先写红用例。
> 探针文件已移出仓库，存放于会话 scratchpad：`zz-review-probe-2b.test.ts`、`zz-review-probe-2b-recovery.test.ts`。

## 覆盖范围

**通读**：storage-frame-v2-types.ts；storage-frame-v2-persist.ts 的主写路径（`persistTableMutationLogV2Core_ACU` 2176-2754、batch 2879-3083、sheet checkpoint 3110-3211、null-row 自愈 3218-3348、`commitCurrentFloorTemplateChanges_ACU` 3649-4381、demote 1400-1555）；storage-frame-v2-replay.ts 的主回放路径（帧收集、生命周期派生、SQL 段 hydrate/materialize、`loadTableStateFromFramesV2DetailedCore_ACU`、in-flight 去重与 evidence 复用、Tier-1 兼容降级、后台过渡根固化）；storage-v2-migration.ts；table-v2-recovery-service.ts（commit 路径与候选构造）；mixed-storage-decision.ts；mixed-storage-commit.ts；table-schema-migration.ts；table-import-service.ts；table-checkpoint-transfer.ts；table-data-repair.ts；table-data-upgrade-audit.ts；storage-strategy-resolver.ts；v2-replay-session.ts；chat-message-data-repo.ts 的 purge 段（440-900）；sync-bridge.ts 的导出与建表段。

**略读**：persist 的 introduction/history evidence 判定（1600-2160）；replay 的 legacy tolerant 回放与多 boundary 捕获（3075-3320）；chat-service 的 compaction/periodic 边界（只看了前滚步长与单根断言）。

**未覆盖**：compat-transition-checkpoint.ts、spv79-transition-checkpoint.ts、canonical-checkpoint-builder.ts、canonical-snapshot-envelope.ts、mixed-storage-evidence.ts、mixed-storage-snapshot-transfer.ts、mixed-storage-decision-registry.ts、schema-migration-planner.ts、schema-migration-preflight.ts、template-state-reset.ts、template-switch-mode-resolver.ts、table-storage-strategy.ts、storage-mode.ts、sqlite-template-validation.ts 只看了被调用的签名，没有逐行审；table-v2-recovery-service.ts 的 diagnose 分类（466-650）未细审；manual-catch-up-provisional-bridge 不在范围内。

## 总结

| 级别 | 数量 |
|---|---|
| P0 | 0 |
| P1 | 1 |
| P2 | 5 |
| P3 | 4 |

---

## 发现

**R2B-01 [P1 已坐实] V2 恢复提交用「锁外克隆的旧聊天」整体替换宿主 chat，窗口内的新消息、编辑和写入被静默丢弃并落盘**
- 位置：`src/service/table/table-v2-recovery-service.ts:697-735`（699 行克隆，729 行 `plan.chat.splice(0, len, ...candidateChat)`）
- 现象/触发路径：`commitPreparedV2Recovery_ACU` 在**锁外**用 `buildRecoveredCandidateChat_ACU`（即 `clone_ACU(plan.chat)`，263-266 行）克隆整个聊天，随后有两段 await：`validateRecoveredCandidateReplay_ACU`（一到两次全量冷回放）和 `runTableWriteTransaction_ACU`（排他模式会等正在进行的填表）。进入提交后只检查三项：chat 引用、chatKey、isolationKey（`currentScopeMatches_ACU`），以及受影响帧的指纹（`planAffectedFramesUnchanged_ACU`）。检查通过就用旧克隆整体替换并严格保存。这段时间里，宿主追加的消息、对未受影响楼层的编辑或 swipe、其他隔离键的写入、等锁期间完成的填表写入，全部被回滚掉并写进存档。所有消息对象也都被换成克隆（见 R2B-08）。
- 入口：数据管理里的 V2 恢复（UI），以及手动重填前的自动收敛 `update-orchestrator.ts:4893 ensureManualRefillAnchorHealth_ACU`，后者会自动执行 prepare+commit。
- 证据：探针用 mock 模拟「等锁期间宿主追加一条用户消息并改了 a2 的文本」，结果是：
  `P3 commit committed` / `P3 chat after ["a0","u1","a2"] saveCalls=1 sameObj=false`。新消息消失，编辑被还原，并且已经调用保存。
- 修法方向：在 runCommit 临界区内基于 live chat 重建候选，只替换受影响消息的 `TavernDB_ACU_IsolatedData` 字段（与 persist 主路径的 `replacementIsolatedDataByMessageIndex` 做法一致），不要整体 splice；至少要在提交前比对 chat 长度和全部消息指纹。

**R2B-02 [P2 已坐实] in-flight 回放去重的等待方拿到的结果缺少 `compatibilityRepairs` / `requiresCheckpointConvergence` / `legacyToleranceDiagnosis` / `identityMerges`**
- 位置：`src/service/table/storage-frame-v2-replay.ts:2920-2951`（等待方只返回 `{data, baseKind, metrics}`）
- 现象/触发路径：同一个 chat 数组、同一组 options 的两次并发只读回放会共享一次 core。启动方拿到完整结果，等待方丢掉上面这些字段。对 `temporary_sheet_anchor` 修复来说，`baseKind` 仍是 `full_checkpoint`，判断「需要收敛」只靠 `compatibilityRepairs` 和 `requiresCheckpointConvergence` 两个字段。于是等待方看到的是一个干净的严格回放，各写门闸的判断 `requiresCheckpointConvergence || compatibilityRepairs?.length` 会被放行。受影响的位置：chat-service.ts:1783/1836（追平锚点预检）、manual-catch-up-provisional-bridge.ts:597/729/816、mixed-storage-decision.ts:262/273、table-v2-recovery-service.ts:525/548 等。
- 证据：探针对同一份「重复 row_id 再接 SQL」的历史发起两次并发 `loadTableStateFromFramesV2Detailed_ACU(chat,'',{updateRuntimeState:false})`：
  `P1 starter compat_tolerant_replay true true` / `P1 waiter compat_tolerant_replay undefined false`。
- 修法方向：等待方返回共享结果的完整深拷贝，只覆盖 `metrics`。另外，key 构造的判断是 `options.updateRuntimeState` 为真值时才跳过去重（85 行），而 core 的判断是 `!== false` 才有副作用，两边口径不一致，可以一并统一。

**R2B-03 [P2 已坐实] 回放会重新执行非确定性 SQL（`random()`、`datetime('now')`、`strftime('%f','now')`、`DEFAULT CURRENT_TIMESTAMP` 等），每次加载得到不同的数据**
- 位置：写入端在 `src/service/table/sql-table-service.ts:2711-2737` 落盘原始语句；回放端在 `src/service/table/storage-frame-v2-replay.ts:1873` 用 `runtime.engine.runBatch` 原样重新执行。
- 现象/触发路径：写入时只把 INSERT…SELECT 物化成字面量，函数调用照原样存进日志。如果 AI 写出 `UPDATE 角色 SET HP = HP - (abs(random())%6+1)` 这类掷骰 SQL，或者模板 DDL 带时间默认值，回放结果就会和写入时的结果不一致，每次载入聊天也互不相同。这个状态之后被 periodic/compaction checkpoint 固化成某一个随机值。全仓库没有找到拒绝这类函数的校验：`restricted-sql-dml` 只用于 agent。
- 证据：探针对同一条日志连续回放两次：
  `P2 replay#1 [["1","129326"],["2","23.126"]]` / `P2 replay#2 [["1","887135"],["2","23.164"]]`。
- 修法方向：写入端检测非确定性函数，拒绝或在执行前物化（参照 INSERT…SELECT 的物化思路，或者写入后把受影响行用 `row_upsert`/参数化值固化进日志）；DDL 校验时禁止非字面量 DEFAULT。

**R2B-04 [P2 待坐实] 模板提交带硬删除时，同批的 reveal/introduction 唤醒数据被丢弃，休眠表被模板空壳覆盖**
- 位置：`src/service/table/storage-frame-v2-persist.ts:4257-4298`
- 现象/触发路径：`deletedSheetKeys` 非空时会改写成一个新的 full checkpoint：`terminalData = options.templateSource`，`persistedCheckpoints = []`，`delete frame.perSheetCheckpoints`。这样，同一次提交里通过 `resolveRevealSource_ACU` 解析出的 `revealDataBySheet`（4016-4028、4076-4097，休眠表离开时的真实数据）和 hide checkpoint 都没有写入，基底直接取 caller 的 `templateSource`。而协调器对 reveal 表只放模板结构（`chat-template-reconciler.ts:157-162` 的注释写明「协调层只带模板结构，数据由 persist 层恢复」）。结果是休眠表的数据在新基底上变成表头或 seed 空壳，生命周期判定为 active，旧数据只剩新基底之前的旧帧里还有，compaction 清理后就永久丢失。`validateHardDeleteCandidate_ACU` 拿回放结果和同一个 terminalData 比较，必然相等，拦不住。
- 触发条件：协调计划同时包含 hardDelete 和 hidden→reveal（`hardDeleteMissingSheets:true`，例如 flight-mode 的 `applyChatTemplateSnapshotWithReconciliation_ACU`，或 API 调用），或者 visualizer 删表的同时，新增的表 key 命中了一张有历史的休眠表。现有 UI 的模板切换没有暴露 hardDelete，所以不算常见路径。
- 修法方向：硬删除分支应以 `activeReplayState` 加上 reveal/rebase/introduction 的解析结果构造 terminalData，而不是直接用 templateSource；或者在 `deletedSheetKeys` 和 reveal/hide 同时出现时拒绝提交。

**R2B-05 [P2 待坐实] 写时严格探针只校验到目标楼层，向早期楼层追加增量可能弄坏后缀回放，并让全聊天进入只读兼容态**
- 位置：`src/service/table/storage-frame-v2-persist.ts:679-698`（`maxMessageIndex: targetMessageIndex`）、2695-2708；batch 路径在 3028-3037。
- 现象/触发路径：注释（670-678 行）说明这道探针是为了防止「追平以 live 快照为基底却写到早期楼层」导致的 UNIQUE 冲突，但它只回放 `≤ target.index` 的部分。如果目标楼层之后的帧里，同一张表还有用相同 row_id 的 INSERT，或者依赖旧行的 UPDATE，就会出现三种情况：目标楼层边界严格回放通过，于是落盘成功；头部回放撞上 UNIQUE 冲突，或者 UPDATE 落空导致结果静默不同；头部严格回放失败后转入 Tier-1 宽容回放，此后所有写路径都被 `compat_tolerant_replay` 门闸拒绝。persist 层也明确不比较回放结果与 afterData（62-64 行）。是否真的会触发，取决于追平/重填在写早期楼层前，是否已经用 `replaceExistingIncremental` 清掉了后缀楼层里同表的增量（属于块 2A 的编排逻辑，这里没有验证）。
- 修法方向：`target.index < 最后一个 V2 帧` 时，多跑一次不带 `maxMessageIndex` 的严格回放（批量写已有 `loadTableStatesAtBoundariesFromFramesV2Detailed_ACU`，可以一次前向捕获两个边界），失败就拒绝写入。

**R2B-06 [P2 待坐实] 后台兼容过渡根固化在锁外计算 cutoff 和目标楼层，锁内不校验聊天是否变化**
- 位置：`src/service/table/storage-frame-v2-replay.ts:3323-3426`、3455-3470
- 现象/触发路径：`createCompatTransitionCheckpointFromTolerantReplay_ACU` 在锁外完成三件事：宽容回放、计算 `cutoff{messageIndex,seq,operationIndex}`、确定 `targetMessageIndex`。进入排他事务后只检查 `chat[targetMessageIndex]` 是不是 AI 楼层、cutoff 有没有被更新的根覆盖，不检查 chat 引用、chatKey，也不检查中间有没有删楼或插楼。如果这段时间里删掉了一条 cutoff 之前的消息，持久化的 cutoff.messageIndex 就和实际楼层错位，之后从过渡根做严格回放时会跳过或重放错误的 entry，数据静默漂移。如果中途切换了聊天，就会改写旧聊天的消息对象，然后保存当前聊天。
- 修法方向：在 runCommit 内重新校验 `getChatArray_ACU() === chat`、chatKey，以及所有 V2 帧 headRevision 的 digest（可以复用 `computeReplayHeadRevisionDigest_ACU`），不一致就放弃固化。

**R2B-07 [P3 已坐实（读码）] 硬删表会在最新楼层写出第二个 full checkpoint，违反单根不变量**
- 位置：`src/service/table/storage-frame-v2-persist.ts:4283`；测试 `tests/service/table/storage-frame-v2-persist.test.ts:3684-3727` 固定了「历史帧仍保留 checkpoint、目标帧另写 full」的行为，可以视为有意为之。
- 现象：这和 persist 层多处「同一隔离键同一时刻只允许一个 full」的注释和断言（707、933、2418、2934、3916 行，checkpoint-delete-guard.ts:574，update-orchestrator.ts:4899）互相矛盾。副作用有两个：回放根跳到最新楼层，所以在 periodic/compaction 把冗余根降级之前，所有早期楼层的追平都被「写目标早于回放根」拦下；删楼守卫的嫁接恢复会因为多根断言失败。
- 修法方向：硬删除分支写完新基底后，同事务把其余 full 降级（复用 `downgradeOtherFullCheckpoints_ACU` 的语义），或者在注释和不变量里明确写出这个例外。

**R2B-08 [P3] 迁移、混合提交、恢复都用克隆整体替换宿主 chat 的消息对象，失败回滚时还原的也是克隆**
- 位置：`storage-v2-migration.ts:682/686/846/850`、`mixed-storage-commit.ts:272/276`、`table-v2-recovery-service.ts:729/733`
- 现象：即使没有 R2B-01 那样的并发窗口（迁移和混合提交在克隆和 splice 之间是同步执行的），所有消息对象的身份也都换掉了。宿主或插件持有的消息引用（删楼保管库用对象引用判定楼层是否幸存）会失效，直到下一次保存时重建；保存失败的回滚分支还原的是 `clone_ACU(chat)`，同样换掉了对象身份。
- 修法方向：只替换受影响消息的表格字段，或者按字段级快照回滚（persist 主路径已有现成做法）。

**R2B-09 [P3] batch 写入每批深克隆整个聊天，包括消息正文**
- 位置：`storage-frame-v2-persist.ts:2926`（另有 1362、1457 两处同类用法，属于低频路径）
- 现象：`deepClone_ACU` 用的是 JSON 往返。长聊天（数 MB 正文）上的追平或重填，每批都要做一次全量 stringify+parse，外加两到三次从根开始的冷回放。回放链长度受 periodic 前滚限制（缓冲 20 层加步长 20 层），所以问题集中在克隆上。
- 修法方向：沿用单目标路径的 `buildCandidateChatWithIsolatedDataOverrides_ACU`，只对目标消息的隔离字段做浅替换。

**R2B-10 [P3 待坐实] 回放时重新分句（flatMap）会让 `params` 与语句错位**
- 位置：`storage-frame-v2-replay.ts:1234-1238` 与 1872-1873
- 现象：存储的每条语句在回放时还会再分句一次，然后 `filter(Boolean)`，但 `operation.params` 仍按原下标对齐交给 `runBatch`。只要某条已存储的语句被拆成多条（这是已知 R1-05 的 `--` 注释问题），或者某条语句在剥除 HTML 注释后为空被过滤掉，后面所有参数化语句都会绑到错误的参数上。参数化语句主要来自手动 CRUD，单条语句里一般不带分号，所以概率低。这条是 R1-05 的延伸，统一分句器时请顺带处理。
- 修法方向：带 params 的 operation 在回放时不再分句；或者分句后语句数不等于原语句数时直接 fail-closed。

---

## 已核对、判定为非问题或已有设计保障（供后续块参考）
- 运行期 full checkpoint 已改为「单一保留边界加 periodic 前滚」（chat-service `PERIODIC_V2_FULL_CHECKPOINT_ROLL_STEP_AI_LAYERS_ACU=20`），所以每次写入时两到三次冷回放的链长是有界的，不会出现 O(n²) 的问题。
- introduction/rebase/reveal 用 `afterSeq = 最后 seq`，hide 用 `最后 seq + 1`，配合回放的 `afterSeq < nextSeq`，写入端和回放端的顺序一致。
- 写入端已经把 INSERT…SELECT 和锁定补偿语句物化后再落盘（sql-table-service 2706-2737），回放不会依赖当时的查询结果（非确定性函数除外，见 R2B-03）。
- evidence 复用（v2-replay-session）只在同一次 persist 调用内的两次同边界回放之间使用，期间 chat 不会变，所以 headRevision digest 不覆盖 per-sheet checkpoint 写入这个缺口不会造成实际影响。
- 导入（table-import-service）在已有锚点时走 `data_replace` 增量，没有锚点时走 init/migration 基线，和 persist 的单根逻辑一致。
