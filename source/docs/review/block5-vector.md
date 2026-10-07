# 全库复审 · 第 5 块：向量（纪要向量镜像 / 召回 / 外置存储与 GC）

审查方式：只读审查。结论分两类：「已坐实」指探针复现或调用链完整追踪过，「待坐实」指推断。探针都放在会话 scratchpad，`source/tests` 下没有留下。

## 覆盖范围

**全文精读**
- `src/service/vector/summary-vector-index-runtime.ts`（发送前召回主链路）
- `src/service/vector/summary-vector-mirror-writer.ts`（增量 flush）
- `src/service/vector/summary-vector-mirror-rebuild.ts`（initial / rebuild_user / rebuild_repair / 清楼层后剩余行发布）
- `src/service/vector/summary-vector-mirror-resolver.ts`
- `src/service/vector/summary-vector-mirror-storage.ts`
- `src/service/vector/summary-vector-mirror-fold.ts`
- `src/service/vector/summary-vector-index-flush-queue.ts`
- `src/service/vector/summary-vector-index-chat-deletion-gc.ts`
- `src/service/vector/summary-vector-index-chat-commit.ts`
- `src/service/vector/summary-vector-index-chat-service.ts`
- `src/service/vector/summary-vector-index-rebuild-service.ts`
- `src/service/vector/summary-vector-embedding-batches.ts`
- `src/service/vector/summary-vector-hybrid-retrieval.ts`
- `src/service/vector/summary-vector-row-fingerprint.ts`
- `src/service/vector/summary-vector-index-scope-resolver.ts`
- `src/service/vector/summary-vector-index-realign-state.ts`
- `src/service/vector/remote-memory-snapshot-anchor.ts`
- `src/service/vector/summary-vector-index-types.ts`
- `src/data/storage/vector-index-st-files-storage.ts`

**部分精读或略读**
- `summary-vector-index-storage-service.ts`：精读了可达性收集与 Safe GC（L862–1400）。legacy 的 persist、load、health、stats 只看了调用关系。
- `summary-vector-index-archive-service.ts`：精读了 `buildPreparedRows_ACU`、源文本与切块、`migrateLegacySummaryVectorIndexToContentAddressed_ACU` 的入口和写入点。legacy 归档流水线只确认了已经不在主链路上。
- `summary-vector-index-cache-service.ts`：读了清缓存、清队列和 preload。
- `vector-memory-config.ts`：读了 effective / validate。
- `summary-vector-index-content-pack.ts`：读了 blob 构造与 hash 序列化。
- 调用方契约：`table/table-write-transaction.ts`（锁、assertFresh、derived_metadata 不 bump）；`chat-message-data-repo.ts` 的 `patchIsolatedTagMetadata_ACU`；`chat/chat-service.ts` 中 compaction 调 fold 的部分（L680–770、L856–1128）；`table/summary-sheet-rowid-timeline.ts` 的 rowId 口径；`chat-gateway.ts` 的 `listAllHostChatNames_ACU`。

**未覆盖**
- `data/storage/vector-index-hot-cache.ts`：只看了函数清单和 flush task 的调用方式。镜像主链路不读 chunk 热缓存。
- `data/storage/vector-index-temp-cache.ts`、`summary-vector-index-state-service.ts`（legacy 层聚合）。
- `summary-vector-index-storage-service.ts` 的 legacy 写入（rolling delta / snapshot）、health 报告、stats 细节。
- `data/storage` 下与向量无关的 `optimization-cache-storage.ts`、`chat-history.ts`、`tavern-storage.ts`、`config-storage.ts`。

**整体印象**：读侧设计比较严密。镜像 head 只有一个读取入口（resolver），delta 与来源 table entry 同生共死，链冲突会触发自动修复；召回在维度不一致、chunk 残缺或 hash 失配时一律拒绝使用，不会拿错数据。GC 删除前会回读 blob、核对身份、校验 checksum，并有 grace 窗口和 prepared 保护，没找到「同一聊天内误删可达对象」的路径。

