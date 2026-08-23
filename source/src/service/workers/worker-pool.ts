/**
 * worker-pool.ts — 主线程 Worker 池与回退
 * 单例 Blob Worker，处理 worldbookScan / mergeTables / formatTables
 * 失败或 CSP 拦截时回退主线程同步执行
 */

import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';

type WorkerTaskType = 'worldbookScan';

interface WorkerRequest {
  id: string;
  type: WorkerTaskType;
  payload: any;
}

interface WorkerResponse {
  id: string;
  success: boolean;
  result?: any;
  error?: string;
}

let workerInstance: Worker | null = null;
let workerReady = false;
let workerFailed = false;

const pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: any }>();

function getWorkerCode(): string {
  return `
  // Aho-Corasick for worldbook keyword scanning
  function buildAhoTrie(keywords) {
    const root = { next: Object.create(null), fail: null, out: [] };
    for (let idx = 0; idx < keywords.length; idx++) {
      const word = keywords[idx];
      let node = root;
      for (const ch of word) {
        if (!node.next[ch]) node.next[ch] = { next: Object.create(null), fail: null, out: [] };
        node = node.next[ch];
      }
      node.out.push(idx);
    }
    const queue = [];
    for (const ch of Object.keys(root.next)) {
      const child = root.next[ch];
      child.fail = root;
      queue.push(child);
    }
    while (queue.length) {
      const cur = queue.shift();
      for (const ch of Object.keys(cur.next)) {
        const child = cur.next[ch];
        let f = cur.fail;
        while (f && !f.next[ch]) f = f.fail;
        child.fail = f ? f.next[ch] : root;
        child.out = child.out.concat(child.fail.out);
        queue.push(child);
      }
    }
    return root;
  }
  function ahoSearch(text, root) {
    const found = new Set();
    let node = root;
    for (const ch of text) {
      while (node && !node.next[ch]) node = node.fail;
      node = node ? node.next[ch] : root;
      if (!node) { node = root; continue; }
      for (const idx of node.out) found.add(idx);
    }
    return found;
  }
  self.onmessage = function(e) {
    const req = e.data;
    try {
      let result = null;
      if (req.type === 'worldbookScan') {
        const { allEntries, baseScanText, constantUids, forcedKeys, skillKeys } = req.payload;
        const constantSet = new Set(constantUids);
        const forcedSet = new Set(forcedKeys);
        const skillSet = new Set(skillKeys);
        const keywordEntries = allEntries.filter(entry => {
          const uidKey = entry.bookName + '\\u0000' + entry.uid;
          if (constantSet.has(uidKey)) return false;
          if (forcedSet.has(uidKey)) return false;
          if (skillSet.has(uidKey)) return false;
          return true;
        });
        // 预小写并建树
        const allKeywords = [];
        const entryKeyMap = new Map();
        for (const entry of keywordEntries) {
          const toArr = (v) => {
            if (Array.isArray(v)) return v.filter(x => typeof x === 'string' && x.trim());
            if (typeof v === 'string' && v.trim()) return [v];
            return [];
          };
          const arr = [...toArr(entry.key), ...toArr(entry.keys)];
          const dedup = [...new Set(arr)].map(k => k.toLowerCase()).filter(Boolean);
          entryKeyMap.set(entry.bookName + '\\u0000' + entry.uid, dedup);
          for (const kw of dedup) allKeywords.push(kw);
        }
        const uniqKeywords = [...new Set(allKeywords)];
        const kwToIdx = new Map(uniqKeywords.map((k,i)=>[k,i]));
        const trie = uniqKeywords.length ? buildAhoTrie(uniqKeywords) : null;
        let base = baseScanText.toLowerCase();
        const baseFoundSet = trie && uniqKeywords.length ? ahoSearch(base, trie) : new Set();
        const triggered = new Set(constantUids);
        forcedKeys.forEach(k => triggered.add(k));
        let keywordRemaining = keywordEntries.slice();
        let depth = 0;
        const MAX_DEPTH = 10;
        while (depth < MAX_DEPTH) {
          depth++;
          // 构建 fullSearchText
          let recursionContent = '';
          for (const uid of triggered) {
            const ent = allEntries.find(e => (e.bookName + '\\u0000' + e.uid) === uid);
            if (ent && !ent.prevent_recursion) recursionContent += '\\n' + (ent.content || '');
          }
          const fullText = (base + '\\n' + recursionContent.toLowerCase());
          let foundSet = new Set();
          if (trie && uniqKeywords.length) {
            foundSet = ahoSearch(fullText, trie);
          }
          let changed = false;
          const nextRemaining = [];
          for (const entry of keywordRemaining) {
            const uidKey = entry.bookName + '\\u0000' + entry.uid;
            const kws = entryKeyMap.get(uidKey) || [];
            let hit = false;
            if (entry.exclude_recursion) {
              hit = kws.some(kw => baseFoundSet.has(kwToIdx.get(kw)));
            } else {
              hit = kws.some(kw => foundSet.has(kwToIdx.get(kw)));
            }
            if (hit) { triggered.add(uidKey); changed = true; }
            else nextRemaining.push(entry);
          }
          if (!changed) break;
          keywordRemaining = nextRemaining;
        }
        result = { triggered: Array.from(triggered) };
      } else if (req.type === 'normalizeRows') {
        // 简化：逐行 RowId 归一，复用主线程逻辑的子集（仅示例，实际由主线程回退）
        result = { ok: true };
      } else if (req.type === 'formatTables') {
        // 占位：大表格式化在主线程分片回退
        result = { ok: true };
      } else if (req.type === 'mergeTables') {
        result = { ok: true };
      }
      self.postMessage({ id: req.id, success: true, result });
    } catch (err) {
      self.postMessage({ id: req.id, success: false, error: String(err && err.message || err) });
    }
  };
  `;
}

