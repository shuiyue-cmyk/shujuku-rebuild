# G14 跨组线索专项查证（协调者合并）

本文件由协调者合并三个专项查证子代理（G14-A / G14-B / G14-C）的结果，统一编号 G14-xx。
查证对象：各组「跨组线索」中，**指向的文件负责组已完成复审、但其报告的「发现」与「复核过但判定没问题的可疑点」均未覆盖**的线索。
基线 HEAD `75d536c6`，对比 `2e83b108`。全部只读查证，未改动仓库、未执行 git 写操作；探针均在仓库外临时目录跑完删除。

## 概览
- 结论：**P1 × 1，P2 × 7，P3 × 3**（成立 11 条）；另**驳回 2 条**（#6、#28，误报/已覆盖）、**并入既有发现 1 条**（#8 → G01-01）。
- 分派：G14-A 查 7 条 presentation/（G12 文件）线索；G14-B 查 4 条 G01 文件线索；G14-C 查 2 条 G04/G09 文件线索（+ 查证中发现 1 条额外点）。
- P1（G14-01）已由协调者亲自抽查：行号存在、引文与实际代码一致。

---

## 发现

### G14-01 [P1｜已坐实] 正文替换页「重新优化」(reoptimizeLatest) 缺 R9-01 写回快照守卫：AI 在途期间用户就地编辑/滑动目标楼层被静默覆盖
- 来源：G14-B 查证线索#43（G05 提出，根因在 G01 文件 `content-replace-store.ts`；G01 通读该文件但未报）。**协调者已亲自抽查通过。**
- 位置：
  - `source/src/presentation-v2/stores/content-replace-store.ts:788-833`（`reoptimizeLatest`）；弱守卫 `:811-815`（`chatChanged` 只比对象引用/`message_id`/聊天标识，**不比 `mes`/`swipe_id`**）；写回不带 expected `:822`
  - 对照 sibling（有完整守卫）：`content-replace-store.ts:747-786`（`optimizeCurrentContent`，`:763` 捕获 writeTarget、`:767` 复核、`:775` 传 `expected`）
  - 被绕过的守卫本体：`source/src/service/chat/chat-service.ts:1168`（`options.expected !== undefined` 才复核）；快照判定含 `mes`/`swipe_id`：`chat-message-write-target.ts:36-45`
  - 用户入口：`source/src/presentation-v3/pages/ContentReplacePage.vue:39`（`@click="store.reoptimizeLatest"`）
- 触发：正文替换页点「重新优化」→ 发 AI 请求（约 10–60 秒）。在途窗口内用户对**目标楼层**就地编辑正文（改 `mes`）或滑动到另一 swipe（改 `mes`/`swipe_id`）——两者都保持消息对象引用与 `message_id` 不变。
- 现象：AI 返回后 `chatChanged` 判「未变化」→ 继续写回；`replaceChatMessage_ACU` 未传 `expected` → chat-service.ts:1168 的 R9-01 快照复核被整段跳过 → 把基于**陈旧原文**的再优化结果写进 `mes`，**用户刚才的编辑/滑动被静默覆盖丢失**。
- 原因（关键代码）：
  ```ts
  // reoptimizeLatest 弱守卫（content-replace-store.ts:811-815，无 mes/swipe_id）
  const chatChanged = Boolean(chatIdentityAtStart || messageAtStart)
    && (currentChat !== chatAtStart || String(currentChatFileIdentifier_ACU||'') !== chatIdentityAtStart
      || currentMessage !== messageAtStart
      || (messageIdAtStart != null && currentMessage?.message_id !== messageIdAtStart));
  // 写回不带 expected（:822）
  const success = await replaceChatMessage_ACU(messageIndex, result.optimizedContent, { originalContent });
  ```
  sibling `optimizeCurrentContent` 却做对了（`:763/767/773-776` 捕获 writeTarget + `isChatMessageWriteTargetCurrent_ACU` + 传 `expected`），后者靠 `message.mes === target.mes`（chat-message-write-target.ts:43）拦住就地编辑/滑动。
- 已排除：查了 `replaceChatMessage_ACU` 全部 6 个调用点——optimization-ui 的 4 条与 `optimizeCurrentContent` **都传 expected**，**只有 reoptimizeLatest（:822）没传**；chat-service.ts:1180 `reconcileMvuBlocksWithFloor_ACU` 只调和 MVU 块、不拒一般编辑；`chatChanged` 能拦删楼/切聊天（对照组），拦不住同对象改 `mes`/`swipe_id`。探针复刻两处守卫布尔条件对「就地编辑」「滑动」做对照，分歧确定复现。
- 测试：`optimization-ui-write-target.test`、`chat-service.test` 覆盖 R9-01 的 expected 路径，但无针对 `reoptimizeLatest` 在途编辑/滑动的写回守卫测试。
- 修法方向：`reoptimizeLatest` 与 sibling 对齐——AI 调用前 `captureChatMessageWriteTarget_ACU`、返回后 `isChatMessageWriteTargetCurrent_ACU` 复核、写回传 `expected`（可删手搓的 `chatChanged`）。
- 与上一轮复审的关系：**R9-01 修复不完整 / 重复实现分叉**（post-baseline `748554fb` 新增 `optimizeCurrentContent` 用了完整守卫，却没回头升级 `reoptimizeLatest`）。
- 严重度说明：P1——数据被静默改写（用户编辑丢失），且 R9-01 同类修复原为 P1；触发需在 AI 在途窗口内编辑目标楼层（较常见但需时序巧合），协调者抽查确认引文与代码一致。

