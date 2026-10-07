# 全库复审 · 第 7 块：共享层（src/shared）

审查方式：只读审查。结论分两种：「已坐实」指有探针复现或调用链完整追踪；「待坐实」指推断。探针都放在会话 scratchpad，已从 `source/tests` 移走。已对照 `docs/CODE-REVIEW.md`，不重复已登记项（如 R1-05「SQL 分句器不识别注释」）。

## 覆盖范围

**通读**
- `utils.ts`（deepMerge、deepClone、数值归一、模板解析、表排序号、SSRF 校验、`isEntryBlocked_ACU`）、`json-helpers.ts`、`template-preset-utils.ts`、`stable-row-id-allocator.ts`、`ai-floor.ts`、`html-helpers.ts`、`agent-worldbook-comment.ts`、`agent-worldbook-snapshot.ts`。
- 行身份与表身份：`canonical-row-normalizer.ts`、`canonical-checkpoint-validator.ts`、`sheet-identity.ts`、`sheet-identity-merge.ts`。
- SQL 相关：`restricted-sql-dml.ts`、`sql-identifier-mapper.ts`、`sql-read-resolver.ts`、`sql-mutation-table-rebind.ts`、`ddl-utils.ts`、`sql-active-template.ts`。
- 宿主适配：`host-compat/entry-format.ts`、`host-compat/native-st-backend.ts`、`host-compat/tavern-helper-compat.ts`、`host-bridge.ts`、`host-input.ts`、`runtime-env.ts`、`env.ts`。
- 其他：`text-optimization.ts`、`boundary-ranges.ts`、`summary-vector-index-scope.ts`、`isolation-policy.ts`、`template-data-mode.ts`、`data-constants.ts`、`idb-import-temp.ts`、`sha256-sync.ts`、`lorebook-read-error.ts`、`legacy-loop-fields.ts`、`template-runtime-change.ts`、`table-defaults/index.js`。

**略读**
- `log-buffer.ts`（只看了脱敏和环形缓冲）、`runtime-performance.ts`、`trigger-diagnostics.ts`、`table-storage-provider.ts`（纯接口）、`defaults.ts`（只查了 deepMerge 会碰到的默认值形态）。

**未覆盖**
- `table-defaults/*.js` 各表的提示词文本、`defaults-json.js`、`romance-overrides.js`（数据，不是逻辑）。
- `models/*`（纯类型）、`ui-surface-registry.ts`、`tt-mobile-surface.ts`、`build-info.ts`。

**整体印象**
- **行身份和表身份相关的 helper 写得很严**：
  - row_id 分配只增不复用；
  - 物理表名撞名时直接报错，不偷偷改名；
  - 列别名有歧义时拒绝写入；
  - 读路径会先把字符串字面量保护起来，再做旧式名称翻译。

  这些 helper 都有清晰的契约注释，没发现会静默改写表数据的问题。
- **问题集中在偏边缘的纯文本工具和宿主适配上**：
  - 正文优化写回时的引号处理会改坏正文（P1）；
  - 原生世界书后端「整本读、改、整本写」不加锁；
  - 世界书「屏蔽词」按子串匹配，会误伤正常条目；
  - 受限 DML 把字符串里的 `where` 当成关键字。

---

## 统计

| 级别 | 数量 | 已坐实 | 待坐实 |
|---|---|---|---|
| P0 | 0 | 0 | 0 |
| P1 | 1 | 1 | 0 |
| P2 | 4 | 3 | 1 |
| P3 | 6 | 5 | 1 |

R7-02 的 helper 行为已经用探针坐实，调用方是否真的会并发写入属于推断，所以记作「已坐实」。R7-05 的 key 相撞已经坐实，下游的实际影响待坐实，记作「待坐实」。

