/**
 * service/continuation/agent/agent-module-frame.ts — 续写资料的楼层增量帧（TT-only）
 *
 * 楼层字段从全量快照升级为 { checkpoint, deltas }。读取从最近基线起按楼层顺序叠加
 * 当前 swipe 的 delta；删除楼层会让该楼 delta 物理消失，折叠结果自动回到剩余链。
 * schema 1 全量快照只在内存里充当 swipe 0 的基线，成功写入才替换成 schema 3。
 *
 * TT 适配说明（相对上游 d404b0f）：
 * - 六个 id 键模块（hooks/infoGap/constraints/storyArc/chronology/webRefs）加
 *   userRequirements 字符串单例整表替换（顶层 delta 字段，不进分栏矩阵）；
 *   pendingFixes 随快照携带并参与折叠/差分，
 *   与上游 pendingFixes 语义对齐（TT 六模块子集 + 单例）；
 * - 不耦合 simulation（scheduler/ledger 引用全部剥离）；
 * - P1 前缀指纹语义由 deps.isSnapshotPrefixCompatible 注入：legacy 与 checkpoint
 *   基线在采纳前必须通过指纹兼容检查，否则跳过（删楼/替换后拒绝复用旧基线）。
 */

import {
  AGENT_MODULE_FIELD_ACU,
  AGENT_MODULE_FIELD_MATRIX_ACU,
  AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
  AGENT_WRITABLE_MODULES_ACU,
  type AgentModuleFloorDelta_ACU,
  type AgentModuleFloorFrame_ACU,
  type AgentModuleFieldRecord_ACU,
  type AgentModuleFieldSnapshot_ACU,
  type AgentModuleFieldUpserts_ACU,
  type AgentModuleFieldValue_ACU,
  type AgentModuleFieldWrite_ACU,
  type AgentModuleRevisions_ACU,
  type AgentModuleSnapshot_ACU,
  type AgentWritableModule_ACU,
} from './agent-model';
import { isAiFloor_ACU } from '../../../shared/ai-floor';

export interface AgentModuleFrameDeps_ACU {
  validateSnapshot: (raw: unknown) => AgentModuleSnapshot_ACU | null;
  salvageSnapshot: (raw: unknown) => { snapshot: AgentModuleSnapshot_ACU; problems: string[] } | null;
  emptySnapshot: () => AgentModuleSnapshot_ACU;
  /** P1 前缀指纹兼容检查。缺省时不做门控（纯帧语义）。 */
  isSnapshotPrefixCompatible?: (snapshot: AgentModuleSnapshot_ACU, chat: readonly unknown[]) => boolean;
  /**
   * 把快照的结算水位与前缀指纹一起对齐到承载楼；旧指纹与当前聊天不符时返回 null（调用方 fail-closed）。
   * 帧模块不能反向 import store（会成环），所以由 store 注入。缺省时无法对齐 ⇒ 一律不写基线，
   * 宁可少写一次也不能写出一份「删掉尾部非 AI 楼就自毁」的基线。
   */
  alignSnapshotToFloor?: (snapshot: AgentModuleSnapshot_ACU, chat: readonly unknown[], floor: number) => AgentModuleSnapshot_ACU | null;
  /**
   * 为**折叠派生**的快照按自身水位重盖前缀指纹（store 侧接 refreshAgentModuleSnapshotChatPrefix_ACU）。
   * 折叠结果的指纹与水位天然不成对（applyDelta 只推水位不改指纹），落盘前必须重盖，否则下一轮折叠会
   * 整体拒绝这份基线并连带禁用抢救 ⇒ 资料全量静默清零。缺省时调用方会改为「不声明指纹」，不会留失配指纹。
   */
  restampPrefix?: (snapshot: AgentModuleSnapshot_ACU, chat: readonly unknown[]) => AgentModuleSnapshot_ACU;
}

export interface AgentModuleFoldCandidate_ACU {
  index: number;
  valid: boolean;
  problems: string[];
}

export interface AgentModuleFoldResult_ACU {
  snapshot: AgentModuleSnapshot_ACU;
  candidates: AgentModuleFoldCandidate_ACU[];
  adoptedIndex: number | null;
  salvaged: boolean;
  checkpointIndex: number | null;
  foldedDeltaCount: number;
  /**
   * 折叠范围内全部「已通过深度解析」的 delta 的最大 seq（与楼层当前 swipe 无关）。
   * 供写入规划直接取下一条 delta 序号，省掉一次全聊天解析扫描；口径与旧的
   * maxSeq 扫描完全一致（同样只统计 parseDelta 通过的 delta）。
   */
  maxDeltaSeq: number;
  /** 折叠范围内是否纳入过基线或 delta。空聊天为 false。 */
  contributed: boolean;
  /** 折叠派生的分栏视图（只读，绝不写回持久帧）。完整领域数组只来自整条 writes；partial 记录只出现在这里。 */
  fields: AgentModuleFieldSnapshot_ACU;
  /**
   * 折叠来源身份：这条结果折的是哪一条 chat（楼层数 + 尾楼对象引用）。
   * 供规划前的自检用——外来基线被静默采纳会让 maxDeltaSeq 口径整体漂移（见 isFoldResultForChat_ACU）。
   */
  chatLength: number;
  tailFloor: unknown;
}

interface ParsedLegacy_ACU {
  kind: 'legacy';
  snapshot: AgentModuleSnapshot_ACU;
}

interface ParsedFrame_ACU {
  kind: 'frame';
  frame: AgentModuleFloorFrame_ACU;
  problems: string[];
}

interface ParsedBroken_ACU {
  kind: 'broken';
  problems: string[];
  salvaged: AgentModuleSnapshot_ACU | null;
}

type ParsedField_ACU = { kind: 'empty' } | ParsedLegacy_ACU | ParsedFrame_ACU | ParsedBroken_ACU;

/**
 * parseField 记忆化：外层键是 deps 实例（不同校验器口径互不串味），内层键是每楼
 * 原始帧对象引用。写路径一律整体替换该字段对象（writeFrame_ACU 与
 * agent-module-store 的 assignment 提交都是 `message[FIELD] = 新对象`），
 * 因此换对象即天然失效，无需版本号。
 * test-audit 2026-09-29 移除了配套的调用计数器（folds/fieldParses/fieldMemoHits）：
 * 计数断言把夹具算术写成契约，正确性由逐字等价 keeper 锁定，性能回退不再由 CI 捕获。
 */
let fieldParseMemo_ACU: WeakMap<AgentModuleFrameDeps_ACU, WeakMap<object, ParsedField_ACU>> = new WeakMap();

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 仅供测试：清空记忆化缓存，便于构造"冷路径"对照（测试隔离 hygiene，非计数）。 */
export function __resetAgentModuleFrameCachesForTests_ACU(): void {
  fieldParseMemo_ACU = new WeakMap();
}

function cloneJson_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isWritableModuleKey_ACU(value: string): value is AgentWritableModule_ACU {
  return (AGENT_WRITABLE_MODULES_ACU as readonly string[]).includes(value);
}

function isFieldWrite_ACU(value: unknown): value is AgentModuleFieldWrite_ACU {
  return isRecord_ACU(value) && (value.unset === true || Object.prototype.hasOwnProperty.call(value, 'value'));
}

/**
 * 解析逐栏写集（S11-TT 融合提交的帧侧严格门）。
 * 结构损坏——模块/ID/栏目层不是对象、写入值既无 value 也非 unset、ID 为空——返回
 * null，由调用方把整条记录判为不可折叠并留下诊断；未知模块或栏目名只忽略，
 * 给后续版本新增栏目留余地。TT 六模块子集：userRequirements 单例不进分栏矩阵。
 */
export function parseAgentModuleFieldUpserts_ACU(raw: unknown): AgentModuleFieldUpserts_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  const parsed: AgentModuleFieldUpserts_ACU = {};
  for (const [moduleKey, moduleUpserts] of Object.entries(raw)) {
    if (!isRecord_ACU(moduleUpserts)) return null;
    if (!isWritableModuleKey_ACU(moduleKey)) continue;
    const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[moduleKey];
    const kept: Record<string, Record<string, AgentModuleFieldWrite_ACU>> = {};
    for (const [rawId, writes] of Object.entries(moduleUpserts)) {
      if (!isRecord_ACU(writes)) return null;
      const id = String(rawId ?? '').trim();
      if (!id) return null;
      const keptFields: Record<string, AgentModuleFieldWrite_ACU> = {};
      for (const [field, write] of Object.entries(writes)) {
        if (!isFieldWrite_ACU(write)) return null;
        if (!matrix.fields.includes(field)) continue;
        keptFields[field] = write.unset === true ? { unset: true } : { value: cloneJson_ACU(write.value) };
      }
      if (Object.keys(keptFields).length) kept[id] = { ...(kept[id] ?? {}), ...keptFields };
    }
    if (Object.keys(kept).length) parsed[moduleKey] = kept;
  }
  return parsed;
}