### G14-02 [P2｜已坐实] 决策判定错误体未经脱敏直达 toast / 判定测试输出，与已脱敏的召回路径分叉（服务商回显 Key 时明文暴露）
- 来源：G14-B 查证线索#2（G02 提出，根因在 G01 文件 `decision-gate.ts`；G01 复核#13 只确认了召回路径 `runtime.ts:324-327` 脱敏，未核 decision-gate 这条）。
- 位置：无脱敏取错误体 `service/optimization/decision-gate.ts:189-196`（`readErrorMessage_ACU`）、拼进消息 `:216-218`；用户可见面①toast `presentation/components/optimization-ui/optimization-ui-exec.ts:311`（`showToastr_ACU` 不脱敏）；②判定测试输出 `presentation-v2/stores/content-replace-store.ts:517` → `presentation-v3/pages/ContentReplacePage.vue:187`（`<pre>{{ store.testOutput }}</pre>`）；对照已脱敏的召回路径 `service/decision-recall/decision-recall-runtime.ts:324-327`（`describeDecisionRecallErrors_ACU`→`maskSensitiveText_ACU`）。
- 触发：开启「替换前判定」或正文替换页「判定测试」，决策服务商返回 4xx 且把自己收到的 Key 回显进错误体（`decision-recall-runtime.test.ts:404-411` 构造过该场景）。
- 现象：`readErrorMessage_ACU` 原样取 `body.error.message ?? body.message`，拼成 `HTTP 401：invalid api key sk-...`，作为 `DecisionVerdict{kind:'error',message}` 返回；该 message 经 toast 与测试输出面板**明文展示用户的 Key**，可被截图/贴反馈外泄。
- 原因（关键代码）：
  ```ts
  // decision-gate.ts:216-218
  if (!response.ok) {
    const reason = await readErrorMessage_ACU(response);   // 无脱敏
    return { kind: 'error', message: `HTTP ${response.status}${reason ? `：${reason}` : ''}` };
  }
  // optimization-ui-exec.ts:311（未过 maskSensitiveText_ACU）
  showToastr_ACU('warning', `决策判定失败（${outcome.message}），本楼照常替换`);
  ```
- 已排除：`readErrorMessage_ACU` 两个调用方——decision-gate.ts:217（判定，**未脱敏**）与 decision-recall-runtime.ts:201（召回，**经 runtime.ts:326 脱敏**），确属分叉；`showToastr_ACU`（toast.ts:367-406）只做去重与富文本净化、不调 `maskSensitiveText_ACU`；`maskSensitiveText_ACU`（log-buffer.ts:161-176）能掩 `sk-…`/`Bearer`/`apikey=`，只是没被调用。与 G01 复核#13 的召回脱敏路径不是同一条。
- 测试：`decision-recall-runtime.test.ts:404-411` 断言召回路径去掉 Key，但无 decision-gate 判定路径（toast/testOutput）的脱敏测试。
- 修法方向：decision-gate.ts:218 拼消息时对 `reason` 过 `maskSensitiveText_ACU`，或在两个展示点展示前脱敏，与召回侧统一口径。
- 与上一轮复审的关系：新问题 / 脱敏旁路（`maskSensitiveText_ACU` 文档注释 log-buffer.ts:225-229 已点明「toast/上游回显原文是旁路，展示前必须过这一层」）。**与 G02-02 同族**（G02-02 讲脱敏正则覆盖不全 + 三份实现分叉；本条讲 decision-gate 这条路径根本没调脱敏）。
- 严重度说明：P2——security/隐私缺口，但属边缘路径（需服务商回显 Key）、且泄露的是用户自己的 Key 到用户自己的界面。

