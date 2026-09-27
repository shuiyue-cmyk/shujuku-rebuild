import { pinyin } from 'pinyin-pro';
import type { Sheet_ACU, TableDataObject_ACU } from './models/table-data';

export const SHEET_KEY_ALGORITHM_VERSION_ACU = 1;
export const MAX_SHEET_SLUG_LENGTH_ACU = 48;
export const PHYSICAL_TABLE_NAME_ALGORITHM_VERSION_ACU = 1;
const MAX_PHYSICAL_TABLE_NAME_LENGTH_ACU = 48;
const SQLITE_RESERVED_TABLE_PREFIXES_ACU = ['sqlite_', '_acu_'];

export interface SheetNameDiagnostic_ACU {
  code: 'empty_name' | 'duplicate_canonical_name' | 'duplicate_sheet_key';
  index: number;
  originalName: string;
  canonicalName: string;
  candidateKey: string | null;
  conflictsWithIndex?: number;
}

export interface ExistingSheetIdentity_ACU {
  canonicalName: string;
  sheetKey: string;
}

export interface StableSheetKeyAllocationOptions_ACU {
  /** Persisted identities are immutable: allocation may not rewrite their keys. */
  existing?: readonly ExistingSheetIdentity_ACU[];
}

export interface StableSheetKeyAllocation_ACU {
  keys: Array<string | null>;
  diagnostics: SheetNameDiagnostic_ACU[];
}

/** One physical-table-name collision: distinct sheetKeys resolving to the same slug. */
export interface PhysicalTableNameCollision_ACU {
  physicalTableName: string;
  sheetKeys: string[];
  sheetNames: string[];
  reason: 'identity_merge_failed' | 'homophone_distinct_names';
}

/**
 * Thrown when two distinct sheets resolve to the same physical table name.
 * This is a fail-loud signal: the user must rename one of the colliding tables.
 * It is never recovered from by silently mutating a name, because that would
 * reintroduce set-dependent drift.
 */
export class PhysicalTableNameCollisionError_ACU extends Error {
  readonly collisions: PhysicalTableNameCollision_ACU[];
  constructor(collisions: PhysicalTableNameCollision_ACU[]) {
    const detail = collisions
      .map(c => `「${c.physicalTableName}」← ${c.sheetNames.map((name, index) => `「${name}」(${c.sheetKeys[index]})`).join(' / ')}`)
      .join('；');
    const hasIdentityMergeFailure = collisions.some(collision => collision.reason === 'identity_merge_failed');
    super(hasIdentityMergeFailure
      ? `SQLite 物理表名冲突：相同规范表名被保留为多个 key，说明身份归并未完成；请检查历史数据与指导表的 key 对齐，并核对完整 sheetKey（大写 I、小写 l、数字 1 等字符在普通字体下极易混淆）。冲突：${detail}`
      : `SQLite 物理表名冲突：不同表的名称拼音相同，请重命名其中一张表。冲突：${detail}`);
    this.name = 'PhysicalTableNameCollisionError_ACU';
    this.collisions = collisions;
  }
}

