# 第三轮复审（DeepSeek 填表专项，2026-11-10）核查台账

> agent 间传阅（保留 文件:行号）。原始报告：`D01.md`–`D06.md`（分组）、`D07-cross.md`（跨组线索专项）、`verify-D01.md`–`verify-D07.md`（DeepSeek 冷启动子代理逐组复核）、`summary.md`（DeepSeek 协调者总表）、`prompt.md`（下发的提示词）。
> 基线 `02f7d5dc`。重点场景：填表途中删最新楼层（A）、删除当前聊天（B）、不关闭聊天直接新开聊天（C）。
> DeepSeek 原报 40 条（P0×3 / P1×11 / P2×16 / P3×10）；复核后成立 24、降级成立 3、不成立 3、需真机 10；按根因合并后总表 26 条，需真机 7 组。下表是 Claude 逐条核查后的结论与处理。
> 修复分六批：`b6d947fb`（P0/P1 主体）、`973d0ad3`（P2）、`8e53d8f3`（P3）、`48e80eb2`（切聊天过渡期身份）、`df73cd31`（对照 TT 源码核实后的需真机项）、第六批（删除当前聊天被写回的补删、D02-07 跟随上游、本台账）。
> 「需真机」项不做真机测试，改读 TauriTavern 2.4.0 源码定案（`src/script.js`、`src/scripts/group-chats.js`、`src-tauri` 后端）。

## P0 / P1（7 条）——全部属实，已修（`b6d947fb`）

| 编号 | 核查 | 修法 | 回归用例 |
|---|---|---|---|
| D03-01 手动重填零提交回滚按当前聊天执行 | 属实（P0） | 回滚句柄记住清理时的聊天；清理、零提交回滚、最终提交都带着发起时的 chatKey 进写事务，切走后事务拒绝并提示回原聊天重填；复原按消息对象而非下标 | chat-service.test「句柄记住清理时的聊天…」；update-orchestrator.test「手动重填开始时记下聊天…」「重填途中切了聊天、回滚被事务拒绝…」 |
| D01-01 保留层清理在边界 checkpoint 存盘期间不复核 | 属实（复核者提示可算 P0，按 P0 防护修） | 存盘 / 回放等待后复核聊天与楼层身份，变了就放弃后续写入；失败回滚按消息对象复原，不再删掉刚写的边界 checkpoint | chat-service.test「边界 checkpoint 存盘期间切到别的聊天…」「…删掉了一楼…」「写边界 checkpoint 前的回放期间切到别的聊天…」「写完边界 checkpoint 后折叠向量镜像期间切到别的聊天…」 |
| D02-01 自动填表计划没有 run 级聊天身份 | 属实（降级 P1；触发面按协调者存疑 3 覆盖切到任何聊天） | 一轮开始时按消息对象记下楼层锚点（`fillRunTargetsStillInPlace_ACU`），之后剩余批次 / 分段楼号对不上就不发请求、不写 | state-manager.test「一轮填表开始时记下楼层…」；update-orchestrator.test「本轮开始后聊天被改动…」×2 |
| D05-04 存盘合并推迟删楼守卫保管库捕获 | 属实（26e453e6 回归） | 窗口内暂缓存盘、只记下改动时也通知监听，删楼守卫按内存里的最新数据更新保管库 | chat-save-coalescer.test「窗口内暂缓存盘、只记下改动时也通知监听…」 |
| D05-05 提交作用域守卫对不传 chatKey 的调用方恒通过 | 属实（G04-01 修复不完整） | 提交开始时固化作用域（`resolveCommitScope_ACU`），中途切聊天即 precondition 拒绝；写事务 `guardChatSwitch` 对显式 chatKey 同样生效 | table-update-commit.test「调用方没传聊天身份…」；table-write-transaction.test「guardChatSwitch：调用方带着发起时的聊天身份…」 |
| D06-01 重填收尾的向量剩余行发布不带来源聊天 | 属实 | 快照带 chatKey，只发布到拍快照的那个聊天 | summary-vector-mirror-revision-race.integration.test「行删发布：拍完快照后切到了别的聊天…」 |
| D07-01 SQL 模式取第一个 `<tableEdit>` | 属实（92c558d2 回归） | 按「仅识别最后一对」设置取块 | update-orchestrator.test「回复里有多对 <tableEdit>…取最后一对…」「关掉「仅识别最后一对」时取第一对」 |