### G14-03 [P2｜已坐实] 交火索引「重建失败」合成结果不释放 8 秒去重签名：窗口内点「重新生成」被 deduped 放行、不重召回，与 toast 承诺及 cf314c2d 声明矛盾
- 来源：G14-A 查证线索#10（G10 提出并自称已坐实、危害有限；根因在 G12 文件 `summary-vector-index-ui.ts`，G12-02 只涉及 :168-172 确认框、未覆盖此处）。
- 位置：`presentation/components/summary-vector-index-ui.ts:174,178`（合成 `{success:false, reason:'rebuild_failed'}` 不经 runtime、不调 `resetSummaryVectorIndexRuntimeDedupeState_ACU`）；`service/vector/summary-vector-index-runtime.ts:556-559`（释放条件对 `skipped:true` 不成立）、`:590-596`（签名已写入、窗口 8000ms）、`:92-99`；`presentation/bootstrap/init.ts:1109-1115`（失败停发 + 提示「点重新生成会重新召回」）。
- 触发：首轮召回返回 `rebuild_required`（skipped）→ 用户确认重建 → 重建失败（合成 `rebuild_failed`）→ 发送层停发并提示「点『重新生成』重试（会重新召回）」→ 8 秒内点「重新生成」。
- 现象：`isRetryOfStoppedSend` 放行门控 → runtime 去重命中（同 chatKey+同用户楼文本）→ 返回 `{success:true, skipped:true, reason:'deduped'}` → UI 判非失败 → **本次生成照常发出：不召回、不再弹重建确认**，与 toast 承诺及 cf314c2d「召回失败/取消后不再因去重跳过下一次召回」直接矛盾。
- 原因（关键代码 runtime:556-559）：
  ```ts
  const result = await runSummaryVectorRecall_ACU(options);
  if ((result.success !== true && result.skipped !== true) || result.reason === 'send_cancelled') {
    resetSummaryVectorIndexRuntimeDedupeState_ACU();   // rebuild_failed 是 UI 层合成、不经此处
  }
  ```
- 危害边界（与 G10 一致）：rebuild_required 属 skipped 且不在 SKIPS_KEEPING 集合 → 已回填完整纪要全文进世界书，被去重那轮带全文兜底生成、非空记忆；8 秒后下次发送重走重建确认。无数据损坏。
- 已排除：`markStoppedSendForRetry_ACU`、GENERATION_STOPPED、CHAT_CHANGED 链均不触碰去重状态；`bypassDedupe` 仅 UI 层重建成功后补跑使用。
- 测试：`summary-vector-index-ui.test.ts` 全 mock runtime、只断言合成返回形状；`summary-vector-index-runtime.test.ts`（cf314c2d +21 行）只测 runtime 层内失败释放——两层各自正确、组合缺口无人覆盖。
- 修法方向：UI 层返回 `rebuild_failed`/`recall_after_rebuild_failed`（summary-vector-index-ui.ts:197）前调用已导出的 `resetSummaryVectorIndexRuntimeDedupeState_ACU()`。
- 与上一轮复审的关系：**cf314c2d 修复不完整**。严重度 P2（边缘时序，但功能行为与 UI 明示承诺不符）。

### G14-04 [P2｜已坐实] init checkpoint 写入口对「字符串形态隔离容器」裸展开，产出字符下标垃圾键并丢失其他隔离键数据、静默落盘
- 来源：G14-C 查证线索#42（G05 提出，根因在 G04 文件 `storage-frame-v2-persist.ts:956-959`；G04 明说 760-1340 段本轮只抽查、依赖上一轮 block2b，未覆盖）。探针复现。
- 位置：根因 `service/table/storage-frame-v2-persist.ts:956-959`（裸展开原字段）、契约声明 `:939-940`（注释承诺「其他隔离键数据原样保留」）；未归一上游 `service/table/template-state-reset.ts:143-159`（reset 循环守卫只处理 object）、`:168`、`:180`（strict save）；触发入口 `presentation/bootstrap/api-groups/plot-preset-api.ts:322-329`（游戏初始化，`resetExistingTableData` 默认 true）。
- 触发：在**遗留聊天**上执行「游戏初始化 / 应用剧情模板」，且**首个 AI 楼层**的 `TavernDB_ACU_IsolatedData` 是**非空 JSON 字符串**（G05-01 已坐实这是 repo 层明示支持、有专测的遗留形态）。
- 现象：字符串容器被逐字符展开成 `{0:'{',1:'"',2:'o',...}` 数字垃圾键；该楼其他隔离键的**结构化数据被彻底丢失**，垃圾键随聊天落盘持久化，全程**无报错**（静默）。探针：64 字符 JSON 串 → 64 个垃圾下标键 + `other_key` 结构数据丢失，落盘从 215 字节膨胀到 730 字节。
- 原因（关键代码）：
  ```ts
  // storage-frame-v2-persist.ts:956-959
  target.TavernDB_ACU_IsolatedData = {
    ...(target.TavernDB_ACU_IsolatedData || {}),   // 字符串 'abc' → {0:'a',1:'b',2:'c'}
    [isolationKey]: { _acu_storage_version: 2, storageFrame: {...} },
  };
  ```
