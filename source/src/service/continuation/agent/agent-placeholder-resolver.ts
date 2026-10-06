/**
 * service/continuation/agent/agent-placeholder-resolver.ts — 读写集占位符解析
 *
 * 读集 token 只是资料接口标识符，不是提示词 token：解析结果统一汇成一块材料文本，
 * 通过单个 `$AGENT_READ_MATERIALS` 注入子代理提示词。这样动态表名（$TABLE:xxx）
 * 不需要扩展提示词渲染器的固定 token 表。
 */

import type { StageTurn_ACU, StageTurnPacing_ACU } from '../model';
import { describeStageTempo_ACU } from '../outline-schema';
import type { ContinuationAgentExecutionContext_ACU } from '../stage-execution-engine';
import {
  AGENT_MODULE_FIELD_MATRIX_ACU,
  AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU,
  AGENT_STORY_WINDOW_DEFAULT_ACU,
  type AgentModuleSnapshot_ACU,
} from './agent-model';
import {
  readAgentModuleFoldState_ACU,
  renderAgentChronology_ACU,
  renderAgentChronologyByIds_ACU,
  renderAgentConstraintsByIds_ACU,
  renderAgentHooksByIds_ACU,
  renderAgentInfoGapByIds_ACU,
  renderAgentStoryArcByIds_ACU,
  renderAgentWebRefsByIds_ACU,
} from './agent-module-store';
import { AGENT_TABLE_ALIASES_ACU, findAgentSheetsByAliases_ACU, renderAgentTableByAliases_ACU, renderAgentTableByName_ACU, type AgentTableRowRange_ACU } from './agent-tables';
import {
  buildEmptyAgentWorldbookSnapshot_ACU,
  renderAgentWorldbookEntries_ACU,
  type AgentWorldbookSnapshot_ACU,
} from './agent-worldbook-read';
import { normalizeAmCode_ACU } from '../worldbook-context';
import { applyContextTagFilters_ACU } from '../../runtime/helpers-context-tags';
import { isAiFloor_ACU } from '../../../shared/ai-floor';
import { renderAgentUserRequirements_ACU } from './agent-user-requirements';

export const AGENT_TABLE_TOKEN_PREFIX_ACU = '$TABLE:';
export const AGENT_STORY_RANGE_TOKEN_PREFIX_ACU = '$STORY_RANGE:';
export const AGENT_WORLDBOOK_TOKEN_PREFIX_ACU = '$WORLDBOOK:';

/** 每条虚拟/模块/表占位符对应的人类可读标题，进入材料块的分节标题。 */
const READ_TOKEN_TITLES_ACU: Record<string, string> = {
  $STORY_TEXT: '已经发生的小说正文（只含 AI 楼层）',
  $STORY_CATALOG: '正文楼层索引',
  $STORY_OVERVIEW: '事件概览（纪要表逐轮）',
  $STORY_TAIL: '最近正文（尾部全文楼层）',
  $HISTORY_UNSETTLED: '尚未结算的真实历史',
  $OUTLINE_WINDOW: '当前大纲窗口',
  $CURRENT_TURN_GOAL: '本轮目标',
  $CURRENT_TURN_PACING: '本轮节奏',
  $USER_INTENT: '用户的初始要求',
  $USER_REQUIREMENTS: '用户对任务曾经提过的要求',
  $STORY_ARC: '故事总纲',
  $HOOKS_LEDGER: '伏笔账本',
  $INFO_GAP: '认知与信息差时间线',
  $ACTIVE_CONSTRAINTS: '长期约束',
  $CHRONOLOGY: '故事年代学账本',
  $WEB_REFS: '百科资料库',
  $TABLE_GLOBAL: '全局数据表',
  $TABLE_CHARACTERS: '角色表',
  $TABLE_CHRONICLES: '纪要表',
};

/** 续写侧的上下文标签提取/排除规则（与剧情推进共用 applyContextTagFilters_ACU 语义）。 */
export interface AgentContextRules_ACU {
  extractRules: { start: string; end: string }[];
  excludeRules: { start: string; end: string }[];
}

export interface AgentResolveContext_ACU {
  chat: any[];
  moduleSnapshot: AgentModuleSnapshot_ACU;
  settledThroughIndex: number;
  execution: ContinuationAgentExecutionContext_ACU;
  originInstruction: string;
  /**
   * Agent 可读/可搜正文窗口：只有最近这么多 AI 楼层可以 read/search，
   * 更早的剧情脉络经事件概览与 $TABLE:纪要表 回溯。缺省用 AGENT_STORY_WINDOW_DEFAULT_ACU。
   */
  storyWindowFloors?: number;
  /** 固定注入全文的末尾 AI 楼层数（$STORY_TAIL）；缺省用 AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU。 */
  storyTailFloors?: number;
  tableData?: unknown;
  /** 运行起点预取的世界书快照；缺省为不可用空快照（如测试环境）。 */
  worldbook?: AgentWorldbookSnapshot_ACU;
  /** 上下文提取/排除规则；缺省不做任何过滤。 */
  contextRules?: AgentContextRules_ACU;
  /** 本轮召回的 AM 码（取自最后一个用户楼层）；缺省为空。 */
  recallCodes?: readonly string[];
}

/** 正文渲染的最小入参：AgentResolveContext 结构性满足，大纲侧可用轻量对象直接调用。 */
export interface AgentStoryFloorSource_ACU {
  chat: any[];
  storyWindowFloors?: number;
  storyTailFloors?: number;
  contextRules?: AgentContextRules_ACU;
}

function applyAgentContextRules_ACU(text: string, rules?: AgentContextRules_ACU): string {
  if (!rules || (!rules.extractRules.length && !rules.excludeRules.length)) return text;
  return applyContextTagFilters_ACU(text, { extractTags: '', extractRules: rules.extractRules, excludeTags: '', excludeRules: rules.excludeRules }).trim();
}

/**
 * 规则签名。上下文规则是纯数据（applyContextTagFilters 全程不改入参），
 * 序列化一次的成本相对每楼每规则的整段扫描可忽略；每次现算而不是按规则对象
 * 记忆化，是为了连「规则数组被原地改内容」这种情况也不串味。
 */
function contextRulesSignature_ACU(rules?: AgentContextRules_ACU): string {
  if (!rules || (!rules.extractRules.length && !rules.excludeRules.length)) return '';
  return JSON.stringify([rules.extractRules, rules.excludeRules]);
}

/**
 * 目录摘要有界扫描计数（仅测试打开）。生产路径只有一次布尔判断，行为与开销不受影响。
 * openingScanChars=开头摘要有界扫描实际查看过的输入码元数（朴素压平恒等于全文长度）。
 */
/**
 * 目录摘要有界扫描计数（仅测试打开）。生产路径只有一次布尔判断，行为与开销不受影响。
 * test-audit 2026-09-29 移除了其余调用计数器（textExtractions/textMemoHits/
 * floorListRebuilds/floorListHits）：它们把夹具算术写成契约，正确性由逐字等价 keeper 锁定。
 * openingScanChars 保留——它是「目录摘要扫描有界（O(1)/层，不随正文长度增长）」这一
 * 复杂度合同的最便宜独立守卫（输出等价测不出工作量）。
 */
