# 全库复审 · 第 8 块：service/ai、plot、optimization、flight-mode 与其余小模块

审查方式：只读审查。结论分两种：「已坐实」指有探针复现或调用链完整追踪；「待坐实」指推断。探针都放在会话 scratchpad，已从 `source/tests` 移走。

## 覆盖范围

**通读**
- `src/service/ai/api-call.ts`：请求体组装、OpenCode 会话头、include/exclude body、`postChatCompletion_ACU` / `postChatCompletionTurn_ACU`、`callApiWithPlotPreset_ACU`、`callAIWithPreset_ACU`、`callAIWithResolvedPreset_ACU`（超时与取消）。
- `src/service/ai/prompt-builder/prompt-api-call.ts`（填表提示词组装、不可信 payload nonce 保护、流式/非流式解析）、`table-edit-parser.ts`、`table-fill-tools.ts`、`json-sanitizer.ts`。
- `src/service/ai/ai-service.ts`、`preset-rate-limiter.ts`、`token-counter.ts`。
- `src/service/optimization/content-optimization.ts`。
- `src/service/plot/plot-logic.ts`、`plot-orchestrator.ts`、`plot-state.ts`、`time-recall-prefill.ts`。
- `src/service/flight-mode/*`（state / hidden-rows / transition / big-summary-sheet-def）。
- `src/service/summary/merge-logic.ts`、`auto-merge-scope.ts`。
- `src/service/visualizer/visualizer-data-ops.ts`、`visualizer-source-revision.ts`。
- `src/service/workers/worker-pool.ts`、`loop/loop-evaluator.ts`、`host/host-state-service.ts`。

**部分精读或略读**
- `prompt-prepare.ts`：精读了数据源选择、行窗口、SQL 表名解析与锁定提示、`$1` 组装；世界书候选作用域只核对了调用契约（实现属第 6 块）。
- `worker-pool.ts` 的 Aho-Corasick 扫描只核对了与超时/回退相关的控制流，没有逐条比对它和主线程扫描的语义是否等价。

**为追调用链读过的块外代码**：`table/update-scheduler.ts:447-466`、`table/update-orchestrator.ts:5919-5940`（自动合并调用方）、`presentation/triggers/update-trigger.ts:33-36`、`settings/settings-service.ts:1397-1411`、`template/template-preset-service.ts:1230-1260`、`continuation/internal-ai-call.ts`、`presentation/bootstrap/init.ts:900-1060`（剧情推进写回）、`chat/chat-service.ts:1207-1224`、`presentation-v2/stores/content-replace-store.ts:648-700`。

**整体印象**
- **AI 调用层**整体比较扎实：SSRF 守卫、禁止重定向、错误体脱敏、不可信 payload 的 nonce 保护、取消信号转发都处理到了。问题集中在 `callAIWithResolvedPreset_ACU` 的超时口径上：它用的是墙钟上限，不是空闲上限。
- **飞行模式**的提交和状态写入分两步，失败时靠补偿回滚。补偿这一步没有复核聊天身份，切聊天后会把旧聊天的模板以硬删方式套到新聊天上。
- **自动合并纪要**在 UI 上已经停用，但触发链还在。只要设置里 `autoMergeEnabled=true`（导入旧设置即可做到），它就会带着空提示词运行，而且在 SQLite 模式下必然失败。
- **剧情推进与可视化编辑器**的切聊天守卫做得完整（`plotScopeStillCurrent_ACU`、`assertVisualizerContextMatches_ACU`），没有发现串聊写回。
- **文本改写类问题**：DSL 解析前会对全文做归一化，正文优化的占位符替换也会作用到已插入的正文。这些路径会静默改写用户或 AI 的文本，但在当前 SQLite 主路径上都属于旁路。

---

## 统计

| 级别 | 数量 | 已坐实 | 待坐实 |
|---|---|---|---|
| P0 | 0 | 0 | 0 |
| P1 | 2 | 2 | 0 |
| P2 | 5 | 4 | 1 |
| P3 | 7 | 7 | 0 |

## 汇总表