- 已排除：输入确可为字符串（`data/models/chat-message-data.ts:102` 联合类型；repo `parseIsolatedDataField` 双形态解析；`summary-vector-index-chat-service.ts:282-284` 刻意保留字符串形态）；无上游 parse 归一（reset 守卫只处理 object，写入口未经 `readIsolatedDataContainer_ACU`）；确会落盘且不报错（`:960` 单根断言按具体 isolationKey 读取、垃圾键不匹配→通过，`:180` strict save 序列化整条消息）。对照正确范式 `summary-vector-index-chat-service.ts:275-284`（先 parse、展开解析后对象、按原形态回写）。
- 测试：`storage-frame-v2-persist.test.ts:5047-5060` 只用 object 容器验证「其他键保留」；`template-state-reset.test.ts:66-68` 把写入口 mock 掉——字符串形态路径零覆盖。
- 修法方向：写入口内先 `readIsolatedDataContainer_ACU(target) ?? {}` 解析、展开解析后对象、按原形态回写，与 `summary-vector-index-chat-service.ts:275-284` 的「换字段契约」对齐。
- 与上一轮复审的关系：新问题。**与 G05-01 同源不同点**（G05-01 是「置 `{}`」变体、在 chat-service/checkpoint-delete-guard 的 4-5 处；本条是「展开」变体、在 storage-frame-v2-persist.ts）。建议与 G05-01、G14-08 一并统一修（所有写入/展开点先解析字符串容器）。
- 严重度说明：P2——静默数据丢失/损坏 + 落盘污染（本应 P1 级），但触发需「遗留字符串容器落在首个 AI 楼层 + 游戏初始化」边缘组合。**若认定字符串形态在存量聊天普遍，应上调 P1。**

### G14-05 [P2｜已坐实] 模板「翻译歧义」告警唯一去向是默认不采集的 logWarn_ACU、且不在返回值中：用户导入时得不到任何可见提示
- 来源：G14-C 查证线索#34（G03 提出，根因在 G09 文件；G09 把 `template-import-validator.ts` 列入「通读未发现问题」但未专门核对告警可见性）。
- 位置：`service/template/template-preset-service.ts:443-446`（唯一消费点，仅 `logWarn_ACU`）、`:481-489`（返回值**不含** `translationWarnings`）；检测器 `service/template/template-import-validator.ts:91-145`、`:88-89`（注释「warnings, not import blockers」）、`:119-123`/`:137-141`；`shared/utils.ts:206-210`（`logWarn_ACU` 被 `isWarnLogEnabled()` 门控）、`shared/log-buffer.ts:269-271,281,87-88`、`shared/v2-ui-state.ts:11-24`（默认 false）；三处导入调用方 `presentation/triggers/data-admin-ui.ts:350`、`presentation/bootstrap/api-groups/template-preset-api.ts:113`、`presentation-v2/composables/useTableTemplatePresets.ts:480`。
- 触发：用户导入含翻译歧义的模板（同一列展示名在两表映射到不同 SQL 列；或表展示名是某列展示名子串），走任一导入入口。
- 现象：检测器算出告警 → 仅 `logWarn_ACU`（默认 `warnLogEnabled=false`，首行 `if (!isWarnLogEnabled()) return;` 直接返回，连 console.warn 都不执行）→ 告警不在返回值 → 三个调用方无从取得 → 用户只见「导入成功」toast，**得不到任何翻译歧义提示**；后续旧式 SQL 全文翻译可能选错列/破坏列名而用户不知根因。
- 原因（关键代码）：
  ```ts
  // template-preset-service.ts:443-446
  const translationWarnings = detectDisplayNameTranslationHazards_ACU(jsonData);
  for (const warning of translationWarnings) logWarn_ACU(`[模板预设] SQL 展示名翻译风险：${warning.message}`);
  // 481-489 的 return {...} 不含 translationWarnings
  ```
- 已排除：`detectDisplayNameTranslationHazards_ACU` 全库唯一生产消费点就是 :443；`translationWarnings` 标识符全库仅出现 1 次（既不返回也不 toast）；`logWarn_ACU` 默认 no-op（`_warnByDebugCapture` 默认 false、`readWarnLogEnabled()` 缺省 false）；**存在现成用户可见通道却未用**（`postCommitWarning → toast`，data-admin-ui.ts:375/401 等大量 `showToastr_ACU('warning',…)`）；告警文案是面向用户的中文（非调试日志）。
- 测试：`template-preset-service.test.ts:572-611` 只断言检测器返回数组、无「告警展示给用户」的断言；且告警不进返回值，无出口可测。
- 修法方向：让 `parseImportedTemplateData_ACU` 返回 `translationWarnings`，调用方复用既有 `postCommitWarning → toast` 通道展示；至少改为默认可见的 `logError_ACU`/toast。
- 与上一轮复审的关系：新问题。**与 G03-03 同根**（WARN 级默认不采集 → 唯一原因出口丢失）。
- 严重度说明：P2（专为提醒用户而建的检测器输出被静默丢弃 + 已有可见通道未接）；**若产品认定这两类告警本就不面向用户，则属设计取舍、可降 P3/信息性**——但证据（用户向中文文案、现成 toast 通道、非技术用户群）指向应当可见。

