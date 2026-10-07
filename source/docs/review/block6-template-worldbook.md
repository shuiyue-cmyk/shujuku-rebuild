# 全库复审 · 第 6 块：模板（template）、改表助手（template-assistant）与世界书（worldbook）

审查方式：只读审查。结论分两种：「已坐实」指有探针复现或调用链完整追踪；「待坐实」指推断。探针都放在会话 scratchpad，已从 `source/tests` 移走。

## 覆盖范围

**通读**
- `src/service/worldbook/pipeline.ts`：世界书条目重建、`deleteAllGeneratedEntries_ACU`、`refreshMergedDataAndNotify_ACU`、严格读取、`collectCombinedWorldbookEntriesByStrategy_ACU`、`getCombinedWorldbookContent_ACU`。
- `src/service/worldbook/injection-engine-custom.ts`、`injection-engine-entries.ts`、`injection-engine-state.ts`、`injection-engine-config.ts`、`injection-engine-order.ts`。
- `src/service/worldbook/worldbook-cleanup.ts`、`read-scope.ts`、`read-context.ts`、`worldbook-placeholder-classification.ts`、`worldbook-service.ts`、`injection-engine.ts`。
- `src/service/template/template-preset-service.ts`：预设 CRUD、作用域持久化、协调提交入口、全局切换、跟随全局、导出。
- `src/service/template/template-seed-pollution-migration.ts`、`template-data-preflight.ts`、`dormant-data-service.ts`。

**部分精读或略读**
- `chat-template-reconciler.ts`：精读了主流程 `reconcileChatTemplate_ACU` 和 `reconcileMatchedSheet_ACU`。别名索引、DDL 回退、陈旧旧 key 识别只略读。
- `chat-scope/chat-scope-template.ts`：读了 scope 读写和 `activateChatTemplatePresetSelection_ACU`。
- `chat-scope/chat-scope-guide.ts`：读了 `setChatSheetGuideDataForIsolationKey_ACU`、`ensureChatSheetGuideSeeded_ACU`、`overwriteChatSheetGuideFromTemplate_ACU`、seedRows 兜底。
- `template-assistant/service.ts`：读了快照构造、占位符替换、草稿解析与校验入口、消息组装。
- `template-assistant/compiler.ts`：读了 v3 编译（replace/create/delete）、`applyStrictPatch_ACU`、row_id 守卫。v1/v2 的 content/schema/lock patch 只略读。

**未覆盖**
- `template-row-id-normalizer.ts`、`chat-scope/sheet-guide-row-id-normalizer.ts`、`template-import-validator.ts`、`template-seed-pollution-diagnostics.ts`、`guide-metadata-overlay.ts`。
- `chat-scope/chat-scope-range.ts`、`chat-scope-sheet.ts`、`chat-scope-plot.ts`、`chat-scope-base.ts`。
- `template-assistant/reference-docs.ts`（提示词文本）。
- 协调结果的提交层（`storage-frame-v2-persist.ts`）属于第 2b 块，本块只确认了调用契约。

**整体印象**
- **模板这一侧**：结构协调（reconciler）、提交入口加锁、chat identity 等待、baseline revision 校验都做得严密。主路径上没有发现静默覆盖用户模板的问题。
- **世界书这一侧**：问题集中在「哪些条目算本插件生成的」这条判定上。清理时用前缀匹配，注入过滤时又不认隔离前缀，两边口径不一致，结果是：
  - 用户自建条目会被误删；
  - 其它隔离环境的条目会被误删或混进本环境。

---

## 统计

| 级别 | 数量 | 已坐实 | 待坐实 |
|---|---|---|---|
| P0 | 0 | 0 | 0 |
| P1 | 2 | 2 | 0 |
| P2 | 9 | 8 | 1 |
| P3 | 3 | 3 | 0 |

---

## P1

