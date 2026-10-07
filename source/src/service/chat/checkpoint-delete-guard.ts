/**
 * service/chat/checkpoint-delete-guard.ts — 删楼 checkpoint 保管库与前移恢复（S0-4）
 *
 * 背景：宿主的 MESSAGE_DELETED 在消息已从 chat 数组 splice 并保存之后才触发。
 * 被删楼层携带的 full checkpoint（回放根）、perSheetCheckpoints（休眠表恢复数据 /
 * 结构 shard）、过渡根在事件到达时已经从数组中消失，冷回放会直接判定"无根 / 休眠
 * 数据丢失"。补救只能依赖删除发生前捕获的影子副本（保管库 vault）。
 *
 * 设计：
 * - vault 按 chatKey 隔离，逐 isolationKey 按楼层序记录每个 V2 frame 的消息对象引用
 *   与不可替代产物的深克隆；log-only 帧只存引用作后继信标（零克隆成本）。
 *   宿主删楼对同一数组 splice，幸存消息对象引用不变——用对象引用判"楼层是否被删"
 *   零误报，无需内容指纹。
 * - 捕获点：聊天加载完成 + 每次插件保存成功后（chat-gateway post-save 监听）。插件
 *   自身的 purge / 清空 / compaction 删楼都以插件保存收尾，保存同步会以当前聊天为
 *   权威重建 vault，因此插件侧的删除天然不会被本模块复活（防"删了重生"语义保持）。
 * - 恢复点：MESSAGE_DELETED 调度轮开头（冷回放之前）。丢失产物嫁接到其原位置之后
 *   第一个幸存 frame 楼层：帧内 checkpoint 先于 logEntries 回放；过渡根必须从删楼后的
 *   幸存历史重算 data/cutoff 并通过严格回放校验，无法证明安全时拒绝保存。被删楼层自身
 *   的 logEntries 不恢复（删楼 = 撤销该楼编辑）。
 *
 * 残余竞态（接受并记录）：删楼后调度防抖窗口（1.2s）内若插件恰好完成一次保存，
 * post-save 同步会先丢弃待恢复产物。生成 / 填表落盘耗时远大于该窗口，实际不可达。
 */
