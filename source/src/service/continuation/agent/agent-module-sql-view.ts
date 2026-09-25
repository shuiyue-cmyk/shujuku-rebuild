/**
 * service/continuation/agent/agent-module-sql-view.ts — 续写资料快照的 SQL 易失视图（TT）
 *
 * 把折叠后的楼层快照物化进独立 SqliteEngine 内存库：六个 id 键模块一模块一表，
 * 条目 id 为主键，模块 revision 入 module_meta 表。行级 upsert/remove 与 revision
 * 校验在 SQL 层完成，变更行经 module_changes 追踪后可导出为楼层 delta 形态。
 *
 * (module,id,field) 逐栏层（S11-TT 双模 Mode F 复算用）：field_records/field_values
 * 物化折叠派生的分栏视图；applyFieldBatch 把一次逐栏提交接受的栏目写入作为单批次
 * 复算——乐观锁、栏名白名单与状态推导（complete/partial/legacy_unknown）与折叠语义
 * 同序；field_changes 追踪后由 exportDelta 追加导出 fieldUpserts。栏目值比较一律用
 * 键序无关的规范化 JSON。TT 适配：分栏层只跟踪栏目写集，不做领域提升、不碰领域
 * 表、不推进模块 revision（T2 锁定：partial/complete 均不投影领域数组，完整条目只
 * 由整条 writes 路径产生）；userRequirements 单例不进分栏矩阵。
 *
 * TT 适配（相对上游 0de0352）：
 * - 仅覆盖六个 id 键模块（hooks/infoGap/constraints/storyArc/chronology/webRefs）；
 *   userRequirements 字符串单例不进分栏矩阵、不经行视图写旁路（T5：全量替换走快照整写）。
 *   单例数组与 revision.userRequirements 仍随基线进库/读回，保证快照往返完整，但
 *   applyRowWrite 拒绝 userRequirements 与一切未知模块（越界 fail-closed）。
 * - 基线标量按本地快照形状保存：settledThroughIndex / updatedAt / pendingFixes /
 *   settledPrefixFingerprint（可选）。上游的 materialCompletion 在 TT 快照不存在，不处理。
 * - 本视图只读复算：生产写一律走既有事务/SQL 链路（agent-transaction ViaSql 先 JSON
 *   事务、再 SQL 行级复算；SQL 物化或执行失败 fail-closed 回退 JSON 结果，不静默产出
 *   空资料）。exportDelta 仅供单测/诊断，绝不接入工作流与主循环的持久化路径。
 *   分栏层同理：applyFieldBatch 只做提交前复算校验，持久化唯一形态仍是帧内
 *   fieldUpserts delta（planAgentModuleFieldWrite 路径）。
 * - 知识边界外资料不得经行视图泄漏进提示词：物化仅接受已知模块，未知模块的写与
 *   导出一律拒绝/跳过；readSnapshot 只返回已知字段。
 */

import { SqliteEngine } from '../../../data/sqlite/sqlite-engine';
import {
  AGENT_MODULE_FIELD_MATRIX_ACU,
  AGENT_MODULE_SCHEMA_VERSION_ACU,
  AGENT_WRITABLE_MODULES_ACU,
  type AgentModuleFieldRecord_ACU,
  type AgentModuleFieldSnapshot_ACU,
  type AgentModuleFieldStatus_ACU,
  type AgentModuleFieldUpserts_ACU,
  type AgentModuleFieldValue_ACU,
  type AgentModuleFieldWrite_ACU,
  type AgentModuleFloorDelta_ACU,
  type AgentModuleRevisions_ACU,
  type AgentModuleSnapshot_ACU,
  type AgentWritableModule_ACU,
} from './agent-model';

const MODULE_TABLE_PREFIX_ACU = 'mod_';
const BASE_TABLE_ACU = 'snapshot_base';
const META_TABLE_ACU = 'module_meta';
const CHANGES_TABLE_ACU = 'module_changes';
const FIELD_RECORDS_TABLE_ACU = 'field_records';
const FIELD_VALUES_TABLE_ACU = 'field_values';
const FIELD_CHANGES_TABLE_ACU = 'field_changes';

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 键序无关的 JSON 文本，用于比较栏目值是否真的变化。 */
function canonicalJson_ACU(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson_ACU).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson_ACU(record[key])}`).join(',')}}`;
}

