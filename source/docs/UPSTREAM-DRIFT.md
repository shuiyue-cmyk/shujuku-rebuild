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
