/**
 * shared/abortable-delay.ts
 * 可被 AbortSignal 中断的延时等待工具函数
 *
 * AbortSignal / setTimeout / Promise 均为 Web 标准 API，不涉及 DOM 节点操作，
 * 放在 shared 层供所有层级使用。
 */

/**
 * 等待指定毫秒数，期间若 signal 被 abort 则立即 resolve（不 reject）。
 * @param ms      延时毫秒数
 * @param signal  可选的 AbortSignal，为空时退化为普通 setTimeout
 */
export function abortableDelay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise<void>(resolve => {
    if (signal?.aborted) { resolve(); return; }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const done = () => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (signal) {
        try { signal.removeEventListener('abort', done); } catch (_) { /* noop */ }
      }
      resolve();
    };

    timer = setTimeout(done, ms);

    if (signal) {
      signal.addEventListener('abort', done, { once: true });
    }
  });
}
