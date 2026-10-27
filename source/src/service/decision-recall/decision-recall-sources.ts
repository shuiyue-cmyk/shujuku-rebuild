/**
 * service/decision-recall/decision-recall-sources.ts — 决策召回读取的外部数据（纪要表、聊天、交火筛过的纪要索引）。
 *
 * 与打分、选取逻辑分开，便于测试替换。
 */
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { globalMeta_ACU } from '../../data/repositories/profile-repo';
import { currentJsonTableData_ACU, _set_currentJsonTableData_ACU } from '../runtime/state-manager';
import { mergeAllIndependentTables_ACU } from '../runtime/helpers-data-merge';
import { buildPreparedRows_ACU, findSummaryTable_ACU } from '../vector/summary-vector-index-archive-service';
import { getInjectionTargetLorebook_ACU, getIsolationPrefix_ACU } from '../worldbook/injection-engine';
import { getLorebookEntries_ACU, isWorldbookApiAvailable_ACU } from '../worldbook/worldbook-service';
import { logWarn_ACU } from '../../shared/utils';
import type { DecisionRecallRow_ACU } from './decision-recall-scoring';

export interface DecisionRecallRowsResult_ACU {
  rows: DecisionRecallRow_ACU[];
  /** 读不到纪要表或缺少概要 / 编码索引列时的原因。 */
  error: string;
}

export interface DecisionRecallSources_ACU {
  loadRows: () => Promise<DecisionRecallRowsResult_ACU>;
  loadChat: () => any[];
  /** 交火开着时返回它写好的纪要索引正文；交火没开或读不到时返回 null（从全部纪要里选）。 */
  loadCrossfireIndexContent: () => Promise<string | null>;
}

async function loadSummaryRows_ACU(): Promise<DecisionRecallRowsResult_ACU> {
  if (!currentJsonTableData_ACU || typeof currentJsonTableData_ACU !== 'object') {
    try {
      const merged = await mergeAllIndependentTables_ACU();
      if (merged && typeof merged === 'object') _set_currentJsonTableData_ACU(merged);
    } catch (error) {
      logWarn_ACU('[决策召回] 合并表格数据失败:', error);
    }
  }
  const selected = findSummaryTable_ACU();
  if (!selected?.summaryKey || !selected.table) return { rows: [], error: '没有找到纪要表。' };
  const prepared = buildPreparedRows_ACU(selected.table, selected.summaryKey);
  if (prepared.error) return { rows: [], error: prepared.error };
  return {
    rows: prepared.rows.map(row => ({
      rowKey: row.rowKey,
      rowOrder: row.rowOrder,
      indexCode: row.indexCode,
      timeSpan: row.timeSpan,
      location: row.location,
      summary: row.summary,
      chronicleText: row.chronicleText,
    })),
    error: '',
  };
}

async function loadCrossfireIndexContent_ACU(): Promise<string | null> {
  if (globalMeta_ACU?.summaryVectorIndexModeGlobal !== true) return null;
  if (!isWorldbookApiAvailable_ACU()) return null;
  try {
    const lorebook = await getInjectionTargetLorebook_ACU();
    if (!lorebook) return null;
    const comment = `${getIsolationPrefix_ACU()}TavernDB-ACU-CustomExport-纪要索引`;
    const entries = await getLorebookEntries_ACU(lorebook);
    const entry = entries.find((item: any) => item?.comment === comment);
    return typeof entry?.content === 'string' ? entry.content : null;
  } catch (error) {
    logWarn_ACU('[决策召回] 读取交火纪要索引失败，改从全部纪要里选:', error);
    return null;
  }
}

export const DEFAULT_DECISION_RECALL_SOURCES_ACU: DecisionRecallSources_ACU = {
  loadRows: loadSummaryRows_ACU,
  loadChat: () => getChatArray_ACU() || [],
  loadCrossfireIndexContent: loadCrossfireIndexContent_ACU,
};

/** 纪要索引正文里出现的编码；一个都对不上时返回 null（退回从全部纪要里选）。 */
export function collectIndexedCodes_ACU(content: string | null, rows: readonly DecisionRecallRow_ACU[]): Set<string> | null {
  if (!content) return null;
  const tokens = new Set(content.split(/[\s|,，、;；<>]+/).map(token => token.trim()).filter(Boolean));
  const codes = new Set(rows.map(row => row.indexCode).filter(code => tokens.has(code)));
  return codes.size > 0 ? codes : null;
}