| 编号 | 级别 | 一句话 |
|---|---|---|
| R7-01 | P1 已坐实 | 正文优化写回时 `processSingleQuotes_ACU` 会丢掉闭合引号、破坏中文嵌套引号、把英文撇号改成弯引号 |
| R7-02 | P2 已坐实 | 原生 ST 世界书后端整本读改写不加锁，并发写会丢条目（两次并发 create 还会分到同一个 uid） |
| R7-03 | P2 已坐实 | `isEntryBlocked_ACU` 按子串屏蔽「状态/规则/cot/格式…」，正常条目会被静默排除出填表、剧情和 Agent 的世界书上下文 |
| R7-04 | P2 已坐实 | 受限 DML 的 UPDATE 正则把 SET 字符串里的 ` where ` 当成 WHERE 关键字，合法语句被整条拒绝 |
| R7-05 | P2 待坐实 | 向量 scope 把空隔离键归一成 `default`，和用户自建的隔离码 `default` 撞成同一个 scope |
| R7-06 | P3 已坐实 | `deepMerge_ACU` 在 target 值为 null/undefined/字符串/数组时会吞掉 source 对象（目前没有默认值命中，属于潜伏问题） |
| R7-07 | P3 已坐实 | DDL 列注释按行解析：DEFAULT 字面量里含 `--` 时注释错位，`updateDDLColumnComment` 还会把 DDL 改坏；一行写多列时注释张冠李戴 |
| R7-08 | P3 已坐实 | `canMergeTemplateSheet_ACU` 恒为 true（每张表都有 `row_id PRIMARY KEY`），而且没有调用方 |
| R7-09 | P3 已坐实 | 写路径列重绑在全语句扫描时会碰到表名，以及无列清单 INSERT 的 VALUES 里的 `NULL`/函数名 |
| R7-10 | P3 待坐实 | 历史行身份恢复把首列表头恰好叫 `id` 的业务列当成身份列 |
| R7-11 | P3 已坐实 | 小项：正整数归一对 (0,1) 返回 0、模板解析的死回退、坏掉的文档注释、`localeCompare` 签名、IDB 写入不等事务提交 |

---

## P1

**R7-01 [P1 已坐实] 正文优化写回时引号会被改坏：闭合引号丢失、中文嵌套引号被破坏、英文撇号被改成弯引号**
- 位置：
  - `src/shared/text-optimization.ts:189-215`（`processSingleQuotes_ACU`）；
  - `:369`（`applyOptimizationsWithStats_ACU` 对每一段替换后的文本都无条件调用它）；
  - 唯一的生产调用方是 `src/service/optimization/content-optimization.ts:306`，结果写回聊天正文。
- 现象/触发路径：
  1. 每条替换都会对 `finalContent = 原文前缀标点 + 优化后正文 + 原文后缀标点` 跑两轮正则：先把 `‘…’` 改成 `“…”`，再把 `'…'` 也改成 `“…”`。
  2. 如果这对引号之后只剩标点（`afterMatch` 去空白后没有任何字母、数字或汉字），代码只返回 `“内容`，**闭合引号直接丢掉**。
  3. 中文小说里「段末一句嵌套引用」非常常见，例如 `“她说‘别等我’。”`。这一句的单引号对后面只有 `。”`，于是变成 `“她说“别等我。”`：嵌套层级坏了，闭合引号也丢了。
  4. 英文撇号被当成引号对：`I don't know, it's fine` 变成 `I don“t know, it”s fine`。正文里出现两个撇号（例如 `Tom's … Ann's`）就会命中。
  5. 写回的是用户的聊天正文。用户只会看到「优化成功」，不会知道引号被改了。功能开启时，每次替换段落里出现上面任一形态都会命中。
- 证据：探针 `zz-review-probe-r7-rebind.test.ts`「nested chinese quotes」和 `zz-review-probe-r7-shared.test.ts`「processSingleQuotes」：
  - `processSingleQuotes_ACU('他说：“她说‘走吧’。”')` 输出 `他说：“她说“走吧。”`；
  - 完整走 `applyOptimizationsWithStats_ACU` 时，原文 `…一句‘别等我’。”` 写回为 `…一句“别等我。”`；
  - `她低声道：'走吧'。` 替换后写回为 `她轻声说：“走吧。`；
  - `Tom's sword and Ann's shield …` 写回为 `Tom“s sword and Ann”s shield …`。

  现有用例 `tests/shared/text-optimization.test.ts:219-242` 只断言结果「包含 “」，没有锁住上面这些行为。
- 修法方向：
  - 首选：删掉 `processSingleQuotes_ACU` 这一步。优化后的文本应该原样写回，引号风格交给提示词约束。
  - 如果必须保留：只在单引号前后都是 CJK 字符、并且确认成对时才转换，任何情况下都不能删掉闭合引号；撇号（两侧都是拉丁字母）一律不动；已经处在 `“…”` 里面的 `‘…’` 不转换。
  - 补红用例：嵌套引号段末、英文撇号、单引号对后面只有标点。