export interface AgentPlaceholderResolverCounters_ACU {
  openingScanChars: number;
}

const resolverCounters_ACU: AgentPlaceholderResolverCounters_ACU = { openingScanChars: 0 };
let resolverCountersEnabled_ACU = false;

/** 仅供测试：打开计数并清空全部记忆化（含构造「冷路径」对照）。 */
export function __resetAgentPlaceholderResolverCachesForTests_ACU(): void {
  resolverCounters_ACU.openingScanChars = 0;
  resolverCountersEnabled_ACU = true;
  messageTextMemo_ACU = new WeakMap();
  storyFloorsMemo_ACU = new WeakMap();
}

/** 仅供测试：读取计数快照。 */
export function __readAgentPlaceholderResolverCountersForTests_ACU(): AgentPlaceholderResolverCounters_ACU {
  return { ...resolverCounters_ACU };
}

/**
 * 逐楼文本记忆化。键＝楼层对象引用 + mes 字符串引用 + 规则签名。
 *
 * 失效不变式：mes 是字符串，JavaScript 字符串不可变——重赋值（正文编辑 / swipe 切换 /
 * 重生成）必然产生新引用，引用相同即值相同；楼层被整体替换（宿主重新载入聊天）同样换引用。
 * 因此「引用相同 ⇒ 提取结果相同」成立，不需要版本号。
 * 规则签名挡在同一个键里，避免同一楼层按两套规则渲染时互相串味。
 */
interface MessageTextMemo_ACU { mes: string; rulesKey: string; text: string }
let messageTextMemo_ACU: WeakMap<object, MessageTextMemo_ACU> = new WeakMap();

function messageTextByRulesKey_ACU(message: any, rules: AgentContextRules_ACU | undefined, rulesKey: string): string {
  const raw = String(message?.mes ?? '');
  if (!message || typeof message !== 'object') return applyAgentContextRules_ACU(raw.trim(), rules);
  const memo = messageTextMemo_ACU.get(message);
  if (memo && memo.mes === raw && memo.rulesKey === rulesKey) {
    return memo.text;
  }
  const text = applyAgentContextRules_ACU(raw.trim(), rules);
  messageTextMemo_ACU.set(message, { mes: raw, rulesKey, text });
  return text;
}

function messageText_ACU(message: any, rules?: AgentContextRules_ACU): string {
  return messageTextByRulesKey_ACU(message, rules, contextRulesSignature_ACU(rules));
}

interface AgentStoryFloor_ACU {
  index: number;
  text: string;
}

/**
 * 正文楼层数组记忆化。键＝聊天数组引用 + 规则签名，值里另存一份逐楼校验指纹。
 *
 * 聊天数组本身是原地增长/删减的（chat.push / splice），单靠数组引用当键会漏掉
 * 「同一数组内容变了」——所以每次命中前先做一遍 O(楼层) 的廉价校验：逐楼比对
 * 「楼层对象引用 + mes 引用 + AI 楼判定」，全是引用比较与三个属性读取，不做任何
 * 字符串扫描。任一项不同即整条作废并重建（重建时逐楼文本仍走上面的记忆化，
 * 于是只有真正改过正文的楼层才重新跑规则）。
 * 返回的数组与其中的 {index,text} 对象只读共享：全部调用点（窗口切片 / 计数 / 区间过滤）
 * 都只读不改。
 */
interface StoryFloorsMemo_ACU {
  rulesKey: string;
  floors: AgentStoryFloor_ACU[];
  refs: unknown[];
  mesRefs: unknown[];
  aiFlags: boolean[];
}

let storyFloorsMemo_ACU: WeakMap<unknown[], StoryFloorsMemo_ACU> = new WeakMap();
const EMPTY_CHAT_ACU: any[] = [];

function isStoryFloorsMemoFresh_ACU(chat: readonly any[], memo: StoryFloorsMemo_ACU, rulesKey: string): boolean {
  if (memo.rulesKey !== rulesKey || memo.refs.length !== chat.length) return false;
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    if (memo.refs[index] !== message) return false;
    if (memo.aiFlags[index] !== isAiFloor_ACU(message) || memo.mesRefs[index] !== (message as { mes?: unknown } | null)?.mes) return false;
  }
  return true;
}

function listAgentStoryFloors_ACU(source: AgentStoryFloorSource_ACU): AgentStoryFloor_ACU[] {
  const chat = Array.isArray(source.chat) ? source.chat : EMPTY_CHAT_ACU;
  const rulesKey = contextRulesSignature_ACU(source.contextRules);
  const memo = storyFloorsMemo_ACU.get(chat);
  if (memo && isStoryFloorsMemoFresh_ACU(chat, memo, rulesKey)) {
    return memo.floors;
  }
  const floors: AgentStoryFloor_ACU[] = [];
  const refs: unknown[] = [];
  const mesRefs: unknown[] = [];
  const aiFlags: boolean[] = [];
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    // 非 AI 楼不进正文域：旧实现也提取了它们的文本，但那份文本随后被过滤丢弃，
    // 而提取规则是纯函数，提取与不提取可观察行为一致（少一次无用功）。
    const ai = isAiFloor_ACU(message);
    const text = ai ? messageTextByRulesKey_ACU(message, source.contextRules, rulesKey) : '';
    refs.push(message);
    mesRefs.push((message as { mes?: unknown } | null)?.mes);
    aiFlags.push(ai);
    if (ai && text) floors.push({ index, text });
  }
  storyFloorsMemo_ACU.set(chat, { rulesKey, floors, refs, mesRefs, aiFlags });
  return floors;
}

function agentStoryWindowSize_ACU(source: AgentStoryFloorSource_ACU): number {
  return Math.max(0, source.storyWindowFloors ?? AGENT_STORY_WINDOW_DEFAULT_ACU);
}

/** Agent 可读/可搜的正文窗口：最近 storyWindowFloors 个 AI 楼层。同时供搜索工具划定 story 域。 */
export function listAgentStoryWindowFloors_ACU(source: AgentStoryFloorSource_ACU): AgentStoryFloor_ACU[] {
  const window = agentStoryWindowSize_ACU(source);
  return window > 0 ? listAgentStoryFloors_ACU(source).slice(-window) : [];
}

/** 与正文目录共用的 AI 正文楼层判断；证据校验不受读取窗口限制。 */
export function agentStoryEvidenceFloorIndexes_ACU(chat: any[]): ReadonlySet<number> {
  return new Set(listAgentStoryFloors_ACU({ chat }).map(floor => floor.index));
}

