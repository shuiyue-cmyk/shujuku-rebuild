/**
 * shared/host-compat/entry-format.ts — 世界书条目三种格式的双向转换
 *
 * 三种格式：
 * - 旧版扁平格式（LorebookEntry）：酒馆助手旧版 getLorebookEntries 系列 API 使用，
 *   也是本代码库全部消费者约定的格式（见 @types/function/lorebook_entry.d.ts）。
 * - 新版嵌套格式（WorldbookEntry）：酒馆助手新版 getWorldbook 系列 API 使用，
 *   strategy/position/recursion/effect 为嵌套子对象（见 @types/function/worldbook.d.ts）。
 * - SillyTavern 原生格式：loadWorldInfo/saveWorldInfo 的 entries 字典条目，
 *   使用数字枚举 position/selectiveLogic/role（见 SillyTavern world-info.js）。
 *
 * 转换原则：读取方向输出完整的旧版扁平条目（未知字段给默认值）；
 * 写入方向仅映射 patch 中实际存在的字段，不注入未指定的默认值。
 */

// ═══ 旧版扁平格式类型（与 @types/function/lorebook_entry.d.ts 对齐） ═══

export type OldFlatPosition_ACU =
    | 'before_character_definition'
    | 'after_character_definition'
    | 'before_example_messages'
    | 'after_example_messages'
    | 'before_author_note'
    | 'after_author_note'
    | 'at_depth_as_system'
    | 'at_depth_as_assistant'
    | 'at_depth_as_user';

export type OldFlatLogic_ACU = 'and_any' | 'and_all' | 'not_all' | 'not_any';

export interface OldFlatLorebookEntry_ACU {
    uid: number;
    display_index: number;
    comment: string;
    enabled: boolean;
    type: 'constant' | 'selective' | 'vectorized';
    position: OldFlatPosition_ACU;
    depth: number | null;
    order: number;
    probability: number;
    keys: string[];
    logic: OldFlatLogic_ACU;
    filters: string[];
    scan_depth: 'same_as_global' | number;
    case_sensitive: 'same_as_global' | boolean;
    match_whole_words: 'same_as_global' | boolean;
    use_group_scoring: 'same_as_global' | boolean;
    automation_id: string | null;
    exclude_recursion: boolean;
    prevent_recursion: boolean;
    delay_until_recursion: boolean | number;
    content: string;
    group: string;
    group_prioritized: boolean;
    group_weight: number;
    sticky: number | null;
    cooldown: number | null;
    delay: number | null;
}

// ═══ 映射常量表 ═══

/** 新版嵌套 position.type（非 at_depth 部分）与旧版扁平 position 同名直映 */
const NEW_POSITION_PASSTHROUGH_ACU = new Set([
    'before_character_definition',
    'after_character_definition',
    'before_example_messages',
    'after_example_messages',
    'before_author_note',
    'after_author_note',
]);

/** ST 原生 position 数字 → 旧版扁平 position 字符串（at_depth 需再结合 role） */
const NATIVE_POSITION_TO_OLD_ACU: Record<number, OldFlatPosition_ACU> = {
    0: 'before_character_definition',
    1: 'after_character_definition',
    2: 'before_author_note',
    3: 'after_author_note',
    // 4 = atDepth，需结合 role 处理
    5: 'before_example_messages',
    6: 'after_example_messages',
};

const OLD_POSITION_TO_NATIVE_ACU: Record<string, number> = {
    before_character_definition: 0,
    after_character_definition: 1,
    before_author_note: 2,
    after_author_note: 3,
    before_example_messages: 5,
    after_example_messages: 6,
    at_depth_as_system: 4,
    at_depth_as_user: 4,
    at_depth_as_assistant: 4,
};

/** ST 原生 role 数字（extension_prompt_roles: SYSTEM=0, USER=1, ASSISTANT=2） */
const NATIVE_ROLE_TO_NAME_ACU: Record<number, 'system' | 'user' | 'assistant'> = {
    0: 'system',
    1: 'user',
    2: 'assistant',
};

const ROLE_NAME_TO_NATIVE_ACU: Record<string, number> = {
    system: 0,
    user: 1,
    assistant: 2,
};

/** ST 原生 selectiveLogic 数字（world_info_logic: AND_ANY=0, NOT_ALL=1, NOT_ANY=2, AND_ALL=3） */
const NATIVE_LOGIC_TO_OLD_ACU: Record<number, OldFlatLogic_ACU> = {
    0: 'and_any',
    1: 'not_all',
    2: 'not_any',
    3: 'and_all',
};