export function readMessageSwipeId_ACU(message: unknown): string {
  if (!isRecord_ACU(message)) return '0';
  const swipeId = message.swipe_id;
  return typeof swipeId === 'number' && Number.isInteger(swipeId) && swipeId >= 0 ? String(swipeId) : '0';
}

/**
 * 解析「本次写入的帧数据该落在哪一楼」：≤ targetIndex 的最近 AI 楼；没有则 -1（调用方 fail-closed）。
 *
 * 为什么不能就是 targetIndex：调用方（agent-main-loop 的三处派工、资料补足、逐栏提交）一律传物理尾楼
 * `chat.length - 1`，而 TT 2.3.0 的物理尾楼可以合法地是一等工具楼 `{role:'tool', is_system:true}`
 * （src/scripts/tool-calling.js:1058-1089）——它可被用户独立删除、没有 swipe_id、也不承载剧情正文
 * （docs/CurrentState/ChatPayload.md §4）。帧数据挂上去的后果：用户删掉工具楼即丢整段资料增量；
 * swipe_id 缺失还会让 delta 的 swipeId 退化成 '0'，切 swipe 后的失效判定失去意义。
 * 隐藏楼（is_system）同理：用户看不见却承载资料，与楼号口径、删楼守卫都会错位。
 *
 * 为什么是「≤ targetIndex 的**最近** AI 楼」而不是更早的某一栋：折叠按**楼层序**应用 delta
 * （foldAgentModuleSnapshot_ACU 的正序 for 循环），落到更早的楼会让新 delta 排在既有 delta 之前被应用。
 *
 * ⚠️ 这条不变量依赖一个**调用方契约**而非天然成立：frameFloor 之后不得再有承载帧的楼层。
 * 本版本之后新写入的帧只落在 AI 楼，所以 frameFloor（最后一栋 AI 楼）之后不会有新帧；但旧版本
 * （≤ v9.8.8）把 delta 追加在物理尾楼，存量聊天里可能已有「挂在工具楼上的遗留帧」，删楼守卫的
 * 基线嫁接也可能落到非 AI 楼。两个 plan 函数因此都显式处理这种情况：整条快照路径吸收遗留内容后
 * 把遗留帧摘掉（自愈），逐栏路径先拒一次并说明原因（它不折叠、无处吸收）。
 */
function resolveFrameFloor_ACU(chat: readonly unknown[], targetIndex: number): number {
  for (let index = Math.min(targetIndex, chat.length - 1); index >= 0; index -= 1) {
    if (isAiFloor_ACU(chat[index])) return index;
  }
  return -1;
}

/**
 * 遗留在非 AI 楼上、且**参与当前折叠**的帧楼层（v9.8.8 及更早「delta 追加在物理尾楼」的产物）。
 *
 * 判据刻意收窄，否则摘除会误删本模块纪律要求保留的东西（见 stripCurrentSwipeThrough_ACU 的注释与
 * agent-module-frame.test.ts 的「他 swipe 的旧基线在搬运后仍保留，切回即恢复」）：
 * - 只看 `kind === 'frame'`：legacy 全量与 broken 帧不是 v9.8.8 的产物，各有自己的迁移/抢救路径；
 * - 只看携带**本楼当前 swipe** 的 checkpoint 或 delta：只有它们会被折叠应用（FRAME 折叠里的
 *   `delta.swipeId === swipeId` 判定），因而才是「排在承载楼之后覆盖新值」的倒挂源；他 swipe 的内容
 *   折叠本来就用不到，删掉等于永久丢失切回时的恢复能力。
 */
function collectStrayFrameFloors_ACU(chat: readonly unknown[], deps: AgentModuleFrameDeps_ACU): number[] {
  const stray: number[] = [];
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    if (isAiFloor_ACU(message)) continue;
    const raw = fieldOf_ACU(message);
    if (raw === undefined) continue;
    const parsed = parseField_ACU(raw, deps);
    if (parsed.kind !== 'frame') continue;
    const swipeId = readMessageSwipeId_ACU(message);
    const carriesCurrentSwipe = (parsed.frame.checkpoint && parsed.frame.checkpoint.swipeId === swipeId)
      || parsed.frame.deltas.some(delta => delta.swipeId === swipeId);
    if (!carriesCurrentSwipe) continue;
    stray.push(index);
  }
  return stray;
}

/**
 * 摘掉某栋非 AI 楼上**参与当前折叠**的帧内容：只删当前 swipe 的 checkpoint 与 delta，
 * 他 swipe 内容原样保留；帧空了才连字段一起删。整字段 delete 会把切 swipe 时的恢复能力一并抹掉。
 */
function removeCurrentSwipeFrame_ACU(message: unknown): void {
  if (!isRecord_ACU(message)) return;
  const raw = message[AGENT_MODULE_FIELD_ACU];
  if (raw === undefined || !isRecord_ACU(raw)) return;
  const swipeId = readMessageSwipeId_ACU(message);
  const next: Record<string, unknown> = { ...raw };
  if (isRecord_ACU(next.checkpoint) && next.checkpoint.swipeId === swipeId) delete next.checkpoint;
  if (Array.isArray(next.deltas)) {
    next.deltas = (next.deltas as Array<Record<string, unknown>>).filter(delta => delta?.swipeId !== swipeId);
  }
  const emptied = next.checkpoint === undefined && Array.isArray(next.deltas) && next.deltas.length === 0;
  if (emptied) delete message[AGENT_MODULE_FIELD_ACU];
  else message[AGENT_MODULE_FIELD_ACU] = next;
}

/**
 * 把**折叠派生**的快照落盘前按自身水位重盖前缀指纹（并钳到承载楼）。
 *
 * 为什么与 alignSnapshotToFloor_ACU 分开：折叠结果的内容只可能来自「已被指纹门校验通过的基线 + delta」
 * （applyDelta 会推高 settledThroughIndex 却**从不改指纹**，见本文件 applyDelta_ACU），所以它的指纹天然与
 * 自身水位不成对。这种快照直接落盘＝写一份自相矛盾的基线 ⇒ 下一次折叠按新水位重算指纹必然失配 ⇒
 * 基线被整体拒绝、incompatibleSeen 连带禁用宽容抢救、同 swipe 的 delta 又已被 strip 掉 ⇒ **资料全量静默清零**。
 * 对折叠派生的快照重盖指纹不是「洗白失配」：它本来就是从当前聊天折出来的，指纹记录的正是在此刻的出处。
 * 「不许重算指纹洗白」那条纪律针对的是**外部传入的在飞快照**（clamped），那里仍走带校验的 alignSnapshotToFloor。
 */
function restampFoldedSnapshot_ACU(
  deps: AgentModuleFrameDeps_ACU,
  snapshot: AgentModuleSnapshot_ACU,
  chat: readonly unknown[],
  floor: number,
): AgentModuleSnapshot_ACU {
  const clampedWaterline = Math.min(Math.max(snapshot.settledThroughIndex, 0), Math.max(floor, 0));
  const next: AgentModuleSnapshot_ACU = { ...snapshot, settledThroughIndex: clampedWaterline };
  if (deps.restampPrefix) return deps.restampPrefix(next, chat);
  // 没有重盖能力时宁可**不声明指纹**（折叠读路径把「无指纹」视为兼容），也不要留一份必然失配的旧指纹：
  // 后者会让基线被拒绝、抢救被禁用，代价是资料清零。
  delete (next as { settledPrefixFingerprint?: string }).settledPrefixFingerprint;
  return next;
}

/**
 * 把快照的结算水位（与前缀指纹）对齐到承载楼；对不齐时返回原快照，由调用方按「水位 > 承载楼」fail-closed。
 *
 * 为什么必须对齐：基线声明「结算到 W」而 W 指向承载楼之后的工具楼/隐藏楼时，用户删掉那栋楼就会让
 * chatPrefixFingerprint 失配 ⇒ 基线被折叠拒绝、宽容抢救一并禁用 ⇒ 资料**整体**清零。
 * 这也正是 store 里 alignAgentModuleSnapshotToFloor_ACU 与 continuation-orchestrator 写入前对齐的同一条纪律
 * （「本快照只声明结算到承载楼」）。代价：(承载楼, targetIndex] 这段会在下一轮重新结算一次，
 * 而那段在 `anchor === frameFloor`（生产常态）时全是非 AI 楼、不承载剧情正文
 * （renderAgentUnsettledHistory_ACU 按 isAiFloor_ACU 过滤），不会多派维护代理；
 * 当锚点取到更早的表格 checkpoint 楼时，(anchor, targetIndex] 里可能含 AI 楼，但基线本就只声明
 * 结算到 anchor、其后的内容由 delta 承载（删楼即物理退出折叠），语义仍然自洽。
 */
