import {
    createTemplateAssistantSessionGuard_ACU,
    runTemplateAssistantSession_ACU,
    TemplateAssistantSessionStoppedError_ACU,
    type TemplateAssistantSessionGuardController_ACU,
    type TemplateAssistantSessionProgress_ACU,
    type TemplateAssistantSessionResult_ACU,
    type TemplateAssistantSessionRound_ACU,
} from '../../service/template-assistant/service';
import { settings_ACU } from '../../service/runtime/state-manager';
import { escapeHtml_ACU } from '../../shared/html-helpers';
import { topLevelWindow_ACU } from '../../shared/env';
import { jQuery_API_ACU } from '../dom-utils';
import { showToastr_ACU } from '../theme/toast';
import { applyTemplateAssistantDraftToVisualizer_ACU } from './visualizer-template-assistant-apply';
import { _acuVisState } from './visualizer';

type ChatTurnUser = {
    type: 'user';
    id: string;
    content: string;
    timestamp: number;
};

type ChatTurnAssistantPreview = {
    type: 'assistant';
    phase: 'round';
    id: string;
    roundData: TemplateAssistantSessionRound_ACU;
    maxRounds: number;
    riskConfirmations: Record<string, boolean>;
    expandedSections: Record<string, boolean>;
    timestamp: number;
};

type ChatTurnAssistantFinal = {
    type: 'assistant';
    phase: 'final';
    id: string;
    result: TemplateAssistantSessionResult_ACU;
    riskConfirmations: Record<string, boolean>;
    expandedSections: Record<string, boolean>;
    timestamp: number;
};

type ChatTurnAssistant = ChatTurnAssistantPreview | ChatTurnAssistantFinal;

type ChatTurnError = {
    type: 'error';
    id: string;
    errorMessage: string;
    timestamp: number;
};

type ChatTurn = ChatTurnUser | ChatTurnAssistant | ChatTurnError;

type AssistantUiState = {
    isOpen: boolean;
    isMinimized: boolean;
    userRequest: string;
    isGenerating: boolean;
    transcript: ChatTurn[];
    pendingScrollTop: number;
    pendingScrollMode: 'preserve' | 'stick-bottom';
    tableApiPreset: string;
    guardController: TemplateAssistantSessionGuardController_ACU | null;
    runningSessionId: number;
};

const assistantUiState_ACU: AssistantUiState = {
    isOpen: false,
    isMinimized: false,
    userRequest: '',
    isGenerating: false,
    transcript: [],
    pendingScrollTop: 0,
    pendingScrollMode: 'preserve',
    tableApiPreset: '',
    guardController: null,
    runningSessionId: 0,
};

