/**
 * shared/template-data-mode.ts — 模板携带数据导入语义（dataMode）与审计类型
 *
 * 计划阶段 A 的产物：统一 replace / merge / seed 三种数据策略的定义、冲突策略、
 * 每表导入审计结构与兼容行为判定。
 *
 * 边界：本模块只定义类型与纯判定函数，不读取聊天、不写存储、不触发 UI 或事务。
 */

/** 模板数据的三种导入策略 */
export type TemplateDataMode_ACU = 'replace' | 'merge' | 'seed';

/** merge 冲突策略：默认保留当前运行时数据，禁止静默覆盖 */
export type TemplateMergeConflictPolicy_ACU = 'keep-current' | 'template-wins' | 'reject';

/** 每张表的行身份（row_id 是系统身份，业务键是 DDL UNIQUE/主键表达） */
export interface TemplateRowIdentity_ACU {
  /** 稳定系统行身份（row_id 首列值） */
  rowId: string;
  /** 业务身份键：DDL UNIQUE/主键列的规范化值（用于 merge 匹配），无则可证明键时为 null */
  businessKey: string | null;
}

/** 每张表的数据导入审计记录 */
export interface TemplateSheetImportAudit_ACU {
  sheetKey: string;
  sheetName: string;
  /** 表级判定动作 */
  action: 'replaced' | 'merged-insert' | 'merged-keep' | 'merged-conflict' | 'seed-only' | 'no-data' | 'blocked';
  /** 模板自带数据行数 */
  templateRowCount: number;
  /** 现有 runtime 行数（merge 基线） */
  runtimeRowCount: number;
  /** 合并后插入的行数（merge 模式） */
  insertedRowCount: number;
  /** 合并后保留的既有行数（merge 模式） */
  keptRowCount: number;
  /** 冲突行数（merge 模式，policy 决定结果） */
  conflictRowCount: number;
  /** 冲突明细：业务键 + 冲突值（policy=reject 时用于诊断） */
  conflicts: Array<{ businessKey: string; values: string[] }>;
  /** 行身份映射（row_id ↔ 业务键） */
  rowIdentities: TemplateRowIdentity_ACU[];
  /** 跨 content/seedRows 完全重复去重信息（content 优先，从 seedRows 删除相同副本） */
  deduplicatedSeedRows?: Array<{ rowId: string; contentRowIndex: number }>;
  /** 阻塞原因（action=blocked 时非空） */
  blocker?: string;
}

/** 一次模板导入的整体结果元数据 */
export interface TemplateImportResultMeta_ACU {
  /** 实际生效的 dataMode（旧调用方未传时由兼容层推导并回填） */
  dataMode: TemplateDataMode_ACU;
  /** 是否已写入 runtime（SQLite/V2 checkpoint） */
  runtimeReady: boolean;
  /** 是否已持久化（global preset 或 chat guide/checkpoint） */
  saved: boolean;
  /** 是否仍有未消费 seedRows（seed 模式） */
  seedPending: boolean;
  /** 每表审计 */
  importAudit: TemplateSheetImportAudit_ACU[];
  /** 结构化警告 */
  warnings: string[];
}

/** 导入选项：dataMode 与 conflictPolicy 的显式声明 */
export interface TemplateImportDataOptions_ACU {
  dataMode?: TemplateDataMode_ACU;
  conflictPolicy?: TemplateMergeConflictPolicy_ACU;
}

/** 兼容推导：旧调用未传 dataMode 时按模板是否带数据、是否有 runtime 数据决定默认行为 */
export function resolveDefaultTemplateDataMode_ACU(options: {
  /** 模板 content 是否携带数据行（>1 行） */
  templateHasData: boolean;
  /** 目标作用域当前是否有 runtime 数据行 */
  runtimeHasData: boolean;
}): TemplateDataMode_ACU {
  const { templateHasData, runtimeHasData } = options;
  // 模板无数据：无论当前是否有数据，都不凭空造行 —— 结构与 seed 语义保持不变。
  if (!templateHasData) return 'seed';
  // 模板带数据：已有 runtime 数据时禁止静默 replace（保持既有聊天数据优先），
  // 仅当 runtime 为空（首次填表）才允许 replace 一次性写入。
  return runtimeHasData ? 'seed' : 'replace';
}

/** 规范化冲突策略：未指定时默认 keep-current（不静默覆盖） */
export function normalizeTemplateConflictPolicy_ACU(policy: unknown): TemplateMergeConflictPolicy_ACU {
  return policy === 'template-wins' || policy === 'reject' ? policy : 'keep-current';
}

/** 规范化 dataMode：未指定时返回 null（由调用方按上下文推导） */
export function normalizeTemplateDataMode_ACU(mode: unknown): TemplateDataMode_ACU | null {
  return mode === 'replace' || mode === 'merge' || mode === 'seed' ? mode : null;
}

/** 判定表是否允许 merge：无法证明唯一业务键时禁止自动 merge（fail-closed） */
export function canMergeTemplateSheet_ACU(sheet: { sourceData?: { ddl?: string } } | undefined): boolean {
  const ddl = String(sheet?.sourceData?.ddl ?? '').trim();
  if (!ddl) return false;
  // 只有显式 UNIQUE/主键约束才能作为业务身份；缺失时不允许 merge。
  return /\b(UNIQUE|PRIMARY\s+KEY)\b/i.test(ddl);
}