function entryId_ACU(item: unknown): string {
  if (!isRecord_ACU(item) || typeof item.id !== 'string' || !item.id.trim()) return '';
  return item.id;
}

function isWritableModule_ACU(value: unknown): value is AgentWritableModule_ACU {
  return typeof value === 'string' && (AGENT_WRITABLE_MODULES_ACU as readonly string[]).includes(value);
}

function moduleTable_ACU(module: AgentWritableModule_ACU): string {
  return `${MODULE_TABLE_PREFIX_ACU}${module}`;
}

/** SQL 视图层结构化失败：消息含模块与期望/实际 revision，供 fail-closed 诊断。 */
export class AgentModuleSqlViewError_ACU extends Error {
  readonly module?: string;
  readonly expected?: number;
  readonly actual?: number;
  constructor(message: string, detail?: { module?: string; expected?: number; actual?: number }) {
    super(message);
    this.name = 'AgentModuleSqlViewError_ACU';
    this.module = detail?.module;
    this.expected = detail?.expected;
    this.actual = detail?.actual;
  }
}

/** 一次行级写：按 id upsert/remove；expectedRevision 是模块 revision 乐观锁期望值。 */
export interface AgentModuleSqlRowWrite_ACU {
  module: AgentWritableModule_ACU;
  upserts?: readonly unknown[];
  removedIds?: readonly string[];
  /** 模块当前 revision 的乐观锁期望值；不匹配即在 SQL 层拒绝。 */
  expectedRevision: number;
}

/**
 * 一次逐栏提交批次（S11-TT Mode F 复算用）。
 * 与折叠语义同序复算：栏目写入落分栏层，再按 required 矩阵推导 complete/partial。
 * 一批一次乐观锁；分栏层不碰领域表、不推进模块 revision（T2 锁定）。
 */
export interface AgentModuleSqlFieldBatch_ACU {
  module: AgentWritableModule_ACU;
  expectedRevision: number;
  /** 写进栏目与记录的时间戳。 */
  updatedAt: number;
  /** 接受的逐栏写入：ID → 栏目 → 写入值。 */
  fieldWrites?: Record<string, Record<string, AgentModuleFieldWrite_ACU>>;
  /** 丢弃的 partial 草稿 ID；无栏目草稿删除即空操作。 */
  discardPartialIds?: readonly string[];
}

export interface AgentModuleSqlView_ACU {
  readonly engine: SqliteEngine;
  /** 是否有尚未导出的变更行（含逐栏变更）。 */
  hasChanges(): boolean;
  /** 行写并推进模块 revision；冲突或非法输入抛 AgentModuleSqlViewError_ACU。 */
  applyRowWrite(input: AgentModuleSqlRowWrite_ACU): number;
  /** 逐栏提交批次复算：一批一次乐观锁；非法输入抛 AgentModuleSqlViewError_ACU。 */
  applyFieldBatch(input: AgentModuleSqlFieldBatch_ACU): number;
  /**
   * 导出变更行为楼层 delta 输入形态（含逐栏 fieldUpserts）；导出后清空变更追踪。
   * 仅供单测/诊断：生产持久化绝不经此旁路，一律走既有事务/SQL 链路。
   */
  exportDelta(): Pick<AgentModuleFloorDelta_ACU, 'writes' | 'removedIds' | 'revisions' | 'fieldUpserts'>;
  /** 从库读回完整快照（标量字段沿用物化时的基线值）。 */
  readSnapshot(): AgentModuleSnapshot_ACU;
  /** 读单条分栏记录（partial 的缺栏按模型必填栏推导）；不存在返回 null。 */
  readFieldRecord(module: AgentWritableModule_ACU, id: string): AgentModuleFieldRecord_ACU | null;
  /** 读全部（或单模块）partial 草稿记录。 */
  readPartialRecords(module?: AgentWritableModule_ACU): AgentModuleFieldRecord_ACU[];
  dispose(): void;
}