### G14-06 [P2｜待坐实（触发前提）] 决策召回「单独召回」inFlight 置位在 try 外：中间同步异常（唯一现实抛点=宿主 toastr 裸调用）会让 inFlight 永不复位，此后整场会话单独召回静默跳过
- 来源：G14-A 查证线索#7（G01 提出，根因在 G12 文件 `decision-recall-ui.ts`；G12 复核#4 只谈按钮绑定、未谈 inFlight 复位）。
- 位置：`presentation/components/decision-recall-ui.ts:32,70-82,84,111-114`（`inFlight_ACU=true`（:71）在 `try`（:84）之外，复位只在 `finally`（:113））。
- 触发/现象：`:71-82` 之间唯一现实抛点是 `showProgressToast_ACU`→`showToastr_ACU`→`toast.ts:413` 对宿主 toastr 的裸调用（`toastr_API_ACU[type]?.(...)`，无 try/catch）。若宿主/美化脚本替换的 toastr 对 `info()` 抛错 → 异常冒泡 → 被 plot-orchestrator.ts:187-191 catch 转 no_match → init.ts:1225 策略2 再调 → 命中 `:70 if (inFlight_ACU) return {skipped, reason:'inflight'}` → 此后**整场会话**（模块级 let、跨聊天存活、无其它复位点）所有「单独召回」静默跳过，仅 debug 日志、无用户可见提示。伴生小泄漏：已 track 的 controller 不再 untrack，滞留到下次 `abortAllActiveRequests_ACU`。
- 关键代码（decision-recall-ui.ts:70-84）：
  ```ts
  if (inFlight_ACU) return { skipped: true, reason: 'inflight' };
  inFlight_ACU = true;                       // ← 置位在 try 外
  const controller = new AbortController();
  trackAbortController_ACU(controller, 'plot');
  const $toast = showProgressToast_ACU(() => { ... });  // 唯一现实抛点
  try { ... } finally { inFlight_ACU = false; ... }     // :111-114 才复位
  ```
- 已排除：逐条核查中间语句——`currentChatFileIdentifier_ACU`（普通 let 读取不抛）、`new AbortController()`（不抛）、`trackAbortController_ACU`（仅 Set/WeakSet.add，不抛）；`runDecisionRecallWithUI_ACU` 调用点仅 init.ts:1051/1148/1227（均有 try/catch）；`inFlight_ACU` 全文件仅 :32/:70/:71/:113 四处、无其它复位。
- 测试：无 `decision-recall-ui` 测试文件；init.test.ts:137-138 只 mock 它。异常置位段零覆盖。
- 修法方向：把 :71-82 移入现有 try，或在置位与 try 之间加局部 try/catch，失败即复位并返回 `{skipped, reason:'error'}` + warning toast。
- 与上一轮复审的关系：新问题（防御性缺陷）。**待坐实**：触发前提「宿主 toastr 对 info() 抛错」缺仓内证据（仓库自己在 toast.ts:280-282,382-385 假设宿主会替换 toastr，但替换实现是否抛错无证据）。严重度 P2（一旦触发则整场会话功能静默失效，但触发前提待坐实）。

### G14-07 [P2｜代码级已坐实，实际误停待真机] 交火召回收尾的 stopSendAfterLostLease 无条件调用全局 stopHostGeneration（不带聊天身份/生成代次）：切聊天后可能误停新聊天已开始的新生成，并连带作废其自动填表
- 来源：G14-A 查证线索#11（G10 提出，待坐实；根因在 G12 文件 `init.ts`；G12 复核#10 只谈同流程租约/自停、未谈跨聊天误停）。
- 位置：`presentation/bootstrap/init.ts:595-618,640-656,1101-1107,1118-1121`；窗口放大根因 `data/gateways/vector-embedding-gateway.ts:151,251-291`（embedding/rerank 不接切聊天中止信号，超时 45s×最多 2 次）。
- 触发（代码级确认）：交火召回在 `GENERATION_AFTER_COMMANDS` 钩子内 await（init.ts:1101-1103），期间租约失效（切聊天 chatChangeEpoch+=1 / 宿主重载 / 隔离标识变化）且 `hostGenerationStopSeq_ACU` 未变 → 收尾时 `!sendLease.isActive()` → `stopSendAfterLostLease_ACU`（:640-648）→ **无条件** `stopHostGeneration_ACU()`（:650-656，宿主全局 stopGeneration，不带任何身份/代次）。embedding/rerank 不接中止 → 最坏窗口数十秒，足够用户在 B 聊天完成载入→发送。
- 现象：租约只记 stopSeq/chatEpoch/chatKey/isolationKey（:606-618），**不含「切走后是否已有新生成开始」**（`generationGate_ACU.generationSeq` 有现成代次但未用）→ B 的新生成成为全局 stopGeneration 的受害者；附加：这次停止写 `selfHostStopAt_ACU`（:651）+ `foregroundTurnStopped=true` + `cancelPendingAutoTasks('generation_stopped')`（:908-911）→ **B 聊天自己刚排队的自动填表也被连带作废**；用户在 B 看到一条「交火召回」标题的莫名警告（:647）。
- 关键代码（init.ts:640-648）：
  ```ts
  function stopSendAfterLostLease_ACU(lease: SendLease_ACU): void {
    if (lease.stoppedByHost()) { ...return; }
    logWarn_ACU('[交火模式纪要索引] 召回期间聊天已切换或重载，本次生成已停止。');
    stopHostGeneration_ACU();   // 全局停止，无身份绑定
    showToastr_ACU('warning', '召回期间聊天已切换或重载，本次生成已停止，请重新发送。', '交火召回');
  }
  ```
