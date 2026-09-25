/**
 * service/continuation/agent/agent-module-store.ts — 楼层锚定的叙事资料存储（帧架构）
 *
 * 存储策略：schema 3 帧 = checkpoint 全量基线 + 楼层 delta。读取从最近基线起按楼层顺序
 * 叠加当前 swipe 的 delta。删楼让该楼 delta 消失，折叠结果回到剩余链。
 * schema 1 全量快照只在读取时当成 swipe 0 的基线，成功写入才升级。
 *
 * P1 加固保留：前缀指纹兼容门控、修订号乐观锁、宽容抢救诊断，一行不弱化。
 */

import { getChatArray_ACU, saveChatToHostStrict_ACU } from '../../../data/gateways/chat-gateway';
import { getActiveChatStorageIdentity_ACU } from '../../../data/storage/chat-history';
import { findLatestTableFullCheckpointIndex_ACU } from '../../chat/material-checkpoint-sync';
import {
  foldAgentModuleSnapshot_ACU,
  planAgentModuleFieldWrite_ACU,
  planAgentModuleSnapshotWrite_ACU,
  readMessageSwipeId_ACU,
  type AgentModuleFoldResult_ACU,
  type AgentModuleFrameDeps_ACU,
} from './agent-module-frame';
import { materializeAgentModuleSqlView_ACU } from './agent-module-sql-view';
import {
  parseAgentModuleSqlFieldWrites_ACU,
  type AgentModuleSqlFieldIntent_ACU,
  type AgentModuleSqlFieldRejection_ACU,
} from './agent-protocol';
import { ContinuationValidationError_ACU, createContinuationError_ACU } from '../model';
import {
  AGENT_BLOCK_CHAR_LIMIT_ACU,
  AGENT_CHRONOLOGY_PRECISIONS_ACU,
  AGENT_HOOK_IMPORTANCES_ACU,
  AGENT_HOOK_STATUSES_ACU,
  AGENT_HOT_HOOK_LIMIT_ACU,
  AGENT_MODULE_FIELD_ACU,
  AGENT_MODULE_FIELD_MATRIX_ACU,
  AGENT_MODULE_SCHEMA_VERSION_ACU,
  AGENT_MODULE_SCHEMA_VERSION_V1_ACU,
  AGENT_PENDING_FIX_CAP_ACU,
  AGENT_REVEAL_STATUSES_ACU,
  AGENT_STORY_ARC_SCOPES_ACU,
  AGENT_STORY_ARC_STATUSES_ACU,
  AGENT_VOLUME_NARRATIVE_ROLES_ACU,
  AGENT_WEB_REF_SOURCES_ACU,
  AGENT_WEB_REF_STATUSES_ACU,
  type AgentChronologyEntry_ACU,
  type AgentConstraintEntry_ACU,
  type AgentHookEntry_ACU,
  type AgentInfoGapEntry_ACU,
  type AgentModuleFieldRecord_ACU,
  type AgentModuleFieldSnapshot_ACU,
  type AgentModuleFieldUpserts_ACU,
  type AgentModuleSnapshot_ACU,
  type AgentPendingFix_ACU,
  type AgentStoryArcEntry_ACU,
  type AgentSubagentName_ACU,
  type AgentWebRefEntry_ACU,
  type AgentWritableModule_ACU,
  isAgentWritableModule_ACU,
} from './agent-model';

