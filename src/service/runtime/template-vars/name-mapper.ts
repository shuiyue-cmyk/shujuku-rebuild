/**
 * service/runtime/template-vars/name-mapper.ts
 * 中英文名称双向映射器
 *
 * 从 DDL 注释中自动构建中英文双向映射。
 * 用户在 ORM / SQL / <if> 中可以使用中文名、英文名、甚至混用，
 * 引擎自动翻译为英文名后执行。
 *
 * 翻译在应用层完成，SQLite 引擎本身只认英文名。
 */

import {
  parseDDLChineseName,
  parseDDLColumnComments,
  parseDDLColumnInfos_ACU,
} from '../../../shared/ddl-utils';
import { logDebug_ACU, logWarn_ACU } from '../../../shared/utils';
import { resolveEffectiveDDL, type EffectiveDDLResult_ACU } from '../../../data/sqlite/schema-mapper';
import type { Sheet_ACU } from '../../../shared/models/table-data';

/** 全局 NameMapper 单例 */
let _globalNameMapper: NameMapper | null = null;
/**
 * 当前映射的发布者身份。
 *
 * 全局 mapper 是单例，但 SQLite runtime 会在切聊/重载时创建新的 provider 实例，
 * 并且存在「新实例已发布 → 旧实例才被销毁」的置换顺序。没有所有权时，
 * 旧实例的迟到清理会把新实例刚发布的映射清成 unbound，
 * 于是依赖中英文名映射的 SQL/ORM 全部退化为中文标识符直传。
 */
let _globalNameMapperOwner_ACU: NameMapperOwnerToken_ACU | null = null;
let _nameMapperOwnerSequence_ACU = 0;

/** 类型层品牌，阻止调用方用普通对象字面量满足凭证类型。 */
const NAME_MAPPER_OWNER_BRAND_ACU: unique symbol = Symbol('acu.name-mapper.owner');

/**
 * 运行时真实性登记。
 *
 * 仅检查品牌属性是不够的：调用方拿到任意真实凭证后，可通过
 * Object.getOwnPropertySymbols() 取得该 Symbol 并复制到伪造对象上。
 * 因此发布权必须由「本模块是否签发过该对象」决定，而不是对象长什么样。
 */
const _issuedNameMapperOwners_ACU = new WeakSet<object>();

/**
 * 不透明的映射发布凭证。
 * id 单调递增，因此「更晚创建的 runtime 实例」天然拥有更高的发布优先级；
 * 凭证带模块私有品牌，调用方无法自行构造，也不能靠拼一个更大的 id 抢占发布权。
 */
export interface NameMapperOwnerToken_ACU {
  readonly [NAME_MAPPER_OWNER_BRAND_ACU]: true;
  readonly id: number;
  readonly label: string;
}

/** 为一个 runtime 实例创建唯一且不可复用的发布凭证。 */
export function createNameMapperOwnerToken_ACU(label: string): NameMapperOwnerToken_ACU {
  _nameMapperOwnerSequence_ACU += 1;
  const token = Object.freeze({
    [NAME_MAPPER_OWNER_BRAND_ACU]: true as const,
    id: _nameMapperOwnerSequence_ACU,
    label: String(label || 'runtime'),
  });
  _issuedNameMapperOwners_ACU.add(token);
  return token;
}
/** 当前 mapper 对应的有效 DDL 集合签名；null 表示尚未绑定到任何 runtime schema。 */
let _globalNameMapperSchemaSignature: string | null = null;
/**
 * mapper 与 runtime schema 的绑定状态。
 * unbound: 未绑定任何 runtime schema，映射不可信。
 * empty_schema: runtime 引擎已就绪但尚未建立任何表，没有可映射的 schema。
 * bound: 已绑定当前 runtime 的有效 DDL 集合。
 *
 * 不能用「实例是否存在」判断就绪：getNameMapper() 会懒建空实例，
 * 那样会让透传映射被误判为可用。
 */
let _globalNameMapperBinding_ACU: 'unbound' | 'empty_schema' | 'bound' = 'unbound';

function buildDDLMapSignature_ACU(ddlMap: Map<string, string>): string {
  return [...ddlMap.entries()]
    .map(([tableName, ddl]) => [String(tableName || '').trim(), String(ddl || '').trim()] as const)
    .filter(([tableName, ddl]) => !!tableName && !!ddl)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tableName, ddl]) => `${tableName}\u0000${ddl}`)
    .join('\u0001');
}

/**
 * 获取全局 NameMapper 实例
 * 如果尚未构建，返回一个空的 NameMapper（所有名称直接透传）
 */
