/**
 * 执行边界提示词（开发者选项「执行边界提示词」）
 *
 * 背景：MiniMax M3.1 Flash 这类主观能动性过强的模型，越界集中在规则留了解释空间的地方——
 * 楼层里没发生什么也要改写几条记录、用户只要求改一处仍按默认规则把整轮表都更新一遍。
 * 开启后，数据库发出的每一次 AI 请求都附加这段固定约束。默认关闭；关闭时请求逐字不变。
 * 文本与压测数据见 docs/SCOPE-GUARD-PROMPT.md（第二版，第 4 条专压「没新信息也要写」）。
 *
 * 位置：插在开头连续的 system 段之后、作为一条独立 system。开头是固定前缀，不破坏提示词缓存，
 * 也能被 Claude / Gemini 协议收进系统提示字段；压测里效果不差于放末尾，且不用绕开结尾预填充。
 */
import { readScopeGuardPromptEnabled } from '../../shared/v2-ui-state';

export const SCOPE_GUARD_PROMPT_ACU = `【执行边界】
你正在执行一项由程序自动调用的后台任务，输出会被程序直接解析。完成任务时，额外遵守以下边界：
1. 只做指令明确要求的事。指令没有要求的步骤、内容、改动一律不做，不主动"顺便"多做。
2. 只依据本次提供的资料。资料里没有写明的事实、数值、人物、事件，不补全、不推测、不编造。
3. 指令限定了范围（只改某张表、某个字段、某几处、某类内容）时，只在范围内操作，范围外的内容保持原样。
4. 资料没有带来新的事实时，不改动已有内容：不为了"有所作为"去改写、扩写或换个说法重写原有记录。一笔带过、没有后续影响的小动作（擦拭、整理、看一眼、想起某事），以及只被提到或回忆、本身没有新经历的人和物，都不算发生了变化。
5. 拿不准某项操作是否必要、是否在要求范围内时，不做这项操作。
6. 严格按指令规定的输出格式输出：格式之外不加说明、建议、总结、追问，也不续写剧情、不替任何角色发言或行动。`;

// 启动即读持久化值：不打开面板、刷新页面后的自动填表也要遵守开关。之后由开发者选项 store 推送变化。
let scopeGuardPromptEnabled_ACU = readScopeGuardPromptEnabled();

export function setScopeGuardPromptEnabled_ACU(enabled: boolean): void {
  scopeGuardPromptEnabled_ACU = enabled === true;
}

export function isScopeGuardPromptEnabled_ACU(): boolean {
  return scopeGuardPromptEnabled_ACU;
}

/** 开关打开时返回插入了执行边界提示词的新数组；关闭时原样返回同一个数组。 */
export function withScopeGuardPrompt_ACU<T>(messages: T[]): T[] {
  if (!scopeGuardPromptEnabled_ACU) return messages;
  let insertAt = 0;
  while (insertAt < messages.length && String((messages[insertAt] as any)?.role ?? '').toLowerCase() === 'system') insertAt += 1;
  return [...messages.slice(0, insertAt), { role: 'system', content: SCOPE_GUARD_PROMPT_ACU } as T, ...messages.slice(insertAt)];
}