/**
 * 从最后一个用户楼层提取本轮召回的 AM 码。
 * 剧情推进 AI 的召回结果（<recall>AMxxxx</recall> 等）就落在这层文本里，直接复用即可，
 * 不需要续写侧再发一次召回调用。取原始文本而非过滤后的文本：召回码可能位于会被规则剥掉的标签内。
 * @param chat 聊天数组
 * @returns 去重后的规范化 AM 码列表；没有用户楼层或无命中时为空数组
 */
export function extractAgentRecallCodesFromChat_ACU(chat: readonly any[]): string[] {
  const list = Array.isArray(chat) ? chat : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (!message || !message.is_user) continue;
    const matches = String(message.mes ?? '').match(/AM\d+/gi) ?? [];
    return [...new Set(matches
      .map(code => normalizeAmCode_ACU(code))
      .filter((code): code is string => code !== null))];
  }
  return [];
}

function renderStoryFloors_ACU(floors: readonly AgentStoryFloor_ACU[]): string {
  return floors.map(floor => `【楼层 ${floor.index}】\n${floor.text}`).join('\n\n');
}

/**
 * 开头摘要：等价于 `text.replace(/\s+/g,' ').trim()` 的前 40 字（超出补省略号），
 * 但只扫到第 41 个输出字符就停。
 *
 * 等价论证（逐码元对齐，无任何近似）：
 * - `replace(/\s+/g,' ')` 把每段极大空白游程替换成恰好一个空格，`trim()` 再去首尾空白；
 *   trim 的空白集合与 `\s` 完全相同（WhiteSpace ∪ LineTerminator）。
 * - 用 `/[^\s]/g` 定位下一个非空白码元，空白游程由引擎原生跳过，分段与 replace 一致；
 *   首个非空白码元之前不补空格＝等价 trim 去首，扫描结束时的待补空格不输出＝等价 trim 去尾。
 * - 输出长度首次超过 40 即等价「压平后长度 > 40」；扫描走完则压平长度 ≤ 40，原样返回不加省略号。
 * - 全程按 UTF-16 码元处理，与 replace/slice 的码元语义一致（含代理对）。
 * ⚠️ 任何固定前缀窗口（如先 slice(0,128) 再压平）都**不**等价：单个超长空白游程能把
 * 第 40 个输出字符推到任意靠后的位置，因此只能按「已产出字符数」提前退出。
 * 扫描器是模块级单例（每次调用入口重置 lastIndex）；本函数无回调、不可重入。
 */
const NON_WHITESPACE_ACU = /[^\s]/g;

function storyOpening_ACU(text: string): string {
  NON_WHITESPACE_ACU.lastIndex = 0;
  let opening = '';
  let cursor = 0;
  let scanned = 0;
  let matched = NON_WHITESPACE_ACU.exec(text);
  while (matched) {
    const at = matched.index;
    if (at + 1 > scanned) scanned = at + 1;
    if (at > cursor && opening) opening += ' ';
    cursor = at + 1;
    opening += text[at];
    if (opening.length > 40) {
      if (resolverCountersEnabled_ACU) resolverCounters_ACU.openingScanChars += scanned;
      return `${opening.slice(0, 40)}…`;
    }
    matched = NON_WHITESPACE_ACU.exec(text);
  }
  if (resolverCountersEnabled_ACU) resolverCounters_ACU.openingScanChars += text.length;
  return opening;
}

/** 事件概览的最小入参。 */
export interface AgentStoryOverviewSource_ACU {
  tableData?: unknown;
  recallCodes?: readonly string[];
}

/** 定位纪要表的一列：按表头包含关系匹配候选名，命中第一个。 */
function findColumnIndex_ACU(header: readonly string[], candidates: readonly string[]): number {
  for (const candidate of candidates) {
    const index = header.findIndex(cell => cell.includes(candidate));
    if (index >= 0) return index;
  }
  return -1;
}

/** 事件概览的渲染选项。 */
export interface AgentStoryOverviewOptions_ACU {
  /**
   * 只保留最新的 N 行概览（按纪要表行序取尾部）。窗口外被本轮召回码命中的行不受截断
   * 影响——它们以纪要全文按行序前置展示，保证召回机制在截断下仍然完整。
   * 缺省为不限（主会话/大纲子代理/read 工具路径全量注入）。
   */
  maxRows?: number;
}

/**
 * 渲染事件概览：纪要表逐轮的「概览」列注入，命中本轮召回 AM 码的行升级为「纪要」全文。
 *
 * 这是主会话与策划类子代理掌握全局剧情脉络的固定来源——概览按剧情轮记录（每轮一行），
 * 与楼层号没有一一映射，精确正文要走 $STORY_RANGE 或楼层索引。
 * @param source 表格数据与本轮召回码
 * @param options 渲染选项；maxRows 见 AgentStoryOverviewOptions_ACU
 * @returns 概览文本；纪要表缺失/为空时如实说明
 */
export function renderAgentStoryOverview_ACU(source: AgentStoryOverviewSource_ACU, options?: AgentStoryOverviewOptions_ACU): string {
  const sheets = findAgentSheetsByAliases_ACU(AGENT_TABLE_ALIASES_ACU.chronicles, source.tableData);
  if (!sheets.length) {
    return '当前聊天没有纪要表，无法提供事件概览。剧情脉络只能依靠楼层索引与正文楼层本身。';
  }
  const recall = new Set((source.recallCodes ?? []).map(code => normalizeAmCode_ACU(code)).filter(Boolean));
  const maxRows = options?.maxRows && options.maxRows > 0 ? Math.floor(options.maxRows) : null;
  let anyExpanded = false;
  const sections = sheets.map(sheet => {
    if (!sheet.rows.length) return `表「${sheet.name}」存在但没有数据行。`;
    const codeColumn = findColumnIndex_ACU(sheet.header, ['编码索引', '编码']);
    const overviewColumn = findColumnIndex_ACU(sheet.header, ['概览', '概要']);
    const digestColumn = sheet.header.findIndex(cell => cell.includes('纪要') && !cell.includes('概'));
    const renderRow = (row: readonly string[], rowIndex: number): string => {
      const code = codeColumn >= 0 ? normalizeAmCode_ACU(row[codeColumn]) : null;
      const overview = overviewColumn >= 0 ? row[overviewColumn] : '';
      const digest = digestColumn >= 0 ? row[digestColumn] : '';
      const label = code ?? `第 ${rowIndex + 1} 行`;
      if (code && recall.has(code) && digest) {
        anyExpanded = true;
        return `- ${label}｜【纪要全文】${digest}`;
      }
      return `- ${label}｜${overview || digest || '（空行）'}`;
    };
    const windowStart = maxRows !== null ? Math.max(0, sheet.rows.length - maxRows) : 0;
    const windowLines = sheet.rows.slice(windowStart).map((row, offset) => renderRow(row, windowStart + offset));
    const parts: string[] = [];
    if (windowStart > 0) {
      parts.push(`更早的 ${windowStart} 轮概览已省略（对应「${sheet.name}」第 1-${windowStart} 行），需要时用 $TABLE:${sheet.name}:行区间 精读。`);
      // 窗口外被召回命中的行按行序前置：召回命中说明与本轮直接相关，不能被截断静默丢掉。
      const recalledEarlier = sheet.rows.slice(0, windowStart)
        .map((row, rowIndex) => ({ row, rowIndex }))
        .filter(({ row }) => {
          const code = codeColumn >= 0 ? normalizeAmCode_ACU(row[codeColumn]) : null;
          return code !== null && recall.has(code);
        });
      if (recalledEarlier.length) {
        parts.push(`以下为本轮召回命中的更早轮次（不受截断影响）：\n${recalledEarlier.map(({ row, rowIndex }) => renderRow(row, rowIndex)).join('\n')}`);
      }
    }
    parts.push(windowLines.join('\n'));
    const head = sheets.length > 1 ? `## 表「${sheet.name}」\n` : '';
    return `${head}${parts.join('\n\n')}`;
  });
  const expandedNote = anyExpanded
    ? '带【纪要全文】标记的行已按本轮召回码展开为详细纪要。'
    : '';
  return [
    '以下是纪要表的逐轮事件概览（每行对应一轮剧情，与楼层号无一一映射；需要某轮的详细纪要时用 $TABLE:纪要表:行区间 精读）：',
    ...sections,
    expandedNote,
  ].filter(Boolean).join('\n\n');
}