function generateTurnId_ACU() {
    return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const NEAR_BOTTOM_THRESHOLD_ACU = 50;

const MOBILE_VIEWPORT_MAX_ACU = 899;
const COMPACT_VIEWPORT_MAX_ACU = 1279;

type AssistantViewportMode_ACU = 'desktop' | 'fullscreen-overlay';

function getAssistantViewportWidth_ACU() {
    // 使用顶层窗口的宽度，而非 iframe 的宽度
    // 在油猴模式下 globalThis.window 是 iframe，innerWidth 可能很窄
    const topWin = topLevelWindow_ACU as any;
    const width = Number(topWin?.innerWidth);
    if (Number.isFinite(width) && width > 0) return width;
    // 兜底：尝试当前窗口
    const fallback = Number((globalThis as any)?.window?.innerWidth);
    if (Number.isFinite(fallback) && fallback > 0) return fallback;
    return 1440;
}

function getAssistantViewportMode_ACU(): AssistantViewportMode_ACU {
    const width = getAssistantViewportWidth_ACU();
    if (width <= COMPACT_VIEWPORT_MAX_ACU) return 'fullscreen-overlay';
    return 'desktop';
}

function isAssistantMobileViewport_ACU() {
    return getAssistantViewportWidth_ACU() <= MOBILE_VIEWPORT_MAX_ACU;
}

function getAssistantPanelWidth_ACU(mode: AssistantViewportMode_ACU) {
    if (mode === 'fullscreen-overlay') return '100vw';
    return '420px';
}

/**
 * Portal 模式：将 #acu-vis-assistant-host 从 #acu-visualizer-content 移到 document.body，
 * 以绕过 .acu-window 的 overflow:hidden + animation(transform) 创建的 containing block，
 * 使 position:fixed 能正确相对于视口定位。
 *
 * 移出后在宿主元素上注入 --vis-* CSS 变量，保持样式与编辑器一致。
 */
const ASSISTANT_HOST_ID_ACU = 'acu-vis-assistant-host';
const VISUALIZER_ROOT_SELECTOR_ACU = '#acu-visualizer-content';
const VISUALIZER_ASSISTANT_DOCK_SELECTOR_ACU = '#acu-vis-assistant-dock';

/** --vis-* CSS 变量声明，与 visualizer-styles.ts 中 #acu-visualizer-content 的定义保持同步 */
const VIS_PORTAL_VARIABLES_ACU = [
    '--vis-bg-color:var(--acu-viz-bg, var(--acu-bg-0))',
    '--vis-border-color:var(--acu-viz-border, var(--acu-border))',
    '--vis-text-main:var(--acu-viz-text, var(--acu-text-1))',
    '--vis-text-dim:var(--acu-viz-text-dim, var(--acu-text-2))',
    '--vis-text-mute:var(--acu-viz-text-mute, var(--acu-text-3))',
    '--vis-accent:var(--acu-viz-accent, var(--acu-accent))',
    '--vis-accent-dim:var(--acu-viz-accent-dim, var(--acu-accent-2))',
    '--vis-accent-glow:var(--acu-viz-accent-glow, var(--acu-accent-glow))',
    '--vis-bg-hover:var(--acu-viz-hover, var(--acu-bg-2))',
    '--vis-bg-stats:var(--acu-viz-sidebar-bg, var(--acu-bg-1))',
    '--vis-bg-light:var(--acu-viz-card-bg, var(--acu-bg-1))',
    '--vis-font-serif:"Noto Serif SC", "Source Han Serif CN", "Songti SC", "STSong", "SimSun", serif',
].join(';');

function getPortalDocument_ACU(): Document | null {
    return topLevelWindow_ACU?.document ?? (typeof document !== 'undefined' ? document : null);
}

/**
 * 管理宿主元素的 portal 状态。
 * - fullscreen-overlay + open → 移到 body，注入 CSS 变量
 * - 其他情况 → 移回 #acu-vis-assistant-dock，清除变量
 */
function ensureAssistantHostPortal_ACU(mode: AssistantViewportMode_ACU, isOpen: boolean): void {
    const doc = getPortalDocument_ACU();
    if (!doc) return;

    const host = doc.getElementById(ASSISTANT_HOST_ID_ACU);
    if (!host) return;

    const shouldPortal = mode === 'fullscreen-overlay' && isOpen;
    const isInBody = host.parentElement === doc.body;
    const dock = doc.querySelector(VISUALIZER_ASSISTANT_DOCK_SELECTOR_ACU);

    if (shouldPortal) {
        host.style.pointerEvents = 'auto';
        if (!isInBody) {
            host.style.cssText += `;${VIS_PORTAL_VARIABLES_ACU}`;
            doc.body.appendChild(host);
        }
        return;
    }

    if (dock && host.parentElement !== dock) {
        dock.appendChild(host);
    } else if (!dock && isInBody) {
        host.remove();
    }
    clearPortalVariables_ACU(host);
    host.style.pointerEvents = isOpen ? 'auto' : 'none';
}

/** 从宿主元素的 inline style 中移除 portal 注入的 CSS 变量 */
function clearPortalVariables_ACU(host: HTMLElement): void {
    const style = host.getAttribute('style') || '';
    const cleaned = style.split(';').filter((s: string) => {
        const prop = s.trim().startsWith('--vis-');
        return !prop;
    }).join(';');
    host.setAttribute('style', cleaned);
}

function buildAssistantPanelStyle_ACU(mode: AssistantViewportMode_ACU, display: string) {
    const isMobileViewport = isAssistantMobileViewport_ACU();
    const common = `display:${display}; flex-direction:column; min-height:0; background:var(--vis-assistant-window-bg, var(--vis-bg-color, #111827)); color:var(--vis-text-main, #f3f4f6); box-shadow:0 20px 48px color-mix(in srgb, var(--vis-text-main, #f3f4f6) 18%, transparent); pointer-events:auto; overscroll-behavior:contain; opacity:1;`;
    if (mode === 'fullscreen-overlay') {
        const mobileOverflow = isMobileViewport ? 'overflow-y:auto; overflow-x:hidden;' : 'overflow:hidden;';
        return `${common} ${mobileOverflow} position:fixed; inset:0; width:100vw; min-height:100vh; height:100dvh; border-left:none; z-index:100002; background:var(--vis-assistant-window-bg, var(--vis-bg-color, #111827)); padding:env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px); -webkit-overflow-scrolling:touch;`;
    }
    return `${common} overflow-y:auto; overflow-x:hidden; width:${getAssistantPanelWidth_ACU(mode)}; min-height:100%; height:auto; align-self:stretch; border-left:1px solid var(--vis-border-color); flex:1 1 auto;`;
}

function buildAssistantHeaderStyle_ACU(mode: AssistantViewportMode_ACU) {
    const compactPadding = mode === 'fullscreen-overlay' ? '12px 12px 10px' : '12px 14px';
    const sticky = mode === 'fullscreen-overlay' ? 'position:sticky; top:0; z-index:2; background:var(--vis-assistant-window-bg, var(--vis-bg-color));' : '';
    return `padding:${compactPadding}; border-bottom:1px solid var(--vis-border-color); display:flex; justify-content:space-between; align-items:center; gap:10px; ${sticky}`;
}

function buildAssistantScrollFrameStyle_ACU(mode: AssistantViewportMode_ACU) {
    const isMobileViewport = isAssistantMobileViewport_ACU();
    const isDesktopInternalScroll = mode !== 'fullscreen-overlay';
    const isFullscreenInternalScroll = mode === 'fullscreen-overlay' && !isMobileViewport;
    const margin = mode === 'fullscreen-overlay' ? '8px 12px 8px' : '12px 14px 8px';
    const minHeight = mode === 'fullscreen-overlay' ? '180px' : '240px';
    const flexValue = isDesktopInternalScroll || isFullscreenInternalScroll ? '1 1 auto' : '0 0 auto';
    const desktopMaxHeight = 'max-height:min(56vh, 640px);';
    const overflow = isFullscreenInternalScroll ? 'overflow:hidden;' : 'overflow:visible;';
    const extra = mode === 'fullscreen-overlay'
        ? (isMobileViewport ? 'max-height:none;' : '')
        : desktopMaxHeight;
    return `flex:${flexValue}; min-height:${minHeight}; margin:${margin}; border:1px solid var(--vis-border-color); border-radius:12px; background:var(--vis-assistant-surface-bg, var(--vis-bg-light, rgba(255,255,255,0.08))); ${overflow} display:flex; flex-direction:column; pointer-events:auto; overscroll-behavior:contain; ${extra}`;
}

function buildAssistantChatContainerStyle_ACU(mode: AssistantViewportMode_ACU) {
    const isMobileViewport = isAssistantMobileViewport_ACU();
    const padding = mode === 'fullscreen-overlay' ? '12px' : '16px';
    const usesInternalChatScroll = mode !== 'fullscreen-overlay' || !isMobileViewport;
    const overflow = usesInternalChatScroll
        ? 'overflow-y:auto; min-height:0; height:100%;'
        : 'overflow-y:visible; min-height:auto; height:auto;';
    return `flex:1 1 auto; ${overflow} overscroll-behavior:contain; -webkit-overflow-scrolling:touch; touch-action:pan-y; pointer-events:auto; padding:${padding}; display:flex; flex-direction:column; gap:12px; align-items:stretch; background:transparent; justify-content:flex-start;`;
}

function buildAssistantFooterStyle_ACU(mode: AssistantViewportMode_ACU) {
    const padding = mode === 'fullscreen-overlay' ? '12px 12px calc(12px + env(safe-area-inset-bottom, 0px))' : '12px 14px 14px';
    return `padding:${padding}; border-top:1px solid var(--vis-border-color); flex:0 0 auto;`;
}

function shouldShowFloatingRestore_ACU(_mode: AssistantViewportMode_ACU) {
    return false;
}

function isPanelVisible_ACU(mode: AssistantViewportMode_ACU) {
    if (!assistantUiState_ACU.isOpen) return false;
    if (mode !== 'fullscreen-overlay') return true;
    return true;
}

function buildAssistantControlRowStyle_ACU(mode: AssistantViewportMode_ACU) {
    if (mode === 'fullscreen-overlay') {
        return 'display:flex; flex-direction:column; align-items:stretch; gap:6px; margin-bottom:8px;';
    }
    return 'display:flex; align-items:center; gap:8px; margin-bottom:8px;';
}

function buildAssistantActionRowStyle_ACU(mode: AssistantViewportMode_ACU) {
    if (mode === 'fullscreen-overlay') {
        return 'display:flex; flex-direction:column; gap:8px; margin-top:8px;';
    }
    return 'display:flex; gap:8px; margin-top:8px;';
}

function buildAssistantBubbleStyle_ACU(role: 'user' | 'assistant' | 'error', mode: AssistantViewportMode_ACU) {
    const maxWidth = mode === 'fullscreen-overlay' ? '100%' : '82%';
    const minWidth = mode === 'fullscreen-overlay' ? '0' : role === 'assistant' ? '240px' : role === 'error' ? '220px' : '180px';
    const base = `max-width:${maxWidth}; width:fit-content; min-width:${minWidth}; padding:${mode === 'fullscreen-overlay' ? '10px 12px' : '12px 14px'}; box-shadow:0 10px 24px color-mix(in srgb, var(--vis-text-main) 12%, transparent); color:var(--vis-text-main); word-break:break-word; overflow-wrap:anywhere;`;
    if (role === 'assistant') {
        return `${base} border-radius:16px 16px 16px 4px; background:var(--vis-assistant-bubble-bg, var(--vis-bg-light)); border:1px solid var(--vis-border-color);`;
    }
    if (role === 'error') {
        return `${base} border-radius:16px 16px 16px 4px; background:color-mix(in srgb, var(--acu-danger, #c55) 12%, var(--vis-bg-light)); border:1px solid color-mix(in srgb, var(--acu-danger, #c55) 36%, var(--vis-border-color));`;
    }
    return `${base} border-radius:16px 16px 4px 16px; background:color-mix(in srgb, var(--vis-accent) 12%, var(--vis-bg-light)); border:1px solid color-mix(in srgb, var(--vis-accent) 38%, var(--vis-border-color));`;
}

function isNearBottom_ACU(container: HTMLElement | null | undefined): boolean {
    if (!container) return true;
    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;
    const scrollHeight = container.scrollHeight;
    return scrollTop + clientHeight >= scrollHeight - NEAR_BOTTOM_THRESHOLD_ACU;
}

function getChatContainerElement_ACU() {
    const $container = getHost_ACU().find('.acu-chat-container');
    return $container.length ? ($container[0] as HTMLElement) : null;
}

function getMaxScrollTop_ACU(container: HTMLElement | null | undefined) {
    if (!container) return 0;
    return Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0));
}