| 编号 | 级别 | 状态 | 一句话 |
|---|---|---|---|
| R8-01 | P1 | 已坐实 | 飞行模式启用/停用失败后的模板补偿不复核聊天身份，切聊天后旧聊天模板以硬删方式提交到新聊天 |
| R8-02 | P1 | 已坐实 | 内部 AI 的 120s 是墙钟上限且覆盖整个响应体读取，慢但正常的长生成被掐断并按可重试错误重发 |
| R8-03 | P2 | 已坐实 | 自动合并纪要：功能已停用但仍会触发，调用方传空模板，SQL 模式下必然解析失败，每次填表白烧 3 次请求；另有丢行、串聊、忽略 API 预设 |
| R8-04 | P2 | 已坐实 | DSL `<tableEdit>` 解析前对全文做归一化：全角冒号改成半角，JSON 里的 `\n` 变空格，`'+'` 被删 |
| R8-05 | P2 | 已坐实 | 正文优化先插入正文再替换占位符，正文里的 `$1/$5/$6/$7/$8/$U/$C` 会被替换，`$&`、`$'` 会被展开 |
| R8-06 | P2 | 已坐实 | 用户清空剧情推进的上下文排除规则后，每次加载设置都会被恢复成默认规则 |
| R8-07 | P2 | 待坐实 | 流式解析只认 OpenAI delta + `[DONE]` 与 Anthropic SSE，其它协议的流或不发 `[DONE]` 的流一律判为截断，返回 null 后被重试 |
| R8-08 | P3 | 已坐实 | `callAIWithResolvedPreset_ACU` 非 2xx 时抛不带 status 的普通 Error，续写重试会对 401/403/404 照样延时重打 |
| R8-09 | P3 | 已坐实 | `getLastOptimizedMessageIndex_ACU` 仍按楼号回退，和 `getOriginalContent_ACU` 已修正的口径不一致 |
| R8-10 | P3 | 已坐实 | `normalizeQuotesLayer_ACU` 的字符类里缺弯引号 `“”`（只剩两个 ASCII `"`），同时会把 `「」『』` 改成 `"` |
| R8-11 | P3 | 已坐实 | 正文优化的重试循环不检查取消，也不传 signal，用户终止后已排队的重试仍会发出 |
| R8-12 | P3 | 已坐实 | 剧情推进把 `_plot_processed` / `_qrf_plot_pending_hash` 写在聊天消息对象上，随聊天文件落盘 |
| R8-13 | P3 | 已坐实 | 填表占位符正则 `\$(?:0|1|…)` 会吃掉可信提示词里的 `$10`、`$100` 这类文本 |
| R8-14 | P3 | 已坐实 | 死代码：`getOptimizationApiConfig_ACU` 无调用方；`merge-logic` 只剩已停用功能在用 |

---

## P1

**R8-01 [P1 已坐实] 飞行模式启用/停用失败后的模板补偿不复核聊天身份，切聊天后会把旧聊天的模板以硬删方式提交到新聊天**
- 位置：
  - `src/service/flight-mode/flight-mode-transition.ts:206-219`（启用后找不到大总结表 → 补偿，`hardDeleteMissingSheets: true`）
  - `:221-250`（启用后状态写入失败 → 补偿，`hardDeleteMissingSheets: true`）
  - `:303-324`（停用后状态写入失败 → 补偿，把启用态模板写回）
  - `:103-135`（`persistFlightModeState_ACU` 检测到切聊天时会抛错）
  - 补偿目标的解析位置：`src/service/template/template-preset-service.ts:1244-1251`（`applyChatTemplateSnapshotWithReconciliation_ACU` 在调用当刻读取 `getChatArray_ACU()` 与当前隔离键）
- 现象/触发路径：
  1. 用户在聊天 A 开启飞行模式。模板提交成功后进入 `persistFlightModeState_ACU`，其中 `saveChatToHost_ACU` 要 await。
  2. 这段时间里用户切到聊天 B。`persistFlightModeState_ACU` 正确发现「聊天已切换」并抛错。
  3. catch 分支调用 `compensateTemplateCommit_ACU(template, { hardDeleteMissingSheets: true })`。这里的 `template` 是聊天 A 启用前的模板，而 `applyChatTemplateSnapshotWithReconciliation_ACU` 此时读到的「当前聊天」已经是 B。
  4. 结果有两个：
     - B 的模板作用域被 A 的模板覆盖；
     - B 里凡是 A 的模板中没有的表，都会按「跨全历史硬删」处理（`destructiveChangeConfirmed` 也被同时置真）。
  5. `:206` 分支同理：提交后切聊天，`currentJsonTableData_ACU` 已经是 B 的数据，找不到「大总结」表，于是走同一条硬删补偿。
  6. 停用分支（`:311`）会把 A 的启用态模板（含大总结表）写进 B。这一步不硬删，但 B 的模板被改写。
  7. 同时 A 侧也没有被正确补偿：A 的模板已经提交了大总结表，但飞行模式状态没写入。