function alignSnapshotToFloor_ACU(
  deps: AgentModuleFrameDeps_ACU,
  snapshot: AgentModuleSnapshot_ACU,
  chat: readonly unknown[],
  floor: number,
): AgentModuleSnapshot_ACU {
  if (snapshot.settledThroughIndex <= floor) return snapshot;
  if (!deps.alignSnapshotToFloor) return snapshot;
  try {
    return deps.alignSnapshotToFloor(snapshot, chat, floor) ?? snapshot;
  } catch {
    return snapshot;
  }
}

function clampWaterline_ACU(value: number, targetIndex: number): number {
  if (!Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, Math.max(0, targetIndex));
}

function semanticPayload_ACU(snapshot: AgentModuleSnapshot_ACU): string {
  return JSON.stringify({
    settledThroughIndex: snapshot.settledThroughIndex,
    revisions: snapshot.revisions,
    hooks: snapshot.hooks,
    infoGap: snapshot.infoGap,
    constraints: snapshot.constraints,
    storyArc: snapshot.storyArc,
    chronology: snapshot.chronology,
    webRefs: snapshot.webRefs,
    userRequirements: snapshot.userRequirements ?? [],
    materialCompletion: snapshot.materialCompletion,
    pendingFixes: snapshot.pendingFixes ?? [],
  });
}

function sameSemantic_ACU(left: AgentModuleSnapshot_ACU, right: AgentModuleSnapshot_ACU): boolean {
  return semanticPayload_ACU(left) === semanticPayload_ACU(right);
}

function emptyFrame_ACU(): AgentModuleFloorFrame_ACU {
  return { schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU, deltas: [] };
}

function isCompatibleBaseline_ACU(
  snapshot: AgentModuleSnapshot_ACU,
  chat: readonly unknown[],
  deps: AgentModuleFrameDeps_ACU,
): boolean {
  if (!deps.isSnapshotPrefixCompatible) return true;
  try {
    return deps.isSnapshotPrefixCompatible(snapshot, chat);
  } catch {
    return false;
  }
}

function parseDelta_ACU(raw: unknown, deps: AgentModuleFrameDeps_ACU): AgentModuleFloorDelta_ACU | null {
  if (!isRecord_ACU(raw)) return null;
  if (typeof raw.seq !== 'number' || !Number.isInteger(raw.seq) || raw.seq < 1) return null;
  if (typeof raw.swipeId !== 'string' || !raw.swipeId.trim()) return null;
  if (!isRecord_ACU(raw.writes) || !isRecord_ACU(raw.revisions)) return null;
  const seed = deps.emptySnapshot();
  seed.settledThroughIndex = 0;
  const applied = applyDelta_ACU(seed, {
    seq: raw.seq,
    swipeId: raw.swipeId,
    writes: raw.writes as AgentModuleFloorDelta_ACU['writes'],
    revisions: raw.revisions as AgentModuleFloorDelta_ACU['revisions'],
    ...(Array.isArray(raw.userRequirements) ? { userRequirements: raw.userRequirements as string[] } : {}),
    ...(isRecord_ACU(raw.removedIds) ? { removedIds: raw.removedIds as AgentModuleFloorDelta_ACU['removedIds'] } : {}),
    ...(isRecord_ACU(raw.materialCompletion) ? { materialCompletion: raw.materialCompletion as unknown as AgentModuleFloorDelta_ACU['materialCompletion'] } : {}),
    ...(raw.settledThroughIndex === undefined ? {} : { settledThroughIndex: raw.settledThroughIndex as number }),
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt >= 0 ? raw.updatedAt : 0,
  });
  if (!deps.validateSnapshot(applied)) return null;
  const delta: AgentModuleFloorDelta_ACU = {
    seq: raw.seq,
    swipeId: raw.swipeId,
    writes: cloneJson_ACU(raw.writes) as AgentModuleFloorDelta_ACU['writes'],
    revisions: cloneJson_ACU(raw.revisions) as Partial<AgentModuleRevisions_ACU>,
    updatedAt: typeof raw.updatedAt === 'number' && raw.updatedAt >= 0 ? raw.updatedAt : 0,
  };
  if (Array.isArray(raw.userRequirements)) delta.userRequirements = cloneJson_ACU(raw.userRequirements) as string[];
  // 逐栏增量不参与领域快照的严格校验（applyDelta/validateSnapshot 只看整条 writes），
  // 内容清洗下沉到视图折叠与写入规划（矩阵白名单 + unset/value 显式区分），此处只透传。
  if (isRecord_ACU(raw.fieldUpserts)) delta.fieldUpserts = cloneJson_ACU(raw.fieldUpserts) as AgentModuleFieldUpserts_ACU;
  if (isRecord_ACU(raw.removedIds)) delta.removedIds = cloneJson_ACU(raw.removedIds) as AgentModuleFloorDelta_ACU['removedIds'];
  if (isRecord_ACU(raw.materialCompletion)) delta.materialCompletion = cloneJson_ACU(applied.materialCompletion);
  if (typeof raw.settledThroughIndex === 'number' && Number.isInteger(raw.settledThroughIndex) && raw.settledThroughIndex >= 0) {
    delta.settledThroughIndex = raw.settledThroughIndex;
  }
  return delta;
}

function parseFieldUncached_ACU(raw: Record<string, unknown>, deps: AgentModuleFrameDeps_ACU): ParsedField_ACU {
  if (raw.schemaVersion === AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU) {
    if (!Array.isArray(raw.deltas)) return { kind: 'broken', problems: ['schema 3 缺少 deltas 数组'], salvaged: null };
    const problems: string[] = [];
    const deltas: AgentModuleFloorDelta_ACU[] = [];
    raw.deltas.forEach((item, index) => {
      const delta = parseDelta_ACU(item, deps);
      if (delta) deltas.push(delta);
      else problems.push(`deltas[${index}] 无法折叠，已跳过`);
    });
    deltas.sort((left, right) => left.seq - right.seq);
    const frame: AgentModuleFloorFrame_ACU = { schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU, deltas };
    if (isRecord_ACU(raw.checkpoint)) {
      const snapshot = deps.validateSnapshot(raw.checkpoint.snapshot);
      const swipeId = typeof raw.checkpoint.swipeId === 'string' && raw.checkpoint.swipeId.trim() ? raw.checkpoint.swipeId : '';
      if (snapshot && swipeId) frame.checkpoint = { swipeId, snapshot };
      else problems.push('checkpoint 未通过严格校验，已忽略');
    }
    return { kind: 'frame', frame, problems };
  }
  const legacy = deps.validateSnapshot(raw);
  if (legacy) return { kind: 'legacy', snapshot: legacy };
  const salvaged = deps.salvageSnapshot(raw);
  return {
    kind: 'broken',
    problems: salvaged?.problems ?? ['快照不是可折叠的资料帧'],
    salvaged: salvaged?.snapshot ?? null,
  };
}

function fieldParseCacheFor_ACU(deps: AgentModuleFrameDeps_ACU): WeakMap<object, ParsedField_ACU> {
  let cache = fieldParseMemo_ACU.get(deps);
  if (!cache) {
    cache = new WeakMap<object, ParsedField_ACU>();
    fieldParseMemo_ACU.set(deps, cache);
  }
  return cache;
}

/**
 * problems 必须每次交出副本：foldAgentModuleSnapshot_ACU 会把"前缀指纹失配"文案
 * push 进候选诊断（candidates[last].problems），若直接共享记忆化里的数组，
 * 第二次折叠就会把同一帧误判成 invalid（帧损坏门会拒绝本可写入的聊天）。
 * 其余字段（frame/legacy.snapshot）由 parseDelta/validateSnapshot 产出，本就是
 * 与原始帧无别名的副本，且调用方一律只读（fold 走 cloneJson 复制后才改，
 * readFrame_ACU / stripCurrentSwipeThrough_ACU 同样先整体 cloneJson），可安全共享。
 */
function withPrivateProblems_ACU(parsed: ParsedField_ACU): ParsedField_ACU {
  if (parsed.kind === 'frame' || parsed.kind === 'broken') return { ...parsed, problems: parsed.problems.slice() };
  return parsed;
}

/**
 * 逐楼资料字段解析（记忆化入口）。深度解析含 applyDelta + validateSnapshot + 多次
 * cloneJson，是折叠路径的大头；同一操作内对同一楼层重复折叠时必须复用。
 */
function parseField_ACU(raw: unknown, deps: AgentModuleFrameDeps_ACU): ParsedField_ACU {
  if (raw === undefined) return { kind: 'empty' };
  if (!isRecord_ACU(raw)) return { kind: 'broken', problems: ['资料字段不是对象'], salvaged: null };
  const cache = fieldParseCacheFor_ACU(deps);
  const memo = cache.get(raw);
  if (memo) {
    return withPrivateProblems_ACU(memo);
  }
  const parsed = parseFieldUncached_ACU(raw, deps);
  cache.set(raw, parsed);
  return withPrivateProblems_ACU(parsed);
}