const IMPORTANCE_WEIGHTS_ACU: Record<string, number> = { high: 3, mid: 2, low: 1 };

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readText_ACU(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readIndex_ACU(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : -1;
}

/**
 * 计算结算水位之前聊天前缀的短指纹。优先使用稳定 message_id；没有 ID 时仍把
 * 楼层位置、角色、正文纳入哈希，因此删除或替换水位之前的楼层必然改变指纹。
 */
function chatPrefixFingerprint_ACU(messages: any[], throughIndex: number): string {
  const end = Math.min(Math.max(throughIndex, -1), messages.length - 1);
  let hash = 2166136261;
  const add = (text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0x1f;
    hash = Math.imul(hash, 16777619);
  };
  add(`count:${end + 1}`);
  for (let index = 0; index <= end; index += 1) {
    const message = isRecord_ACU(messages[index]) ? messages[index] : {};
    const stableId = message.message_id ?? message.id ?? '';
    add(`${index}:${String(stableId)}:${String(message.role ?? '')}:${message.is_user ? 1 : 0}:${message.is_system ? 1 : 0}:${readText_ACU(message.mes)}`);
  }
  return `${end + 1}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** 在水位合法推进后刷新前缀指纹；调用方必须在同一轮确认聊天未被替换。 */
export function refreshAgentModuleSnapshotChatPrefix_ACU(snapshot: AgentModuleSnapshot_ACU, chat: any[]): AgentModuleSnapshot_ACU {
  return {
    ...snapshot,
    settledPrefixFingerprint: chatPrefixFingerprint_ACU(chat, snapshot.settledThroughIndex),
  };
}

function isChatPrefixCompatible_ACU(snapshot: AgentModuleSnapshot_ACU, messages: any[]): boolean {
  if (!snapshot.settledPrefixFingerprint) return true;
  return snapshot.settledPrefixFingerprint === chatPrefixFingerprint_ACU(messages, snapshot.settledThroughIndex);
}

function readEnum_ACU(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

export function buildEmptyAgentModuleSnapshot_ACU(): AgentModuleSnapshot_ACU {
  return {
    schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
    settledThroughIndex: -1,
    updatedAt: 0,
    revisions: { hooks: 0, infoGap: 0, constraints: 0, storyArc: 0, chronology: 0, webRefs: 0, userRequirements: 0 },
    hooks: [],
    infoGap: [],
    constraints: [],
    storyArc: [],
    chronology: [],
    webRefs: [],
    userRequirements: [],
    pendingFixes: [],
  };
}

/** 证据楼层列表：只接受非负整数，去重后升序。是否越过结算水位由事务层校验。 */
export function normalizeEvidenceIndexes_ACU(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const indexes: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) return null;
    indexes.push(item);
  }
  return [...new Set(indexes)].sort((left, right) => left - right);
}

/** 阶段编号列表：只接受正整数，去重后升序。乱序或重复是模型回写进度时的常见噪音。 */
export function normalizeStageNumbers_ACU(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const numbers = value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item >= 1);
  return [...new Set(numbers)].sort((left, right) => left - right);
}

function validateHookEntry_ACU(raw: unknown): AgentHookEntry_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const id = readText_ACU(raw.id).trim();
  const summary = readText_ACU(raw.summary).trim();
  if (!id || !summary) return null;
  return {
    id,
    summary,
    status: readEnum_ACU(raw.status, AGENT_HOOK_STATUSES_ACU, 'planted') as AgentHookEntry_ACU['status'],
    importance: readEnum_ACU(raw.importance, AGENT_HOOK_IMPORTANCES_ACU, 'mid') as AgentHookEntry_ACU['importance'],
    plantedIndex: readIndex_ACU(raw.plantedIndex),
    updatedIndex: readIndex_ACU(raw.updatedIndex),
    plannedPayoff: readText_ACU(raw.plannedPayoff),
    retired: raw.retired === true,
    retiredReason: readText_ACU(raw.retiredReason),
  };
}

function validateInfoGapEntry_ACU(raw: unknown): AgentInfoGapEntry_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const id = readText_ACU(raw.id).trim();
  const topic = readText_ACU(raw.topic).trim();
  if (!id || !topic) return null;
  const knowledge = Array.isArray(raw.characterKnowledge) ? raw.characterKnowledge : [];
  const revealStatus = readEnum_ACU(raw.revealStatus, AGENT_REVEAL_STATUSES_ACU, 'unrevealed') as AgentInfoGapEntry_ACU['revealStatus'];
  const revealIndex = readIndex_ACU(raw.revealIndex);
  return {
    id,
    topic,
    objectiveFact: readText_ACU(raw.objectiveFact),
    readerKnown: readText_ACU(raw.readerKnown),
    characterKnowledge: knowledge.flatMap(item => {
      if (!isRecord_ACU(item)) return [];
      const name = readText_ACU(item.name).trim();
      return name ? [{ name, knows: readText_ACU(item.knows) }] : [];
    }),
    revealStatus,
    // 未揭示的条目不允许携带揭示楼层，这是模型把计划写成事实的典型症状。
    revealIndex: revealStatus === 'unrevealed' || revealIndex < 0 ? null : revealIndex,
    retired: raw.retired === true,
    retiredReason: readText_ACU(raw.retiredReason),
  };
}

function readOptionalStoryArcText_ACU(raw: Record<string, unknown>, key: string): string | undefined | null {
  if (!Object.prototype.hasOwnProperty.call(raw, key)) return undefined;
  return typeof raw[key] === 'string' ? raw[key].trim() : null;
}

function readOptionalStoryArcTextList_ACU(raw: Record<string, unknown>, key: string): string[] | undefined | null {
  if (!Object.prototype.hasOwnProperty.call(raw, key)) return undefined;
  const value = raw[key];
  if (!Array.isArray(value)) return null;
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) return null;
    normalized.push(item.trim());
  }
  return normalized;
}

function readOptionalTargetStageRange_ACU(raw: Record<string, unknown>): { min: number; max: number } | undefined | null {
  if (!Object.prototype.hasOwnProperty.call(raw, 'targetStageRange')) return undefined;
  const value = raw.targetStageRange;
  if (!isRecord_ACU(value)) return null;
  const { min, max } = value;
  if (!Number.isInteger(min) || (min as number) < 1 || !Number.isInteger(max) || (max as number) < 1 || (min as number) > (max as number)) return null;
  return { min: min as number, max: max as number };
}

function validateStoryArcEntry_ACU(raw: unknown): AgentStoryArcEntry_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const id = readText_ACU(raw.id).trim();
  const title = readText_ACU(raw.title).trim();
  if (!id || !title) return null;
  const narrativeRole = Object.prototype.hasOwnProperty.call(raw, 'narrativeRole')
    ? readEnum_ACU(raw.narrativeRole, AGENT_VOLUME_NARRATIVE_ROLES_ACU, '')
    : undefined;
  const targetStageRange = readOptionalTargetStageRange_ACU(raw);
  const targetTimeSpan = readOptionalStoryArcText_ACU(raw, 'targetTimeSpan');
  const progressCeiling = readOptionalStoryArcText_ACU(raw, 'progressCeiling');
  const sustainingThreads = readOptionalStoryArcTextList_ACU(raw, 'sustainingThreads');
  const payoffTargets = readOptionalStoryArcTextList_ACU(raw, 'payoffTargets');
  const completionRationale = readOptionalStoryArcText_ACU(raw, 'completionRationale');
  if (narrativeRole === '' || targetStageRange === null || targetTimeSpan === null || progressCeiling === null || sustainingThreads === null || payoffTargets === null || completionRationale === null) return null;
  return {
    id,
    scope: readEnum_ACU(raw.scope, AGENT_STORY_ARC_SCOPES_ACU, 'volume') as AgentStoryArcEntry_ACU['scope'],
    title,
    direction: readText_ACU(raw.direction),
    escalation: readText_ACU(raw.escalation),
    withheld: readText_ACU(raw.withheld),
    status: readEnum_ACU(raw.status, AGENT_STORY_ARC_STATUSES_ACU, 'planned') as AgentStoryArcEntry_ACU['status'],
    stageNumbers: normalizeStageNumbers_ACU(raw.stageNumbers),
    completionStageNumber: typeof raw.completionStageNumber === 'number' && Number.isInteger(raw.completionStageNumber) && raw.completionStageNumber >= 1 ? raw.completionStageNumber : null,
    completionState: readText_ACU(raw.completionState),
    continuationRationale: readText_ACU(raw.continuationRationale),
    narrativeRole: narrativeRole as AgentStoryArcEntry_ACU['narrativeRole'],
    targetStageRange,
    targetTimeSpan,
    progressCeiling,
    sustainingThreads,
    payoffTargets,
    completionRationale,
    retired: raw.retired === true,
    retiredReason: readText_ACU(raw.retiredReason),
  };
}

/**
 * 严格校验一条持久化的年代学记录。chronology 是 P3 才引入的字段：旧快照根本没有它，
 * 因此不存在「宽容旧形态」的需要——字段一旦出现就必须结构完整，坏条目不做静默降级。
 */
function validateChronologyEntry_ACU(raw: unknown): AgentChronologyEntry_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const id = readText_ACU(raw.id).trim();
  const anchor = readText_ACU(raw.anchor).trim();
  const elapsed = readText_ACU(raw.elapsed).trim();
  const transition = readText_ACU(raw.transition).trim();
  if (!id || !anchor || !elapsed || !transition) return null;
  const precision = typeof raw.precision === 'string' && (AGENT_CHRONOLOGY_PRECISIONS_ACU as readonly string[]).includes(raw.precision) ? raw.precision : null;
  if (!precision) return null;
  const evidenceIndexes = normalizeEvidenceIndexes_ACU(raw.evidenceIndexes);
  if (!evidenceIndexes || !evidenceIndexes.length) return null;
  const updatedIndex = readIndex_ACU(raw.updatedIndex);
  if (updatedIndex < 0) return null;
  const retired = raw.retired === true;
  const retiredReason = readText_ACU(raw.retiredReason);
  if (retired && !retiredReason.trim()) return null;
  return {
    id,
    anchor,
    elapsed,
    precision: precision as AgentChronologyEntry_ACU['precision'],
    transition,
    evidenceIndexes,
    updatedIndex,
    retired,
    retiredReason,
  };
}

function validateConstraintEntry_ACU(raw: unknown): AgentConstraintEntry_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const id = readText_ACU(raw.id).trim();
  const text = readText_ACU(raw.text).trim();
  if (!id || !text) return null;
  return { id, text, reason: readText_ACU(raw.reason), createdIndex: readIndex_ACU(raw.createdIndex) };
}

function validateUserRequirementLine_ACU(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return text ? text : null;
}

/** 取一段文本的首句，用作旧条目缺失 brief 时的兼容兜底。 */
export function firstSentence_ACU(text: string): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const cut = flat.split(/(?<=[。！？!?\.])\s*|\n/)[0] ?? flat;
  return cut.length > 80 ? `${cut.slice(0, 80)}…` : cut;
}

/**
 * 校验一条资料库记录。固定内容是 title 与 brief；summary 为可空的自由格式详情。
 * TT 不再让网页原文继续扩张聊天快照：旧条目的 extract 字段故意不读取。
 */
export function validateWebRefEntry_ACU(raw: unknown): AgentWebRefEntry_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const id = readText_ACU(raw.id).trim();
  const title = readText_ACU(raw.title).trim();
  const url = readText_ACU(raw.url).trim();
  if (!id || !title || !url) return null;
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((item): item is string => typeof item === 'string' && !!item.trim()).map(item => item.trim())
    : [];
  return {
    id,
    title,
    source: readEnum_ACU(raw.source, AGENT_WEB_REF_SOURCES_ACU, 'web') as AgentWebRefEntry_ACU['source'],
    url,
    query: readText_ACU(raw.query),
    tags,
    brief: readText_ACU(raw.brief).trim() || firstSentence_ACU(readText_ACU(raw.summary)),
    summary: readText_ACU(raw.summary),
    sourceStatus: readEnum_ACU(raw.sourceStatus, AGENT_WEB_REF_STATUSES_ACU, 'unavailable') as AgentWebRefEntry_ACU['sourceStatus'],
    fetchedAt: typeof raw.fetchedAt === 'number' && raw.fetchedAt >= 0 ? raw.fetchedAt : 0,
    retired: raw.retired === true,
    retiredReason: readText_ACU(raw.retiredReason),
  };
}

/**
 * 校验一份持久化快照。非法返回 null 而不抛错，让读取端可以继续向前寻找上一个合法快照，
 * 因为某一楼层的字段可能只是被外部工具污染，不代表整条链路不可用。
 */
export function validateAgentModuleSnapshot_ACU(raw: unknown): AgentModuleSnapshot_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  if (raw.schemaVersion !== AGENT_MODULE_SCHEMA_VERSION_V1_ACU && raw.schemaVersion !== AGENT_MODULE_SCHEMA_VERSION_ACU) return null;
  if (!isRecord_ACU(raw.revisions)) return null;
  if (!Array.isArray(raw.hooks) || !Array.isArray(raw.infoGap) || !Array.isArray(raw.constraints)) return null;
  const settledThroughIndex = readIndex_ACU(raw.settledThroughIndex);
  if (settledThroughIndex < 0) return null;
  // storyArc 晚于前三个模块加入，存量楼层的快照里没有这个键。缺字段兼容为空，
  // 但字段一旦出现就必须是数组；否则“损坏总纲”会被静默当成空总纲并推进写入。
  if (Object.prototype.hasOwnProperty.call(raw, 'storyArc') && !Array.isArray(raw.storyArc)) return null;
  const storyArc = Array.isArray(raw.storyArc) ? raw.storyArc : [];
  const validatedStoryArc = storyArc.map(validateStoryArcEntry_ACU);
  // 总纲条目不能像普通搜索命中一样被悄悄过滤；任一结构损坏都应让读取端回退上一份完整快照。
  if (validatedStoryArc.some(entry => entry === null)) return null;
  // chronology 同样后于早期快照加入：缺字段兼容为空账本；但字段一旦存在就必须整体合法——
  // 时间事实被静默过滤比暂时回退旧快照更危险（后续结算会基于错误的时间线登记新事实）。
  if (Object.prototype.hasOwnProperty.call(raw, 'chronology') && !Array.isArray(raw.chronology)) return null;
  const chronology = Array.isArray(raw.chronology) ? raw.chronology : [];
  const validatedChronology = chronology.map(validateChronologyEntry_ACU);
  if (validatedChronology.some(entry => entry === null)) return null;
  if (Object.prototype.hasOwnProperty.call(raw, 'webRefs') && !Array.isArray(raw.webRefs)) return null;
  const webRefs = Array.isArray(raw.webRefs) ? raw.webRefs : [];
  // userRequirements 晚于早期快照加入：缺字段兼容为空清单；字段一旦存在就必须是字符串数组，
  // 且每条 trim 后非空——静默丢掉用户要求比暂时回退旧快照更危险。
  if (Object.prototype.hasOwnProperty.call(raw, 'userRequirements') && !Array.isArray(raw.userRequirements)) return null;
  const userRequirementsRaw = Array.isArray(raw.userRequirements) ? raw.userRequirements : [];
  const validatedUserRequirements = userRequirementsRaw.map(validateUserRequirementLine_ACU);
  if (validatedUserRequirements.some(entry => entry === null)) return null;
  // pendingFixes：v1 快照没有该字段，缺字段兼容为空数组；字段一旦出现就必须整体合法，
  // 否则调用方无法判断哪些模块需要修复，回退上一份完整快照比静默丢弃更安全。
  const pendingPresent = Object.prototype.hasOwnProperty.call(raw, 'pendingFixes');
  const pendingFixes = validatePendingFixes_ACU(raw.pendingFixes, pendingPresent);
  if (!pendingFixes) return null;
  return {
    schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
    settledThroughIndex,
    ...(typeof raw.settledPrefixFingerprint === 'string' && raw.settledPrefixFingerprint
      ? { settledPrefixFingerprint: raw.settledPrefixFingerprint }
      : {}),
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt >= 0 ? raw.updatedAt : 0,
    revisions: {
      hooks: Math.max(0, readIndex_ACU(raw.revisions.hooks)),
      infoGap: Math.max(0, readIndex_ACU(raw.revisions.infoGap)),
      constraints: Math.max(0, readIndex_ACU(raw.revisions.constraints)),
      storyArc: Math.max(0, readIndex_ACU(raw.revisions.storyArc)),
      chronology: Math.max(0, readIndex_ACU(raw.revisions.chronology)),
      webRefs: Math.max(0, readIndex_ACU(raw.revisions.webRefs)),
      userRequirements: Math.max(0, readIndex_ACU(raw.revisions.userRequirements)),
    },
    hooks: raw.hooks.flatMap(item => { const entry = validateHookEntry_ACU(item); return entry ? [entry] : []; }),
    infoGap: raw.infoGap.flatMap(item => { const entry = validateInfoGapEntry_ACU(item); return entry ? [entry] : []; }),
    constraints: raw.constraints.flatMap(item => { const entry = validateConstraintEntry_ACU(item); return entry ? [entry] : []; }),
    storyArc: validatedStoryArc as AgentStoryArcEntry_ACU[],
    chronology: validatedChronology as AgentChronologyEntry_ACU[],
    webRefs: webRefs.flatMap(item => { const entry = validateWebRefEntry_ACU(item); return entry ? [entry] : []; }),
    userRequirements: validatedUserRequirements as string[],
    pendingFixes,
  };
}

/** 缺字段视为空数组。字段存在但不合法时返回 null，调用方决定拒绝或抢救。 */
function validatePendingFixes_ACU(raw: unknown, present: boolean): AgentPendingFix_ACU[] | null {
  if (!present) return [];
  if (!Array.isArray(raw) || raw.length > AGENT_PENDING_FIX_CAP_ACU) return null;
  const fixes: AgentPendingFix_ACU[] = [];
  for (const item of raw) {
    if (!isRecord_ACU(item) || !isAgentWritableModule_ACU(item.module)) return null;
    if (typeof item.agentName !== 'string' || typeof item.lastError !== 'string') return null;
    if (typeof item.attempts !== 'number' || !Number.isInteger(item.attempts) || item.attempts < 1 || item.attempts > 99) return null;
    if (typeof item.firstFailedAtIndex !== 'number' || !Number.isInteger(item.firstFailedAtIndex) || item.firstFailedAtIndex < -1) return null;
    if (!Array.isArray(item.violations) || item.violations.length > 32) return null;
    const violations: AgentPendingFix_ACU['violations'] = [];
    for (const violation of item.violations) {
      if (!isRecord_ACU(violation) || typeof violation.path !== 'string' || typeof violation.message !== 'string' || !violation.message.trim()) return null;
      violations.push({ path: violation.path, message: violation.message });
    }
    fixes.push({
      module: item.module,
      agentName: item.agentName,
      violations,
      attempts: item.attempts,
      firstFailedAtIndex: item.firstFailedAtIndex,
      lastError: item.lastError,
    });
  }
  return fixes;
}

/**
 * 宽容解析一份损坏的快照：丢掉单条非法记录、修正非法水位，尽量保住其余数据。
 * 只在严格路径全程无命中时作为兜底使用——静默回退成空快照会让用户误以为数据从未写入。
 * 导出供帧折叠的 salvage 路径复用。
 */
export function salvageAgentModuleSnapshot_ACU(raw: unknown): { snapshot: AgentModuleSnapshot_ACU; problems: string[] } | null {
  if (!isRecord_ACU(raw)) return null;
  const problems: string[] = [];
  if (raw.schemaVersion !== AGENT_MODULE_SCHEMA_VERSION_V1_ACU && raw.schemaVersion !== AGENT_MODULE_SCHEMA_VERSION_ACU) {
    problems.push(`schemaVersion=${String(raw.schemaVersion)} 与当前 ${AGENT_MODULE_SCHEMA_VERSION_ACU} 不一致`);
  }
  const revisions = isRecord_ACU(raw.revisions) ? raw.revisions : {};
  const pick = <T>(list: unknown, validate: (item: unknown) => T | null, label: string): T[] => {
    if (!Array.isArray(list)) { if (list !== undefined) problems.push(`${label} 不是数组`); return []; }
    const kept: T[] = [];
    list.forEach((item, index) => { const entry = validate(item); if (entry) kept.push(entry); else problems.push(`${label}[${index}] 结构非法，已丢弃`); });
    return kept;
  };
  const settledThroughIndex = readIndex_ACU(raw.settledThroughIndex);
  if (settledThroughIndex < 0) problems.push(`settledThroughIndex=${String(raw.settledThroughIndex)} 非法，按 0 处理`);
  const pendingPresent = Object.prototype.hasOwnProperty.call(raw, 'pendingFixes');
  const pendingFixes = validatePendingFixes_ACU(raw.pendingFixes, pendingPresent);
  if (!pendingFixes) problems.push('pendingFixes 结构非法，已按空数组读取');
  const snapshot: AgentModuleSnapshot_ACU = {
    schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
    settledThroughIndex: Math.max(0, settledThroughIndex),
    ...(typeof raw.settledPrefixFingerprint === 'string' && raw.settledPrefixFingerprint
      ? { settledPrefixFingerprint: raw.settledPrefixFingerprint }
      : {}),
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt >= 0 ? raw.updatedAt : 0,
    revisions: {
      hooks: Math.max(0, readIndex_ACU(revisions.hooks)),
      infoGap: Math.max(0, readIndex_ACU(revisions.infoGap)),
      constraints: Math.max(0, readIndex_ACU(revisions.constraints)),
      storyArc: Math.max(0, readIndex_ACU(revisions.storyArc)),
      chronology: Math.max(0, readIndex_ACU(revisions.chronology)),
      webRefs: Math.max(0, readIndex_ACU(revisions.webRefs)),
      userRequirements: Math.max(0, readIndex_ACU(revisions.userRequirements)),
    },
    hooks: pick(raw.hooks, validateHookEntry_ACU, 'hooks'),
    infoGap: pick(raw.infoGap, validateInfoGapEntry_ACU, 'infoGap'),
    constraints: pick(raw.constraints, validateConstraintEntry_ACU, 'constraints'),
    storyArc: pick(raw.storyArc, validateStoryArcEntry_ACU, 'storyArc'),
    chronology: pick(raw.chronology, validateChronologyEntry_ACU, 'chronology'),
    webRefs: pick(raw.webRefs, validateWebRefEntry_ACU, 'webRefs'),
    userRequirements: pick(raw.userRequirements, validateUserRequirementLine_ACU, 'userRequirements'),
    pendingFixes: pendingFixes ?? [],
  };
  return { snapshot, problems };
}

/** 一次读取的诊断：哪些楼层带有资料字段、基线在哪一楼、折叠了多少 delta。 */
export interface AgentModuleSnapshotReadDiagnostics_ACU {
  /** 带资料字段的楼层（从头到尾）。 */
  candidates: Array<{ index: number; valid: boolean; problems: string[] }>;
  /** 当前基线所在楼层；无基线时为 null。 */
  adoptedIndex: number | null;
  /** 采用的是否为宽容抢救结果。 */
  salvaged: boolean;
  /** 生效 schema 3 / legacy 基线的楼层。 */
  checkpointIndex: number | null;
  /** 基线之后实际叠加上的 delta 数。 */
  foldedDeltaCount: number;
}

let lastReadDiagnostics_ACU: AgentModuleSnapshotReadDiagnostics_ACU = {
  candidates: [],
  adoptedIndex: null,
  salvaged: false,
  checkpointIndex: null,
  foldedDeltaCount: 0,
};

export function agentModuleFrameDeps_ACU(): AgentModuleFrameDeps_ACU {
  return {
    validateSnapshot: validateAgentModuleSnapshot_ACU,
    salvageSnapshot: salvageAgentModuleSnapshot_ACU,
    emptySnapshot: buildEmptyAgentModuleSnapshot_ACU,
    isSnapshotPrefixCompatible: (snapshot, chat) => isChatPrefixCompatible_ACU(snapshot, chat as any[]),
  };
}

/** 最近一次 readAgentModuleSnapshot_ACU 的诊断信息，供面板解释“为什么资料是空的/是旧的”。 */
export function readAgentModuleSnapshotDiagnostics_ACU(): AgentModuleSnapshotReadDiagnostics_ACU {
  return lastReadDiagnostics_ACU;
}

/**
 * 读取当前生效的资料快照。
 * 从最近的 checkpoint 起按楼层顺序叠加当前 swipe 的 delta。全程无合法基线但存在损坏快照时，
 * 对最靠近末楼的一份做宽容抢救并记录诊断——数据消失必须可解释。水位不再按数组长度钳制。
 * P1 前缀指纹门控保留在折叠基线采纳环节（deps 注入）：水位前的删楼/替换使基线失配即跳过。
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 折叠后的快照；没有任何资料时返回 settledThroughIndex = -1 的空快照
 */
export function readAgentModuleSnapshot_ACU(chat?: any[]): AgentModuleSnapshot_ACU {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const folded = foldAgentModuleSnapshot_ACU(messages, agentModuleFrameDeps_ACU());
  lastReadDiagnostics_ACU = {
    candidates: folded.candidates,
    adoptedIndex: folded.adoptedIndex,
    salvaged: folded.salvaged,
    checkpointIndex: folded.checkpointIndex,
    foldedDeltaCount: folded.foldedDeltaCount,
  };
  if (folded.salvaged) {
    console.warn(`[SP·数据库][续写资料] 楼层 ${folded.adoptedIndex} 的资料快照未通过严格校验，已按宽容模式读取：${folded.candidates.find(item => item.index === folded.adoptedIndex)?.problems.join('；') ?? ''}`);
  }
  return folded.snapshot;
}

/**
 * 读取当前生效资料的分栏视图（模块 → ID → 栏目）。
 * 与 readAgentModuleSnapshot_ACU 同一次折叠：完整领域数组仍只来自整条 writes；
 * 逐栏 delta 提交的 partial 记录只出现在本视图，不进入领域数组。
 */
export function readAgentModuleFieldSnapshot_ACU(chat?: any[]): AgentModuleFieldSnapshot_ACU {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const folded = foldAgentModuleSnapshot_ACU(messages, agentModuleFrameDeps_ACU());
  lastReadDiagnostics_ACU = {
    candidates: folded.candidates,
    adoptedIndex: folded.adoptedIndex,
    salvaged: folded.salvaged,
    checkpointIndex: folded.checkpointIndex,
    foldedDeltaCount: folded.foldedDeltaCount,
  };
  return folded.fields;
}

/**
 * 把快照写入指定楼层并真实提交到宿主（帧增量）。
 *
 * 结算水位以快照自带的 settledThroughIndex 为准，只做合法性钳制（0 ≤ 水位 ≤ 承载楼层）：
 * 写盘不推水位——立总纲、用户手动保存都不代表未结算正文被结算过，水位推进只由
 * 结算派工成功后显式设置。P1 两项加固原样保留：前缀指纹失配拒绝写入；修订号乐观锁
 * 复核（任一类楼层比写入新即放弃落盘）。
 * @param chat 聊天数组
 * @param targetIndex 承载快照的楼层下标，通常是当前末楼
 * @param snapshot 待写入的全量快照
 */
export async function writeAgentModuleSnapshot_ACU(chat: any[], targetIndex: number, snapshot: AgentModuleSnapshot_ACU): Promise<void> {
  const message = Array.isArray(chat) ? chat[targetIndex] : null;
  if (!message || typeof message !== 'object') {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', 'Agent 资料快照的目标楼层不可用', false, { targetIndex }));
  }
  const settledThroughIndex = Math.min(Math.max(snapshot.settledThroughIndex, 0), targetIndex);
  if (snapshot.settledPrefixFingerprint && snapshot.settledPrefixFingerprint !== chatPrefixFingerprint_ACU(chat, settledThroughIndex)) {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU(
      'CONTINUATION_AGENT_SNAPSHOT_INVALID',
      'agent_persist',
      '资料快照引用的聊天前缀已变化，拒绝写入以避免删楼后按旧下标结算',
      false,
      { targetIndex, settledThroughIndex },
    ));
  }
  // 乐观锁复核：在飞 turn 的快照基准是它开始时读到的楼层修订号；期间用户手动保存会把六类
  // 修订号整体 +1（replaceAgentModuleSnapshotByUser_ACU），旧基准整份写入会静默冲掉用户内容。
  // 落盘前重读当前生效快照，任一类「楼层比写入快照新」即放弃落盘并记日志；正常路径零影响。
  const revisionDrifts: string[] = [];
  const floorSnapshot = readAgentModuleSnapshot_ACU(chat);
  const revisionPairs: Array<[string, number, number]> = [
    ['hooks', floorSnapshot.revisions.hooks, snapshot.revisions.hooks],
    ['infoGap', floorSnapshot.revisions.infoGap, snapshot.revisions.infoGap],
    ['constraints', floorSnapshot.revisions.constraints, snapshot.revisions.constraints],
    ['storyArc', floorSnapshot.revisions.storyArc, snapshot.revisions.storyArc],
    ['chronology', floorSnapshot.revisions.chronology, snapshot.revisions.chronology],
    ['webRefs', floorSnapshot.revisions.webRefs, snapshot.revisions.webRefs],
    ['userRequirements', floorSnapshot.revisions.userRequirements, snapshot.revisions.userRequirements],
  ];
  for (const [name, floorRevision, incomingRevision] of revisionPairs) {
    if (floorRevision > incomingRevision) revisionDrifts.push(`${name} 楼层=${floorRevision} 写入=${incomingRevision}`);
  }
  if (revisionDrifts.length > 0) {
    console.warn(`[SP·数据库][续写资料] 检测到楼层快照修订号已被外部更新（疑似用户手动保存），放弃本次写入防止整份覆盖：${revisionDrifts.join('；')}（目标楼层 ${targetIndex}）`);
    throw new ContinuationValidationError_ACU(createContinuationError_ACU(
      'CONTINUATION_AGENT_WRITE_REJECTED',
      'agent_persist',
      '资料快照修订号已漂移，写入被拒绝以停止当前结算',
      false,
      { targetIndex, revisionDrifts },
    ));
  }
  const stamped: AgentModuleSnapshot_ACU = {
    ...snapshot,
    settledThroughIndex,
    settledPrefixFingerprint: snapshot.settledPrefixFingerprint ?? chatPrefixFingerprint_ACU(chat, settledThroughIndex),
  };
  const plan = planAgentModuleSnapshotWrite_ACU(
    chat,
    targetIndex,
    stamped,
    agentModuleFrameDeps_ACU(),
    findLatestTableFullCheckpointIndex_ACU(chat),
  );
  if (!plan.changed) return;
  try {
    for (const assignment of plan.assignments) {
      const container = chat[assignment.index] as Record<string, unknown>;
      if (assignment.value === undefined) delete container[AGENT_MODULE_FIELD_ACU];
      else container[AGENT_MODULE_FIELD_ACU] = assignment.value;
    }
    await saveChatToHostStrict_ACU();
  } catch (error) {
    for (const assignment of plan.assignments) {
      const container = chat[assignment.index] as Record<string, unknown>;
      if (assignment.existed) container[AGENT_MODULE_FIELD_ACU] = assignment.previous;
      else delete container[AGENT_MODULE_FIELD_ACU];
    }
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', 'Agent 资料快照写盘失败，已还原楼层字段', false, { targetIndex, message: error instanceof Error ? error.message : String(error) }));
  }
}

/**
 * 把逐栏写集作为一条 fieldUpserts delta 写入目标楼层并真实提交到宿主。
 * 不触碰领域数组：缺栏记录只进入受控分栏视图（readAgentModuleFieldSnapshot_ACU），
 * 完整条目仍由整条 writes 路径投影。宿主保存失败时逐楼还原，不报“已写入”。
 */
export async function writeAgentModuleFields_ACU(chat: any[], targetIndex: number, fieldUpserts: AgentModuleFieldUpserts_ACU): Promise<boolean> {
  const message = Array.isArray(chat) ? chat[targetIndex] : null;
  if (!message || typeof message !== 'object') {
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', 'Agent 逐栏写入的目标楼层不可用', false, { targetIndex }));
  }
  const plan = planAgentModuleFieldWrite_ACU(chat, targetIndex, fieldUpserts, agentModuleFrameDeps_ACU());
  if (!plan.changed) return false;
  try {
    for (const assignment of plan.assignments) {
      const container = chat[assignment.index] as Record<string, unknown>;
      if (assignment.value === undefined) delete container[AGENT_MODULE_FIELD_ACU];
      else container[AGENT_MODULE_FIELD_ACU] = assignment.value;
    }
    await saveChatToHostStrict_ACU();
    return true;
  } catch (error) {
    for (const assignment of plan.assignments) {
      const container = chat[assignment.index] as Record<string, unknown>;
      if (assignment.existed) container[AGENT_MODULE_FIELD_ACU] = assignment.previous;
      else delete container[AGENT_MODULE_FIELD_ACU];
    }
    throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', 'Agent 逐栏写入写盘失败，已还原楼层字段', false, { targetIndex, message: error instanceof Error ? error.message : String(error) }));
  }
}

/**
 * 一次性折叠快照与分栏视图，并保留损坏帧的结构化诊断供提交门禁使用。
 * （S11-TT：$FIELD 权威读取与融合提交共用同一折叠入口。）
 */
export function readAgentModuleFoldState_ACU(chat: any[]): AgentModuleFoldResult_ACU {
  return foldAgentModuleSnapshot_ACU(chat, agentModuleFrameDeps_ACU());
}

/** 本次派工抓取成功的网页句柄；不得由模型自行指定来源 URL。 */
export interface AgentFieldPage_ACU {
  title: string;
  source: AgentWebRefEntry_ACU['source'];
  url: string;
  query: string;
  sourceStatus: AgentWebRefEntry_ACU['sourceStatus'];
}

export interface AgentModuleFieldAccepted_ACU { module: AgentWritableModule_ACU; id: string; field: string; revision: number }

export interface AgentModuleFieldReceipt_ACU {
  status: 'committed' | 'rejected' | 'persist_failed' | 'readback_failed';
  accepted: AgentModuleFieldAccepted_ACU[];
  rejected: AgentModuleSqlFieldRejection_ACU[];
  /** null 表示保存/补偿后的当前状态无法确认；必须重新读取权威帧。 */
  partials: Array<{ module: AgentWritableModule_ACU; id: string; missingFields: string[]; promotionError?: string }> | null;
  revisions: AgentModuleSnapshot_ACU['revisions'] | null;
  constraintProposals: string[];
  sqlDiagnostics?: string;
  recovery?: 'saved' | 'failed' | 'unavailable';
}

type FieldCommitModule_ACU = 'hooks' | 'infoGap' | 'storyArc' | 'chronology' | 'webRefs';

const FIELD_COMMIT_ROLE_MODULES_ACU: Readonly<Partial<Record<AgentSubagentName_ACU, readonly AgentWritableModule_ACU[]>>> = {
  'arc-architect': ['storyArc'],
  'hook-cognition-maintainer': ['hooks', 'infoGap', 'chronology'],
  'web-researcher': ['webRefs'],
};

function fieldCommitText_ACU(value: unknown): value is string { return typeof value === 'string'; }
function fieldCommitNonempty_ACU(value: unknown): boolean { return fieldCommitText_ACU(value) && !!value.trim(); }
function fieldCommitIndex_ACU(value: unknown): boolean { return typeof value === 'number' && Number.isInteger(value) && value >= 0; }
function fieldCommitStringArray_ACU(value: unknown): boolean { return Array.isArray(value) && value.every(fieldCommitNonempty_ACU); }
function fieldCommitRecord_ACU(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function fieldCommitInList_ACU(value: unknown, list: readonly string[]): boolean { return fieldCommitText_ACU(value) && list.includes(value); }

/** 显式栏目逐栏校验；null、合法空值与缺栏不可混淆。 */
function fieldCommitProblem_ACU(module: FieldCommitModule_ACU, field: string, value: unknown, snapshot: AgentModuleSnapshot_ACU, evidence: ReadonlySet<number>): string | null {
  switch (module) {
    case 'hooks':
      if (field === 'status') return fieldCommitInList_ACU(value, AGENT_HOOK_STATUSES_ACU) ? null : 'status 枚举非法';
      if (field === 'importance') return fieldCommitInList_ACU(value, AGENT_HOOK_IMPORTANCES_ACU) ? null : 'importance 枚举非法';
      if (field === 'plantedIndex') return fieldCommitIndex_ACU(value) && (value as number) <= snapshot.settledThroughIndex && evidence.has(value as number) ? null : 'plantedIndex 必须引用已结算正文楼层';
      return field === 'summary' ? (fieldCommitNonempty_ACU(value) ? null : 'summary 必须为非空文本') : (fieldCommitText_ACU(value) ? null : '必须为字符串');
    case 'infoGap':
      if (field === 'revealStatus') return fieldCommitInList_ACU(value, AGENT_REVEAL_STATUSES_ACU) ? null : 'revealStatus 枚举非法';
      if (field === 'revealIndex') return value === null || (fieldCommitIndex_ACU(value) && (value as number) <= snapshot.settledThroughIndex && evidence.has(value as number)) ? null : 'revealIndex 必须为空或已结算正文楼层';
      if (field === 'characterKnowledge') return Array.isArray(value) && value.every(item => fieldCommitRecord_ACU(item) && fieldCommitNonempty_ACU(item.name) && fieldCommitText_ACU(item.knows)) ? null : 'characterKnowledge 需要带 name / knows 的数组';
      return field === 'topic' ? (fieldCommitNonempty_ACU(value) ? null : 'topic 必须为非空文本') : (fieldCommitText_ACU(value) ? null : '必须为字符串');
    case 'chronology':
      if (field === 'precision') return fieldCommitInList_ACU(value, AGENT_CHRONOLOGY_PRECISIONS_ACU) ? null : 'precision 枚举非法';
      if (field === 'evidenceIndexes') {
        const indexes = normalizeEvidenceIndexes_ACU(value);
        return indexes?.length && indexes.every(item => item <= snapshot.settledThroughIndex && evidence.has(item)) ? null : 'evidenceIndexes 必须是非空、已结算正文楼层数组';
      }
      return fieldCommitNonempty_ACU(value) ? null : '时间事实栏目必须为非空文本';
    case 'storyArc':
      if (field === 'scope') return fieldCommitInList_ACU(value, AGENT_STORY_ARC_SCOPES_ACU) ? null : 'scope 枚举非法';
      if (field === 'status') return fieldCommitInList_ACU(value, AGENT_STORY_ARC_STATUSES_ACU) ? null : 'status 枚举非法';
      if (field === 'narrativeRole') return fieldCommitInList_ACU(value, AGENT_VOLUME_NARRATIVE_ROLES_ACU) ? null : 'narrativeRole 枚举非法';
      if (field === 'stageNumbers') return Array.isArray(value) && value.every(item => Number.isInteger(item) && item >= 1) ? null : 'stageNumbers 必须是正整数数组';
      if (field === 'completionStageNumber') return value === null || (Number.isInteger(value) && (value as number) >= 1) ? null : 'completionStageNumber 必须为正整数或 null';
      if (field === 'targetStageRange') return fieldCommitRecord_ACU(value) && Number.isInteger(value.min) && (value.min as number) >= 1 && Number.isInteger(value.max) && (value.max as number) >= (value.min as number) ? null : 'targetStageRange 需要 min/max 正整数且 max≥min';
      if (field === 'sustainingThreads' || field === 'payoffTargets') return fieldCommitStringArray_ACU(value) ? null : '必须是非空字符串数组';
      return ['title', 'direction'].includes(field) ? (fieldCommitNonempty_ACU(value) ? null : '必须为非空文本') : (fieldCommitText_ACU(value) ? null : '必须为字符串');
    case 'webRefs':
      if (field === 'tags') return Array.isArray(value) && value.every(fieldCommitNonempty_ACU) ? null : 'tags 必须是非空字符串数组';
      return ['title', 'brief'].includes(field) ? (fieldCommitNonempty_ACU(value) ? null : '必须为非空文本') : (fieldCommitText_ACU(value) ? null : '必须为字符串');
  }
}

function fieldCommitDomainRow_ACU(snapshot: AgentModuleSnapshot_ACU, module: FieldCommitModule_ACU, id: string): Record<string, unknown> | null {
  return (snapshot[module] as unknown as Array<Record<string, unknown>>).find(item => item.id === id) ?? null;
}

function fieldCommitCanonical_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fieldCommitCanonical_ACU).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${fieldCommitCanonical_ACU(row[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fieldCommitConfirmedPartials_ACU(fields: AgentModuleFieldSnapshot_ACU): NonNullable<AgentModuleFieldReceipt_ACU['partials']> {
  const partials: NonNullable<AgentModuleFieldReceipt_ACU['partials']> = [];
  for (const module of ['hooks', 'infoGap', 'storyArc', 'chronology', 'webRefs'] as const) {
    for (const [id, record] of Object.entries(fields.records[module] ?? {})) {
      if (record.status !== 'partial') continue;
      partials.push({ module, id, missingFields: [...record.missingFields] });
    }
  }
  return partials;
}

function fieldCommitNextWebRefId_ACU(snapshot: AgentModuleSnapshot_ACU, taken: ReadonlySet<string>): string {
  let max = 0;
  for (const id of [...snapshot.webRefs.map(entry => entry.id), ...taken]) {
    const matched = /^WR-(\d+)$/.exec(id);
    if (matched) max = Math.max(max, Number.parseInt(matched[1], 10));
  }
  return `WR-${String(max + 1).padStart(3, '0')}`;
}

const fieldCommitQueue_ACU = new WeakMap<unknown[], Promise<void>>();

/**
 * 融合提交（S11-TT 双模 Mode F 生产入口）。
 *
 * 上游 agent-module-field-commit.ts 在此拆解并入现有帧/plan 路径，不另起文件、
 * 不另起写旁路：解析走受限 SQL 白名单（protocol），栏目校验走领域规则（本函数内
 * fieldCommitProblem_ACU，与事务层同强度），复算走 SQL 分栏层（只校验不持久化），
 * 持久化唯一形态是帧内 fieldUpserts delta（planAgentModuleFieldWrite_ACU），并受
 * P1 三门约束——聊天身份/目标楼层门、帧损坏门、保存前后基线/折叠回读门。
 * 有意不移植上游的领域提升（domainUpserts）：T2 锁定 partial/complete 均不投影
 * 领域数组，完整条目只由整条 writes 路径产生；删除既有领域条目同样不支持，
 * 请走整行 retire。
 */
export function commitAgentModuleFieldWrites_ACU(input: {
  chat: any[];
  targetIndex: number;
  sql: string;
  role: AgentSubagentName_ACU;
  resolvePage?: (handle: string) => AgentFieldPage_ACU | null;
  isCurrent?: () => boolean;
}): Promise<AgentModuleFieldReceipt_ACU> {
  const prior = fieldCommitQueue_ACU.get(input.chat) ?? Promise.resolve();
  const run = prior.catch(() => {}).then(async (): Promise<AgentModuleFieldReceipt_ACU> => {
    const parsed = parseAgentModuleSqlFieldWrites_ACU(input.sql, input.role);
    const folded = readAgentModuleFoldState_ACU(input.chat);
    const receipt: AgentModuleFieldReceipt_ACU = {
      status: 'rejected', accepted: [], rejected: [...parsed.rejected],
      partials: fieldCommitConfirmedPartials_ACU(folded.fields),
      revisions: { ...folded.snapshot.revisions }, constraintProposals: parsed.constraintProposals,
    };
    if (input.isCurrent?.() === false || getChatArray_ACU() !== input.chat
      || !input.chat[input.targetIndex] || (input.chat[input.targetIndex] as { is_user?: unknown }).is_user === true
      || input.targetIndex !== input.chat.length - 1) {
      receipt.rejected.push({ path: 'chat', reason: '当前聊天或目标楼层已变化' });
      receipt.partials = null; receipt.revisions = null; return receipt;
    }
    if (folded.salvaged || folded.candidates.some(item => !item.valid)) {
      receipt.rejected.push({ path: 'frame', reason: '资料帧损坏，拒绝在宽容抢救结果上写入' });
      receipt.partials = null; receipt.revisions = null; return receipt;
    }
    const evidence = new Set<number>();
    input.chat.forEach((message, index) => {
      if (message && typeof message === 'object' && (message as { is_user?: unknown }).is_user !== true) evidence.add(index);
    });
    const now = Date.now();
    const modules = FIELD_COMMIT_ROLE_MODULES_ACU[input.role] ?? [];
    const upserts: AgentModuleFieldUpserts_ACU = {};
    const accepted: AgentModuleFieldAccepted_ACU[] = [];
    const reserved = new Set<string>();
    for (const intent of parsed.intents) {
      const module = intent.module as FieldCommitModule_ACU;
      const path = `${module}#${intent.id || '(无 ID)'}`;
      if (!modules.includes(intent.module)) { receipt.rejected.push({ path, reason: '角色无权写入该模块' }); continue; }
      if (intent.kind === 'delete') { receipt.rejected.push({ path, reason: 'TT 逐栏路径不支持删除/退役：既有条目请走整行 retire，草稿请逐栏 unset' }); continue; }
      const id = intent.id || (module === 'webRefs' && intent.kind === 'insert'
        ? fieldCommitNextWebRefId_ACU(folded.snapshot, new Set([...reserved, ...Object.keys(folded.fields.records.webRefs ?? {})])) : '');
      if (!id || id.includes('#') || ['__proto__', 'prototype', 'constructor'].includes(id) || id.length > 128) {
        receipt.rejected.push({ path, reason: '条目 ID 无效' }); continue;
      }
      if (intent.expectedRevision !== folded.snapshot.revisions[module]) {
        receipt.rejected.push({ path, reason: `revision_conflict: expected=${intent.expectedRevision}, actual=${folded.snapshot.revisions[module]}` }); continue;
      }
      const key = `${module}#${id}`;
      const existing = fieldCommitDomainRow_ACU(folded.snapshot, module, id);
      const record = folded.fields.records[module]?.[id];
      if (intent.kind === 'insert' && (existing || record || reserved.has(key))) { receipt.rejected.push({ path, reason: 'id_exists' }); continue; }
      if (intent.kind !== 'insert' && !existing && !record) { receipt.rejected.push({ path, reason: 'not_found' }); continue; }
      if (existing?.retired) { receipt.rejected.push({ path, reason: 'retired: 已退役条目不可修改' }); continue; }
      const writable: Record<string, unknown> = {};
      for (const [field, raw] of Object.entries(intent.fields)) {
        const fieldPath = `${path}.${field}`;
        if (!AGENT_MODULE_FIELD_MATRIX_ACU[module].fields.includes(field) || ['retired', 'retiredReason', 'updatedIndex', 'fetchedAt', 'source', 'url', 'query', 'sourceStatus'].includes(field)) {
          receipt.rejected.push({ path: fieldPath, reason: 'field_forbidden' }); continue;
        }
        if ((field === 'plantedIndex' && existing) || (field === 'scope' && existing && existing.scope !== raw)) {
          receipt.rejected.push({ path: fieldPath, reason: '已登记的不可变栏目不能改写' }); continue;
        }
        const problem = fieldCommitProblem_ACU(module, field, raw, folded.snapshot, evidence);
        if (problem) { receipt.rejected.push({ path: fieldPath, reason: problem }); continue; }
        writable[field] = raw;
      }
      if (intent.pageRef) {
        if (module !== 'webRefs') receipt.rejected.push({ path: `${path}.pageRef`, reason: 'field_forbidden' });
        else {
          const page = input.resolvePage?.(intent.pageRef) ?? null;
          if (!page || page.sourceStatus !== 'ok' || !fieldCommitNonempty_ACU(page.url) || !fieldCommitNonempty_ACU(page.title)) {
            receipt.rejected.push({ path: `${path}.pageRef`, reason: '页面句柄未在本次派工成功抓取' });
          } else {
            const urlProblem = fieldCommitProblem_ACU(module, 'title', page.title, folded.snapshot, evidence);
            if (urlProblem) receipt.rejected.push({ path: `${path}.pageRef`, reason: urlProblem });
            else {
              writable.title = writable.title ?? page.title.trim();
              (writable as Record<string, unknown>).__pageUrl_ACU = page.url.trim();
            }
          }
        }
      }
      if (!Object.keys(writable).length) continue;
      if (module === 'infoGap' && (Object.prototype.hasOwnProperty.call(writable, 'revealStatus') || Object.prototype.hasOwnProperty.call(writable, 'revealIndex'))) {
        const baseline: Record<string, unknown> = existing ? { ...existing } : Object.fromEntries(Object.entries(record?.fields ?? {}).map(([field, entry]) => [field, entry.value]));
        const merged = { ...baseline, ...writable };
        if (merged.revealStatus !== undefined && (merged.revealIndex !== undefined || !!existing)) {
          const status = merged.revealStatus;
          const reveal = merged.revealIndex ?? null;
          if ((status === 'unrevealed' && reveal !== null) || (status !== 'unrevealed' && reveal === null)) {
            for (const field of ['revealStatus', 'revealIndex']) if (Object.prototype.hasOwnProperty.call(writable, field)) {
              receipt.rejected.push({ path: `${path}.${field}`, reason: 'consistency_group: 揭示状态与楼层必须一致' }); delete writable[field];
            }
          }
        }
      }
      if (!Object.keys(writable).length) continue;
      const bucket = (upserts[module] ??= {});
      const cell = (bucket[id] ??= {});
      for (const [field, value] of Object.entries(writable)) {
        if (field === '__pageUrl_ACU') continue;
        cell[field] = { value };
        accepted.push({ module, id, field, revision: 0 });
      }
      // pageRef 回填的 url 随 title 同批落栏（来源仍以工具回执为准，不信任模型手写）。
      if (typeof (writable as Record<string, unknown>).__pageUrl_ACU === 'string') {
        cell.url = { value: (writable as Record<string, unknown>).__pageUrl_ACU as string };
        accepted.push({ module, id, field: 'url', revision: 0 });
      }
      if (intent.kind === 'insert') reserved.add(key);
    }
    if (!Object.keys(upserts).length) return receipt;
    // SQL 分栏层复算门：白名单/乐观锁与帧侧同强度；失败即整批拒绝，不落帧。
    let view: Awaited<ReturnType<typeof materializeAgentModuleSqlView_ACU>> | undefined;
    try {
      view = await materializeAgentModuleSqlView_ACU(folded.snapshot, folded.fields);
      for (const [moduleKey, bucket] of Object.entries(upserts)) {
        const module = moduleKey as AgentWritableModule_ACU;
        view.applyFieldBatch({ module, expectedRevision: folded.snapshot.revisions[module], updatedAt: now, fieldWrites: bucket as Record<string, Record<string, { value?: unknown; unset?: boolean }>> });
      }
      const exported = view.exportDelta();
      for (const [moduleKey, bucket] of Object.entries(upserts)) {
        const got = (exported.fieldUpserts as Record<string, Record<string, Record<string, unknown>>> | undefined)?.[moduleKey];
        if (fieldCommitCanonical_ACU(got ?? null) !== fieldCommitCanonical_ACU(bucket)) {
          throw new Error(`模块 ${moduleKey} 的 SQL 分栏复算与计划写集不一致`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      receipt.rejected.push({ path: 'sql', reason: message });
      receipt.sqlDiagnostics = message;
      return receipt;
    } finally { view?.dispose(); }
    // 帧持久化门：基线快照 + 规划 + 保存 + 折叠回读，三者任一失败即补偿还原。
    const asJson = (value: unknown): string | undefined => JSON.stringify(value);
    const baselineIdentity = getActiveChatStorageIdentity_ACU(input.chat);
    const baselineFloors = input.chat.map(message => ({
      message,
      swipeId: readMessageSwipeId_ACU(message),
      existed: !!message && typeof message === 'object' && Object.prototype.hasOwnProperty.call(message, AGENT_MODULE_FIELD_ACU),
      content: asJson((message as Record<string, unknown> | null)?.[AGENT_MODULE_FIELD_ACU]),
    }));
    const plan = planAgentModuleFieldWrite_ACU(input.chat, input.targetIndex, upserts, agentModuleFrameDeps_ACU());
    if (!plan.changed) {
      receipt.rejected.push({ path: 'frame', reason: '资料帧未能规划出可回读的写入' });
      return receipt;
    }
    try {
      for (const assignment of plan.assignments) {
        const container = input.chat[assignment.index] as Record<string, unknown>;
        if (assignment.value === undefined) delete container[AGENT_MODULE_FIELD_ACU];
        else container[AGENT_MODULE_FIELD_ACU] = assignment.value;
      }
      await saveChatToHostStrict_ACU();
    } catch (error) {
      for (const assignment of plan.assignments) {
        const container = input.chat[assignment.index] as Record<string, unknown>;
        if (assignment.existed) container[AGENT_MODULE_FIELD_ACU] = assignment.previous;
        else delete container[AGENT_MODULE_FIELD_ACU];
      }
      receipt.status = 'persist_failed';
      receipt.recovery = 'unavailable';
      receipt.partials = null; receipt.revisions = null;
      receipt.rejected.push({ path: 'host', reason: error instanceof Error ? error.message : String(error) });
      return receipt;
    }
    // 保存后回读门：聊天身份/基线楼层未被顶替，且逐栏记录可读回。
    const intact = getChatArray_ACU() === input.chat && getActiveChatStorageIdentity_ACU(input.chat) === baselineIdentity
      && input.chat.length === baselineFloors.length && baselineFloors.every((entry, index) => {
        if (index === input.targetIndex) return input.chat[index] === entry.message && readMessageSwipeId_ACU(entry.message) === entry.swipeId;
        return input.chat[index] === entry.message && readMessageSwipeId_ACU(entry.message) === entry.swipeId
          && (Object.prototype.hasOwnProperty.call(entry.message as object, AGENT_MODULE_FIELD_ACU) === entry.existed)
          && asJson(((entry.message as Record<string, unknown>)[AGENT_MODULE_FIELD_ACU])) === entry.content;
      });
    const confirmed = readAgentModuleFoldState_ACU(input.chat);
    const expectedRecords = new Map<string, AgentModuleFieldRecord_ACU | null>();
    for (const [moduleKey, bucket] of Object.entries(upserts)) {
      for (const id of Object.keys(bucket)) {
        expectedRecords.set(`${moduleKey}#${id}`, confirmed.fields.records[moduleKey as AgentWritableModule_ACU]?.[id] ?? null);
      }
    }
    const readable = [...expectedRecords.values()].every(item => item !== null)
      && !confirmed.salvaged && confirmed.candidates.every(item => item.valid);
    if (!intact || !readable || input.isCurrent?.() === false) {
      receipt.status = 'readback_failed';
      receipt.recovery = 'saved';
      receipt.rejected.push({ path: 'host', reason: '保存成功但回读未能确认逐栏记录' });
      return receipt;
    }
    receipt.status = 'committed';
    receipt.revisions = confirmed.snapshot.revisions;
    receipt.partials = fieldCommitConfirmedPartials_ACU(confirmed.fields);
    receipt.accepted = accepted.map(item => ({ ...item, revision: confirmed.fields.records[item.module]?.[item.id]?.fields[item.field]?.revision ?? 0 }));
    return receipt;
  });
  fieldCommitQueue_ACU.set(input.chat, run.then(() => {}, () => {}));
  return run;
}

function rejectSnapshotEdit_ACU(message: string, details?: Record<string, unknown>): never {
  throw new ContinuationValidationError_ACU(createContinuationError_ACU('CONTINUATION_AGENT_SNAPSHOT_INVALID', 'agent_persist', message, false, details));
}

/**
 * 用户手动改写资料快照。
 *
 * 与子代理写入的关键区别是「不容忍静默丢条目」：校验器为了容错会丢掉结构非法的单条记录，
 * 那对模型输出是合理的降级，但对用户编辑是数据丢失——用户会以为自己保存成功了。因此这里
 * 逐类比对条目数，只要有条目被丢弃就整份拒绝并指出是哪一类。
 * @param raw 用户编辑后的快照对象（可只带 hooks / infoGap / constraints / storyArc）
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 落盘后的快照
 */
export async function replaceAgentModuleSnapshotByUser_ACU(raw: unknown, chat?: any[]): Promise<AgentModuleSnapshot_ACU> {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  const targetIndex = messages.length - 1;
  if (targetIndex < 0) rejectSnapshotEdit_ACU('当前聊天没有可承载资料快照的楼层');
  if (!isRecord_ACU(raw)) rejectSnapshotEdit_ACU('资料快照必须是 JSON 对象');
  const current = readAgentModuleSnapshot_ACU(messages);
  const merged = {
    ...current,
    ...raw,
    schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
    // 手动保存不推进结算水位：用户改资料不代表未结算正文被结算过。保留现有水位，
    // 新聊天的 -1 钳制为 0（校验器拒绝负值），上限钳制交给写盘函数。
    settledThroughIndex: Math.max(current.settledThroughIndex, 0),
    // 手动编辑同样推进修订号：否则携带旧修订号的子代理写集会通过并覆盖用户刚保存的内容。
    revisions: {
      hooks: current.revisions.hooks + 1,
      infoGap: current.revisions.infoGap + 1,
      constraints: current.revisions.constraints + 1,
      storyArc: current.revisions.storyArc + 1,
      chronology: current.revisions.chronology + 1,
      webRefs: current.revisions.webRefs + 1,
      userRequirements: current.revisions.userRequirements + 1,
    },
  };
  const validated = validateAgentModuleSnapshot_ACU(merged);
  if (!validated) rejectSnapshotEdit_ACU('资料快照结构非法：hooks / infoGap / constraints 必须是数组；storyArc / chronology 一旦提供必须整体结构合法（chronology 每条需要非空 id/anchor/elapsed/transition、合法 precision、非空非负整数 evidenceIndexes 与非负 updatedIndex，retire 需给理由）');
  const checks: Array<[string, unknown, readonly unknown[]]> = [
    ['伏笔账本 hooks', merged.hooks, validated.hooks],
    ['信息差 infoGap', merged.infoGap, validated.infoGap],
    ['长期约束 constraints', merged.constraints, validated.constraints],
    ['故事总纲 storyArc', merged.storyArc, validated.storyArc],
    ['故事年代学账本 chronology', merged.chronology, validated.chronology],
    ['百科资料库 webRefs', merged.webRefs, validated.webRefs],
    ['用户要求 userRequirements', merged.userRequirements, validated.userRequirements],
  ];
  for (const [label, input, accepted] of checks) {
    const inputLength = Array.isArray(input) ? input.length : 0;
    if (inputLength !== accepted.length) {
      rejectSnapshotEdit_ACU(`${label} 中有 ${inputLength - accepted.length} 条记录不符合结构要求（id 与关键文本字段不能为空），整份编辑未保存`, { label, inputLength, acceptedLength: accepted.length });
    }
  }
  await writeAgentModuleSnapshot_ACU(messages, targetIndex, validated);
  return validated;
}

/**
 * 从全部楼层清除资料快照字段。用于「一键清空」，只删扩展字段，绝不触碰正文。
 * @param chat 聊天数组，缺省取当前聊天
 * @returns 是否有楼层被改动
 */
export async function clearAgentModuleField_ACU(chat?: any[]): Promise<boolean> {
  const messages = Array.isArray(chat) ? chat : getChatArray_ACU();
  let changed = false;
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(message, AGENT_MODULE_FIELD_ACU)) continue;
    delete (message as Record<string, unknown>)[AGENT_MODULE_FIELD_ACU];
    changed = true;
  }
  if (changed) await saveChatToHostStrict_ACU();
  return changed;
}