## P2（10 条）——全部属实，已修

| 编号 | 核查 | 修法 | 回归用例 | 批次 |
|---|---|---|---|---|
| D01-02 旧 CHAT_CHANGED 处理器晚排程取消新聊天重建链 | 属实 | 处理器序号：上一聊天的处理晚回来时不再排程 | init.test「上一聊天的切换处理卡在加载预设…」 | b6d947fb |
| D01-04 配对歧义 60s 隔离不随切聊天复位 | 属实 | 切聊天时清掉 | injection-engine-state.test「切聊天时一并清掉上一聊天留下的「生成结束配对歧义」隔离期…」 | b6d947fb |
| D02-03 删楼后未开始的后续组 / 批不校验下标 | 属实 | 与 D02-01 同一楼层锚点 | 同 D02-01 | b6d947fb |
| D03-04 重填最后 chunk 后的读消息窗口切聊天 | 属实 | 最终提交带发起时的 chatKey（与 D03-01 同修） | update-orchestrator.test「手动重填开始时记下聊天…」 | b6d947fb |
| D07-03 重填清理 / 失败恢复按下标写 live chat | 属实 | 按消息对象复原；回放等待期间删楼放弃提交 | chat-service.test「清理存盘失败时按消息本身复原…」「建根存盘失败时按消息本身复原…」「回放校验等待期间删了前面一楼…」 | b6d947fb |
| D02-05 自动填表分组不看表级 API 预设 | 属实 | 分组键加入表级预设（`resolveTableApiPresetOverride_ACU` 与编排层共用） | update-scheduler.test「调度配置相同但表级 API 预设不同的表分开成组…」 | 973d0ad3 |
| D03-02 追平终态进度不绑定 chatKey | 属实（降级 P2） | 按开始时的聊天提交 | update-orchestrator.test「追平收尾前切了聊天：终态进度不写进新聊天」 | 973d0ad3 |
| D04-01 AI 的 SQL 可改写 row_id | 属实 | `assertUpdateDoesNotAssignRowId_ACU` 拒绝 UPDATE 改 row_id | sql-table-service.test「拒绝 UPDATE 改写 row_id…」 | 973d0ad3 |
| D04-02 提示词准备窗口切聊天不中止旧轮 | 属实 | CHAT_CHANGED 时按目标守卫当场中止目标已失效的在途请求 | init.test「切聊天时同样中止目标楼层已失效的在途填表请求…」 | 973d0ad3 |
| D05-06 / D06-02 提交存盘期间切聊天写回新聊天运行时 | 属实（降级 P2；协调者存疑 2，不论级别一并修） | 结果照常落进原聊天，但不写回运行时、不报成功，上层不再拿旧表刷新新聊天的表格与世界书 | table-update-commit.test「存盘期间切了聊天…」 | 973d0ad3 |

## P3（9 条）——全部属实，已处理（`8e53d8f3`，D02-07 第六批定案）