- 备注：第 8 块（service/optimization）也在看正文优化。这一条的根因在 shared，归在这里。

---

## P2

**R7-02 [P2 已坐实] 原生 ST 世界书后端「整本读 → 改 → 整本写」不加锁，并发写会互相覆盖丢条目**
- 位置：`src/shared/host-compat/native-st-backend.ts:158-172`（`setLorebookEntries`）、`:174-194`（`createLorebookEntries`）、`:196-210`（`deleteLorebookEntries`）。
- 现象：
  1. 三个写方法都是先 `await loadWorldInfo(book)` 拿到整本书，改完内存后再 `await saveWorldInfo(book, data)` 整本写回，中间没有任何串行化。
  2. ST 的世界书缓存在 get 时会做 structuredClone，所以两个交错执行的写操作各自改各自的副本，后保存的那个会覆盖先保存的。
  3. `createLorebookEntries` 按「当前最大 uid + 1」分配 uid，两次并发 create 会拿到同一个 uid。
  4. `worldbook-gateway.ts` 和 `worldbook-service.ts` 里也没有找到锁或队列。
  5. 没有酒馆助手的宿主（纯 TT 插件模式）只能走这个后端。注入刷新、Agent 接管、外部导入、清理这些功能各自写世界书。只要在时间上重叠，就会丢掉其中一方的条目或修改。
- 证据：探针 `zz-review-probe-r7-native.test.ts`。用一个带 5ms 异步延迟、按 structuredClone 读写的假 ctx，并发执行两次 create 加一次 set，结束后书里只剩 set 的结果，两条新建条目全部丢失。调用方实际会不会并发，属于推断。
- 修法方向：
  - 在 native backend 内按书名加一个 Promise 链互斥，把 load→save 包成临界区；
  - create 时在临界区内重新计算 uid。
  - 如果要在 gateway 层统一串行化（同样覆盖 mapped 路径），也可以一起做。

**R7-03 [P2 已坐实] 世界书「屏蔽词」按子串匹配，正常条目会被静默排除出填表、剧情推进和 Agent 的世界书上下文**
- 位置：
  - `src/shared/utils.ts:388-393`（`isEntryBlocked_ACU`）；
  - 调用方：`src/service/worldbook/pipeline.ts:1681`（填表世界书上下文）、`src/service/runtime/plot-runtime/plot-task-engine.ts:1393`、`src/service/continuation/agent/agent-worldbook-read.ts:142`、`src/presentation-v2/composables/worldbook-entry-display.ts:107`（UI 里也不显示为可选）。
- 现象：
  1. 只要条目的 comment 中**包含**「规则、思维链、cot、MVU、mvu、变量、状态、Status、Rule、rule、检定、判断、叙事、文风、InitVar、格式」中的任意一个子串，条目就会被丢掉。
  2. 常见的正常设定条目都会中招：「角色状态」「世界规则」「战斗检定说明」「主角的判断力」「叙事背景」，以及任何含 `cot` 的英文名（`Scott`、`Escort`、`cottage`）。
  3. 被屏蔽的条目不会出现在填表 AI、剧情推进和 Agent 的世界书资料里，UI 中也选不到。用户既不知道，也没法勾选回来。
- 证据：读穿调用链。四处调用都是直接 `return false` 或 `continue`，没有任何覆盖开关；`'Scott'.includes('cot') === true`。
- 修法方向：这是上游留下的「排除提示词类条目」设计，但匹配方式太粗。可以选择：
  - 改成按词边界或前缀匹配，并去掉 `cot` 这类短英文子串；
  - 或者只对未手动勾选的条目生效，用户显式勾选的条目优先；
  - 或者在 UI 上标出「被屏蔽」，并允许解除。

**R7-04 [P2 已坐实] 受限 DML 解析 UPDATE 时，把 SET 字符串里的 ` where ` 当成 WHERE 关键字，合法语句被整条拒绝**
- 位置：`src/shared/restricted-sql-dml.ts:131`（`/^UPDATE\s+…\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i`）。`parseRestrictedSqlDmlTolerant_ACU` 复用的也是这条文法。
- 现象：
  1. 非贪婪的 `SET (…)?\s+WHERE\s+` 会停在第一个出现的 ` where `（不区分大小写），不管它是不是在字符串里。
  2. 例如 `UPDATE t SET note = 'go where you want' WHERE id = '1'` 会被切成 SET=`note = 'go`，进而报「SQL 字符串字面量未闭合」。
  3. 容错版的引号改写和括号改写都救不回来，这条写入最终进入 rejected。
  4. 中文正文很少命中；英文正文或中英混写里，`where`、`somewhere`（前后带空格的词形）出现的概率不低。逐栏 write_sql 和 Agent 的受限写入通道都走这个解析器。
