/**
 * Claude 风格仪表盘顶部的衬线问候语，按本地时段取词。
 */
export function claudeGreeting(hour: number): string {
  if (!Number.isFinite(hour)) return '你好';
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h < 11) return '早上好';
  if (h >= 11 && h < 13) return '中午好';
  if (h >= 13 && h < 18) return '下午好';
  if (h >= 18 && h < 23) return '晚上好';
  return '夜深了';
}
