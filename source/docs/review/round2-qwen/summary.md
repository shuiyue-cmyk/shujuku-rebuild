# Qwen 全库复审总报告

复审基线 `2e83b108`（上一轮收口）→ HEAD `75d536c6`（其后 78 个提交、约 +1.1 万行）。协调者 + 13 个并发子代理（G01–G13）+ 3 个跨组线索专项查证子代理（G14-A/B/C，合并为 G14）。全程只读，未改动仓库任何已有文件、未执行 git 写操作；各组探针均在仓库外临时目录跑完删除。

## 概览

- **总计（去重后）：P0 × 0，P1 × 8，P2 × 26，P3 × 35（共 69 条）。**
- 去重口径：跨组线索中与既有发现同根者已并入（#1→G02-04、#3→G02-02、#8→G01-01、#23/#24→G13-02、#36/#37→G09-03、#39→G05-06、#45→G05-02 修法参考）；G14 驳回 2 条误报（#6、#28）；G14 新立 11 条（G14-01…G14-11）。G05-01 / G14-04 / G14-08 为「字符串形态 IsolatedData 容器未在写入/展开点解析」同族的不同代码位置，各自独立但建议统一修。
- **全部 8 条 P1 已由协调者亲自抽查**（打开源文件核对）：行号存在、引用代码与实际一致，无「行号或引文不符」，无降级。
- 各组完成情况（13 组全部完成，无失败/重派）：

| 组 | 名称 | 状态 | 结论 | 声明「没读/没把握」的范围（详见各组文件） |
|---|---|---|---|---|
| G01 ★ | 决策召回·剧情推进·正文替换 | 完成 | P3×3 | plot-runtime 无新改动段、plot-history-preset 等上轮已覆盖文件仅 grep/略读 |
| G02 ★ | AI 请求与 API 设置 | 完成 | P2×1 P3×3 | 详见 `.analysis-qwen-review-G02.md` |
| G03 ★ | 填表流水线与运行时 | 完成 | P1×1 P2×3 P3×2 | sql-table-service.ts 大部、orchestrateManualUpdate 5300-5620、部分 template-vars 未逐行 |
| G04 | 存储帧·回放·迁移 | 完成 | P2×3 P3×2 | storage-frame-v2-replay 1900-2300、persist 760-1340/1560-2200 仅抽查（依赖上轮 block2b） |
| G05 | 数据层·聊天·数据管理 | 完成 | P2×4 P3×4 | applySqlBatchOperationV2 后半 lenient 细节（G05-02 下游症状属推演）、TT 真机行为 |
| G06 | 智能续写编排 | 完成 | P1×1 P2×2 P3×1 | agent/ 子目录仅按接口抽读、宿主真机行为（name/regenerate/STOPPED 时序） |
| G07 | 续写 Agent 内核 | 完成 | P1×1 P2×2 P3×1 | agent-model/module-frame 等未改动文件仅 grep、agent-main-loop :630-820 抽读、提示词措辞不审 |
| G08 ★ | Agent·世界书 | 完成 | P1×2 P2×1 P3×3 | read-context.ts:131-232 略读、组外消费方仅接口段、宿主 API 真机行为 |
| G09 | 模板·改表助手·可视化 | 完成 | P1×2 P2×1 P3×4 | reference-docs.ts 语法文档未逐字核对、默认提示词文案略读（本组路径基线后零改动） |
| G10 | 向量·交火 | 完成 | P2×1 P3×1 | 详见 `.analysis-qwen-review-G10.md` |
| G11 | 共享层 | 完成 | P3×4 | ddl-utils 其余 800 行、sql-read-resolver 其余、sheet-identity 等无改动文件（上轮 block7 已通读） |
| G12 | 旧版界面与对外 API | 完成 | P3×2 | components/optimization-ui（属 G01，仅核对 3 调用点）、api-groups 7 个未改动文件仅抽查、TT 真机行为 |
| G13 ★ | 新版界面外壳·主题·通用组件 | 完成 | P2×1 P3×2 | 详见 `.analysis-qwen-review-G13.md`（另含 3 条设计疑虑 + 完整复核清单） |

## 总表（按严重度从高到低）

### P1（8 条，全部已抽查通过）