- 证据：探针 `zz-review-probe-r7-shared.test.ts`「restricted DML」。严格版抛出「字符串字面量未闭合」，容错版 `statements=[]`、`rejected` 一条。
- 修法方向：先用和 `splitSqlAssignments_ACU` 相同的「引号感知扫描」找出字符串外的第一个顶层 `WHERE`，再按位置切分；不要用正则跨越字符串去匹配关键字。
- 备注：和 R1-05（分句器不识别注释）不是同一个问题，但修法可以合并成「共享一个引号感知的词法扫描」。

**R7-05 [P2 待坐实] 向量 scope 把空隔离键归一成 `default`，和用户自建的隔离码 `default` 撞成同一个 scope**
- 位置：`src/shared/summary-vector-index-scope.ts:7-17`（`normalizeScopePart_ACU`、`normalizeSummaryVectorIsolationKey_ACU`）、`:24-31`（`toChatIsolationSlotKey_ACU`）。
- 现象：
  1. 空串（默认槽）和字面量 `default` 规范化后都是 `default`。`' a '` 和 `'a'` 也会因为 trim 撞在一起。
  2. 隔离码目前仍然可以在数据管理页切换（`useDataManagement.ts:383` → `switchIsolationProfile_ACU`），只做 trim，没有保留字检查。
  3. 用户如果建了一个叫 `default` 的隔离码，同一聊天里默认槽和 `default` 槽的纪要向量索引就会共用同一个 scope key。热缓存记录、manifest 比对（`vector-index-hot-cache.ts:203/429/1002`）和清理（`chat-database-purge.ts:246`）都按这个 key 判定，可能出现相互覆盖、误召回或误回收。
  4. `toChatIsolationSlotKey_ACU('default', '')` 返回 `''`，从 scope 反推槽键时也分不清是哪个槽。
- 证据：探针确认 `serializeSummaryVectorIndexScope_ACU({chatKey:'c', isolationKey:''}) === …({…, isolationKey:'default'})` 为 true。下游的实际覆盖或回收没有用探针跑过。
- 修法方向：
  - 默认槽用一个不可能出现在用户输入里的哨兵（例如 `\u0000default` 或 `__acu_default__`）；
  - 或者在 `normalizeIsolationCode_ACU` 拒绝 `default` 这个保留字。

---

## P3

**R7-06 [P3 已坐实] `deepMerge_ACU` 在 target 值不是对象时会吞掉 source 对象**
- 位置：`src/shared/utils.ts:30-48`。
- 现象：
  - `key in target` 为真、但 `target[key]` 是 null 或 undefined，而 source 是对象时，递归调用 `deepMerge_ACU(null, obj)` 会返回 `{...null}`，也就是 `{}`，source 的内容全部丢失。
  - target 是字符串时，会被展开成 `{0:'a',1:'b'}`；是数组时，会被展开成下标对象。
- 证据：探针输出：`{a:null}` 合并 `{a:{x:1}}` 得到 `{"a":{}}`；`{a:'ab'}` 合并后得到 `{"a":{"0":"a","1":"b"}}`。
- 影响：调用方是 `settings-service.ts:163/577/627` 和 `settings-readers.ts:92`，即「默认设置 ← 已保存设置」。目前默认值里没有 null 或 undefined；字符串型默认值配上对象型保存值的组合在现实里也不存在，所以暂无实害。一旦以后有人加一个 `foo: null` 的默认值、而用户保存的是对象，加载时用户配置就会被清空。
- 修法方向：只有 target 和 source 两侧都是普通对象时才递归，否则直接用 source 的值。