- 已排除/对照：剧情推进路径停发前有两道 `plotScopeStillCurrent_ACU` 复检（init.ts:1140-1155），作用域变了提前 return 不停——向量路径相反，「作用域变了」正是它停发的理由，但停的是当时的全局生成。
- 待坐实（需真机）：① TT 切聊天时是否派发 GENERATION_STOPPED / 中止旧生成（若是则 `stoppedByHost()` 提前返回、不触发）；② A 卡在钩子期间 B 是否真能发起新生成（宿主单 abortController 语义）。
- 测试：init.test.ts（cf314c2d +53 行）覆盖「自停窗口不算用户终止」，无「切聊天后误停新生成」场景。
- 修法方向：捕获租约时记录 `generationGate_ACU.generationSeq`；`stopSendAfterLostLease_ACU` 仅在「当前无更新的前台生成上下文」时才全局停止，否则只放弃写回。附带：`vector-embedding-gateway` 的 embedding/rerank 接上 `getChatMutationAbortSignal_ACU`（与 prompt-api-call.ts:84 一致），缩小窗口。
- 严重度说明：P2——代码级「全局停止无身份绑定」已坐实；实际误停取决于宿主事件时序（需真机）。

### G14-08 [P2｜待坐实] chat-service 边界/收敛写回对字符串形态隔离容器裸展开（与 G14-04 完全相同的模式，G05-01 漏掉的独立点）
- 来源：G14-C 查证#42 时额外发现；**协调者已亲自读到该裸展开代码**（`...(candidateAnchor.TavernDB_ACU_IsolatedData || {})`）。根因在 G05 文件 `chat-service.ts`，不在 G05-01 所列 4-5 处写入点内。
- 位置：`service/chat/chat-service.ts:1081-1082`（boundary/convergence 分支，`candidateAnchor.TavernDB_ACU_IsolatedData = { ...(candidateAnchor.TavernDB_ACU_IsolatedData || {}), [isolationKey]: {...} }`），位于 `:1077` 的 `transitionRef || requiresCheckpointConvergence || compatibilityRepairs` 分支内，操作 `structuredClone(chat)`（:1078）。
- 触发/现象：与 G14-04 同——若 `candidateAnchor.TavernDB_ACU_IsolatedData` 是字符串形态，裸展开产字符下标垃圾键、其他隔离键数据丢失；`candidateExistingTagData`（:1080）对字符串取 `[isolationKey]` 得 undefined。
- 已排除/待坐实：代码模式已由 G14-C 与协调者直接确认（与已坐实的 G14-04 完全同构）；**缺一步**：该 `candidateChat` 端到端落盘路径未单独探针跟踪（G14-C 未展开细查，因根因在别组文件）。
- 修法方向：同 G14-04——先 `readIsolatedDataContainer_ACU` 解析再展开、按原形态回写。建议与 G05-01、G14-04 一并统一修 chat-service/storage-frame 全部字符串容器写入点。
- 与上一轮复审的关系：新问题。**与 G05-01、G14-04 同族**（字符串形态 IsolatedData 未在写入/展开点解析）。严重度 P2 待坐实（模式已确认，端到端落盘待跟踪）。

### G14-09 [P3｜已坐实] settings-ui-trigger 的 ops 未接 processGroupedUpdates（全仓无此实现）：SQLite 自动填表普通组恒走 legacy 路径，R2A-01/05/06/11 分叉延续，本轮 postCommit 向量收尾又新分叉一处
- 来源：G14-A 查证线索#30（G03 提出，根因在 G12 文件 `settings-ui-trigger.ts`；G12 复核#13 只谈 R9-18 scopeKey、未谈此接线）。
- 位置：`presentation/triggers/settings-ui-sync/settings-ui-trigger.ts:250-277`（ops 只有 processUpdates/processStagingGroupedUpdates，无 processGroupedUpdates）；`service/table/update-scheduler.ts:372-374`（`if (ops.processGroupedUpdates)` 恒假）、`:375-410`（legacy 分支）、`:278`（死接线）；行为分叉 `service/table/update-orchestrator.ts:2424-2427`（统一路径世界书刷新失败→跳过向量收尾）vs `:3885-3894`（legacy 无条件跑）。
- 核实：`processGroupedUpdates_ACU` 全仓 grep 0 命中；基线 `2e83b108` 时接线已如此（非本轮回归）；R2A 文档（block2a-fill-pipeline.md:26,98）早已记录该现状并建议统一，未实施。本轮 36fbb040（git blame 确认）新增行为分叉：「表格已提交、世界书刷新失败」时统一路径不刷交火镜像、legacy 照刷。
- 实际影响：交火镜像派生自实时纪要表（非世界书内容），表格提交两侧都成功；「跳过」一侧的镜像陈旧由下次发送的 stale 检测自愈（runtime:683-692）。两侧均无数据损坏，差异仅罕见错误路径下镜像「立即新鲜 vs 延迟新鲜」。
- 修法方向：短期把 legacy :3885 条件对齐（`postCommitWarnings.length===0`）；根本解落实 R2A-11 统一路径建议（给 ops 接上分组统一提交 runner）。
- 与上一轮复审的关系：R2A-11「重复实现漂移」延续 + 本轮新分叉点。严重度 **P3**（结构分叉为主，行为危害轻微且可自愈，维护性隐患大于实际影响）。