function createSchema_ACU(engine: SqliteEngine): void {
  for (const module of AGENT_WRITABLE_MODULES_ACU) {
    engine.run(`CREATE TABLE ${moduleTable_ACU(module)} (id TEXT PRIMARY KEY, payload TEXT NOT NULL)`);
  }
  engine.run(`CREATE TABLE ${META_TABLE_ACU} (module TEXT PRIMARY KEY, revision INTEGER NOT NULL)`);
  engine.run(`CREATE TABLE ${CHANGES_TABLE_ACU} (seq INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, change_key TEXT NOT NULL, change_kind TEXT NOT NULL, payload TEXT)`);
  engine.run(`CREATE TABLE ${BASE_TABLE_ACU} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  engine.run(`CREATE TABLE ${FIELD_RECORDS_TABLE_ACU} (module TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (module, id))`);
  engine.run(`CREATE TABLE ${FIELD_VALUES_TABLE_ACU} (module TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (module, id, field))`);
  engine.run(`CREATE TABLE ${FIELD_CHANGES_TABLE_ACU} (seq INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL)`);
}

function readRevision_ACU(engine: SqliteEngine, module: AgentWritableModule_ACU | 'userRequirements'): number {
  const rows = engine.query(`SELECT revision FROM ${META_TABLE_ACU} WHERE module = ?`, [module]).values;
  if (!rows.length) return 0;
  const value = Number(rows[0][0]);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function recordChange_ACU(engine: SqliteEngine, module: string, key: string, kind: 'upsert' | 'remove', payload: string | null): void {
  engine.run(`INSERT INTO ${CHANGES_TABLE_ACU} (module, change_key, change_kind, payload) VALUES (?, ?, ?, ?)`, [module, key, kind, payload]);
}

interface FieldRecordRow_ACU {
  status: AgentModuleFieldStatus_ACU;
  updatedAt: number;
}

function readFieldRecordRow_ACU(engine: SqliteEngine, module: string, id: string): FieldRecordRow_ACU | null {
  const rows = engine.query(`SELECT status, updated_at FROM ${FIELD_RECORDS_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]).values;
  if (!rows.length) return null;
  return { status: String(rows[0][0]) as AgentModuleFieldStatus_ACU, updatedAt: Number(rows[0][1]) };
}

interface FieldValueRow_ACU {
  canonical: string;
  revision: number;
  updatedAt: number;
}

function readFieldValueRows_ACU(engine: SqliteEngine, module: string, id: string): Map<string, FieldValueRow_ACU> {
  const rows = engine.query(`SELECT field, value, revision, updated_at FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]).values;
  const map = new Map<string, FieldValueRow_ACU>();
  for (const row of rows) {
    map.set(String(row[0]), { canonical: String(row[1]), revision: Number(row[2]), updatedAt: Number(row[3]) });
  }
  return map;
}

function recordFieldChange_ACU(engine: SqliteEngine, module: string, id: string, field: string): void {
  engine.run(`INSERT INTO ${FIELD_CHANGES_TABLE_ACU} (module, id, field) VALUES (?, ?, ?)`, [module, id, field]);
}

function recomputeFieldStatus_ACU(module: AgentWritableModule_ACU, fields: Map<string, FieldValueRow_ACU>): AgentModuleFieldStatus_ACU {
  const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[module];
  return matrix.required.every(field => fields.has(field)) ? 'complete' : 'partial';
}

/**
 * 物化分栏视图：提供折叠派生视图（fields）时按原样装载；未提供时只播种空视图
 * （T2 锁定：领域条目不自动播种为 legacy_unknown——legacy_unknown 只由折叠派生，
 * SQL 视图不自创血统）。栏目 revision 沿用装载值。
 */
function loadFieldView_ACU(engine: SqliteEngine, fields: AgentModuleFieldSnapshot_ACU | undefined): void {
  if (!fields) return;
  for (const module of AGENT_WRITABLE_MODULES_ACU) {
    const bucket = fields.records[module];
    if (!bucket) continue;
    const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[module];
    for (const [rawId, record] of Object.entries(bucket)) {
      const id = String(record.id || rawId).trim();
      const entries = Object.entries(record.fields ?? {});
      if (!id || !entries.length) continue;
      engine.run(
        `INSERT INTO ${FIELD_RECORDS_TABLE_ACU} (module, id, status, updated_at) VALUES (?, ?, ?, ?)`,
        [module, id, record.status, record.updatedAt],
      );
      for (const [field, entry] of entries) {
        if (!matrix.fields.includes(field)) continue;
        engine.run(
          `INSERT INTO ${FIELD_VALUES_TABLE_ACU} (module, id, field, value, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [module, id, field, canonicalJson_ACU(entry.value), entry.revision, entry.updatedAt],
        );
      }
    }
  }
}