function captureScrollState_ACU(mode: 'append' | 'preserve') {
    const container = getChatContainerElement_ACU();
    const currentScrollTop = container?.scrollTop ?? 0;
    const maxScrollTop = getMaxScrollTop_ACU(container);
    assistantUiState_ACU.pendingScrollMode = mode === 'append' && isNearBottom_ACU(container)
        ? 'stick-bottom'
        : 'preserve';
    assistantUiState_ACU.pendingScrollTop = assistantUiState_ACU.pendingScrollMode === 'stick-bottom'
        ? maxScrollTop
        : currentScrollTop;
}

function restoreScrollState_ACU(container: HTMLElement | null | undefined) {
    if (!container) return;
    if (assistantUiState_ACU.pendingScrollMode === 'stick-bottom') {
        container.scrollTop = getMaxScrollTop_ACU(container);
        return;
    }
    container.scrollTop = assistantUiState_ACU.pendingScrollTop;
}

function clearAssistantDraftState_ACU() {
    assistantUiState_ACU.transcript = [];
}

function resolveEffectiveTableApiPreset_ACU() {
    const currentSheetKey = _acuVisState.currentSheetKey || null;
    const currentSheet = currentSheetKey ? _acuVisState.tempData?.[currentSheetKey] : null;
    const currentTableName = String(currentSheet?.name || '').trim();
    if (currentTableName) {
        const overrides = settings_ACU.tableApiPresetOverridesByName;
        if (overrides && typeof overrides === 'object' && typeof overrides[currentTableName] === 'string' && overrides[currentTableName].trim()) {
            return overrides[currentTableName].trim();
        }
    }
    return String(settings_ACU.tableApiPreset || '').trim();
}

function syncAssistantTableApiPreset_ACU() {
    assistantUiState_ACU.tableApiPreset = resolveEffectiveTableApiPreset_ACU();
}

function buildAssistantTableApiPresetOptionsHtml_ACU() {
    const apiPresets = Array.isArray(settings_ACU.apiPresets) ? settings_ACU.apiPresets : [];
    const currentValue = String(assistantUiState_ACU.tableApiPreset || '').trim();
    const presetOptions = apiPresets
        .map((preset: any) => {
            const name = String(preset?.name || '').trim();
            if (!name) return '';
            return `<option value="${escapeHtml_ACU(name)}" ${currentValue === name ? 'selected' : ''}>${escapeHtml_ACU(name)}</option>`;
        })
        .filter(Boolean)
        .join('');
    return `<option value="" ${!currentValue ? 'selected' : ''}>当前配置</option>${presetOptions}`;
}

function createNewGuardController_ACU() {
    assistantUiState_ACU.guardController = createTemplateAssistantSessionGuard_ACU();
    // 初始化 AbortController，使 createRunGuard 产出的 runGuard.signal 可中断 AI 请求
    assistantUiState_ACU.guardController.getSignal();
    assistantUiState_ACU.runningSessionId += 1;
}

function invalidateActiveSession_ACU() {
    if (assistantUiState_ACU.guardController) {
        assistantUiState_ACU.guardController.invalidate();
    }
    if (assistantUiState_ACU.isGenerating) {
        assistantUiState_ACU.isGenerating = false;
        showToastr_ACU('warning', '会话已失效（结构变化或切表）');
    }
}

function cancelActiveSession_ACU() {
    if (assistantUiState_ACU.guardController) {
        assistantUiState_ACU.guardController.cancel();
    }
    if (assistantUiState_ACU.isGenerating) {
        assistantUiState_ACU.isGenerating = false;
        showToastr_ACU('warning', '模板助手会话已取消');
        renderVisualizerTemplateAssistantPanel_ACU();
    }
}

function isFinalAssistantTurn_ACU(turn: ChatTurnAssistant): turn is ChatTurnAssistantFinal {
    return turn.phase === 'final';
}

function getAssistantDraft_ACU(turn: ChatTurnAssistant) {
    return isFinalAssistantTurn_ACU(turn) ? turn.result.draft : turn.roundData.draft;
}

function getAssistantCompileResult_ACU(turn: ChatTurnAssistant) {
    return isFinalAssistantTurn_ACU(turn) ? turn.result.compileResult : turn.roundData.perRoundCompileResult;
}

function getAssistantAiRawText_ACU(turn: ChatTurnAssistant) {
    return isFinalAssistantTurn_ACU(turn) ? turn.result.aiRawText : turn.roundData.aiRawText;
}

function buildAssistantRoundProgressLabel_ACU(turn: ChatTurnAssistant) {
    if (isFinalAssistantTurn_ACU(turn)) {
        return buildSessionMetaSummary_ACU(turn.result);
    }
    // 改表助手一问一答：单轮结果即最终结果，round turn 不再显示轮次进度。
    return 'AI 助手';
}

function buildPriorTurnsFromTranscript_ACU(transcript: ChatTurn[]): Array<{ user: string; assistant?: string }> {
    const priorTurns: Array<{ user: string; assistant?: string }> = [];
    for (let i = 0; i < transcript.length; i++) {
        const turn = transcript[i];
        if (turn.type === 'user') {
            const userContent = String(turn.content || '').trim();
            if (!userContent) continue;
            // 查找紧跟的 assistant turn（可能不存在或中间有 error turn）
            let assistantText: string | undefined = undefined;
            for (let j = i + 1; j < transcript.length; j++) {
                const nextTurn = transcript[j];
                if (nextTurn.type === 'user') {
                    // 遇到下一个 user turn，说明当前 user 没有对应的 assistant
                    break;
                }
                if (nextTurn.type === 'assistant' && isFinalAssistantTurn_ACU(nextTurn)) {
                    assistantText = String(getAssistantAiRawText_ACU(nextTurn) || '').trim();
                }
                // error turn 跳过，继续查找可能的 assistant
            }
            priorTurns.push({
                user: userContent,
                assistant: assistantText || undefined,
            });
        }
    }
    return priorTurns;
}

