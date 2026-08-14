/**
 * src/entry-extension.ts — 酒馆插件入口（标准 SillyTavern / TauriTavern 扩展）
 *
 * 运行时零依赖酒馆助手（JS-Slash-Runner / TavernHelper）：
 * - 启动只等 SillyTavern.getContext() 就绪，不再轮询 TavernHelper；
 * - 不 hook TavernHelper.generate（直接 JS 调用不再需要拦截）；
 * - 酒馆助手仅作为可选增强层，缺失时由各功能自己的可用性门控优雅降级。
 *
 * 加载时序：扩展脚本在宿主 DOM 就绪后执行，直接启动。
 */

// ═══════════════════════════════════════════════════════════════
// 运行时环境（必须最先导入并设置模式）
// ═══════════════════════════════════════════════════════════════
import { _forceExtensionMode, checkAndMarkInstance } from './shared/runtime-env';

_forceExtensionMode();

// ═══════════════════════════════════════════════════════════════
// shared 层
// ═══════════════════════════════════════════════════════════════
import './shared/constants';
import './shared/env';
import './shared/utils';
import './shared/json-helpers';
import './shared/html-helpers';
import './shared/text-optimization';

// ═══════════════════════════════════════════════════════════════
// data 层
// ═══════════════════════════════════════════════════════════════
import './shared/data-constants';
import './shared/idb-import-temp';
import './data/storage/tavern-storage';
import './data/storage/chat-history';
import './shared/defaults';
import './shared/defaults-json.js';
import './data/storage/config-storage';
import './data/repositories/profile-repo';
import './data/repositories/isolation-repo';

// ═══════════════════════════════════════════════════════════════
// service 层
// ═══════════════════════════════════════════════════════════════
import './service/settings/settings-service';
import './service/ai/api-call';
import './service/ai/prompt-builder';
import './service/worldbook/pipeline';
import './service/worldbook/injection-engine';
import './service/summary/merge-logic';
import './service/runtime/state-manager';
import './service/runtime/helpers-remaining';
import './service/template/chat-scope';
import './service/optimization/content-optimization';

// ═══════════════════════════════════════════════════════════════
// presentation 层
// ═══════════════════════════════════════════════════════════════
import './presentation/triggers/update-process';
import './presentation/bootstrap/init';
import './presentation/bootstrap/api-registry';
import './presentation/theme/toast';
import './presentation/components/table-selector';
import './presentation/components/plot-editors';
import './presentation/components/status-display';
import './presentation/components/template-preset-ui';
import './presentation/components/optimization-ui';
import './presentation/components/worldbook-selector';
import './presentation/components/update-status-display';
import './presentation/triggers/update-trigger';
import './presentation/triggers/data-admin-ui';
import './presentation/triggers/settings-ui-sync';

// ═══════════════════════════════════════════════════════════════
// 启动入口（扩展模式）
// ═══════════════════════════════════════════════════════════════
import { mainInitialize_ACU } from './presentation/bootstrap/init';
import { bootstrapAcuV2 } from './presentation-v2/bootstrap';
import { logDebug_ACU, logError_ACU } from './shared/utils';

/**
 * 等待宿主 API 就绪：主窗口的 window.SillyTavern 只有 {libs, getContext}，
 * 真正的 API 都要经 SillyTavern.getContext() 拿到，所以就绪判定就是
 * getContext() 能返回带核心字段的快照。不依赖酒馆助手。
 */
async function waitForHostApi(maxWaitMs = 15000): Promise<boolean> {
  const start = Date.now();
  let lastStatus = '';

  const probe = () => {
    if (typeof (window as any).SillyTavern?.getContext !== 'function') {
      return 'no_getContext';
    }
    try {
      const ctx = (window as any).SillyTavern.getContext();
      const hasEvent = !!(ctx?.eventSource && ctx?.eventTypes);
      const hasSave = typeof ctx?.saveSettingsDebounced === 'function';
      if (hasEvent && hasSave) return 'ready';
      return 'partial';
    } catch {
      return 'getContext_error';
    }
  };

  while (Date.now() - start < maxWaitMs) {
    const status = probe();
    if (status !== lastStatus) {
      logDebug_ACU(`[插件启动] 等待宿主就绪... ${status}`);
      lastStatus = status;
    }
    if (status === 'ready') return true;
    await new Promise(r => setTimeout(r, 100));
  }

  const finalStatus = probe();
  logError_ACU(`[插件启动] 等待 SillyTavern 就绪超时（${maxWaitMs}ms），最终状态: ${finalStatus}`);
  return false;
}

/**
 * 扩展启动流程
 */
async function extensionMain() {
    if (checkAndMarkInstance()) {
        logError_ACU('[插件启动] 检测到已有实例运行，跳过初始化。请勿同时安装油猴脚本和本扩展。');
        return;
    }

    const ready = await waitForHostApi();
    if (!ready) {
        return;
    }

    logDebug_ACU('[插件启动] 宿主 API 已就绪，开始初始化...');
    mainInitialize_ACU();
    bootstrapAcuV2();
}

// 扩展加载时 DOM 已就绪，直接启动
extensionMain();
