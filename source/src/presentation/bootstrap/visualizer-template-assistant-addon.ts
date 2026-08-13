import { topLevelWindow_ACU } from '../../shared/env';
import { _acuVisState } from '../pages/visualizer';
import {
    handleVisualizerTemplateAssistantSheetChange_ACU,
    invalidateVisualizerTemplateAssistantSession_ACU,
    renderVisualizerTemplateAssistantPanel_ACU,
    resetVisualizerTemplateAssistantState_ACU,
    toggleVisualizerTemplateAssistant_ACU,
} from '../pages/visualizer-template-assistant';

const VISUALIZER_ROOT_SELECTOR_ACU = '#acu-visualizer-content';
const VISUALIZER_ACTIONS_SELECTOR_ACU = '.acu-vis-actions';
const ASSISTANT_BUTTON_ID_ACU = 'acu-vis-assistant-btn';
const ASSISTANT_HOST_ID_ACU = 'acu-vis-assistant-host';
const ASSISTANT_DOCK_SELECTOR_ACU = '#acu-vis-assistant-dock';
const LIFECYCLE_POLL_MS_ACU = 200;
const DISABLE_AUTO_INIT_FLAG_ACU = '__ACU_DISABLE_TEMPLATE_ASSISTANT_ADDON_AUTO_INIT__';

let addonInitialized_ACU = false;
let lifecycleTimer_ACU: ReturnType<typeof globalThis.setInterval> | null = null;
let visualizerObserver_ACU: MutationObserver | null = null;
let lastVisualizerOpen_ACU = false;
let lastSheetKey_ACU: string | null = null;

function getAddonDocument_ACU(): Document | null {
    if (topLevelWindow_ACU?.document) {
        return topLevelWindow_ACU.document;
    }
    if (typeof document !== 'undefined') {
        return document;
    }
    return null;
}

function getVisualizerRoot_ACU(doc = getAddonDocument_ACU()): HTMLElement | null {
    if (!doc) return null;
    return doc.querySelector(VISUALIZER_ROOT_SELECTOR_ACU) as HTMLElement | null;
}

function createAssistantButton_ACU(doc: Document) {
    const button = doc.createElement('button');
    button.id = ASSISTANT_BUTTON_ID_ACU;
    button.className = 'acu-btn-secondary';
    button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> AI 改表助手';
    button.addEventListener('click', () => {
        toggleVisualizerTemplateAssistant_ACU();
    });
    return button;
}

function createAssistantHost_ACU(doc: Document) {
    const host = doc.createElement('div');
    host.id = ASSISTANT_HOST_ID_ACU;
    return host;
}

export function ensureVisualizerTemplateAssistantAddonDom_ACU(): boolean {
    const doc = getAddonDocument_ACU();
    const root = getVisualizerRoot_ACU(doc);
    if (!doc || !root) return false;

    let domChanged = false;
    const actions = root.querySelector(VISUALIZER_ACTIONS_SELECTOR_ACU);
    if (actions && !root.querySelector(`#${ASSISTANT_BUTTON_ID_ACU}`)) {
        const button = createAssistantButton_ACU(doc);
        actions.insertBefore(button, actions.firstChild);
        domChanged = true;
    }

    const dock = root.querySelector(ASSISTANT_DOCK_SELECTOR_ACU);
    if (!root.querySelector(`#${ASSISTANT_HOST_ID_ACU}`) && !doc.querySelector(`#${ASSISTANT_HOST_ID_ACU}`) && dock) {
        dock.appendChild(createAssistantHost_ACU(doc));
        domChanged = true;
    }

    if (domChanged) {
        renderVisualizerTemplateAssistantPanel_ACU();
    }

    return true;
}

export function syncVisualizerTemplateAssistantAddon_ACU(force = false) {
    const hadVisualizer = lastVisualizerOpen_ACU;
    const hasVisualizer = !!getVisualizerRoot_ACU();

    if (hasVisualizer && !hadVisualizer) {
        resetVisualizerTemplateAssistantState_ACU();
        lastSheetKey_ACU = null;
    }

    if (!hasVisualizer && hadVisualizer) {
        resetVisualizerTemplateAssistantState_ACU();
        lastSheetKey_ACU = null;
        lastVisualizerOpen_ACU = false;
        return;
    }

    if (!hasVisualizer) {
        lastVisualizerOpen_ACU = false;
        return;
    }

    ensureVisualizerTemplateAssistantAddonDom_ACU();

    const currentSheetKey = _acuVisState.currentSheetKey || null;
    if (force || currentSheetKey !== lastSheetKey_ACU) {
        lastSheetKey_ACU = currentSheetKey;
        handleVisualizerTemplateAssistantSheetChange_ACU();
    }

    lastVisualizerOpen_ACU = true;
}

function startVisualizerObserver_ACU() {
    const doc = getAddonDocument_ACU();
    if (!doc?.body || typeof MutationObserver !== 'function') return;

    visualizerObserver_ACU = new MutationObserver(() => {
        syncVisualizerTemplateAssistantAddon_ACU();
    });
    visualizerObserver_ACU.observe(doc.body, { childList: true, subtree: true });
}

function startLifecyclePoll_ACU() {
    lifecycleTimer_ACU = globalThis.setInterval(() => {
        syncVisualizerTemplateAssistantAddon_ACU();
    }, LIFECYCLE_POLL_MS_ACU);
}

export function stopVisualizerTemplateAssistantAddon_ACU() {
    if (visualizerObserver_ACU) {
        visualizerObserver_ACU.disconnect();
        visualizerObserver_ACU = null;
    }
    if (lifecycleTimer_ACU !== null) {
        globalThis.clearInterval(lifecycleTimer_ACU);
        lifecycleTimer_ACU = null;
    }
    addonInitialized_ACU = false;
    lastVisualizerOpen_ACU = false;
    lastSheetKey_ACU = null;
}

export function initVisualizerTemplateAssistantAddon_ACU() {
    if (addonInitialized_ACU) return;
    addonInitialized_ACU = true;

    startVisualizerObserver_ACU();
    startLifecyclePoll_ACU();
    syncVisualizerTemplateAssistantAddon_ACU(true);
}

if (!(globalThis as Record<string, unknown>)[DISABLE_AUTO_INIT_FLAG_ACU]) {
    initVisualizerTemplateAssistantAddon_ACU();
}