function entryId_ACU(item: unknown): string {
  if (!isRecord_ACU(item) || typeof item.id !== 'string') return '';
  return item.id;
}

function applyModuleWrite_ACU(current: readonly unknown[], upserts: readonly unknown[] | undefined, removed: readonly string[] | undefined): unknown[] {
  const removedIds = new Set(removed ?? []);
  const replacements = new Map<string, unknown>();
  for (const item of upserts ?? []) {
    const id = entryId_ACU(item);
    if (id) replacements.set(id, item);
  }
  const next: unknown[] = [];
  const seen = new Set<string>();
  for (const item of current) {
    const id = entryId_ACU(item);
    if (!id || removedIds.has(id)) continue;
    if (replacements.has(id)) {
      next.push(cloneJson_ACU(replacements.get(id)));
      seen.add(id);
    } else next.push(cloneJson_ACU(item));
  }
  for (const [id, item] of replacements) {
    if (!seen.has(id) && !removedIds.has(id)) next.push(cloneJson_ACU(item));
  }
  return next;
}

function applyDelta_ACU(snapshot: AgentModuleSnapshot_ACU, delta: AgentModuleFloorDelta_ACU): AgentModuleSnapshot_ACU {
  const next = cloneJson_ACU(snapshot);
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    if (!Object.prototype.hasOwnProperty.call(delta.writes, key) && !delta.removedIds?.[key]) continue;
    (next as unknown as Record<string, unknown>)[key] = applyModuleWrite_ACU(
      next[key] as unknown[],
      delta.writes[key] as unknown[] | undefined,
      delta.removedIds?.[key],
    );
  }
  // 用户要求单例：整表替换，不进分栏矩阵。
  if (Object.prototype.hasOwnProperty.call(delta, 'userRequirements') && delta.userRequirements !== undefined) {
    next.userRequirements = cloneJson_ACU(delta.userRequirements);
  }
  next.revisions = { ...next.revisions, ...delta.revisions };
  if (typeof delta.settledThroughIndex === 'number') next.settledThroughIndex = delta.settledThroughIndex;
  // pendingFixes 不是分栏模块：整份随快照携带。delta.writes 透传该键时整体替换，
  // 否则保持基线值——折叠不丢待修复队列。
  if (Object.prototype.hasOwnProperty.call(delta.writes, 'pendingFixes')) {
    next.pendingFixes = cloneJson_ACU((delta.writes as Record<string, unknown>).pendingFixes) as AgentModuleSnapshot_ACU['pendingFixes'];
  }
  if (!Array.isArray(next.pendingFixes)) next.pendingFixes = [];
  if (delta.materialCompletion !== undefined) next.materialCompletion = cloneJson_ACU(delta.materialCompletion);
  next.updatedAt = delta.updatedAt;
  return next;
}

function diffSnapshot_ACU(before: AgentModuleSnapshot_ACU, after: AgentModuleSnapshot_ACU, swipeId: string, seq: number): AgentModuleFloorDelta_ACU | null {
  const writes: AgentModuleFloorDelta_ACU['writes'] = {};
  const removedIds: NonNullable<AgentModuleFloorDelta_ACU['removedIds']> = {};
  const revisions: Partial<AgentModuleRevisions_ACU> = {};
  let changed = false;
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    const previous = before[key] as unknown as Array<Record<string, unknown>>;
    const nextItems = after[key] as unknown as Array<Record<string, unknown>>;
    const previousById = new Map(previous.map(item => [entryId_ACU(item), item]));
    const nextIds = new Set(nextItems.map(item => entryId_ACU(item)));
    const upserts = nextItems.filter(item => {
      const id = entryId_ACU(item);
      const prior = previousById.get(id);
      return !prior || JSON.stringify(prior) !== JSON.stringify(item);
    });
    const removed = previous.map(item => entryId_ACU(item)).filter(id => id && !nextIds.has(id));
    if (upserts.length) {
      (writes as Record<string, unknown>)[key] = cloneJson_ACU(upserts);
      changed = true;
    }
    if (removed.length) {
      removedIds[key] = removed;
      changed = true;
    }
    if (before.revisions[key] !== after.revisions[key]) {
      revisions[key] = after.revisions[key];
      changed = true;
    }
  }
  const beforeFixes = JSON.stringify(before.pendingFixes ?? []);
  const afterFixes = JSON.stringify(after.pendingFixes ?? []);
  if (beforeFixes !== afterFixes) {
    (writes as Record<string, unknown>).pendingFixes = cloneJson_ACU(after.pendingFixes ?? []);
    changed = true;
  }
  const beforeRequirements = JSON.stringify(before.userRequirements ?? []);
  const afterRequirements = JSON.stringify(after.userRequirements ?? []);
  let userRequirements: string[] | undefined;
  if (beforeRequirements !== afterRequirements) {
    userRequirements = cloneJson_ACU(after.userRequirements ?? []);
    changed = true;
  }
  if (before.revisions.userRequirements !== after.revisions.userRequirements) {
    revisions.userRequirements = after.revisions.userRequirements;
    changed = true;
  }
  const delta: AgentModuleFloorDelta_ACU = { seq, swipeId, writes, revisions, updatedAt: after.updatedAt };
  if (userRequirements !== undefined) delta.userRequirements = userRequirements;
  if (Object.keys(removedIds).length) delta.removedIds = removedIds;
  if (JSON.stringify(before.materialCompletion) !== JSON.stringify(after.materialCompletion)) {
    delta.materialCompletion = cloneJson_ACU(after.materialCompletion);
    changed = true;
  }
  if (before.settledThroughIndex !== after.settledThroughIndex) {
    delta.settledThroughIndex = after.settledThroughIndex;
    changed = true;
  }
  return changed ? delta : null;
}

function emptyFieldView_ACU(): AgentModuleFieldSnapshot_ACU {
  return { records: {} };
}

function seedFieldViewFromSnapshot_ACU(snapshot: AgentModuleSnapshot_ACU, updatedAt: number): AgentModuleFieldSnapshot_ACU {
  const view = emptyFieldView_ACU();
  syncAllModuleRecordsToView_ACU(view, snapshot, updatedAt);
  return view;
}

function syncModuleRecordToView_ACU(
  view: AgentModuleFieldSnapshot_ACU,
  module: AgentWritableModule_ACU,
  items: readonly unknown[],
  updatedAt: number,
): void {
  const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[module];
  const bucket: Record<string, AgentModuleFieldRecord_ACU> = {};
  for (const item of items) {
    if (!isRecord_ACU(item)) continue;
    const id = entryId_ACU(item);
    if (!id) continue;
    const fields: Record<string, AgentModuleFieldValue_ACU> = {};
    for (const key of matrix.fields) {
      if (Object.prototype.hasOwnProperty.call(item, key)) {
        fields[key] = { value: cloneJson_ACU((item as Record<string, unknown>)[key]), revision: 0, updatedAt };
      }
    }
    bucket[id] = { module, id, status: 'legacy_unknown', fields, missingFields: [], updatedAt };
  }
  view.records[module] = bucket;
}

function syncAllModuleRecordsToView_ACU(view: AgentModuleFieldSnapshot_ACU, snapshot: AgentModuleSnapshot_ACU, updatedAt: number): void {
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    syncModuleRecordToView_ACU(view, key, snapshot[key] as unknown as unknown[], updatedAt);
  }
}

/**
 * 每条 delta 后的按 ID 对账：领域数组中的条目覆盖同名分栏记录（整条写入/提升为权威），
 * 从领域数组消失的 legacy_unknown 记录同步删除；fieldUpserts 留下的 partial 记录
 * 不在领域数组中，必须保留在受控视图里。不能用整桶重建——那会抹掉 partial。
 */
function reconcileFieldViewWithSnapshot_ACU(view: AgentModuleFieldSnapshot_ACU, snapshot: AgentModuleSnapshot_ACU, updatedAt: number): void {
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    const items = snapshot[key] as unknown as unknown[];
    const bucket = (view.records[key] ??= {});
    const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[key];
    const domainIds = new Set<string>();
    for (const item of items) {
      if (!isRecord_ACU(item)) continue;
      const id = entryId_ACU(item);
      if (!id) continue;
      domainIds.add(id);
      const fields: Record<string, AgentModuleFieldValue_ACU> = {};
      for (const field of matrix.fields) {
        if (Object.prototype.hasOwnProperty.call(item, field)) {
          fields[field] = { value: cloneJson_ACU((item as Record<string, unknown>)[field]), revision: 0, updatedAt };
        }
      }
      bucket[id] = { module: key, id, status: 'legacy_unknown', fields, missingFields: [], updatedAt };
    }
    for (const id of Object.keys(bucket)) {
      if (!domainIds.has(id) && bucket[id].status === 'legacy_unknown') delete bucket[id];
    }
  }
}

