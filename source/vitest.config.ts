import { defineConfig } from 'vitest/config';
import path from 'path';
import vuePlugin from 'unplugin-vue/vite';

/**
 * SillyTavern 宿主模块在生产环境通过 rollup external 标记不打包，
 * 但 vitest 走 vite 解析时找不到对应文件。为这两个相对路径提供空模块占位，
 * 避免 service / data 层 transitive 导入触发 import 解析失败。
 */
function stubHostModules() {
  const HOST_PATHS = new Set(['./script.js', './scripts/extensions.js']);
  return {
    name: 'acu-v2-stub-host-modules',
    enforce: 'pre' as const,
    resolveId(source: string) {
      if (HOST_PATHS.has(source)) return `\0acu-v2-host-stub:${source}`;
      return null;
    },
    load(id: string) {
      if (id.startsWith('\0acu-v2-host-stub:')) {
        return 'export default {};';
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    stubHostModules(),
    vuePlugin({
      isProduction: true,
      root: process.cwd(),
      sourceMap: false,
      inlineTemplate: false,
    }),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@data': path.resolve(__dirname, 'src/data'),
      '@service': path.resolve(__dirname, 'src/service'),
      '@presentation': path.resolve(__dirname, 'src/presentation'),
      '@presentation-v2': path.resolve(__dirname, 'src/presentation-v2'),
      // 构建期由 rollup replace 注入；vitest 直接解析到 wasm 引擎（测试通过 mock 替换）
      '__ACU_SQLITE_ENGINE_IMPORT__': 'sql.js/dist/sql-wasm.js',
    },
  },
  define: {
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 15000,
    // 历史定规为单线程（多运行时峰值内存互踩）。2026-08-31 本机 24 核/32GB 实测：
    // 8 并行 × 2 连跑 6907 全绿零偶发，114s（单线程 537s 的 4.7 倍提速）；默认 8，
    // ACU_VITEST_WORKERS 可临时上调/回退（10 并行仅再省 ~4s，收益递减）。
    maxWorkers: Math.max(1, Number(process.env.ACU_VITEST_WORKERS || 8)),
    fileParallelism: Number(process.env.ACU_VITEST_WORKERS || 8) > 1,
    maxConcurrency: 1,
    typecheck: {
      tsconfig: './tsconfig.json',
    },
  },
});
