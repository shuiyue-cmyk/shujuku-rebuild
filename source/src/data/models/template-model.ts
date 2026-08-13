/**
 * data/models/template-model.ts — 模板数据结构定义
 *
 * 定义模板预设、模板快照和模板作用域的 TypeScript 接口。
 */

/** 模板预设存储结构 */
export interface TemplatePresetsStore_ACU {
  version: number;
  presets: Record<string, TemplatePresetEntry_ACU>;
}

/** 单个模板预设条目 */
export interface TemplatePresetEntry_ACU {
  templateStr: string;
  updatedAt: number;
}

/** 聊天级模板作用域状态 */
export interface ChatTemplateScopeState_ACU {
  mode: 'inherit_global' | 'chat_override';
  presetName: string;
  source: string;
  originGlobalName: string;
  originGlobalRevision: number;
  updatedAt: number;
  templateSnapshot?: string;
  guideData?: unknown;
}

/** 聊天级剧情作用域状态 */
export interface ChatPlotScopeState_ACU {
  mode: 'inherit_global' | 'chat_override';
  presetName: string;
  source: string;
  originGlobalName: string;
  originGlobalRevision: number;
  updatedAt: number;
  plotSettingsSnapshot?: unknown;
}

/** 模板归档条目 */
export interface ChatTemplateArchiveEntry_ACU {
  key: string;
  label: string;
  fingerprint: string;
  isolationKey: string;
  templateState: ChatTemplateScopeState_ACU;
  createdAt: number;
  reason: string;
}

/** Sheet Guide 数据结构 */
export interface SheetGuideData_ACU {
  version: number;
  isolationKey: string;
  sheets: Record<string, {
    name: string;
    headers: (string | null)[];
    seedRows?: (string | null)[][];
    updateConfig?: unknown;
    exportConfig?: unknown;
    orderNo?: number;
  }>;
  mate?: unknown;
}
