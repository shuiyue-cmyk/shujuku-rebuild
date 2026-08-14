/**
 * rollup.config.js - 标准扩展构建（单产物）
 *
 * 输入: src/entry-extension.ts（零依赖酒馆助手）
 * 输出: dist/extension/index.js + manifest.json + sql-wasm.wasm
 * 并同步到仓库根目录（index.js / sql-wasm.wasm），供 SillyTavern/TauriTavern
 * 扩展面板通过 GitHub 仓库地址直接安装。
 */
import typescript from '@rollup/plugin-typescript';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import vuePlugin from 'unplugin-vue/rollup';
import sfcStyleInjector from './src/presentation-v2/build/rollup-sfc-style-injector.js';
import vueScriptTranspiler from './src/presentation-v2/build/rollup-vue-script-transpiler.js';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ACU_SQLITE_ENGINE, SQL_WASM_IMPORT_ID, SQL_WASM_BASE64, SQL_WASM_BASE64_GLOBAL, copySqlWasmTo } from './scripts/sql-wasm-assets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PACKAGE_VERSION = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')).version;
const ACU_BUILD_VERSION = process.env.ACU_BUILD_VERSION || PACKAGE_VERSION;

const nodeBuiltinsShim = {
  name: 'node-builtins-shim',
  resolveId(source) {
    if (source === 'fs' || source === 'node:fs') {
      return { id: '\0shim:fs', moduleSideEffects: false };
    }
    if (source === 'crypto' || source === 'node:crypto') {
      return { id: '\0shim:crypto', moduleSideEffects: false };
    }
    return null;
  },
  load(id) {
    if (id === '\0shim:fs') {
      return 'export default {}; export const readFileSync = () => null;';
    }
    if (id === '\0shim:crypto') {
      return 'export default {}; export const randomFillSync = (buf) => { for(let i=0;i<buf.length;i++) buf[i]=Math.random()*256|0; return buf; };';
    }
    return null;
  },
};

function createVuePlugin() {
  return vuePlugin({
    isProduction: true,
    root: process.cwd(),
    sourceMap: false,
    inlineTemplate: false,
  });
}

function createReplacePlugin() {
  // wasm 引擎：把 sql-wasm.wasm 的 base64 内联进产物（源码读 globalThis.__ACU_SQLITE_WASM_BASE64__）。
  const sqlWasmBase64Value = SQL_WASM_BASE64
    ? `${SQL_WASM_BASE64_GLOBAL} = ${JSON.stringify(SQL_WASM_BASE64)};`
    : `${SQL_WASM_BASE64_GLOBAL} = '';`;
  return replace({
    preventAssignment: true,
    values: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'globalThis.__ACU_BUILD_VERSION__': JSON.stringify(ACU_BUILD_VERSION),
      'globalThis.__ACU_SQLITE_ENGINE__': JSON.stringify(ACU_SQLITE_ENGINE),
      [SQL_WASM_BASE64_GLOBAL]: sqlWasmBase64Value,
      '__ACU_SQLITE_ENGINE_IMPORT__': SQL_WASM_IMPORT_ID,
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
  });
}

const sharedPlugins = [
  nodeBuiltinsShim,
  createVuePlugin(),
  vueScriptTranspiler(),
  sfcStyleInjector(),
  nodeResolve({
    browser: true,
    preferBuiltins: false,
    extensions: ['.mjs', '.js', '.json', '.ts', '.vue'],
  }),
  commonjs(),
];

function createTsPlugin() {
  return typescript({
    tsconfig: './tsconfig.json',
    compilerOptions: {
      noEmit: false,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
      outDir: 'dist',
    },
    include: ['src/**/*.ts', 'src/**/*.js'],
  });
}

const onwarn = (warning, warn) => {
  if (warning.code === 'THIS_IS_UNDEFINED') return;
  if (warning.code === 'CIRCULAR_DEPENDENCY') return;
  warn(warning);
};

/** 仓库根目录（本文件位于 source/ 下） */
const repoRoot = join(__dirname, '..');

const extensionConfig = {
  input: 'src/entry-extension.ts',
  output: {
    file: 'dist/extension/index.js',
    format: 'es',
    sourcemap: false,
  },
  treeshake: false,
  plugins: [
    ...sharedPlugins,
    createTsPlugin(),
    createReplacePlugin(),
    {
      name: 'sync-extension-artifacts',
      writeBundle() {
        const distExtensionDir = join(__dirname, 'dist', 'extension');
        const distIndex = join(distExtensionDir, 'index.js');
        const rootIndex = join(repoRoot, 'index.js');
        const rootManifest = join(repoRoot, 'manifest.json');

        mkdirSync(distExtensionDir, { recursive: true });
        if (!existsSync(distIndex)) {
          throw new Error(`extension 构建产物缺失: ${distIndex}`);
        }
        if (!existsSync(rootManifest)) {
          throw new Error(`根目录 manifest.json 缺失: ${rootManifest}`);
        }

        copyFileSync(rootManifest, join(distExtensionDir, 'manifest.json'));
        // 根目录 index.js 供扩展面板仓库直装
        copyFileSync(distIndex, rootIndex);
        // 复制 sql.js wasm 到 dist/extension/ 与仓库根目录
        copySqlWasmTo(distExtensionDir);
        copySqlWasmTo(repoRoot);
        // 复制生理追踪衣橱风格世界书资源（vendor loadWardrobeStyleBook 经 import.meta.url 相对路径读取）
        mkdirSync(join(distExtensionDir, 'assets'), { recursive: true });
        mkdirSync(join(repoRoot, 'assets'), { recursive: true });
        copyFileSync(join(__dirname, 'assets', 'wardrobe-style-book.json'), join(distExtensionDir, 'assets', 'wardrobe-style-book.json'));
        copyFileSync(join(__dirname, 'assets', 'wardrobe-style-book.json'), join(repoRoot, 'assets', 'wardrobe-style-book.json'));
        // 复制 biotracker 前端面板资源（settings.html/style.css；面板经 ./assets/biotracker-ui/ 相对路径加载；dist 与仓库根目录都复制，兼容两种安装形态）
        const uiSrc = join(__dirname, 'assets', 'biotracker-ui');
        for (const uiDist of [join(distExtensionDir, 'assets', 'biotracker-ui'), join(repoRoot, 'assets', 'biotracker-ui')]) {
          mkdirSync(uiDist, { recursive: true });
          for (const file of ['settings.html', 'style.css']) {
            copyFileSync(join(uiSrc, file), join(uiDist, file));
          }
        }
      },
    },
  ],
  external: ['./script.js', './scripts/extensions.js'],
  onwarn,
};

export default extensionConfig;
