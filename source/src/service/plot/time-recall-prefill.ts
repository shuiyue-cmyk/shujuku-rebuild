/**
 * service/plot/time-recall-prefill.ts — 时间召回预设旧 assistant 尾段 → user 预填充。
 *
 * 上游 9bb5b242 同功能本仓适配：我方预设 schema 为 prompts[] + 顶层 promptGroup
 *（无 plotTasks），指纹基准为本仓当前 DEFAULT_TIME_RECALL_PLOT_PRESET_ACU。
 * 只有整组与默认逐字一致的 pristine 默认才升级（尾段允许旧 assistant 尾或已升级的
 * user 预填充），用户改写过的一律保留。已是目标形态返回 null，保证加载迁移幂等。
 */
import { DEFAULT_TIME_RECALL_PLOT_PRESET_ACU } from '../../shared/defaults-json.js';
import { USER_PREFILL_CONTENT_ACU } from '../../shared/user-prefill.js';

const LEGACY_TIME_RECALL_TAIL_ACU = '收到，天之音开始执行！';

function isLegacyTail_ACU(tail: any): boolean {
    return String(tail?.role || '').toLowerCase() === 'assistant'
        && (tail.content === LEGACY_TIME_RECALL_TAIL_ACU || tail.content === USER_PREFILL_CONTENT_ACU)
        && !tail.mainSlot && !tail.isMain && !tail.isMain2;
}

function isUpgradedTail_ACU(tail: any): boolean {
    return String(tail?.role || '').toLowerCase() === 'user' && tail.content === USER_PREFILL_CONTENT_ACU;
}

/** 比较消息身份与完整正文；开关及其他用户段元数据不作为默认指纹。 */
function matchesGroup_ACU(group: unknown, reference: unknown): boolean {
    if (!Array.isArray(group) || !Array.isArray(reference) || group.length < 2 || group.length !== reference.length) return false;
    return group.every((segment, index) => index === group.length - 1
        ? isLegacyTail_ACU(segment) && (isLegacyTail_ACU(reference[index])
            || (reference[index]?.role === 'user' && reference[index]?.content === USER_PREFILL_CONTENT_ACU))
        : segment?.content === reference[index]?.content
            && String(segment?.role || '').toLowerCase() === String(reference[index]?.role || '').toLowerCase());
}

function matchesDefaultGroup_ACU(group: unknown): boolean {
    const current = DEFAULT_TIME_RECALL_PLOT_PRESET_ACU as any;
    // 迁移对象只有顶层 promptGroup（prompts[] 尾段是 system 最终指令，无旧 assistant 尾）。
    return matchesGroup_ACU(group, current.promptGroup);
}

function isTimeRecallPreset_ACU(source: Record<string, any>): boolean {
    if (!source || typeof source !== 'object') return false;
    if ((source as any)._acuBuiltinPresetId) return (source as any)._acuBuiltinPresetId === 'time-recall';
    return (source as any).name === '时间召回' && matchesDefaultGroup_ACU((source as any).promptGroup);
}

/** 仅升级仍匹配旧内置尾段的配置，保留其余提示词、开关和段元数据。 */
export function upgradeTimeRecallPrefill_ACU(holder: Record<string, any> | null): Record<string, any> | null {
    if (!holder || typeof holder !== 'object' || Array.isArray(holder)) return null;
    const presets = Array.isArray((holder as any).promptPresets) ? (holder as any).promptPresets : [];
    const activePreset = presets.find((preset: any) => preset?.name === (holder as any).lastUsedPresetName);
    const builtin = (holder as any)._acuBuiltinPresetId === 'time-recall';
    const legacyPreset = !(holder as any)._acuBuiltinPresetId && isTimeRecallPreset_ACU(holder);
    const activeTimeRecall = !(holder as any).name && !(holder as any)._acuBuiltinPresetId
        && activePreset && isTimeRecallPreset_ACU(activePreset);
    // 迁移对象只有顶层 promptGroup（prompts[] 尾段是 system 最终指令，无旧 assistant 尾）。
    const rootCandidate = builtin
        || (legacyPreset && matchesDefaultGroup_ACU((holder as any).promptGroup))
        || (activeTimeRecall && matchesGroup_ACU((holder as any).promptGroup, activePreset.promptGroup));
    let changed = false;
    const upgradeGroup = (group: unknown): unknown => {
        if (!Array.isArray(group) || group.length === 0) return group;
        const tail = group[group.length - 1];
        // 已是目标形态：幂等直返，避免每次加载脏写（上游无此短路）。
        if (isUpgradedTail_ACU(tail)) return group;
        if (!isLegacyTail_ACU(tail)) return group;
        changed = true;
        return [...group.slice(0, -1), { ...tail, role: 'user', content: USER_PREFILL_CONTENT_ACU }];
    };
    const next: Record<string, any> = { ...holder };
    if (rootCandidate) {
        // 非时间召回 holder 只有指纹命中才动；builtin 直接升级 promptGroup。
        const shouldTouch = builtin || matchesDefaultGroup_ACU((holder as any).promptGroup)
            || (activeTimeRecall && matchesGroup_ACU((holder as any).promptGroup, activePreset.promptGroup));
        if (shouldTouch) {
            const group = upgradeGroup((holder as any).promptGroup);
            if (group !== (holder as any).promptGroup) next.promptGroup = group;
        }
    }
    const promptPresets = Array.isArray((holder as any).promptPresets) ? (holder as any).promptPresets.map((preset: any) => {
        const upgraded = upgradeTimeRecallPrefill_ACU(preset);
        if (!upgraded) return preset;
        changed = true;
        return upgraded;
    }) : (holder as any).promptPresets;
    if (promptPresets !== (holder as any).promptPresets) next.promptPresets = promptPresets;
    return changed ? next : null;
}