- 证据：探针 `zz-review-probe-r8-flightmode.test.ts`。mock 的 `saveChatToHost_ACU` 在第一次保存时把当前聊天切到 B，`enableFlightMode_ACU()` 返回 `state_persist_failed`。第二次模板提交记录为 `{ chatId: 'chat-B', source: 'flight_mode_enable_state_rollback', hardDelete: true, sheetNames: ['纪要表'] }`。
- 修法方向：
  - 在 `enableFlightMode_ACU` / `disableFlightMode_ACU` 入口捕获 `chat` 引用、`currentChatFileIdentifier_ACU` 和隔离键。
  - 每个补偿分支先比对身份。身份不一致时不做补偿，只返回「聊天已切换，A 的模板可能残留大总结表，请回到 A 后重试关闭」这类可操作错误。
  - 更彻底的做法：让 `applyChatTemplateSnapshotWithReconciliation_ACU` 接受 `expectedChatIdentity`，不一致时 fail-closed。这样所有异步回滚调用方都能一并受益。

**R8-02 [P1 已坐实] 内部 AI 请求的 120s 是墙钟上限，并且覆盖整个响应体读取；慢但正常的长生成会被掐断，然后按可重试错误重发**
- 位置：
  - `src/service/ai/api-call.ts:737`（`INTERNAL_AI_FETCH_TIMEOUT_MS_ACU = 120_000`）
  - `:808-810`（计时器只设一次，没有任何「收到数据就重置」的逻辑）
  - `:854-858`（body 读取阶段被掐断后映射为 `TimeoutError`）
  - 重试方：`src/service/continuation/internal-ai-call.ts:190-200`、`:218-231`（除校验错误和 AbortError 外一律重试）
- 现象/触发路径：
  1. 常量注释写的是「它只兜永远等不到结果的挂死，不兜慢但有结果」。实现却是：计时器从发请求开始算，一直覆盖到响应体读完，中途收到数据也不重置。
  2. 流式请求时，响应头很快返回，但 body 要等整段生成结束才读完。非流式请求时，fetch 本身要等生成结束才返回。两种情况下，只要生成总时长超过 120s 就会被 abort。
  3. 续写给 outline / arcArchitect / maintainer / webResearcher 设置的输出下限是 8192 token（`CONTINUATION_ROLE_OUTPUT_TOKEN_FLOORS_ACU`）。带思考的模型以 30–60 tok/s 输出时，经常需要 140–300s。
  4. 被掐断后抛 `TimeoutError`，`isRetryableContinuationTransportError_ACU` 判为可重试，于是按 transportRetries 次数整段重发。每次重发同样超过 120s，所以必然再失败。
  5. 上游会对每一次被掐断的请求按输入和已产出 token 计费，最终重试耗尽，这一轮续写失败。
- 证据：
  - 探针 `zz-review-probe-r8-apicall.test.ts`：模拟一个 130s 才读完、期间不断出字的流式响应，`callAIWithResolvedPreset_ACU` 抛出 `TimeoutError`，`isRetryableContinuationTransportError_ACU` 返回 true。
  - 现有用例 `tests/service/ai/api-call.test.ts`「流式响应体读取期间内部超时映射为 TimeoutError」把这一行为固化成了预期。修复时需要同步改这个用例。
- 修法方向：
  - 改成空闲超时：fetch 阶段用 120s 等首包或响应头；body 阶段每收到一个 chunk 就重置计时器（需要把 `parseStreamResponse_ACU` 改成 reader 逐块读，或给它传一个进度回调）。
  - 非流式请求没有进度信号，可以把上限按 `max_tokens` 放宽，或者交给预设配置。
  - 另外，超时引起的重试至少要和「已产出 token」解耦，避免对同一个必然超时的请求反复整段重发。

---

## P2

