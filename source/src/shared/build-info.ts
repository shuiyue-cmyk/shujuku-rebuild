/**
 * shared/build-info.ts — 构建期注入信息的唯一读取口
 *
 * rollup 打包时把版本写进 `globalThis.__ACU_BUILD_VERSION__`（与 manifest.json / source/package.json
 * 同值），构建时间戳写进 `globalThis.__ACU_BUILD_STAMP__`。源码直跑、测试环境或注入失败时读不到，
 * 一律回退到固定字面量（不猜、不抛）。
 *
 * 之所以单独一个模块：此前 useDebugPanel 与 plot-entry 各写了一份同样的 try/catch 读取，
 * Debug 上报链接是第三个消费者，再复制就要出现三份口径。
 */

/** 插件版本号；读不到返回 'unknown'。 */
export function readAcuBuildVersion_ACU(): string {
  try {
    const version = (globalThis as any).__ACU_BUILD_VERSION__;
    return typeof version === 'string' && version ? version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 构建时间戳；读不到返回 'dev'（与构建徽章的既有回退一致）。 */
export function readAcuBuildStamp_ACU(): string {
  try {
    const stamp = (globalThis as any).__ACU_BUILD_STAMP__;
    return typeof stamp === 'string' && stamp ? stamp : 'dev';
  } catch {
    return 'dev';
  }
}