function buildFieldRecord_ACU(engine: SqliteEngine, module: AgentWritableModule_ACU, id: string, row: FieldRecordRow_ACU): AgentModuleFieldRecord_ACU {
  const values = readFieldValueRows_ACU(engine, module, id);
  const fields: Record<string, AgentModuleFieldValue_ACU> = {};
  for (const [field, entry] of values) {
    fields[field] = { value: JSON.parse(entry.canonical), revision: entry.revision, updatedAt: entry.updatedAt };
  }
  const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[module];
  return {
    module,
    id,
    status: row.status,
    fields,
    missingFields: row.status === 'partial' ? matrix.required.filter(field => !Object.prototype.hasOwnProperty.call(fields, field)) : [],
    updatedAt: row.updatedAt,
  };
}

function readFieldRecord_ACU(engine: SqliteEngine, module: AgentWritableModule_ACU, id: string): AgentModuleFieldRecord_ACU | null {
  if (!isWritableModule_ACU(module)) throw new AgentModuleSqlViewError_ACU(`未知资料模块: ${String(module)}`);
  const normalized = String(id ?? '').trim();
  if (!normalized) return null;
  const row = readFieldRecordRow_ACU(engine, module, normalized);
  if (!row) return null;
  return buildFieldRecord_ACU(engine, module, normalized, row);
}

function readPartialRecords_ACU(engine: SqliteEngine, module?: AgentWritableModule_ACU): AgentModuleFieldRecord_ACU[] {
  if (module !== undefined && !isWritableModule_ACU(module)) throw new AgentModuleSqlViewError_ACU(`未知资料模块: ${String(module)}`);
  const records: AgentModuleFieldRecord_ACU[] = [];
  for (const key of module ? [module] : AGENT_WRITABLE_MODULES_ACU) {
    const rows = engine.query(`SELECT id, updated_at FROM ${FIELD_RECORDS_TABLE_ACU} WHERE module = ? AND status = 'partial' ORDER BY id`, [key]).values;
    for (const row of rows) {
      records.push(buildFieldRecord_ACU(engine, key, String(row[0]), { status: 'partial', updatedAt: Number(row[1]) }));
    }
  }
  return records;
}

function loadSnapshot_ACU(engine: SqliteEngine, snapshot: AgentModuleSnapshot_ACU): void {
  for (const module of AGENT_WRITABLE_MODULES_ACU) {
    for (const entry of snapshot[module] as readonly unknown[]) {
      const id = entryId_ACU(entry);
      if (!id) throw new AgentModuleSqlViewError_ACU(`模块 ${module} 存在无 id 条目，无法物化进 SQL 视图`, { module });
      engine.run(`INSERT INTO ${moduleTable_ACU(module)} (id, payload) VALUES (?, ?)`, [id, JSON.stringify(entry)]);
    }
    engine.run(`INSERT INTO ${META_TABLE_ACU} (module, revision) VALUES (?, ?)`, [module, snapshot.revisions[module]]);
  }
  engine.run(`INSERT INTO ${META_TABLE_ACU} (module, revision) VALUES (?, ?)`, ['userRequirements', snapshot.revisions.userRequirements]);
  engine.run(`INSERT INTO ${BASE_TABLE_ACU} (key, value) VALUES ('settledThroughIndex', ?)`, [String(snapshot.settledThroughIndex)]);
  engine.run(`INSERT INTO ${BASE_TABLE_ACU} (key, value) VALUES ('updatedAt', ?)`, [String(snapshot.updatedAt)]);
  engine.run(`INSERT INTO ${BASE_TABLE_ACU} (key, value) VALUES ('userRequirements', ?)`, [JSON.stringify(snapshot.userRequirements)]);
  engine.run(`INSERT INTO ${BASE_TABLE_ACU} (key, value) VALUES ('pendingFixes', ?)`, [JSON.stringify(snapshot.pendingFixes)]);
  if (snapshot.settledPrefixFingerprint) {
    engine.run(`INSERT INTO ${BASE_TABLE_ACU} (key, value) VALUES ('settledPrefixFingerprint', ?)`, [snapshot.settledPrefixFingerprint]);
  }
}