### G14-10 [P3｜待坐实（宿主参数形态）] 交火召回 userInput 兜底取 params?.prompt 无类型守卫：真实发送后 12 秒内点「继续」可把整段格式化 prompt 当用户输入向量化
- 来源：G14-A 查证线索#12（G10 提出，待坐实；根因在 G12 文件 `init.ts`）。
- 位置：`presentation/bootstrap/init.ts:1090-1092`（兜底 `String(pendingTextInBox || params?.prompt || '')`，无类型守卫/长度归一）；门控 `service/runtime/state-manager.ts:291-308`（不排除 continue）、`:238-245`、`:54`（USER_SEND_TRIGGER_TTL 12s）；下游 `service/vector/summary-vector-index-runtime.ts:120-131,174-191,721-737`（关键词 AI 无截断、embedding 前 300 字符截短重试）。
- 触发：用户真实发送后 12 秒内点「继续」（continue 不记发送意图、MESSAGE_SENT 不触发）→ 末楼是 AI 楼、发送框空 → 落到 `params?.prompt`。
- 现象：若宿主 `params.prompt` 是整段格式化提示词（文本补全后端可达数万字符）→ 关键词 AI 全链路无截断（超大请求烧 token 或失败被 catch）；queryText 整段送 embedding，被拒后按前 300 字符截短重试（多是系统/世界书前言）→ 查询向量语义失真 → 召回质量劣化（minScore 可能全灭→跳过、保留上一轮索引）；BM25 同样被巨型 query 污染。无崩溃、无数据损坏、不停发。
- 待坐实：宿主 `params.prompt` 实际形态（仓内无宿主源码；文本补全后端=整段 prompt，聊天补全后端通常无 prompt 键→空串→无害跳过）。
- 修法方向：兜底仅接受 `typeof params?.prompt === 'string'` 且截尾（如末 500 字符），或对 `type==='continue'` 直接不跑交火召回（与 regenerate 排除对齐）。
- 严重度说明：P3（窄窗口 + 质量/成本劣化，无崩溃/损坏），宿主参数形态待坐实。

### G14-11 [P3｜已坐实] plot-preset-store.setEnabled 生产代码零调用（死代码），且与 Dashboard 的 setGlobalPlotEnabled_ACU 总开关重复
- 来源：G14-B 查证线索#25（G13 提出，根因在 G01 文件 `plot-preset-store.ts`；G01 未报）。
- 位置：`presentation-v2/stores/plot-preset-store.ts:220-230`。
- 现象：`setEnabled`（剧情推进总开关）在全部 `src/` 中只有定义处一次出现、无任何生产调用方；唯一引用是测试 `tests/presentation-v2/plot/plot-preset-store.test.ts:468`。生产里剧情总开关实际走 `useDashboardPage.ts:1077-1089` 的 `setToggle('plotEnabled')`→`setGlobalPlotEnabled_ACU`——`setEnabled` 是与该 live 路径重复、但从未接线的一份拷贝。
- 已排除：`grep -rn "setEnabled" src/` 只命中定义行；Vue 模板（PlotPage/PlotPresetSection/DashboardPage）用 setPendingDisguiseEnabled/refreshFromSettings/setActivePresetForCurrentChat，无 setEnabled。
- 修法方向：删除 `setEnabled`（连同专属测试），或把 Dashboard 的 `setToggle('plotEnabled')` 改为复用它，消除重复实现。
- 与上一轮复审的关系：新问题（P3 清理项：死代码 / 分叉的重复实现）。

---

## 复核过但判定不成立 / 并入既有发现（供核查者免重复查证）

### 线索#6 [不成立｜误报] content-optimization「保留建议全部命中写回保护→误报未匹配到正文」——该状态不可达
- 位置：`service/optimization/content-optimization.ts:334-342`（`appliedCount===0` 分支，文案「AI 返回的优化建议均未匹配到正文」）。
- 结论：**不成立**。G14-B 读穿三处证明 `hitProtected` 与 `appliedCount===0` 互斥：①预过滤 `filterOptimizationsByExcludeRules_ACU`（text-optimization.ts:278-329）已把命中排除段/MVU 的建议丢进 `dropped`、不进 `kept`；②写回阶段 `hitProtected`（text-optimization.ts:372-378）只在「前面已有建议改过正文（appliedCount≥1、protectedRanges 被重算）」后才可能为真；③解析器 `normalizeOptimizationItem_ACU`（content-optimization.ts:461-480）只产出带 original+optimized 的 replace 项。故 `appliedCount===0 ∧ kept.length>0` ⟹ 每项都是原文里定位不到（真·未匹配），文案准确。把握程度：已坐实（逻辑闭环，无需真机）。
- 附注（信息性，另一条分支、根因疑在调用方，未展开）：当**全部**建议被**预过滤**丢弃（`exclusion.kept.length===0`）时走 content-optimization.ts:347 `return {success:true, optimizations:[]}`，调用方（optimization-ui-exec.ts:150-151）据 `optimizations.length===0` 提示「原文已足够好，无需优化」，与真实原因（被用户排除规则全数丢弃）不符——不属线索#6 所指，仅记录。