/** Comparison-only normalization. Never write this value back to the display name. */
export function canonicalizeDisplayName_ACU(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

/* ═══════════════════════ 拼音 slug 记忆化（P1-7） ═══════════════════════
 *
 * toAsciiSlug_ACU 是 (规范化名, maxLength) 的纯函数，代价全在 pinyin-pro 上。
 * 它原本每次现算，而物理表名解析链（resolvePhysicalTableNames_ACU 每张表两次
 * slug）被冻结循环、hydrate 校验、写批表名映射等热循环逐表重复调用，实测
 * S=60 时一次冻结循环要跑 2S² = 7200 次拼音（S 20→60 耗时倍率 8.99，O(S²)）。
 *
 * 记忆化口径（与 shared/ddl-utils 的 DDL 解析记忆化同构）：
 * - 键＝规范化名 + 截断长度，即该纯函数的**全部**入参；不含 sheetKey、聊天、
 *   隔离键等任何作用域信息：slug 只由入参决定，跨作用域复用同一结果不会串味，
 *   反而不带作用域才允许跨聊天命中。
 * - 键不含 sheetKey 是刻意的：表改名后规范化名随之改变，旧条目自然失效，
 *   不会像 sheetKey 键那样命中陈旧物理名。
 * - 缓存条目数上限固定，超限整表清空（表名集合是有限集）；失败/异常路径不存在
 *   （本函数不会抛），因此无需「失败不记忆化」分支。
 * - 计数钩子仅测试打开（生产路径只有一次 Map 查找 + 一次布尔判断）。
 */
const SLUG_MEMO_LIMIT_ACU = 256;
const slugMemo_ACU = new Map<string, string>();

/** 拼音与整库解析的结构计数（仅测试打开；不设墙钟阈值）。 */
export interface SheetPhysicalNameCounters_ACU {
  /** toAsciiSlug_ACU 的总进入次数（含记忆化命中）。 */
  slugCalls: number;
  /** 真正跑过 pinyin-pro 的次数（记忆化未命中的键数）。 */
  slugComputes: number;
  /** 命中记忆化的次数。 */
  slugMemoHits: number;
  /** resolvePhysicalTableNames_ACU 真正解析整库的次数（O(S) 工作单元）。 */
  physicalResolves: number;
}

const physicalNameCounters_ACU: SheetPhysicalNameCounters_ACU = { slugCalls: 0, slugComputes: 0, slugMemoHits: 0, physicalResolves: 0 };
let physicalNameCountersEnabled_ACU = false;

/** 仅供测试：打开计数并清空记忆化。 */
export function __resetSheetPhysicalNameMemoForTests_ACU(): void {
  physicalNameCounters_ACU.slugCalls = 0;
  physicalNameCounters_ACU.slugComputes = 0;
  physicalNameCounters_ACU.slugMemoHits = 0;
  physicalNameCounters_ACU.physicalResolves = 0;
  physicalNameCountersEnabled_ACU = true;
  slugMemo_ACU.clear();
}

/** 仅供测试：读取计数快照。 */
export function __readSheetPhysicalNameCountersForTests_ACU(): SheetPhysicalNameCounters_ACU {
  return { ...physicalNameCounters_ACU };
}

/** Converts a display value to an ASCII slug using the locked pinyin-pro dictionary. */
export function toAsciiSlug_ACU(value: unknown, maxLength = MAX_SHEET_SLUG_LENGTH_ACU): string {
  const canonical = canonicalizeDisplayName_ACU(value);
  if (!canonical) return '';
  if (physicalNameCountersEnabled_ACU) physicalNameCounters_ACU.slugCalls += 1;
  const memoKey = `${maxLength}\u0000${canonical}`;
  const memoized = slugMemo_ACU.get(memoKey);
  if (memoized !== undefined) {
    if (physicalNameCountersEnabled_ACU) physicalNameCounters_ACU.slugMemoHits += 1;
    return memoized;
  }
  const romanized = pinyin(canonical, {
    toneType: 'none',
    traditional: true,
    v: true,
    separator: '_',
    nonZh: 'consecutive',
  });
  const slug = romanized.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, Math.max(1, maxLength))
    .replace(/_+$/g, '');
  if (physicalNameCountersEnabled_ACU) physicalNameCounters_ACU.slugComputes += 1;
  if (slugMemo_ACU.size >= SLUG_MEMO_LIMIT_ACU) slugMemo_ACU.clear();
  slugMemo_ACU.set(memoKey, slug);
  return slug;
}

/** Returns an unreserved candidate only; callers must allocate before persisting it. */
export function buildStableSheetKeyCandidate_ACU(displayName: unknown): string | null {
  const slug = toAsciiSlug_ACU(displayName);
  return slug ? `sheet_${slug}` : null;
}

/**
 * Runtime SQLite names are derived from the display name, not from a legacy
 * CREATE TABLE identifier embedded in user-authored DDL. Each name is a
 * deterministic pure function of the sheet's own display name and is
 * independent of which other sheets are present, so building/filling/exporting
 * always agree. Duplicate slugs are a hard error (see the fail-loud note below).
 */
