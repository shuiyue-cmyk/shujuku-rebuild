/**
 * shared/ai-floor.ts — 聊天消息判定的唯一出处（三个口径，勿在各业务文件另立标准）
 *
 * 背景（TT 2.3.0）：宿主为 SillyTavern 旧工具调用结果引入了一等角色 `{role: 'tool'}`，
 * 其形态为 `{ role: 'tool', is_system: true, is_user: false, send_date, mes, tool_call_id, error }`
 * 且**没有 `extra`**，经 `chat.push` 持久进聊天、并被宿主 prompt 白名单放行。
 * 本库此前一律用 `!is_user` 判「AI 楼」，于是隐藏楼与工具楼都被算成 AI 楼 ⇒ 楼层序号与计数整体漂移。
 *
 * 两个位必须分清（宿主 v2.3.0 实测）：
 * - `role === 'tool'` 是**类型位**，是工具结果的角色事实（TT 文档：历史重放只以 role 为角色事实）。
 * - `is_system` 是**隐藏位**，可被用户 `/hide`、`/unhide` 改写（chats.js 的 hideChatMessageRange），
 *   且本义就是「隐藏消息」，宿主自身的「真实 AI 消息」判据亦为 `!is_user && !is_system`
 *   （macros.js、message-generation-info.js、script.js 的 overswipe 判定等）。
 * 因此判「AI 楼」要**两个位都看**：只判 is_system 会漏掉被 /unhide 过的工具楼，只判 role 会漏掉隐藏楼。
 *
 * 三个口径：
 * - 宽档 `isAiFloor_ACU`：非 user、非 system、非 role:'tool'。**含 narrator 旁白**。
 *   用途＝「按楼层取序号/计数/身份」：配对签名、自动填表触发身份、删除楼层范围、帧写入目标楼。
 * - 窄档 `isAiModelOutputFloor_ACU`：宽档再排除 narrator 旁白。
 *   用途＝「本轮是否新增了模型正文输出」的计数。narrator 分流是既存设计，两档均被测试锁定，勿合并。
 * - 数据承载档 `isDataBearingMessage_ACU`：**任意非 user 消息**（含隐藏楼、工具楼、narrator）。
 *   用途＝「哪些消息可能挂着本库的表数据」：全仓清理/purge、导入前快照、迁移与零根检测的扫描。
 *   ⚠️ **数据承载 ≠ AI 楼**：被用户隐藏的 AI 楼仍然可能带表数据，清理与快照必须覆盖它；
 *   把这些路径收窄成 AI 楼会把数据留在原地（清理漏做）或让预校验与实际执行分叉。
 */

/** 判断一个聊天消息是否为「AI 楼」（宽档：含 narrator 旁白，排除隐藏楼与工具楼）。 */
export function isAiFloor_ACU(message: any): boolean {
    if (!message || typeof message !== 'object') return false;
    if (message.is_user) return false;
    if (message.is_system) return false;
    // 类型位：TT 2.3.0 的一等工具楼。is_system 可被 /unhide 清掉，故此判据不可省。
    if (message.role === 'tool') return false;
    return true;
}

/** 统计 AI 楼总数（宽档）。 */
export function countAiFloors_ACU(chat: any): number {
    return Array.isArray(chat) ? chat.filter(isAiFloor_ACU).length : 0;
}

/** 判断一个聊天消息是否为「模型产出的 AI 楼」（窄档：宽档再排除 narrator 旁白）。 */
export function isAiModelOutputFloor_ACU(message: any): boolean {
    if (!isAiFloor_ACU(message)) return false;
    return message.extra?.type !== 'narrator';
}

/** 统计模型产出的 AI 楼总数（窄档）。 */
export function countAiModelOutputFloors_ACU(chat: any): number {
    return Array.isArray(chat) ? chat.filter(isAiModelOutputFloor_ACU).length : 0;
}

/**
 * 判断一个聊天消息是否可能承载本库的表数据（数据承载档：任意非 user 消息）。
 * 用于清理/purge、快照、迁移与零根检测这类「宁可多扫不可漏扫」的路径。
 */
export function isDataBearingMessage_ACU(message: any): boolean {
    return !!message && typeof message === 'object' && !message.is_user;
}