**R8-03 [P2 已坐实] 自动合并纪要：UI 已停用但触发链仍在；调用方传空模板，SQL 模式下必然解析失败，每次填表后白烧 3 次请求；另有丢行、串聊、忽略 API 预设**
- 位置：
  - 触发：`src/service/table/update-scheduler.ts:447-462`、`src/service/table/update-orchestrator.ts:5921-5934`。两处都传 `promptTemplate: ''`。
  - 停用：`src/presentation/triggers/update-trigger.ts:32-36`（手动合并已停用）。`autoMergeEnabled` 没有 UI 开关，只能通过导入合并设置写入：`src/service/settings/settings-service.ts:1408`。
  - `src/service/summary/merge-logic.ts`：
    - `:203`：用 `String.replace` 拼接模板，空模板拼出来就是空串；
    - `:210-217`：用空串覆盖主提示词段；
    - `:222`：直接用 `settings_ACU.apiConfig`，不走任何预设，也不传 signal，不做限流；
    - `:233-238`：只按行匹配 `insertRow(...)`，并且把所有 `'` 替换成 `"`；
    - `:277-371`：finalize 不复核聊天身份。
- 现象/触发路径：
  1. 用户导入了带 `autoMergeEnabled: true` 的旧合并设置（插件自己的「导出合并设置」也会导出这个字段）。此后纪要条数一旦超过阈值，每次自动或手动填表完成后都会触发合并。
  2. 两个调用方传的模板都是空串。结果是：
     - 主段被清空，纪要数据（`$A`）根本没有进入提示词；
     - 其余段是原样的填表提示词，`$0`、`$1` 也没有被替换。
  3. SQLite 是唯一的存储模式，填表提示词要求 AI 输出 SQL，而解析器只认 `insertRow(`。于是解析失败，按 5s、10s 退避重试 3 次后抛错，被调用方的 catch 吞掉。
  4. 因为阈值条件一直满足，之后每一次填表都会再白烧 3 次请求，还要多等 15s 以上。
  5. 即使模板正确、AI 也返回了 DSL，还有三个问题：
     - 摘要里出现撇号（`O'Brien`），或者 JSON 里写了 `\n` 转义，这一行会被静默丢掉。finalize 用剩下的行替换掉全部被合并的原始行，丢掉那行的内容就此消失。
     - 保留下来的行里，全角冒号被改成了半角（来自 R8-04 的归一化）。
     - finalize 用的是 await 之后的 `currentJsonTableData_ACU`。如果中途切了聊天，A 的合并结果会替换 B 纪要表的前 N 行，并提交到 B。
- 证据：探针 `zz-review-probe-r8-merge.test.ts`。
  - 用例一：完全照搬调用方参数，发出的 system 段内容为 `''`，提示词里找不到任何纪要文本。`postChatCompletion_ACU` 被调用 3 次后抛错。
  - 用例二：AI 返回 3 行，其中含撇号的行和含 `\n` 的行被丢，`accumulatedSummary` 只剩 1 行，且该行内容是 `时间:清晨`。
- 修法方向：
  - 合并功能既然已停用，就在 `update-scheduler` 和 `update-orchestrator` 里删掉自动合并调用（或者在 `checkAutoMergeTrigger_ACU` 里恒返回 false），并在设置导入时忽略 `autoMergeEnabled`。
  - 如果将来要恢复这个功能，至少要做到：
    - 用 `settings_ACU.mergeSummaryPrompt` 或 SQL 版默认模板；
    - 解析走 SQL 提交模型；
    - 用 `JSON.parse` 失败时直接报错，不要做 `'` → `"` 替换；
    - finalize 前复核聊天身份和隔离键；
    - 走 API 预设，并支持 signal。

**R8-04 [P2 已坐实] DSL `<tableEdit>` 解析前对全文做归一化，静默改写单元格文本**
- 位置：`src/service/ai/prompt-builder/table-edit-parser.ts:16-25`（`normalizeAiResponseForTableEditParsing_ACU`）。调用方是 `extractTableEditInner_ACU` 和 `parseAndApplyTableEditsToData_ACU`（`update-orchestrator.ts:2154`、`:3566`，`table-fill-staging-session.ts:126`），以及 `merge-logic.ts:225`。
- 现象/触发路径：归一化对整段 AI 回复执行，不区分是否在 JSON 字符串内部：
  - `：` → `:`：中文单元格里大量使用全角冒号；
  - 字面 `\n` → 真换行：随后被行重组用空格拼回，原本的换行变成了空格；
  - `'\s*\+\s*'` 被删除：会误伤值为 `'+'` 这一类的内容；
  - `\\\\"` 被改写。