**R6-01 [P1 已坐实] 「清理本插件生成条目」用表的 entryName 做前缀匹配，会删掉用户或卡作者自建的同前缀世界书条目**
- 位置：
  - 前缀匹配：`src/service/worldbook/pipeline.ts:606-619`（收集 `currentConfigPrefixes`）、`:646-648`（隔离分支）、`:663-665`（非隔离分支）。
  - 同一逻辑的副本：`src/service/worldbook/injection-engine-state.ts:257-270`、`:296-299`、`:313-316`。
  - 触发入口：`injection-engine-state.ts:68-91`（`enforceCleanupOfCharacterWorldbook_ACU`，由 `resetScriptStateForNewChat_ACU` 在 `:177` 调用）；`src/service/runtime/helpers-data-merge.ts:980-982`（新聊天首个初始 checkpoint 写入时 `cleanupWorldbook: true`）；另有数据管理删除、存档导入、修改注入目标等入口。
- 现象/触发路径：
  1. `deleteAllGeneratedEntries_ACU` 在固定前缀和 knownNames 之外，还会把当前表数据里所有「导出已启用」的表的 `exportConfig.entryName || table.name` 收作前缀。只要条目 comment 以这些前缀开头就删。
  2. 默认模板里纪要表启用了导出，entryName 是「纪要」；重要角色表也启用了导出，entryName 是「重要人物表」。所以默认情况下，凡是 comment 以「纪要」「重要人物表」开头的条目都会被删。
  3. 用户给自定义表开启整表导出时，entryName 默认等于表名（例如「人物」），以它开头的条目同样会被删。
  4. 本插件自己生成的自定义导出条目，comment 实际是 `TavernDB-ACU-CustomExport-…`，或者是裸 entryName 本身（见 R6-03）。裸 entryName 已由 knownNames 精确匹配兜住，这层前缀兜底拿来匹配裸前缀没有必要，只会误伤。
  5. 删除目标是注入目标书，默认就是角色卡绑定书，卡作者的设定条目都在这本书里。新聊天第一次初始化 checkpoint 时会删一次。如果注入目标被设成别的书，`enforceCleanup…` 每次切聊天还会对角色绑定书再删一次。删除不可恢复。
- 证据：探针 `zz-review-probe-r6-pipeline.test.ts` 用例 R6-D。纪要表 `exportConfig.enabled=true, entryName='纪要'`；书中有「纪要-世界观设定（作者手写）」「纪要索引说明」「无关条目」三条。`deleteAllGeneratedEntries_ACU('char-bound-book')` 删掉了 uid 1 和 2。
- 修法方向：
  - 删掉 `currentConfigPrefixes` 这条前缀兜底，只认固定的 `TavernDB-ACU-*` 前缀和 knownNames 精确名。
  - 如果确实需要兜底，就按 `TavernDB-ACU-CustomExport-${entryName}` 的完整生成格式（含 `-表头`、`-包裹-上/下`、`-N` 后缀）精确匹配。`worldbook-placeholder-classification.ts:122` 已经有现成的正则可以复用。
  - 两份 `deleteAllGeneratedEntries_ACU` 合并成一份（见 R6-12）。

**R6-02 [P1 已坐实] 开启数据隔离后，填表提示词 `$4` 不再排除本插件生成的条目，其它隔离环境的表格数据也会混进来**
- 位置：`src/service/worldbook/pipeline.ts:1676-1686`（`getCombinedWorldbookContent_ACU` 的 `includeEntry`）；对比 `src/service/worldbook/worldbook-placeholder-classification.ts:54-67`（`$9` 用的 `isDatabaseGeneratedLorebookEntry_ACU` 会先剥掉隔离前缀）。
- 现象/触发路径：
  1. `includeEntry` 判断生成条目用的是 `comment.startsWith('TavernDB-ACU-' | '重要人物条目' | '总结条目')`，直接拿原始 comment 比，没有先剥掉 `ACU-[code]-`。
  2. 隔离模式下生成条目的 comment 都是 `ACU-[code]-TavernDB-ACU-…`，因此全部通过过滤。
  3. 默认配置下，读取源（角色卡）和注入目标（角色卡绑定书）是同一本书。于是每次填表，`$4` 里都会出现：
     - 本环境的整张可读数据表（`ReadableDataTable`）、包裹条目、记忆条目，相当于把上一轮表格当作「世界书设定」再喂给填表模型；
     - 同一本书里**其它隔离环境**（`ACU-[Y]-…`）的表格和总结。
  4. 非隔离模式下，同一本书里 `ACU-[Y]-…` 的条目同样不会被排除，所以别的隔离环境的数据也会进到非隔离环境的 `$4`。
  5. 隔离功能本来就是为了让多套数据共用一本书而互不串扰，这里正好破坏了这一点。
