/**
 * 执行边界提示词（开发者选项「执行边界提示词」）
 *
 * 背景：MiniMax M3.1 Flash 这类主观能动性过强的模型，越界集中在规则留了解释空间的地方——
 * 楼层里没发生什么也要改写几条记录、用户只要求改一处仍按默认规则把整轮表都更新一遍。
 * 开启后，勾选了的功能发出的 AI 请求都附加这段固定约束。默认关闭；关闭时请求逐字不变。
 * 文本与压测数据见 docs/SCOPE-GUARD-PROMPT.md（第三版：第 4 条专压「没新信息也要写」，第 6 条只在指令没要求时禁止续写）。
 *
 * 位置：插在开头连续的 system 段之后、作为一条独立 system。开头是固定前缀，不破坏提示词缓存，
 * 也能被 Claude / Gemini 协议收进系统提示字段；压测里效果不差于放末尾，且不用绕开结尾预填充。
 *
 * 按功能勾选：靠各调用点组包时传的 x-opencode-session 命名空间区分功能（全库每条 AI 调用都带）。
 * 未勾选的功能、没有命名空间的请求（API 连接测试）不附加。
 * 默认只勾填表：压测只在填表上验证过效果；智能续写、外部脚本本身要写正文，用户自行决定是否勾选。
 */
import { readScopeGuardPromptEnabled, readScopeGuardTargets } from '../../shared/v2-ui-state';

/** 「附加到」勾选项，顺序即界面顺序。 */
export const SCOPE_GUARD_TARGET_KEYS_ACU = ['fill', 'plot', 'continuation', 'agent', 'optimize', 'template', 'summary', 'worldbook'] as const;
export type ScopeGuardTarget_ACU = typeof SCOPE_GUARD_TARGET_KEYS_ACU[number];

/** 没保存过（或保存值不是布尔）的勾选项按此默认。 */
export const SCOPE_GUARD_DEFAULT_TARGETS_ACU: Readonly<Record<ScopeGuardTarget_ACU, boolean>> = Object.freeze(
  Object.fromEntries(SCOPE_GUARD_TARGET_KEYS_ACU.map(key => [key, key === 'fill'])) as Record<ScopeGuardTarget_ACU, boolean>,
);

const NAMESPACE_TARGETS_ACU: Record<string, ScopeGuardTarget_ACU> = {
  'table-fill': 'fill',
  plot: 'plot',
  'agent-decision': 'agent',
  'agent-skillify': 'agent',
  'content-replace': 'optimize',
  'template-assistant': 'template',
  summary: 'summary',
  'worldbook-ai': 'worldbook',
};

/** 组包命名空间 → 勾选项；续写的命名空间按会话动态生成，统一以 cont- 开头。认不出的返回 null。 */
export function resolveScopeGuardTarget_ACU(namespace: unknown): ScopeGuardTarget_ACU | null {
  const value = typeof namespace === 'string' ? namespace : '';
  if (value.startsWith('cont-')) return 'continuation';
  return Object.prototype.hasOwnProperty.call(NAMESPACE_TARGETS_ACU, value) ? NAMESPACE_TARGETS_ACU[value] : null;
}

export const SCOPE_GUARD_PROMPT_ACU = `【执行边界】
你正在执行一项由程序自动调用的后台任务，输出会被程序直接解析。完成任务时，额外遵守以下边界：
1. 只做指令明确要求的事。指令没有要求的步骤、内容、改动一律不做，不主动"顺便"多做。
2. 只依据本次提供的资料。资料里没有写明的事实、数值、人物、事件，不补全、不推测、不编造。
3. 指令限定了范围（只改某张表、某个字段、某几处、某类内容）时，只在范围内操作，范围外的内容保持原样。
4. 资料没有带来新的事实时，不改动已有内容：不为了"有所作为"去改写、扩写或换个说法重写原有记录。一笔带过、没有后续影响的小动作（擦拭、整理、看一眼、想起某事），以及只被提到或回忆、本身没有新经历的人和物，都不算发生了变化。
5. 拿不准某项操作是否必要、是否在要求范围内时，不做这项操作。
6. 严格按指令规定的输出格式输出：格式之外不加说明、建议、总结、追问；指令没有要求时，不续写剧情、不替任何角色发言或行动。`;

// 启动即读持久化值：不打开面板、刷新页面后的自动填表也要遵守开关。之后由开发者选项 store 推送变化。
let scopeGuardPromptEnabled_ACU = readScopeGuardPromptEnabled();

export function setScopeGuardPromptEnabled_ACU(enabled: boolean): void {
  scopeGuardPromptEnabled_ACU = enabled === true;
}

export function isScopeGuardPromptEnabled_ACU(): boolean {
  return scopeGuardPromptEnabled_ACU;
}

// 只记用户显式选过的项，其余按 SCOPE_GUARD_DEFAULT_TARGETS_ACU。
let scopeGuardTargets_ACU: Record<string, unknown> = readScopeGuardTargets();

/** 合并更新勾选项（只认布尔值）。 */
export function setScopeGuardTargets_ACU(targets: Partial<Record<ScopeGuardTarget_ACU, boolean>>): void {
  const next = { ...scopeGuardTargets_ACU };
  for (const key of SCOPE_GUARD_TARGET_KEYS_ACU) {
    if (typeof targets[key] === 'boolean') next[key] = targets[key] as boolean;
  }
  scopeGuardTargets_ACU = next;
}

export function isScopeGuardTargetEnabled_ACU(target: ScopeGuardTarget_ACU): boolean {
  const value = scopeGuardTargets_ACU[target];
  return typeof value === 'boolean' ? value : SCOPE_GUARD_DEFAULT_TARGETS_ACU[target] === true;
}

/**
 * 总开关打开、且命名空间对应的功能被勾选时，返回插入了执行边界提示词的新数组；
 * 否则原样返回同一个数组。
 */
export function withScopeGuardPrompt_ACU<T>(messages: T[], namespace?: unknown): T[] {
  if (!scopeGuardPromptEnabled_ACU) return messages;
  const target = resolveScopeGuardTarget_ACU(namespace);
  if (!target || !isScopeGuardTargetEnabled_ACU(target)) return messages;
  let insertAt = 0;
  while (insertAt < messages.length && String((messages[insertAt] as any)?.role ?? '').toLowerCase() === 'system') insertAt += 1;
  return [...messages.slice(0, insertAt), { role: 'system', content: SCOPE_GUARD_PROMPT_ACU } as T, ...messages.slice(insertAt)];
}