export function resolvePhysicalTableNames_ACU(data: TableDataObject_ACU | Record<string, unknown>): Map<string, string> {
  if (physicalNameCountersEnabled_ACU) physicalNameCounters_ACU.physicalResolves += 1;
  const entries = Object.keys(data || {})
    .filter(sheetKey => sheetKey.startsWith('sheet_'))
    .sort()
    .map(sheetKey => ({ sheetKey, sheet: (data as Record<string, Sheet_ACU>)[sheetKey] }));
  // 物理表名是 sheetKey 的确定性纯函数（仅由该 sheet 的显示名 slug 决定），
  // 绝不依赖“当前还有哪些别的表在场”。这样建表、填表、导出三处对同一 sheetKey
  // 永远解析出同一个名字，从根上消除集合漂移导致的 no such table。
  //
  // 拼音 slug 相同但 sheetKey 不同 = 真实物理表名冲突。此处 fail-loud 抛出，
  // 而不是静默追加 hash 令两表分叉——静默重命名会随入参集合变化重新产生漂移。
  // 冲突应由启动自检提前拦截并提示用户改名（见 assertNoPhysicalTableNameCollision_ACU）。
  const result = new Map<string, string>();
  const ownerBySlug = new Map<string, { sheetKey: string; sheet: Sheet_ACU | null | undefined }>();
  const collisions: PhysicalTableNameCollision_ACU[] = [];
  for (const { sheetKey, sheet } of entries) {
    const base = physicalTableNameBase_ACU(sheet, sheetKey);
    const normalized = base.toLowerCase();
    const owner = ownerBySlug.get(normalized);
    if (owner && owner.sheetKey !== sheetKey) {
      collisions.push(buildPhysicalTableNameCollision_ACU(base, [owner.sheetKey, sheetKey], [owner.sheet, sheet]));
      continue;
    }
    ownerBySlug.set(normalized, { sheetKey, sheet });
    result.set(sheetKey, base);
  }
  if (collisions.length > 0) {
    throw new PhysicalTableNameCollisionError_ACU(collisions);
  }
  return result;
}

/**
 * Reads a sheetKey out of an already-resolved physical-name map (see
 * resolvePhysicalTableNames_ACU). Throws the same error as
 * getPhysicalTableNameForSheet_ACU when the sheetKey is absent.
 * Hot loops that hold a resolved map MUST use this instead of re-resolving
 * the whole table data per sheet (O(S^2) pinyin slug work).
 */
export function getPhysicalTableNameFromResolvedMap_ACU(
  resolved: ReadonlyMap<string, string>,
  sheetKey: string,
): string {
  const physicalName = resolved.get(sheetKey);
  if (!physicalName) throw new Error(`无法为 Sheet 分配 SQLite runtime 表名：${sheetKey}`);
  return physicalName;
}

export function getPhysicalTableNameForSheet_ACU(data: TableDataObject_ACU | Record<string, unknown>, sheetKey: string): string {
  return getPhysicalTableNameFromResolvedMap_ACU(resolvePhysicalTableNames_ACU(data), sheetKey);
}

/**
 * 热循环用的惰性物理表名解析器：整库只 resolve 一次，之后全部查表。
 *
 * 等价性（逐字、逐异常、逐抛错时机）：对固定 data，resolvePhysicalTableNames_ACU
 * 是纯函数，于是
 *   getPhysicalTableNameForSheet_ACU(data, k)
 *     ≡ getPhysicalTableNameFromResolvedMap_ACU(resolvePhysicalTableNames_ACU(data), k)
 * 本解析器只做一件事：把右侧那次 resolve **延迟到第一次 get**。
 * - 逐表路径在第 i 次 get 抛错时，本解析器也在第 i 次 get 抛同一个
 *   PhysicalTableNameCollisionError_ACU（同一句话、同一 collisions 明细）；
 * - 逐表路径在整循环都没走到解析点时（休眠表、缺 runtime schema descriptor 等
 *   提前 return/continue）不解析、也就不会抛撞名错，本解析器同样一次都不解析。
 * 因此把循环内的 `getPhysicalTableNameForSheet_ACU(data, k)` 换成
 * `resolver.get(k)`（data 在循环内不变）是纯性能替换，不改任何判定。
 * 碰撞消解规则完全由 resolvePhysicalTableNames_ACU 决定（fail-loud，不追加
 * hash、不按入参集合分叉），两条路径不存在规则差异的可能。
 */
export interface PhysicalTableNameResolver_ACU {
  /** 与 getPhysicalTableNameForSheet_ACU(data, sheetKey) 逐字同结果、同异常。 */
  get(sheetKey: string): string;
  /** 已解析的整库映射；首次 get 之前为 null（用于诊断与测试）。 */
  readonly resolved: ReadonlyMap<string, string> | null;
}