- 触发面：SQLite 模式下，只要 AI 在 `<tableEdit>` 里写的是 `insertRow/updateRow` 而不是 SQL（`isSqlContent` 判为 false），就会走这条 DSL 解析回退。自动合并（R8-03）也走这条路。SQL 主路径（`update-orchestrator.ts:1554` 自行提取）不受影响，所以定为 P2。
- 证据：探针 `zz-review-probe-r8-merge.test.ts`「DSL 解析前的全文归一化」：`insertRow(0, {"0":"身份：剑士\n第二行"})` 写入后，单元格变成 `身份:剑士 第二行`。
- 修法方向：
  - 只对 JSON 字符串之外的结构字符做容错，例如把参数分隔处的全角冒号改成半角。
  - 字符串内部原样保留，`\n` 交给 `JSON.parse` 正常解码。
  - 行重组不要用空格拼接 JSON 字符串内部的真换行。

**R8-05 [P2 已坐实] 正文优化先插入正文再替换占位符，正文里的 `$1/$5/$6/$7/$8/$U/$C` 会被替换，`$&`、`$'` 会被展开**
- 位置：`src/service/optimization/content-optimization.ts:192`（`replace(/\$CONTENT/g, content)`，替换值是字符串）和 `:196-201`（之后再对整段内容做 `$1…$C` 的全局替换，替换值同样是字符串）。
- 现象/触发路径：
  1. `$CONTENT` 先被替换成正文，替换值用的是字符串形式，所以正文里的 `$&` 会被展开为 `$CONTENT`，`$'` 和 `` $` `` 会被展开为提示词的前缀或后缀。
  2. 接着对整段内容（已经包含正文）逐个替换 `$1`（世界书）、`$5`（纪要索引）、`$6`、`$7`（前 10 条 AI 回复）、`$8`、`$U`、`$C`（角色描述）。
  3. 结果，正文里的「花了$5」「$1 一杯」「$C级」都会被替换成大段世界书、纪要或角色描述。另外，`$1` 的值（世界书内容）里如果含有 `$5` 等，会被继续链式替换。
  4. AI 看到的是被污染的正文，给出的 `original` 往往对不上真实正文，结果要么是 noOp，要么是基于错误上下文的改写。
- 证据：探针 `zz-review-probe-r8-optimization.test.ts`。输入正文 `他花了$5买了酒，是个$C级冒险者，单价$1。$&`，发出的提示词里出现了 `SUMMARY-INDEX-DUMP`、`CHARDESC`、`WORLDBOOK-DUMP`，并以 `CHARDESCONTENT` 结尾（`$&` 先被展开成 `$CONTENT`，其中的 `$C` 又被替换）。
- 修法方向：参考 `prompt-api-call.ts` 的做法，用一次全局正则加替换函数，同时处理 `$CONTENT` 和全部占位符，并且只扫描可信模板本身。正文和占位符值都不应该再被二次解释。

**R8-06 [P2 已坐实] 用户清空剧情推进的上下文排除规则后，每次加载设置都会被恢复成默认规则**
- 位置：`src/service/plot/plot-logic.ts:97-110`（`ensureTagRulesCompat_ACU`），由 `settings-service.ts:672` 在每次加载设置时调用。
- 现象/触发路径：
  1. 只要满足「`contextExcludeRules` 为空并且 `contextExcludeTags` 为空」，就把规则设为 `DEFAULT_PLOT_SETTINGS_ACU.contextExcludeRules`（`<disclaimer>`、`<Analysis>`、`<UpdateVariable>` 等 8 组以上）。`contextExtractRules` 也做了同样的处理，但它的默认值是空数组，所以没有实际影响。
  2. 这个判定分不清「旧版本还没迁移」和「用户主动删光了规则」。用户删光所有排除规则后，下一次加载时规则会被悄悄补回来，之后任何一次 `saveSettings_ACU` 都会把它持久化。
  3. 用户无法让剧情推进读到完整的上下文。
- 证据：纯函数，代码路径如上，条件中没有任何迁移标记。
- 修法方向：迁移只做一次，用版本号或 `_rulesMigrated` 标记判断。也可以只在字段缺失（`undefined`）时补默认值，空数组就当作用户的选择保留。

**R8-07 [P2 待坐实] 流式解析只认 OpenAI delta + `[DONE]` 与 Anthropic SSE；其它协议的流或不发 `[DONE]` 的流一律判为截断，返回 null 后被重试**
- 位置：`src/service/ai/prompt-builder/prompt-api-call.ts:447-500`（`parseStreamResponse_ACU`，`:481-488` 在没收到 `[DONE]` 或 `message_stop` 时直接返回 null）。
- 现象/触发路径：
  1. 预设可以选 `openai_responses`、`gemini_interactions`、`gemini_generate_content`（`api-call.ts:444`）。
  2. 代码注释说明 TT 对 `claude_messages` 的流是原样透传的。如果另外三种协议的流也是原样透传，那么：
     - Responses 的流是 `response.output_text.delta` / `response.completed`；
     - Gemini 的流没有 `[DONE]`。
  3. 这些流的正文全部无法解析，而且没有结束标记，于是每次都判为截断并返回 null。填表会把它当作 `RetryableAiResponseError_ACU` 反复重试，相当于每次都整段计费。
  4. 部分 OpenAI 兼容代理只给 `finish_reason` 而不发 `[DONE]`，同样会被误判。
- 待坐实点：仓内没有 TT 对这几种协议流式归一化的契约文档。修复前需要在真机上抓一次流。
- 修法方向：
  - 把 `choices[0].finish_reason` 非空，以及 `response.completed` 一类事件，也视为流结束。
  - 补齐 Responses 和 Gemini 的增量字段解析，或者在请求时对这些协议强制关闭流式。

---

## P3

**R8-08 [P3 已坐实] `callAIWithResolvedPreset_ACU` 非 2xx 时抛的是普通 Error，续写会对 401/403/404 照样延时重打**
- 位置：`src/service/ai/api-call.ts:837-840`；`src/service/continuation/internal-ai-call.ts:190-200`。
- 同文件已有 `AgentApiHttpError_ACU`（`:89`），而且 `isRetryableAiRequestError_ACU` 已经按 status 区分了是否重试，但这个入口两样都没用上。续写的重试判定又对所有错误一律放行，于是配置错误会按 transportRetries 次数加延时空转。这类错误通常不计费，所以定为 P3。
- 修法：改为抛 `AgentApiHttpError_ACU`，并在续写重试判定里复用 `isRetryableAiRequestError_ACU`。

**R8-09 [P3 已坐实] `getLastOptimizedMessageIndex_ACU` 仍按楼号回退**
- 位置：`src/service/plot/plot-logic.ts:914-921`。
- `chat-service.ts:1216` 的 `getOriginalContent_ACU` 已经明确「不再按楼号回退」，但这里在 messageId 找不到时（比如楼层被删）仍然回退到 `messageIndex`。「重新优化」于是会指向另一个楼层。后续取原文用的是那一楼自己的 `_acu_original_content`，不会串文本，但操作对象不是用户以为的那一条。
- 修法：messageId 存在却找不到时直接返回 -1。

**R8-10 [P3 已坐实] `normalizeQuotesLayer_ACU` 的字符类里缺弯引号，又会把中文书名号改成 `"`**
- 位置：`src/service/ai/prompt-builder/json-sanitizer.ts:13`。
- 字节检查显示字符类开头是两个 ASCII `"`，弯引号 `“”` 已经在某次编码转换中丢失。与此同时，`「」『』` 会被改成 `"`，再被转义成字符串里的引号，导致单元格里的中文对白括号被改写。只在 DSL 解析回退且 JSON 不合法时才会执行。