import {
    getChatArray_ACU,
    registerPostChatSaveListener_ACU,
    saveChatToHostStrict_ACU,
} from '../../data/gateways/chat-gateway';
import { readIsolatedDataContainer_ACU, readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { normalizeCanonicalTableRows_ACU } from '../../shared/canonical-row-normalizer';
import { dedupeCompatTransitionRowIdentities_ACU } from '../table/compat-transition-checkpoint';
import type { CompatTransitionCheckpointRef_ACU, Spv79TransitionCheckpointRef_ACU } from '../table/compat-transition-checkpoint';
import { collectScheduleSummaryFromFramesV2_ACU, loadTableStateFromFramesV2Detailed_ACU, replayWithLegacyTolerances_ACU } from '../table/storage-frame-v2-replay';
import { getTableDataFingerprint_ACU } from '../table/table-data-upgrade-audit';
import { isV2TagData_ACU } from '../table/storage-strategy-resolver';
import { isAiFloor_ACU } from '../../shared/ai-floor';
import { assertSingleActiveFullCheckpointV2_ACU } from '../table/storage-frame-v2-persist';
import {
  assertMaterialContinuationCheckpoint_ACU,
  captureMaterialCheckpointRecovery_ACU,
  graftMaterialContinuationCheckpoint_ACU,
  restoreMaterialCheckpointFields_ACU,
  snapshotMaterialCheckpointFields_ACU,
} from './material-checkpoint-sync';
import { runTableWriteTransaction_ACU } from '../table/table-write-transaction';
import { currentChatFileIdentifier_ACU, getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { deepClone_ACU, logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import type {
    SummaryVectorIndexMirrorCheckpointV2_ACU,
    TableCheckpointV2_ACU,
    TableSheetCheckpointV2_ACU,
    TableStorageFrameV2_ACU,
} from '../table/storage-frame-v2-types';

/** 一楼不可替代产物的克隆集合（与信标 messageRef 分离，便于按引用记忆化复用）。 */
interface CheckpointVaultFrameEntryArtifactSet_ACU {
    fullCheckpoint: TableCheckpointV2_ACU | null;
    perSheetCheckpoints: Record<string, TableSheetCheckpointV2_ACU> | null;
    summaryVectorCheckpoint: {
        sourceTableKey: string;
        checkpoint: SummaryVectorIndexMirrorCheckpointV2_ACU;
    } | null;
    spv79TransitionCheckpoint: any | null;
    compatTransitionCheckpoint: any | null;
}

interface CheckpointVaultFrameEntry_ACU extends CheckpointVaultFrameEntryArtifactSet_ACU {
    /** 幸存判定锚：宿主 splice 不改变幸存消息的对象引用。 */
    messageRef: any;
}

interface MaterialCheckpointVaultEntry_ACU {
    messageRef: any;
    continuation: { swipeId: string; snapshot: unknown } | null;
}

interface CheckpointVaultState_ACU {
    chatKey: string;
    /** isolationKey → 按楼层序的 frame 条目（含 log-only 信标）。 */
    entriesByIsolationKey: Map<string, CheckpointVaultFrameEntry_ACU[]>;
    /** 续写基线，按楼层序。与表格产物同一轮嫁接（TT-only）。 */
    materialEntries: MaterialCheckpointVaultEntry_ACU[];
}

export interface CheckpointDeleteRecoveryResult_ACU {
    /** 本轮是否执行了嫁接写入。 */
    recovered: boolean;
    /** 成功嫁接的产物数（full=1、每个 per-sheet checkpoint=1、每个过渡根=1）。 */
    graftedCount: number;
    error?: string;
}

let vault_ACU: CheckpointVaultState_ACU | null = null;
let installed_ACU = false;

function hasEntries_ACU(record: Record<string, unknown> | null | undefined): boolean {
    return !!record && typeof record === 'object' && !Array.isArray(record) && Object.keys(record).length > 0;
}

function entryHasArtifacts_ACU(entry: CheckpointVaultFrameEntry_ACU): boolean {
    return !!entry.fullCheckpoint
        || hasEntries_ACU(entry.perSheetCheckpoints)
        || !!entry.summaryVectorCheckpoint
        || !!entry.spv79TransitionCheckpoint
        || !!entry.compatTransitionCheckpoint;
}

/**
 * 记忆化 head：上一轮（或本轮）克隆所依据的源对象/值集合。
 * 全部按引用与原值比较，引用未变即认定产物内容未变。
 */
interface VaultArtifactHead_ACU {
    /** 参与冻结的 full 回放根本体。 */
    full: unknown;
    /** per-sheet 锚容器（克隆源）。 */
    perSheetContainer: unknown;
    /** per-sheet 锚逐 sheetKey 的源对象引用：容器被原地增删也能被识别。 */
    perSheetRefs: ReadonlyMap<string, unknown>;
    /** 向量镜像帧（克隆源）。 */
    vectorFrame: unknown;
    vectorCheckpoint: unknown;
    vectorSourceTableKey: string;
    spv79: unknown;
    compat: unknown;
}

const EMPTY_REFS_ACU: ReadonlyMap<string, unknown> = new Map<string, unknown>();

function isSameArtifactHead_ACU(left: VaultArtifactHead_ACU, right: VaultArtifactHead_ACU): boolean {
    if (left.full !== right.full
        || left.perSheetContainer !== right.perSheetContainer
        || left.vectorFrame !== right.vectorFrame
        || left.vectorCheckpoint !== right.vectorCheckpoint
        || left.vectorSourceTableKey !== right.vectorSourceTableKey
        || left.spv79 !== right.spv79
        || left.compat !== right.compat) return false;
    if (left.perSheetRefs.size !== right.perSheetRefs.size) return false;
    for (const [sheetKey, ref] of left.perSheetRefs) {
        if (right.perSheetRefs.get(sheetKey) !== ref) return false;
    }
    return true;
}

function readPerSheetRefs_ACU(container: unknown): ReadonlyMap<string, unknown> {
    if (!hasEntries_ACU(container as Record<string, unknown> | null | undefined)) return EMPTY_REFS_ACU;
    const refs = new Map<string, unknown>();
    for (const [sheetKey, checkpoint] of Object.entries(container as Record<string, unknown>)) refs.set(sheetKey, checkpoint);
    return refs;
}

/**
 * 产物克隆记忆化：键是「根对象引用」（每楼每隔离键的 tagData，帧与过渡根的共同根），
 * 值是本轮 head 标识与已克隆产物。同一对象再出现且 head 完全一致时直接复用上轮克隆——
 * 每次落盘只为真正变化的产物重新深克隆整库 checkpoint，其余只刷新增量信标（messageRef 等）。
 *
 * 不变式：产物要么被换新对象（head 变化 → 重新克隆），要么内容不变；
 * 本模块的嫁接写入也遵循该约定（整体替换对象，不原地改产物字段）。
 */
let vaultArtifactMemo_ACU = new WeakMap<object, { head: VaultArtifactHead_ACU; clones: CheckpointVaultFrameEntryArtifactSet_ACU }>();

function resolveVaultArtifacts_ACU(
    root: object,
    frame: TableStorageFrameV2_ACU | null,
    spv79: Spv79TransitionCheckpointRef_ACU | null,
    compat: CompatTransitionCheckpointRef_ACU | null,
): CheckpointVaultFrameEntryArtifactSet_ACU {
    const vectorFrame = frame?.summaryVectorIndexFrame && typeof frame.summaryVectorIndexFrame === 'object'
        ? frame.summaryVectorIndexFrame
        : null;
    const perSheetContainer = frame && hasEntries_ACU(frame.perSheetCheckpoints) ? frame.perSheetCheckpoints : null;
    const head: VaultArtifactHead_ACU = {
        full: frame?.checkpoint?.kind === 'full' ? frame.checkpoint : null,
        perSheetContainer,
        perSheetRefs: readPerSheetRefs_ACU(perSheetContainer),
        vectorFrame,
        vectorCheckpoint: vectorFrame?.checkpoint?.kind === 'vector_full' ? vectorFrame.checkpoint : null,
        vectorSourceTableKey: vectorFrame ? String(vectorFrame.sourceTableKey || '') : '',
        spv79: spv79 ?? null,
        compat: compat ?? null,
    };
    const memo = vaultArtifactMemo_ACU.get(root);
    if (memo && isSameArtifactHead_ACU(memo.head, head)) return memo.clones;

    const clones: CheckpointVaultFrameEntryArtifactSet_ACU = {
        fullCheckpoint: head.full ? deepClone_ACU(head.full as TableCheckpointV2_ACU) : null,
        perSheetCheckpoints: perSheetContainer
            ? deepClone_ACU(perSheetContainer as Record<string, TableSheetCheckpointV2_ACU>)
            : null,
        summaryVectorCheckpoint: head.vectorCheckpoint
            ? {
                sourceTableKey: head.vectorSourceTableKey,
                checkpoint: deepClone_ACU(head.vectorCheckpoint as SummaryVectorIndexMirrorCheckpointV2_ACU),
            }
            : null,
        spv79TransitionCheckpoint: head.spv79 ? deepClone_ACU(head.spv79) : null,
        compatTransitionCheckpoint: head.compat ? deepClone_ACU(head.compat) : null,
    };
    vaultArtifactMemo_ACU.set(root, { head, clones });
    return clones;
}

/** 测试用：丢弃记忆化（换新 WeakMap；条目本身不持有引用，无泄漏）。 */
function resetVaultArtifactMemo_ACU(): void {
    vaultArtifactMemo_ACU = new WeakMap();
}

/**
 * 以当前聊天为权威重建保管库。
 * 调用时机：聊天加载完成、插件保存成功后、恢复嫁接成功后。
 *
 * 单遍全聊天：每楼同时取表格产物条目与续写基线（旧实现两遍全聊天循环）。
 * 产物克隆按「根对象引用 + head 标识」记忆化，未变化的楼层不再深克隆整库 checkpoint。
 */
export function captureCheckpointVaultForCurrentChat_ACU(chatArg?: any[]): void {
    const chat = Array.isArray(chatArg) ? chatArg : getChatArray_ACU();
    const chatKey = String(currentChatFileIdentifier_ACU || '');
    const entriesByIsolationKey = new Map<string, CheckpointVaultFrameEntry_ACU[]>();
    const materialEntries: MaterialCheckpointVaultEntry_ACU[] = [];

    for (const message of chat) {
        if (!message || message.is_user) continue;
        // 续写基线与表格产物同轮捕获：无容器的楼层同样可能有续写资料字段。
        const continuation = captureMaterialCheckpointRecovery_ACU(message)?.continuation ?? null;
        if (continuation) materialEntries.push({ messageRef: message, continuation });

        const container = readIsolatedDataContainer_ACU(message);
        if (!container) continue;
        for (const [isolationKey, tagData] of Object.entries(container)) {
            if (!tagData || typeof tagData !== 'object') continue;
            const frame = isV2TagData_ACU(tagData) ? tagData.storageFrame : null;
            const spv79 = (tagData as any).spv79TransitionCheckpoint?.kind === 'spv79_duplicate_row_id_transition'
                ? (tagData as any).spv79TransitionCheckpoint : null;
            const compat = (tagData as any).compatTransitionCheckpoint?.kind === 'compat_replay_transition'
                ? (tagData as any).compatTransitionCheckpoint : null;
            if (!frame && !spv79 && !compat) continue;

            const entries = entriesByIsolationKey.get(isolationKey) || [];
            entries.push({ messageRef: message, ...resolveVaultArtifacts_ACU(tagData, frame, spv79, compat) });
            entriesByIsolationKey.set(isolationKey, entries);
        }
    }

    vault_ACU = { chatKey, entriesByIsolationKey, materialEntries };
}

/** 切聊 / 测试清理。 */
export function resetCheckpointVault_ACU(): void {
    vault_ACU = null;
}

/** 注册 post-save 捕获监听。幂等，重复调用只注册一次。 */
export function installCheckpointDeleteGuard_ACU(): void {
    if (installed_ACU) return;
    installed_ACU = true;
    registerPostChatSaveListener_ACU(() => {
        try {
            captureCheckpointVaultForCurrentChat_ACU();
        } catch (error: any) {
            logWarn_ACU('[删楼守卫] post-save 保管库同步失败:', error?.message || error);
        }
    });
}

function ensureTargetFrame_ACU(message: any, isolationKey: string): TableStorageFrameV2_ACU {
    if (!message.TavernDB_ACU_IsolatedData
        || typeof message.TavernDB_ACU_IsolatedData !== 'object'
        || Array.isArray(message.TavernDB_ACU_IsolatedData)) {
        message.TavernDB_ACU_IsolatedData = {};
    }
    const container = message.TavernDB_ACU_IsolatedData;
    if (!container[isolationKey] || typeof container[isolationKey] !== 'object') {
        container[isolationKey] = {};
    }
    const tagData = container[isolationKey];
    if (!isV2TagData_ACU(tagData)) {
        tagData.storageFrame = { version: 2, logEntries: [] } satisfies TableStorageFrameV2_ACU;
        tagData._acu_storage_version = 2;
    }
    return tagData.storageFrame;
}

interface GraftPlanItem_ACU {
    entry: CheckpointVaultFrameEntry_ACU;
    isolationKey: string;
    /** vault 序列中的原始位置（用于找后继）。 */
    vaultIndex: number;
}

function findGraftTargetMessage_ACU(
    chat: any[],
    presentMessages: Set<any>,
    entries: CheckpointVaultFrameEntry_ACU[],
    lostIndex: number,
    isolationKey: string,
): { message: any; absorbedEarlierFrame: boolean } | null {
    // 首选：原位置之后第一个幸存且仍携带 V2 frame 的楼层——帧内 checkpoint 先于
    // logEntries 回放，落在后继帧上顺序与删除前完全一致。
    for (let i = lostIndex + 1; i < entries.length; i += 1) {
        const candidate = entries[i];
        if (!presentMessages.has(candidate.messageRef)) continue;
        const tagData = readIsolatedTagData_ACU(candidate.messageRef, isolationKey);
        if (isV2TagData_ACU(tagData)) {
            return { message: candidate.messageRef, absorbedEarlierFrame: false };
        }
    }
    // 无后继帧：落到聊天最后一个**非用户**楼层（表格数据可以挂在被 /hide 的楼上，所以这里不按 AI 楼收窄；
    // 续写基线一侧另行按 isAiFloor_ACU 过滤，见 materialEntries 的嫁接靶楼选择）。若该楼层携带的是更早的
    // frame，其 logs 已被丢失 checkpoint 的 data 吸收（checkpoint 写于其后），由调用方清空并警告。
    for (let i = chat.length - 1; i >= 0; i -= 1) {
        const message = chat[i];
        if (!message || message.is_user) continue;
        const tagData = readIsolatedTagData_ACU(message, isolationKey);
        const hasEarlierFrame = isV2TagData_ACU(tagData) && tagData.storageFrame.logEntries.length > 0;
        return { message, absorbedEarlierFrame: hasEarlierFrame };
    }
    return null;
}

interface RebuiltTransition_ACU {
    targetMessage: any;
    checkpoint: Record<string, any>;
}

/**
 * 过渡根不是普通 frame：它的 data/cutoff 是“截至某个 operation 的完整快照”。
 * 删掉承载楼层后不能只把对象搬到后继楼层，否则原 cutoff 会落在新的物理索引
 * 上并吞掉真实后缀。这里从幸存聊天重新跑兼容回放，生成新的完整快照与 cutoff；
 * 若没有可证明的 full 基底、身份归并或 canonical 校验失败，交给调用方阻止保存。
 */
async function rebuildDeletedTransition_ACU(
    survivingChat: any[],
    isolationKey: string,
    targetMessage: any,
): Promise<RebuiltTransition_ACU> {
    const tolerant = await replayWithLegacyTolerances_ACU(survivingChat, isolationKey);
    if (tolerant.toleranceReport.identityRemaps.length > 0) {
        throw new Error(`[删楼守卫] isolationKey=[${isolationKey || '无标签'}] 的幸存历史含身份归并，无法安全重建过渡根。`);
    }

    // 重建的是 compat 过渡根：必须保留既有 row_id（去重只修空/冲突），否则根之后
    // 仍按原 id 引用的严格增量会落空——与回放返回/固化路径用同一去重纯函数。
    const data = dedupeCompatTransitionRowIdentities_ACU(tolerant.data).data;
    const normalization = normalizeCanonicalTableRows_ACU(data);
    if (normalization.errors.length > 0 || normalization.removedRows.length > 0) {
        throw new Error(`[删楼守卫] isolationKey=[${isolationKey || '无标签'}] 的幸存历史无法通过 canonical 行校验，拒绝重建过渡根。`);
    }

    let scheduleSummary: Record<string, any> | undefined;
    try {
        scheduleSummary = collectScheduleSummaryFromFramesV2_ACU(survivingChat, isolationKey);
    } catch (_) {
        scheduleSummary = undefined;
    }

    return {
        targetMessage,
        checkpoint: {
            version: 1,
            kind: 'compat_replay_transition',
            createdAt: Date.now(),
            data: deepClone_ACU(data),
            cutoff: tolerant.cutoff,
            ...(scheduleSummary === undefined ? {} : { scheduleSummary }),
            tolerances: ['delete_recovery_rebuild'],
        },
    };
}

/**
 * MESSAGE_DELETED 后的前移恢复：把被删楼层携带的不可替代产物嫁接到最近的幸存楼层。
 * 在冷回放之前调用；无丢失时零写入零保存。
 */
export async function recoverLostCheckpointsAfterMessageDeletion_ACU(): Promise<CheckpointDeleteRecoveryResult_ACU> {
    const chat = getChatArray_ACU();
    const chatKey = String(currentChatFileIdentifier_ACU || '');
    if (!vault_ACU || vault_ACU.chatKey !== chatKey || !Array.isArray(chat) || chat.length === 0) {
        return { recovered: false, graftedCount: 0 };
    }

    const presentMessages = new Set<any>(chat);
    const lostItems: GraftPlanItem_ACU[] = [];
    for (const [isolationKey, entries] of vault_ACU.entriesByIsolationKey) {
        entries.forEach((entry, vaultIndex) => {
            if (presentMessages.has(entry.messageRef)) return;
            if (!entryHasArtifacts_ACU(entry)) return;
            lostItems.push({ entry, isolationKey, vaultIndex });
        });
    }
    const presentMessagesForVault = presentMessages;
    const hasLostMaterial = (vault_ACU.materialEntries || []).some(entry => !presentMessagesForVault.has(entry.messageRef) && !!entry.continuation);
    if (lostItems.length === 0 && !hasLostMaterial) return { recovered: false, graftedCount: 0 };

    return runTableWriteTransaction_ACU({
        source: 'system_cleanup',
        reason: 'message_delete_checkpoint_recovery',
        isolationKey: getCurrentIsolationKey_ACU(),
        writeSet: [{ kind: 'all' }],
        maintenanceMode: 'exclusive',
        guardChatSwitch: true,
    }, async (): Promise<CheckpointDeleteRecoveryResult_ACU> => {
        // chat 在锁外取得：等锁期间宿主换了聊天数组就放弃，不得把旧聊天的产物嫁接进新聊天（R3-09）。
        if (getChatArray_ACU() !== chat || String(currentChatFileIdentifier_ACU || '') !== chatKey) {
            return { recovered: false, graftedCount: 0 };
        }
        // 只快照将被改写的消息的 IsolatedData 字段，失败时整体还原。
        const snapshots = new Map<any, string | undefined>();
        const snapshotTarget = (message: any): void => {
            if (snapshots.has(message)) return;
            const field = message.TavernDB_ACU_IsolatedData;
            snapshots.set(message, field === undefined ? undefined : JSON.stringify(field));
        };
        const restoreSnapshots = (): void => {
            for (const [message, serialized] of snapshots) {
                if (serialized === undefined) delete message.TavernDB_ACU_IsolatedData;
                else message.TavernDB_ACU_IsolatedData = JSON.parse(serialized);
            }
        };

        let graftedCount = 0;
        const affectedIsolationKeys = new Set<string>();
        const survivingChat = deepClone_ACU(chat);
        const transitionTargets = new Map<string, any>();
        const materialSnapshots = snapshotMaterialCheckpointFields_ACU(chat);
        const graftTargetByLostMessage = new Map<any, any>();
        try {
            // 逆序处理：同 sheetKey 冲突时"原始位置更靠后的产物"先占位，更早的被
            // 目标已有判定跳过——幸存者/更新者优先的语义由同一条规则统一表达。
            for (const item of [...lostItems].reverse()) {
                const { entry, isolationKey, vaultIndex } = item;
                const entries = vault_ACU!.entriesByIsolationKey.get(isolationKey)!;
                const target = findGraftTargetMessage_ACU(chat, presentMessages, entries, vaultIndex, isolationKey);
                if (!target) {
                    if (entry.spv79TransitionCheckpoint || entry.compatTransitionCheckpoint) {
                        throw new Error(`[删楼守卫] isolationKey=[${isolationKey || '无标签'}] 的丢失过渡根无处重建，拒绝保存。`);
                    }
                    logError_ACU(`[删楼守卫] isolationKey=[${isolationKey || '无标签'}] 的丢失 checkpoint 无处嫁接（聊天已无 AI 楼层），保留保管库等待下次机会。`);
                    continue;
                }
                snapshotTarget(target.message);
                graftTargetByLostMessage.set(entry.messageRef, target.message);
                const frame = ensureTargetFrame_ACU(target.message, isolationKey);
                const targetIndex = chat.indexOf(target.message);

                if (target.absorbedEarlierFrame && entry.fullCheckpoint && frame.logEntries.length > 0) {
                    logWarn_ACU(`[删楼守卫] 嫁接楼层 #${targetIndex} 携带更早的增量帧；其 logs 已被恢复的 full checkpoint 吸收，清空以保持回放顺序正确。`);
                    frame.logEntries = [];
                }

                if (entry.fullCheckpoint) {
                    if (frame.checkpoint?.kind === 'full') {
                        logDebug_ACU(`[删楼守卫] 楼层 #${targetIndex} 已有 full checkpoint，跳过回放根嫁接。`);
                    } else {
                        frame.checkpoint = deepClone_ACU(entry.fullCheckpoint);
                        graftedCount += 1;
                        logWarn_ACU(`[删楼守卫] 被删楼层携带的回放根（reason=${entry.fullCheckpoint.reason}）已前移嫁接到楼层 #${targetIndex}（isolationKey=[${isolationKey || '无标签'}]）。`);
                    }
                }

                if (entry.summaryVectorCheckpoint?.checkpoint) {
                    if (!frame.summaryVectorIndexFrame || typeof frame.summaryVectorIndexFrame !== 'object') {
                        frame.summaryVectorIndexFrame = {
                            version: 3,
                            sourceTableKey: entry.summaryVectorCheckpoint.sourceTableKey,
                            logEntries: [],
                        };
                    }
                    if (!frame.summaryVectorIndexFrame.checkpoint) {
                        // 整体换新向量帧对象（不原地改字段）：保管库记忆化以对象引用作 head 标识。
                        frame.summaryVectorIndexFrame = {
                            ...frame.summaryVectorIndexFrame,
                            sourceTableKey: entry.summaryVectorCheckpoint.sourceTableKey
                                || frame.summaryVectorIndexFrame.sourceTableKey,
                            checkpoint: deepClone_ACU(entry.summaryVectorCheckpoint.checkpoint),
                        };
                        graftedCount += 1;
                        logWarn_ACU(`[删楼守卫] 被删楼层携带的向量 checkpoint 已前移嫁接到楼层 #${targetIndex}。`);
                    } else {
                        logDebug_ACU(`[删楼守卫] 楼层 #${targetIndex} 已有向量 checkpoint，跳过嫁接。`);
                    }
                }

                if (hasEntries_ACU(entry.perSheetCheckpoints)) {
                    for (const [sheetKey, checkpoint] of Object.entries(entry.perSheetCheckpoints!)) {
                        if (frame.perSheetCheckpoints?.[sheetKey]) {
                            logDebug_ACU(`[删楼守卫] 楼层 #${targetIndex} 已有 ${sheetKey} 的 per-sheet checkpoint（幸存者优先），跳过嫁接。`);
                            continue;
                        }
                        const cloned = deepClone_ACU(checkpoint);
                        if (cloned.timeline) {
                            cloned.timeline = { ...cloned.timeline, activateAtMessageIndex: targetIndex, afterSeq: 0 };
                        }
                        // 整体换新锚容器（不原地增删 key）：保管库记忆化以对象引用作 head 标识。
                        frame.perSheetCheckpoints = { ...(frame.perSheetCheckpoints || {}), [sheetKey]: cloned };
                        graftedCount += 1;
                        logWarn_ACU(`[删楼守卫] 被删楼层携带的 ${sheetKey} per-sheet checkpoint（timeline=${checkpoint.timeline?.kind || 'legacy'}）已前移嫁接到楼层 #${targetIndex}。`);
                    }
                }

                if (entry.spv79TransitionCheckpoint || entry.compatTransitionCheckpoint) {
                    // 过渡根的 cutoff/data 必须在删楼后的幸存历史上重算，不能深拷贝旧值。
                    transitionTargets.set(isolationKey, target.message);
                }
                affectedIsolationKeys.add(isolationKey);
            }

            const rebuiltTransitions = new Map<string, RebuiltTransition_ACU>();
            for (const [isolationKey, targetMessage] of transitionTargets) {
                const rebuilt = await rebuildDeletedTransition_ACU(survivingChat, isolationKey, targetMessage);
                rebuiltTransitions.set(isolationKey, rebuilt);
                const isolatedData = targetMessage.TavernDB_ACU_IsolatedData;
                const tagData = isolatedData[isolationKey];
                delete tagData.spv79TransitionCheckpoint;
                delete tagData.compatTransitionCheckpoint;
                tagData.compatTransitionCheckpoint = rebuilt.checkpoint;
                graftedCount += 1;
                logWarn_ACU(`[删楼守卫] isolationKey=[${isolationKey || '无标签'}] 的过渡根已按幸存历史重建并校验 cutoff。`);
            }

            for (const [isolationKey, rebuilt] of rebuiltTransitions) {
                const tagData = rebuilt.targetMessage.TavernDB_ACU_IsolatedData[isolationKey];
                const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, isolationKey, {
                    updateRuntimeState: false,
                    compatibilityMode: 'disabled',
                });
                if (!replay || getTableDataFingerprint_ACU(replay.data) !== getTableDataFingerprint_ACU(tagData.compatTransitionCheckpoint.data)) {
                    throw new Error(`[删楼守卫] isolationKey=[${isolationKey || '无标签'}] 的重建过渡根严格回放校验失败，拒绝保存。`);
                }
            }

            const presentMessagesForMaterial = new Set<any>(chat);
            // 「无处嫁接」必须与「目标楼已有产物」区分开：前者是真丢基线（聊天里没有可承载的 AI 楼层），
            // 后者是正常 no-op。此前这条分支完全静默，而调用方 chat-mutation-scheduler 丢弃返回值
            // ⇒ 真丢数据时用户与日志都看不到。
            let skippedNoTargetCount = 0;
            for (let lostIndex = vault_ACU!.materialEntries.length - 1; lostIndex >= 0; lostIndex -= 1) {
                const material = vault_ACU!.materialEntries[lostIndex];
                if (presentMessagesForMaterial.has(material.messageRef)) continue;
                if (!material.continuation) continue;
                const preferred = graftTargetByLostMessage.get(material.messageRef);
                // 续写基线只能落在可见 AI 楼（graftContinuationCheckpoint_ACU 有同款门）：表格侧的靶楼
                // 兜底只排除用户楼，可能给出工具楼/隐藏楼，直接复用会白嫁接一次并把资料留在会消失的楼上。
                let targetMessage = preferred && isAiFloor_ACU(preferred) ? preferred : undefined;
                if (!targetMessage) {
                    for (let index = lostIndex + 1; index < vault_ACU!.materialEntries.length; index += 1) {
                        const candidate = vault_ACU!.materialEntries[index];
                        if (presentMessagesForMaterial.has(candidate.messageRef) && isAiFloor_ACU(candidate.messageRef)) {
                            targetMessage = candidate.messageRef;
                            break;
                        }
                    }
                }
                if (!targetMessage) {
                    for (let index = chat.length - 1; index >= 0; index -= 1) {
                        if (isAiFloor_ACU(chat[index])) {
                            targetMessage = chat[index];
                            break;
                        }
                    }
                }
                if (!targetMessage) {
                    skippedNoTargetCount += 1;
                    continue;
                }
                if (graftMaterialContinuationCheckpoint_ACU(targetMessage, material.continuation)) graftedCount += 1;
            }

            if (graftedCount === 0) {
                // 全部被"目标已有"跳过或无处嫁接：无写入即无需保存。
                if (skippedNoTargetCount > 0) {
                    // 措辞必须诚实：本分支不重建保管库，但删楼流程随后任何一次经本插件的保存都会触发
                    // post-save 重建（按现存楼层采集），被删楼层的 materialEntries 随之消失 ⇒ 通常没有「下次机会」。
                    logWarn_ACU(`[删楼守卫] ${skippedNoTargetCount} 份续写基线无处嫁接（聊天里没有可承载基线的 AI 楼层），本次已丢弃；若随后发生任何一次聊天保存，保管库会按现存楼层重建，该基线不再可恢复。`);
                }
                return { recovered: false, graftedCount: 0 };
            }

            for (const isolationKey of affectedIsolationKeys) {
                const violation = assertSingleActiveFullCheckpointV2_ACU(chat, isolationKey, 'delete_recovery');
                if (violation) throw new Error(violation);
            }
            const continuationViolation = assertMaterialContinuationCheckpoint_ACU(chat);
            if (continuationViolation) throw new Error(continuationViolation);

            await saveChatToHostStrict_ACU();
            captureCheckpointVaultForCurrentChat_ACU(chat);
            logWarn_ACU(`[删楼守卫] 删楼 checkpoint 前移恢复完成：共嫁接 ${graftedCount} 个产物${skippedNoTargetCount > 0 ? `；另有 ${skippedNoTargetCount} 份续写基线因聊天里没有可承载的 AI 楼层而被丢弃` : ''}。`);
            return { recovered: true, graftedCount };
        } catch (error: any) {
            restoreSnapshots();
            restoreMaterialCheckpointFields_ACU(chat, materialSnapshots);
            const message = error?.message || String(error || '删楼 checkpoint 恢复失败。');
            logError_ACU(`[删楼守卫] 删楼 checkpoint 前移恢复失败，已回滚改动（保管库保留，下次删楼事件重试）：${message}`);
            return { recovered: false, graftedCount: 0, error: message };
        }
    });
}

/** 仅供测试：读取当前保管库形态。 */
export function __getCheckpointVaultForTests_ACU(): { chatKey: string; isolationKeys: string[]; entryCounts: Record<string, number> } | null {
    if (!vault_ACU) return null;
    const entryCounts: Record<string, number> = {};
    for (const [key, entries] of vault_ACU.entriesByIsolationKey) entryCounts[key] = entries.length;
    return { chatKey: vault_ACU.chatKey, isolationKeys: [...vault_ACU.entriesByIsolationKey.keys()], entryCounts };
}

/** 仅供测试：重置安装状态。 */
export function __resetCheckpointDeleteGuardForTests_ACU(): void {
    vault_ACU = null;
    installed_ACU = false;
    resetVaultArtifactMemo_ACU();
}