- 证据：探针 R6-E。书中放四条：
  - `TavernDB-ACU-ReadableDataTable`：被正确排除；
  - `ACU-[X]-TavernDB-ACU-ReadableDataTable`：进入 `$4`；
  - `ACU-[Y]-总结条目1`：进入 `$4`；
  - 用户条目：进入 `$4`。

  实际输出为 `"ISO_X_GENERATED\n\nISO_Y_SUMMARY\n\nUSER_LORE"`。
- 修法方向：`includeEntry` 改为直接调用 `isDatabaseGeneratedLorebookEntry_ACU(entry)`，与 `$9` 同口径；或者先用 `normalizedComment` 再判断。另外要让 `ACU-[其它code]-` 前缀的条目在任何环境下都不进入填表上下文。

---

## P2

**R6-03 [P2 已坐实] 非隔离模式刷新自定义导出时，会删除其它隔离环境的已知条目；整表合并导出的 comment 是裸 entryName，会误删同名用户条目**
- 位置：`src/service/worldbook/injection-engine-custom.ts:110-112`（删除判定）、`:121-122`（knownNames 保留规则）、`:660-662`（合并导出的 comment 为 `${isoPrefix}${name}`，没有 `TavernDB-ACU-CustomExport-` 前缀）。
- 现象/触发路径：
  - **(a) 删除其它隔离环境的条目**
    1. 非隔离时 `isoPrefix=''`，`comment.startsWith('')` 恒为真，所以只要 comment 在 knownNames 里就删。
    2. knownNames 是全局设置；隔离环境 X 生成的名字（`ACU-[X]-…`）会被 `:122` 特意保留在里面。
    3. 于是同一本书在非隔离模式下刷新一次，就会把环境 X 的自定义导出条目删掉。X 下次刷新再建回来，两边来回删建。
  - **(b) 误删同名用户条目**
    1. 非导入、非拆分、无附加索引的整表导出走 `getMergedEntryComment_ACU`，comment 就是裸的 `entryName`（例如「自定义表」），并会写进 knownNames。
    2. knownNames 是全局的，没有区分书。用户之后把注入目标换成另一本书，那本书里 comment 恰好等于这个名字的用户条目就会在下次刷新时被删。
    3. 这种裸名条目也逃过了 R6-02 的生成条目过滤，会被当作普通世界书读回 `$4`。
- 证据：探针 `zz-review-probe-r6-custom.test.ts`：
  - 用例 R6-A：非隔离模式下 `deleteLorebookEntries('test-lorebook', [11, 12])` 删掉了 `ACU-[X]-` 条目；
  - 用例 R6-B：第一次刷新创建的 comment 是「自定义表」，并已写进 knownNames；换目标书后，书中同名用户条目 uid 99 被删。
- 修法方向：
  - 非隔离分支显式排除 `ACU-[` 开头的 comment，和 `deleteAllGeneratedEntries_ACU:653` 同口径。
  - 合并导出的 comment 统一加上 `TavernDB-ACU-CustomExport-` 前缀。
  - knownNames 按「书名 + 隔离码」分桶。