问题集中在写侧：
- 回滚方式：事务外拍整容器快照，失败时整块覆盖回去。
- 增量判定：每次 flush 都全表重嵌。
- 内容寻址复用和回收在边界上互相打架。
- GC 的可达性只看当前打开的聊天，与分支、改名后的跨聊天引用冲突。

另外，镜像迁移后，有两处旧契约在新链路上失效了：flush 代次墓碑、legacy 迁移按钮。

---

## 汇总

| 级别 | 数量 | 编号 |
|---|---|---|
| P0 | 0 | — |
| P1 | 1 | R5-01 |
| P2 | 6 | R5-02 ～ R5-07 |
| P3 | 5 | R5-08 ～ R5-12 |

---

## P1

**R5-01 [P1 已坐实] 镜像 flush / 重建失败时，用「事务外拍的整容器快照」覆盖回滚，会把并发写入方已提交的表格 entry 从内存里抹掉，下一次保存再写盘**
- 位置：
  - `summary-vector-mirror-writer.ts:461`：在 `runTableWriteTransaction_ACU` 之前，深拷贝 plan 所在楼层的整个 `TavernDB_ACU_IsolatedData`。
  - `:545`：catch 里 `restoreIsolatedData_ACU(snapshots)`，整块赋值回去。
  - `summary-vector-mirror-rebuild.ts:669` / `:715`（rebuild）和 `:320` / `:372`（`publishSummaryVectorMirrorRowRemovalSnapshot_ACU`）：拷贝范围更大，是全聊天每一楼、所有隔离槽。
- 现象/触发路径：
  1. flush 在 embedding 前（`writer.ts:349`）捕获 baseRevision，embedding 完成并上传 pack 后拍快照，然后去拿纪要表的 sheet 写锁。
  2. 此时如果另一个纪要表写入方（填表提交、手动 CRUD、批量补填的单步提交）正持有锁，flush 就等它。对方在锁内向同一楼层追加 log entry 并 strict save。
  3. flush 拿到锁后，`assertFresh`（`:473`）发现 revision 已推进而抛错，进入 catch，把快照整块写回。对方刚提交的 entry 就从内存里消失了。
  4. 对方的盘上版本当时还在，但下一次任意 `saveChatToHostStrict_ACU` 会把回退后的内存写盘，entry 永久丢失；reload 后回放也会缺这段写入。
  5. strict save 失败这条路径同理。rebuild 和剩余行发布会还原全聊天、所有隔离槽，影响面更大：其他隔离槽的写锁根本不互斥，期间任何提交都会被回滚掉。
- 证据：探针 `zz-review-probe-r5-refresh-growth.test.ts` 的用例「race: summary writer holding the lock while flush snapshots」。flush 在 embedding 中途，另一个 `manual_crud` 事务先拿锁，在锁内向末楼追加 `concurrent-fill-entry` 并提交。flush 返回 `vector_mirror_commit_failed`，末楼 `logEntries` 里已经没有 `concurrent-fill-entry`。现有的 `summary-vector-mirror-revision-race.integration.test.ts` 只覆盖了「embedding 期间写入（快照之前）」的情形，那种情况下快照里本来就有对方的写入，所以没暴露出问题。
- 修法方向：
  - 回滚只针对自己改过的字段：`storageFrame.summaryVectorIndexFrame`，以及 rebuild 清掉的 legacy 字段。
  - 快照在拿到锁之后（`runCommit` 内）再拍。
  - 回滚前比对对象身份，确认对象仍是自己写入的那份；不是就放弃回滚，交给 resolver 和 rebuild_repair 收敛。
  - rebuild 的快照范围收窄到当前隔离槽。

---

## P2