**R7-07 [P3 已坐实] DDL 列注释按行用正则解析，边缘写法下会错位；`updateDDLColumnComment` 会把 DDL 改坏**
- 位置：`src/shared/ddl-utils.ts:92-113`（`parseDDLColumnComments`，正则在 `:106`）、`:944-988`（`updateDDLColumnComment`，正则在 `:963`）。
- 现象：
  1. 正则 `.*?--` 不识别字符串。`note TEXT DEFAULT '--', -- 备注` 解析出的注释是 `', -- 备注`。
  2. 在这种列上做列改名（可视化编辑器 `useVisualizerConfigEditing.ts:251`、改表助手 `compiler.ts:545`）时，结果是 `note TEXT DEFAULT '-- 新备注`：字符串没闭合，逗号也没了，DDL 被改坏。
  3. 一行写多列（`(row_id INTEGER PRIMARY KEY, name TEXT, -- 名字`）时，注释会挂到行首那一列（row_id 拿到「名字」）。
- 证据：
  - 探针 `zz-review-probe-r7-shared.test.ts`「DDL comment」；
  - 探针 `zz-review-probe-r7-ddl.test.ts`：hydrate 报「DDL 列「row_id」匹配到多个表头」，校验报列不匹配，能 fail-closed，但报错让人摸不着头脑。
- 修法方向：注释解析改用文件内已有的引号感知扫描（`findSqlLineCommentStart_ACU`、`splitColumnDefinitions`），按列定义而不是按物理行来取注释；`updateDDLColumnComment` 也用同一个扫描器定位注释的起点。

**R7-08 [P3 已坐实] `canMergeTemplateSheet_ACU` 恒为 true，而且没有调用方**
- 位置：`src/shared/template-data-mode.ts:98-103`。
- 问题：
  - 注释说「只有显式 UNIQUE/主键约束才能作为业务身份；缺失时不允许 merge（fail-closed）」，但所有合法 DDL 都必须带 `row_id INTEGER PRIMARY KEY`，正则 `\bPRIMARY\s+KEY\b` 必然命中，等于没有守卫。
  - 全库没有调用方；merge 的实际判定在 `template-data-preflight.ts`。
  - 后人如果拿它当闸门，会以为自己有 fail-closed 保护。
- 修法方向：删除；或者改成排除 row_id 之后再判断业务列上的 UNIQUE/PK。

**R7-09 [P3 已坐实] 写路径列重绑的「全语句扫描」范围过宽**
- 位置：`src/shared/sql-mutation-table-rebind.ts:451-465`（INSERT 列清单定位）、`:469-478`（全语句扫描）。
- 现象：
  1. 全语句扫描不排除 mutation 目标表那个 token。如果某列的别名恰好等于物理表名，表名会被改写成列名。探针里 `UPDATE wupin SET 物品 = …` 被改成了 `UPDATE item_name SET item_name = …`。
  2. 实际撞名需要「表的 slug」和「某列表头的 fallback slug 或显示名」相同。中文表名的 slug 会去掉下划线（`wupin`），列的 fallback slug 保留下划线（`wu_pin`），所以多数中文表不会撞；单字表名或纯 ASCII 同名（表 `items`、列 `items`）会撞。结果是 no such table，写入失败，不会写错数据。
  3. 无列清单的 `INSERT INTO t VALUES (NULL, …)` 或 `VALUES ('x', datetime('now'))`：「第一个 depth+1 的 token」落在了 VALUES 里，在 `requireKnownInsertColumns` 下 `NULL` 或函数名会被报成「未知列」。
- 证据：探针 `zz-review-probe-r7-shared.test.ts`「mutation column rebind」，以及 `zz-review-probe-r7-rebind.test.ts`（真实 alias map 下中文同名表不撞）。
- 修法方向：
  - 全语句扫描跳过 `mutationTarget` 返回的那个 token，以及 qualifiedTail 链；
  - INSERT 列清单只在「表名后紧跟 `(`」时才认；
  - VALUES 子句内的 token 不进列重绑。

**R7-10 [P3 待坐实] 历史行身份恢复把首列表头恰好叫 `id` 的业务列当成身份列**
- 位置：`src/shared/canonical-row-normalizer.ts:40`（别名集合含 `id`）、`:286`、`:324-327`。
- 现象：
  - 旧表如果没有身份列，而第一列业务表头恰好叫 `ID` 或 `id`（例如物品编号），会被原地改名成 `row_id`，原来的业务值（如 `A-01`）就成了 row_id，业务列从表头上消失。
  - 后续以 `row_id INTEGER PRIMARY KEY` 建表时，这类非数字 row_id 可能导致 hydrate 失败。
