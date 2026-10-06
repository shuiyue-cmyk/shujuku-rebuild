/**
 * file-helpers — 新版界面里"读本地文件 / 下载 JSON"的小工具。
 * 下载节点挂在 host document 上（扩展可能跑在 iframe 里），延迟 revoke 兼容 WebView2。
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

export function downloadJsonFile_UB(doc: Document, filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