function recomputeFieldRecordStatus_ACU(record: AgentModuleFieldRecord_ACU): void {
  const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[record.module];
  record.missingFields = matrix.required.filter(key => !(key in record.fields));
  record.status = record.missingFields.length ? 'partial' : 'complete';
}

function applyFieldUpsertsToView_ACU(
  view: AgentModuleFieldSnapshot_ACU,
  upserts: AgentModuleFieldUpserts_ACU,
  updatedAt: number,
): AgentModuleFieldSnapshot_ACU {
  const next: AgentModuleFieldSnapshot_ACU = { records: {} };
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    const bucket = view.records[key];
    if (bucket) next.records[key] = cloneJson_ACU(bucket) as Record<string, AgentModuleFieldRecord_ACU>;
  }
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    const moduleUpserts = upserts[key];
    if (!moduleUpserts) continue;
    const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[key];
    const bucket = (next.records[key] ??= {});
    for (const [id, fieldWrites] of Object.entries(moduleUpserts)) {
      const stableId = String(id ?? '').trim();
      if (!stableId || !isRecord_ACU(fieldWrites)) continue;
      const record = (bucket[stableId] ??= { module: key, id: stableId, status: 'partial', fields: {}, missingFields: [], updatedAt: 0 });
      for (const [field, write] of Object.entries(fieldWrites as Record<string, AgentModuleFieldWrite_ACU>)) {
        if (!matrix.fields.includes(field)) continue;
        if (write && typeof write === 'object' && (write as AgentModuleFieldWrite_ACU).unset === true) {
          delete record.fields[field];
          continue;
        }
        if (!write || typeof write !== 'object' || !Object.prototype.hasOwnProperty.call(write, 'value')) continue;
        const previous = record.fields[field];
        record.fields[field] = {
          value: cloneJson_ACU((write as AgentModuleFieldWrite_ACU).value),
          revision: (previous?.revision ?? 0) + 1,
          updatedAt,
        };
      }
      record.updatedAt = updatedAt;
      recomputeFieldRecordStatus_ACU(record);
    }
  }
  return next;
}

function fieldOf_ACU(message: unknown): unknown {
  if (!isRecord_ACU(message) || !Object.prototype.hasOwnProperty.call(message, AGENT_MODULE_FIELD_ACU)) return undefined;
  return message[AGENT_MODULE_FIELD_ACU];
}

/**
 * 全聊天最大 delta 序号（深度解析口径）。
 *
 * 保留原因：逐栏写入规划（planAgentModuleFieldWrite_ACU）内部不做全量折叠，
 * 同一操作内没有任何一处保证这些楼层已被深度解析过——这里必须自己解析，
 * 否则损坏帧的 seq 会被算进序号，破坏「只统计 parseDelta 通过的 delta」口径。
 * 记忆化后该扫描是 O(楼层) 次 WeakMap 查询，不再重复 applyDelta/validate/clone。
 * 整条快照写入规划走的是折叠结果自带的 maxDeltaSeq，不需要本函数。
 */
function maxSeq_ACU(chat: readonly unknown[], deps: AgentModuleFrameDeps_ACU): number {
  let max = 0;
  for (const message of chat) {
    const parsed = parseField_ACU(fieldOf_ACU(message), deps);
    if (parsed.kind !== 'frame') continue;
    for (const delta of parsed.frame.deltas) max = Math.max(max, delta.seq);
  }
  return max;
}

function hasSchema3Checkpoint_ACU(chat: readonly unknown[], deps: AgentModuleFrameDeps_ACU): boolean {
  return chat.some(message => {
    const parsed = parseField_ACU(fieldOf_ACU(message), deps);
    return parsed.kind === 'frame' && !!parsed.frame.checkpoint;
  });
}

/**
 * 可用的 schema 3 基线：存在、与楼层当前 swipe 一致、且通过 P1 前缀指纹兼容。
 * 只判存在会在基线失配时继续追 delta（空基线上的增量链退化）；
 * 注意不能用 fold 的 checkpointIndex 代替——它同样计入 legacy 基线，
 * 而 legacy 楼层上追 delta 会整体替换掉 legacy 全量（数据丢失）。
 */
function hasUsableSchema3Checkpoint_ACU(chat: readonly unknown[], deps: AgentModuleFrameDeps_ACU): boolean {
  return chat.some(message => {
    const parsed = parseField_ACU(fieldOf_ACU(message), deps);
    if (parsed.kind !== 'frame' || !parsed.frame.checkpoint) return false;
    if (parsed.frame.checkpoint.swipeId !== readMessageSwipeId_ACU(message)) return false;
    return isCompatibleBaseline_ACU(parsed.frame.checkpoint.snapshot, chat, deps);
  });
}

/**
 * 从聊天头部折叠到 throughIndex（含）。不按数组长度钳制水位。
 * legacy 与 checkpoint 基线需通过 P1 指纹兼容检查（deps 注入），否则跳过该基线。
 */
export function foldAgentModuleSnapshot_ACU(
  chat: readonly unknown[],
  deps: AgentModuleFrameDeps_ACU,
  throughIndex = chat.length - 1,
): AgentModuleFoldResult_ACU {
  let snapshot = deps.emptySnapshot();
  let contributed = false;
  let sawSchema3Checkpoint = false;
  let checkpointIndex: number | null = null;
  let foldedDeltaCount = 0;
  let maxDeltaSeq = 0;
  let adoptedIndex: number | null = null;
  /** 被采纳基线**自身**的水位：用于判断 delta 是否把水位推过了它（推过就意味着指纹与水位不成对）。 */
  let adoptedWaterline: number | null = null;
  const candidates: AgentModuleFoldCandidate_ACU[] = [];
  let salvage: { index: number; snapshot: AgentModuleSnapshot_ACU; problems: string[] } | null = null;
  // P1：任一基线（legacy / schema3 checkpoint / 抢救快照）前缀指纹失配，
  // 即证明水位前发生过删楼/替换/重排——宽容抢救整体禁用，失配落空快照。
  let incompatibleSeen = false;
  let view = emptyFieldView_ACU();
  const end = Math.min(throughIndex, chat.length - 1);

  for (let index = 0; index <= end; index += 1) {
    const message = chat[index];
    const raw = fieldOf_ACU(message);
    if (raw === undefined) continue;
    const parsed = parseField_ACU(raw, deps);
    const swipeId = readMessageSwipeId_ACU(message);
    if (parsed.kind === 'legacy') {
      if (!isCompatibleBaseline_ACU(parsed.snapshot, chat, deps)) {
        incompatibleSeen = true;
        candidates.push({ index, valid: false, problems: ['结算水位之前的聊天前缀已变化（删楼、替换或重排），拒绝复用此快照'] });
        continue;
      }
      candidates.push({ index, valid: true, problems: [] });
      if (!sawSchema3Checkpoint && swipeId === '0') {
        snapshot = cloneJson_ACU(parsed.snapshot);
        view = seedFieldViewFromSnapshot_ACU(snapshot, parsed.snapshot.updatedAt);
        contributed = true;
        checkpointIndex = index;
        adoptedIndex = index;
        adoptedWaterline = snapshot.settledThroughIndex;
        foldedDeltaCount = 0;
      }
      continue;
    }
    if (parsed.kind === 'broken') {
      if (parsed.salvaged && !isCompatibleBaseline_ACU(parsed.salvaged, chat, deps)) {
        incompatibleSeen = true;
        candidates.push({ index, valid: false, problems: [...parsed.problems, '结算水位之前的聊天前缀已变化（删楼、替换或重排），拒绝复用抢救快照'] });
        continue;
      }
      candidates.push({ index, valid: false, problems: parsed.problems });
      if (parsed.salvaged && !incompatibleSeen) salvage = { index, snapshot: parsed.salvaged, problems: parsed.problems };
      continue;
    }
    if (parsed.kind !== 'frame') continue;
    candidates.push({ index, valid: parsed.problems.length === 0, problems: parsed.problems });
    if (parsed.frame.checkpoint && parsed.frame.checkpoint.swipeId === swipeId) {
      if (!isCompatibleBaseline_ACU(parsed.frame.checkpoint.snapshot, chat, deps)) {
        // 指纹失配的基线不可复用：只跳过该基线，同楼的当前 swipe 增量仍正常折叠。
        incompatibleSeen = true;
        candidates[candidates.length - 1].problems.push('结算水位之前的聊天前缀已变化（删楼、替换或重排），拒绝复用此基线');
      } else {
        snapshot = cloneJson_ACU(parsed.frame.checkpoint.snapshot);
        view = seedFieldViewFromSnapshot_ACU(snapshot, parsed.frame.checkpoint.snapshot.updatedAt);
        contributed = true;
        sawSchema3Checkpoint = true;
        checkpointIndex = index;
        adoptedIndex = index;
        adoptedWaterline = snapshot.settledThroughIndex;
        foldedDeltaCount = 0;
      }
    }
    for (const delta of parsed.frame.deltas) {
      // 与 swipe 无关：全聊天最大序号的口径只看帧里解析通过的 delta。
      if (delta.seq > maxDeltaSeq) maxDeltaSeq = delta.seq;
      if (delta.swipeId !== swipeId) continue;
      snapshot = applyDelta_ACU(snapshot, delta);
      if (delta.fieldUpserts) view = applyFieldUpsertsToView_ACU(view, delta.fieldUpserts, delta.updatedAt);
      reconcileFieldViewWithSnapshot_ACU(view, snapshot, delta.updatedAt);
      contributed = true;
      foldedDeltaCount += 1;
      if (adoptedIndex === null) adoptedIndex = index;
    }
  }

  if (!contributed && salvage && !incompatibleSeen) {
    return {
      snapshot: cloneJson_ACU(salvage.snapshot),
      fields: seedFieldViewFromSnapshot_ACU(salvage.snapshot, salvage.snapshot.updatedAt),
      candidates,
      adoptedIndex: salvage.index,
      salvaged: true,
      checkpointIndex: salvage.index,
      foldedDeltaCount: 0,
      maxDeltaSeq,
      contributed: true,
      chatLength: chat.length,
      tailFloor: chat[chat.length - 1],
    };
  }
  // 折叠输出必须自洽：delta 会推高 settledThroughIndex 却**从不改** settledPrefixFingerprint
  // （见 applyDelta_ACU），于是「水位＝末条 delta 的水位、指纹＝被采纳基线的水位」这种不成对的快照，
  // 一回写就会被写盘门按新水位重算指纹判为失配 ⇒「资料快照引用的聊天前缀已变化」硬报错，
  // 而聊天其实一个字没变。所有「折叠读出 → 加工 → 回写」的路径都吃这个亏（播种用户要求、
  // 结算 partial/failed 分支、用户要求维护、总纲维护），所以在折叠出口一次性重盖，
  // 而不是逐个调用点打补丁。
  // 只在「确实带了指纹、且水位被 delta 推过了基线水位」时才重算：无指纹的夹具与水位未推进的
  // 常见路径零额外开销。这**不削弱** P1 前缀守卫——重盖记录的是「此刻这次折叠所依据的聊天前缀」，
  // 之后聊天真的变了（删楼/替换正文）照样会在下一次校验时失配被拒。
  if (
    contributed
    && typeof snapshot.settledPrefixFingerprint === 'string' && snapshot.settledPrefixFingerprint
    && adoptedWaterline !== null && snapshot.settledThroughIndex !== adoptedWaterline
    && deps.restampPrefix
  ) {
    snapshot = deps.restampPrefix(snapshot, chat);
  }
  return {
    snapshot,
    fields: view,
    candidates,
    adoptedIndex: contributed ? adoptedIndex : null,
    salvaged: false,
    checkpointIndex: contributed ? checkpointIndex : null,
    foldedDeltaCount,
    maxDeltaSeq,
    contributed,
    chatLength: chat.length,
    tailFloor: chat[chat.length - 1],
  };
}

