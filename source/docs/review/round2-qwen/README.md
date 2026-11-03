# 第二轮全库复审（Qwen 3.8 Max，2026-11-03）核查台账

> agent 间传阅（保留 文件:行号）。原始报告：`G01.md`–`G13.md`（分组）、`G14-cross.md`（跨组线索专项）、`summary.md`（Qwen 协调者总表）、`prompt.md`（下发的提示词）。
> 基线 `2e83b108` → `75d536c6`。Qwen 报 69 条（P0×0 / P1×8 / P2×26 / P3×35），下表是 Claude 逐条核查后的结论。
> 用户决定：先修 P1（ff40cf5c），再修 P2；P3 交给 Qwen 修。

## P1（8 条）——全部属实，已修

| 编号 | 核查 | 修法 | 回归用例 |
|---|---|---|---|
| G03-01 `<if>` 嵌套切错分支 | 属实（触发需外层成立分支内嵌带 `<else>` 的 if，较少见，实际按 P2 看待） | 扫描时记下本层第一个 `<else>`，按它切分支 | if-block-and-condition.test「外层成立分支里嵌套带 <else> 的 if」 |
| G06-01 续写宿主重发重试恒失效 | 属实 | 指令楼指纹不再计入 `name`（发送时只能按指令文本合成，宿主真实楼带用户名） | host-retry-mode.test「能认出宿主带上用户名…」 |
| G07-01 契约结算后 write_sql 读回顶掉本地结算 | 属实 | 可写子代理（维护员/总纲/外部设定）派工前把本地已应用的资料条目与修订号落帧；挂账、完成状态、水位仍按原口径在工作流结束时落盘；同批并行派工共用一次落帧 | agent-workflow.test「先整行契约结算、定向重派改用 write_sql…」 |
| G08-01 常用世界书复制出整本死书 | 属实 | 副本按条目里的接管记录还原：开关按接管前、去掉接管块、放行留下的常驻改回 | agent-favorite-worldbooks.test「源书正被别的卡 Agent 接管时…」 |
| G08-02 作用域书单变化后条目永久孤儿 | 属实 | 接管与「退出接管」开头：账本签名对不上、且账本里的书都还在作用域里（书单只增，如挂载常用书）时，先按旧账本恢复再走新书单；书被移出或整个换书单（换卡）时不动，保持原口径 | agent-worldbook-takeover.test「作用域里多挂了一本书」三例 |
| G09-01 可视化新增列不同步 DDL | 属实 | 新增 `appendDDLColumn_ACU`（与删列同口径：一列一行、无表级约束，否则拒绝）；addColumn 先校验 DDL 与表头一致再原子追加 | use-visualizer-config-editing.test「新增列同步追加 DDL…」「同名或已不一致时拒绝」 |
| G09-02 数据+结构混合编辑三条保存路径互拒 | 属实（R10A-02 修复的副作用） | 数据保存：结构没变的表可先单独存行数据，基线只同步这几张表的行，结构/表名/锁留在草稿等模板保存；同一张表既改列又改行数据时明确提示撤销其一；模板保存提示改为「先保存数据」，不再互相指向 | use-visualizer-save.test「数据保存不会把同时存在的模板变化标成已保存」「同一张表既改了结构又改了行数据…」 |
| G14-01 正文替换「重新优化」覆盖手改 | 属实（R9-01 分叉） | 改用 R9-01 的写回快照（含 swipe 与正文），写回带 expected | content-replace-store.test「重新优化等待期间用户就地改了…」 |

## P2（26 条）——已修 19 条，其余见下