**R8-11 [P3 已坐实] 正文优化的重试循环不检查取消，也不传 signal**
- 位置：`src/service/optimization/content-optimization.ts:249-273`、`:288-355`。
- `cancelContentOptimization_ACU` 只设置一个标志，调用方只在调用前后检查它。`performContentOptimization_ACU` 内部最多有 `retryCount + (retryCount-1)` 次请求加退避，用户终止后这些请求仍会继续发出。

**R8-12 [P3 已坐实] 剧情推进的标记写在聊天消息对象上，随聊天落盘**
- 位置：`src/service/plot/plot-orchestrator.ts:56-61`。
- `_plot_processed`、`_qrf_plot_pending_hash` 直接挂在宿主的 chat message 上，会被写进聊天文件。异常路径只删除了 `_plot_processed`（`:181`）。建议改用 WeakMap，或放到 `extra` 下统一命名空间。

**R8-13 [P3 已坐实] 填表占位符正则会吃掉可信提示词里的 `$10`、`$100`**
- 位置：`src/service/ai/prompt-builder/prompt-api-call.ts:256`。
- `\$(?:0|1|4|6|8|9|U|C)` 没有右边界，用户在提示词里写的「$100」会变成「聊天记录 + 00」。
- 修法：加负向前瞻 `(?![0-9A-Za-z_])`。注意这会改变已有提示词的行为，修之前要先确认默认提示词里没有依赖这种写法。