function applyRowWrite_ACU(engine: SqliteEngine, input: AgentModuleSqlRowWrite_ACU): number {
  if (!isWritableModule_ACU(input.module)) {
    throw new AgentModuleSqlViewError_ACU(`未知资料模块: ${String((input as { module?: unknown }).module)}`);
  }
  const module = input.module;
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new AgentModuleSqlViewError_ACU(`模块 ${module} 的 expectedRevision 非法: ${String(input.expectedRevision)}`, { module });
  }
  for (const item of input.upserts ?? []) {
    if (!entryId_ACU(item)) throw new AgentModuleSqlViewError_ACU(`模块 ${module} upsert 条目缺少合法 id`, { module });
  }
  for (const id of input.removedIds ?? []) {
    if (typeof id !== 'string' || !id.trim()) throw new AgentModuleSqlViewError_ACU(`模块 ${module} removedIds 含非法 id`, { module });
  }
  const table = moduleTable_ACU(module);
  engine.run('BEGIN');
  try {
    const current = readRevision_ACU(engine, module);
    if (current !== input.expectedRevision) {
      throw new AgentModuleSqlViewError_ACU(`模块 ${module} revision 冲突：期望 ${input.expectedRevision}，实际 ${current}`, { module, expected: input.expectedRevision, actual: current });
    }
    for (const id of input.removedIds ?? []) {
      engine.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
      recordChange_ACU(engine, module, id, 'remove', null);
    }
    for (const item of input.upserts ?? []) {
      const id = entryId_ACU(item);
      engine.run(`INSERT INTO ${table} (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`, [id, JSON.stringify(item)]);
      recordChange_ACU(engine, module, id, 'upsert', JSON.stringify(item));
    }
    const next = current + 1;
    engine.run(`UPDATE ${META_TABLE_ACU} SET revision = ? WHERE module = ?`, [next, module]);
    engine.run('COMMIT');
    return next;
  } catch (error) {
    try { engine.run('ROLLBACK'); } catch { /* 引擎自身已失败，保留原始错误向上抛 */ }
    throw error;
  }
}

interface ChangeState_ACU {
  kind: 'upsert' | 'remove';
  payload: string | null;
}

/**
 * 逐栏批次复算（S11-TT Mode F 提交前校验用）。
 * 只写分栏层：乐观锁先行；未知栏目/非法 id/空批次抛错；值未变的栏目不推进栏目
 * revision；unset 撤销不存在的栏目即空操作；丢弃无栏目的草稿即空操作。
 * 不碰领域表、不推进模块 revision——生产持久化仍走帧内 fieldUpserts delta。
 */
