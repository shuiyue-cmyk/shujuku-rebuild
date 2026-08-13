/**
 * data/models/table-data.ts — 表格数据结构定义
 *
 * 定义 sheet、mate、表格数据对象的 TypeScript 接口。
 * 这些类型描述了 currentJsonTableData_ACU 的内部结构。
 */

/** 单个表格的更新配置 */

export interface SheetUpdateConfig_ACU {
  uiSentinel: number;
  contextDepth: number;
  updateFrequency: number;
  batchSize: number;
  skipFloors: number;
  sendRowsSqlTemplate?: string;
}

/** 世界书导出位置配置 */
export interface PlacementConfig_ACU {
  position: string;
  depth: number;
  order: number;
}

/** 单个表格的导出配置 */
export interface SheetExportConfig_ACU {
  enabled: boolean;
  splitByRow: boolean;
  entryName: string;
  entryType: string;
  keywords: string;
  preventRecursion: boolean;
  injectionTemplate: string;
  extraIndexEnabled: boolean;
  extraIndexEntryName: string;
  extraIndexColumns: string[];
  extraIndexColumnModes: Record<string, string>;
  extraIndexInjectionTemplate: string;
  sqlInjectionTemplate?: string;
  entryPlacement: PlacementConfig_ACU;
  extraIndexPlacement: PlacementConfig_ACU;
  fixedEntryPlacement: PlacementConfig_ACU;
  fixedIndexPlacement: PlacementConfig_ACU;
  injectIntoWorldbook?: boolean;
}

/** 单个表格的源数据描述 */
export interface SheetSourceData_ACU {
  note: string;
  initNode: string;
  deleteNode: string;
  updateNode: string;
  insertNode: string;
  /** SQLite 模式下的建表 DDL（可选，仅 sqlite 模式使用） */
  ddl?: string;
  /**
   * 仅从活动模板/UI/AI 投影中隐藏的 SQLite physical column。
   * 底层 DDL、content 表头与历史行仍完整保留这些列。
   */
  hiddenPhysicalColumns?: string[];
  /**
   * 表的历史/约定名称。所有名称都显式指向当前这张表，用于 AI、SQL 与
   * 调度快照在表改名或稳定 sheetKey 重分配后恢复同一表身份。
   *
   * 这是可审计的声明而非模糊匹配：任一名称被多张表声明时，路由必须拒绝，
   * 不能猜测目标表或扩大写入权限。
   */
  tableAliases?: string[];
  /**
   * 列的历史显示名声明：physical column name → 曾用过的显示名列表。
   *
   * 列身份以 canonical 显示名为准；改名后 canonical 不再相等，靠该声明认回同一列，
   * 使数据能继续继承。切模板时由协调器自动累积，模板作者也可显式声明。
   * 这是显式声明而非推断：没有声明就不会把两列当成同一列，避免把无关字段的数据混在一起。
   */
  columnAliases?: Record<string, string[]>;
}

/** 单张表格（sheet）的完整结构 */
export interface Sheet_ACU {
  uid: string;
  name: string;
  sourceData: SheetSourceData_ACU;
  content: (string | null)[][];
  updateConfig: SheetUpdateConfig_ACU;
  exportConfig: SheetExportConfig_ACU;
  orderNo: number;
  /** 运行时附加：seedRows 基底数据（来自 Sheet Guide） */
  seedRows?: (string | null)[][];
}

/** 全局注入配置 */
export interface GlobalInjectionConfig_ACU {
  readableEntryPlacement: PlacementConfig_ACU;
  wrapperPlacement: PlacementConfig_ACU;
}

/** mate 元信息块 */
export interface Mate_ACU {
  type: string;
  version: number;
  updateConfigUiSentinel: number;
  globalInjectionConfig: GlobalInjectionConfig_ACU;
}

/** 完整的表格数据对象（currentJsonTableData_ACU 的类型） */
export interface TableDataObject_ACU {
  mate: Mate_ACU;
  [sheetKey: string]: Sheet_ACU | Mate_ACU;
}