| 编号 | 核查结论 | 处理 | 回归用例 |
|---|---|---|---|
| G02-01 测试连接迟到结果写到别的预设 | 属实 | 切预设 / 新建草稿时代数 +1，迟到结果代数不符即丢弃 | api-page.test「测试连接在途时切到别的预设…」 |
| G03-02 手动填表标志置位前点终止不锁存 | 属实 | 终止请求计序号；手动填表入口记下起始序号，置「正在填表」后若序号变过立即锁存 | state-manager.test、update-orchestrator.test「清理阶段（「正在填表」置位前）点终止…」 |
| G03-03 追平/自动填表失败原因只进默认关闭的 WARN | 属实 | 两处失败原因改记 ERROR（常驻采集） | update-scheduler.test |
| G03-04 `<if cell="表/行">` 两段式只看 row[0] | 属实 | 表头首格为空或 row_id 时行名取第 2 列，列扫描随之后移 | cell-utils.test |
| G04-01 批量落盘前复核缺消息身份校验 | 属实 | 记下每个目标楼与检查点楼的消息对象，末次复核逐个比对身份；回放收敛根同样复核 | storage-frame-v2-persist.test「校验回放期间删了前面一楼…」 |
| G04-02 V1→V2 迁移 mixed 分支沿用过期下标 | 机制属实，窗口窄 | 作用域快照记下消息数组，提交前长度或任一消息身份变化即中止 | storage-v2-migration.test「mixed 判定期间删了前面一楼…」 |
| G04-03 runtime-only flush T0 快路径锁外清登记 | 机制属实，概率低 | 登记计序号；快路径清登记前要求序号未变，否则走加锁路径 | runtime-only-pending-flush.test「锁外比对期间同一张表又被写入…」 |
| G05-02 purge 分词器把反斜杠当转义 | 属实 | 按 SQLite 词法：字符串内只有 `''` 转义 | chat-message-data-repo.test「按 SQLite 词法认字符串…」 |
| G05-03 休眠数据唤醒确认后不复核聊天 | 属实 | 确认前记聊天作用域，确认后不一致即提示并放弃 | use-dormant-data.test |
| G06-02 生成中切聊天残留桥内认领 | 属实 | 生成结束 / 中止事件按生成序号认出别的聊天的认领并清掉 | host-generation-bridge.test「生成中切到别的聊天…」 |
| G06-03 自动重试放弃后任务悬置 running | 属实 | 重发前复核宿主重试是否仍可行，不可行记失败并放弃，不把任务置回运行中 | host-generation-bridge.test「重试等待窗内用户删掉了指令楼…」 |
| G07-03 同批契约派工与 write_sql 派工互踩 | 属实 | 同批有逐栏保存时先读一次帧作结算基线，契约 delta 叠在它上面；不再逐条重读帧整份替换（同模块并发仍按修订号拒绝） | agent-main-loop.test「同批一个按整行契约结算、一个逐栏即时保存…」 |
| G09-03 renameSheet 不查重 | 属实 | 与新增表同款：规范化后与别的表重名即拒绝并提示 | use-visualizer-config-editing.test「改名成同聊天另一张表的现有名…」 |
| G10-01 截短重试与首次输入相同 | 属实 | 重试时整条查询（含 AI 关键词）截到 300 字 | summary-vector-index-runtime.test「用户输入不长、AI 关键词把查询撑过上限…」 |
| G13-01 外观抽屉切模式绕过未保存守卫 | 属实 | 与侧栏切模式一样先过关闭守卫 | shell.test「外观抽屉里切「界面模式」同样先过关闭守卫…」 |
| G14-02 正文替换判定错误体未脱敏 | 属实，风险低 | HTTP 错误原因与请求失败原因过 `maskSensitiveText_ACU` | decision-gate.test「服务商把收到的 Key 回显进错误体时…」 |
| G14-03 交火重建失败不释放去重签名 | 属实 | UI 层合成的 rebuild_failed / recall_after_rebuild_failed 一律先放掉 8 秒去重 | summary-vector-index-ui.test「用户确认重建却没建成…」 |
| G14-06 单独召回 inFlight 置位在 try 外 | 属实，前提极低 | 弹进度提示挪进 try，finally 必复位 | decision-recall-ui.test（新） |
| G07-02 可写子代理读集超前帧 | 与 G07-01 同根 | G07-01 的派工前落帧已覆盖 | — |

未修：

| 编号 | 结论 |
|---|---|
| G05-01 / G14-04 / G14-08 字符串形态 IsolatedData | 代码属实，但生产中未发现写入字符串形态的路径（仅读侧兼容），并入 P3 统一加固 |
| G08-03 'keyword' 非法宿主类型 | **不成立**：原生路径映射为非常驻关键词条目，上游同样写 'keyword' |
| G14-05 模板翻译歧义告警只进 WARN | 不改：属诊断噪音，导入侧已有专门预警；改 ERROR 会刷屏 |
| G05-04 删楼守卫登记流式生成中的新回复 | 待真机（TT 生成中能否删楼） |
| G14-07 交火收尾全局停止可能误停新聊天生成 | 待真机 |

## P3（35 条 + 并入 3 条）——已修（Qwen 修、Claude 复核，2026-11-03）