**R6-04 [P2 已坐实] 自定义导出用 `String.replace('$1', 表数据)` 拼正文，单元格里的 `$$`、`$'`、`` $` ``、`$&` 会被当作替换模式展开**
- 位置：`src/service/worldbook/injection-engine-custom.ts:195`（`finalTemplate.replace('$1', tableData)`）。同一文件 `buildEntryContent` 的所有调用点都受影响：拆分行、整表、附加索引、合并导出。
- 现象：
  - `$$` 会变成 `$`；
  - `$'` 会插入模板里 `$1` 之后的文本（无包裹时为空）；
  - `` $` `` 会插入 `$1` 之前的文本；
  - `$&` 会变成字面 `$1`。

  注入世界书、进而进入正文提示词的表格内容会被静默改写。`template-assistant/service.ts:736-744` 的注释已经点名这是禁止写法，但这里没有改。
- 证据：探针 R6-C。单元格 `$$5` 和 `A$'B` 导出后，正文变成 `"| $5 |\n| AB |"`。
- 修法方向：改用回调形式 `template.replace('$1', () => tableData)`；或者用 `split('$1')` 后再 `join`，并且只替换第一处。

**R6-05 [P2 已坐实] 改表助手 v3 「整表替换」会丢掉表的隐藏列集合和列/表别名，休眠列被唤醒，改名后的继承链断开**
- 位置：
  - `src/service/template-assistant/service.ts:909-935`：`TEMPLATE_ASSISTANT_PERSISTED_AUX_KEYS_ACU` 从 sheet **顶层**复制 `hiddenPhysicalColumns`、`tableAliases`、`columnAliases`。
  - `service.ts:915-927`：`sanitizeSourceDataSnapshotForAssistant_ACU` 只保留 note/initNode/… 和 ddl，把 sourceData 里的这三项过滤掉了。
  - `src/service/template-assistant/compiler.ts:1196-1250`：v3 replace 直接用模型返回的 sourceData 整体替换原 sourceData。
- 现象/触发路径：
  1. 这三项在全库都存放在 `sheet.sourceData` 里（`ddl-utils.ts:283`、`chat-template-reconciler.ts:402/534`）；全库没有任何地方把它们放在 sheet 顶层。
  2. 因此 aux 复制是空操作，模型看到的快照里没有隐藏集合；而表头和 DDL 里仍然包含隐藏列。
  3. 模型按快照回显时自然不会带上隐藏集合，v3 replace 后 candidate 的 sourceData 也就没有隐藏集合。
  4. 用户哪怕只是「改一下备注」，也会出现两个后果：
     - 隐藏（休眠）列变成可见列，开始进入填表 `$0` 和世界书导出；
     - 协调器 `reconcileMatchedSheet_ACU` 把这些列判为 active，从隐藏集中移除。
  5. columnAliases 和 tableAliases 丢失后，下次切模板时，已改名的列和表无法再靠别名认回，会落入休眠，数据不再继承。
- 证据：
  - 探针 `zz-review-probe-r6-assist-payload.test.ts`：`sourceData.hiddenPhysicalColumns=['old_col']` 的表，v3 payload 的 `selectedSheet.sourceData` 只有 `{note, ddl}`，`content[0]` 和 ddl 里仍有 old_col。
  - 探针 `zz-review-probe-r6-assist-compile.test.ts`：按快照回显 replace 后，candidate 的 sourceData 为 `{"note":"新备注","ddl":…}`，`getSheetColumnProjection_ACU` 显示 old_col 已变为可见。
- 修法方向：
  - aux 字段改为从 `sheet.sourceData` 读取，并原样放进快照。
  - v3 replace 编译时，把原表 sourceData 里的这三项合并回去（以本地为准，或者显式校验模型没有改动它们）。
  - `TEMPLATE_ASSISTANT_V3_AUX_KEYS_ACU` 把字段挂在顶层也是错的，要一并改到 sourceData 下。

**R6-06 [P2 待坐实] 世界书派生刷新在多次 await 之间不复核聊天身份；切聊天时，旧聊天的数据可能写进新角色的世界书**
- 位置：
  - `src/service/worldbook/pipeline.ts:144-147`：`dataOverride` 路径完全不做身份复核。
  - `pipeline.ts:252-267`：四个子更新器加上可读条目，各自独立调用 `getInjectionTargetLorebook_ACU()`。
  - `pipeline.ts:729-852`：`refreshMergedDataAndNotify_ACU` 在 `loadAllChatMessages` 和 `mergeAllIndependentTables_ACU` 之后，直接 `_set_currentJsonTableData_ACU` 并写世界书，没有身份复核。
