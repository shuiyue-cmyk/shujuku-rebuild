type SummaryVectorIndexRealignDirtyReason_ACU =
    | 'chat_modified_deleted'
    | 'chat_modified_swiped'
    | 'self_heal_identity_mismatch'
    | 'runtime_stale_rows'
    | string;

export interface SummaryVectorIndexRealignDirtyState_ACU {
    dirty: boolean;
    reason: SummaryVectorIndexRealignDirtyReason_ACU;
    markedAt: string;
}

const summaryVectorIndexRealignDirtyStates_ACU = new Map<string, SummaryVectorIndexRealignDirtyState_ACU>();

function normalizeScopeKey_ACU(scopeKey: string): string {
    return String(scopeKey || '').trim();
}

export function markSummaryVectorIndexDirtyForRealign_ACU(
    scopeKey: string,
    reason: SummaryVectorIndexRealignDirtyReason_ACU,
): SummaryVectorIndexRealignDirtyState_ACU {
    const normalizedScopeKey = normalizeScopeKey_ACU(scopeKey);
    if (!normalizedScopeKey) throw new Error('交火向量索引 realign dirty 缺少 scopeKey。');
    const state: SummaryVectorIndexRealignDirtyState_ACU = {
        dirty: true,
        reason: String(reason || 'runtime_stale_rows'),
        markedAt: new Date().toISOString(),
    };
    summaryVectorIndexRealignDirtyStates_ACU.set(normalizedScopeKey, state);
    return { ...state };
}

export function clearSummaryVectorIndexDirtyForRealign_ACU(scopeKey: string): void {
    summaryVectorIndexRealignDirtyStates_ACU.delete(normalizeScopeKey_ACU(scopeKey));
}

export function isSummaryVectorIndexDirtyForRealign_ACU(scopeKey: string): boolean {
    return summaryVectorIndexRealignDirtyStates_ACU.get(normalizeScopeKey_ACU(scopeKey))?.dirty === true;
}

export function getSummaryVectorIndexDirtyForRealign_ACU(scopeKey: string): SummaryVectorIndexRealignDirtyState_ACU | null {
    const state = summaryVectorIndexRealignDirtyStates_ACU.get(normalizeScopeKey_ACU(scopeKey));
    return state ? { ...state } : null;
}