| 编号 | 核查 | 修法 | 回归用例 |
|---|---|---|---|
| G01-01 toast 楼号不复核身份 | 属实 | toast/对话框改捕获 writeTarget 快照（含 chatIdentity），重新优化前按 message_id 重定位，找不到即拒绝并提示 | optimization-ui-write-target.test「toast 后删楼/切聊天→拒绝」「位移后按 id 重定位」 |
| G01-02 optimization-ui 13 处死 import | 属实 | 逐个 grep 复核后删除（exec.ts 的活符号保留） | 4 个 optimization-ui 测试 + typecheck |
| G01-03 决策召回档位双拷贝 + choice 死字段 | 属实 | 映射收敛为 `decisionRecallLevelLabel_ACU` 单一出处；删除 `choice` 字段与两处写入 | decision-recall-scoring.test、decision-recall-test-output.test |
| G02-02 展示脱敏不覆盖 ?key=/裸 sk-、三份实现分叉 | 属实 | log-buffer 收敛出 `maskSensitiveStringPatterns_ACU` 唯一规则源（补 ?key=、裸 sk-/AIza、短 Bearer/Basic、引号键名、Cookie）；api-call 与填表重试反馈复用之，只保留各自展示侧专用处理 | log-buffer.test、api-call.test |
| G02-03 模型列表状态不随预设清理 | 属实 | store 新增 `resetModelListState()` + 加载代数守卫；切预设/新建草稿接入 | api-page.test、api-preset-store.test |
| G02-04 callCustomOpenAI 死参数 | 属实 | 删死参数与本地解构；update-scheduler 调用点不再传 `{skipProfileSwitch,forceDirectApi}` | update-scheduler.test |
| G03-05 高级参数徽标只看 5/8 项 | 属实 | 改为「advancedFields 任一项≠默认即自定义」，保留 skipUpdateFloors=1 例外 | form-fill-page.test |
| G03-06 postCommitWarnings 死契约 | 属实 | staging 的 pre/post 段真正收集 warnings 并带进全部 return（与统一路径同形） | update-orchestrator.test |
| G04-04 降级不带 restoreUpToAiFloor | 属实 | v2-full-checkpoint-downgrade 与 recovery 的 redundant_full fallback entry 补带声明；chat-service 双胞胎不动 | v2-full-checkpoint-downgrade.test（新）、table-v2-recovery-service.test |
| G04-05 恢复计划表跨聊天不清理 | 属实 | createPlan 淘汰 chat 引用/chatKey 不符的旧计划（同聊天不同隔离槽仍可共存） | table-v2-recovery-service.test「跨聊天放弃的旧计划被淘汰」 |
| G05-05 向量文件探测把 5xx 当不存在 | 属实 | 改三态探测：仅明确 404=missing；网络/5xx=unknown→ok:false 保留 registry | vector-index-st-files-storage.test |
| G05-06 helper 路径绑 'current' 无视传入角色 | 属实 | 绑定前与 await 后各核对一次当前角色（avatar+name），不一致返回 'unavailable' | worldbook-file-gateway.test |
| G05-07 purgeTargetSheetKeysFromMessage 死代码 | 属实 | 删除函数与随之无用的 import | typecheck + chat-service.test |
| G05-08 hasAnyTableData 混同 '' 与未传 | 属实 | 签名改 `string\|null`；`''` 直读默认槽，仅 undefined/null 做容器级检查；table-history 显式传 | chat-message-data-repo.test、table-history.test |
| G06-04 续写引擎两处死代码 | 属实 | 删 existingAttempt 分支（及引擎内不再抛的 STALE 码）与 removeLastMessage；同步收窄类型、清理测试 | stage-execution-engine.test、host-turn-adapter.test、continuation-orchestrator.test |
| G07-04 写端口提示与提升机制矛盾 | 属实 | 文案改为「写齐提交即提升；用过 write_sql 后最终契约必须空 delta」 | 纯文案，grep 无断言 |
| G08-04 常用名单落盘失败静默丢失 | 属实 | `writeFavoriteWorldbookNames_ACU` 返回 `{names,saved,error?}`，失败回滚内存名单；UI 如实 toast | agent-favorite-worldbooks.test、useFavoriteWorldbooks.test |
| G08-05 readFinalGenerationGreenlights 死代码 | 属实 | 删函数与 8 处读回断言（无专属 it 块） | agent-worldbook-takeover.test |
| G08-06 启动首个 CHAT_CHANGED 误清绿灯 | 待坐实（防御性修） | `switchedToAnotherChat_ACU` 增加 previous identifier 非空条件；复核空串仅两处来源、均先收回绿灯 | injection-engine-state.test |
| G09-04 表级预设双读取口径 | 属实 | 助手侧走 `persistedSheetNameForOverrides_ACU`（已保存名）；service 兜底接收 templateBaseData 同口径 | use-visualizer-assistant.test |
| G09-05 seed 诊断读不存在的 globalThis | 属实 | 改用 `listTemplatePresetNames_ACU()` 枚举真实预设库 | template-seed-pollution-diagnostics.test |
| G09-06 v1/v2 死编译路径分叉 | 属实 | 备选方案：v2 addRows 补临时 row_id、buildNewSheet 补 DDL 对齐 v3，并在分支头注明生产不可达与保留原因（整体删除波及共享夹具过广） | compiler.test、service.test |
| G09-07 v2 存量提示词无迁移 | 待坐实（最小安全修） | 新增 `migrateLegacyV2ProtocolSegments_ACU`：按文案指纹识别 v2 协议卡→原位替换 v3 卡（保留自定义卡、去重、幂等），编辑器载入/组包/保存三处接入 | prompt-placeholders.test、service.test |
| G10-02 行指纹死模块 + 两套矛盾活公式 | 属实 | 删死函数；不强行统一两套 legacy 公式（存量 manifest 已持久化 archive 公式），改为注释如实描述差异与持久化约束 | archive/storage/source-text/mirror-writer 4 文件 125 例 |
| G11-01 IDB done promise 悬空拒绝 | 属实 | 创建后立即 `done.catch(()=>{})`；新增 request 自身失败零未处理拒绝用例 | idb-import-temp.test |
| G11-02 保留名漏 __default__ + 关联死代码群 | 属实 | 按「槽键产物==哨兵」判定拒绝；删 switchIsolationProfile/ensureProfileExists 死代码群与测试残留 mock（有活引用的历史函数保留） | data-constants.test、isolation-repo.test、settings-migration.test |
| G11-03 mainContent 死参数 + $& 陷阱 | 属实 | 删参数与替换分支（content-optimization 为裸 re-export，无需改） | content-optimization-default-prompt.test |
| G11-04 17 个未用解构 | 属实 | 删除整段 | trigger-diagnostics.test |
| G12-01 仓库根三个零引用 V1 死文件 | 属实 | 直接删除（含空目录） | — |
| G12-02 legacy 异步确认无身份复核 | 属实 | 三处确认复用 V2 既有 `chat-action-scope`（未新写第四份工具），确认后不一致即放弃并提示 | data-admin-ui-override-guard.test（新）、summary-vector-index-ui.test、update-process.test |
| G13-02 错误指引指向不存在的按钮 | 属实 | 新增共享 `buildCompatReadonlyGuidance_ACU`，四处口径统一为「后台自动固化/历史恢复诊断入口」；log-error-hints 步骤同步改写 | log-error-hints.test、storage-frame-v2-write-guard.test |
| G13-03 仪表盘死分支/死文案 | 属实 | grep 零引用后删除 | dashboard 测试 |
| G14-09 legacy/统一路径向量收尾分叉 | 属实 | 短期对齐：legacy 向量收尾同样要求 `postCommitWarnings.length===0`（结构性统一 runner 留作长期） | update-orchestrator.test |
| G14-10 userInput 兜底取 params.prompt 无守卫 | 待坐实（低风险收窄） | 兜底仅接受 string 且截尾 500 字符，非字符串走既有空输入跳过 | init.test |
| G14-11 plot-preset-store.setEnabled 死代码 | 属实 | 删除（live 路径为 useDashboardPage→setGlobalPlotEnabled） | plot-preset-store.test |
| G05-01（并入）字符串容器写入点置空 | 属实 | 新增 repo 层 `ensureWritableIsolatedDataContainer_ACU`（解析字符串→克隆→按对象回写，保留其他槽），chat-service 4 处 + checkpoint-delete-guard 接入 | chat-service.test、checkpoint-delete-guard.test |
| G14-04（并入）init frame 裸展开字符串容器 | 属实 | `writeInitFullCheckpointFrameV2_ACU` 先规范化再展开；template-state-reset 同步处理字符串形态的旧槽清理 | storage-frame-v2-persist.test、template-state-reset.test |
| G14-08（并入）boundary/convergence 裸展开 | 属实 | 先经 `ensureWritableIsolatedDataContainer_ACU` 规范化再展开 | chat-service.test |

未纳入本次修复 / 交接事项：

- G05-04、G14-07 仍待真机（TT 生成中能否删楼、切聊天是否派发 GENERATED_STOPPED）。
- legacy 向量写链（archive-service 的 archive/migrate/flush 管线）生产零调用方：**决定暂不下线**。它被 5 个测试文件当夹具来守护仍在用的作用域互斥（`runSummaryVectorIndexArchiveScopeMutationExclusive_ACU`）与写屏障，删掉要重写这批测试；不运行、不影响使用。
- `getDataIsolationHistory_ACU` / `removeDataIsolationHistory_ACU`：确认只供已下线的隔离码管理 UI 使用，**已删除**（历史列表仍由设置加载时 add/normalize 维护）。
- G04-04 的三份降级逻辑：**决定不合并**。字段行为已对齐，合并是纯重构、无行为收益，改动面却跨三条事务路径。
- 用户可见口径变化（Claude 复核后调整）：①填表「高级参数」徽标：自动填表间隔选内置档位（每 1/3/5 层）联动的三项不算自定义，间隔为自定义或其余 5 项任一非默认才标「自定义」；②API 预设：切预设 / 新建 / 放弃修改时清空模型列表，保存（含改名、新建后保存）不清。