- 现象：
  1. 冷路径（`dataOverride` 为空）只在回放结束时检查一次 chatKey 和隔离键。
  2. 之后的人物、总结、大纲、自定义导出、可读条目，每一步都有多次宿主 I/O，每一步都重新解析注入目标。
  3. 如果在这期间切了聊天或角色，注入目标会变成新角色的绑定书，后续步骤就把旧聊天的表格写进新角色的世界书。
  4. `refreshMergedDataAndNotify_ACU` 还会把旧聊天的 merged 数据设为当前运行时数据。
  5. 窗口长度取决于宿主 I/O，通常在百毫秒级；`refreshMergedDataAndNotify` 有 17 处调用。
- 证据：调用链追踪。窗口期内会解析到别的书，这一点没有用探针复现。
- 修法方向：
  - 入口处固化一次 `primaryLorebookName`，同时记下 chatKey 和隔离键；
  - 往下透传 `targetLorebookOverride`；
  - 每个子步骤之前复核身份，不一致就整体放弃。

**R6-07 [P2 已坐实] 「跟随全局」和全局模板切换，在长时间 await 之后对「当前」聊天执行 scope 翻转，切聊天后会改写别的聊天的模板作用域**
- 位置：`src/service/template/template-preset-service.ts:643-653`（`flipCurrentChatScopeToInheritGlobal_ACU`，没有任何身份参数）；调用点 `:705`（全局切换）和 `:1337`（跟随全局）。
- 现象：
  1. 协调提交 `applyChatTemplateSnapshotWithReconciliation_ACU` 内部会 await SQLite 重载和 `refreshMergedDataAndNotify_ACU`，耗时可达数秒。提交本身带身份校验。
  2. 但提交返回之后，翻转直接写 `getChatArray_ACU()` 的首楼并保存，没有校验这是不是刚才提交的那个聊天。
  3. 用户如果在这几秒内切到另一个聊天，那个聊天的 scope 会被改成 inherit_global，同时保存到宿主。
  4. 如果那个聊天原本是 chat_override，它的模板快照就失效了，聊天会转为跟随全局模板，而且没有经过协调器，不会有破坏性确认。
- 证据：调用链追踪，翻转前后都没有 identity 或 firstMessage 比对。
- 修法方向：协调提交的返回值里带上 `targetChatIdentity` 和 `expectedFirstMessage`；翻转前比对，不一致就放弃并提示；或者把翻转并入同一次提交。

**R6-08 [P2 已坐实] 模板预设库保存失败被当作成功：增删改都会向上报 ok**
- 位置：`src/service/template/template-preset-service.ts:159-168`（`saveTemplatePresetsStore_ACU` 不检查 `setItem` 的布尔返回值，恒返回 true）；对比 `src/data/storage/tavern-storage.ts:358-375`（设置持久化失败时会回滚 ns 并返回 false）。
- 现象：酒馆设置持久化失败时，`setItem` 已经把内存回滚并返回 false。但 `upsertTemplatePreset_ACU`、`renameTemplatePreset_ACU`、`deleteTemplatePreset_ACU` 仍然报告成功，UI 会提示「已保存/已改名」，实际什么都没写入。重命名尤其容易误导：用户以为旧名已经不存在了。
- 修法方向：`return store.setItem(...) !== false`，三个调用方据此报错。

**R6-09 [P2 已坐实] seed 污染迁移（data-admin API）三处问题：「已物化残留」判定永远不生效；回滚会把整段聊天还原到 prepare 时刻；提交会强制把聊天改成 chat_override**
- 位置：
  - `src/service/template/template-seed-pollution-migration.ts:246`、`:341`：runtime 数据取自 `globalThis.currentJsonTableData_ACU ?? globalThis.__currentJsonTableData_ACU`；`:286` 读 `globalThis.currentChatFileIdentifier_ACU`；`:356` 读 `globalThis.currentTemplatePresetName_ACU`。
  - `:351-356`：`syncTemplateScope: true`。
  - `:413-418`：回滚时 `plan.chat.splice(0, len, ...backup.chatSnapshot)` 后保存。
