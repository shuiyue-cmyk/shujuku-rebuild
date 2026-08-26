// service/ai/preset-rate-limiter.ts — 预设级请求限速（公益站兼容）
// 每个开启「公益站兼容」的 API 预设独立计数：滑动窗口内最多 maxPerMinute 次请求，
// 超出时挂起等待最早一条记录滑出窗口，期间响应 abort 信号。

const WINDOW_MS = 60_000;
const DEFAULT_MAX_PER_MINUTE = 3;

const windowsByPreset = new Map<string, number[]>();

function pruneWindow(timestamps: number[], now: number): void {
  while (timestamps.length > 0 && now - timestamps[0] >= WINDOW_MS) {
    timestamps.shift();
  }
}

function sleepWithAbort(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const e = new Error('Aborted');
      e.name = 'AbortError';
      reject(e);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      const e = new Error('Aborted');
      e.name = 'AbortError';
      reject(e);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 获取一个限速槽位：该 key 在滑动窗口内已有 maxPerMinute 次请求时挂起等待。
 * 中止时抛出 name==='AbortError' 的错误，由调用方既有中止链路处理。
 */
export async function acquirePresetRateLimitSlot_ACU(
  key: string,
  options: { signal?: AbortSignal | null; maxPerMinute?: number } = {},
): Promise<void> {
  const normalizedKey = String(key || '').trim() || '_default';
  const max = Math.max(1, Math.floor(Number(options.maxPerMinute) || DEFAULT_MAX_PER_MINUTE));
  let timestamps = windowsByPreset.get(normalizedKey);
  if (!timestamps) {
    timestamps = [];
    windowsByPreset.set(normalizedKey, timestamps);
  }

  for (;;) {
    const now = Date.now();
    pruneWindow(timestamps, now);
    if (timestamps.length < max) {
      timestamps.push(now);
      return;
    }
    const waitMs = WINDOW_MS - (now - timestamps[0]) + 50;
    await sleepWithAbort(waitMs, options.signal);
  }
}

/** 测试/调试用：清空全部限速计数 */
export function resetPresetRateLimiter_ACU(): void {
  windowsByPreset.clear();
}
