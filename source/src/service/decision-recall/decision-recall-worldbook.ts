/**
 * service/decision-recall/decision-recall-worldbook.ts — 决策召回打分时附加的世界书条目。
 *
 * 选法与填表的「附加世界书条目」相同（来源：正文接收 / 跟随角色卡 / 手动选择，再按条目勾选），
 * 与填表各存各的：按角色卡保存在 characterSettings[角色卡].decisionRecallWorldbookConfig，默认正文接收。
 * 条目取舍走填表同一条管线：蓝灯常驻，绿灯按前文与本轮输入的关键词触发，勾选的条目一定带上。
 * 世界书读不到不影响召回，只是这次打分不带世界书。
 */
import { getCurrentCharSettings_ACU } from '../settings/settings-readers';
import { getCombinedWorldbookContent_ACU } from '../worldbook/pipeline';
import { resolvePreTakeoverWorldbookSnapshot_ACU } from '../agent/agent-worldbook-takeover';
import { logWarn_ACU } from '../../shared/utils';

export type DecisionRecallWorldbookSource_ACU = 'character' | 'manual' | 'active';

export interface DecisionRecallWorldbookConfig_ACU {
  source: DecisionRecallWorldbookSource_ACU;
  manualSelection: string[];
  enabledEntries: Record<string, number[]>;
}

const SOURCES_ACU: readonly string[] = ['character', 'manual', 'active'];

/** 当前角色卡的这份配置（返回设置里的原对象：页面原地改完再保存）；缺失或不合法的字段就地补成默认。 */
export function getCurrentDecisionRecallWorldbookConfig_ACU(): DecisionRecallWorldbookConfig_ACU {
  const charSettings = getCurrentCharSettings_ACU() as Record<string, any>;
  const saved = charSettings.decisionRecallWorldbookConfig;
  const config: Record<string, any> = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  if (!SOURCES_ACU.includes(config.source)) config.source = 'active';
  if (!Array.isArray(config.manualSelection)) config.manualSelection = [];
  if (!config.enabledEntries || typeof config.enabledEntries !== 'object' || Array.isArray(config.enabledEntries)) config.enabledEntries = {};
  charSettings.decisionRecallWorldbookConfig = config;
  return config as DecisionRecallWorldbookConfig_ACU;
}

/** 打分时附加的世界书正文；绿灯条目的关键词按 scanText（前文与本轮输入）触发。没有可带的条目时返回空串。 */
export async function loadDecisionRecallWorldbookContent_ACU(scanText: string): Promise<string> {
  const worldbookConfig = getCurrentDecisionRecallWorldbookConfig_ACU();
  // 与填表同口径：Agent 接管生效时按接管前的条目状态取舍；快照读不到就按当前状态
  let entryStateSnapshot: unknown;
  let entryStateSnapshotSignature = '';
  try {
    const resolved = await resolvePreTakeoverWorldbookSnapshot_ACU();
    entryStateSnapshot = resolved.snapshot;
    entryStateSnapshotSignature = resolved.expectedSignature;
  } catch (error) {
    logWarn_ACU('[决策召回] 无法读取 Agent 世界书接管快照，世界书条目按当前状态取舍。', error);
  }
  return getCombinedWorldbookContent_ACU(scanText, {
    worldbookConfig,
    entryStateView: 'pre_takeover',
    entryStateSnapshot,
    entryStateSnapshotSignature,
  });
}