**R5-02 [P2 已坐实] 每次 flush 都把 head 里的所有既有行当作「可能改了正文」重新 embedding，嵌入次数随表长线性增长；召回时还要逐个下载全部历史 pack**
- 位置：
  - `summary-vector-mirror-writer.ts:144-153`：`planUnmirroredEntryDeltasV2_ACU` 在首个未镜像 entry 上，把所有 `before ∩ head` 的行放进 `refreshed`，不比较任何内容哈希。
  - `summary-vector-mirror-resolver.ts:536`：applied delta 的 packRefs 全部并入 `head.packRefs`，被 refresh 取代的旧 pack 也在里面。
  - `summary-vector-index-runtime.ts:456`：召回前 `for (const packRef of head.packRefs)` 逐个 HTTP 读取。`getUserFileUrl_ACU` 带 `?t=Date.now()`，浏览器缓存无效。
  - `summary-vector-mirror-rebuild.ts:733`：rebuild 结束后调用 flush，又把刚 embedding 过的 C 行 refresh 一遍。
- 现象/触发路径：
  1. 任何一次触及纪要表的填表都会排队 flush。哪怕只新增 1 行，flush 也会重嵌整张表的 N 行，并写一个装着 N 行向量的新 pack，外加 remove/add 两条 delta（row_add 里带 N 行的 chunk 引用）。
  2. head.packRefs 每次 flush 增加一个全表 pack，发送前召回要下载的数据量接近「flush 次数 × N」。
  3. 只有 compaction fold（约 20–40 个 AI 楼层滚动一次）才会把它们折叠回一个 pack。
  4. 一次 rebuild_user / initial，只要 C 之后存在任何 entry，就会把 C 行整体 embedding 两遍。
- 证据：探针 `zz-review-probe-r5-refresh-growth.test.ts`，用真实 resolver、writer 和事务，存储在内存里。
  - 3 行起步，每轮只新增 1 行，连续 6 次 flush 的 embedding 条数是 `[4,5,6,7,8,9]`。期望值应是每次 1 条。
  - `head.packRefs` 依次为 `[2,3,4,5,6,7]`，第 6 次召回要加载的 chunk 总数是 42，实际只需要 9 个。
  - rebuild_user 用例的 embedding 调用是 `[3,4]`，即 C 的 3 行被嵌了两次。
  - 现有测试 `summary-vector-mirror-revision-race.integration.test.ts`（「同 rowId 的未镜像 table entry 写入 remove/add refresh delta」）锁定了这一行为，但没有断言「内容未变时不重嵌」。
- 修法方向：
  - refresh 前比对哈希：用 head 中该行 row_add 的 `vectorSourceHash`（或 pack chunk 的 `textHash`）与实时行的 `vectorSourceHash` 比较，只重嵌真正变了的行。
  - resolver 输出的 packRefs 只保留 head 行实际引用到的 pack，runtime 只加载这些。
  - rebuild 后的 flush 对已在 checkpoint 里、哈希一致的行跳过。

**R5-03 [P2 已坐实] 重建失败的回收会删掉「当前 checkpoint 仍在引用」的 manifest：内容寻址的 manifest 每次都按新文件处理**
- 位置：
  - `summary-vector-mirror-storage.ts:210-251`：`persistSummaryVectorMirrorManifestPrepared_ACU` 不判断路径是否已存在，直接覆盖上传，并 `registerPrepared_ACU`（`:240`），把已 published 的条目降级成 prepared。
  - 对比同文件 `:158-185`：pack 有 `createdNew:false` 保护，并注明「不得把它降级成当前事务的 prepared」。
  - `summary-vector-mirror-rebuild.ts:654`（`files.push(manifestPersist.file)`）与 `:720`（失败时 `discardSummaryVectorMirrorPreparedFiles_ACU(files)`）。
  - `summary-vector-mirror-fold.ts:144` 的 discard 也有同样结构。
- 现象/触发路径：
  1. rebuild_repair 复用全部 refs、行集合不变时，manifest 内容与现有 checkpoint 的 manifest 逐字节相同，因此 hash 相同、路径相同。
  2. 典型场景：召回时 pack 读取因网络抖动失败，导致 incomplete，自动触发 rebuild_repair，复用校验时又读成功了，于是生成相同的 manifest。
  3. 随后提交阶段 strict save 失败（与前面的网络问题同源，概率并不低），或者 assertFresh 冲突。
  4. 回滚把聊天还原成旧 checkpoint，但 discard 把同一路径的 manifest 删掉了。镜像变成 `manifest_unavailable`，只能全量重嵌恢复（这种状态下 rebuild_repair 无法复用任何 ref），并且还会连带触发 R5-05。