export function getNameMapper(): NameMapper {
  if (!_globalNameMapper) {
    _globalNameMapper = new NameMapper();
  }
  return _globalNameMapper;
}

/** 运行时校验发布凭证：只承认本模块签发过的对象实例。 */
function isNameMapperOwnerToken_ACU(owner: unknown): owner is NameMapperOwnerToken_ACU {
  return !!owner && typeof owner === 'object' && _issuedNameMapperOwners_ACU.has(owner);
}

/** 更旧的 runtime 实例不得覆盖更新实例已经发布的映射。 */
function canPublishWithOwner_ACU(owner: NameMapperOwnerToken_ACU): boolean {
  if (!isNameMapperOwnerToken_ACU(owner)) return false;
  return !_globalNameMapperOwner_ACU || owner.id >= _globalNameMapperOwner_ACU.id;
}

function applyGlobalNameMapper_ACU(
  mapper: NameMapper,
  signature: string,
  owner: NameMapperOwnerToken_ACU,
): void {
  _globalNameMapper = mapper;
  _globalNameMapperSchemaSignature = signature;
  _globalNameMapperBinding_ACU = signature ? 'bound' : 'empty_schema';
  _globalNameMapperOwner_ACU = owner;
}

/**
 * 以 runtime 实例身份发布当前有效 DDL 集合对应的映射。
 *
 * @returns 是否实际发布；false 表示存在更新的发布者，本次调用被丢弃。
 */
export function publishGlobalNameMapperForDDLs_ACU(
  ddlMap: Map<string, string>,
  owner: NameMapperOwnerToken_ACU,
): boolean {
  if (!canPublishWithOwner_ACU(owner)) {
    logDebug_ACU('[NameMapper] 已存在更新的发布者，丢弃陈旧 runtime 的映射发布。');
    return false;
  }
  const nextSignature = buildDDLMapSignature_ACU(ddlMap);
  if (_globalNameMapperOwner_ACU === owner
    && _globalNameMapperBinding_ACU !== 'unbound'
    && _globalNameMapperSchemaSignature === nextSignature) {
    return true;
  }
  applyGlobalNameMapper_ACU(NameMapper.fromDDLs(ddlMap), nextSignature, owner);
  logDebug_ACU(`[NameMapper] 全局映射器已发布: ${_globalNameMapper!.tableCount} 张表`);
  return true;
}

/**
 * 标记 runtime 引擎已就绪但尚未建立任何表（新聊天首次填表前的正常状态）。
 * 与「mapper 意外丢失」区分：后者说明活跃 runtime 有表却没有可信映射，属于异常。
 *
 * @returns 是否实际发布；false 表示存在更新的发布者，本次调用被丢弃。
 */
export function publishGlobalNameMapperEmptySchema_ACU(owner: NameMapperOwnerToken_ACU): boolean {
  if (!canPublishWithOwner_ACU(owner)) {
    logDebug_ACU('[NameMapper] 已存在更新的发布者，丢弃陈旧 runtime 的空 schema 标记。');
    return false;
  }
  applyGlobalNameMapper_ACU(new NameMapper(), '', owner);
  return true;
}

/**
 * 以 runtime 实例身份释放映射。
 * 只有当前发布者才能把全局状态清成 unbound；已被置换的旧实例调用时为 no-op。
 *
 * @returns 是否实际释放。
 */
export function releaseGlobalNameMapperForOwner_ACU(owner: NameMapperOwnerToken_ACU): boolean {
  if (!isNameMapperOwnerToken_ACU(owner) || _globalNameMapperOwner_ACU !== owner) return false;
  disposeGlobalNameMapper();
  return true;
}

/**
 * 仅当 mapper 尚未绑定当前有效 schema 时重建。
 * 不能用 tableCount 判断就绪：不同模板可能拥有相同数量的表但列映射已经变化。
 *
 * 这是无所有权的兼容入口：它只能刷新尚无 runtime 持有的映射。
 * 任何 owned 状态（含 empty_schema）都不得由它改写，否则会出现
 * 「owner 是 A、内容却来自别处」的脱节，并让 A 的释放清掉不属于它的映射。
 * 活跃 runtime 需要按新 schema 刷新时，走 provider 自身的 owner-aware 发布。
 */