function truncateAgentBlock_ACU(text: string): string {
  if (text.length <= AGENT_BLOCK_CHAR_LIMIT_ACU) return text;
  return `${text.slice(0, AGENT_BLOCK_CHAR_LIMIT_ACU)}\n（本资料块超出 ${AGENT_BLOCK_CHAR_LIMIT_ACU} 字上限，已截断；未展示部分不代表不存在）`;
}

function compareHooks_ACU(left: AgentHookEntry_ACU, right: AgentHookEntry_ACU): number {
  const weight = (IMPORTANCE_WEIGHTS_ACU[right.importance] ?? 0) - (IMPORTANCE_WEIGHTS_ACU[left.importance] ?? 0);
  return weight !== 0 ? weight : right.plantedIndex - left.plantedIndex;
}

/**
 * 渲染伏笔账本的热上下文。
 * @param snapshot 当前快照
 * @returns 自然语言文本；活跃条目超过上限时如实标注未展示数量
 */
export function renderAgentHooksLedger_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  // 修订号必须放在首行：材料超长被截断时也不会丢失并发校验依据。
  const head = `当前修订号=${snapshot.revisions.hooks}`;
  const active = snapshot.hooks.filter(hook => !hook.retired);
  if (!active.length) return `${head}\n当前没有活跃伏笔。`;
  const sorted = [...active].sort(compareHooks_ACU);
  const shown = sorted.slice(0, AGENT_HOT_HOOK_LIMIT_ACU);
  const lines = shown.map(hook => [
    `- [${hook.id}] 重要度=${hook.importance} 状态=${hook.status} 埋设楼层=${hook.plantedIndex} 最近变动楼层=${hook.updatedIndex}`,
    `  内容：${hook.summary}`,
    hook.plannedPayoff ? `  计划回收：${hook.plannedPayoff}` : '',
  ].filter(Boolean).join('\n'));
  const hidden = sorted.length - shown.length;
  const tail = hidden > 0 ? `\n另有 ${hidden} 条活跃伏笔未进入本次热上下文，需要时请派工读取完整账本。` : '';
  return truncateAgentBlock_ACU(`${head}\n${lines.join('\n')}${tail}`);
}

