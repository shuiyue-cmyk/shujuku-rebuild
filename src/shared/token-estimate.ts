export function estimateTextTk_ACU(value: unknown): number {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 1.6));
}

export function normalizeTkBudgetNumber_ACU(value: unknown, fallback = 0): number {
  const raw = Number(value);
  const base = Number.isFinite(raw) ? Math.trunc(raw) : fallback;
  return Math.max(0, base);
}