export function ensureGlobalNameMapperForDDLs_ACU(ddlMap: Map<string, string>): NameMapper {
  const nextSignature = buildDDLMapSignature_ACU(ddlMap);
  if (_globalNameMapperBinding_ACU !== 'unbound' && _globalNameMapperSchemaSignature === nextSignature) {
    return _globalNameMapper!;
  }
  if (_globalNameMapperOwner_ACU) {
    logWarn_ACU('[NameMapper] 当前映射由活跃 runtime 持有，已拒绝无所有权刷新；请通过 provider 的 owner-aware 刷新发布新 schema。');
    return getNameMapper();
  }
  _globalNameMapper = NameMapper.fromDDLs(ddlMap);
  _globalNameMapperSchemaSignature = nextSignature;
  _globalNameMapperBinding_ACU = nextSignature ? 'bound' : 'empty_schema';
  logDebug_ACU(`[NameMapper] 全局映射器已刷新: ${_globalNameMapper.tableCount} 张表`);
  return _globalNameMapper!;
}

/**
 * 解析运行时有效 DDL（包括缺失或无效 DDL 的 fallback）。
 * presentation 必须经 service 层使用该解析，不能直接依赖 data/sqlite。
 */
export function resolveRuntimeEffectiveDDL_ACU(
  sheet: Sheet_ACU,
  fallbackTableName?: string,
  runtimeTableName?: string,
): EffectiveDDLResult_ACU {
  return resolveEffectiveDDL(sheet, fallbackTableName, runtimeTableName);
}

/** 当前全局 mapper 是否精确对应给定的有效 DDL 集合。 */
export function isGlobalNameMapperCurrentForDDLs_ACU(ddlMap: Map<string, string>): boolean {
  return _globalNameMapperBinding_ACU !== 'unbound'
    && _globalNameMapperSchemaSignature === buildDDLMapSignature_ACU(ddlMap);
}

/** 供诊断使用；不暴露 DDL 内容，避免日志泄漏模板。 */
export function getGlobalNameMapperStatus_ACU(): {
  ready: boolean;
  tableCount: number;
  binding: 'unbound' | 'empty_schema' | 'bound';
} {
  return {
    ready: _globalNameMapperBinding_ACU === 'bound',
    tableCount: _globalNameMapper?.tableCount ?? 0,
    binding: _globalNameMapperBinding_ACU,
  };
}

/** 发布所有权诊断；只暴露标签与序号，不返回凭证对象本身。 */
export function getGlobalNameMapperOwnershipSnapshot_ACU(): {
  binding: 'unbound' | 'empty_schema' | 'bound';
  ownerLabel: string | null;
  ownerId: number | null;
} {
  return {
    binding: _globalNameMapperBinding_ACU,
    ownerLabel: _globalNameMapperOwner_ACU?.label ?? null,
    ownerId: _globalNameMapperOwner_ACU?.id ?? null,
  };
}

/**
 * 无条件销毁全局 NameMapper 并清除发布所有权。
 * 仅用于测试隔离与明确的顶层全局复位；runtime 生命周期请使用 owner-aware 释放。
 */
export function disposeGlobalNameMapper(): void {
  _globalNameMapper = null;
  _globalNameMapperSchemaSignature = null;
  _globalNameMapperBinding_ACU = 'unbound';
  _globalNameMapperOwner_ACU = null;
}

/**
 * 中英文名称双向映射器
 */
export class NameMapper {
  // 表名映射：中文 → 英文
  private tableNameMap: Map<string, string> = new Map();
  // 列名映射：表英文名.中文列名 → 英文列名
  // 仅保留可翻译的展示名，避免物理列自映射改变 translateSql 的输出。
  private columnNameMap: Map<string, string> = new Map();
  // 反向映射：物理列名 → 展示名；无注释物理列使用自身作为展示名，
  // 因此它同时是 CRUD 写入门禁可依赖的 runtime schema 存在性集合。
  private reverseTableMap: Map<string, string> = new Map();
  private reverseColumnMap: Map<string, string> = new Map();

  /** 映射的表数量 */
  get tableCount(): number {
    return this.reverseTableMap.size;
  }

  /**
   * 从多张表的 DDL 构建映射器
   *
   * Map key 是由完整 TableDataObject 分配的 runtime 物理表名；不能从
   * 用户可编辑的 DDL 文本重新推导，否则显示名与 DDL 名不一致时会向 SQLite
   * 发出不存在的表名。
   */
  static fromDDLs(ddlMap: Map<string, string>): NameMapper {
    const mapper = new NameMapper();

    for (const [physicalTableName, ddl] of ddlMap) {
      const englishTableName = String(physicalTableName || '').trim();
      if (!englishTableName || !ddl) continue;

      // 解析中文表名（DDL 第一行注释）
      const chineseTableName = parseDDLChineseName(ddl);
      if (chineseTableName) {
        mapper.tableNameMap.set(chineseTableName, englishTableName);
        mapper.reverseTableMap.set(englishTableName, chineseTableName);
      } else {
        // 没有中文注释，也记录英文名（用于 reverseTableMap）
        mapper.reverseTableMap.set(englishTableName, englishTableName);
      }

      // 解析列名注释
      const columnComments = parseDDLColumnComments(ddl);
      for (const [colName, comment] of columnComments) {
        if (comment && colName !== 'row_id') {
          const key = `${englishTableName}.${comment}`;
          mapper.columnNameMap.set(key, colName);
          mapper.reverseColumnMap.set(`${englishTableName}.${colName}`, comment);
        }
      }

      // 注释只提供展示名，不能决定物理列是否存在。显式 DDL 中常见 STR/DEX
      // 这类无注释 ASCII 列；若不登记它们，CRUD 的 fail-closed 门禁会误拒绝真实列。
      // 不覆盖上方的注释映射，保证有展示名的列仍可按中文表头解析。
      for (const column of parseDDLColumnInfos_ACU(ddl)) {
        const key = `${englishTableName}.${column.sqlName}`;
        if (!mapper.reverseColumnMap.has(key)) mapper.reverseColumnMap.set(key, column.sqlName);
      }
    }

    return mapper;
  }