| 编号 | 核查 | 处理 | 回归用例 |
|---|---|---|---|
| D02-07 「上下文层数」与提示词窗口脱钩 | 属实 | **用户决定跟随上游**：上游 AlbusKen/shujuku `main` 同样只把它当参与门槛（`threshold > 0`）、不接进提示词、也不删界面，停用单表用「更新频率 = 0」。第三批曾把说明改成「0 = 不参与自动填表」——**这句是错的**：0 与 -1 一样回落全局层数（`autoUpdateThreshold \|\| 3`），恒大于 0。第六批改回「-1 跟随全局。」，调度器该段恢复与上游逐字一致 | — |
| D03-05 「已回滚清理」重复拼接 | 属实 | 只由编排层拼一次 | useManualUpdate.test、form-fill-page.test（夹具改为与服务层同形，断言只出现一次） |
| D03-06 `establishProvisionalBridge_ACU` 无生产调用 | 属实 | 注释如实标注 | — |
| D03-07 存盘合并对一键追平不生效 | 属实 | 注释与测试名如实描述 | update-orchestrator.test「手动追平期间开存盘合并窗口…」 |
| D04-03 原生工具空 sql 吞掉正文修改 | 属实 | 工具调用全是空 sql、正文有块时按正文走 | table-fill-tools.test「工具调用全是空 sql、正文却写了 <tableEdit>…」 |
| D04-04 `isImportMode` 死参数 | 属实 | 删除 | typecheck |
| D05-07 回放在途去重 key 只用数组身份 | 属实 | key 加入首尾楼层身份与长度 | storage-frame-v2-replay.test「阶段 G2：同一个数组被原地换成另一个聊天的内容…」 |
| D05-08 runtime-only 待落盘登记不随切聊天清理 | 属实 | 切聊天时清掉 | injection-engine-state.test「切聊天时清掉只写进运行时、还没落盘的外部写入登记…」 |
| D07-05 旧版确认框承诺「失败或终止都会回滚」 | 属实 | 文案与新版对齐：只有一个批次都没提交时才回滚 | 纯文案 |

## 需真机（7 组）——改读 TT 2.4.0 源码定案

### 1. 删除当前聊天后被我方存盘写回（D01-03 / D02-02 / D03-03 / D05-01）——残余窗口属实，第六批补删

- TT 删除打开中的角色聊天（`deleteCharacterChat`）：`prepareCurrentChatFileChange`（取消防抖存盘、排空存盘队列；生成中直接拒绝删除）→ `/api/chats/delete` → `replaceCurrentChat`（`getPersistedCharacterChats` → `clearChat` → `character.chat = nextName` → `getChat` 内发 CHAT_CHANGED）→ CHAT_DELETED。
- 报告担心的「先收删除、后收切换」在 TT 不会出现；CHAT_CHANGED 一到即中止在途填表（`abortOnChatMutation_ACU` + D04-02）。
- 残余窗口：排空之后、`character.chat` 改名之前（删除请求、读列表、`clearChat` 里的 `saveItemizedPrompts`），我方存盘进宿主队列时，宿主按仍指向被删聊天的文件名写盘（文件名与 `chat.slice()` 在队列任务执行时才读）。Rust 后端文件不存在时完整性校验为 None 视为通过、直接新建，删除不留墓碑 → 被删聊天带内容复活；写回早于读列表时，宿主还会把它当接替聊天重新打开。不丢数据，窗口窄。
- 处理：`service/chat/deleted-chat-resurrection-guard.ts`。CHAT_CHANGED 时同步记下刚关掉的角色聊天（头像 + 文件名）；30s 内同名 CHAT_DELETED 才认领（一次切换只认领紧随其后的一次删除，删别处同名聊天不会误认）；2s 后读该角色聊天列表核对：在且没被打开 → 按宿主删除接口补删（`deleteCharacterChatFile_ACU`，只删文件、不发事件）；被宿主重新打开或补删失败 → 提示用户再删一次（不在宿主脚下删打开中的聊天）；列表读不全 → 不删。
- 群聊不处理：`deleteGroupChat` 从内存 `group.chats` 挑接替聊天，写回的群聊文件不会出现在群聊列表里，只剩不可见残留。
- 回归用例：deleted-chat-resurrection-guard.test（7 例）、init.test「删除当前聊天后被存盘写回的补删接线」（3 例）、chat-gateway.test「fetchCharacterChatNames_ACU / deleteCharacterChatFile_ACU」（2 例）。

### 2. D05-02「旧 id + 空数组」窗口把文件重建为空聊天——TT 下不成立

`clearChat` 在末尾才 `chat.length = 0`，`replaceCurrentChat` 在 await 恢复后同步改 `character.chat`；窗口只有一次微任务恢复，插件代码插不进去。

### 3. D05-03 宿主读不到聊天 id 时补存覆盖别的聊天——TT 下不成立