- 证据：探针 `zz-review-probe-r5-manifest-discard.test.ts`，用真实的 mirror-storage、rebuild 和 resolver，`vector-index-st-files-storage` 的 IO 换成内存实现。
  - rebuild_repair 时 strict save 失败，聊天里 checkpoint 的 `manifestRef.path` 不变，但该路径出现在删除列表里，resolver 结果从 `ok` 变成 `manifest_unavailable`。
  - 第二个用例证实：重新 persist 一次，就会把 registry 里已 published 的 manifest 改回 prepared。
- 修法方向：manifest 改成和 pack 一样，先读后写。路径已存在且内容一致时返回 `createdNew:false`，不重新注册，回收时跳过。discard 只回收本事务新建的对象。

**R5-04 [P2 已坐实] GC 的可达性只看当前打开的聊天；分支或改名后的聊天仍引用旧 chatKey 作用域的 pack/manifest，会被孤儿清扫、删聊天清理或 retention GC 删掉**
- 位置：
  - `summary-vector-index-storage-service.ts:912-983`：`collectSummaryVectorIndexReachability_ACU` 只遍历 `getChatArray_ACU()`。
  - `summary-vector-index-chat-deletion-gc.ts:145`：孤儿清扫把「不在存活聊天名单里」的 chatKey 作用域整体列为可删。
  - `:115-118`：删聊天事件触发同样的清理。
  - `runScopedRetentionGcAfterFlush_ACU`：retention GC。
- 现象/触发路径：
  1. 镜像引用的是带作用域 token 的绝对路径。ST 的「创建分支」和 checkpoint 聊天会连同 `TavernDB_ACU_IsolatedData` 一起复制楼层，所以新聊天的 frame 指向原聊天作用域下的 pack 和 manifest。聊天改名后，楼层里的引用同样仍指向旧 chatKey 作用域。
  2. 之后出现以下任一情况，这些文件在 grace（10 分钟）之后就会被删除：
     - 原聊天被删除，删除时打开的不是分支；
     - 改名后旧名不在存活名单里，启动清扫时打开的又不是改名后的那个聊天；
     - 原聊天自己 rebuild 或 fold 之后，旧 pack 在原聊天里不再可达，被它的 retention GC 回收，而分支仍在引用。
  3. 被删之后，分支或改名聊天在下次召回时会 incomplete 或 `manifest_unavailable`，自动修复会全量重嵌。属于可恢复的数据丢失，代价是重新付费和发送前的等待。
- 证据：调用链完整追踪。删除判据只有「作用域前缀匹配、registry 时间超过 grace、blob 自身身份一致、在当前聊天里不可达」四条，没有任何跨聊天引用的证据来源。仓内没有聊天改名或分支的迁移逻辑（grep 结果为空）。
- 修法方向：
  - 至少让孤儿清扫和删聊天清理只回收「不被任何存活聊天引用」的对象。可以按需枚举存活聊天的 frame 引用，或者在 registry 条目上记录引用方。
  - 或者在分支、改名首次 flush/rebuild 时，把被引用的对象复制或重新登记到新作用域。
  - 退一步，也应当把「原作用域在别处仍有引用」作为默认保留的方向。

**R5-05 [P2 已坐实] 向量镜像处于任何非 ok 状态时，fold 都会抛错，进而让整个表格 compaction 回滚：派生索引坏了，会持续阻塞主数据的 checkpoint 滚动**
- 位置：
  - `summary-vector-mirror-fold.ts:74`：`head.status` 不是 `ok`、`no_mirror`、`unsupported_replay_base` 时直接 throw。
  - `:79-82`：pack 读不到也 throw。
  - `chat/chat-service.ts:929 / 974 / 1124`：在 compaction 主流程内直接 await，没有 try。
  - `:735`：外层 catch 回滚全部楼层并返回 `success:false`。