export function createPhysicalTableNameResolver_ACU(
  data: TableDataObject_ACU | Record<string, unknown>,
): PhysicalTableNameResolver_ACU {
  let resolved: ReadonlyMap<string, string> | null = null;
  return {
    get(sheetKey: string): string {
      if (!resolved) resolved = resolvePhysicalTableNames_ACU(data);
      return getPhysicalTableNameFromResolvedMap_ACU(resolved, sheetKey);
    },
    get resolved(): ReadonlyMap<string, string> | null {
      return resolved;
    },
  };
}

/** Use resolvePhysicalTableNames_ACU whenever collision arbitration is possible. */
export function resolvePhysicalTableName_ACU(sheet: Sheet_ACU | null | undefined, sheetKey: string): string {
  return physicalTableNameBase_ACU(sheet, sheetKey);
}

function physicalTableNameBase_ACU(sheet: Sheet_ACU | null | undefined, sheetKey: string): string {
  const displaySlug = toAsciiSlug_ACU(sheet?.name).replace(/_/g, '');
  // 显示名 slug 非空时 keySlug 是死值（下面 `displaySlug || keySlug` 必然短路），
  // 跳过计算只为省掉一次拼音；产出的 candidate 与旧写法逐字相同。
  const keySlug = displaySlug
    ? ''
    : toAsciiSlug_ACU(String(sheetKey || '').replace(/^sheet_/, '')).replace(/_/g, '');
  let candidate = (displaySlug || keySlug || 'sheet').slice(0, MAX_PHYSICAL_TABLE_NAME_LENGTH_ACU);
  if (/^[0-9]/.test(candidate) || SQLITE_RESERVED_TABLE_PREFIXES_ACU.some(prefix => candidate.toLowerCase().startsWith(prefix))) {
    candidate = `table_${candidate}`;
  }
  return candidate.slice(0, MAX_PHYSICAL_TABLE_NAME_LENGTH_ACU) || 'table_sheet';
}

/**
 * Detects physical-table-name collisions without throwing. Startup self-check
 * uses this to fail loud before any DDL runs. Returns [] when every sheet maps
 * to a unique physical name.
 */
export function detectPhysicalTableNameCollisions_ACU(
  data: TableDataObject_ACU | Record<string, unknown>,
): PhysicalTableNameCollision_ACU[] {
  const ownerBySlug = new Map<string, { sheetKey: string; base: string; sheet: Sheet_ACU | null | undefined }>();
  const grouped = new Map<string, { physicalTableName: string; sheetKeys: string[]; sheets: Array<Sheet_ACU | null | undefined> }>();
  const entries = Object.keys(data || {})
    .filter(sheetKey => sheetKey.startsWith('sheet_'))
    .sort()
    .map(sheetKey => ({ sheetKey, sheet: (data as Record<string, Sheet_ACU>)[sheetKey] }));
  for (const { sheetKey, sheet } of entries) {
    const base = physicalTableNameBase_ACU(sheet, sheetKey);
    const normalized = base.toLowerCase();
    const owner = ownerBySlug.get(normalized);
    if (!owner) {
      ownerBySlug.set(normalized, { sheetKey, base, sheet });
      continue;
    }
    if (owner.sheetKey === sheetKey) continue;
    const collision = grouped.get(normalized) || { physicalTableName: owner.base, sheetKeys: [owner.sheetKey], sheets: [owner.sheet] };
    collision.sheetKeys.push(sheetKey);
    collision.sheets.push(sheet);
    grouped.set(normalized, collision);
  }
  return [...grouped.values()].map(collision => buildPhysicalTableNameCollision_ACU(collision.physicalTableName, collision.sheetKeys, collision.sheets));
}

function buildPhysicalTableNameCollision_ACU(
  physicalTableName: string,
  sheetKeys: string[],
  sheets: Array<Sheet_ACU | null | undefined>,
): PhysicalTableNameCollision_ACU {
  const sheetNames = sheets.map((sheet, index) => String(sheet?.name || sheetKeys[index]));
  const canonicalNames = sheetNames.map(canonicalizeDisplayName_ACU);
  return {
    physicalTableName,
    sheetKeys,
    sheetNames,
    reason: canonicalNames.length > 0 && canonicalNames.every(name => name === canonicalNames[0])
      ? 'identity_merge_failed'
      : 'homophone_distinct_names',
  };
}

