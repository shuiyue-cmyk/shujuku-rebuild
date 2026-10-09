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