function applyFieldBatch_ACU(engine: SqliteEngine, input: AgentModuleSqlFieldBatch_ACU): number {
  if (!isWritableModule_ACU(input.module)) {
    throw new AgentModuleSqlViewError_ACU(`未知资料模块: ${String((input as { module?: unknown }).module)}`);
  }
  const module = input.module;
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new AgentModuleSqlViewError_ACU(`模块 ${module} 的 expectedRevision 非法: ${String(input.expectedRevision)}`, { module });
  }
  if (!Number.isFinite(input.updatedAt) || input.updatedAt < 0) {
    throw new AgentModuleSqlViewError_ACU(`模块 ${module} 的 updatedAt 非法: ${String(input.updatedAt)}`, { module });
  }
  const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[module];
  const writeIds = new Map<string, Record<string, AgentModuleFieldWrite_ACU>>();
  for (const [rawId, writes] of Object.entries(input.fieldWrites ?? {})) {
    const id = String(rawId ?? '').trim();
    if (!id) throw new AgentModuleSqlViewError_ACU(`模块 ${module} 逐栏写入含非法 id`, { module });
    if (!isRecord_ACU(writes)) throw new AgentModuleSqlViewError_ACU(`模块 ${module}#${id} 的栏目写集必须是对象`, { module });
    const merged = writeIds.get(id) ?? {};
    for (const [field, write] of Object.entries(writes)) {
      if (!matrix.fields.includes(field)) {
        throw new AgentModuleSqlViewError_ACU(`模块 ${module}#${id} 的栏目 ${field} 不在栏目矩阵`, { module });
      }
      if (!isRecord_ACU(write) || (write.unset !== true && !Object.prototype.hasOwnProperty.call(write, 'value'))) {
        throw new AgentModuleSqlViewError_ACU(`模块 ${module}#${id} 的栏目 ${field} 写入必须给 value 或 unset`, { module });
      }
      merged[field] = write;
    }
    writeIds.set(id, merged);
  }
  const discardIds = new Set<string>();
  for (const rawId of input.discardPartialIds ?? []) {
    const id = String(rawId ?? '').trim();
    if (!id) throw new AgentModuleSqlViewError_ACU(`模块 ${module} 草稿丢弃含非法 id`, { module });
    discardIds.add(id);
  }
  if (!writeIds.size && !discardIds.size) {
    throw new AgentModuleSqlViewError_ACU(`模块 ${module} 的逐栏批次为空`, { module });
  }
  engine.run('BEGIN');
  try {
    const current = readRevision_ACU(engine, module);
    if (current !== input.expectedRevision) {
      throw new AgentModuleSqlViewError_ACU(`模块 ${module} revision 冲突：期望 ${input.expectedRevision}，实际 ${current}`, { module, expected: input.expectedRevision, actual: current });
    }
    for (const [id, writes] of writeIds) {
      engine.run(
        `INSERT INTO ${FIELD_RECORDS_TABLE_ACU} (module, id, status, updated_at) VALUES (?, ?, 'partial', ?) ON CONFLICT(module, id) DO NOTHING`,
        [module, id, input.updatedAt],
      );
      for (const [field, write] of Object.entries(writes)) {
        const rows = engine.query(`SELECT value, revision FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ? AND field = ?`, [module, id, field]).values;
        if (write.unset === true) {
          if (rows.length) {
            engine.run(`DELETE FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ? AND field = ?`, [module, id, field]);
          }
          recordFieldChange_ACU(engine, module, id, field);
          continue;
        }
        const canonical = canonicalJson_ACU(write.value);
        if (rows.length && String(rows[0][0]) === canonical) {
          recordFieldChange_ACU(engine, module, id, field);
          continue;
        }
        const revision = rows.length ? Number(rows[0][1]) + 1 : 1;
        engine.run(
          `INSERT INTO ${FIELD_VALUES_TABLE_ACU} (module, id, field, value, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(module, id, field) DO UPDATE SET value = excluded.value, revision = excluded.revision, updated_at = excluded.updated_at`,
          [module, id, field, canonical, revision, input.updatedAt],
        );
        recordFieldChange_ACU(engine, module, id, field);
      }
      const remaining = readFieldValueRows_ACU(engine, module, id);
      const status = remaining.size ? recomputeFieldStatus_ACU(module, remaining) : 'partial';
      if (!remaining.size) {
        engine.run(`DELETE FROM ${FIELD_RECORDS_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]);
      } else {
        engine.run(`UPDATE ${FIELD_RECORDS_TABLE_ACU} SET status = ?, updated_at = ? WHERE module = ? AND id = ?`, [status, input.updatedAt, module, id]);
      }
    }
    for (const id of discardIds) {
      const values = readFieldValueRows_ACU(engine, module, id);
      for (const field of values.keys()) recordFieldChange_ACU(engine, module, id, field);
      engine.run(`DELETE FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]);
      engine.run(`DELETE FROM ${FIELD_RECORDS_TABLE_ACU} WHERE module = ? AND id = ?`, [module, id]);
    }
    engine.run('COMMIT');
    return current;
  } catch (error) {
    try { engine.run('ROLLBACK'); } catch { /* 引擎自身已失败，保留原始错误向上抛 */ }
    throw error;
  }
}