/**
 * 渲染最近正文：末尾 storyTailFloors 个 AI 楼层的全文（已过上下文提取/排除规则）。
 * 这是承接锚点——续写必须无缝衔接的最新正文。
 * @param source 正文楼层来源
 * @returns 逐楼全文；storyTailFloors=0 或无 AI 楼层时如实标注
 */
export function renderAgentStoryTail_ACU(source: AgentStoryFloorSource_ACU): string {
  const windowFloors = listAgentStoryWindowFloors_ACU(source);
  if (!windowFloors.length) return '当前没有可注入的正文楼层（聊天里还没有 AI 正文，或可读窗口为 0）。';
  const tailCount = Math.max(0, source.storyTailFloors ?? AGENT_STORY_TAIL_FLOORS_DEFAULT_ACU);
  if (tailCount === 0) return '未注入正文楼层全文（尾部楼层数设置为 0）。需要正文时用 $STORY_RANGE:起始楼-结束楼 读取。';
  const tailFloors = windowFloors.slice(-tailCount);
  return `最近 ${tailFloors.length} 楼全文（续写必须无缝衔接这里的结尾）：\n${renderStoryFloors_ACU(tailFloors)}`;
}

/**
 * 渲染正文楼层索引：纯索引，不含任何正文全文（全文见 $STORY_TAIL，脉络见 $STORY_OVERVIEW）。
 * 每楼一行「楼层号 + 约字数 + 读取地址」；纪要表缺失时退回附带开头摘要的形式以保底可导航。
 * @param source 正文楼层来源 + 表格数据（用于判断纪要表是否存在）
 * @returns 索引文本，进入主 Agent 骨架的 $STORY_CATALOG
 */
export function renderAgentStoryCatalog_ACU(source: AgentStoryFloorSource_ACU & { tableData?: unknown }): string {
  const allFloors = listAgentStoryFloors_ACU(source);
  if (!allFloors.length) return '当前聊天还没有 AI 产出的正文楼层。';
  const windowFloors = listAgentStoryWindowFloors_ACU(source);
  if (!windowFloors.length) return '正文可读窗口设置为 0 楼：正文楼层不可直接读取；剧情脉络请依靠事件概览与 $TABLE:纪要表。';
  const hiddenCount = allFloors.length - windowFloors.length;
  const headNote = hiddenCount > 0
    ? `更早的 ${hiddenCount} 个 AI 楼层不在可读窗口内；其剧情脉络请查看事件概览，或用 $TABLE:纪要表:行区间 精读对应纪要。`
    : '当前全部 AI 楼层都在可读窗口内。';
  const hasChronicleRows = findAgentSheetsByAliases_ACU(AGENT_TABLE_ALIASES_ACU.chronicles, source.tableData)
    .some(sheet => sheet.rows.length > 0);
  const lines = windowFloors.map(floor => hasChronicleRows
    ? `- 楼层 ${floor.index}｜约 ${floor.text.length} 字｜读取地址 $STORY_RANGE:${floor.index}-${floor.index}`
    : `- 楼层 ${floor.index}｜约 ${floor.text.length} 字｜开头：${storyOpening_ACU(floor.text)}｜读取地址 $STORY_RANGE:${floor.index}-${floor.index}`);
  return [
    `${headNote}\n可读窗口内的楼层索引（区间读取写 $STORY_RANGE:起始楼-结束楼；按内容找楼层用 search story）：`,
    lines.join('\n'),
    '注意：事件概览按剧情轮记录，与楼层号无一一映射；需要精确正文时按本索引区间读取。',
  ].join('\n');
}

/**
 * 按楼层区间读取窗口内的 AI 正文全文，支撑 `$STORY_RANGE:a-b`。
 * @param context 解析上下文
 * @param startRaw 起始楼层号
 * @param endRaw 结束楼层号
 * @returns 区间内逐楼全文；区间非法/落在窗口外时回灌可修正的错误文本
 */
export function renderAgentStoryRange_ACU(context: AgentResolveContext_ACU, startRaw: string, endRaw: string): string {
  const start = Number.parseInt(startRaw, 10);
  const end = Number.parseInt(endRaw, 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    return `楼层区间「${startRaw}-${endRaw}」不合法：写法为 $STORY_RANGE:起始楼-结束楼（两端都是楼层号，起始不大于结束）。可用楼层见正文目录。`;
  }
  const windowFloors = listAgentStoryWindowFloors_ACU(context);
  if (!windowFloors.length) return '正文可读窗口当前为空，无法读取正文；早期剧情脉络请查看事件概览或用 $TABLE:纪要表:行区间 精读。';
  const hit = windowFloors.filter(floor => floor.index >= start && floor.index <= end);
  if (!hit.length) {
    const first = windowFloors[0].index;
    const last = windowFloors[windowFloors.length - 1].index;
    return `区间 ${start}-${end} 内没有可读的 AI 楼层。可读窗口目前覆盖楼层 ${first}-${last}（只含 AI 楼）；更早的剧情脉络请查看事件概览或用 $TABLE:纪要表:行区间 精读。`;
  }
  return renderStoryFloors_ACU(hit);
}

/**
 * 未结算正文与目录、区间读取共用最近 AI 楼层窗口。
 * 返回实际处理起点，供工作流记录完成范围；窗口外的旧正文并不代表已被资料模块吸收。
 */
