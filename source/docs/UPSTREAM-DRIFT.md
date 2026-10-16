# 上游移植覆盖比对（发版前置步骤）

本仓是上游 [`AlbusKen/shujuku`](https://github.com/AlbusKen/shujuku) 的 TT（TauriTavern）专用分叉。
移植覆盖**不得**按「commit message 里引用过的上游 SHA」记账——我方大量上游修复是随 perf / review /
发版提交顺手带进来的，message 里没有 SHA。那种口径既会虚报缺口（上游对同一 bug 多轮修补，我们已跳到
终态），也会**漏报真实缺口**。

唯一可靠口径：**比对上游分支的终态**，看导出符号在我们仓是否存在。

## 跑法

```powershell
# 一次性：clone 上游（与本仓同级目录）
git clone https://github.com/AlbusKen/shujuku.git "../shujuku-upstream"

# 每次发版前
cd source
git -C ../shujuku-upstream fetch origin test   # 刷终态（只读，不动本仓）
npm run drift                                  # 等价 node scripts/upstream-drift.mjs
```

常用参数：`--ref origin/test`（默认）、`--top 40`、`--json`、`--upstream <路径>`。
脚本只读：只用 `git ls-tree` / `git show`，不写文件、不改上游仓工作树或分支。

## 输出与分诊规则

| 分类 | 含义 | 处理 |
|---|---|---|
| 整模块缺失 | 上游有该模块，我方没有 | 绝大多数是上游独有功能（`service/simulation/*`、`ai/native-tool`、填表工作台等）→ 判「功能移植」，不进测试移植批次 |
| 文件在、导出缺失 | 模块同名存在，但少了这些导出 | **最可能是漏跟的修复**，逐个判定 |
| 我方独有导出 | TT 适配新增 | 规模参考，无需处理 |

每个「缺导出」必须人工三判，缺一不可下结论：

1. **我方是否已用不同实现覆盖同一缺陷**（形态不同不等于没修；例如我方 `rollbackRefillCleanupOnZeroCommit`
   比上游同题修复更强）。
2. **是否上游独有功能的一部分**（依赖我们没有的模块/新文件 → 属功能移植，需单独排期）。
3. **移植是否会弱化我方加固、或改提示词字节形态**。以下是我方刻意更严的基线，**不得被上游形态覆盖**：
   - `agent-read-gate.ts`：兜底额度不是越过会话阈值的豁免，`B ≤ F` 也打回
   - `agent-module-frame.ts`：资料帧落「≤targetIndex 的最近 AI 楼」，折叠出口按 `adoptedWaterline` 重盖
   - `update-orchestrator.ts`：整表重建索引闸门
   - `checkpoint-delete-guard.ts`：删楼恢复嫁接
   - `flight-mode` 双写一致性补偿；V2 墓碑协议 / 队列清理
   - `log-error-hints.ts`：向量类误报用负向断言处理（强于上游的 `\bquota\b` 方案）
   - 提示词红线：默认模板字节形态不变；改文本需单独授权并走版本迁移链

## 已知的待跟项（截至 9.10.3 复核）

以下为已确认真实缺口，尚未移植；动之前按上面三判复核一遍，符号级比对会随上游推进变化。

- `service/continuation/outline-planner.ts`：注入判定比对前 80 字 → 已修（整串比对）。
- `summary-vector-index-chat-service.ts` + `summary-vector-index-chat-commit.ts`：删除索引未剥 V2 镜像帧、
  `additionalMutate` 无「算作变更」语义 → 已修。
- `storage-frame-v2-replay.ts` / `compat-transition-checkpoint.ts` / `table-v2-recovery-service.ts`：
  兼容只读历史的**固化闭环**（`buildCompatTransitionFixationPlan_ACU`、`dedupeCompatTransitionRowIdentities_ACU`、
  `V2ReplayOperationError_ACU`）。我方 `reindexSpv79TransitionState_ACU` 无条件全表重编号，而上游终态只修空/冲突
  并保留既有 row_id；过渡根之后仍会回放后续增量（`storage-frame-v2-replay.ts:2633` 按 cutoff 过滤；
  该处与 `buildCompatTransitionFixationPlan_ACU` 等行号均指向上游 `origin/test`=f4e1fd55 终态树，
  我方同逻辑的行号会随版本漂移，复核时以符号名检索为准），存在「增量落到别的行」的
  路径，**但尚未构造端到端复现** → 先做判别复现再决定。且 `2f8b6eab` 会删我方双身份写闸，需决策，不可盲搬。
- `ba800f64` 一族：`isImportDataReplaceBootstrap`、`resolveMutationParentRevision_ACU`、
  `canStageAcrossReplayRoot` 我方全缺（恢复后 `data_replace` 被剥、parentRevision 挂到已裁掉的修订号、
  跨根重填被误阻断）。
- `summary-vector-index-recall-status.ts` 整模块缺失：召回失败仍报成功、删除后 `ensure...AfterTableFill`
  永不重建的门禁依赖它 → 属连带新功能的整簇移植。
- `service/vector/summary-vector-index-runtime.ts`：交火覆盖注入未支持自定义附加索引列
  （`resolveCrossfireExtraIndexColumns_ACU`），与普通注入口径不一致。
- `service/continuation/internal-ai-call.ts`：重试判据硬绑 `isRetryableContinuationTransportError_ACU`，
  上游已改为 `options.isRetryable` 注入。

明确**不跟**（我方形态更强或缺陷载体不存在）：上游 `\bquota\b` 误报方案、`9b397355` 首批落盘前恢复
（我方回滚更强）、`6d85ef88` 存储模式切换（我方已移除 native 模式）、世界推演/格林推演改名、
`self-narration`/`procedure turns`/原生工具提交等提示词与功能改造（属功能移植）。

## 2026-10-09 跟进（上游 main `2b4ea865..53fbc208`）

已移植（均按我方口径重写，非逐字搬）：

- `8c7d2fc5` 子集：实时填表 INSERT 列名写短时唯一前缀自动纠正（`sql-mutation-table-rebind.ts`）。
- `f4d63ac5`：续写 SQL 值多一层 JSON 转义的完整解码（`parseSqlJsonValue_ACU`）＋修正诱导过度转义的提示文案。
- `02a523c4` 思路：填表目标楼层守卫 `table-fill-target-guard.ts`——只认「是否同一条回复」
  （swipe_id / gen_started / send_date），**不比正文**（我方正文替换、MVU 追加、续写都原地改正文），
  同一消息对象只比滑动页码（「继续」会原地改写时间戳），对象被换掉才比指纹；-1 目标按 `isAiFloor_ACU` 找最新 AI 楼。
  整轮取消改用终止锁存 `requestTableFillStop_ACU` / `isTableFillStopRequested_ACU`，防止 `wasStoppedByUser`
  被新一轮/宿主新生成复位后旧轮「复活」。终止不再当场释放 `isAutoUpdatingCard`；同一轮 30 秒仍未收尾才强制释放（防永久锁死）。
- `54366b0c` 思路：切聊天后第一条无配对 ENDED 只立签名基线（`markChatChangedForEndedGate_ACU`）。
  未搬上游「只认已配对生成」——会与我方 152 收紧的无配对放行设计冲突。
- `2adf068b` 子集：召回发送租约（停止生成 / 切聊天后迟到结果不写世界书）；召回失败、剧情推进失败
  （除 `no_tasks` / `scope_changed`）停止本次发送。query embedding 失败不再降级为只注入最近固定行（用户决定：
  宁可不发，也不带残缺记忆发）。未搬上游宿主事件等待门（`installHostEventWaitGate_ACU`）与向量表格模式。

明确不跟：

- `733dbea7` 预设级请求超时：上游用户多用公益站，我方用户以合规渠道为主，固定超时易误杀长回复（用户决定）。
- 世界推演 / 零层（`service/simulation/*`、`service/zero-layer/*`）全部提交：我方无此模块。
- 桌宠、气泡外观、剧情伪装楼层渲染等界面风格类提交（用户决定）。
- `560f9067` 续写 / 推演默认提示词整体重写：提示词红线，且主要服务推演模块。
- `54432b72` / `5db8b51c`：我方本来就是按任务选 API、标签至少闭合一对。
- `4d64556d` / `11cff173`（Kemini、强制 `tool_choice: none`）：上游自引入又回滚，我方从未有过。
- `dcdf612f`：油猴 iframe 专属，TT 扩展模式不涉及。
- `1a5ffdb3` / `1f4a6e0d`：上游重写自己的自动填表信号调度，我方是另一套调度设计。

暂缓：智能续写约 10 笔（`c9afb631`、`5b71997b`、`317dbf7e`、`83ae1ba2`、`f625f1b8`、`ca4612bc`、`e520bb8d`、
`0d2d46c4`、`37948da1`、`231a5f80`、`205b1a38`、`53fbc208`）——上游仍在高频互相修补，我方续写已分叉，待其稳定后整批评估。

### 同轮复审修正（review 2，15 条全部核实并修）

- 填表守卫：「继续」不再误判换楼；-1 目标与写回层同口径；SQLite 取数等待期间滑动也能拦下；持久化前按实际写入楼层复核。
- 终止：锁存贯穿批次与分组循环；设置页预检提前返回不再清掉终止标记。
- 发送租约：插件自己停宿主生成不算用户停止；租约在首个 await 前捕获；召回 / 剧情失败停发后标记「可重试」，
  紧接着的「重新生成」会重新召回与规划（不再被 regenerate 门挡掉）。
- 召回：去重标记在失败 / 取消 / 抛错时复位；长输入 embedding 失败按截短（300 字＋关键词）重试一次；
  自愈重建在用户确认后失败按召回失败停发（拒绝重建仍继续）。
- 续写 JSON 额外转义层：解码出制表符、退格、换页等控制字符时保留原值，不悄悄把 `C:\temp` 改坏。
- 列名前缀纠正：纠正后与列清单已有列（或另一个已纠正短名）重复时不纠正，照旧拒绝。

## 2026-10-10 跟进（上游 main `53fbc208..f0baa844`）

已移植（按我方口径重写）：

- `789f960b` 填表部分：失败重试改为按对话回灌纠错历史（`table-fill-retry.ts`）。上次回复以 assistant 放回，
  报错与修正要求以 system 跟在后面，原 assistant 预填充仍在最后；三条重试路径（单组重试、分组统一提交 / 格式重试、
  旧单表路径）都接入。报错不再拼进 `$0` 表格数据（旧做法落在 `<table_data>` 不可信边界里）。
  与上游差异：只有 SQLite，修正要求只针对 SQL / `table_sql`；只回灌最近 2 轮；纠错文案写明
  「上一条回复仅供参考、只针对报错修正、其余对照原任务重新判断、不要照抄」，删去上游的「保留有效内容」——
  防止模型照抄首轮内容把误判固化（用户决定）。

无需跟：

- `789f960b` 剧情推进部分：上游删掉重试纠错说明、改回原样重发，我方本来就是原样重发。
- `f0baa844` 正文优化在新对话误触发：上游正文优化单独挂在消息事件上，开场白与未配对生成也会触发；
  我方正文优化与自动填表同走 GENERATION_ENDED 一个入口（同一配对门控），不存在该缺陷。
- `bf3bc1dc` / `0faaec8b` 智能续写维护者一次提交、新建条目系统字段归属：涉及我方没有的模块
  （`agent-module-field-commit`、`agent-maintainer-submit` 等），归入续写暂缓批次。

## 2026-10-13 跟进（上游 main `f0baa844..422e498d`）

已移植（按我方口径重写）：

- `2657754a` + `f874c888` 重新生成 / 删楼 / 切换版本时作废排队中的自动任务。我方填表与正文替换同走一个入口
  （`handleNewMessageDebounced_ACU`），所以只加一套代次：前台正文生成开始（非 quiet / dryRun / 自动触发）、
  `MESSAGE_DELETED`、`MESSAGE_SWIPED` 时 `cancelPendingAutoTasks_ACU` 递增代次并清防抖；入口各检查点发现
  代次变化（`generation_changed`）或仍有正文生成在途（`generation_in_progress`）即放弃。已发出的 AI 请求不取消，
  由写回守卫兜底。我方独有：MVU 在飞等待的创建者被作废时，由并入同一次等待的最新一轮接手，避免新楼层被一起丢掉。
- `422e498d`（issue #34）表格提交后世界书刷新失败不再算整次填表失败：`refreshCommittedWorldbook_ACU` 只返回告警
  （`postCommitWarnings`），沿单组 / 分组 / 批处理 / 手动 / 自动调度各层汇总，自动填表、手动填表、单次更新各提示一次
  「表格已保存，但世界书刷新失败……无需重新填表」。告警类型与文案拼接放在 `shared/post-commit-warnings.ts`。
- `9d114771` 表格导出「关键词」条目交给宿主时转成 `selective`（宿主合法类型），表格配置仍保留 `keyword`。
- `412182b4` + `e445c967`（PR #31）对外只读接口 `exportTableSnapshotsAtMessages`。与上游差异：我方没有
  `V2ReplayOperationError`，回放失败只返回 `code` + `error`，不带 `failurePoint`；额外传 `backgroundFixation: 'skip'`，
  保证读取不调度后台固化。

无需跟：

- `e445c967` 慢生成上下文失效（上游 issue #32）：即我方 issue #2，已按「前台上下文 30 分钟 + 新前台顶掉旧前台」修过。
- `63aacfb4` 楼层正文解耦：改的是上游后加的楼层快照校验（`chat-message-snapshot`）与推演提交，我方没有这两套机制；
  续写部分归入续写暂缓批次。
- `48c02522`（PR #35）故事弧维护交回主代理：续写暂缓批次。
- `094ebc82`（PR #28）提示词后处理选项精简：我方默认值本就不同（`strict`），保留现有 8 个选项。

## 2026-10-15 上游审计 issue（#37–#46，基线 `422e498d`）

已修（我方存在）：

- #37 未绑定聊天编辑页面显示的活动预设，「跟随当前配置」仍发旧模型：活动项判定（绑定 > 默认 > 与当前配置一致）
  收进 `resolveDisplayedActiveApiPresetName_ACU`，store 与 `saveApiPreset_ACU` 共用；编辑的正是改动前显示的
  活动项时投影到运行配置，不新建聊天绑定。
- #38 GlobalMeta 损坏被默认值写回覆盖：解析失败先把原文备份到 `<key>.bak` 再降级（与 profile H1 备份同口径）。
  profile 损坏原本就有备份。
- #39 小口子：单个群组 `chats` 不是数组时枚举返回 null（其余形状我方早已 fail-safe）。
- #45 世界书选择器加载代次：只有最新一次 refresh 发布结果（成功与失败都校验）。

我方已修过，无需跟：#40（看门狗覆盖正文读取；我方向量请求不接父取消）、#41（auto_fill 三阶段汇合，手动追平按楼层
顺序跨组推进）、#42（R10A-08 副本校验 + 保存失败回滚）、#43（暂停积压有界、O(1) 追加）、#44（R10A-21 列表失败进 error）。

## 2026-10-15 智能续写跟进（基线 `422e498d`，只跟缺陷修复）

逐条按我方现状独立核实（此前暂缓的约 10 笔 + 10-01 以后其余续写提交）。提示词与提示词布局另行跟进。

已移植（按我方口径重写）：

- `80096e51`：宿主空正文按失败生成处理（先作废待填表、再自动重试），没配标签和最短长度时也不再确认空楼。
- `c9afb631`：固定工作流产出新大纲待确认是正常交接——编排器按等待状态返回、不落 lastError；会话记「等待大纲确认」
  而非「本轮已终止」；「确认大纲」后接着续跑，确认期间点了停止则不点火。
- `e520bb8d` 残余：我方关页面本就不丢指令（视图令牌只随换聊天失效），停止 / 插话由编排器持久态兜底；
  只把停止计数从页面实例提到模块级，关页重开后在新页面点停止也能拦住旧页面在途的「确认大纲后续跑」。
- `37948da1` 子集：策划交接整份 JSON（来源、必须保留、风险），失败策划标 failed；终审打回的修订带回本轮焦点、
  策划交接与终审 preserve；主 Agent 协议纠错样例改为首推 open_round（不再示范手动委派维护 / 策划），
  correct_materials 被拒只给纠正结构；逐栏回执 `path: 'chat'` 给出具体原因并让子代理按失效终止
  （另修我方自有缺陷：写入后的失效检查曾被同一 try/catch 吞成普通拒绝回执）；主 Agent 并行派工任一失效即整批作废；
  维护运行时指令补「无变化不调 write_sql、不用空操作代替核对、修订号只放 WHERE」。
- `231a5f80` 子集：correct_materials 缺参时报出各字段实际状态。
- `bf3bc1dc` 子集：读取续写信封只在副本上做迁移校验，不就地改写首楼原始数据（失败也不留半迁移对象）。
- `5c02f861` 子集：派工内修订号窗口——本派工自己推进过的旧号由提交口接管为当前号，外部写入后重置为严格比对。
- 我方自有：固定工作流内的策划、补足、指导、终审改读工作流当前资料（含本轮结算），不再读运行起点的旧快照。

不跟（逐条核实）：

- `operationOnly` / `fieldConfirmation` / 空补丁确认 / 逐违规来源（`37948da1`、`231a5f80`、`53fbc208`、`0faaec8b` 主体）：
  建立在上游逐字段待修对账之上；我方被拒写入回执不进待修清单、待修按模块清账，上游要修的「永远清不掉」在我方不发生。
- `231a5f80` 待修合并旧违规：我方违规路径是 `模块[序号]`，序号跨轮不稳定，合并只会堆积对不上号的旧条目。
- `231a5f80` 兼容派工有待修不推水位：我方早已如此。
- `bf3bc1dc` 维护一次性提交 / 待修未清即停止策划：新机制与策略调整。
- `63aacfb4` 正文与楼层身份解耦：与我方「工作流在途楼层被编辑即作废」的有意规则冲突，且牵涉填表，不在缺陷范围。
- `48c02522` 总纲维护挪回主 Agent：流程调整，我方固定工作流维护总纲工作正常。
- `99131857` 宿主交接身份改由编排器自动填写：架构调整，我方严格身份校验正确。
- `133f423f` 主 Agent 单次成功读取：策略调整，随提示词跟进再议。
- `ca4612bc` 分阶段诊断日志：诊断功能。
- `317dbf7e`（我方没有改写输入框的监听器）、`83ae1ba2`（我方已用待认领标记覆盖）、`f625f1b8`（触发方式不影响我方）、
  `0d2d46c4`（流程优化）、`205b1a38`（我方目标只比楼层与 swipe，不比正文）。
- `5b71997b` / `560f9067` 等提示词与布局提交：随第二阶段提示词跟进处理。

## 2026-10-16 智能续写默认提示词跟进（基线 `422e498d`，上游 V47–V52 问答版）

用户选择「只升级没动过的默认提示词」。我方版本标记推进到 V39（`spv5.1-continuation-upstream-qa-prompts-v39`）。

已跟进：

- 主 Agent、总纲、结算维护、主线策划、伏笔与节拍策划、终审、网页检索、写作指令编排、阶段大纲九组默认提示词换成上游问答版
  （身份 → 「具体格式输出」→ 各职责问答 → 运行时资料段 → 尾部预填充）。连续性审查与用户要求维护上游没有，沿用 V38。
- 迁移按整组判断：整组与 V38 冻结默认逐段相同（角色、正文、启用状态）才换新；改过任何一段、增删段的整组原样保留，
  不做逐段拼接。旧版本迁移链与缺键补齐改为固定指向 V38 冻结默认，不随当前默认漂移。
- 终审资料补伏笔账本与信息差时间线（固定证据门同步计入），供新版终审快照引用。
- 子代理多轮对话时，本次派工的对话记录插在尾部预填充之前，预填充只出现一次（对应上游 history 卡片位置）；此前会出现两条。

按我方运行时改写、未照搬：

- 交付格式段保留我方协议：总纲 / 维护 / 检索的写集放在最终交付的 sql 字段；无变化时交显式空 delta（我方解析器有意拒收
  只有 summary 的维护输出），维护与总纲新建条目自带 id（我方领域事务不代为编号，百科资料库除外）。
  上游 V52 的「summary + delta 优先」、`write_sql` 后只交 summary、`withEntryId_ACU` 自动编号不跟。
- 上游「每次运行只有一个成功读取批次」「不输出 search」不跟：我方未移植单次读取强制，按读取预算放行多批次与检索。
- 上游独立快照卡片（`snapshotTemplate`）与 history 卡片不跟：子代理资料仍是普通 user 段；主 Agent 运行时快照照旧追加在会话记录里。
  主 Agent 去掉「子代理资料边界」段（我方不把主快照附给子代理）。
- 网页检索保留 TT 只能直连萌娘与维基、任意网页抓取不可用的说明；百科资料库 UPDATE 仍须给齐 page_ref、name、brief。
- 主 Agent 补回「策划冲突由 instruction-composer 自查、红线由 finalReviewer 终审」一句（上游删了，我方工作流仍是这样分工）。
- 顺带修正：V38 主 Agent 正文里直接写了年代学占位符，主 Agent 渲染不填它，实际发出去是空串；新版改为说明读取地址。