### 线索#28 [不成立｜已被多层守卫覆盖] init.ts autoFillIntent.chatKey 取当前聊天→旧聊天迟到 ENDED 错挂
- 位置：`presentation/bootstrap/init.ts:969-985`（chatKey 捕获于 :975）。
- 结论：**不成立/已覆盖**（印证 G03 复核#3、G12 复核#13 的判断）。G14-A 逐层核对守卫：①事件到达前 CHAT_CHANGED 同步 `markChatChangedForEndedGate_ACU`（init.ts:806）置 10 秒基线窗 + `chatChangeEpoch+=1` + `abortOnChatMutation_ACU` + `clearAutoFillDebounce_ACU`；②配对层 `resetScriptStateForNewChat_ACU` 清 activeGenerations，迟到 ENDED 走无配对分支（基线窗内只立基线不放行、窗后签名相同则 `unpaired_ended_no_new_output` 丢弃）；③调度层 R9-18（settings-ui-connect.ts:265-266,369-418,283-285,472-488）以排程时点 chatKey 为基线多次复检；④楼层解析 `resolveGeneratedAiMessageIndex_ACU`（message-handler.ts:95-177）按 message_id 唯一匹配、多候选 ambiguous 丢弃；⑤GENERATION_STARTED/STOPPED/MESSAGE_DELETED 均 `cancelPendingAutoTasks_ACU`。「跨聊天自动填表作废」正是 d36d31f0/R9-18 的既定设计（宁可不填不可错填）。残余理论缝隙需三重巧合（宿主切聊天不发附带 ENDED + 迟到 ENDED 在基线窗后 + message_id 恰在 B 数组命中 AI 楼），列为真机观察项，不足以立案。

### 线索#8 [前提成立→并入 G01-01] 动作 toast 跨聊天存活可点
- 位置：渲染层 `presentation/theme/toast.ts:422-436`；缺陷本体在 `presentation/components/optimization-ui/optimization-ui-diff.ts:176-185`（G01-01 文件，非 toast.ts）。
- 结论：G14-A 确认代码层前提成立——本仓无任何「切聊天清 toast」代码（CHAT_CHANGED 只 abortOnChatMutation + clearAutoFillDebounce），动作 toast（timeOut:8000、acuBypassMute:true）切聊天后存活、8 秒内可点；点击闭包无聊天身份校验（「重新优化」→ `reoptimizeMessage_ACU(旧 messageIndex)`，R9-01 的 writeTarget 是点击时刻才捕获、对「已切到 B 聊天」天然免疫检测）→ 可对 B 聊天同序号楼层发起 AI 优化并写回。**缺陷本体（action 闭包不校验聊天身份）根因在 optimization-ui**，toast.ts 只是忠实渲染 → **并入 G01-01 的跨聊天变体**（G01-01 已标该变体「待坐实」，G14-A 补齐了代码层前提）。仅剩「TauriTavern 是否在切聊天时自行 toastr.clear()」需真机（仓内无证据，标准 toastr/ST 均无此行为）。不在 toast.ts 记独立缺陷。

---

## G14 查证中发现的额外跨组线索（回抛，供后续参考，未展开）
1. `data/gateways/vector-embedding-gateway.ts:251-291` 的 embedding/rerank 调用不接 `getChatMutationAbortSignal_ACU`/trackAbortController（与 `prompt-api-call.ts:84` 不一致）——是 G14-07（#11）误停窗口放大的根因之一，根因文件在 G05（data/）；G05 复核过该网关的 SSRF/apiKey，未提中止缺失。建议随 G14-07 一并加固。
2. `service/runtime/message-handler.ts:128-133`（`resolveGeneratedAiMessageIndex` 规则 2）对 eventMessageId 的索引兼容分支无新鲜度约束——是线索#28 残余理论缝隙所在，根因在 G03（service/runtime）；仅记录，不足以立案。

## 设计层面的疑虑（不计入缺陷）
- `stopHostGeneration_ACU` 作为「全局唯一停止手段」被多处复用（召回失败、规划失败、租约失效），其副作用（selfHostStopAt 窗口、foregroundTurnStopped、cancelPendingAutoTasks）一律作用于「当前聊天/当前生成」而非「触发它的那次生成」——G14-07（#11）只是这个结构性假设的一个爆发点。