let workerTimeoutCount = 0;

function ensureWorker(): Worker | null {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return null;
  }
  if (workerFailed) return null;
  if (workerInstance) return workerInstance;
  try {
    const code = getWorkerCode();
    const blob = new Blob([code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    workerInstance = new Worker(url);
    URL.revokeObjectURL(url);
    workerInstance.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const res = e.data;
      const entry = pending.get(res.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(res.id);
      if (res.success) {
        workerTimeoutCount = 0;
        entry.resolve(res.result);
      } else entry.reject(new Error(res.error || 'worker error'));
    };
    workerInstance.onerror = (ev) => {
      logWarn_ACU('[Worker] Worker error, fallback to main thread', ev);
      workerFailed = true;
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error('worker error'));
      }
      pending.clear();
      try { workerInstance?.terminate(); } catch {}
      workerInstance = null;
    };
    workerReady = true;
    logDebug_ACU('[Worker] Blob Worker created');
    return workerInstance;
  } catch (e) {
    logWarn_ACU('[Worker] Failed to create Worker, fallback to main thread', e);
    workerFailed = true;
    return null;
  }
}

export async function runInWorkerIfNeeded<T>(type: WorkerTaskType, payload: any, opts?: { timeoutMs?: number; threshold?: boolean }): Promise<T | null> {
  if (opts?.threshold === false) return null;
  const worker = ensureWorker();
  if (!worker || !workerReady) return null;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const timeoutMs = opts?.timeoutMs ?? 8000;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      workerTimeoutCount += 1;
      logWarn_ACU(`[Worker] ${type} timeout ${timeoutMs}ms, fallback (${workerTimeoutCount}/3)`);
      if (workerTimeoutCount >= 3) {
        logWarn_ACU('[Worker] Too many timeouts, disabling Worker');
        workerFailed = true;
        try { workerInstance?.terminate(); } catch {}
        workerInstance = null;
        workerReady = false;
      }
      reject(new Error('worker timeout'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    const req: WorkerRequest = { id, type, payload };
    try {
      worker.postMessage(req);
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e);
    }
  }).catch((e: any): T | null => {
    logWarn_ACU(`[Worker] ${type} failed, fallback`, e);
    return null;
  });
}

export function shouldUseWorkerForWorldbook(entryCount: number, baseScanLen: number, chatLen: number): boolean {
  return entryCount > 200 || baseScanLen > 30000 || chatLen > 800 || (entryCount > 100 && baseScanLen > 10000);
}

export function shouldUseWorkerForTables(tableCount: number, totalRows: number, totalCells: number): boolean {
  return tableCount > 30 || totalRows > 3000 || totalCells > 80000 || (tableCount > 20 && totalRows > 1500);
}

export function resetWorkerForTests_ACU(): void {
  workerTimeoutCount = 0;
  workerFailed = false;
  workerReady = false;
  if (workerInstance) { try { workerInstance.terminate(); } catch {} }
  workerInstance = null;
  for (const [, entry] of pending) clearTimeout(entry.timer);
  pending.clear();
}