/**
 * 渲染认知与信息差时间线。
 * @param snapshot 当前快照
 * @returns 自然语言文本，包含客观事实、读者已知、各角色知晓与揭示状态
 */
export function renderAgentInfoGap_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  const head = `当前修订号=${snapshot.revisions.infoGap}`;
  const active = snapshot.infoGap.filter(entry => !entry.retired);
  if (!active.length) return `${head}\n当前没有登记的信息差条目。`;
  const lines = active.map(entry => [
    `- [${entry.id}] ${entry.topic}（揭示状态=${entry.revealStatus}${entry.revealIndex === null ? '' : `，揭示楼层=${entry.revealIndex}`}）`,
    `  客观事实：${entry.objectiveFact || '（未登记）'}`,
    `  读者已知：${entry.readerKnown || '（未登记）'}`,
    entry.characterKnowledge.length ? `  角色知晓：${entry.characterKnowledge.map(item => `${item.name}=${item.knows}`).join('；')}` : '',
  ].filter(Boolean).join('\n'));
  return truncateAgentBlock_ACU(`${head}\n${lines.join('\n')}`);
}

/**
 * 渲染长期约束清单。
 * @param snapshot 当前快照
 * @returns 自然语言文本，每条包含约束内容与登记理由
 */
export function renderAgentConstraints_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  const head = `当前修订号=${snapshot.revisions.constraints}`;
  if (!snapshot.constraints.length) return `${head}\n当前没有登记的长期约束。`;
  const lines = snapshot.constraints.map(item => `- [${item.id}] ${item.text}${item.reason ? `（理由：${item.reason}）` : ''}`);
  return truncateAgentBlock_ACU(`${head}\n${lines.join('\n')}`);
}

