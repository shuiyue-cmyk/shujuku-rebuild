import {
  getChatMutationAbortSignal_ACU,
  isAutoUpdatingCard_ACU,
  onTableFillRunEnded_ACU,
} from '../../service/runtime/state-manager';
import { onTableFillCommitted_ACU } from '../../service/table/table-fill-committed';
import {
  previewTokenSavingsBatch_ACU,
  resolveTokenSavingsPresets_ACU,
  type TokenSavingsCandidate_ACU,
  type TokenSavingsItem_ACU,
} from '../../service/optimization/token-savings';
import { readTokenSavingsSettings_ACU } from '../../service/optimization/token-savings-settings';
import { logWarn_ACU } from '../../shared/utils';
import {
  listChronicleCompressionItems_ACU,
  replaceChronicleContentsIfUnchanged_ACU,
  type ChronicleCompressionScope_ACU,
} from './api-groups/table-crud-api';

interface PendingChronicle {
  item: TokenSavingsItem_ACU;
  candidate?: TokenSavingsCandidate_ACU;
}

interface ChronicleQueue {
  scope: ChronicleCompressionScope_ACU;
  pending: Map<string, PendingChronicle>;
  controller: AbortController;
  detach: () => void;
}

let installed = false;
let queue: ChronicleQueue | null = null;
let draining = false;

function sameScope(left: ChronicleCompressionScope_ACU, right: ChronicleCompressionScope_ACU): boolean {
  return left.chatKey === right.chatKey && left.isolationKey === right.isolationKey
    && left.sheetKey === right.sheetKey && left.column === right.column;
}

function enabled(): boolean {
  const settings = readTokenSavingsSettings_ACU();
  return settings.enabled && settings.autoChronicle;
}

export function stopChronicleAutoCompression_ACU(): void {
  const current = queue;
  queue = null;
  current?.detach();
  current?.controller.abort();
}

function openQueue(scope: ChronicleCompressionScope_ACU): ChronicleQueue {
  stopChronicleAutoCompression_ACU();
  const chatSignal = getChatMutationAbortSignal_ACU();
  const current = {
    scope,
    pending: new Map<string, PendingChronicle>(),
    controller: new AbortController(),
    detach: () => chatSignal?.removeEventListener('abort', stopChronicleAutoCompression_ACU),
  };
  chatSignal?.addEventListener('abort', stopChronicleAutoCompression_ACU, { once: true });
  queue = current;
  return current;
}

function matchCurrentItems(current: ChronicleQueue, entries: PendingChronicle[]): PendingChronicle[] {
  const live = listChronicleCompressionItems_ACU();
  if (!live || !sameScope(current.scope, live.scope)) return [];
  const items = new Map(live.items.map(item => [item.id, item]));
  return entries.filter(({ item }) => {
    const latest = items.get(item.id);
    return latest && !latest.blocked && latest.original === item.original;
  });
}

async function drain(): Promise<void> {
  const current = queue;
  if (draining || !current || isAutoUpdatingCard_ACU) return;
  if (!enabled()) {
    stopChronicleAutoCompression_ACU();
    return;
  }
  draining = true;
  const { signal } = current.controller;
  const isCurrent = () => queue === current && !signal.aborted && enabled();
  try {
    const entries = matchCurrentItems(current, [...current.pending.values()]);
    current.pending.clear();
    const toCompress = entries.filter(entry => !entry.candidate).map(entry => entry.item);
    const ready = entries.filter(entry => !!entry.candidate);
    if (toCompress.length) {
      const preview = await previewTokenSavingsBatch_ACU(
        toCompress, 'chronicle', resolveTokenSavingsPresets_ACU(), signal, readTokenSavingsSettings_ACU().concurrency,
      );
      for (const { item, candidate } of preview) if (candidate) ready.push({ item, candidate });
    }
    if (!isCurrent()) return;
    const valid = matchCurrentItems(current, ready);
    if (isAutoUpdatingCard_ACU) {
      for (const entry of valid) {
        if (!current.pending.has(entry.item.id)) current.pending.set(entry.item.id, entry);
      }
      return;
    }
    const replacements = valid.map(({ item, candidate }) => ({
      id: item.id, original: item.original, replacement: candidate!.text,
    }));
    await replaceChronicleContentsIfUnchanged_ACU(current.scope, replacements, () => isCurrent() && !isAutoUpdatingCard_ACU);
  } catch (error) {
    if (isCurrent()) logWarn_ACU('[Token 节省] 自动压缩未写入纪要。', error);
  } finally {
    draining = false;
    if (queue?.pending.size) void drain();
    else if (queue === current) stopChronicleAutoCompression_ACU();
  }
}

export function installChronicleAutoCompression_ACU(): void {
  if (installed) return;
  installed = true;
  onTableFillCommitted_ACU(({ before, after, sheetKeys }) => {
    if (!enabled()) return;
    const next = listChronicleCompressionItems_ACU(after);
    if (!next || (sheetKeys && !sheetKeys.includes(next.scope.sheetKey))) return;
    const previous = listChronicleCompressionItems_ACU(before);
    const originals = new Map(previous && sameScope(previous.scope, next.scope)
      ? previous.items.map(item => [item.id, item.original]) : []);
    const changed = next.items.filter(item => !item.blocked && item.original !== originals.get(item.id));
    if (!changed.length) return;
    const current = queue && sameScope(queue.scope, next.scope) ? queue : openQueue(next.scope);
    for (const item of changed) current.pending.set(item.id, { item });
    // 回调运行于提交锁内。等填表结束，或让出本轮同步栈以后再启动后台请求。
    if (!isAutoUpdatingCard_ACU) void Promise.resolve().then(drain);
  });
  onTableFillRunEnded_ACU(() => { void drain(); });
}