export function resolveAgentUnsettledStoryWindow_ACU(context: AgentResolveContext_ACU) {
  const allFloors = listAgentStoryFloors_ACU(context);
  const window = agentStoryWindowSize_ACU(context);
  const windowFloors = window > 0 ? allFloors.slice(-window) : [];
  const completion = context.moduleSnapshot.materialCompletion;
  const completedRange = completion
    && (completion.state === 'complete_changed' || completion.state === 'complete_no_change')
    && completion.rangeStartIndex >= 0 && completion.rangeEndIndex >= completion.rangeStartIndex
    ? completion : null;
  // 用户指定的追溯起点：此前历史未结算，不再纳入本次选择。
  const boundary = context.moduleSnapshot.settlementBoundary?.startIndex ?? 0;
  const isUnsettled = (floor: AgentStoryFloor_ACU) => floor.index > context.settledThroughIndex
    && floor.index >= boundary
    && !(completedRange && floor.index >= completedRange.rangeStartIndex && floor.index <= completedRange.rangeEndIndex);
  const unsettledFloors = allFloors.filter(isUnsettled);
  const floors = windowFloors.filter(isUnsettled);
  const hiddenCount = unsettledFloors.length - floors.length;
  let startIndex = hiddenCount > 0
    ? floors[0]?.index ?? context.chat.length
    : Math.max(boundary, context.settledThroughIndex + 1);
  // 最近窗口已完成后，只处理其后新增的正文；保留连续水位与窗口完成区间的区别。
  if (floors.length && completedRange && windowFloors[0].index >= completedRange.rangeStartIndex
    && windowFloors[0].index <= completedRange.rangeEndIndex
    && floors[0].index > completedRange.rangeEndIndex) {
    startIndex = completedRange.rangeEndIndex + 1;
  }
  if (!floors.length) startIndex = Math.max(boundary, windowFloors[0]?.index ?? context.chat.length);
  return { floors, hiddenCount, startIndex };
}

function renderUnsettledWindow_ACU(selection: ReturnType<typeof resolveAgentUnsettledStoryWindow_ACU>): string {
  if (!selection.hiddenCount && !selection.floors.length) {
    return '没有尚未结算的真实历史；当前正文已完成结算。';
  }
  const note = selection.hiddenCount > 0
    ? `更早的 ${selection.hiddenCount} 个未结算 AI 楼层不在正文可读窗口内，本次未注入、也不属于本次逐楼结算范围；不能据此宣称旧正文已被完整结算。更早剧情请通过事件概览或 $TABLE:纪要表:行区间 回溯。`
    : '';
  return [note, selection.floors.length
    ? renderStoryFloors_ACU(selection.floors)
    : '当前可读窗口内没有待结算正文（窗口为 0 或窗口内正文已处理）；本次不注入或逐楼结算正文。'].filter(Boolean).join('\n\n');
}

/** 已发生正文只注入可读窗口内的 AI 楼层，已结算与未结算两段共用同一个上限。 */
export function renderAgentStoryText_ACU(context: AgentResolveContext_ACU): string {
  if (!context.chat.length) return '当前聊天还没有任何楼层，也就没有已经发生的正文。';
  const allFloors = listAgentStoryFloors_ACU(context);
  if (!allFloors.length) return '当前聊天还没有 AI 产出的正文楼层。';
  const selection = resolveAgentUnsettledStoryWindow_ACU(context);
  const pendingIndexes = new Set(selection.floors.map(floor => floor.index));
  const shownSettled = listAgentStoryWindowFloors_ACU(context).filter(floor => !pendingIndexes.has(floor.index));
  const settled = allFloors.filter(floor => floor.index <= context.settledThroughIndex);
  const hiddenSettled = settled.length - shownSettled.length;
  const sections: string[] = [];
  const settledHead = hiddenSettled > 0
    ? `## 已结算正文（窗口内 ${shownSettled.length} 楼；更早的 ${hiddenSettled} 楼未注入，需要时通过事件概览与纪要回溯）`
    : '## 已结算正文';
  if (shownSettled.length) sections.push(`${settledHead}\n${renderStoryFloors_ACU(shownSettled)}`);
  else if (settled.length) sections.push(`${settledHead}\n（本次未注入任何已结算正文。）`);
  sections.push(`## 尚未结算的最新正文（正文可读窗口内）\n${renderUnsettledWindow_ACU(selection)}`);
  return sections.join('\n\n');
}

/**
 * 渲染可读窗口内尚未结算的 AI 正文。冷启动不回灌全部旧楼层；
 * 省略范围明确说明，结算工作流用同一选择结果记录实际完成范围。
 */
export function renderAgentUnsettledHistory_ACU(context: AgentResolveContext_ACU): string {
  return renderUnsettledWindow_ACU(resolveAgentUnsettledStoryWindow_ACU(context));
}

/**
 * 世界书触发只扫描最近一个用户楼层与最近一个 AI 楼层；不拼入任务、初始要求或旧历史
 * （TT 移植上游 ce867f86-B：命中扫描收敛）。文本变短是收敛不是放宽：级联触发、
 * exclude/prevent-recursion 语义与命中清单口径都由 renderAgentWorldbookHits_ACU 原样承担。
 */
export function buildRecentWorldbookScanText_ACU(chat: readonly any[], rules?: AgentContextRules_ACU): string {
  let user = '';
  let assistant = '';
  let foundUser = false;
  let foundAssistant = false;
  const floors = Array.isArray(chat) ? chat : [];
  for (let index = floors.length - 1; index >= 0 && (!foundUser || !foundAssistant); index -= 1) {
    const message = floors[index];
    if (!foundUser && message?.is_user === true) { user = messageText_ACU(message, rules); foundUser = true; }
    if (!foundAssistant && isAiFloor_ACU(message)) { assistant = messageText_ACU(message, rules); foundAssistant = true; }
  }
  return [user, assistant].filter(Boolean).join('\n');
}

export function buildAgentWorldbookScanText_ACU(context: AgentResolveContext_ACU): string {
  return buildRecentWorldbookScanText_ACU(context.chat, context.contextRules);
}

/** 四档节奏标签的语义与写作指导。低压轮的约束写成禁令，否则模型会习惯性地往每一轮里塞冲突。 */
const TURN_PACING_GUIDANCE_ACU: Record<StageTurnPacing_ACU, string> = {
  setup: '铺垫日常轮：允许主线 hold，通过具体生活动作与人物互动，让关系、习惯、世界理解、资源、身体或认知发生可观察变化；没有必须立即处理的危机时，可隔夜、数日后或更久开始。本轮禁止制造新危机、引入新敌对方或让局势升级，允许安静闭合或留下普通生活期待。',
  pressure: '冲突推进轮：外部压力上升，危机、对抗或追逼向前推进一步。本轮只推进一个冲突，不要同时开新战线。',
  turn: '转折揭示轮：反转、信息揭露或伏笔回收。揭示要落在已经埋过的东西上，不要临时造一个真相。',
  cooldown: '余波消化轮：允许主线 hold，完整处理上一波的伤势、代价、情绪与关系变化；可让恢复所需的一夜或数日自然流逝。本轮禁止制造新危机，让后果被真正看见，并允许安静闭合。',
};

/**
 * 渲染某一轮的节奏指导。
 * @param pacing 轮次节奏标签；无可执行轮次时传 null
 * @returns 标签名与对应的写作指导
 */