- 现象/触发路径：
  1. 镜像停在 `source_table_changed` 的情况：模板更换后纪要表的 sheetKey 变了，writer 返回 needsRebuild，但这个原因不在自动重建白名单里（`flush-queue.ts:187-199`），任务被标为 `blocked_needs_rebuild`，要等用户确认。
  2. 镜像停在 `manifest_unavailable` 的情况：见 R5-03、R5-04。
  3. 网络抖动导致 pack 读取失败。
  4. 以上任一情况下，每一轮 compaction（清理、periodic 前滚）都会失败回滚。即使用户随后关掉了向量功能，fold 也不检查开关，阻塞会一直持续。结果是 replay 根不能前滚，旧楼层数据不能清理，聊天文件持续变大。
- 证据：调用链完整追踪。fold 在 `head.status !== 'ok'` 时抛错，三个调用点都没有捕获。
- 修法方向：fold 遇到非 ok 时不阻塞 compaction。可以剥掉 anchor 之前的镜像 frame，让下一次 flush 走 `no_mirror → initial` 重建；或者保留旧 checkpoint 并标记 needsRebuild。读 pack 失败也照此降级处理。功能关闭时直接跳过 fold。

**R5-06 [P2 已坐实] 「迁移旧交火索引」按钮写出的仍是旧 V1 指针，召回链路根本不读；按钮报告成功，召回依旧提示需要重建**
- 位置：
  - `summary-vector-index-archive-service.ts:1038` 起：`migrateLegacySummaryVectorIndexToContentAddressed_ACU` 内部调用 `persistSummaryVectorIndexSnapshot_ACU`，再用 `commitVectorMetadataPatch_ACU` 写入 `summaryVectorIndexState/Manifest`。
  - 调用方 `presentation-v2/composables/useVectorIndexConfig.ts:584`，成功文案是「新 V2 pointer 已 durable 发布」；`presentation/triggers/data-admin-ui.ts:262`。
  - `summary-vector-index-runtime.ts:818-822`：召回只认镜像 head。
- 现象/触发路径：
  1. 用户在 legacy 聊天上点击迁移：要下载全部旧向量、上传新快照、写回聊天指针，并提示成功。
  2. 但 runtime 只解析 `storageFrame.summaryVectorIndexFrame`，legacy 字段仍然存在，所以 `chatHasLegacySummaryVectorFields_ACU` 仍为真，召回仍返回 `legacy_vector_scheme_rebuild_required`。
  3. 迁移的成本白花了，文案也误导用户。
- 证据：调用链完整追踪。runtime、writer、rebuild 都不读取 `summaryVectorIndexState`；只有 rebuild 的 `clearLegacyVectorFields_ACU` 会清掉 legacy 字段。
- 修法方向：让迁移按钮直接走 `rebuildCurrentSummaryVectorIndexNow_ACU({ reason: 'initial' })`，或者把旧向量转成镜像 checkpoint；同时下线 legacy archive 写链路。

**R5-07 [P2 待坐实] 镜像 writer 与 rebuild 之间没有互斥，派生写入不 bump revision；运行时的自动修复与队列 flush 并发时，会产生链冲突或重复工作**
- 位置：
  - `summary-vector-index-runtime.ts:813` / `:839`：发送前同步调用 `rebuildSummaryVectorMirror_ACU({reason:'rebuild_repair'})`，没有经过 flush 队列的 running 集合或作用域锁。
  - `flush-queue.ts:523`：flush 也没有持有作用域锁。
  - `rebuild-service.ts:94`：`ensureSummaryVectorMirrorAfterTableFill_ACU` 同样直接 rebuild。
  - `table-write-transaction.ts`：`derived_metadata` 不 bump，所以双方的 `assertFresh` 都看不见对方。