  /**
   * 解析表名（中文→英文，英文直接返回）
   */
  resolveTableName(name: string): string {
    if (!name) return name;
    const trimmed = name.trim();
    // 先查中文映射
    const english = this.tableNameMap.get(trimmed);
    if (english) return english;
    // 检查是否本身就是英文表名
    if (this.reverseTableMap.has(trimmed)) return trimmed;
    // 未找到映射，原样返回
    return trimmed;
  }

  /**
   * 解析列名（中文→英文，英文直接返回）
   * @param tableName 英文表名（已解析过的）
   * @param columnName 列名（可能是中文或英文）
   */
  resolveColumnName(tableName: string, columnName: string): string {
    if (!columnName) return columnName;
    const trimmed = columnName.trim();
    // 先查中文映射
    const key = `${tableName}.${trimmed}`;
    const english = this.columnNameMap.get(key);
    if (english) return english;
    // 检查是否本身就是英文列名
    if (this.reverseColumnMap.has(`${tableName}.${trimmed}`)) return trimmed;
    // 未找到映射，原样返回（可能是英文名或未知名）
    return trimmed;
  }

  /** 指定表中是否存在已确认的中文展示列名或英文物理列名。 */
  hasColumnName(tableName: string, columnName: string): boolean {
    if (!tableName || !columnName) return false;
    const trimmed = columnName.trim();
    return this.columnNameMap.has(`${tableName}.${trimmed}`)
      || this.reverseColumnMap.has(`${tableName}.${trimmed}`)
      || trimmed === 'row_id';
  }

  /**
   * 反向：英文表名→中文（用于展示给用户）
   */
  getChineseTableName(englishName: string): string {
    return this.reverseTableMap.get(englishName) || englishName;
  }

  /**
   * 反向：英文列名→中文（用于展示给用户）
   */
  getChineseColumnName(tableName: string, englishName: string): string {
    return this.reverseColumnMap.get(`${tableName}.${englishName}`) || englishName;
  }

  /**
   * 将原生 SQL 中的中文名替换为英文名（跳过字符串值）
   *
   * 安全替换策略：
   * 1. 先把单引号字符串提取出来，用占位符替代
   * 2. 在安全的 SQL 上做中文→英文替换（长名称优先，避免子串误匹配）
   * 3. 把字符串值放回去
   */
  translateSql(sql: string): string {
    if (!sql) return sql;

    // 1. 提取单引号字符串，用占位符替代
    const strings: string[] = [];
    let safeSql = sql.replace(/'[^']*'/g, (match) => {
      strings.push(match);
      return `__STR_${strings.length - 1}__`;
    });

    // 2. 替换中文表名（长名称优先）
    const sortedTableNames = [...this.tableNameMap.entries()]
      .sort((a, b) => b[0].length - a[0].length);
    for (const [cn, en] of sortedTableNames) {
      safeSql = safeSql.split(cn).join(en);
    }

    // 3. 替换中文列名（长名称优先）
    const sortedColumnNames = [...this.columnNameMap.entries()]
      .map(([key, en]) => {
        const dotIndex = key.indexOf('.');
        const cn = key.substring(dotIndex + 1);
        return { cn, en };
      })
      .sort((a, b) => b.cn.length - a.cn.length);
    for (const { cn, en } of sortedColumnNames) {
      safeSql = safeSql.split(cn).join(en);
    }

    // 4. 把字符串值放回去
    safeSql = safeSql.replace(/__STR_(\d+)__/g, (_, i) => strings[Number(i)]);

    return safeSql;
  }

  /**
   * 获取所有英文表名
   */
  getAllTableNames(): string[] {
    return [...this.reverseTableMap.keys()];
  }
}
