/**
 * service/continuation/agent/agent-module-sql-view.ts — 续写资料快照的 SQL 易失视图（TT）
 *
 * 把折叠后的楼层快照物化进独立 SqliteEngine 内存库：六个 id 键模块一模块一表，
 * 条目 id 为主键，模块 revision 入 module_meta 表。行级 upsert/remove 与 revision
 * 校验在 SQL 层完成，变更行经 module_changes 追踪后可导出为楼层 delta 形态。
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
 * - 知识边界外资料不得经行视图泄漏进提示词：物化仅接受已知模块，未知模块的写与
 *   导出一律拒绝/跳过；readSnapshot 只返回已知字段。
 */

import { SqliteEngine } from '../../../data/sqlite/sqlite-engine';
import {
  AGENT_MODULE_SCHEMA_VERSION_ACU,
  AGENT_WRITABLE_MODULES_ACU,
  type AgentModuleFloorDelta_ACU,
  type AgentModuleRevisions_ACU,
  type AgentModuleSnapshot_ACU,
  type AgentWritableModule_ACU,
} from './agent-model';

const MODULE_TABLE_PREFIX_ACU = 'mod_';
const BASE_TABLE_ACU = 'snapshot_base';
const META_TABLE_ACU = 'module_meta';
const CHANGES_TABLE_ACU = 'module_changes';

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

export interface AgentModuleSqlView_ACU {
  readonly engine: SqliteEngine;
  /** 是否有尚未导出的变更行。 */
  hasChanges(): boolean;
  /** 行写并推进模块 revision；冲突或非法输入抛 AgentModuleSqlViewError_ACU。 */
  applyRowWrite(input: AgentModuleSqlRowWrite_ACU): number;
  /**
   * 导出变更行为楼层 delta 输入形态；导出后清空变更追踪。
   * 仅供单测/诊断：生产持久化绝不经此旁路，一律走既有事务/SQL 链路。
   */
  exportDelta(): Pick<AgentModuleFloorDelta_ACU, 'writes' | 'removedIds' | 'revisions'>;
  /** 从库读回完整快照（标量字段沿用物化时的基线值）。 */
  readSnapshot(): AgentModuleSnapshot_ACU;
  dispose(): void;
}

function createSchema_ACU(engine: SqliteEngine): void {
  for (const module of AGENT_WRITABLE_MODULES_ACU) {
    engine.run(`CREATE TABLE ${moduleTable_ACU(module)} (id TEXT PRIMARY KEY, payload TEXT NOT NULL)`);
  }
  engine.run(`CREATE TABLE ${META_TABLE_ACU} (module TEXT PRIMARY KEY, revision INTEGER NOT NULL)`);
  engine.run(`CREATE TABLE ${CHANGES_TABLE_ACU} (seq INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, change_key TEXT NOT NULL, change_kind TEXT NOT NULL, payload TEXT)`);
  engine.run(`CREATE TABLE ${BASE_TABLE_ACU} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
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

function exportDelta_ACU(engine: SqliteEngine): Pick<AgentModuleFloorDelta_ACU, 'writes' | 'removedIds' | 'revisions'> {
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
  const delta: Pick<AgentModuleFloorDelta_ACU, 'writes' | 'removedIds' | 'revisions'> = {
    writes: writes as AgentModuleFloorDelta_ACU['writes'],
    revisions,
  };
  if (Object.keys(removedIds).length) delta.removedIds = removedIds as NonNullable<AgentModuleFloorDelta_ACU['removedIds']>;
  return delta;
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
 */
export async function materializeAgentModuleSqlView_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  engine?: SqliteEngine,
): Promise<AgentModuleSqlView_ACU> {
  const db = engine ?? new SqliteEngine();
  try {
    await db.init();
    createSchema_ACU(db);
    loadSnapshot_ACU(db, cloneJson_ACU(snapshot));
  } catch (error) {
    db.dispose();
    if (error instanceof AgentModuleSqlViewError_ACU) throw error;
    throw new AgentModuleSqlViewError_ACU(`续写资料 SQL 视物化失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    engine: db,
    hasChanges: () => Number(db.query(`SELECT COUNT(*) FROM ${CHANGES_TABLE_ACU}`).values[0]?.[0] ?? 0) > 0,
    applyRowWrite: input => applyRowWrite_ACU(db, input),
    exportDelta: () => exportDelta_ACU(db),
    readSnapshot: () => readSnapshot_ACU(db),
    dispose: () => db.dispose(),
  };
}