| 编号 | 级别 | 把握 | 标题 | 位置 | 备注 |
|---|---|---|---|---|---|
| G03-01 | P1 | 已坐实 | `<if>` 嵌套解析用「全文第一个 `<else>`」切分支：内层带 else 时外层分支切错，该保留内容静默丢弃、该隐藏分支连同 `</if>`/`<else>` 原文泄漏进提示词 | `service/runtime/template-vars/if-block-parser.ts:149-156` | 抽查通过；影响填表/宿主每条消息/正文替换/剧情世界书（G03-01 覆盖 #33 影响面） |
| G06-01 | P1 | 已坐实 | send() 合成指令楼指纹缺宿主 persona `name` → 生产环境「宿主 regenerate 自动重试」全链路失效并谎报「楼层已被删除」 | `service/continuation/host-generation-bridge.ts:157` + `host-retry-mode.ts:29-51` | 抽查通过；测试桩重算指纹致全漏检 |
| G07-01 | P1 | 已坐实 | 固定工作流「整行契约→write_sql」混用时帧重读整份顶掉本地快照：已受理契约结算数据静默丢弃、误报 no_change、水位照推致该段正文永不重结 | `service/continuation/agent/agent-workflow.ts:647-655` | 抽查通过；探针含对照组 |
| G08-01 | P1 | 已坐实 | 「常用世界书」复制正被 Agent 接管的源书：副本原样带「已禁用+他人接管账本」，挂新卡即整本死书（与 60e43673 宣称矛盾） | `service/agent/agent-favorite-worldbooks.ts:80-93` | 抽查通过；探针复现 |
| G08-02 | P1 | 已坐实 | 挂载常用书改变作用域签名后，旧签名下被接管禁用的条目永久孤儿化（新账本不含、退出接管不恢复，不可逆） | `service/agent/agent-worldbook-takeover.ts:1313` | 抽查通过；探针复现 |
| G09-01 | P1 | 已坐实 | 可视化「新增列」从不同步 DDL → 之后模板保存在任何模式必被 preflight 拒绝（native 模式无 DDL 编辑区、无法自救） | `presentation-v2/composables/visualizer/useVisualizerConfigEditing.ts:276-286` | 抽查通过；deleteColumn 有 DDL 同步、addColumn 漏 |
| G09-02 | P1 | 已坐实 | 手动混合编辑（数据+结构）后数据/模板/全局三条保存路径循环互拒，草稿只能整体丢弃（R10A-02 修复不完整引入死锁环） | `presentation-v2/composables/visualizer/useVisualizerSave.ts:417-428/638-641/1064-1067` | 抽查通过；两文案互相指引对方被拒动作 |
| G14-01 | P1 | 已坐实 | 正文替换页「重新优化」(reoptimizeLatest) 缺 R9-01 写回快照守卫：AI 在途期间用户就地编辑/滑动目标楼层被静默覆盖 | `presentation-v2/stores/content-replace-store.ts:811-815,822` | 抽查通过；根因在 G01 文件、G01 漏报，G14-B 坐实（sibling optimizeCurrentContent 有守卫）；R9-01 修复不完整/分叉 |

### P2（26 条）