**R8-14 [P3 已坐实] 死代码**
- `src/service/optimization/content-optimization.ts:363` 的 `getOptimizationApiConfig_ACU` 没有调用方。
- `src/service/summary/merge-logic.ts` 整个模块只被已停用的自动合并使用，如果按 R8-03 拆掉触发链，这个模块可以一并删除。

---

## 已确认无问题（供后续复审参考）

- `api-call.ts` 请求体组装：
  - apiKey 和附加头的换行清洗、OpenCode 会话头大小写容忍；
  - include_body 的 YAML 结构化合并及 memo（以内容为 key，不会读到过期值）；
  - 调试快照脱敏、`redirect: 'error'`、错误体脱敏后截断；
  - `maxTokensOverride` 对非法值的回退。
- `callAIWithResolvedPreset_ACU` 的外部取消转发、监听器解绑、`finally` 清理计时器，都正确。
- `prompt-api-call.ts` 的不可信 payload 保护：
  - 占位符值和表名 resolver 结果都先换成 nonce token，模板解释器跑完才还原；
  - token 会和全部可信、不可信文本做碰撞检查。
  - 这一点同时确认了 R3 系列的模板变量注入修复在本层成立。
- `prompt-prepare.ts`：SQL 模式下表名用请求前冻结的 `templateData` 解析，物理名冲突时 fail-loud；隐藏列投影不改原数据；飞行模式隐藏行只作用于投影。
- `table-fill-tools.ts`：工具调用合成 `<tableEdit>` 时会剔除正文残留块；参数不是合法 JSON 时按可重试处理；流式请求不挂工具。
- `preset-rate-limiter.ts`：滑动窗口和 abort 等待都正确。`ai-service.ts` 的模型探活：15s 超时覆盖到 body 读取，inflight 去重，force 穿透缓存。
- 剧情推进写回：`init.ts` 在调用编排前后都检查 `plotScopeStillCurrent_ACU`，策略 1 删除楼层前比对最后一楼的原文，没有发现串聊写回。
- `content-replace-store.reoptimizeLatest`：写回前比对聊天、楼层对象和 message_id。`getLastOptimizationBase_ACU` 按 chatKey 划界。
- `visualizer-data-ops.ts`：
  - 事务内外多处复核上下文 key；
  - 删除、更新、新增都按 row_id 定位，重复 row_id 时 fail-closed；
  - 已持久化但刷新失败时，用 `committed` 状态锁住编辑。
- `flight-mode-hidden-rows.ts`：只隐藏「写入前已存在且写入后仍在」的纪要行，同批新写入的行保持可见；投影函数不改原数据。`flight-mode-state.ts` 的 staged 回滚闭包正确。
- `time-recall-prefill.ts`：只升级与默认值逐字一致的预设，已经是目标形态时直接返回 null，迁移是幂等的。
- `worker-pool.ts`：超时、异常都会回退主线程，连续 3 次超时后停用 Worker，晚到的响应被忽略。

## 探针（scratchpad，已从 `source/tests` 移走）

目录：`C:\Users\zouyu\AppData\Local\Temp\claude\C--Users-zouyu-Downloads--------shujuku-rebuild\6f204fcf-f837-4e7c-9427-27ef9dd3e747\scratchpad`

| 文件 | 覆盖 | 结果 |
|---|---|---|
| `zz-review-probe-r8-flightmode.test.ts` | R8-01 | 1/1 通过（复现） |
| `zz-review-probe-r8-apicall.test.ts` | R8-02 | 1/1 通过（复现） |
| `zz-review-probe-r8-merge.test.ts` | R8-03、R8-04 | 3/3 通过（复现） |
| `zz-review-probe-r8-optimization.test.ts` | R8-05 | 1/1 通过（复现） |

运行方式：把文件放回 `source/tests/`，然后在 `source/` 下执行 `npx vitest run tests/<文件名>`（探针里的 import 路径以 `source/tests/` 为基准）。