function getRiskConfirmationKey_ACU(index: number) {
    return String(index);
}

function isHighRiskItemAutoConfirmed_ACU(item: TemplateAssistantDiff_ACU extends never ? never : ReturnType<typeof getAssistantCompileResult_ACU>['highRiskItems'][number]) {
    return item?.type === 'patch_sheet_schema';
}

function isHighRiskItemConfirmed_ACU(turn: ChatTurnAssistant, index: number) {
    const item = getAssistantCompileResult_ACU(turn).highRiskItems[index];
    if (!item) return true;
    if (isHighRiskItemAutoConfirmed_ACU(item)) {
        return turn.riskConfirmations[getRiskConfirmationKey_ACU(index)] !== false;
    }
    return !!turn.riskConfirmations[getRiskConfirmationKey_ACU(index)];
}

function getHost_ACU() {
    return jQuery_API_ACU('#acu-vis-assistant-host');
}

function getHostElement_ACU(): HTMLElement | null {
    const doc = topLevelWindow_ACU?.document ?? (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    return doc.querySelector('#acu-vis-assistant-host') as HTMLElement | null;
}

function readDataAttrFromElement_ACU(node: unknown, name: string) {
    if (!node || typeof node !== 'object' || !('getAttribute' in (node as any))) return '';
    return String((node as any).getAttribute(`data-${name}`) || '');
}

function getApplyButtonElement_ACU() {
    const doc = topLevelWindow_ACU?.document ?? (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    return doc.querySelector('#acu-vis-assistant-apply') as HTMLButtonElement | null;
}

function getSelectedSheetLabel_ACU() {
    const sheetKey = _acuVisState.currentSheetKey;
    const sheet = sheetKey ? _acuVisState.tempData?.[sheetKey] : null;
    if (!sheetKey || !sheet) return '当前未选中表';
    return `${sheet.name || sheetKey} (${sheetKey})`;
}

type TemplateAssistantDiff_ACU = TemplateAssistantSessionResult_ACU['compileResult']['diff'];

function buildSessionStopReasonLabel_ACU(result: TemplateAssistantSessionResult_ACU) {
    const stopReason = String(result.session?.stopReason || '');
    switch (stopReason) {
        case 'empty_operations':
            return '空操作停止';
        case 'repair_retry_capped':
            return '修复重试已达上限';
        case 'environment_failure':
            return 'SQLite 引擎不可用';
        default:
            return '';
    }
}

function buildSessionMetaSummary_ACU(result: TemplateAssistantSessionResult_ACU) {
    if (!result.session) return '';
    const stopReasonLabel = buildSessionStopReasonLabel_ACU(result);
    const repairPart = result.session.repairRetriesUsed > 0 ? ` · 修复 ${result.session.repairRetriesUsed} 次` : '';
    return `${stopReasonLabel}${repairPart}`;
}

function countDiffChanges_ACU(diff: TemplateAssistantDiff_ACU): number {
    let count = 0;
    count += diff.addedSheets.length;
    count += diff.deletedSheets.length;
    count += diff.renamedSheets.length;
    count += diff.movedSheets.length;
    count += diff.patchedSourceDataSheets.length;
    count += diff.patchedUpdateConfigSheets.length;
    count += diff.patchedExportConfigSheets.length;
    count += (diff.patchedContentSheets || []).length;
    count += (diff.patchedSchemaSheets || []).length;
    count += (diff.patchedLockSheets || []).length;
    if (diff.globalInjectionChanged) count += 1;
    return count;
}

function buildDiffSummary_ACU(diff: TemplateAssistantDiff_ACU): string {
    const parts: string[] = [];
    if (diff.addedSheets.length) parts.push(`新增${diff.addedSheets.length}表`);
    if (diff.deletedSheets.length) parts.push(`删除${diff.deletedSheets.length}表`);
    if (diff.renamedSheets.length) parts.push(`重命名${diff.renamedSheets.length}表`);
    if (diff.movedSheets.length) parts.push(`移动${diff.movedSheets.length}表`);
    const patchCount = diff.patchedSourceDataSheets.length + diff.patchedUpdateConfigSheets.length + diff.patchedExportConfigSheets.length + (diff.patchedContentSheets || []).length + (diff.patchedSchemaSheets || []).length + (diff.patchedLockSheets || []).length;
    if (patchCount) parts.push(`修改${patchCount}处`);
    if (diff.globalInjectionChanged) parts.push('全局配置变更');
    return parts.length ? parts.join('、') : '无变更';
}

function buildDiffHtml_ACU(diff: TemplateAssistantDiff_ACU) {
    const sections: string[] = [];
    const renderList = (items: string[]) => items.length ? `<ul>${items.map((item) => `<li>${escapeHtml_ACU(item)}</li>`).join('')}</ul>` : '<div class="acu-hint">无</div>';

    sections.push(`<div class="acu-assistant-diff-block"><strong>新增表</strong>${renderList(diff.addedSheets.map((item) => `${item.name} [${item.sheetKey}]`))}</div>`);
    sections.push(`<div class="acu-assistant-diff-block"><strong>删除表</strong>${renderList(diff.deletedSheets.map((item) => `${item.name} [${item.sheetKey}]`))}</div>`);
    sections.push(`<div class="acu-assistant-diff-block"><strong>重命名</strong>${renderList(diff.renamedSheets.map((item) => `${item.beforeName} -> ${item.afterName}`))}</div>`);
    sections.push(`<div class="acu-assistant-diff-block"><strong>顺序变化</strong>${renderList(diff.movedSheets.map((item) => `${item.name}: ${item.fromIndex} -> ${item.toIndex}`))}</div>`);
    sections.push(`<div class="acu-assistant-diff-block"><strong>sourceData patch</strong>${renderList(diff.patchedSourceDataSheets.map((item) => `${item.name}: ${item.keys.join(', ') || '字段已修改'}`))}</div>`);
    sections.push(`<div class="acu-assistant-diff-block"><strong>updateConfig patch</strong>${renderList(diff.patchedUpdateConfigSheets.map((item) => `${item.name}: ${item.keys.join(', ') || '字段已修改'}`))}</div>`);
    sections.push(`<div class="acu-assistant-diff-block"><strong>exportConfig patch</strong>${renderList(diff.patchedExportConfigSheets.map((item) => `${item.name}: ${item.keys.join(', ') || '字段已修改'}`))}</div>`);
    sections.push(`<div class="acu-assistant-diff-block"><strong>content patch</strong>${renderList((diff.patchedContentSheets || []).map((item) => `${item.name}: ${item.changes.join('；') || '内容已修改'}`))}</div>`);
    sections.push(`<div class="acu-assistant-diff-block"><strong>schema patch</strong>${renderList((diff.patchedSchemaSheets || []).map((item) => `${item.name}: ${item.changes.join('；') || '结构已修改'}`))}</div>`);
    sections.push(`<div class="acu-assistant-diff-block"><strong>locks patch</strong>${renderList((diff.patchedLockSheets || []).map((item) => `${item.name}: ${item.changes.join('；') || '锁状态已修改'}`))}</div>`);
    sections.push(`<div class="acu-assistant-diff-block"><strong>全局注入配置</strong>${diff.globalInjectionChanged ? '<div>已修改</div>' : '<div class="acu-hint">未修改</div>'}</div>`);
    return sections.join('');
}

function areHighRiskItemsConfirmed_ACU(turn: ChatTurnAssistant) {
    return getAssistantCompileResult_ACU(turn).highRiskItems.every((_, index) => isHighRiskItemConfirmed_ACU(turn, index));
}

function syncLatestApplyButtonDisabledState_ACU(turn: ChatTurnAssistant) {
    const latestTurn = assistantUiState_ACU.transcript[assistantUiState_ACU.transcript.length - 1];
    if (!latestTurn || latestTurn.type !== 'assistant' || latestTurn.id !== turn.id) return;
    if (!isFinalAssistantTurn_ACU(turn)) return;

    const button = getApplyButtonElement_ACU();
    if (!button) return;

    const applyDisabled = getAssistantCompileResult_ACU(turn).highRiskItems.length > 0 && !areHighRiskItemsConfirmed_ACU(turn);
    button.disabled = applyDisabled;
}

function renderCollapsedSection_ACU(title: string, summary: string, sectionKey: string, expanded: boolean, detailContent: string) {
    const expandIcon = expanded ? '▼' : '▶';
    const detailStyle = expanded ? '' : 'display:none;';
    return `
        <div class="acu-collapsible-section" data-section-key="${escapeHtml_ACU(sectionKey)}">
            <div class="acu-collapsed-summary" data-section-key="${escapeHtml_ACU(sectionKey)}">
                <span class="acu-expand-toggle" data-section-key="${escapeHtml_ACU(sectionKey)}">${expandIcon}</span>
                <span class="acu-summary-title">${escapeHtml_ACU(title)}</span>
                <span class="acu-summary-text">${escapeHtml_ACU(summary)}</span>
            </div>
            <div class="acu-detail-block" data-section-key="${escapeHtml_ACU(sectionKey)}" style="${detailStyle}">
                ${detailContent}
            </div>
        </div>
    `;
}

function buildAssistantDetailSummary_ACU(turn: ChatTurnAssistant): string {
    const draft = getAssistantDraft_ACU(turn);
    const compileResult = getAssistantCompileResult_ACU(turn);
    const parts: string[] = [];
    const warningCount = draft.warnings.length;
    const changeCount = countDiffChanges_ACU(compileResult.diff);
    const riskCount = compileResult.highRiskItems.length;
    const progressSummary = buildAssistantRoundProgressLabel_ACU(turn);
    
    if (warningCount > 0) parts.push(`警告${warningCount}条`);
    if (changeCount > 0) parts.push(`变更${changeCount}处`);
    if (riskCount > 0) parts.push(`高风险${riskCount}项`);
    if (progressSummary) parts.push(progressSummary);
    
    return parts.length > 0 ? parts.join(' · ') : '无变更';
}

function buildAssistantDetailContent_ACU(turn: ChatTurnAssistant): string {
    const draft = getAssistantDraft_ACU(turn);
    const compileResult = getAssistantCompileResult_ACU(turn);
    const sections: string[] = [];
    const progressSummary = buildAssistantRoundProgressLabel_ACU(turn);

    if (progressSummary) {
        sections.push(`<div class="acu-assistant-diff-block"><strong>${isFinalAssistantTurn_ACU(turn) ? '会话信息' : '结果信息'}</strong><div>${escapeHtml_ACU(progressSummary)}${isFinalAssistantTurn_ACU(turn) ? '' : '（中间结果，暂不可应用）'}</div></div>`);
    }
    
    // 警告部分
    const warningsDetail = draft.warnings.length
        ? `<ul>${draft.warnings.map((item) => `<li>${escapeHtml_ACU(item)}</li>`).join('')}</ul>`
        : '<div class="acu-hint">无</div>';
    sections.push(`<div class="acu-assistant-diff-block"><strong>警告</strong>${warningsDetail}</div>`);
    
    // 变更部分
    sections.push(`<div class="acu-assistant-diff-block"><strong>变更详情</strong>${buildDiffHtml_ACU(compileResult.diff)}</div>`);
    
    // 高风险部分
    const riskDetail = compileResult.highRiskItems.length
        ? compileResult.highRiskItems.map((item, index) => {
            const riskKey = getRiskConfirmationKey_ACU(index);
            if (!isFinalAssistantTurn_ACU(turn)) {
                return `<div class="acu-assistant-risk-item"><span>${escapeHtml_ACU(item.label)}</span></div>`;
            }
            return `
                <label class="acu-assistant-risk-item">
                    <input type="checkbox" class="acu-assistant-risk-confirm" data-turn-id="${escapeHtml_ACU(turn.id)}" data-risk-key="${escapeHtml_ACU(riskKey)}" ${isHighRiskItemConfirmed_ACU(turn, index) ? 'checked' : ''}>
                    <span>${escapeHtml_ACU(item.label)}</span>
                </label>
            `;
        }).join('')
        : '<div class="acu-hint">无高风险操作</div>';
    sections.push(`<div class="acu-assistant-diff-block"><strong>高风险确认</strong><div class="acu-assistant-risk-list">${riskDetail}</div></div>`);
    
    return sections.join('');
}

function renderAssistantTurn_ACU(turn: ChatTurnAssistant, isLatest: boolean, mode: AssistantViewportMode_ACU) {
    const draft = getAssistantDraft_ACU(turn);
    const compileResult = getAssistantCompileResult_ACU(turn);
    const detailSummary = buildAssistantDetailSummary_ACU(turn);
    const detailContent = buildAssistantDetailContent_ACU(turn);
    const isExpanded = turn.expandedSections.details || false;

    const applyDisabled = compileResult.highRiskItems.length > 0 && !areHighRiskItemsConfirmed_ACU(turn);
    const applyHtml = isLatest && isFinalAssistantTurn_ACU(turn)
        ? `<button id="acu-vis-assistant-apply" class="acu-btn-primary" data-turn-id="${escapeHtml_ACU(turn.id)}" ${applyDisabled ? 'disabled' : ''}>应用到编辑器</button>`
        : '';
    const turnLabel = 'AI 助手';

    return `
        <div class="acu-chat-turn acu-chat-turn-assistant" data-turn-id="${escapeHtml_ACU(turn.id)}" style="display:flex; justify-content:flex-start;">
            <div class="acu-message-bubble acu-message-bubble-assistant" style="${buildAssistantBubbleStyle_ACU('assistant', mode)}">
                <div class="acu-chat-turn-label" style="font-size:12px; font-weight:600; opacity:0.78; margin-bottom:6px;">${escapeHtml_ACU(turnLabel)}</div>
                <div class="acu-chat-turn-content">
                    <div class="acu-assistant-summary" style="line-height:1.6; white-space:pre-wrap; word-break:break-word;">${escapeHtml_ACU(draft.summary || '（无摘要）')}</div>
                </div>
                ${renderCollapsedSection_ACU('详情', detailSummary, 'details', isExpanded, detailContent)}
                ${applyHtml ? `<div class="acu-assistant-actions-row">${applyHtml}</div>` : ''}
            </div>
        </div>
    `;
}

function renderErrorTurn_ACU(turn: ChatTurnError, mode: AssistantViewportMode_ACU) {
    return `
        <div class="acu-chat-turn acu-chat-turn-error" data-turn-id="${escapeHtml_ACU(turn.id)}" style="display:flex; justify-content:flex-start;">
            <div class="acu-message-bubble acu-message-bubble-error" style="${buildAssistantBubbleStyle_ACU('error', mode)}">
                <div class="acu-chat-turn-label" style="font-size:12px; font-weight:600; color:#ffb2b2; margin-bottom:6px;">执行错误</div>
                <div class="acu-chat-turn-content">
                    <div class="acu-error-message" style="line-height:1.6; white-space:pre-wrap; word-break:break-word;">${escapeHtml_ACU(turn.errorMessage)}</div>
                </div>
            </div>
        </div>
    `;
}

function renderUserTurn_ACU(turn: ChatTurnUser, mode: AssistantViewportMode_ACU) {
    return `
        <div class="acu-chat-turn acu-chat-turn-user" data-turn-id="${escapeHtml_ACU(turn.id)}" style="display:flex; justify-content:flex-end;">
            <div class="acu-message-bubble acu-message-bubble-user" style="${buildAssistantBubbleStyle_ACU('user', mode)}">
                <div class="acu-chat-turn-label" style="font-size:12px; font-weight:600; opacity:0.72; margin-bottom:6px; text-align:right;">你</div>
                <div class="acu-chat-turn-content" style="line-height:1.6; white-space:pre-wrap; word-break:break-word; text-align:left;">
                    ${escapeHtml_ACU(turn.content)}
                </div>
            </div>
        </div>
    `;
}

function renderTranscript_ACU() {
    const transcript = assistantUiState_ACU.transcript;
    const mode = getAssistantViewportMode_ACU();
    if (transcript.length === 0) {
        const emptyStateMinHeight = mode === 'fullscreen-overlay' ? '160px' : '340px';
        const emptyStatePadding = mode === 'fullscreen-overlay' ? '16px' : '28px';
        return `
            <div class="acu-chat-transcript acu-chat-transcript-empty" style="flex:1 1 auto; min-height:0; height:100%; display:flex; flex-direction:column;">
                <div class="acu-chat-empty-state" style="flex:1 1 auto; min-height:max(${emptyStateMinHeight}, 100%); height:100%; align-self:stretch; box-sizing:border-box; display:flex; align-items:center; justify-content:center; text-align:center; padding:${emptyStatePadding}; color:var(--vis-text-mute, #9ca3af); line-height:1.7; border:1px dashed color-mix(in srgb, var(--vis-border-color) 72%, transparent); border-radius:10px; background:color-mix(in srgb, var(--vis-bg-color, #111827) 72%, transparent);">
                    <div>
                        <div style="font-size:15px; font-weight:600; color:var(--vis-text-dim, #d1d5db); margin-bottom:10px;">AI 改表助手已就绪</div>
                        <div style="font-size:12px;">输入修改需求后发送，聊天记录会显示在这里。</div>
                    </div>
                </div>
            </div>
        `;
    }

    const html = transcript.map((turn, index) => {
        const isLatest = index === transcript.length - 1;
        switch (turn.type) {
            case 'user':
                return renderUserTurn_ACU(turn, mode);
            case 'assistant':
                return renderAssistantTurn_ACU(turn, isLatest, mode);
            case 'error':
                return renderErrorTurn_ACU(turn, mode);
            default:
                return '';
        }
    }).join('');

    return `<div class="acu-chat-transcript">${html}</div>`;
}

function bindEvents_ACU() {
    const $host = getHost_ACU();
    if (!$host.length || !assistantUiState_ACU.isOpen) return;

    $host.find('#acu-vis-assistant-input').on('input', function() {
        assistantUiState_ACU.userRequest = String(jQuery_API_ACU(this).val() || '');
        // 更新按钮的disabled状态，避免重新渲染导致焦点丢失
        const generateDisabled = assistantUiState_ACU.isGenerating || !String(assistantUiState_ACU.userRequest || '').trim();
        const $btn = $host.find('#acu-vis-assistant-generate');
        if ($btn.length) {
            $btn.prop('disabled', generateDisabled);
        }
    });

    $host.find('#acu-vis-assistant-api-preset').on('change', function() {
        assistantUiState_ACU.tableApiPreset = String(jQuery_API_ACU(this).val() || '').trim();
    });

    $host.find('#acu-vis-assistant-generate').on('click', async () => {
        const requestSheetKey = _acuVisState.currentSheetKey || null;
        const userRequest = assistantUiState_ACU.userRequest.trim();
        if (!userRequest) return;
        captureScrollState_ACU('append');
        const previewTurnIds: string[] = [];
        const capturedSessionId = assistantUiState_ACU.runningSessionId + 1;

        // 在添加当前用户轮次前构建 priorTurns（不包含当前请求）
        const priorTurns = buildPriorTurnsFromTranscript_ACU(assistantUiState_ACU.transcript);

        // 立即添加用户轮次
        const userTurn: ChatTurnUser = {
            type: 'user',
            id: generateTurnId_ACU(),
            content: userRequest,
            timestamp: Date.now(),
        };
        assistantUiState_ACU.transcript.push(userTurn);
        
        try {
            assistantUiState_ACU.isGenerating = true;
            assistantUiState_ACU.userRequest = '';
            createNewGuardController_ACU();
            renderVisualizerTemplateAssistantPanel_ACU();

            const result = await runTemplateAssistantSession_ACU({
                tempData: JSON.parse(JSON.stringify(_acuVisState.tempData || {})),
                currentSheetKey: requestSheetKey,
                sheetOrder: Array.isArray(_acuVisState.sheetOrder) ? [..._acuVisState.sheetOrder] : null,
                userRequest: userRequest,
                priorTurns: priorTurns,
                tableApiPreset: assistantUiState_ACU.tableApiPreset,
                guard: assistantUiState_ACU.guardController?.createRunGuard() || null,
                onRoundComplete: (progress: TemplateAssistantSessionProgress_ACU) => {
                    if (capturedSessionId !== assistantUiState_ACU.runningSessionId) return;
                    if ((requestSheetKey || null) !== (_acuVisState.currentSheetKey || null)) return;
                    captureScrollState_ACU('append');
                    const previewTurn: ChatTurnAssistant = {
                        type: 'assistant',
                        phase: 'round',
                        id: generateTurnId_ACU(),
                        roundData: progress.round,
                        maxRounds: progress.maxRounds,
                        riskConfirmations: {},
                        expandedSections: {},
                        timestamp: Date.now(),
                    };
                    previewTurnIds.push(previewTurn.id);
                    assistantUiState_ACU.transcript.push(previewTurn);
                    renderVisualizerTemplateAssistantPanel_ACU();
                },
            });

            if (capturedSessionId !== assistantUiState_ACU.runningSessionId) {
                return;
            }
            
            if ((requestSheetKey || null) !== (_acuVisState.currentSheetKey || null)) {
                assistantUiState_ACU.transcript = assistantUiState_ACU.transcript.filter((turn) => turn.id !== userTurn.id && !previewTurnIds.includes(turn.id));
                const errorTurn: ChatTurnError = {
                    type: 'error',
                    id: generateTurnId_ACU(),
                    errorMessage: '当前选中表已变化，请重新生成 assistant 草稿。',
                    timestamp: Date.now(),
                };
                assistantUiState_ACU.transcript.push(errorTurn);
                showToastr_ACU('warning', errorTurn.errorMessage);
                renderVisualizerTemplateAssistantPanel_ACU();
                return;
            }
            
            const finalAssistantTurn: ChatTurnAssistant = {
                type: 'assistant',
                phase: 'final',
                id: previewTurnIds[previewTurnIds.length - 1] || generateTurnId_ACU(),
                result: result,
                riskConfirmations: {},
                expandedSections: {},
                timestamp: Date.now(),
            };
            captureScrollState_ACU('append');
            if (previewTurnIds.length > 0) {
                const latestPreviewId = previewTurnIds[previewTurnIds.length - 1];
                assistantUiState_ACU.transcript = assistantUiState_ACU.transcript.map((turn) => {
                    if (turn.type === 'assistant' && turn.id === latestPreviewId) {
                        return finalAssistantTurn;
                    }
                    return turn;
                });
            } else {
                assistantUiState_ACU.transcript.push(finalAssistantTurn);
            }
        } catch (error: any) {
            if (capturedSessionId !== assistantUiState_ACU.runningSessionId) {
                return;
            }
            if (error instanceof TemplateAssistantSessionStoppedError_ACU) {
                showToastr_ACU('warning', error.message);
                return;
            }
            const errorTurn: ChatTurnError = {
                type: 'error',
                id: generateTurnId_ACU(),
                errorMessage: error?.message || '生成失败',
                timestamp: Date.now(),
            };
            assistantUiState_ACU.transcript.push(errorTurn);
            showToastr_ACU('error', errorTurn.errorMessage);
        } finally {
            assistantUiState_ACU.isGenerating = false;
            renderVisualizerTemplateAssistantPanel_ACU();
        }
    });

    $host.find('.acu-expand-toggle').on('click', function() {
        const sectionKey = String(jQuery_API_ACU(this).data('section-key') || '');
        // 找到对应的assistant turn
        const $section = jQuery_API_ACU(this).closest('.acu-collapsible-section');
        const $turn = jQuery_API_ACU(this).closest('.acu-chat-turn-assistant');
        const turnId = $turn.data('turn-id');
        
        const turn = assistantUiState_ACU.transcript.find(t => t.id === turnId && t.type === 'assistant') as ChatTurnAssistant | undefined;
        if (turn) {
            captureScrollState_ACU('preserve');
            turn.expandedSections[sectionKey] = !turn.expandedSections[sectionKey];
            renderVisualizerTemplateAssistantPanel_ACU();
        }
    });

    $host.find('.acu-assistant-risk-confirm').on('change', function() {
        const riskKey = readDataAttrFromElement_ACU(this, 'risk-key');
        const turnId = readDataAttrFromElement_ACU(this, 'turn-id');
        
        const turn = assistantUiState_ACU.transcript.find(t => t.id === turnId && t.type === 'assistant') as ChatTurnAssistant | undefined;
        if (turn) {
            turn.riskConfirmations[riskKey] = !!((this as HTMLInputElement | null)?.checked);
            syncLatestApplyButtonDisabledState_ACU(turn);
        }
    });

    $host.find('#acu-vis-assistant-apply').on('click', async function() {
        const turnId = readDataAttrFromElement_ACU(this, 'turn-id');
        const turn = assistantUiState_ACU.transcript.find(t => t.id === turnId && t.type === 'assistant') as ChatTurnAssistant | undefined;
        if (!turn || !isFinalAssistantTurn_ACU(turn)) return;
        if (getAssistantCompileResult_ACU(turn).highRiskItems.length > 0 && !areHighRiskItemsConfirmed_ACU(turn)) {
            showToastr_ACU('warning', '请先确认所有高风险项后再应用。');
            return;
        }
        
        const applied = await applyTemplateAssistantDraftToVisualizer_ACU(turn.result);
        if (!applied) return;
        captureScrollState_ACU('preserve');
        renderVisualizerTemplateAssistantPanel_ACU();
    });

    $host.find('#acu-vis-assistant-stop').on('click', () => {
        cancelActiveSession_ACU();
    });
}

export function resetVisualizerTemplateAssistantState_ACU() {
    assistantUiState_ACU.isOpen = false;
    assistantUiState_ACU.isMinimized = false;
    assistantUiState_ACU.userRequest = '';
    assistantUiState_ACU.isGenerating = false;
    assistantUiState_ACU.pendingScrollTop = 0;
    assistantUiState_ACU.pendingScrollMode = 'preserve';
    syncAssistantTableApiPreset_ACU();
    invalidateActiveSession_ACU();
    assistantUiState_ACU.guardController = null;
    clearAssistantDraftState_ACU();
    // ═══ 安全清理 portal：确保宿主从 body 移回或移除 ═══
    ensureAssistantHostPortal_ACU('desktop', false);
    renderVisualizerTemplateAssistantPanel_ACU();
}

export function handleVisualizerTemplateAssistantSheetChange_ACU() {
    captureScrollState_ACU('preserve');
    invalidateActiveSession_ACU();
    syncAssistantTableApiPreset_ACU();
    const currentSheetKey = _acuVisState.currentSheetKey || null;
    // 检查最新的assistant轮次是否是v1且需要清除
    const lastAssistantTurn = [...assistantUiState_ACU.transcript].reverse().find((t): t is ChatTurnAssistantFinal => t.type === 'assistant' && isFinalAssistantTurn_ACU(t));
    
    if (
        lastAssistantTurn
        && lastAssistantTurn.result.draft.protocolVersion === 1
        && lastAssistantTurn.result.draft.selectedSheetKey !== currentSheetKey
    ) {
        clearAssistantDraftState_ACU();
    }
    renderVisualizerTemplateAssistantPanel_ACU();
}

export function invalidateVisualizerTemplateAssistantSession_ACU() {
    invalidateActiveSession_ACU();
    renderVisualizerTemplateAssistantPanel_ACU();
}

export function setVisualizerTemplateAssistantOpen_ACU(nextOpen: boolean) {
    assistantUiState_ACU.isOpen = !!nextOpen;
    assistantUiState_ACU.isMinimized = false;
    renderVisualizerTemplateAssistantPanel_ACU();
}

export function toggleVisualizerTemplateAssistant_ACU() {
    assistantUiState_ACU.isOpen = !assistantUiState_ACU.isOpen;
    assistantUiState_ACU.isMinimized = false;
    renderVisualizerTemplateAssistantPanel_ACU();
}

export function renderVisualizerTemplateAssistantPanel_ACU() {
    const $host = getHost_ACU();
    if (!$host.length) return;

    const mode = getAssistantViewportMode_ACU();
    // ═══ Portal：fullscreen-overlay 模式下仅在面板实际可见时将宿主移到 body，绕过窗口 containing block ═══
    ensureAssistantHostPortal_ACU(mode, isPanelVisible_ACU(mode) || shouldShowFloatingRestore_ACU(mode));

    const display = isPanelVisible_ACU(mode) ? 'flex' : 'none';
    const showFloatingRestore = shouldShowFloatingRestore_ACU(mode);
    const generateDisabled = assistantUiState_ACU.isGenerating || !String(assistantUiState_ACU.userRequest || '').trim();
    const stopDisabled = !assistantUiState_ACU.isGenerating;

    const hostElement = getHostElement_ACU();
    if (hostElement) {
        hostElement.setAttribute('data-assistant-mode', mode);
        hostElement.setAttribute('data-open', assistantUiState_ACU.isOpen ? 'true' : 'false');
        hostElement.setAttribute('data-minimized', showFloatingRestore ? 'true' : 'false');
        hostElement.style.pointerEvents = isPanelVisible_ACU(mode) || showFloatingRestore ? 'auto' : 'none';
        hostElement.style.opacity = isPanelVisible_ACU(mode) || showFloatingRestore ? '1' : '0';
    }
    const layoutDoc = topLevelWindow_ACU?.document ?? (typeof document !== 'undefined' ? document : null);
    const layoutRoot = layoutDoc?.querySelector(VISUALIZER_ROOT_SELECTOR_ACU) as HTMLElement | null;
    if (layoutRoot) {
        if (mode === 'fullscreen-overlay' && isPanelVisible_ACU(mode)) {
            layoutRoot.setAttribute('data-assistant-layout', 'fullscreen-overlay');
        } else if (mode === 'desktop' && assistantUiState_ACU.isOpen) {
            layoutRoot.setAttribute('data-assistant-layout', 'desktop-dock');
        } else {
            layoutRoot.setAttribute('data-assistant-layout', 'default');
        }
    }

    $host.html(`
        ${showFloatingRestore ? `
            <button id="acu-vis-assistant-restore" class="acu-btn-primary acu-vis-assistant-floating-restore" type="button">
                <i class="fa-solid fa-wand-magic-sparkles"></i>
                <span>恢复 AI 改表助手</span>
            </button>
        ` : ''}
        <div class="acu-vis-assistant-panel" data-assistant-mode="${escapeHtml_ACU(mode)}" style="${buildAssistantPanelStyle_ACU(mode, display)}">
            <div class="acu-vis-assistant-header" style="${buildAssistantHeaderStyle_ACU(mode)}">
                <div>
                    <div style="font-weight:600;">AI 改表助手</div>
                    <div class="acu-hint" style="font-size:12px; margin-top:4px;">当前表：${escapeHtml_ACU(getSelectedSheetLabel_ACU())}</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                    <button id="acu-vis-assistant-close" class="acu-btn-secondary" type="button">关闭</button>
                </div>
            </div>
            <div class="acu-chat-scroll-frame" style="${buildAssistantScrollFrameStyle_ACU(mode)}">
                <div class="acu-chat-container" style="${buildAssistantChatContainerStyle_ACU(mode)}">
                    ${renderTranscript_ACU()}
                </div>
            </div>
            <div class="acu-vis-assistant-footer" style="${buildAssistantFooterStyle_ACU(mode)}">
                <div class="acu-assistant-control-row acu-assistant-api-preset-row" style="${buildAssistantControlRowStyle_ACU(mode)}">
                    <label for="acu-vis-assistant-api-preset" style="font-size:12px; opacity:0.78; white-space:nowrap;">API预设</label>
                    <select id="acu-vis-assistant-api-preset" class="acu-form-input" style="flex:1; min-width:0; ${mode === 'fullscreen-overlay' ? 'width:100%;' : ''}">
                        ${buildAssistantTableApiPresetOptionsHtml_ACU()}
                    </select>
                </div>
                <textarea id="acu-vis-assistant-input" class="acu-form-textarea" style="min-height:${mode === 'fullscreen-overlay' ? '96px' : '80px'};" placeholder="例如：新增一张战利品表，并关闭旧表独立导出。">${escapeHtml_ACU(assistantUiState_ACU.userRequest)}</textarea>
                <div class="acu-assistant-action-row" style="${buildAssistantActionRowStyle_ACU(mode)}">
                    <button id="acu-vis-assistant-generate" class="acu-btn-primary" style="flex:1; ${mode === 'fullscreen-overlay' ? 'width:100%;' : ''}" ${generateDisabled ? 'disabled' : ''}>${assistantUiState_ACU.isGenerating ? '生成中...' : '发送'}</button>
                    <button id="acu-vis-assistant-stop" class="acu-btn-secondary" style="${mode === 'fullscreen-overlay' ? 'width:100%;' : 'width:88px;'}" ${stopDisabled ? 'disabled' : ''}>停止</button>
                </div>
            </div>
        </div>
    `);

    if (hostElement) {
        hostElement.setAttribute('data-assistant-mode', mode);
        hostElement.setAttribute('data-open', assistantUiState_ACU.isOpen ? 'true' : 'false');
        hostElement.setAttribute('data-minimized', showFloatingRestore ? 'true' : 'false');
        hostElement.style.pointerEvents = isPanelVisible_ACU(mode) || showFloatingRestore ? 'auto' : 'none';
        hostElement.style.opacity = isPanelVisible_ACU(mode) || showFloatingRestore ? '1' : '0';
    }

    restoreScrollState_ACU(getChatContainerElement_ACU());

    $host.find('#acu-vis-assistant-close').on('click', () => {
        assistantUiState_ACU.isOpen = false;
        assistantUiState_ACU.isMinimized = false;
        renderVisualizerTemplateAssistantPanel_ACU();
    });

    bindEvents_ACU();
}