function exportDelta_ACU(engine: SqliteEngine): Pick<AgentModuleFloorDelta_ACU, 'writes' | 'removedIds' | 'revisions' | 'fieldUpserts'> {
  const rows = engine.query(`SELECT module, change_key, change_kind, payload FROM ${CHANGES_TABLE_ACU} ORDER BY seq`).values;
  const byModule = new Map<string, Map<string, ChangeState_ACU>>();
  for (const row of rows) {
    const module = String(row[0]);
    let bucket = byModule.get(module);
    if (!bucket) {
      bucket = new Map();
      byModule.set(module, bucket);
    }
    bucket.set(String(row[1]), { kind: row[2] as ChangeState_ACU['kind'], payload: row[3] === null || row[3] === undefined ? null : String(row[3]) });
  }
  const writes: Record<string, unknown> = {};
  const removedIds: Record<string, string[]> = {};
  const revisions: Partial<AgentModuleRevisions_ACU> = {};
  for (const [module, bucket] of byModule) {
    if (!isWritableModule_ACU(module)) continue;
    const upserts: unknown[] = [];
    const removed: string[] = [];
    for (const [key, state] of bucket) {
      if (state.kind === 'upsert' && state.payload !== null) upserts.push(JSON.parse(state.payload));
      if (state.kind === 'remove') removed.push(key);
    }
    if (upserts.length) writes[module] = upserts;
    if (removed.length) removedIds[module] = removed;
    revisions[module] = readRevision_ACU(engine, module);
  }
  engine.run(`DELETE FROM ${CHANGES_TABLE_ACU}`);
  const delta: Pick<AgentModuleFloorDelta_ACU, 'writes' | 'removedIds' | 'revisions' | 'fieldUpserts'> = {
    writes: writes as AgentModuleFloorDelta_ACU['writes'],
    revisions,
  };
  if (Object.keys(removedIds).length) delta.removedIds = removedIds as NonNullable<AgentModuleFloorDelta_ACU['removedIds']>;
  const fieldUpserts = exportFieldUpserts_ACU(engine);
  if (fieldUpserts) delta.fieldUpserts = fieldUpserts;
  return delta;
}

/** 逐栏变更导出：同一 (module,id,field) 多次变更只导出最终状态；已删除的栏目导出 unset。 */
function exportFieldUpserts_ACU(engine: SqliteEngine): AgentModuleFieldUpserts_ACU | undefined {
  const rows = engine.query(`SELECT module, id, field FROM ${FIELD_CHANGES_TABLE_ACU} ORDER BY seq`).values;
  const seen = new Map<string, { module: string; id: string; field: string }>();
  for (const row of rows) {
    const module = String(row[0]);
    const id = String(row[1]);
    const field = String(row[2]);
    const key = `${module} ${id} ${field}`;
    if (!seen.has(key)) seen.set(key, { module, id, field });
  }
  const upserts: AgentModuleFieldUpserts_ACU = {};
  let touched = false;
  for (const { module, id, field } of seen.values()) {
    if (!isWritableModule_ACU(module)) continue;
    const valueRows = engine.query(`SELECT value FROM ${FIELD_VALUES_TABLE_ACU} WHERE module = ? AND id = ? AND field = ?`, [module, id, field]).values;
    const write: AgentModuleFieldWrite_ACU = valueRows.length ? { value: JSON.parse(String(valueRows[0][0])) } : { unset: true };
    const bucket = (upserts[module] ??= {});
    const record = (bucket[id] ??= {});
    record[field] = write;
    touched = true;
  }
  engine.run(`DELETE FROM ${FIELD_CHANGES_TABLE_ACU}`);
  return touched ? upserts : undefined;
}