TT 的 `getCurrentChatId` 返回 `characters[this_chid]?.chat`，`this_chid` 未定时为 undefined，不会返回空串。第四批「空串不算有效值、继续往下取」的加固无害，保留。

### 4. D02-04 旧楼 messageId 登记到新聊天——已修（`48e80eb2`）

代码侧改为按填表开始时的聊天登记，不依赖宿主时序。回归：auto-fill-echo-guard.test「填表收尾时已切到别的聊天…」。

### 5. D06-03 删除后向量文件未清——一半不成立、一半属实已修（`df73cd31`）

「目标是当前聊天被跳过」在 TT 不成立（CHAT_CHANGED 先于 CHAT_DELETED，5s 后清理时当前聊天早已切走）。「10 分钟保护期内的文件滞留到下次启动」与宿主无关、属实：保护期 + 60s 后再清一次（清理本身每次重新核对存活聊天）。回归：init.test「删除 5s 后清理一次；保护期过后再补一次」。另：写回复活的聊天会让 5s 那次清理把它判为存活而跳过，第六批补删后由这次补清收掉。

### 6. D06-04 跨角色同名聊天切换写错世界书——实际不可达，不改

需要用户手动把两个角色的聊天改成同一个名字；默认名是「角色名 - 精确到毫秒的时间」。

### 7. D07-02 手动 / 追平持「正在填表」时新回复的自动填表被跳过——属实，已修（`df73cd31`）

被 `update_in_flight` 拦下时登记一次，订阅「一轮结束」后补跑；期间换了聊天或点过终止则作废。回归：settings-ui-trigger.test「手动填表 / 追平占着「正在填表」时被拦下…」。

### 附：读 TT 源码时顺带排查

- 存盘合并在切聊天时刷新、撞上 TT 完整性校验弹窗（不输入 OVERWRITE 就重载页面）：需要浅加载角色才可能触发，实际不可达，不加代码。

## 复核判为不成立（3 条）——同意

| 编号 | 结论 |
|---|---|
| D02-06 | 第二轮 G03 已按「纯提示措辞、不改数据」评估过同一条链，属重报 |
| D06-05 | 回调数据始终是通知时刻的当前运行时快照，不会把旧轮结果推出去（唯一路径是 D05-06，已修） |
| D07-04 | 同一 staging run 内后续 bucket 失败已 break 且 fail-fast；跨 chunk 的残余另见协调者存疑 4 |

## 协调者存疑（4 条）

| 编号 | 处理 |
|---|---|
| 1. D01-01 级别 | 按 P0 防护修（`b6d947fb`） |
| 2. D05-06 / D06-02 级别 | 不论级别一并修（`973d0ad3`） |
| 3. D02-01 触发面 | 修法按消息对象锚点，覆盖切到任何聊天，不只新开聊天 |
| 4. D07-04 跨 staging chunk 共用中止信号 | 属实：调度层前一段失败后会接着跑下一段，共用信号让后续段一进门就判已中止。改为每段一个中止信号（`df73cd31`）；终止 / 切聊天另有全局停止与楼层锚点拦截。回归：settings-ui-trigger.test「跨根分段每段各用一个中止信号…」 |

## 设计层面的疑虑（8 条）——状态

| 编号 | 状态 |
|---|---|
| 1. 聊天身份只有文件名一层 | 未改架构；可达路径逐条修，跨角色同名（D06-04）实际不可达 |
| 2. 「正在填表」是全局单布尔 | 未改；被它拦下的自动填表已能补跑（D07-02） |
| 3. 破坏性清理的回滚句柄只在内存 | 未改；句柄已带 chatKey（D03-01），应用被杀的情形未处理 |
| 4. 存盘合并用宿主聊天 id 作归属 | 第四批：空串不算有效值，继续取 chatId / this_chid（D05-03） |
| 5. strict save 不校验聊天归属 | 未在网关层加；调用方复核（D06-01、D05-06 已修） |
| 6. 填表请求没有传输超时 | 未处理，不在本轮范围 |
| 7. 「上下文层数」语义与界面脱节 | 跟随上游，见 D02-07 |
| 8. 删楼守卫注释前提被存盘合并破坏 | D05-04 已修 |