- 现象/触发路径：
  - **(a) runtime 判定从不生效**：全库没有任何地方把这几个变量挂到 globalThis 上（已 grep 确认），runtime 数据恒为 undefined。注释里承诺的「与 runtime 同业务键的 seed 视为已物化残留，清理」永远不会发生，只剩 content 重复这一种判定。
  - **(b) 回滚清掉 prepare 之后的所有变更**：
    1. 提交成功后计划立即删除（`:383`），所以能回滚的只有「已 prepare 但未提交」或「提交失败」的计划。
    2. 回滚时用 prepare 时刻的完整聊天快照覆盖整个聊天数组并保存。
    3. 作用域检查只比较数组引用，同一聊天里新增的楼层不会被识别为作用域变化。
    4. 结果：prepare 之后的所有消息、swipe 和表格帧都会被清掉，而且这次「回滚」本来没有任何东西需要回滚。
  - **(c) 强制 chat_override**：提交固定传 `syncTemplateScope: true`，原本跟随全局（inherit_global）的聊天会被静默改成 chat_override，模板被钉在当前快照上。
- 影响面：这几个入口目前只在 `data-admin-api.ts:80-82` 暴露，没有 UI 入口，所以定为 P2。
- 修法方向：
  - runtime 改为从 state-manager 导入 `currentJsonTableData_ACU`；
  - 回滚只恢复 guide 和 scoped config 两个容器，并且只允许针对已提交的计划（提交成功后保留计划供回滚）；
  - `syncTemplateScope` 按现有 scope mode 决定。

**R6-10 [P2 已坐实/后果待坐实] 模板数据 merge：业务键未命中、但 row_id 与 runtime 既有行相同的模板行，仍被计划为插入**
- 位置：`src/service/template/template-data-preflight.ts:296-303`（未命中就 push 到 `insertRowIds`，不检查 row_id 是否已被 runtime 占用）；`src/service/template/template-preset-service.ts:525-534`（`applyMergePlanToCandidate_ACU` 按原 row_id 追加）。
- 现象/触发路径：
  1. 典型场景：模板和当前聊天同源，row_id 一样，但用户在聊天里改过业务键（例如改了道具 code）。
  2. merge 时模板行未命中业务键，于是按原 row_id 追加进 candidate，同一张表里出现两个相同的 row_id。
  3. 下游提交时 `normalizeCanonicalTableRows_ACU` 大概率以 `duplicate_row_id` 拒绝（这一步未用探针坐实），最终表现是 merge 失败，报错信息与用户的操作对不上；如果下游没有拒绝，就会写入重复身份。
- 证据：探针 `zz-review-probe-r6-preflight.test.ts`。runtime 有 `['1','C9','盾牌']`，模板有 `['1','C1','铁剑']`，preflight 返回 `ok=true`，`insertRowIds=['1']`。
- 修法方向：preflight 对插入行检查 row_id 是否已被 runtime 占用，占用就重新分配稳定 id（或者给出 blocker）；`applyMergePlanToCandidate_ACU` 插入前再兜底检查一次。

**R6-11 [P2 已坐实] 大纲条目更新时用 `endsWith` 找「纪要索引」，会改写其它隔离环境或外部导入的纪要索引的启用状态**
- 位置：`src/service/worldbook/injection-engine-entries.ts:92`、`:165`。
- 现象：查找条件是 `comment.endsWith('TavernDB-ACU-CustomExport-纪要索引')`，不带当前隔离前缀，也不排除外部导入前缀；`find` 返回第一个命中的条目。同一本书里有多个隔离环境，或者有外部导入的纪要索引时，当前环境的 0TK 开关会去改别人的条目的 enabled，而自己的那条可能完全没被处理。
- 修法方向：按 `${isoPrefix}TavernDB-ACU-CustomExport-纪要索引` 做精确匹配。

---

## P3