function readSnapshot_ACU(engine: SqliteEngine): AgentModuleSnapshot_ACU {
  const base = new Map(engine.query(`SELECT key, value FROM ${BASE_TABLE_ACU}`).values.map(row => [String(row[0]), String(row[1])]));
  const snapshot = {
    schemaVersion: AGENT_MODULE_SCHEMA_VERSION_ACU,
    settledThroughIndex: Number(base.get('settledThroughIndex') ?? '0'),
    updatedAt: Number(base.get('updatedAt') ?? '0'),
    revisions: {} as AgentModuleRevisions_ACU,
    hooks: [],
    infoGap: [],
    constraints: [],
    storyArc: [],
    chronology: [],
    webRefs: [],
    userRequirements: JSON.parse(base.get('userRequirements') ?? '[]'),
    pendingFixes: JSON.parse(base.get('pendingFixes') ?? '[]'),
  } as unknown as AgentModuleSnapshot_ACU;
  const fingerprint = base.get('settledPrefixFingerprint');
  if (typeof fingerprint === 'string' && fingerprint) {
    (snapshot as { settledPrefixFingerprint?: string }).settledPrefixFingerprint = fingerprint;
  }
  for (const module of AGENT_WRITABLE_MODULES_ACU) {
    const rows = engine.query(`SELECT payload FROM ${moduleTable_ACU(module)} ORDER BY rowid`).values;
    const items = rows.map(row => JSON.parse(String(row[0])));
    (snapshot as unknown as Record<string, unknown>)[module] = items;
    (snapshot.revisions as unknown as Record<string, number>)[module] = readRevision_ACU(engine, module);
  }
  (snapshot.revisions as unknown as Record<string, number>).userRequirements = readRevision_ACU(engine, 'userRequirements');
  return snapshot;
}

/**
 * 把折叠后的快照物化进独立内存库并返回行级视图。
 * 引擎初始化、建表或条目装载失败抛结构化错误；调用方负责 fail-closed 回退 JSON 校验链。
 * 第二参兼容两种形态：分栏快照（S11-TT 复算播种）或复用引擎（旧调用）；第三参为引擎。
 */
export async function materializeAgentModuleSqlView_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  fieldsOrEngine?: AgentModuleFieldSnapshot_ACU | SqliteEngine,
  maybeEngine?: SqliteEngine,
): Promise<AgentModuleSqlView_ACU> {
  const db = (fieldsOrEngine instanceof SqliteEngine ? fieldsOrEngine : maybeEngine) ?? new SqliteEngine();
  const fields = fieldsOrEngine instanceof SqliteEngine ? undefined : fieldsOrEngine;
  try {
    await db.init();
    createSchema_ACU(db);
    loadSnapshot_ACU(db, cloneJson_ACU(snapshot));
    loadFieldView_ACU(db, fields ? cloneJson_ACU(fields) : undefined);
  } catch (error) {
    db.dispose();
    if (error instanceof AgentModuleSqlViewError_ACU) throw error;
    throw new AgentModuleSqlViewError_ACU(`续写资料 SQL 视物化失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    engine: db,
    hasChanges: () => Number(db.query(`SELECT (SELECT COUNT(*) FROM ${CHANGES_TABLE_ACU}) + (SELECT COUNT(*) FROM ${FIELD_CHANGES_TABLE_ACU})`).values[0]?.[0] ?? 0) > 0,
    applyRowWrite: input => applyRowWrite_ACU(db, input),
    applyFieldBatch: input => applyFieldBatch_ACU(db, input),
    exportDelta: () => exportDelta_ACU(db),
    readSnapshot: () => readSnapshot_ACU(db),
    readFieldRecord: (module, id) => readFieldRecord_ACU(db, module, id),
    readPartialRecords: module => readPartialRecords_ACU(db, module),
    dispose: () => db.dispose(),
  };
}
