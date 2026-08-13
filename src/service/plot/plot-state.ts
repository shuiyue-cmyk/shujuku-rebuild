/**
 * service/plot/plot-state.ts — 剧情推进运行时状态 + 纯逻辑函数
 *
 * 从 presentation/components/plot-editors.ts 搬入。
 * 这些状态变量和函数不涉及 DOM 操作。
 */

import { DEFAULT_PLOT_PROMPT_GROUP_ACU, DEFAULT_PLOT_SETTINGS_ACU } from '../../shared/defaults-json.js';
import { saveSettings_ACU } from '../settings/settings-service';

// ═══ 状态变量 ═══

export let activePlotEditorSettings_ACU: any = null;
export let currentPlotTaskEditorId_ACU = '';
export let currentEditablePlotPresetState_ACU = {
  initialized: false,
  presetName: '',
  scope: 'resolved',
  source: '',
};

// ═══ setter 函数 ═══

export function _set_activePlotEditorSettings_ACU(v: any) { activePlotEditorSettings_ACU = v; }
export function _set_currentPlotTaskEditorId_ACU(v: any) { currentPlotTaskEditorId_ACU = v; }
export function _set_currentEditablePlotPresetState_ACU(v: any) { currentEditablePlotPresetState_ACU = v; }

// ═══ 纯逻辑函数 ═══

export function buildDefaultPlotPromptGroup_ACU({ mainAContent = '', mainBContent = '' } = {}) {
    const src = DEFAULT_PLOT_PROMPT_GROUP_ACU;
    const base = Array.isArray(src)
        ? JSON.parse(JSON.stringify(src))
        : (typeof src === 'string' && (src as string).trim() ? [{ role: 'USER', content: src, deletable: false, mainSlot: 'A', isMain: true }] : []);

    const getMainSlot = (seg: any) => {
        if (!seg) return '';
        const slot = String(seg.mainSlot || '').toUpperCase();
        if (slot === 'A' || slot === 'B') return slot;
        if (seg.isMain) return 'A';
        if (seg.isMain2) return 'B';
        return '';
    };

    let aIdx = base.findIndex((s: any) => getMainSlot(s) === 'A');
    let bIdx = base.findIndex((s: any) => getMainSlot(s) === 'B');
    if (aIdx === -1) {
        base.unshift({ role: 'SYSTEM', content: '', deletable: false, mainSlot: 'A', isMain: true });
        aIdx = 0;
    }
    if (bIdx === -1) {
        base.splice(aIdx + 1, 0, { role: 'USER', content: '', deletable: false, mainSlot: 'B', isMain2: true });
        bIdx = aIdx + 1;
    }

    if (mainAContent && base[aIdx]) base[aIdx].content = String(mainAContent);
    if (mainBContent && base[bIdx]) base[bIdx].content = String(mainBContent);
    return base;
}

function getLegacyPlotPromptContent_ACU(plotSettings: any, promptId: string) {
    try {
        const p = plotSettings?.prompts;
        if (!p) return '';
        if (Array.isArray(p)) {
            const item = p.find(x => x && x.id === promptId);
            return item?.content || '';
        }
        if (typeof p === 'object') return p[promptId] || '';
    } catch (e) {}
    return '';
}

export function ensurePlotPromptGroup_ACU(plotSettings: any, { persist = false } = {}) {
    if (!plotSettings) return;
    if (Array.isArray(plotSettings.promptGroup) && plotSettings.promptGroup.length > 0) return;

    const legacyMain = getLegacyPlotPromptContent_ACU(plotSettings, 'mainPrompt') || (DEFAULT_PLOT_SETTINGS_ACU?.prompts?.[0]?.content || '');
    const legacySystem = getLegacyPlotPromptContent_ACU(plotSettings, 'systemPrompt') || (DEFAULT_PLOT_SETTINGS_ACU?.prompts?.[1]?.content || '');

    plotSettings.promptGroup = buildDefaultPlotPromptGroup_ACU({
        mainAContent: legacyMain,
        mainBContent: legacySystem,
    });

    if (persist) {
        try { saveSettings_ACU(); } catch (e) {}
    }
}