| 编号 | 级别 | 把握 | 标题 | 位置 | 备注 |
|---|---|---|---|---|---|
| G02-01 | P2 | 已坐实 | 「测试连接」在途时切换/新建预设，迟到结果写回挂到不相干预设（张冠李戴），在途请求不中断 | G02（ApiPage/ApiPresetEditor 链，详见组报告） | 探针用 v3-harness 真实挂载复现 |
| G03-02 | P2 | 已坐实 | 手动填表在「正在填表」标志置位前点「终止」不锁存：破坏性清理已跑完，任意一次 wasStoppedByUser 复位即撤销终止、重填跑完提示「完成」 | `service/runtime/state-manager.ts:660-673` + `update-orchestrator.ts:5744` | 与 G12 复核#12 建模角度不同（G12 谈旧轮复活、G03 探针坐实标志前置位窗口）→ 以 G03 为准；触发源 #31/#32 在 G12 文件 |
| G03-03 | P2 | 已坐实 | 追平/自动填表失败原因只写默认关闭的 logWarn，toast「详细信息可在运行日志里查看」落空、追平异常还删掉 error.message | `presentation-v2/composables/useManualUpdate.ts:709-731` + `update-scheduler.ts:434-435` | 与 G14-05、G13-02 同「WARN 默认不采集」根；剧情推进已在 plot-task-engine.ts:1141 改对 |
| G03-04 | P2 | 已坐实 | `<if cell="表名/行名 …">` 两段式行匹配只看 row[0]（V2 恒为 row_id）→ 条件静默恒假、`!=` 给出错误的真 | `service/runtime/template-vars/cell-utils.ts:197-229` | 探针实测；三段式路径正常（口径分叉） |
| G04-01 | P2 | 已坐实 | 批量写入落盘前复核缺消息对象身份校验：校验让步窗口内删楼后旧候选帧覆盖错位楼层并严格落盘 | `service/table/storage-frame-v2-persist.ts:3114-3121`（对照单写 :2769 有身份比对） | 361dab07 新增守卫自身不完整；#16 关联 visualizer 调用方（G09 复核#11 已核） |
| G04-02 | P2 | 待坐实 | V1→V2 迁移 mixed 分支在异步窗口后沿用过期 target.index：删楼可把迁移根写进 user 楼层、根不可见而 legacy 原件已清、表格「被清空」 | `service/table/storage-v2-migration.ts:580,766-768,831-844` | 缺端到端时序演示（await 让出点确定存在） |
| G04-03 | P2 | 待坐实 | runtime-only flush 的 T0 快路径在提交锁外清登记，与并发 skipChatSave 外部写入不互斥：窗口内新写入登记被误清、脚本写入滞留运行时重载后丢失 | `service/table/runtime-only-pending-flush.ts:153-158` | 缺完整交错探针；「陈旧登记」产生频率未量化 |
| G05-01 | P2 | 已坐实 | 多处写入点把字符串形态 IsolatedData 直接置 `{}`（未解析）→ 旧升级聊天该楼全部隔离标签槽数据静默删除并严格落盘 | `service/chat/chat-service.ts:997-1000,2595-2596,2627-2628,2785-2787` + `checkpoint-delete-guard.ts:291-296` | 与 G14-04/G14-08 同族（建议统一修）；repo 层有专测证明字符串形态受支持 |
| G05-02 | P2 | 已坐实 | purge SQL 分词器把反斜杠当字符串转义（与 SQLite 词法及写入端第二份分词器分叉）→ 按表删除/重填预清理漏删目标表 legacy sql_batch，残留致回放失败或已删数据复活 | `data/repositories/chat-message-data-repo.ts:276-280,354-355,455-459` | vite-node 调真实函数复现；#45 指出 sql-table-service.ts:161-230 有词法正确的第二份分词器可统一 |
| G05-03 | P2 | 已坐实 | 休眠数据「唤醒」确认框后不复核聊天/隔离归属（R10A-01/04 同族漏网）：确认期间切聊天，唤醒提交到新聊天并提示成功 | `presentation-v2/composables/useDormantData.ts:62-112` | 同页其它危险操作已接 frozen scope，唯休眠分区没有 |
| G05-04 | P2 | 待坐实 | 删楼守卫「删楼当刻登记在场楼层」把流式生成中的新回复登记为可嫁接楼：生成期间删楼时 issue #2（新回复被当已填表、跳过自动填表）经另一入口复发 | `service/chat/checkpoint-delete-guard.ts:264-271,338-344` | 缺真机验证「TT 生成中可否删楼」；issue #2 修复不完整 |
| G06-02 | P2 | 已坐实 | 生成期间切走聊天，迟到 GENERATION_ENDED/STOPPED 无法归属也不清理桥内存认领；切回后 hasLiveClaim 残留 → 任务冻结「等待宿主正文」、continueTask 恒 BUSY、本轮正文永不确认 | `service/continuation/host-generation-bridge.ts:232-238,326-337,130-145` | 探针坐实；invalidateStartedByChat 无 CHAT_CHANGED 出口 |
| G06-03 | P2 | 已坐实 | 自动重试链先 retryCurrentTurn 置 running 再放弃宿主重发且不回写 → 任务悬置假 running；手动路径还弹「已暂停」错误文案 | `service/continuation/host-generation-bridge.ts:422-424,473-476` + `useContinuationRuntime.ts:194-196` | G06-01 使其成必经路径；独立竞态窗口仍在 |
| G07-02 | P2 | 已坐实 | 工作流把本地已应用（未落帧）快照传给可写子代理：读集/修订号超前帧权威，显式 expected_revision 必判 revision_conflict、幻影条目 UPDATE 必判 not_found，重读仍返回本地值无法自愈 | `service/continuation/agent/agent-workflow.ts:568-571` + `agent-main-loop.ts:1727-1728` | 本轮快照传递改动（1b36a19f）引入的混用面；探针复现 |
| G07-03 | P2 | 已坐实 | 手动并行派工批同构互踩：先结算的契约派工数据被后结算的 field-write 派工帧重读静默顶掉（已报「已结算」）；反序时契约 delta 撞修订号整单被拒 | `service/continuation/agent/agent-main-loop.ts:2118-2133,2204-2209` | 与 G07-01 同根；调用链读穿 |
| G08-03 | P2 | 待坐实 | 上游「keyword 是非法宿主类型」修复只落在自定义导出路径：总结/人物/记忆/Agent 状态条目、「蓝灯转绿灯」仍写 'keyword'/''（mapped 通道原样透传→条目建不出/Agent 模式无法开启） | `service/worldbook/injection-engine-entries.ts:256,391` + `pipeline.ts:466,498` 等 6+2 处 | 分叉已坐实；缺真实新版酒馆助手宿主行为验证；config-meta:815 还误报 updated:true |
| G09-03 | P2 | 链路已坐实 | renameSheet 不查重：可改成另一张表现有名并提交成功，此后一切模板切换/预设应用/跟随全局被协调器「表名规范化重复」拦死 | `presentation-v2/composables/visualizer/useVisualizerConfigEditing.ts:222-256` | addSheet 有查重、rename 漏；#36（persist:2603-2618 不覆盖改名重名）、#37（worldbook 同名导出互扰）为其关联后果面，一并修 |
| G10-01 | P2 | 已坐实 | query embedding「截短重试」在关键词把查询撑超长时发送与首次完全相同的输入：发送照旧被停，还多烧一次注定失败的请求 | `service/vector/summary-vector-index-runtime.ts:729-737` | 探针复现 |
| G13-01 | P2 | 已坐实 | 外观抽屉「界面模式」切换绕过未保存关闭守卫，基础↔高手双向都把页内未保存草稿（API 预设/剧情预设等）随卸载静默丢失 | `presentation-v3/parts/AppearanceSheet.vue:138-141` | R10B-06 漏掉的第四个换页入口；侧栏同款切换有守卫 |
| G14-02 | P2 | 已坐实 | decision-gate 上游错误体未经脱敏直达 toast/判定测试输出：服务商回显 Key 时明文暴露（与已脱敏的召回路径分叉） | `service/optimization/decision-gate.ts:189-196,216-218` | 根因在 G01 文件、G01 漏报；与 G02-02 同族 |
| G14-03 | P2 | 已坐实 | 交火索引「重建失败」合成结果不释放 8 秒去重签名：窗口内点「重新生成」被 deduped 放行、不重召回（与 toast 承诺及 cf314c2d 矛盾） | `presentation/components/summary-vector-index-ui.ts:174,178` | cf314c2d 修复不完整；危害有限（全文兜底、8 秒后自愈） |
| G14-04 | P2 | 已坐实 | init checkpoint 写入口对字符串形态隔离容器裸展开 → 字符下标垃圾键 + 其他隔离键数据丢失、静默落盘 | `service/table/storage-frame-v2-persist.ts:956-959` | 根因在 G04 文件（760-1340 段只抽查）；与 G05-01 同源不同点；探针复现；若字符串形态普遍应上调 P1 |
| G14-05 | P2 | 已坐实 | 模板翻译歧义告警唯一去向是默认不采集的 logWarn、且不在返回值：用户导入时得不到任何可见提示 | `service/template/template-preset-service.ts:443-446,481-489` | 根因在 G09 文件；与 G03-03 同根；已有 postCommitWarning→toast 通道未接 |
| G14-06 | P2 | 待坐实 | decision-recall-ui「单独召回」inFlight 置位在 try 外：中间同步异常（唯一现实抛点=宿主 toastr 裸调用）会让 inFlight 永不复位、此后整场会话单独召回静默跳过 | `presentation/components/decision-recall-ui.ts:70-84` | 根因在 G12 文件、G12 未覆盖；触发前提（宿主 toastr 抛错）待坐实 |
| G14-07 | P2 | 代码级已坐实/实际误停待真机 | 交火召回收尾 stopSendAfterLostLease 无条件调全局 stopHostGeneration（无身份/代次绑定）：切聊天后可能误停新聊天新生成 + 连带作废其自动填表 | `presentation/bootstrap/init.ts:640-656` | 根因在 G12 文件；embedding/rerank 不接中止（vector-embedding-gateway，G05 文件）放大窗口；实际误停需真机 |
| G14-08 | P2 | 待坐实 | chat-service 边界/收敛写回对字符串形态隔离容器裸展开（与 G14-04 完全同模式，G05-01 漏掉的独立点） | `service/chat/chat-service.ts:1081-1082` | 协调者已亲读确认裸展开；端到端落盘待跟踪；与 G05-01/G14-04 同族 |