const OLD_LOGIC_TO_NATIVE_ACU: Record<string, number> = {
    and_any: 0,
    not_all: 1,
    not_any: 2,
    and_all: 3,
};

// ═══ 工具函数 ═══

/** 新版 API 的 keys 可能含 RegExp 对象；旧格式与 ST 原生均要求字符串（/…/flags 形式即 ST 的正则字符串约定） */
function stringifyKeys_ACU(keys: unknown): string[] {
    if (!Array.isArray(keys)) return [];
    return keys.map(k => (k instanceof RegExp ? String(k) : String(k ?? '')));
}

function numberOrNull_ACU(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** ST 原生 null → 旧版 'same_as_global' */
function nativeOptionalToOld_ACU<T>(value: T | null | undefined): 'same_as_global' | T {
    return value === null || value === undefined ? 'same_as_global' : value;
}

/** 旧版 'same_as_global' → ST 原生 null */
function oldOptionalToNative_ACU<T>(value: 'same_as_global' | T): T | null {
    return value === 'same_as_global' ? null : value;
}

// ═══ 新版嵌套 ↔ 旧版扁平 ═══

/**
 * 新版嵌套 WorldbookEntry → 旧版扁平 LorebookEntry。
 * 输出完整旧格式：新格式没有的字段（case_sensitive/group 等）给旧版语义默认值。
 * @param entry 新版嵌套条目
 * @param index 条目在书内的序号，用作 display_index（新格式无此字段）
 */
export function newToOldEntry_ACU(entry: any, index: number): OldFlatLorebookEntry_ACU {
    const strategy = entry?.strategy ?? {};
    const position = entry?.position ?? {};
    const recursion = entry?.recursion ?? {};
    const effect = entry?.effect ?? {};
    const keysSecondary = strategy?.keys_secondary ?? {};

    let oldPosition: OldFlatPosition_ACU;
    let oldDepth: number | null;
    if (position?.type === 'at_depth') {
        const role = typeof position.role === 'string' && position.role in ROLE_NAME_TO_NATIVE_ACU ? position.role : 'system';
        oldPosition = `at_depth_as_${role}` as OldFlatPosition_ACU;
        oldDepth = numberOrNull_ACU(position.depth);
    } else {
        oldPosition = NEW_POSITION_PASSTHROUGH_ACU.has(position?.type)
            ? position.type
            : 'before_character_definition';
        oldDepth = null;
    }

    const delayUntil = recursion?.delay_until;

    return {
        uid: Number(entry?.uid ?? 0),
        display_index: index,
        comment: typeof entry?.name === 'string' ? entry.name : '',
        enabled: entry?.enabled !== false,
        type: strategy?.type === 'constant' || strategy?.type === 'vectorized' ? strategy.type : 'selective',
        position: oldPosition,
        depth: oldDepth,
        order: typeof position?.order === 'number' ? position.order : 100,
        probability: typeof entry?.probability === 'number' ? entry.probability : 100,
        keys: stringifyKeys_ACU(strategy?.keys),
        logic: typeof keysSecondary?.logic === 'string' && keysSecondary.logic in OLD_LOGIC_TO_NATIVE_ACU
            ? keysSecondary.logic
            : 'and_any',
        filters: stringifyKeys_ACU(keysSecondary?.keys),
        scan_depth: typeof strategy?.scan_depth === 'number' ? strategy.scan_depth : 'same_as_global',
        case_sensitive: 'same_as_global',
        match_whole_words: 'same_as_global',
        use_group_scoring: 'same_as_global',
        automation_id: null,
        exclude_recursion: recursion?.prevent_incoming === true,
        prevent_recursion: recursion?.prevent_outgoing === true,
        delay_until_recursion: typeof delayUntil === 'number' ? delayUntil : false,
        content: typeof entry?.content === 'string' ? entry.content : '',
        group: '',
        group_prioritized: false,
        group_weight: 100,
        sticky: numberOrNull_ACU(effect?.sticky),
        cooldown: numberOrNull_ACU(effect?.cooldown),
        delay: numberOrNull_ACU(effect?.delay),
    };
}

/**
 * 旧版扁平 partial → 新版嵌套 partial（PartialDeep<WorldbookEntry>）。
 * 仅映射 patch 中实际存在的字段；新格式无对应物的字段
 * （display_index/case_sensitive/match_whole_words/use_group_scoring/automation_id/group*）静默丢弃。
 */
export function oldPatchToNewPatch_ACU(patch: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    const strategy: Record<string, any> = {};
    const position: Record<string, any> = {};
    const recursion: Record<string, any> = {};
    const effect: Record<string, any> = {};

    if ('uid' in patch) out.uid = patch.uid;
    if ('comment' in patch) out.name = patch.comment;
    if ('enabled' in patch) out.enabled = patch.enabled;
    if ('content' in patch) out.content = patch.content;
    if ('probability' in patch) out.probability = patch.probability;

    if ('type' in patch) strategy.type = patch.type;
    if ('keys' in patch) strategy.keys = patch.keys;
    if ('scan_depth' in patch) strategy.scan_depth = patch.scan_depth;
    if ('logic' in patch || 'filters' in patch) {
        const keysSecondary: Record<string, any> = {};
        if ('logic' in patch) keysSecondary.logic = patch.logic;
        if ('filters' in patch) keysSecondary.keys = patch.filters;
        strategy.keys_secondary = keysSecondary;
    }

    if ('position' in patch && typeof patch.position === 'string') {
        if (patch.position.startsWith('at_depth_as_')) {
            position.type = 'at_depth';
            position.role = patch.position.slice('at_depth_as_'.length);
        } else {
            position.type = patch.position;
        }
    }
    if ('depth' in patch && patch.depth !== null && patch.depth !== undefined) position.depth = patch.depth;
    if ('order' in patch) position.order = patch.order;

    if ('exclude_recursion' in patch) recursion.prevent_incoming = patch.exclude_recursion;
    if ('prevent_recursion' in patch) recursion.prevent_outgoing = patch.prevent_recursion;
    if ('delay_until_recursion' in patch) {
        const v = patch.delay_until_recursion;
        recursion.delay_until = v === false ? null : v === true ? 1 : v;
    }

    if ('sticky' in patch) effect.sticky = patch.sticky;
    if ('cooldown' in patch) effect.cooldown = patch.cooldown;
    if ('delay' in patch) effect.delay = patch.delay;

    if (Object.keys(strategy).length > 0) out.strategy = strategy;
    if (Object.keys(position).length > 0) out.position = position;
    if (Object.keys(recursion).length > 0) out.recursion = recursion;
    if (Object.keys(effect).length > 0) out.effect = effect;
    return out;
}

// ═══ ST 原生 ↔ 旧版扁平 ═══

/**
 * ST 原生 world info 条目 → 旧版扁平 LorebookEntry。
 */
export function nativeToOldEntry_ACU(entry: any): OldFlatLorebookEntry_ACU {
    const nativePosition = typeof entry?.position === 'number' ? entry.position : 0;
    let oldPosition: OldFlatPosition_ACU;
    let oldDepth: number | null;
    if (nativePosition === 4) {
        const roleName = NATIVE_ROLE_TO_NAME_ACU[Number(entry?.role ?? 0)] ?? 'system';
        oldPosition = `at_depth_as_${roleName}` as OldFlatPosition_ACU;
        oldDepth = numberOrNull_ACU(entry?.depth);
    } else {
        oldPosition = NATIVE_POSITION_TO_OLD_ACU[nativePosition] ?? 'before_character_definition';
        oldDepth = null;
    }

    const delayUntil = entry?.delayUntilRecursion;

    return {
        uid: Number(entry?.uid ?? 0),
        display_index: typeof entry?.displayIndex === 'number' ? entry.displayIndex : Number(entry?.uid ?? 0),
        comment: typeof entry?.comment === 'string' ? entry.comment : '',
        enabled: entry?.disable !== true,
        type: entry?.constant === true ? 'constant' : entry?.vectorized === true ? 'vectorized' : 'selective',
        position: oldPosition,
        depth: oldDepth,
        order: typeof entry?.order === 'number' ? entry.order : 100,
        probability: typeof entry?.probability === 'number' ? entry.probability : 100,
        keys: stringifyKeys_ACU(entry?.key),
        logic: NATIVE_LOGIC_TO_OLD_ACU[Number(entry?.selectiveLogic ?? 0)] ?? 'and_any',
        filters: stringifyKeys_ACU(entry?.keysecondary),
        scan_depth: nativeOptionalToOld_ACU<number>(entry?.scanDepth),
        case_sensitive: nativeOptionalToOld_ACU<boolean>(entry?.caseSensitive),
        match_whole_words: nativeOptionalToOld_ACU<boolean>(entry?.matchWholeWords),
        use_group_scoring: nativeOptionalToOld_ACU<boolean>(entry?.useGroupScoring),
        automation_id: entry?.automationId ? String(entry.automationId) : null,
        exclude_recursion: entry?.excludeRecursion === true,
        prevent_recursion: entry?.preventRecursion === true,
        delay_until_recursion: typeof delayUntil === 'number' && delayUntil > 0 ? delayUntil : false,
        content: typeof entry?.content === 'string' ? entry.content : '',
        group: typeof entry?.group === 'string' ? entry.group : '',
        group_prioritized: entry?.groupOverride === true,
        group_weight: typeof entry?.groupWeight === 'number' ? entry.groupWeight : 100,
        sticky: numberOrNull_ACU(entry?.sticky),
        cooldown: numberOrNull_ACU(entry?.cooldown),
        delay: numberOrNull_ACU(entry?.delay),
    };
}

/**
 * 旧版扁平 partial → ST 原生条目字段 patch。
 * 仅映射 patch 中实际存在的字段。
 */
export function oldPatchToNativePatch_ACU(patch: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};

    if ('comment' in patch) out.comment = patch.comment;
    if ('enabled' in patch) out.disable = patch.enabled === false;
    if ('content' in patch) out.content = patch.content;
    if ('probability' in patch) out.probability = patch.probability;
    if ('keys' in patch) out.key = stringifyKeys_ACU(patch.keys);
    if ('filters' in patch) out.keysecondary = stringifyKeys_ACU(patch.filters);
    if ('logic' in patch && patch.logic in OLD_LOGIC_TO_NATIVE_ACU) out.selectiveLogic = OLD_LOGIC_TO_NATIVE_ACU[patch.logic];
    if ('order' in patch) out.order = patch.order;
    if ('group' in patch) out.group = patch.group;
    if ('group_prioritized' in patch) out.groupOverride = patch.group_prioritized;
    if ('group_weight' in patch) out.groupWeight = patch.group_weight;
    if ('automation_id' in patch) out.automationId = patch.automation_id ?? '';
    if ('exclude_recursion' in patch) out.excludeRecursion = patch.exclude_recursion;
    if ('prevent_recursion' in patch) out.preventRecursion = patch.prevent_recursion;
    if ('delay_until_recursion' in patch) {
        const v = patch.delay_until_recursion;
        out.delayUntilRecursion = v === false ? 0 : v === true ? 1 : v;
    }
    if ('scan_depth' in patch) out.scanDepth = oldOptionalToNative_ACU(patch.scan_depth);
    if ('case_sensitive' in patch) out.caseSensitive = oldOptionalToNative_ACU(patch.case_sensitive);
    if ('match_whole_words' in patch) out.matchWholeWords = oldOptionalToNative_ACU(patch.match_whole_words);
    if ('use_group_scoring' in patch) out.useGroupScoring = oldOptionalToNative_ACU(patch.use_group_scoring);
    if ('sticky' in patch) out.sticky = patch.sticky;
    if ('cooldown' in patch) out.cooldown = patch.cooldown;
    if ('delay' in patch) out.delay = patch.delay;
    if ('display_index' in patch) out.displayIndex = patch.display_index;

    if ('type' in patch) {
        out.constant = patch.type === 'constant';
        out.vectorized = patch.type === 'vectorized';
        out.selective = patch.type === 'selective';
    }

    if ('position' in patch && typeof patch.position === 'string' && patch.position in OLD_POSITION_TO_NATIVE_ACU) {
        out.position = OLD_POSITION_TO_NATIVE_ACU[patch.position];
        if (patch.position.startsWith('at_depth_as_')) {
            out.role = ROLE_NAME_TO_NATIVE_ACU[patch.position.slice('at_depth_as_'.length)] ?? 0;
        }
    }
    if ('depth' in patch && patch.depth !== null && patch.depth !== undefined) out.depth = patch.depth;

    return out;
}

/**
 * ST 原生新条目默认值（与 SillyTavern world-info.js newWorldInfoEntryTemplate 对齐）。
 * 用于原生后端 createLorebookEntries 时补全未指定字段。
 */
export function buildNativeEntryDefaults_ACU(): Record<string, any> {
    return {
        key: [],
        keysecondary: [],
        comment: '',
        content: '',
        constant: false,
        vectorized: false,
        selective: true,
        selectiveLogic: 0,
        addMemo: true,
        order: 100,
        position: 0,
        disable: false,
        excludeRecursion: false,
        preventRecursion: false,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        delayUntilRecursion: 0,
        probability: 100,
        useProbability: true,
        depth: 4,
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: '',
        role: 0,
        sticky: null,
        cooldown: null,
        delay: null,
    };
}