**R6-12 [P3 已坐实] `deleteAllGeneratedEntries_ACU` 有两份几乎相同的副本**
- 位置：`src/service/worldbook/pipeline.ts:578-691`（导出版）、`src/service/worldbook/injection-engine-state.ts:229-342`（私有版，供 `enforceCleanup…` 使用）。
- 问题：R6-01 必须两处同步修改，漏改一处就会留下误删路径。
- 修法方向：`injection-engine-state` 直接改用 pipeline 的导出版。如果担心循环依赖，就把实现抽到一个独立模块。

**R6-13 [P3 已坐实] 两个绕过协调器的「模板作用域直写」函数仍然导出，但已无调用方**
- 位置：`src/service/template/chat-scope/chat-scope-template.ts:249`（`activateChatTemplatePresetSelection_ACU`）、`src/service/template/chat-scope/chat-scope-guide.ts:743`（`overwriteChatSheetGuideFromTemplate_ACU`）；两者都经 `chat-scope/index.ts:28/52` 导出。
- 问题：这两个函数直接写 chat_override 和 guide，不经过 V2 协调提交，正是 `template-preset-service.ts:823-827` 注释里明令禁止的写法。现在全库没有调用方，但留着就是隐患，后人很容易误用。
- 修法方向：删除。

**R6-14 [P3 已坐实] 开场白阶段的世界书抑制分支是死代码**
- 位置：`src/service/worldbook/pipeline.ts:126-139`；`src/service/runtime/helpers-data-merge.ts:833-837`（`shouldSuppressWorldbookInjection_ACU` 恒返回 false）。
- 问题：`updateReadableLorebookEntry_ACU` 里「抑制期间只清理」这条分支永远不会执行，注释却描述了一套还在生效的行为。
- 修法方向：删除这条分支和配套的抑制标志，或者在注释里写明已经废弃。

---

## 已确认无问题（供后续复审参考）
- **模板协调提交**：
  - `applyChatTemplateSnapshotWithReconciliationInternal_ACU` 入口会等待 chat storage identity 就绪；
  - baseline replay 前后比对 revision；
  - 提交前再比对一次 identity 和 firstMessage；
  - 同一聊天加隔离键维度上有进程内互斥。

  没有发现把计划提交到错误聊天的路径（R6-07 的问题出在提交返回之后）。
- **协调器的数据保护**：模板里缺失的表默认隐藏保留，硬删需要 `destructiveChangeConfirmed`；匹配表未认领的旧列进入尾部隐藏列，原值保留；生命周期为 indeterminate 时 fail-closed；有数据的表遇到 physical 撞名直接抛错，不会静默丢列。
- **全局切换**：`getCurrentChatTemplateScopeState_ACU` 对 inherit_global 返回 null，所以已经翻转过一次的聊天，下次全局切换仍然会走协调器，不会被绕过。
- **普通刷新的删建顺序**：总结条目和人物条目都是先建新条目、成功后再删旧条目（`injection-engine-entries.ts:204-286`、`:325-464`）；创建失败时旧条目保留。
- **外部导入条目**：清理逻辑会跳过带外部导入前缀的条目；外部导入不写 knownNames。
- **改表助手**：
  - 占位符替换使用单次扫描和回调替换，不会被 `$` 展开污染；
  - `applyStrictPatch_ACU` 只接受目标上已存在的自有键，`__proto__` 会被拒绝；
  - v3 校验 row_id 非空且不重复，并有删行守卫；
  - 模型输出只作为 JSON 数据解析，不会被当作代码执行。
- **读取上下文**：`read-context.ts` 按物理书名对 Promise 去重，失败的 Promise 不进缓存；dispose 时唤醒排队者，不会留下挂起的 Promise。

## 探针（scratchpad，已从 `source/tests` 移走）
- `zz-review-probe-r6-pipeline.test.ts`（R6-01 / R6-02）
- `zz-review-probe-r6-custom.test.ts`（R6-03 / R6-04）
- `zz-review-probe-r6-assist-payload.test.ts`、`zz-review-probe-r6-assist-compile.test.ts`（R6-05）
- `zz-review-probe-r6-preflight.test.ts`（R6-10）