### P3（35 条）

| 编号 | 级别 | 把握 | 标题 | 位置 |
|---|---|---|---|---|
| G01-01 | P3 | 已坐实(跨聊天变体待坐实) | 无感模式「查看对比」toast 捕获楼号不复核身份，8 秒窗口内删楼/切聊天后「重新优化」作用到另一楼层 | `presentation/components/optimization-ui/optimization-ui-diff.ts:143,176-185`（#8 跨聊天变体前提经 G14-A 代码层确认，并入本条） |
| G01-02 | P3 | 已坐实 | optimization-ui 三文件共 13 处死 import（R9-11 清理后重构残留） | `optimization-ui-exec.ts:6-10,56` / `-diff.ts:6-10,32-35` / `-overlay.ts:6-10,39` |
| G01-03 | P3 | 已坐实 | 决策召回「分数→档位标签」双拷贝，且 runtime 写入的 choice 字段生产零消费 | `service/decision-recall/decision-recall-runtime.ts:104-106,289` + `decision-recall-store.ts:80-83` |
| G02-02 | P3 | 已坐实 | 展示用错误体脱敏不覆盖 `?key=`（Gemini 转接密钥）与裸 `sk-…`；与 log-buffer、填表重试反馈共三份脱敏实现分叉 | G02 文件 + `shared/log-buffer.ts`（#3 并入：log-buffer 侧覆盖 裸key=value/sk-/Bearer/JSON 键，三份各有长短） |
| G02-03 | P3 | 已坐实 | 模型列表状态（modelOptions/modelLoadError）不随预设切换/新建清理，alpha 的模型下拉挂在 beta 表单下 | G02（api-preset-store/ApiPresetEditor，详见组报告） |
| G02-04 | P3 | 已坐实 | `callCustomOpenAI_ACU` 的 skipProfileSwitch/forceDirectApi 为死参数，调用方仍在两处传递 | G02（service/ai）+ 生产端 `service/table/update-scheduler.ts:341,382`（#1 并入，清理跨 G02/G03） |
| G03-05 | P3 | 已坐实 | 填表「高级参数」徽标只看 8 项里的 5 项，改另 3 项（正文/填表最小回复长度、最大重试）仍显示「默认」 | `presentation-v3/parts/UpdateSettingsSection.vue:141-143` |
| G03-06 | P3 | 已坐实 | executeAutoFillStagingGroups_ACU 声明 postCommitWarnings 但 6 个 return 全不填（死契约，误导后续接线） | `service/table/update-orchestrator.ts:3114` |
| G04-04 | P3 | 已坐实 | downgradeOtherFullCheckpoints_ACU 不带过 restoreUpToAiFloor，与 chat-service 同款降级逻辑分叉（issue #18 修复只落一份拷贝，恢复服务第三份同缺） | `service/table/v2-full-checkpoint-downgrade.ts:57-69`（当前生产不可达/被终态根遮蔽，潜伏） |
| G04-05 | P3 | 已坐实 | V2 恢复计划表 plans_ACU 跨聊天不清理，被放弃的诊断计划长期钉住旧 chat 数组与候选克隆 | `service/table/table-v2-recovery-service.ts:59,207-223,727-734` |
| G05-05 | P3 | 已坐实 | 外置向量文件删除的存在性探测把 5xx/网络错误当「不存在」→ 误报成功并摘除 registry 条目，泄漏文件永久失管 | `data/storage/vector-index-st-files-storage.ts:599-607,638-640,745` |
| G05-06 | P3 | 已坐实 | addAuxWorldbookToCurrentCharacter_ACU 两后端语义分叉：TavernHelper 路径无视传入 character、绑「执行时刻的 current」 | `data/gateways/worldbook-file-gateway.ts:64-71`（覆盖 #39；#44 常用书确认框身份复核亦归此，遮罩挡用户切换、程序化切换窗口极小） |
| G05-07 | P3 | 已坐实 | 死代码 purgeTargetSheetKeysFromMessage_ACU（R3-10 清理漏删的私有包装，包装的是跨隔离槽删除语义） | `service/chat/chat-service.ts:2988-2990` |
| G05-08 | P3 | 已坐实 | hasAnyTableData_ACU 把 isolationKey='' 与「未传」混同（R1 系列 '' 口径修复的同族残留） | `data/repositories/chat-message-data-repo.ts:1530-1545`（#46：唯一消费方 table-history.ts:231-238） |
| G06-04 | P3 | 已坐实 | 两处死代码：stage-execution-engine 的 existingAttempt 重试身份分支、host-turn-adapter 的 removeLastMessage（生产均不可达） | `service/continuation/stage-execution-engine.ts:119+` + `host-turn-adapter.ts:9,23-31` |
| G07-04 | P3 | 已坐实 | 运行时写端口提示残留「正式总纲条目仍须最终契约整条写入」，与 R4-02 提升机制/弹回门矛盾，模型照做必被弹回白烧写轮 | `service/continuation/agent/agent-subagent-runtime.ts:636`（R4-02 修复不完整的残留文案） |
| G08-04 | P3 | 已坐实 | writeFavoriteWorldbookNames_ACU 忽略 saveSettings 失败结果，持久化失败时常用名单静默丢失（R6-08 同模式重现） | `service/agent/agent-favorite-worldbooks.ts:60-65` |
| G08-05 | P3 | 已坐实 | readFinalGenerationGreenlights_ACU 已无生产调用方（biotracker 删除后成死代码） | `service/agent/agent-worldbook-takeover.ts:1090-1108` |
| G08-06 | P3 | 待坐实 | 宿主若在启动阶段（监听注册后、startup_restore 前）补发 CHAT_CHANGED，会被判「切聊天」清掉设计上要保留的上一轮绿灯 | `service/worldbook/injection-engine-state.ts:146-149,162`（缺 TT 事件时序实证） |
| G09-04 | P3 | 已坐实 | 表级 API 预设覆盖两套读取口径：面板按已保存名（R10A-14 修复），AI 助手仍按草稿名，改名未提交窗口内助手用错预设且无感知 | `presentation-v2/composables/visualizer/useVisualizerAssistant.ts:81-95`（R10A-14 修复不完整，读者未收齐） |
| G09-05 | P3 | 已坐实 | seed 污染诊断读从不存在的 globalThis.__templatePresetsStoreForDiagnostics_ACU，「global preset 扫描」恒为空（R6-09(a) 同根因残留） | `service/template/template-seed-pollution-diagnostics.ts:241-263`（#38：消费端 data-admin-api.ts:65） |
| G09-06 | P3 | 已坐实(当前不可达) | 助手 v1/v2 编译路径生产不可达却保留且与 v3 分叉：v2 addRows 写 null row_id，重新启用会在模板保存时被静默移除 | `service/template-assistant/compiler.ts:483-484,291-324` |
| G09-07 | P3 | 待坐实 | v2 时代保存的自定义助手提示词无版本迁移，v3 请求下注入自相矛盾的协议指令 | `presentation-v2/composables/visualizer/useVisualizerAssistant.ts:529-542` + `service/template-assistant/service.ts:553,1799-1813` |
| G10-02 | P3 | 已坐实 | 行指纹「单一来源」模块是死代码，archive-service 与 storage-service 各有一套互相矛盾的活公式（注释承诺与代码不符，无现行功能损害） | `service/vector/summary-vector-row-fingerprint.ts` |
| G11-01 | P3 | 已坐实 | IDB 写/删请求失败时 done promise 悬空成未处理拒绝，全局捕获多记一条误导性错误日志（R7-11 修复不完整） | `shared/idb-import-temp.ts:73,83,17-23` |
| G11-02 | P3 | 已坐实 | 隔离保留名只挡 default、没挡存储哨兵 __default__，遗留数据可让自建槽与默认槽共享设置/模板存储（R7-05 修复不完整；切换 UI 已删故仅遗留路径可达） | `shared/data-constants.ts:23,35-42` |
| G11-03 | P3 | 已坐实 | buildDefaultContentOptimizationPromptGroup_ACU 的 mainContent 死参数保留着服务层 R8-05 已修掉的 $&/$' 替换串展开陷阱（分叉残留） | `shared/defaults.ts:339-353` |
| G11-04 | P3 | 已坐实 | trigger-diagnostics.ts logAutoFillSkip_ACU 内 17 个解构变量全部未使用（死代码） | `shared/trigger-diagnostics.ts:98-116` |
| G12-01 | P3 | 已坐实 | 仓库根 src/presentation/pages/ 三个文件是 92c558d2 误提交复活的 V1 死代码（全库 0 引用、不在构建产物、import 模块不存在），建议 git rm | 仓库根 `src/presentation/pages/{popup-bindings-data,visualizer-main-render,visualizer-template-assistant-apply}.ts` |
| G12-02 | P3 | 已坐实 | legacy 破坏性确认改异步（2ff33e5b）后未跟上 V2「确认后复核聊天身份」守卫：确认期间程序化切聊天时破坏性操作落到新聊天（可达性很低，全屏遮罩挡用户） | `presentation/triggers/data-admin-ui.ts:250-280` + `summary-vector-index-ui.ts:168-172` |
| G13-02 | P3 | 已坐实 | log-error-hints 的兼容只读处理建议指向从未存在过的按钮，用户照建议走进死胡同 | `presentation-v2/.../log-error-hints.ts:255`（同源文案亦见 `update-orchestrator.ts:1209/4261`[G03,#24]、`storage-frame-v2-replay.ts:255,3340-3342`[G04,#23]，一并修口径） |
| G13-03 | P3 | 已坐实 | 仪表盘死代码/死文案：useDashboardPage streamingEnabled 分支不可达、dashboard-copy 两条文案全库无引用（R10B-19 同类残留） | `presentation-v2/composables/useDashboardPage.ts:1105` + `presentation-v2/copy/dashboard-copy.ts:186,198-202` |
| G14-09 | P3 | 已坐实 | settings-ui-trigger 的 ops 未接 processGroupedUpdates（全仓无此实现）→ SQLite 自动填表普通组恒走 legacy，R2A-01/05/06/11 分叉延续，本轮 postCommit 向量收尾又新分叉 | `presentation/triggers/settings-ui-sync/settings-ui-trigger.ts:250-277` |
| G14-10 | P3 | 待坐实 | 交火召回 userInput 兜底取 params?.prompt 无类型守卫：真实发送后 12 秒内点「继续」可把整段格式化 prompt 当用户输入向量化（质量/成本劣化，无损坏） | `presentation/bootstrap/init.ts:1090-1092`（宿主参数形态待坐实） |
| G14-11 | P3 | 已坐实 | plot-preset-store.setEnabled 生产代码零调用（死代码），与 Dashboard 的 setGlobalPlotEnabled_ACU 总开关重复 | `presentation-v2/stores/plot-preset-store.ts:220-230` |

## 跨组线索处理结果

各组共提出 46 条跨组线索（另 G14 回抛 2 条）。处置如下：

**A. 已由 G14 查证并立新发现（11 条）**：#2→G14-02、#7→G14-06、#10→G14-03、#11→G14-07、#12→G14-10、#25→G14-11、#30→G14-09、#34→G14-05、#42→G14-04、#43→G14-01，以及 G14-C 额外发现的 chat-service.ts:1081-1082→G14-08。详见 `.analysis-qwen-review-G14-cross.md`。

**B. G14 查证后驳回（误报/已覆盖，2 条）**：
- #6（content-optimization.ts:334-340 提示不符）→ **误报**：hitProtected 与 appliedCount===0 互斥、该状态不可达，文案准确（G14-B 读穿预过滤→写回→解析器三处）。
- #28（init.ts:969-985 autoFillIntent.chatKey 错挂）→ **不成立/已覆盖**：markChatChangedForEndedGate + resetScriptStateForNewChat + R9-18 scopeKey + message_id 楼层解析 + cancelPendingAutoTasks 多层守卫（印证 G03 复核#3、G12 复核#13）。

**C. 负责组报告已覆盖（并入其发现/复核，不另立）**：
- #1→G02-04（死参数，生产端 update-scheduler.ts:341,382 属清理面）；#3→G02-02（脱敏分叉，log-buffer 侧 G11 复核已确认覆盖 裸key=value/sk-/Bearer/JSON 键）；#8→G01-01（跨聊天变体前提经 G14-A 代码层确认，仅剩宿主是否自清 toast 需真机）；#9→G05 复核#1（replaceChatMessage 逐分支推演无缺陷）；#15→G03 复核#7（非 model 类直接 break 不重试，infrastructure 属非 model）；#16→G09 复核#11（visualizer-data-ops contextKey 复核）；#19/#20/#22→G06 复核#5/#12（V38→V39 迁移、parseSqlJsonValue 均已核）；#23/#24→G13-02（同源文案）；#29→G07 复核 + G06 复核#2（OUTLINE_REPLANNED 跨文件契约两侧均已核）；#31→G12 复核#12（但与 G03-02 建模角度不同，见总表 G03-02 备注）；#35→G12 复核#8（UPSTREAM-DRIFT #56 实测依据）；#36/#37→G09-03（改名重名的关联后果面）；#39→G05-06（worldbook-file-gateway 'current' 绑定）；#44→G05-06 + G08 复核#7（常用书确认框，遮罩挡用户切换）。

**D. 信息性/低优先/需真机（记录，不立缺陷编号）**：
- #5（tests/presentation-v2/data-mgmt 残留 mock 已删函数，测试清理）；#13（injection-engine-custom 回填缓存仅内存态，G10 自评「自愈、影响小」，G08 复核#5 已精读）；#14（agentResume 未归后台致填表丢失，**需真机**确认 agentResume 楼层产出行为，G12/G03 均无法离线坐实）；#17（混合存储决策 UI 恒不可达，G04 提示 registerMixedStorageDecision_ACU 无生产调用点、决策 UI 入口已隐藏，疑产品决定）；#18（init.ts 删楼 abort 顺序，G04 自核当前无害）；#21（continuation-orchestrator R4-03 指纹 updatedAt 其它写入者，G06 通读未单独报，「请复核」性质）；#26（PlotPage/DecisionRecallPage setActivePage 绕守卫，G13 自判现状恰好安全、防御性建议）；#27（agent-module-store validateWebRefEntry url 不限协议，G06 复核#6 已排除渲染侧即时风险，纯纵深防御）；#40（summary-vector skip 原因集合隐式契约，维护性）；#41（冷启动绿灯保留耦合，G08 复核#1 已排除风险）；#45（sql-table-service.ts:161-230 第二份词法正确分词器，G05-02 修法参考）；#46（table-history.ts:231-238 是 G05-08 唯一消费方）；#32（settings-ui-trigger 并发窗口，归入 G03-02 修法）；#33（G03-01 的 `<if>` bug 影响 prompt-api-call/content-optimization/plot-tag-utils 三链，根因已由 G03-01 统一覆盖）；#38（data-admin-api.ts:65 是 G09-05 消费端）。
- G14-A 回抛：vector-embedding-gateway 的 embedding/rerank 不接切聊天中止信号（→G05 文件，G14-07 窗口放大根因，建议随 G14-07 一并加固）；message-handler.ts:128-133 索引兼容分支无新鲜度约束（→G03 文件，#28 残余理论缝隙，仅记录）。

## 设计层面的疑虑汇总（不计入缺陷编号）

- **G01**：测试召回无取消手段、不感知切聊天（最长 900 秒真实计费请求照发）；多个 recall 任务被替换时同阶段并行各跑全量召回（成本与并发翻倍、无提示，边缘配置）。
- **G03**：前台生成上下文 TTL 放到 30 分钟（ENDED 真丢时 generation_in_progress 静默丢弃自动填表最长 30 分钟，此前 60 秒自愈）；30 秒强制放开「正在填表」无归属判定（重开 R2A-08 重叠窗口）；stoppedSendRetryChatKey 无 TTL/不在标记时消费；世界书刷新失败后统一/legacy 两路径向量收尾分叉（R2A-11 新一处）。
- **G04**：保存期校验让步（yieldBudgetMs=8）扩大全部写路径异步窗口（模板提交复核也不含同聊天删楼错位）；evidence 复用门闸口径残留。
- **G06**：deadline 在「大纲待确认」期间到期会让大纲永久无法确认（唯一出口是放弃/清空）；[双写互斥] 窗口依赖时序假设（大聊天保存慢时可能超 500ms 防抖）。
- **G07**：终审固定证据无降级路径（超长账本越限后每轮必失败）；**双持久化节奏（契约本地应用 vs write_sql 即时落帧）是 G07-01/02/03 共同根源**，建议统一为「应用即落帧」或「全本地、出口一次落帧」。
- **G08**：冷启动重新生成「放行保留」只保物理灯不保名单（双轨无单一真源，G08-06/线索#41 均其副产物）；接管期间用户手改 type/keys 被静默回退（08b7300e 有意为之但无提示）；切聊天物理收回 fire-and-forget。
- **G09**：读路径原地改写与 revision 令牌清单不全（orderNo）；**「DDL 跟随表头」不变式缺单一收口**（编辑器三操作各自手写 DDL 同步，G09-01 正是此分散格局产物）。
- **G11**：INSERT 列名前缀自动纠正的误导向残余风险（多重巧合下静默进错列，与 fail-closed 哲学有张力）；日志归一把任何带 message/stack 字段的对象当 Error（丢其余字段保真）。
- **G12**：重新生成前立即刷新阻塞宿主正文请求（大聊天数秒停顿、无进度提示，UPSTREAM-DRIFT #56 刻意取舍）；交火重建确认框挂起 Generate 直到点击；foregroundTurnStopped 切聊天不复位（fail-safe 方向）。
- **G13**：persistence 内存回退只写不读；仪表盘 setToggle 忽略保存结果；gate 同步强制收页不过守卫。
- **G14**：stopHostGeneration_ACU 作为「全局唯一停止手段」被多处复用，其副作用一律作用于「当前聊天/当前生成」而非「触发它的那次生成」（G14-07 是此结构性假设的爆发点）。