function readFrame_ACU(message: unknown, deps: AgentModuleFrameDeps_ACU): AgentModuleFloorFrame_ACU {
  const parsed = parseField_ACU(fieldOf_ACU(message), deps);
  if (parsed.kind === 'frame') return cloneJson_ACU(parsed.frame);
  return emptyFrame_ACU();
}

function writeFrame_ACU(message: Record<string, unknown>, frame: AgentModuleFloorFrame_ACU): void {
  const next: AgentModuleFloorFrame_ACU = {
    schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
    deltas: frame.deltas,
  };
  if (frame.checkpoint) next.checkpoint = frame.checkpoint;
  message[AGENT_MODULE_FIELD_ACU] = next;
}

function stripCurrentSwipeThrough_ACU(chat: unknown[], anchorIndex: number, deps: AgentModuleFrameDeps_ACU): void {
  for (let index = 0; index < chat.length; index += 1) {
    // 锚点之后的楼层整体不碰：它们的帧既不参与本次折叠归并，也不该被这里的收尾逻辑
    // 归一化重写或清空（那会丢弃不可解析的 delta、抹掉未知顶层键，并在与本次写入无关的楼层上
    // 产生额外宿主写）。逐栏与整条写入两条路径共用本函数，relocate 的语义是「搬迁 ≤ 锚点的基线」。
    if (index > anchorIndex) continue;
    const message = chat[index];
    if (!isRecord_ACU(message)) continue;
    const parsed = parseField_ACU(fieldOf_ACU(message), deps);
    if (parsed.kind !== 'frame') continue;
    const swipeId = readMessageSwipeId_ACU(message);
    const frame = cloneJson_ACU(parsed.frame);
    // 只清本次真正折进去的基线（fold 采纳口径：index <= anchor 且与楼层当前 swipe 一致）。
    // 锚点之后、他 swipe 的基线不在折叠范围内；删基线留 delta 会拼出弗兰肯斯坦快照，
    // 跨 swipe 切回、模板重置（锚点恒为首楼）等场景的旧基线也会永久丢失。
    if (frame.checkpoint?.swipeId === swipeId) delete frame.checkpoint;
    frame.deltas = frame.deltas.filter(delta => delta.swipeId !== swipeId);
    if (!frame.checkpoint && frame.deltas.length === 0) delete message[AGENT_MODULE_FIELD_ACU];
    else writeFrame_ACU(message, frame);
  }
}

/**
 * 把 throughIndex 及之前的当前 swipe 链折成锚点楼上的唯一 schema 3 基线。
 * 锚点之后的 delta 保留。没有可折叠内容时不写空基线。
 */
export function relocateContinuationCheckpoint_ACU(
  chat: unknown[],
  anchorIndex: number,
  deps: AgentModuleFrameDeps_ACU,
): boolean {
  if (!Number.isInteger(anchorIndex) || anchorIndex < 0 || anchorIndex >= chat.length) return false;
  const anchor = chat[anchorIndex];
  // 帧写入目标楼用宽档（shared/ai-floor.ts 的口径划分）：工具楼可被用户独立删除、隐藏楼用户看不见，
  // 两者都不能承载续写基线，否则基线随楼消失、宽容抢救整条退回「无可用基线」。
  if (!isAiFloor_ACU(anchor)) return false;
  const folded = foldAgentModuleSnapshot_ACU(chat, deps, anchorIndex);
  if (!folded.contributed || folded.salvaged) return false;
  const before = JSON.stringify(chat.map(message => fieldOf_ACU(message)));
  stripCurrentSwipeThrough_ACU(chat, anchorIndex, deps);
  const frame = readFrame_ACU(anchor, deps);
  // 折叠出口已经会重盖指纹（见 foldAgentModuleSnapshot_ACU 末尾），所以 folded.snapshot 到达这里时
  // (水位, 指纹) 本身是自洽的。此处仍必须再过一遍 restampFoldedSnapshot_ACU，理由是**钳位到折叠范围**：
  // 出口重盖用的是完整 chat，而本函数只折到 anchorIndex（见上面的 foldAgentModuleSnapshot_ACU 调用），
  // legacy delta 可能把水位推过 anchorIndex ⇒ 不钳位就会落一份「声明的水位与指纹超出自身折叠范围」的基线，
  // 下一次全范围折叠按该水位重算指纹必然失配 → 基线被整体拒绝 + incompatibleSeen 禁用抢救
  // + 同 swipe 的 delta 刚被上面 strip 掉 → **资料全量静默清零**。这不是可删的冗余。
  frame.checkpoint = {
    swipeId: readMessageSwipeId_ACU(anchor),
    snapshot: cloneJson_ACU(restampFoldedSnapshot_ACU(deps, folded.snapshot, chat, anchorIndex)),
  };
  writeFrame_ACU(anchor as Record<string, unknown>, frame);
  const after = JSON.stringify(chat.map(message => fieldOf_ACU(message)));
  return before !== after;
}

function appendDelta_ACU(chat: unknown[], targetIndex: number, delta: AgentModuleFloorDelta_ACU, deps: AgentModuleFrameDeps_ACU): void {
  const message = chat[targetIndex];
  if (!isRecord_ACU(message)) return;
  const frame = readFrame_ACU(message, deps);
  frame.deltas = [...frame.deltas, delta].sort((left, right) => left.seq - right.seq);
  writeFrame_ACU(message, frame);
}

export interface AgentModuleWritePlan_ACU {
  changed: boolean;
  assignments: Array<{ index: number; existed: boolean; previous: unknown; value: unknown }>;
  /**
   * 帧数据的实际承载楼（≤ targetIndex 的最近 AI 楼）。调用方传的 targetIndex 只是「结算截至哪一楼」，
   * 工具楼/隐藏楼尾时两者不是同一栋；落盘日志要报**这一栋**，否则「资料突然清零」的排障会指错楼。
   */
  frameFloor?: number | null;
  /** changed=false 时的具体原因，供回执区分「没有 AI 楼」「有遗留帧待自愈」「语义未变」。 */
  reason?: string;
}

