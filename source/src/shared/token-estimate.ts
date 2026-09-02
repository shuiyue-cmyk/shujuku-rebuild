export function normalizeTkBudgetNumber_ACU(value: unknown, fallback = 0): number {
  const raw = Number(value);
  const base = Number.isFinite(raw) ? Math.trunc(raw) : fallback;
  return Math.max(0, base);
}
