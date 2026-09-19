/**
 * presentation/bootstrap/tauri-version-gate.ts — TauriTavern 版本闸门提醒
 *
 * 本插件的楼层识别、填表与追平链路是按 TauriTavern 2.3.0 的宿主语义适配并验证的
 * （一等工具楼层 `{role:'tool', is_system:true}`、TOOL_CALLS_* 事件、Agent 断点续连的
 * `{agentResume:true}` 生成事件、结构写入与保存管线契约）。低于该版本时这些行为未经验证。
 *
 * 因此在 TT 宿主下于启动时读一次宿主版本，低于所需版本就弹模态提醒（**每次启动都提醒**，
 * 不依赖任何持久化状态）。非 TT 宿主不参与判定；版本读取失败按 fail-open 处理不打扰
 * （判据见 shared/host-bridge.ts 的 isAcuTauriVersionOutdated）。
 */

import {
  ACU_REQUIRED_TAURITAVERN_VERSION,
  isAcuTauriVersionOutdated,
  isAcuTauriRuntime,
  readAcuTauriVersion,
} from '../../shared/host-bridge';
import { escapeHtml_ACU } from '../../shared/html-helpers';
import { logDebug_ACU } from '../../shared/utils';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import { showToastr_ACU } from '../theme/toast';

/** 同一次页面加载内只提醒一次（init 可能被重入，避免叠窗）。 */
let tauriVersionNotified_ACU = false;

/** 组装提醒正文（纯函数，便于测试）。 */
export function buildAcuTauriVersionWarningHtml_ACU(
  currentVersion: string,
  requiredVersion: string = ACU_REQUIRED_TAURITAVERN_VERSION,
): string {
  const current = escapeHtml_ACU(String(currentVersion || '未知'));
  const required = escapeHtml_ACU(String(requiredVersion || ''));
  return [
    '<h3>建议升级 TauriTavern</h3>',
    `<p>检测到当前 TauriTavern 版本为 <b>${current}</b>，低于本插件适配与验证所需的 <b>${required}</b>。</p>`,
    `<p>本插件的楼层识别与自动填表是按 ${required} 的宿主行为适配并验证的（工具调用结果作为独立楼层、生成事件与结构写入契约的变更）。低于该版本时行为未经验证，可能出现楼层识别偏差、填表或追平异常。</p>`,
    `<p>请升级到 <b>${required}</b> 或更高版本后重新加载页面。可在 TauriTavern 内检查更新，或从官方 Releases 下载：<br>github.com/Darkatse/TauriTavern/releases</p>`,
  ].join('');
}

/** 取宿主弹窗 API（ST 标准能力，经 getContext 暴露；取不到时返回 null 由调用方兜底）。 */
function resolveAcuPopupApi_ACU(): { show: (html: string) => Promise<unknown> } | null {
  try {
    const w = (typeof window !== 'undefined' ? window : globalThis) as any;
    const ctx = w.SillyTavern?.getContext?.() ?? SillyTavern_API_ACU;
    const callGenericPopup = (ctx as any)?.callGenericPopup;
    const textType = (ctx as any)?.POPUP_TYPE?.TEXT;
    if (typeof callGenericPopup !== 'function' || textType === undefined) return null;
    return { show: (html: string) => callGenericPopup(html, textType, '') };
  } catch {
    return null;
  }
}

/**
 * 启动时调用：TT 宿主且版本低于所需版本时提醒用户升级。
 * @returns 是否真的发出了提醒（供测试断言）
 */
export async function notifyAcuTauriVersionIfOutdated_ACU(): Promise<boolean> {
  if (tauriVersionNotified_ACU) return false;
  if (!isAcuTauriRuntime()) return false;

  let version: string | null = null;
  try {
    version = await readAcuTauriVersion();
  } catch {
    version = null;
  }
  if (!isAcuTauriVersionOutdated(version)) {
    logDebug_ACU(`[版本闸门] TauriTavern 版本满足要求或读取不到（version=${version ?? 'unavailable'}），不提醒。`);
    return false;
  }

  tauriVersionNotified_ACU = true;
  const html = buildAcuTauriVersionWarningHtml_ACU(version as string);
  const popup = resolveAcuPopupApi_ACU();
  if (!popup) {
    // 弹窗 API 不可用（极旧宿主/被裁剪的前端）时退化为 toast，不静默丢弃提醒。
    showToastr_ACU('warning', `当前 TauriTavern 版本 ${escapeHtml_ACU(String(version))} 低于本插件所需的 ${ACU_REQUIRED_TAURITAVERN_VERSION}，建议升级后重新加载。`, '版本提醒');
    return true;
  }
  // 不 await：模态窗由用户自行关闭，不得阻塞插件初始化。
  void popup.show(html);
  return true;
}