- 现象/触发路径：
  1. 队列 flush 已经算好 plan（例如对 r5 做 row_add），并在 embedding。
  2. 此时发送触发 rebuild_repair，rebuild 写入 checkpoint 并清空 delta，然后自己再 flush 一次，也给 r5 写了 row_add。
  3. 之后队列 flush 提交时，plan 引用的 table entry 仍然存在，于是再追加一条 row_add r5。
  4. resolver 判定 chainConflict，下一次发送再触发 rebuild_repair。结果能自愈，但会反复重建，叠加 R5-02 时成本更高。
  5. 对于 `deleteCurrentSummaryVectorIndexFromChat_ACU` 删除索引之后，在飞的 flush 也会把 delta 重新写回去（见 R5-10）。
- 证据：推断。时序依赖真实网络耗时，没有写探针。
- 修法方向：把 writer 和 rebuild 统一放进 `runSummaryVectorIndexArchiveScopeMutationExclusive_ACU`，或者在 `runCommit` 内重新解析 head，并按 appliedTableEntryIds 去重后再追加。

---

## P3

**R5-08 [P3 已坐实] `summary-vector-index-runtime.ts` 里 legacy realign 一整段是死代码**
- 位置：`summary-vector-index-runtime.ts:513-737`（`isSingleFileSnapshotManifest_ACU`、`selectRealignSnapshotFromDisk_ACU`、`tryRealignSummaryVectorIndexPointerFromDisk_ACU`），没有任何调用方。
- 修法方向：删除。顺带清理只被它使用的 import（`loadVectorIndexRegistry_ACU`、`validateSingleFileSnapshotIdentity_ACU`、`commitVectorMetadataPatch_ACU` 等）。另外，legacy 的 archive/storage/hot-cache/temp-cache 整套代码（约 5k 行）现在只服务于迁移按钮（见 R5-06）和 health/stats 面板，维护成本高，建议一并评估是否下线。

**R5-09 [P3 已坐实] rebuild 中「全部复用」分支的维度赋值是空操作**
- 位置：`summary-vector-mirror-rebuild.ts:549-552`，`if (first) embedding.dimension = embedding.dimension;`
- 现象：意图应是从复用的 pack 取维度。实际维度仍是配置值，未配置时为 0，最后靠 `:614` 回退到旧 checkpoint 的 embedding 身份兜住。如果配置里写的维度与实际不一致，会把错误的 dimension 写进新 checkpoint。
- 修法方向：从复用 pack 的 `dimension`，或旧 checkpoint 的 `embedding.dimension` 取值。

**R5-10 [P3 已坐实] 镜像 writer 接收 `expectedFlushScopeKey/expectedFlushGeneration` 参数但从不校验，flush 队列的墓碑协议在新链路上已经失效**
- 位置：`summary-vector-mirror-writer.ts:213-214` 只声明了参数；`flush-queue.ts:526-527` 传入；`flush-queue.ts:638` 的注释写着「旧 runner 在真正发布聊天 pointer 前必须校验代次」。只有 legacy 的 archive-service（`:940`、`:1006`）还在校验。
- 现象：「删除索引」或「清空归档队列」之后，正在运行的 flush 照样提交 delta。目前下一次填表本来也会触发 initial 重建，所以实际影响很小，但注释给出的契约与实现不符。
- 修法方向：在 `runCommit` 内调用 `assertSummaryVectorFlushGenerationCurrent_ACU`，或者删掉这两个参数并修正注释。

**R5-11 [P3 已坐实] 删除索引的批量提交，在 V2-only 楼层上回滚是空操作**
- 位置：`summary-vector-index-chat-service.ts:274-282`（`additionalMutate` 原地 `delete tagData.storageFrame.summaryVectorIndexFrame`）；`summary-vector-index-chat-commit.ts:18`（快照只保存字段引用）。
- 现象：V2-only 楼层没有 V1 字段，`patchIsolatedTagMetadata_ACU` 判定为 no-op，不会换新容器，于是 `additionalMutate` 改的是原容器对象。strict save 失败时 rollback 把同一个对象赋回去，等于没回滚。UI 报删除失败，但内存里的镜像已经删了，下一次任意保存就会落盘。由于用户本来就是要删除，实际危害小，只是 `commitVectorMetadataPatchesBatch_ACU` 注释里「回滚所有已修改消息」的承诺不成立。
- 修法方向：`additionalMutate` 改成先克隆容器和槽再删，然后整体赋值。