/** 总纲条目排序：全书方向永远在最前，其后按卷推进状态（active → planned → done）排列。 */
const STORY_ARC_STATUS_WEIGHTS_ACU: Record<string, number> = { active: 0, planned: 1, done: 2 };

function compareStoryArc_ACU(left: AgentStoryArcEntry_ACU, right: AgentStoryArcEntry_ACU): number {
  if (left.scope !== right.scope) return left.scope === 'story' ? -1 : 1;
  return (STORY_ARC_STATUS_WEIGHTS_ACU[left.status] ?? 3) - (STORY_ARC_STATUS_WEIGHTS_ACU[right.status] ?? 3);
}

function renderStoryArcEntry_ACU(entry: AgentStoryArcEntry_ACU): string {
  const head = entry.scope === 'story' ? '全书方向' : '卷台阶';
  return [
    `- [${entry.id}] ${head}「${entry.title}」状态=${entry.status}${entry.stageNumbers.length ? ` 已承载阶段=${entry.stageNumbers.join('、')}` : ' 尚未由任何阶段承载'}${entry.retired ? ' 已废止' : ''}`,
    entry.narrativeRole ? `  结构职责：${entry.narrativeRole}` : '',
    entry.targetStageRange ? `  阶段容量：${entry.targetStageRange.min}–${entry.targetStageRange.max} 个阶段` : '',
    entry.targetTimeSpan ? `  故事时间目标：${entry.targetTimeSpan}` : '',
    entry.direction ? `  方向：${entry.direction}` : '',
    entry.escalation ? `  升级目标：${entry.escalation}` : '',
    entry.progressCeiling ? `  主线进度上限：${entry.progressCeiling}` : '',
    entry.sustainingThreads?.length ? `  持续经营线：${entry.sustainingThreads.join('；')}` : '',
    entry.payoffTargets?.length ? `  兑现目标：${entry.payoffTargets.join('；')}` : '',
    entry.withheld ? `  禁止提前翻的底牌：${entry.withheld}` : '',
    entry.completionStageNumber === null ? '' : `  完成依据：第 ${entry.completionStageNumber} 阶段；卷末状态=${entry.completionState || '（未登记）'}`,
    entry.completionRationale ? `  容量偏离说明：${entry.completionRationale}` : '',
    entry.continuationRationale ? `  续卷依据：${entry.continuationRationale}` : '',
    entry.retired && entry.retiredReason ? `  废止原因：${entry.retiredReason}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * 判断总纲是否已经立起来。全部条目退役等价于没有总纲——门禁按活跃条目判定，
 * 否则用户清空总纲后大纲派工会以为总纲还在。
 * @param snapshot 当前快照
 * @returns 存在任一活跃总纲条目时为 true
 */
export function hasActiveStoryArc_ACU(snapshot: AgentModuleSnapshot_ACU): boolean {
  return snapshot.storyArc.some(entry => !entry.retired);
}

/** 判断是否存在可承载下一份阶段大纲的活动卷。全书方向本身不是阶段规划目标。 */
export function hasActiveStoryArcVolume_ACU(snapshot: AgentModuleSnapshot_ACU): boolean {
  return snapshot.storyArc.some(entry => (
    entry.scope === 'volume'
    && !entry.retired
    && entry.status === 'active'
  ));
}

/**
 * 找出已完成但没有登记进任何活跃 volume 条目 stageNumbers 的阶段编号。
 * 这些阶段是总纲进度的空洞：卷台阶不知道自己已经被走过，后续判断「本卷该收了没」就没有依据。
 * @param snapshot 当前快照
 * @param completedStageNumbers 已完成的阶段编号
 * @returns 未登记的阶段编号，升序去重
 */
export function findUnregisteredStageNumbers_ACU(snapshot: AgentModuleSnapshot_ACU, completedStageNumbers: readonly number[]): number[] {
  const registered = new Set<number>();
  for (const entry of snapshot.storyArc) {
    if (entry.retired) continue;
    for (const stageNumber of entry.stageNumbers) registered.add(stageNumber);
  }
  return [...new Set(completedStageNumbers)].filter(stageNumber => !registered.has(stageNumber)).sort((left, right) => left - right);
}

/**
 * 渲染活动卷给阶段规划与审查使用的集中上下文。
 * 阶段承载与卷收束是两层事实：stageNumbers 是卷已承载的阶段，completedStageNumbers 才是正文已完成的阶段。
 */
export function renderAgentActiveVolumePlanningContext_ACU(snapshot: AgentModuleSnapshot_ACU, completedStageNumbers: readonly number[]): string {
  const volumes = snapshot.storyArc.filter(entry => entry.scope === 'volume' && !entry.retired);
  const active = volumes.filter(entry => entry.status === 'active');
  const completed = new Set(completedStageNumbers);
  if (!volumes.length) return '【活动卷规划上下文】\n当前没有卷台阶；必须由 arc-architect 建立总纲后才能创建阶段大纲。';
  if (!active.length) {
    return '【活动卷规划上下文】\n所有既有卷均已完成。用户继续写作时，arc-architect 必须先根据最后一卷的结果、代价、关系变化或未解决问题在末尾追加一个 active 卷，再由 outline-architect 创建下一阶段大纲。';
  }
  if (active.length > 1) return `【活动卷规划上下文】\n总纲状态无效：当前存在 ${active.length} 个 active 卷（${active.map(entry => entry.id).join('、')}），必须先由 arc-architect 修复。`;
  const volume = active[0];
  const completedCarriers = volume.stageNumbers.filter(stageNumber => completed.has(stageNumber));
  const pendingCarriers = volume.stageNumbers.filter(stageNumber => !completed.has(stageNumber));
  return [
    '【活动卷规划上下文】',
    `当前 active 卷：[${volume.id}]「${volume.title}」`,
    `卷级结构职责：${volume.narrativeRole ?? '旧快照未标注'}`,
    `目标阶段容量：${volume.targetStageRange ? `${volume.targetStageRange.min}–${volume.targetStageRange.max} 个阶段` : '旧快照未标注'}`,
    `目标故事时间：${volume.targetTimeSpan || '旧快照未标注'}`,
    `已承载阶段：${volume.stageNumbers.length ? volume.stageNumbers.join('、') : '（尚无）'}`,
    `真实完成进度：${completedCarriers.length ? `已完成阶段 ${completedCarriers.join('、')}` : '尚未有已完成阶段'}${pendingCarriers.length ? `；已登记但尚未完成阶段 ${pendingCarriers.join('、')}` : ''}`,
    `本阶段只承担本卷尚未完成的一段：${volume.direction}`,
    `卷级收束条件：${volume.escalation}`,
    `主线进度上限：${volume.progressCeiling || '旧快照未标注'}`,
    `持续经营线：${volume.sustainingThreads?.length ? volume.sustainingThreads.join('；') : '旧快照未标注'}`,
    `兑现目标：${volume.payoffTargets?.length ? volume.payoffTargets.join('；') : '旧快照未标注'}`,
    `禁止提前释放：${volume.withheld || '（无额外底牌）'}`,
  ].join('\n');
}

/**
 * 渲染故事总纲的热上下文。
 * @param snapshot 当前快照
 * @param completedStageNumbers 已真实完成的阶段编号
 * @returns 自然语言文本；总纲为空时明确指出由 open_round 固定工作流建立
 */
export function renderAgentStoryArc_ACU(snapshot: AgentModuleSnapshot_ACU, completedStageNumbers: readonly number[] = []): string {
  const head = `当前修订号=${snapshot.revisions.storyArc}`;
  const active = snapshot.storyArc.filter(entry => !entry.retired);
  if (!active.length) return `${head}\n当前还没有故事总纲。总纲缺失时无法判断本阶段该走到哪一步；输出 open_round 后，固定工作流会先调用 arc-architect 建立总纲，主 Agent 不直接派工。`;
  const sorted = [...active].sort(compareStoryArc_ACU);
  return truncateAgentBlock_ACU(`${head}\n${sorted.map(renderStoryArcEntry_ACU).join('\n')}\n\n${renderAgentActiveVolumePlanningContext_ACU(snapshot, completedStageNumbers)}`);
}

function renderHookFull_ACU(hook: AgentHookEntry_ACU): string {
  return [
    `- [${hook.id}] 重要度=${hook.importance} 状态=${hook.status} 埋设楼层=${hook.plantedIndex} 最近变动楼层=${hook.updatedIndex}${hook.retired ? ' 已退休' : ''}`,
    `  内容：${hook.summary}`,
    hook.plannedPayoff ? `  计划回收：${hook.plannedPayoff}` : '',
    hook.retired && hook.retiredReason ? `  退休原因：${hook.retiredReason}` : '',
  ].filter(Boolean).join('\n');
}

function renderInfoGapFull_ACU(entry: AgentInfoGapEntry_ACU): string {
  return [
    `- [${entry.id}] ${entry.topic}（揭示状态=${entry.revealStatus}${entry.revealIndex === null ? '' : `，揭示楼层=${entry.revealIndex}`}${entry.retired ? '，已退休' : ''}）`,
    `  客观事实：${entry.objectiveFact || '（未登记）'}`,
    `  读者已知：${entry.readerKnown || '（未登记）'}`,
    entry.characterKnowledge.length ? `  角色知晓：${entry.characterKnowledge.map(item => `${item.name}=${item.knows}`).join('；')}` : '',
    entry.retired && entry.retiredReason ? `  退休原因：${entry.retiredReason}` : '',
  ].filter(Boolean).join('\n');
}

function renderConstraintFull_ACU(item: AgentConstraintEntry_ACU): string {
  return `- [${item.id}] ${item.text}${item.reason ? `（理由：${item.reason}）` : ''}（登记楼层=${item.createdIndex}）`;
}

interface AgentModuleReadSpec_ACU<Entry extends { id: string }> {
  label: string;
  revision: number;
  entries: readonly Entry[];
  render: (entry: Entry) => string;
}

interface RetirableEntry_ACU {
  id: string;
  retired?: boolean;
}

function renderModuleEntries_ACU<Entry extends RetirableEntry_ACU>(spec: AgentModuleReadSpec_ACU<Entry>, ids?: readonly string[]): string {
  const head = `当前修订号=${spec.revision}`;
  if (!ids || !ids.length) {
    // 全量读默认只列活跃条目；退休条目可被搜索命中并按 ID 精读，避免全量视图被历史噪音撑大。
    const active = spec.entries.filter(entry => entry.retired !== true);
    const retiredCount = spec.entries.length - active.length;
    if (!active.length) return `${head}\n${spec.label}当前没有活跃条目。${retiredCount ? `另有 ${retiredCount} 条已退休条目，可用 search 命中后按 ID 精读。` : ''}`;
    const tail = retiredCount ? `\n另有 ${retiredCount} 条已退休条目未列出，可用 search 命中后按 ID 精读。` : '';
    return `${head}\n${spec.label}活跃条目 ${active.length} 条：\n${active.map(spec.render).join('\n')}${tail}`;
  }
  const wanted = ids.map(id => id.trim()).filter(Boolean);
  const found = spec.entries.filter(entry => wanted.includes(entry.id));
  const missing = wanted.filter(id => !spec.entries.some(entry => entry.id === id));
  const lines: string[] = [head];
  if (found.length) lines.push(...found.map(spec.render));
  if (missing.length) lines.push(`以下 ID 不存在于${spec.label}：${missing.join('、')}。可先读全量或 search 确认可用 ID。`);
  if (!found.length && !missing.length) lines.push('未指定有效 ID。');
  return lines.join('\n');
}

/**
 * 按 ID 精读伏笔账本（含退休条目）；不传 ID 则输出全部活跃条目，支撑 `$HOOKS_LEDGER` / `$HOOKS_LEDGER:ID1,ID2`。
 */
export function renderAgentHooksByIds_ACU(snapshot: AgentModuleSnapshot_ACU, ids?: readonly string[]): string {
  return renderModuleEntries_ACU({ label: '伏笔账本', revision: snapshot.revisions.hooks, entries: snapshot.hooks, render: renderHookFull_ACU }, ids);
}

/**
 * 按 ID 精读信息差时间线（含退休条目）；不传 ID 则输出全部活跃条目，支撑 `$INFO_GAP` / `$INFO_GAP:ID1,ID2`。
 */
export function renderAgentInfoGapByIds_ACU(snapshot: AgentModuleSnapshot_ACU, ids?: readonly string[]): string {
  return renderModuleEntries_ACU({ label: '信息差时间线', revision: snapshot.revisions.infoGap, entries: snapshot.infoGap, render: renderInfoGapFull_ACU }, ids);
}

/**
 * 按 ID 精读长期约束；不传 ID 则输出全量，支撑 `$CONSTRAINTS` / `$CONSTRAINTS:ID1,ID2`。
 */
export function renderAgentConstraintsByIds_ACU(snapshot: AgentModuleSnapshot_ACU, ids?: readonly string[]): string {
  return renderModuleEntries_ACU({ label: '长期约束清单', revision: snapshot.revisions.constraints, entries: snapshot.constraints, render: renderConstraintFull_ACU }, ids);
}

/**
 * 按 ID 精读故事总纲（含已废止条目）；不传 ID 则输出全部活跃条目，支撑 `$STORY_ARC` / `$STORY_ARC:ID1,ID2`。
 */
export function renderAgentStoryArcByIds_ACU(snapshot: AgentModuleSnapshot_ACU, ids?: readonly string[], completedStageNumbers: readonly number[] = []): string {
  const entries = renderModuleEntries_ACU({ label: '故事总纲', revision: snapshot.revisions.storyArc, entries: snapshot.storyArc, render: renderStoryArcEntry_ACU }, ids);
  return ids?.length ? entries : `${entries}\n\n${renderAgentActiveVolumePlanningContext_ACU(snapshot, completedStageNumbers)}`;
}

const CHRONOLOGY_PRECISION_LABELS_ACU: Record<string, string> = { exact: '精确', approximate: '近似', unknown: '未知' };

function renderChronologyEntry_ACU(entry: AgentChronologyEntry_ACU): string {
  return [
    `- [${entry.id}] 时间锚：${entry.anchor}（精度=${CHRONOLOGY_PRECISION_LABELS_ACU[entry.precision] ?? entry.precision}${entry.retired ? '，已作废' : ''}）`,
    `  累计经过：${entry.elapsed}`,
    `  时间转换：${entry.transition}`,
    `  证据楼层：${entry.evidenceIndexes.join('、')}（结算楼层=${entry.updatedIndex}）`,
    entry.retired && entry.retiredReason ? `  作废原因：${entry.retiredReason}` : '',
  ].filter(Boolean).join('\n');
}

/** 年代学记录按结算次序展示：updatedIndex 相同（同一次结算多条转换）时保持登记顺序。 */
function sortChronology_ACU(entries: readonly AgentChronologyEntry_ACU[]): AgentChronologyEntry_ACU[] {
  return [...entries].sort((left, right) => left.updatedIndex - right.updatedIndex);
}

/**
 * 渲染故事年代学账本的热上下文。
 * @param snapshot 当前快照
 * @returns 自然语言文本；空账本时明确说明时间事实只能由维护代理依据真实正文结算
 */
export function renderAgentChronology_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  const head = `当前修订号=${snapshot.revisions.chronology}`;
  const active = sortChronology_ACU(snapshot.chronology.filter(entry => !entry.retired));
  const retiredCount = snapshot.chronology.length - active.length;
  const retiredNote = retiredCount ? `\n另有 ${retiredCount} 条已作废记录未列出，可用 search 命中后按 ID 精读。` : '';
  if (!active.length) return `${head}\n当前没有已结算的故事时间记录。时间事实只能由结算维护代理依据真实正文登记；大纲里的时间字段是计划，不是事实。${retiredNote}`;
  const latest = active[active.length - 1];
  return truncateAgentBlock_ACU([
    head,
    `当前时间锚：${latest.anchor}（精度=${CHRONOLOGY_PRECISION_LABELS_ACU[latest.precision] ?? latest.precision}）；自故事起点累计经过：${latest.elapsed}。`,
    ...active.map(renderChronologyEntry_ACU),
  ].join('\n') + retiredNote);
}

/**
 * 按 ID 精读故事年代学账本（含已作废条目）；不传 ID 则输出全部活跃条目，支撑 `$CHRONOLOGY` / `$CHRONOLOGY:ID1,ID2`。
 */
export function renderAgentChronologyByIds_ACU(snapshot: AgentModuleSnapshot_ACU, ids?: readonly string[]): string {
  return renderModuleEntries_ACU({ label: '故事年代学账本', revision: snapshot.revisions.chronology, entries: sortChronology_ACU(snapshot.chronology), render: renderChronologyEntry_ACU }, ids);
}

export const WEB_REF_SOURCE_LABELS_ACU: Record<AgentWebRefEntry_ACU['source'], string> = {
  moegirl: '萌娘百科',
  wikipedia_zh: '中文维基',
  wikipedia_en: '英文维基',
  baidu: '百度百科',
  web: '网页',
};

const WEB_REF_STATUS_LABELS_ACU: Record<AgentWebRefEntry_ACU['sourceStatus'], string> = {
  ok: '正常',
  unavailable: '来源不可用',
  blocked: '被拦截',
};

/** 唯一会进入预览上下文的资料形态：名称 + 一句话简介。 */
function renderWebRefPreview_ACU(entry: AgentWebRefEntry_ACU): string {
  const flags = [
    entry.tags.length ? entry.tags.join('/') : '',
    entry.sourceStatus !== 'ok' ? WEB_REF_STATUS_LABELS_ACU[entry.sourceStatus] : '',
    entry.retired ? '已退休' : '',
  ].filter(Boolean);
  return `- [${entry.id}]「${entry.title}」${entry.brief || '（无简介）'}${flags.length ? `（${flags.join('；')}）` : ''}`;
}

/** 按 ID 查询时才给自由格式详情与来源；网页原文不会被保存。 */
function renderWebRefFull_ACU(entry: AgentWebRefEntry_ACU): string {
  return [
    `- [${entry.id}]「${entry.title}」来源=${WEB_REF_SOURCE_LABELS_ACU[entry.source]} 状态=${WEB_REF_STATUS_LABELS_ACU[entry.sourceStatus]}${entry.retired ? ' 已退休' : ''}`,
    `  简介：${entry.brief || '（无）'}`,
    `  链接：${entry.url}`,
    entry.query ? `  检索词：${entry.query}` : '',
    entry.tags.length ? `  标签：${entry.tags.join('、')}` : '',
    entry.summary ? `  详情：\n${entry.summary}` : '  详情：（未写）',
    entry.retired && entry.retiredReason ? `  退休原因：${entry.retiredReason}` : '',
  ].filter(Boolean).join('\n');
}

/** 将所有活跃资料压成预览，供主 Agent 运行时快照注入。 */
export function renderAgentWebRefsCatalog_ACU(snapshot: AgentModuleSnapshot_ACU, enabled: boolean): string {
  const active = snapshot.webRefs.filter(entry => !entry.retired);
  if (!active.length) {
    return enabled
      ? '百科资料库为空。开场检索尚未产出条目，或来源均不可达；需要原作/公开设定时派工 web-researcher。'
      : '百科资料库为空（网页检索功能未启用）。';
  }
  return truncateAgentBlock_ACU([
    `百科资料库 ${active.length} 条（外部参考资料，非本故事已发生事实；与世界书或正文冲突时以后者为准）。下面只是名称与一句话简介，详情用 read $WEB_REFS:ID 精读：`,
    ...active.map(renderWebRefPreview_ACU),
  ].join('\n'));
}

/** 不传 ID 也只返回预览；按 ID 才返回详情。 */
export function renderAgentWebRefsByIds_ACU(snapshot: AgentModuleSnapshot_ACU, ids?: readonly string[]): string {
  if (!ids || !ids.length) {
    const head = `当前修订号=${snapshot.revisions.webRefs}`;
    const active = snapshot.webRefs.filter(entry => !entry.retired);
    const retiredCount = snapshot.webRefs.length - active.length;
    const tail = retiredCount ? `\n另有 ${retiredCount} 条已退休条目未列出，可用 search 命中后按 ID 精读。` : '';
    if (!active.length) return `${head}\n百科资料库当前没有活跃条目。${tail}`;
    return `${head}\n百科资料库活跃条目 ${active.length} 条（预览：名称 + 一句话简介；详情用 $WEB_REFS:ID 精读）：\n${active.map(renderWebRefPreview_ACU).join('\n')}${tail}`;
  }
  return renderModuleEntries_ACU({ label: '百科资料库', revision: snapshot.revisions.webRefs, entries: snapshot.webRefs, render: renderWebRefFull_ACU }, ids);
}