- 证据：探针输出 `[["row_id","名字"],["A-01","张三"],…]`。现实中的历史数据里是否真有「首列业务列名为 id」的形态，没有核实。
- 修法方向：只有当这一列的值全部为空或全部是纯数字时，才把 `id` 当作身份列别名；否则按「缺身份列」处理，插入新的一列。

**R7-11 [P3 已坐实] 小项**
- `utils.ts:93-98`：`normalizePositiveInteger_ACU(0.5)` 返回 0，违反「正整数」契约。应该在 floor 之后再判断是否大于 0。
- `utils.ts:290-298`：模板解析的「转义后解析」回退是死代码。整串转义之后没有外层引号，不可能解析成对象。
- `lorebook-read-error.ts:89-99`：两段文档注释交叠，`summarizeStrictLorebookReadError_ACU` 的说明被吞进了下一个函数的注释里。
- `agent-worldbook-snapshot.ts:7`：书名排序用无 locale 参数的 `localeCompare`，签名依赖运行时 locale。跨设备同步设置时，同一组书可能得到不同的签名，快照被判为失效。应改用码点比较。
- `idb-import-temp.ts:58-64`：`idbSet_ACU` 只等 request 成功，不等事务 complete，事务随后中止时会误报成功。`:29-48` 打开失败后，被拒绝的 Promise 会一直缓存，本会话再也不会重试 IDB。

---

## 已确认无问题（供后续复审参考）
- **row_id 分配**（`stable-row-id-allocator.ts`）：取所有十进制拼写（含 `01`）的最大整数值再加 1，超过安全整数就 fail-closed；分配完立即预留，不会和已有的数字拼写撞号。
- **canonical 规范化**：空 row_id 视为删除（当前协议语义）；重复 row_id 报错而不挑一个留下。历史数据走 `restoreLegacyRowIdentity_ACU` 时只补身份、不删行，有守恒计数。孤儿身份列复位遇到歧义行时整表放弃，不会冒险删除业务值。
- **物理表名**：是 sheetKey 和显示名的纯函数，撞名直接抛错，不追加 hash；拼音记忆化的 key 就是全部入参，不会跨作用域串味。
- **两代 sheetKey 归并**（`sheet-identity-merge.ts`）：
  - 只用于 SPv7.9 兼容回放的内存副本；
  - loser 的行按表头名映射，同一 row_id 两侧值冲突时保留 winner，并记录冲突；
  - 别名交集合并的前提（两张表的身份互不重叠）由模板协调器 `validateTableAliasDeclarations_ACU` 拦住。
- **SQL 读路径**：`translateLegacyReadSqlSafely_ACU` 先把字符串、注释和带引号的标识符替换成占位标记，再把 AS 和隐式输出别名也替换成占位标记，然后才调用宽泛的 NameMapper；`''` 转义处理正确。
- **SQL 写路径**：表别名和列别名有歧义时结构化拒绝；跨表或子查询时放弃列重绑并原样放行，或者抛出结构化错误；不会把值写进别的列。
- **受限 DML**：值只允许字符串、数字或 NULL；字段重复时拒绝；容错改写只在原文解析失败后才尝试，改写后仍然走严格文法。
- **JSONC 解析**：剥注释时能识别字符串，URL 里的 `//` 不会被切断。
- **宿主条目格式转换**：写方向只映射 patch 里真实存在的字段；mapped 的 `setLorebookEntries` 用 `updateWorldbookWith` 按 uid 合并嵌套子对象，不会把未指定的字段重置成默认值。
- **AI 楼判定**（`ai-floor.ts`）：宽、窄、数据承载三档口径清楚，工具楼和隐藏楼都排除了。
- **其他**：
  - `escapeHtml_ACU` 覆盖五个字符；
  - `agent-worldbook-comment.ts` 的 g 正则每次新建实例，没有 lastIndex 串扰；
  - `sha256-sync.ts` 实现正确（`>>> 0` 截断齐全）；
  - 区间合并和删除按从后往前切片，下标不会漂移。

## 探针（scratchpad，已从 `source/tests` 移走）
- `zz-review-probe-r7-shared.test.ts`（R7-01 / R7-04 / R7-05 / R7-06 / R7-07 / R7-08 / R7-09 / R7-10）
- `zz-review-probe-r7-rebind.test.ts`（R7-01 嵌套引号与完整写回；R7-09 真实 alias map）
- `zz-review-probe-r7-ddl.test.ts`（R7-07 一行多列）
- `zz-review-probe-r7-native.test.ts`（R7-02 并发读改写）