/**
 * 规划一次快照写入：已有 schema 3 基线时只追加 delta；否则把首基线放到表格 checkpoint 楼或最新 AI 楼。
 * 不修改传入的 chat。
 *
 * `folded` 是调用方在同一操作内已折叠出的基线（写入路径先做乐观锁复核时已经折过一次），
 * 必须是**这条 chat** 的折叠结果：传别的数组会让 seq 口径漂移，传错数组时由上面的自检兜底重折。
 * scratch 是 chat 的浅拷贝、逐楼共用同一资料字段对象引用，折叠只读该引用与 swipe_id，
 * 因此「折 chat」与「折 scratch」逐字段等价，复用它不改变任何规划判定。
 */
/**
 * 规划前的折叠来源自检：折叠结果必须来自同一条 chat。
 *
 * 判据是**来源身份**（楼层数 + 尾楼对象引用），不再只看 checkpointIndex 是否越界：帧落点改成
 * 「≤ targetIndex 的最近 AI 楼」之后，更长聊天的基线也会落在本 chat 的下标范围内（逐楼写入的历史
 * 就恒落在第 0 楼），越界特征随之消失，外来基线会被静默采纳、maxDeltaSeq 口径整体漂移。
 * 宁可重折一次也不能拿错基线规划 seq；checkpointIndex 的范围检查保留作纵深防御。
 */
function isFoldResultForChat_ACU(folded: AgentModuleFoldResult_ACU, chat: readonly unknown[]): boolean {
  if (folded.chatLength !== chat.length) return false;
  if (folded.tailFloor !== chat[chat.length - 1]) return false;
  return folded.checkpointIndex === null
    || (folded.checkpointIndex >= 0 && folded.checkpointIndex < chat.length);
}

export function planAgentModuleSnapshotWrite_ACU(
  chat: unknown[],
  targetIndex: number,
  next: AgentModuleSnapshot_ACU,
  deps: AgentModuleFrameDeps_ACU,
  tableAnchorIndex: number | null,
  folded: AgentModuleFoldResult_ACU,
): AgentModuleWritePlan_ACU {
  const scratch = chat.map(message => (isRecord_ACU(message) ? { ...message } : message));
  // 帧的**落点**与调用方给的 targetIndex 解耦：targetIndex 只表达「这次结算截至哪一楼」，
  // 落点必须是 AI 楼，否则工具楼尾时资料增量会挂在可被独立删除、无 swipe_id 的楼上（见 resolveFrameFloor_ACU）。
  const frameFloor = resolveFrameFloor_ACU(scratch, targetIndex);
  if (frameFloor < 0) {
    return { changed: false, assignments: [], reason: '当前聊天没有可承载资料帧的 AI 楼层（用户楼、工具楼、隐藏楼都不能承载）' };
  }
  // 旧版本（≤ v9.8.8）把 delta 追加在物理尾楼，所以非 AI 楼上可能挂着遗留帧。折叠按楼层正序应用，
  // 落在 frameFloor 的新增量会先被应用、随后被更晚楼层的遗留帧覆盖回去（用户改一次、提示成功、
  // 重读还是旧值，且不会自愈）。整条快照路径可以自愈：遗留内容已经在折叠结果里，本次以全量基线落盘，
  // 并把遗留帧物理摘掉。逐栏路径不折叠、无处吸收，只能先拒一次（见 planAgentModuleFieldWrite_ACU）。
  const strayFloorIndexes = collectStrayFrameFloors_ACU(scratch, deps);
  const before = isFoldResultForChat_ACU(folded, chat)
    ? folded
    : foldAgentModuleSnapshot_ACU(scratch, deps);
  const clamped: AgentModuleSnapshot_ACU = alignSnapshotToFloor_ACU(deps, {
    ...cloneJson_ACU(next),
    settledThroughIndex: clampWaterline_ACU(next.settledThroughIndex, targetIndex),
    updatedAt: Date.now(),
  }, scratch, frameFloor);
  // 对齐不了（deps 没注入，或旧指纹与当前聊天已经不符）就不写：一份「水位指向非 AI 楼」的基线，
  // 会在用户删掉那栋楼时因前缀指纹失配被折叠整体拒绝，资料清零——比不写这次严重得多。
  if (clamped.settledThroughIndex > frameFloor) {
    return { changed: false, assignments: [], frameFloor, reason: '资料快照的结算水位无法对齐到承载楼（聊天前缀已变化），拒绝写入' };
  }
  if (before.contributed && !before.salvaged && sameSemantic_ACU(before.snapshot, clamped) && !strayFloorIndexes.length) {
    return { changed: false, assignments: [], frameFloor };
  }
  const base = before.contributed ? before.snapshot : deps.emptySnapshot();
  // 序号取折叠结果自带的 maxDeltaSeq：本次折叠已对全聊天逐楼深度解析过，口径与旧的
  // maxSeq 扫描完全相同（只统计 parseDelta 通过的 delta），省掉一整趟全聊天解析。
  const delta = diffSnapshot_ACU(base, clamped, readMessageSwipeId_ACU(scratch[frameFloor]), before.maxDeltaSeq + 1);
  // 失配的旧基线（swipe 切换/指纹失配）视为不可用：走建新 checkpoint 分支自愈，
  // 而不是在被折叠跳过的基线上继续追 delta。有遗留帧时同样强制走这条分支：
  // 只有全量基线才能把遗留内容一并承载，随后才能安全摘掉遗留帧。
  const hadUsableCheckpoint = !strayFloorIndexes.length && hasUsableSchema3Checkpoint_ACU(scratch, deps);
  // 本次是否真的落下了一份能承载遗留内容的全量基线：遗留帧的摘除必须以它为前提，
  // 否则就是「帧已摘、基线未落」——遗留增量既不在新基线里、也没了出处，静默丢数据。
  // ⚠️ 隐含前置条件：`clamped` 必须由**本聊天的一次折叠**派生（生产四个调用方都满足：
  // 结算路径的 committed = readAgentModuleSnapshot_ACU(chat)、用户保存的 {...current, ...raw}、
  // 播种与资料补足同理）。若调用方塞进一份与当前折叠无关的快照，「吸收」就不成立。
  let absorbedByCheckpoint = false;
  if (hadUsableCheckpoint) {
    if (delta) appendDelta_ACU(scratch, frameFloor, delta, deps);
  } else {
    const tableAnchor = tableAnchorIndex !== null && isAiFloor_ACU(scratch[tableAnchorIndex]) ? tableAnchorIndex : null;
    // 有遗留帧时必须把锚点收在承载楼：只有 anchor === frameFloor 才会以 clamped（已对齐、且折叠已含
    // 遗留内容）落全量基线；交给 tableAnchor 会走 base 分支，一旦 (W, 指纹) 处理不当就落不下去，
    // 摘除前提随之落空。表格基线的跟随稍后仍由 relocateContinuationCheckpoint_ACU 补回。
    const anchor = strayFloorIndexes.length ? frameFloor : (tableAnchor ?? frameFloor);
    const anchorMessage = scratch[anchor];
    if (isRecord_ACU(anchorMessage)) {
      const useClamped = frameFloor <= anchor || !delta;
      // caller 在飞快照（clamped）走「校验旧指纹再钳位重算」；折叠派生快照（base）走「按自身水位重盖指纹」，
      // 两者的理由与失效模式不同，见各自 helper 的注释。
      const checkpointSnapshot = useClamped
        ? alignSnapshotToFloor_ACU(deps, clamped, scratch, anchor)
        : restampFoldedSnapshot_ACU(deps, base, scratch, anchor);
      if (checkpointSnapshot.settledThroughIndex <= anchor && deps.validateSnapshot(checkpointSnapshot)) {
        // 写新基线前先清掉 ≤ anchor 各楼上**同当前 swipe**的旧基线与增量：新基线是全量、已吸收它们，
        // 留着会让同一 swipe 出现多个活跃基线，assertSingleActiveContinuationCheckpoint_ACU 一旦报错，
        // 删楼恢复会整批回滚（表格回放根与向量 checkpoint 一并嫁不进去）且对用户静默。
        stripCurrentSwipeThrough_ACU(scratch, anchor, deps);
        const frame = readFrame_ACU(anchorMessage, deps);
        frame.checkpoint = { swipeId: readMessageSwipeId_ACU(anchorMessage), snapshot: cloneJson_ACU(checkpointSnapshot) };
        if (anchor === frameFloor) frame.deltas = frame.deltas.filter(item => item.swipeId !== frame.checkpoint?.swipeId);
        writeFrame_ACU(anchorMessage, frame);
        absorbedByCheckpoint = true;
      }
    }
    if (delta && frameFloor > anchor) appendDelta_ACU(scratch, frameFloor, delta, deps);
  }
  // 摘掉遗留帧（只摘参与当前折叠的那部分，他 swipe 内容切回时必须还能恢复）：
  // **领域数组**内容已由本次全量基线承载，留着只会让折叠序倒挂——新值被更晚楼层的旧值覆盖回去。
  // 注意口径：遗留帧里的**逐栏 partial 草稿**不参与基线（checkpoint 的类型里没有承载分栏视图的位置，
  // folded.fields 明确只读、绝不写回持久帧），所以它会随摘除一起退出——这与
  // relocateContinuationCheckpoint_ACU 每次归并的性质相同，是帧架构的既有取舍，不是本处新引入的丢失。
  if (absorbedByCheckpoint) {
    for (const index of strayFloorIndexes) removeCurrentSwipeFrame_ACU(scratch[index]);
  }
  const assignments: AgentModuleWritePlan_ACU['assignments'] = [];
  scratch.forEach((message, index) => {
    const previous = fieldOf_ACU(chat[index]);
    const value = fieldOf_ACU(message);
    if (JSON.stringify(previous) === JSON.stringify(value)) return;
    assignments.push({
      index,
      existed: previous !== undefined,
      previous,
      value,
    });
  });
  return { changed: assignments.length > 0, assignments, frameFloor };
}