**R5-12 [P3 待坐实] rowId 口径不统一，纪要表选取依赖对象键顺序**
- 位置：
  - `table/summary-sheet-rowid-timeline.ts:81` 只认物理 `row[0]`。
  - `summary-vector-index-archive-service.ts:471` 和 `summary-vector-mirror-rebuild.ts:97` 用的是 `row[0] || 编码索引`。archive-service 的注释说这与 timeline 口径一致，实际并不一致。
  - `summary-vector-index-scope-resolver.ts:30-35`：按 `Object.keys` 顺序取第一张名字属于 `总结表/总体大纲/纪要表` 的表。
- 现象：
  - row_id 为空、靠编码索引补身份的行，只会在 rebuild 时进入 checkpoint。flush 的 timeline 看不到它们，增删改都不产生 delta，只能靠召回时的 hash 失配触发同步 rebuild_repair 来兜底。
  - 模板里同时有「总体大纲」和「总结表」时，选中哪张取决于键顺序。选中大纲表时，因为缺少概要列，整个功能会报错停用。
- 修法方向：rowId 口径集中到一个函数里共用；纪要表选取按「纪要表 > 总结表 > 总体大纲」的优先级，而不是键顺序。

---

## 已确认无问题（供后续复审参考）
- **召回读侧**：
  - 维度不一致时 cosine 返回 0，不会截断后照常打分。
  - pack 或 chunk 缺失、`textHash` 与实时 `vectorSourceHash` 失配时，拒绝使用残缺 head（`mirror_pack_incomplete` / `mirror_content_hash_mismatch`），不会注入错误内容。
  - 实时表里已删除的行会被过滤掉，注入内容一律取实时正文。
- **跨聊天召回**：去重签名包含 chatKey；resolver 只读当前隔离槽；pack/manifest 路径带作用域 SHA-256 token，manifest 回读时校验 hash。没找到把 A 聊天的向量召回进 B 聊天的路径。R5-04 是删除方向的问题，不是串读。
- **切聊天中途的 flush**：baseRevision 带作用域，切聊天后 `assertFresh` 必然冲突；plan 引用的 entryId 在新聊天里也不存在，所以不会写进错误聊天。
- **embedding 批处理**：结果按 `index` 回填；缺失时分小批重试，仍缺则抛错；维度混杂会抛错；并发 worker 遇到首个失败就停止。
- **registry**：读写在进程内串行化。非 404 的读失败会抛错，不会用空库覆盖；登记时保留已有的 scope 身份。
- **Safe GC 删除判据**：
  - 只处理 scopeHints 指定的作用域，空 hints 直接短路；
  - prepared 与 pending 对象一律保留；
  - grace 只信 registry 的上传时间；
  - 删除前回读 blob，核对 schema、packScope、packKey/hash、checksum；遇到 fallback 弱哈希不投删除票。
- **删聊天清理**：存活聊天枚举不完整（任一角色请求失败、groups 不可用、响应形状异常）时返回 null，并跳过清理；同名聊天仍存活时跳过；目标正是当前聊天时也跳过。
- **flush 队列**：claim 与 enqueue 在同一作用域锁内完成，代次单调递增；重试有次数上限和指数退避；401/403 后有跨作用域的凭据冷却，不会无限扣费。
- **配置**：endpoint 安全校验并入配置校验，结果收敛到 terminal；固定注入条数的 UI 有正整数约束，与 `normalizePositiveInteger_ACU` 一致。

## 探针（scratchpad，已从 `source/tests` 移出）
- `zz-review-probe-r5-refresh-growth.test.ts`：R5-01（并发写入被回滚吞掉）、R5-02（每次 flush 全表重嵌、packRefs 累积、rebuild 双重 embedding）。
- `zz-review-probe-r5-manifest-discard.test.ts`：R5-03（失败回收删掉在用的 manifest、published 被降级为 prepared）。