/** Startup guard: throws PhysicalTableNameCollisionError_ACU when any collision exists. */
export function assertNoPhysicalTableNameCollision_ACU(
  data: TableDataObject_ACU | Record<string, unknown>,
): void {
  const collisions = detectPhysicalTableNameCollisions_ACU(data);
  if (collisions.length > 0) {
    throw new PhysicalTableNameCollisionError_ACU(collisions);
  }
}

/**
 * Allocates identities for a new batch while preserving supplied persisted identities verbatim.
 * Colliding slugs receive a canonical-name hash, so new-key selection is input-order independent.
 */
export function allocateStableSheetKeys_ACU(
  displayNames: readonly unknown[],
  options: StableSheetKeyAllocationOptions_ACU = {},
): StableSheetKeyAllocation_ACU {
  const canonicalNames = displayNames.map(canonicalizeDisplayName_ACU);
  const slugs = displayNames.map(name => toAsciiSlug_ACU(name));
  const diagnostics: SheetNameDiagnostic_ACU[] = [];
  const firstCanonicalIndex = new Map<string, number>();
  const slugGroups = new Map<string, number[]>();
  const existingByCanonicalName = new Map<string, string>();
  const reservedKeys = new Set<string>();
  for (const existing of options.existing || []) {
    const canonicalName = canonicalizeDisplayName_ACU(existing.canonicalName);
    const sheetKey = String(existing.sheetKey || '');
    if (canonicalName && sheetKey) existingByCanonicalName.set(canonicalName, sheetKey);
    if (sheetKey) reservedKeys.add(sheetKey.toLowerCase());
  }

  canonicalNames.forEach((canonicalName, index) => {
    const originalName = String(displayNames[index] ?? '');
    if (!canonicalName || !slugs[index]) {
      diagnostics.push({ code: 'empty_name', index, originalName, canonicalName, candidateKey: null });
      return;
    }
    const firstIndex = firstCanonicalIndex.get(canonicalName);
    if (firstIndex === undefined) firstCanonicalIndex.set(canonicalName, index);
    else diagnostics.push({ code: 'duplicate_canonical_name', index, originalName, canonicalName, candidateKey: null, conflictsWithIndex: firstIndex });
    const group = slugGroups.get(slugs[index]) || [];
    group.push(index);
    slugGroups.set(slugs[index], group);
  });

  const keys: Array<string | null> = slugs.map((slug, index) => {
    if (!slug || !canonicalNames[index]) return null;
    const existingKey = existingByCanonicalName.get(canonicalNames[index]);
    if (existingKey) return existingKey;
    const group = slugGroups.get(slug) || [];
    const bareKey = `sheet_${slug}`;
    if (group.length === 1 && !reservedKeys.has(bareKey.toLowerCase())) return bareKey;
    return `sheet_${truncateForHash_ACU(slug)}_${stableHash_ACU(canonicalNames[index])}`;
  });
  const firstKeyIndex = new Map<string, number>();
  keys.forEach((key, index) => {
    if (!key) return;
    const firstIndex = firstKeyIndex.get(key);
    if (firstIndex === undefined) {
      firstKeyIndex.set(key, index);
    } else {
      diagnostics.push({ code: 'duplicate_sheet_key', index, originalName: String(displayNames[index] ?? ''), canonicalName: canonicalNames[index], candidateKey: key, conflictsWithIndex: firstIndex });
    }
    if (!existingByCanonicalName.has(canonicalNames[index]) && reservedKeys.has(key.toLowerCase())) {
      diagnostics.push({ code: 'duplicate_sheet_key', index, originalName: String(displayNames[index] ?? ''), canonicalName: canonicalNames[index], candidateKey: key });
    }
  });
  return { keys, diagnostics };
}

function truncateForHash_ACU(slug: string): string {
  return slug.slice(0, Math.max(1, MAX_SHEET_SLUG_LENGTH_ACU - 11)).replace(/_+$/g, '') || 'sheet';
}

function stableHash_ACU(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const char of value) {
    hash ^= BigInt(char.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0').slice(0, 10);
}
