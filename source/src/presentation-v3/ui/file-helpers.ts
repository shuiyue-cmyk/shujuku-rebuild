/**
 * file-helpers — 新版界面里"读本地文件 / 文件名清洗"的小工具。
 * 下载统一走 presentation-v2/bootstrap/host-download（R10B-18）。
 */

export function readFileText_UB(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败。'));
    reader.readAsText(file, 'utf-8');
  });
}

export function sanitizeFilename_UB(value: string, fallback: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 48) || fallback;
}
