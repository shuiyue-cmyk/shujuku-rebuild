/**
 * 新版界面统一的下载入口（R10A-13 / R10B-18：v2 与 v3 只保留这一份实现）。
 * - 下载节点挂在 host document 上：扩展可能跑在 iframe 里，挂在当前 document 下载可能不触发；
 * - 延迟 revoke：WebView2/部分内核在 click 后立即 revoke 会取消下载，界面却已提示「已导出」。
 */
import { getAcuHostDocument } from './host-document';

export const DOWNLOAD_REVOKE_DELAY_MS_ACU = 1000;

export function downloadTextToHost_ACU(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const doc = getAcuHostDocument();
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_REVOKE_DELAY_MS_ACU);
}

export function downloadJsonToHost_ACU(filename: string, data: unknown): void {
  downloadTextToHost_ACU(filename, JSON.stringify(data, null, 2));
}