export function renderAgentTurnPacingGuidance_ACU(pacing: StageTurnPacing_ACU | null): string {
  if (!pacing) return '本轮节奏：尚无可执行的大纲轮次，节奏待大纲创建或继续后确定。';
  return `本轮节奏：${pacing}。${TURN_PACING_GUIDANCE_ACU[pacing]}`;
}

const TURN_FUNCTION_LABELS_ACU: Record<NonNullable<StageTurn_ACU['function']>, string> = {
  daily_bond: '关系日常',
  daily_world: '世界日常',
  recovery: '恢复余波',
  preparation: '准备',
  training: '训练/成长',
  economy: '经营',
  side_thread: '支线',
  conflict: '冲突',
  reveal: '揭示',
  payoff: '兑现',
  transition: '过渡',
};

const TURN_MAINLINE_LABELS_ACU: Record<NonNullable<StageTurn_ACU['mainlineDelta']>, string> = {
  hold: '主线停驻',
  micro: '主线微推进',
  step: '主线前进一步',
  milestone: '主线里程碑',
};

const TURN_TIME_LABELS_ACU: Record<NonNullable<StageTurn_ACU['timeAdvance']>, string> = {
  continuous: '紧接上一轮',
  same_day: '同日稍后',
  overnight: '隔夜',
  days: '数日后',
  weeks: '数周后',
  months: '数月后',
  years: '数年后',
};

const LONG_TIME_ADVANCES_ACU: ReadonlySet<string> = new Set(['days', 'weeks', 'months', 'years']);

/**
 * 渲染本轮的完整四维标记与由此触发的义务：pacing 指导 + 叙事功能 / 主线增量 / 时间关系 / 时间锚。
 * 时间跨度较大时把 V26 的时间跳跃义务直接写在这里，主 Agent 不必再去大纲窗口的箭头行比对。
 * 系统补全的字段单独点名，避免把推断值当成作者意图。
 * @param turn 当前轮次；无可执行轮次时传 null
 */
export function renderAgentTurnGuidance_ACU(turn: StageTurn_ACU | null): string {
  if (!turn) return renderAgentTurnPacingGuidance_ACU(null);
  const lines = [renderAgentTurnPacingGuidance_ACU(turn.pacing)];
  const marks: string[] = [];
  if (turn.function) marks.push(`叙事功能=${turn.function}（${TURN_FUNCTION_LABELS_ACU[turn.function]}）`);
  if (turn.mainlineDelta) marks.push(`主线增量=${turn.mainlineDelta}（${TURN_MAINLINE_LABELS_ACU[turn.mainlineDelta]}）`);
  if (turn.timeAdvance) marks.push(`时间关系=${turn.timeAdvance}（${TURN_TIME_LABELS_ACU[turn.timeAdvance]}）`);
  if (turn.timeAnchor) marks.push(`时间锚=${turn.timeAnchor}`);
  if (marks.length) lines.push(`本轮标记：${marks.join('；')}。`);
  if (turn.inferred?.length) {
    lines.push(`注意：${turn.inferred.join('、')} 是系统按节奏档保守补全的推断值，不是大纲作者的明确意图；与正文实际情况冲突时以正文为准。`);
  }
  if (turn.timeAdvance && LONG_TIME_ADVANCES_ACU.has(turn.timeAdvance)) {
    lines.push('时间跳跃义务：本轮计划跨越较长故事时间，finalize 的 instruction 必须写明新的相对时间锚、至少两项可感知变化（季节天气、身体伤势、衣着环境、关系熟悉度、资源经营、社会状态等），以及上一紧迫问题为何允许被跨过的连续性桥梁；不得用摘要跳过此前已承诺的关键场景。先 read $CHRONOLOGY 核对累计时间。');
  }
  if (turn.mainlineDelta === 'hold') {
    lines.push('本轮主线允许停驻：不推进核心矛盾、不揭示重大情报、不制造敌方动作，但必须有一项可观察的非危机变化。');
  }
  return lines.join('\n');
}

/**
 * 渲染当前大纲窗口：本阶段目标、当前节点与本节点全部轮次目标。
 * 大纲缺失或当前阶段已完成时如实说明状态，并指出必须先派工大纲子代理。
 * @param context 解析上下文
 * @returns 自然语言文本
 */
function renderTurnSemanticMeta_ACU(turn: StageTurn_ACU): string {
  const parts = [
    `pacing=${turn.pacing}`,
    `function=${turn.function ?? '未标注'}`,
    `mainline=${turn.mainlineDelta ?? '未标注'}`,
    `time=${turn.timeAdvance ?? '未标注'}`,
  ];
  if (turn.timeAnchor) parts.push(`anchor=${turn.timeAnchor}`);
  if (turn.inferred?.length) parts.push(`系统补全=${turn.inferred.join(',')}`);
  return parts.join('｜');
}

export function renderAgentOutlineWindow_ACU(context: AgentResolveContext_ACU): string {
  const { execution } = context;
  if (!execution.stage) {
    return '当前任务还没有阶段大纲。输出 open_round 后，固定工作流会先准备可执行阶段大纲，再进入资料工作流与写作指令编排；主 Agent 不直接派工 outline-architect。';
  }
  if (execution.stage.status === 'completed') {
    return `第 ${execution.stage.stageNumber} 阶段已全部完成（共 ${execution.stage.completedTurns} 轮）。输出 open_round 后，固定工作流会继续下一阶段大纲，再进入资料工作流与写作指令编排。`;
  }
  if (!execution.revision || !execution.node || !execution.turn) {
    return `第 ${execution.stage.stageNumber} 阶段的大纲当前不可执行（可能等待用户确认或游标无效）。本轮无法交付写作指导。`;
  }
  const nodes = execution.revision.outline.nodes?.length ? execution.revision.outline.nodes : [execution.node];
  const nodeBlocks = nodes.map(node => {
    const turns = node.turns
      .map((turn, index) => `${index + 1}. [${turn.id}]（${renderTurnSemanticMeta_ACU(turn)}）${turn.goal}${turn.id === execution.turn!.id ? '  ← 本轮' : ''}`)
      .join('\n');
    return [`节点：[${node.id}] ${node.title}`, `节点目标：${node.goal}`, turns].join('\n');
  });
  return [
    `阶段 ${execution.stage.stageNumber}：${execution.revision.outline.title}`,
    `阶段目标：${execution.revision.outline.goal}`,
    `阶段节奏形态：${describeStageTempo_ACU(execution.revision.outline.tempo)}——它决定本阶段低压轮的下限，也决定下一阶段不能选什么形态。`,
    `阶段结构职责：${execution.revision.outline.role ?? '旧快照未标注'}`,
    `阶段时间目标：${execution.revision.outline.timeSpanGoal ?? '未设定'}`,
    `阶段内轮次进度：第 ${execution.turnNumber} / ${execution.revision.outline.totalTurns} 轮`,
    '当前启用的阶段大纲（全部节点与轮次；括号内依次给出 pacing、function、mainline、time 与可选 anchor）：',
    nodeBlocks.join('\n\n'),
    renderAgentTurnPacingGuidance_ACU(execution.turn.pacing),
    '注意：大纲是计划，不是已经发生的事实。',
  ].join('\n');
}

