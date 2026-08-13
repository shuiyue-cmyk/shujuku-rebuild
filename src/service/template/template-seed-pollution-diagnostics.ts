/**
 * service/template/template-seed-pollution-diagnostics.ts — seed 双池污染只读诊断（阶段 F）
 *
 * 目标：扫描 global preset、当前 chat scope、guide seedRows、runtime/V2 数据，
 * 报告同表同 UNIQUE 值重复、content/seedRows 双池重复、模板数据与 runtime 数据不一致。
 *
 * 边界：纯只读。不写存储、不修改聊天、不触发迁移。调用方拿到报告后自行决定
 * 是否处理历史数据（当前无内置迁移动作——历史污染仅限测试版数据，不迁移；
 * 若未来出现真实用户数据污染，再按计划 F 的设计实现备份-去重-回滚迁移链）。
 */

import type { TableDataObject_ACU } from '../../shared/models/table-data';
import { extractBusinessKeyColumns_ACU } from './template-data-preflight';
import { getTemplatePreset_ACU } from './template-preset-service';
import {
  getChatSheetGuideDataForIsolationKey_ACU,
  getCurrentChatTemplateScopeState_ACU,
} from './chat-scope';
import { currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { safeJsonParse_ACU } from '../../shared/json-helpers';
import { CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU } from '../../data/storage/chat-history';

/** 单表 seed 污染诊断条目 */
export interface SeedPollutionDiagnostic_ACU {
  severity: 'error' | 'warning' | 'info';
  code:
    | 'content_seed_duplicate'
    | 'content_runtime_mismatch'
    | 'guide_seed_pending'
    | 'guide_seed_duplicate'
    | 'seed_row_id_conflict'
    | 'info_no_issue';
  source: 'global_preset' | 'chat_scope' | 'guide' | 'runtime' | 'template';
  sheetKey: string;
  sheetName: string;
  businessKeyColumns: string[];
  conflictingKeys: string[];
  message: string;
}

export interface SeedPollutionScanResult_ACU {
  diagnostics: SeedPollutionDiagnostic_ACU[];
  scanned: {
    globalPresets: number;
    chatScope: number;
    guideSheets: number;
    runtimeSheets: number;
  };
}

/** 从 sheet 提取 content 数据行（不含表头）与 seedRows 数据行 */
function collectSheetPools_ACU(sheet: any): {
  contentRows: unknown[][];
  seedRows: unknown[][];
  header: unknown[];
} {
  const header = Array.isArray(sheet?.content?.[0]) ? sheet.content[0] : [];
  const contentRows: unknown[][] = [];
  const seedRows: unknown[][] = [];
  if (Array.isArray(sheet?.content)) {
    for (const row of sheet.content.slice(1)) {
      if (Array.isArray(row)) contentRows.push(row);
    }
  }
  if (Array.isArray(sheet?.[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU])) {
    for (const row of sheet[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU]) {
      if (Array.isArray(row)) seedRows.push(row);
    }
  } else if (Array.isArray(sheet?._seedRows)) {
    for (const row of sheet._seedRows) {
      if (Array.isArray(row)) seedRows.push(row);
    }
  }
  return { contentRows, seedRows, header };
}

function buildBusinessKeyIndex_ACU(
  rows: unknown[][],
  header: unknown[],
  keyGroups: string[][],
): Map<string, number[]> {
  const headerIndex = new Map<string, number>();
  header.forEach((cell, index) => {
    const name = String(cell ?? '').trim().toLowerCase();
    if (name && !headerIndex.has(name)) headerIndex.set(name, index);
  });
  const index = new Map<string, number[]>();
  rows.forEach((row, rowIndex) => {
    for (const group of keyGroups) {
      const parts: string[] = [];
      let resolvable = true;
      for (const col of group) {
        const idx = headerIndex.get(col.toLowerCase());
        if (idx === undefined || idx >= row.length) { resolvable = false; break; }
        parts.push(String(row[idx] ?? ''));
      }
      if (!resolvable) continue;
      const key = parts.join('\u0001');
      if (!key) continue;
      const list = index.get(key) || [];
      list.push(rowIndex);
      index.set(key, list);
    }
  });
  return index;
}

function push_ACU(result: SeedPollutionDiagnostic_ACU[], item: SeedPollutionDiagnostic_ACU): void {
  result.push(item);
}

/**
 * 扫描单个 sheet 的 content/seedRows 双池重复与 seed 状态。纯只读。
 */
export function diagnoseSheetSeedPools_ACU(
  sheet: any,
  options: {
    source: SeedPollutionDiagnostic_ACU['source'];
    sheetKey: string;
    sheetName: string;
    runtimeRows?: unknown[][];
    runtimeHeader?: unknown[];
  },
): SeedPollutionDiagnostic_ACU[] {
  const out: SeedPollutionDiagnostic_ACU[] = [];
  const { source, sheetKey, sheetName } = options;
  const { contentRows, seedRows, header } = collectSheetPools_ACU(sheet);
  const ddl = String(sheet?.sourceData?.ddl || '');
  const keyGroups = ddl ? extractBusinessKeyColumns_ACU(ddl) : [];

  const seenRowIds = new Map<string, number>();
  const rowIdIndex = header.findIndex(h => String(h ?? '').trim().toLowerCase() === 'row_id');
  for (const row of seedRows) {
    if (rowIdIndex >= 0 && rowIdIndex < row.length) {
      const rid = String(row[rowIdIndex] ?? '').trim();
      if (rid && seenRowIds.has(rid)) {
        push_ACU(out, {
          severity: 'error', code: 'seed_row_id_conflict', source, sheetKey, sheetName,
          businessKeyColumns: ['row_id'], conflictingKeys: [rid],
          message: `表 ${sheetName} (${sheetKey}) 的 seedRows 池内存在重复 row_id=${rid}，身份空间冲突。`,
        });
      } else if (rid) {
        seenRowIds.set(rid, 0);
      }
    }
  }

  if (keyGroups.length > 0 && contentRows.length > 0 && seedRows.length > 0) {
    const contentIndex = buildBusinessKeyIndex_ACU(contentRows, header, keyGroups);
    const headerIndex = new Map<string, number>();
    header.forEach((cell, index) => headerIndex.set(String(cell ?? '').trim().toLowerCase(), index));
    for (const seedRow of seedRows) {
      for (const group of keyGroups) {
        const parts: string[] = [];
        let resolvable = true;
        for (const col of group) {
          const idx = headerIndex.get(col.toLowerCase());
          if (idx === undefined) { resolvable = false; break; }
          parts.push(String(seedRow[idx] ?? ''));
        }
        if (!resolvable) continue;
        const key = parts.join('\u0001');
        if (key && contentIndex.has(key)) {
          push_ACU(out, {
            severity: 'error', code: 'content_seed_duplicate', source, sheetKey, sheetName,
            businessKeyColumns: group, conflictingKeys: [key],
            message: `表 ${sheetName} (${sheetKey}) 的 content 与 seedRows 存在同 UNIQUE 业务键（${group.join(', ')}=${key.replace(/\u0001/g, '/')}），双池重复。`,
          });
        }
      }
    }
  }

  if (options.runtimeRows && options.runtimeHeader && keyGroups.length > 0 && seedRows.length > 0) {
    const runtimeIndex = buildBusinessKeyIndex_ACU(options.runtimeRows, options.runtimeHeader, keyGroups);
    const headerIndex = new Map<string, number>();
    header.forEach((cell, index) => headerIndex.set(String(cell ?? '').trim().toLowerCase(), index));
    for (const seedRow of seedRows) {
      for (const group of keyGroups) {
        const parts: string[] = [];
        let resolvable = true;
        for (const col of group) {
          const idx = headerIndex.get(col.toLowerCase());
          if (idx === undefined) { resolvable = false; break; }
          parts.push(String(seedRow[idx] ?? ''));
        }
        if (!resolvable) continue;
        const key = parts.join('\u0001');
        if (key && runtimeIndex.has(key)) {
          push_ACU(out, {
            severity: 'warning', code: 'guide_seed_duplicate', source, sheetKey, sheetName,
            businessKeyColumns: group, conflictingKeys: [key],
            message: `guide 表 ${sheetName} (${sheetKey}) 的 seedRows 已与 runtime 数据存在同 UNIQUE 业务键（${group.join(', ')}=${key.replace(/\u0001/g, '/')}），可能已物化但未清理 seed。`,
          });
        }
      }
    }
  }

  if (out.length === 0) {
    push_ACU(out, {
      severity: 'info', code: 'info_no_issue', source, sheetKey, sheetName,
      businessKeyColumns: keyGroups.flat(), conflictingKeys: [],
      message: `表 ${sheetName} (${sheetKey}) 未检测到 seed 双池污染。`,
    });
  }
  return out;
}



/**
 * 全量只读扫描：global preset + 当前 chat scope + guide seedRows + runtime。
 * 不写任何存储。返回结构化诊断列表。
 */
export function scanSeedPollution_ACU(): SeedPollutionScanResult_ACU {
  const result: SeedPollutionScanResult_ACU = {
    diagnostics: [],
    scanned: { globalPresets: 0, chatScope: 0, guideSheets: 0, runtimeSheets: 0 },
  };

  // A) 当前聊天模板 scope（chat_override 快照）
  const scopeState = getCurrentChatTemplateScopeState_ACU();
  if (scopeState?.mode === 'chat_override' && typeof scopeState.templateStr === 'string') {
    result.scanned.chatScope += 1;
    const parsed = safeJsonParse_ACU(scopeState.templateStr, null) as TableDataObject_ACU | null;
    if (parsed && typeof parsed === 'object') {
      for (const sheetKey of Object.keys(parsed).filter(k => k.startsWith('sheet_'))) {
        const sheet = (parsed as any)[sheetKey];
        const sheetName = String(sheet?.name ?? sheetKey);
        const runtimeSheet = (currentJsonTableData_ACU as any)?.[sheetKey];
        result.diagnostics.push(...diagnoseSheetSeedPools_ACU(sheet, {
          source: 'chat_scope', sheetKey, sheetName,
          runtimeRows: Array.isArray(runtimeSheet?.content) ? runtimeSheet.content.slice(1) : undefined,
          runtimeHeader: Array.isArray(runtimeSheet?.content?.[0]) ? runtimeSheet.content[0] : undefined,
        }));
      }
    }
  }

  // B) global preset 库（只读 getTemplatePreset_ACU；无法枚举全部预设名时退化为已知常用名）
  const presetNames = (() => {
    try {
      const s = (globalThis as any).__templatePresetsStoreForDiagnostics_ACU;
      return Array.isArray(s) ? s.map((item: any) => item?.name).filter(Boolean) : [];
    } catch {
      return [];
    }
  })();
  const candidates = presetNames.length > 0 ? presetNames : ['默认模板', '标准模板'];
  for (const name of candidates) {
    const preset = getTemplatePreset_ACU(name);
    if (!preset?.templateStr) continue;
    result.scanned.globalPresets += 1;
    const parsed = safeJsonParse_ACU(preset.templateStr, null) as TableDataObject_ACU | null;
    if (!parsed || typeof parsed !== 'object') continue;
    for (const sheetKey of Object.keys(parsed).filter(k => k.startsWith('sheet_'))) {
      const sheet = (parsed as any)[sheetKey];
      result.diagnostics.push(...diagnoseSheetSeedPools_ACU(sheet, {
        source: 'global_preset', sheetKey, sheetName: String(sheet?.name ?? sheetKey),
      }));
    }
  }

  // C) 当前隔离键的 guide seedRows
  const isolationKey = getCurrentIsolationKey_ACU();
  const guide = getChatSheetGuideDataForIsolationKey_ACU(isolationKey);
  if (guide && typeof guide === 'object') {
    for (const sheetKey of Object.keys(guide).filter(k => k.startsWith('sheet_'))) {
      const sheet = (guide as any)[sheetKey];
      const hasSeedRows = Array.isArray(sheet?.[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU])
        && sheet[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU].length > 0;
      result.scanned.guideSheets += 1;
      if (hasSeedRows) {
        const runtimeSheet = (currentJsonTableData_ACU as any)?.[sheetKey];
        result.diagnostics.push(...diagnoseSheetSeedPools_ACU(sheet, {
          source: 'guide', sheetKey, sheetName: String(sheet?.name ?? sheetKey),
          runtimeRows: Array.isArray(runtimeSheet?.content) ? runtimeSheet.content.slice(1) : undefined,
          runtimeHeader: Array.isArray(runtimeSheet?.content?.[0]) ? runtimeSheet.content[0] : undefined,
        }));
      }
    }
  }

  // D) runtime 自身的 content/seedRows 双池（当前数据视图）
  if (currentJsonTableData_ACU && typeof currentJsonTableData_ACU === 'object') {
    for (const sheetKey of Object.keys(currentJsonTableData_ACU).filter(k => k.startsWith('sheet_'))) {
      const sheet = (currentJsonTableData_ACU as any)[sheetKey];
      result.scanned.runtimeSheets += 1;
      result.diagnostics.push(...diagnoseSheetSeedPools_ACU(sheet, {
        source: 'runtime', sheetKey, sheetName: String(sheet?.name ?? sheetKey),
      }));
    }
  }

  return result;
}
