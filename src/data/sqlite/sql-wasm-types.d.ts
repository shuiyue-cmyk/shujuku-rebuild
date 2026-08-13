/**
 * data/sqlite/sql-wasm-types.d.ts
 * sql.js 引擎模块声明（wasm / asm / 构建占位符）。
 * sql.js 包不携带类型定义，这里声明默认导出为初始化函数；
 * wasmBinary 用于内联 wasm（base64 解码后交给 emscripten，避免外部 fetch）；
 * locateFile 作为兜底定位 .wasm 文件（多形态解析见 sql-wasm-locator.ts）。
 */
declare module 'sql.js/dist/sql-wasm.js' {
  interface SqlJsConfig {
    /** 内联 wasm 二进制（emscripten 优先使用，不再发起 locateFile fetch） */
    wasmBinary?: Uint8Array;
    locateFile?: (file: string) => string;
  }
  function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
  export default initSqlJs;
}

declare module 'sql.js/dist/sql-asm-memory-growth.js' {
  interface SqlJsConfig {
    /** asm 引擎为纯 JS，内联 wasm 二进制不适用（传了也会被忽略，保持类型一致） */
    wasmBinary?: Uint8Array;
    locateFile?: (file: string) => string;
  }
  function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
  export default initSqlJs;
}

/** 构建占位符：rollup 按 ACU_SQLITE_ENGINE 替换为 wasm/asm 模块。 */
declare module '__ACU_SQLITE_ENGINE_IMPORT__' {
  interface SqlJsConfig {
    /** 构建期由 rollup 替换，运行时见 sqlite-engine.ts 的 wasmBinary 注入逻辑 */
    wasmBinary?: Uint8Array;
    locateFile?: (file: string) => string;
  }
  function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
  export default initSqlJs;
}