/**
 * 渲染大纲游标的一行状态，进入主 Agent 骨架的 $OUTLINE_STATE。
 * 完整大纲窗口靠 read $OUTLINE_WINDOW 调阅，骨架只保留「现在在哪」。
 * @param context 解析上下文
 * @returns 一行状态文本
 */
export function renderAgentOutlineState_ACU(context: AgentResolveContext_ACU): string {
  const { execution } = context;
  if (!execution.stage) return '大纲状态：尚无阶段大纲（须先派工 outline-architect 创建，之后才能 finalize）。';
  if (execution.stage.status === 'completed') {
    return `大纲状态：第 ${execution.stage.stageNumber} 阶段已全部完成，下一阶段大纲未创建（须派工 outline-architect 继续）。`;
  }
  if (!execution.revision || !execution.node || !execution.turn) {
    return `大纲状态：第 ${execution.stage.stageNumber} 阶段的大纲当前不可执行（可能等待确认或游标无效）。`;
  }
  return `大纲状态：第 ${execution.stage.stageNumber} 阶段「${execution.revision.outline.title}」（节奏形态 ${describeStageTempo_ACU(execution.revision.outline.tempo)}，结构职责 ${execution.revision.outline.role ?? '未标注'}），第 ${execution.turnNumber}/${execution.revision.outline.totalTurns} 轮，当前节点 [${execution.node.id}]，本轮轮次 [${execution.turn.id}]，${renderTurnSemanticMeta_ACU(execution.turn)}。完整大纲窗口用 read $OUTLINE_WINDOW 调阅。`;
}

const ROW_RANGE_PATTERN_ACU = /^(\d+)-(\d+)$/;

function parseRowRange_ACU(raw: string): AgentTableRowRange_ACU | null {
  const matched = ROW_RANGE_PATTERN_ACU.exec(raw.trim());
  if (!matched) return null;
  return { start: Number.parseInt(matched[1], 10), end: Number.parseInt(matched[2], 10) };
}

function splitIdSuffix_ACU(token: string, prefix: string): string[] | null {
  if (token === prefix) return [];
  if (!token.startsWith(`${prefix}:`)) return null;
  return token.slice(prefix.length + 1).split(/[,，]/).map(id => id.trim()).filter(Boolean);
}

function resolveTableToken_ACU(token: string, context: AgentResolveContext_ACU): { title: string; text: string } {
  const body = token.slice(AGENT_TABLE_TOKEN_PREFIX_ACU.length).trim();
  // 末段若形如 a-b 视为行区间，其余部分是表名——表名本身可能含冒号之外的任意字符。
  const lastColon = body.lastIndexOf(':');
  const rangeCandidate = lastColon >= 0 ? parseRowRange_ACU(body.slice(lastColon + 1)) : null;
  const name = rangeCandidate ? body.slice(0, lastColon).trim() : body;
  const title = rangeCandidate ? `表格「${name}」第 ${rangeCandidate.start}-${rangeCandidate.end} 行` : `表格「${name}」`;
  return { title, text: renderAgentTableByName_ACU(name, context.tableData, rangeCandidate ?? undefined) };
}

function resolveWorldbookToken_ACU(token: string, context: AgentResolveContext_ACU): { title: string; text: string } {
  const worldbook = context.worldbook ?? buildEmptyAgentWorldbookSnapshot_ACU(false);
  const body = token.slice(AGENT_WORLDBOOK_TOKEN_PREFIX_ACU.length);
  const lastColon = body.lastIndexOf(':');
  if (lastColon <= 0) {
    return { title: '世界书条目', text: '世界书读取地址不完整：写法为 $WORLDBOOK:书名:uid（逗号分隔多个 uid），地址请从世界书目录复制。' };
  }
  const bookName = body.slice(0, lastColon).trim();
  const uids = body.slice(lastColon + 1).split(/[,，]/).map(uid => uid.trim()).filter(Boolean);
  return { title: `世界书「${bookName}」条目 ${uids.join('、')}`, text: renderAgentWorldbookEntries_ACU(worldbook, bookName, uids) };
}

/**
 * 解析一个读集 token 的内容。
 *
 * 支持的地址体系（与各资料目录里给出的读取地址一一对应）：
 * - `$STORY_RANGE:a-b` 窗口内正文楼层区间；`$STORY_CATALOG` 楼层索引
 * - `$STORY_OVERVIEW` 事件概览；`$STORY_TAIL` 尾部全文楼层
 * - `$TABLE:表名` / `$TABLE:表名:a-b` 整表或行区间
 * - `$STORY_ARC[:ID,ID]` / `$HOOKS_LEDGER[:ID,ID]` / `$INFO_GAP[:ID,ID]` / `$ACTIVE_CONSTRAINTS[:ID,ID]` 模块全量或按 ID 精读
 * - `$WORLDBOOK:书名:uid[,uid]` 已启用世界书条目全文
 * - 旧固定 token（$STORY_TEXT / $OUTLINE_WINDOW 等）保留兼容
 * @param token 读集标识符
 * @param context 解析上下文
 * @returns { title, text } 分节标题与正文；未知 token 的 text 会明确说明不可读
 */
