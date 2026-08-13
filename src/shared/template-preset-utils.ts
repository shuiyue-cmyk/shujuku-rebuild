// ═══════════════════════════════════════════════════════════════
// shared/template-preset-utils.ts — 模板预设纯工具函数 & 常量
// 从 data/repositories/template-preset-repo.ts 搬入（纯函数/常量部分）
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU = '__ACU_DEFAULT_TEMPLATE_PRESET__';

export function normalizeTemplatePresetSelectionValue_ACU(presetName: any): string {
    const normalizedName = String(presetName ?? '').trim();
    return normalizedName === DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU ? '' : normalizedName;
}

export function isDefaultTemplatePresetSelection_ACU(presetName: any): boolean {
    return normalizeTemplatePresetSelectionValue_ACU(presetName) === '';
}

export function getCurrentTemplatePresetName_ACU(settings_ACU: any, { requireExisting = false, getTemplatePresetFn = null as any } = {}): string {
    const presetName = normalizeTemplatePresetSelectionValue_ACU(settings_ACU?.currentTemplatePresetName || '');
    if (!presetName) return '';
    if (!requireExisting) return presetName;
    if (typeof getTemplatePresetFn === 'function') {
        return getTemplatePresetFn(presetName)?.templateStr ? presetName : '';
    }
    return presetName;
}

export function derivePresetNameFromFilename_ACU(filename: any): string {
    const raw = String(filename || '').trim();
    if (!raw) return '';
    const idx = raw.lastIndexOf('.');
    const base = (idx > 0 ? raw.slice(0, idx) : raw).trim();
    return base;
}

/**
 * 获取当前角色卡名称（依赖宿主 API）
 * 注意：此函数读取 window 全局状态，放在 shared 层是因为它不执行任何持久化操作
 */
export function getCurrentCharacterCardName_ACU(): string {
    try {
        const stContext = (window as any).SillyTavern?.getContext?.();
        // 使用 shared/host-api 的引用——但为了避免循环依赖，直接从 window 读
        let character = null;
        const TavernHelper_API = (window as any).TavernHelper;
        const SillyTavern_API = (window as any).SillyTavern?.getContext?.();
        if (TavernHelper_API?.getCharData) {
            character = TavernHelper_API.getCharData('current');
        }
        if (!character) {
            character = SillyTavern_API?.characters?.[SillyTavern_API?.characterId]
                || stContext?.characters?.[stContext?.characterId]
                || (typeof (window as any).characters !== 'undefined' && typeof (window as any).this_chid !== 'undefined' ? (window as any).characters[(window as any).this_chid] : null);
        }
        return String(
            character?.name
            || character?.data?.name
            || stContext?.name2
            || SillyTavern_API?.name2
            || ''
        ).trim();
    } catch (e) {
        return '';
    }
}

export function deriveTemplatePresetNameForImport_ACU({ presetName = '', filename = '', fallbackLabel = '', allowCharacterFallback = true } = {}): string {
    const explicitName = normalizeTemplatePresetSelectionValue_ACU(presetName);
    if (explicitName) return explicitName;

    const filenameDerivedName = normalizeTemplatePresetSelectionValue_ACU(derivePresetNameFromFilename_ACU(filename));
    if (filenameDerivedName) return filenameDerivedName;

    if (allowCharacterFallback) {
        const characterDerivedName = normalizeTemplatePresetSelectionValue_ACU(getCurrentCharacterCardName_ACU());
        if (characterDerivedName) return characterDerivedName;
    }

    return normalizeTemplatePresetSelectionValue_ACU(fallbackLabel);
}

export function sanitizeFilenameComponent_ACU(name: any): string {
    const s = String(name || '').trim();
    const out = s.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
    return out.length > 80 ? out.slice(0, 80).trim() : out;
}
