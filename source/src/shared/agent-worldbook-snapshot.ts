import type { AgentWorldbookControlSnapshot_ACU } from './models/agent-worldbook-model';
import { hashUserInput_ACU } from './utils';

export function normalizeAgentWorldbookSnapshotBookNames_ACU(bookNames: unknown): string[] {
  if (!Array.isArray(bookNames)) return [];
  return [...new Set(bookNames.map(name => String(name || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function buildAgentWorldbookSnapshotSelectionSignature_ACU(bookNames: unknown): string {
  return hashUserInput_ACU(JSON.stringify({
    scope: 'agent-worldbook-takeover',
    books: normalizeAgentWorldbookSnapshotBookNames_ACU(bookNames),
  }));
}

export function isAgentWorldbookSnapshotValidForBooks_ACU(
  snapshot: AgentWorldbookControlSnapshot_ACU | null | undefined,
  bookNames: unknown,
): boolean {
  return snapshot?.active === true
    && snapshot.selectionSignature === buildAgentWorldbookSnapshotSelectionSignature_ACU(bookNames);
}