export function resolveAgentReadToken_ACU(token: string, context: AgentResolveContext_ACU): { title: string; text: string; status?: 'failed' } {
  const normalized = String(token ?? '').trim();
  if (normalized.startsWith(AGENT_TABLE_TOKEN_PREFIX_ACU)) return resolveTableToken_ACU(normalized, context);
  if (normalized.startsWith(AGENT_WORLDBOOK_TOKEN_PREFIX_ACU)) return resolveWorldbookToken_ACU(normalized, context);
  if (normalized.startsWith(AGENT_STORY_RANGE_TOKEN_PREFIX_ACU)) {
    const body = normalized.slice(AGENT_STORY_RANGE_TOKEN_PREFIX_ACU.length).trim();
    const matched = /^(\d+)-(\d+)$/.exec(body);
    return {
      title: matched ? `正文楼层 ${matched[1]}-${matched[2]}` : '正文楼层区间',
      text: matched
        ? renderAgentStoryRange_ACU(context, matched[1], matched[2])
        : `楼层区间「${normalized}」不合法：写法为 $STORY_RANGE:起始楼-结束楼。可用楼层见正文目录。`,
    };
  }

  const storyArcIds = splitIdSuffix_ACU(normalized, '$STORY_ARC');
  if (storyArcIds !== null) {
    const completedStageNumbers = context.execution.task.stages
      .filter(stage => stage.status === 'completed')
      .map(stage => stage.stageNumber);
    return { title: storyArcIds.length ? `故事总纲条目 ${storyArcIds.join('、')}` : '故事总纲（全部活跃条目）', text: renderAgentStoryArcByIds_ACU(context.moduleSnapshot, storyArcIds.length ? storyArcIds : undefined, completedStageNumbers) };
  }
  const hookIds = splitIdSuffix_ACU(normalized, '$HOOKS_LEDGER');
  if (hookIds !== null) {
    return { title: hookIds.length ? `伏笔账本条目 ${hookIds.join('、')}` : '伏笔账本（全部活跃条目）', text: renderAgentHooksByIds_ACU(context.moduleSnapshot, hookIds.length ? hookIds : undefined) };
  }
  const infoGapIds = splitIdSuffix_ACU(normalized, '$INFO_GAP');
  if (infoGapIds !== null) {
    return { title: infoGapIds.length ? `信息差条目 ${infoGapIds.join('、')}` : '认知与信息差时间线（全部活跃条目）', text: renderAgentInfoGapByIds_ACU(context.moduleSnapshot, infoGapIds.length ? infoGapIds : undefined) };
  }
  const constraintIds = splitIdSuffix_ACU(normalized, '$ACTIVE_CONSTRAINTS');
  if (constraintIds !== null) {
    return { title: constraintIds.length ? `长期约束条目 ${constraintIds.join('、')}` : '长期约束（全部条目）', text: renderAgentConstraintsByIds_ACU(context.moduleSnapshot, constraintIds.length ? constraintIds : undefined) };
  }
  const chronologyIds = splitIdSuffix_ACU(normalized, '$CHRONOLOGY');
  if (chronologyIds !== null) {
    return chronologyIds.length
      ? { title: `故事年代学条目 ${chronologyIds.join('、')}`, text: renderAgentChronologyByIds_ACU(context.moduleSnapshot, chronologyIds) }
      : { title: '故事年代学账本（已发生正文结算出的时间事实）', text: renderAgentChronology_ACU(context.moduleSnapshot) };
  }
  const webRefIds = splitIdSuffix_ACU(normalized, '$WEB_REFS');
  if (webRefIds !== null) {
    return {
      title: webRefIds.length ? `百科资料库条目 ${webRefIds.join('、')}（外部参考，非本故事事实）` : '百科资料库（全部活跃条目摘要；外部参考，非本故事事实）',
      text: renderAgentWebRefsByIds_ACU(context.moduleSnapshot, webRefIds.length ? webRefIds : undefined),
    };
  }

  if (normalized.startsWith('$FIELD:')) {
    const match = /^\$FIELD:(storyArc|hooks|infoGap|chronology|webRefs|constraints):([^:]+)(?::([^:]+))?$/.exec(normalized);
    if (!match) return { title: '资料栏目', text: '栏目地址非法：$FIELD:模块:ID[:栏目]。' };
    const [, moduleName, rawId, field] = match;
    // 模型可控 id 不得命中原型链：空/超长/原型关键名一律按非法地址拒绝，不进入查找。
    const id = String(rawId ?? '').trim();
    if (!id || id.length > 128 || ['__proto__', 'prototype', 'constructor'].includes(id)) {
      return { title: '资料栏目', text: '栏目地址非法：$FIELD:模块:ID[:栏目]。' };
    }
    const module = moduleName as keyof typeof AGENT_MODULE_FIELD_MATRIX_ACU;
    if (field && !AGENT_MODULE_FIELD_MATRIX_ACU[module].fields.includes(field)) return { title: '资料栏目', text: `栏目 ${module}.${field} 不在受控字段矩阵中。` };
    const folded = readAgentModuleFoldState_ACU(context.chat);
    if (folded.salvaged || folded.candidates.some(item => !item.valid)) return { title: '资料栏目读取失败', text: '资料帧校验失败；不得将损坏数据解释为空状态。', status: 'failed' };
    const bucket = folded.fields.records[module];
    const record = bucket && Object.prototype.hasOwnProperty.call(bucket, id)
      ? bucket[id] as (typeof bucket)[string]
      : undefined;
    return { title: `资料栏目 ${module}#${id}`, text: JSON.stringify(record
      ? { module, id, status: record.status, missingFields: record.missingFields,
        fields: field
          ? { [field]: record.fields && Object.prototype.hasOwnProperty.call(record.fields, field) ? record.fields[field] : null }
          : record.fields,
        revisions: folded.snapshot.revisions[module] }
      : { module, id, status: 'unwritten', missingFields: AGENT_MODULE_FIELD_MATRIX_ACU[module].required, revisions: folded.snapshot.revisions[module] }) };
  }

  const title = READ_TOKEN_TITLES_ACU[normalized] ?? normalized;
  switch (normalized) {
    case '$STORY_TEXT': return { title, text: renderAgentStoryText_ACU(context) };
    case '$STORY_CATALOG': return { title, text: renderAgentStoryCatalog_ACU(context) };
    case '$STORY_OVERVIEW': return { title, text: renderAgentStoryOverview_ACU(context) };
    case '$STORY_TAIL': return { title, text: renderAgentStoryTail_ACU(context) };
    case '$HISTORY_UNSETTLED': return { title, text: renderAgentUnsettledHistory_ACU(context) };
    case '$OUTLINE_WINDOW': return { title, text: renderAgentOutlineWindow_ACU(context) };
    case '$CURRENT_TURN_GOAL': return { title, text: context.execution.turn?.goal || '（尚无可执行的大纲轮次，本轮目标待大纲创建或继续后确定）' };
    case '$CURRENT_TURN_PACING': return { title, text: renderAgentTurnGuidance_ACU(context.execution.turn ?? null) };
    case '$USER_INTENT': return { title, text: context.originInstruction || '（用户未提供初始要求）' };
    case '$USER_REQUIREMENTS': return { title, text: renderAgentUserRequirements_ACU(context.moduleSnapshot, context.originInstruction) };
    case '$TABLE_GLOBAL': return { title, text: renderAgentTableByAliases_ACU('global', context.tableData) };
    case '$TABLE_CHARACTERS': return { title, text: renderAgentTableByAliases_ACU('characters', context.tableData) };
    case '$TABLE_CHRONICLES': return { title, text: renderAgentTableByAliases_ACU('chronicles', context.tableData) };
    default: return { title, text: `占位符 ${normalized || '(空)'} 不是可读资料接口，本次没有为你提供任何内容。请从各资料目录里复制读取地址。` };
  }
}

/**
 * 把一批读集 token 渲染成一整块注入材料。
 * @param tokens 读集标识符列表
 * @param context 解析上下文
 * @returns 分节材料文本；读集为空时如实标注
 */
export function renderAgentReadMaterials_ACU(tokens: readonly string[], context: AgentResolveContext_ACU): string {
  const unique = [...new Set(tokens.map(token => String(token ?? '').trim()).filter(Boolean))];
  if (!unique.length) return '本次没有为你注入任何资料。你只能基于任务描述作答，缺少的信息必须标注「信息不足」。';
  return unique
    .map(token => { const resolved = resolveAgentReadToken_ACU(token, context); return `### ${resolved.title}（${token}）\n${resolved.text}`; })
    .join('\n\n');
}