/**
 * 规划一次逐栏写入：只把 fieldUpserts 作为一条 delta 追加到目标楼层，
 * 不产生 checkpoint、不触碰领域数组；缺栏记录经折叠只进入受控分栏视图。
 * 不修改传入的 chat。无有效栏目时返回 changed=false。
 */
export function planAgentModuleFieldWrite_ACU(
  chat: unknown[],
  targetIndex: number,
  fieldUpserts: AgentModuleFieldUpserts_ACU,
  deps: AgentModuleFrameDeps_ACU,
): AgentModuleWritePlan_ACU {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= chat.length) {
    return { changed: false, assignments: [] };
  }
  // 落帧楼层与 targetIndex 解耦（同 planAgentModuleSnapshotWrite_ACU）：调用方一律传物理尾楼，
  // 而 TT 2.3.0 的尾楼可以是一等工具楼——逐栏草稿挂上去，用户删掉工具楼就丢草稿。
  const frameFloor = resolveFrameFloor_ACU(chat, targetIndex);
  if (frameFloor < 0) {
    return { changed: false, assignments: [], reason: '当前聊天没有可承载资料帧的 AI 楼层（用户楼、工具楼、隐藏楼都不能承载）' };
  }
  // 遗留帧门：非 AI 楼上还挂着旧版本（≤ v9.8.8）写下的帧时，逐栏路径必须先拒一次。它不折叠、
  // 无处吸收遗留内容，写下去会与遗留帧形成楼层序倒挂（新草稿被更晚楼层的旧增量覆盖回去）。
  // 整条快照写入每轮结算都会跑，会把遗留帧吸收进全量基线并摘掉，所以阻塞窗口只有一轮。
  if (collectStrayFrameFloors_ACU(chat, deps).length) {
    return {
      changed: false,
      assignments: [],
      frameFloor,
      reason: '检测到旧版本遗留在非 AI 楼层上的资料帧，需先完成一次整条快照写入以自愈（本轮结算会自动完成）',
    };
  }
  // 目标种类门（fail-closed）：承载楼已有字段但不是 schema-3 帧（legacy 全量 / broken）
  // 时拒绝逐栏写入。appendDelta 的读—改—写会把整楼替换为仅一条 field delta 的帧：
  // legacy 全量永久消失（field delta 不投影领域数组），broken 楼丧失抢救机会。
  // legacy 先经整条写入迁移，broken 保留抢救路径；与 T1 迁移纪律一致。
  const existing = fieldOf_ACU(chat[frameFloor]);
  if (existing !== undefined && parseField_ACU(existing, deps).kind !== 'frame') {
    return { changed: false, assignments: [], frameFloor, reason: '承载楼层携带的是旧式全量资料或已损坏的帧，需先经整条写入迁移' };
  }
  const cleaned: AgentModuleFieldUpserts_ACU = {};
  let hasWrite = false;
  for (const key of AGENT_WRITABLE_MODULES_ACU) {
    const moduleUpserts = fieldUpserts[key];
    if (!moduleUpserts || !isRecord_ACU(moduleUpserts)) continue;
    const matrix = AGENT_MODULE_FIELD_MATRIX_ACU[key];
    const kept: Record<string, Record<string, AgentModuleFieldWrite_ACU>> = {};
    for (const [rawId, writes] of Object.entries(moduleUpserts)) {
      const id = String(rawId ?? '').trim();
      if (!id || !isRecord_ACU(writes)) continue;
      const keptFields: Record<string, AgentModuleFieldWrite_ACU> = {};
      for (const [field, write] of Object.entries(writes as Record<string, AgentModuleFieldWrite_ACU>)) {
        if (!matrix.fields.includes(field)) continue;
        if (write && typeof write === 'object' && (write as AgentModuleFieldWrite_ACU).unset === true) {
          keptFields[field] = { unset: true };
          continue;
        }
        if (!write || typeof write !== 'object' || !Object.prototype.hasOwnProperty.call(write, 'value')) continue;
        keptFields[field] = { value: cloneJson_ACU((write as AgentModuleFieldWrite_ACU).value) };
      }
      if (Object.keys(keptFields).length) {
        kept[id] = keptFields;
        hasWrite = true;
      }
    }
    if (Object.keys(kept).length) cleaned[key] = kept;
  }
  if (!hasWrite) return { changed: false, assignments: [] };
  const scratch = chat.map(message => (isRecord_ACU(message) ? { ...message } : message));
  const delta: AgentModuleFloorDelta_ACU = {
    seq: maxSeq_ACU(scratch, deps) + 1,
    swipeId: readMessageSwipeId_ACU(scratch[frameFloor]),
    writes: {},
    fieldUpserts: cleaned,
    revisions: {},
    updatedAt: Date.now(),
  };
  appendDelta_ACU(scratch, frameFloor, delta, deps);
  const assignments: AgentModuleWritePlan_ACU['assignments'] = [];
  scratch.forEach((message, index) => {
    const previous = fieldOf_ACU(chat[index]);
    const value = fieldOf_ACU(message);
    if (JSON.stringify(previous) === JSON.stringify(value)) return;
    assignments.push({ index, existed: previous !== undefined, previous, value });
  });
  return { changed: assignments.length > 0, assignments, frameFloor };
}

export function continuationCheckpointArtifact_ACU(
  message: unknown,
  deps: AgentModuleFrameDeps_ACU,
): { swipeId: string; snapshot: AgentModuleSnapshot_ACU } | null {
  const parsed = parseField_ACU(fieldOf_ACU(message), deps);
  if (parsed.kind !== 'frame' || !parsed.frame.checkpoint) return null;
  return cloneJson_ACU(parsed.frame.checkpoint);
}

/** 把丢失的基线嫁到目标楼。目标楼同一 swipe 已有基线时不覆盖。 */
export function graftContinuationCheckpoint_ACU(
  message: unknown,
  artifact: { swipeId: string; snapshot: AgentModuleSnapshot_ACU },
  deps: AgentModuleFrameDeps_ACU,
): boolean {
  if (!isRecord_ACU(message)) return false;
  // 与 relocateContinuationCheckpoint_ACU 同款门：基线只能落在可见 AI 楼。嫁到工具楼/隐藏楼上，
  // 折叠会在该楼**重置**快照，把更晚楼层上的新增量整体吞掉，而且没有任何报错。
  if (!isAiFloor_ACU(message)) return false;
  const frame = readFrame_ACU(message, deps);
  if (frame.checkpoint && frame.checkpoint.swipeId === artifact.swipeId) return false;
  if (frame.checkpoint) return false;
  frame.checkpoint = cloneJson_ACU(artifact);
  writeFrame_ACU(message, frame);
  return true;
}

/** 每个当前 swipe 至多一个 schema 3 基线。legacy 全量不计入。 */
export function assertSingleActiveContinuationCheckpoint_ACU(chat: readonly unknown[], deps: AgentModuleFrameDeps_ACU): string | null {
  const seen = new Map<string, number>();
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    const parsed = parseField_ACU(fieldOf_ACU(message), deps);
    if (parsed.kind !== 'frame' || !parsed.frame.checkpoint) continue;
    if (parsed.frame.checkpoint.swipeId !== readMessageSwipeId_ACU(message)) continue;
    const swipeId = parsed.frame.checkpoint.swipeId;
    const previous = seen.get(swipeId);
    if (previous !== undefined) return `续写资料 swipe ${swipeId} 存在多个活跃基线：楼层 ${previous} 与 ${index}`;
    seen.set(swipeId, index);
  }
  return null;
}

export function chatHasContinuationMaterial_ACU(chat: readonly unknown[]): boolean {
  return chat.some(message => fieldOf_ACU(message) !== undefined);
}
