#!/usr/bin/env node
/**
 * scripts/copy-to-index.mjs
 * 构建完成后自动将 dist/index.bundle.js 复制覆盖 index.js
 *
 * 使用方法（通过 package.json scripts.build 自动调用）：
 *   node scripts/copy-to-index.mjs
 */
import { copyFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'dist', 'index.bundle.js');
const DST = join(ROOT, 'index.js');

if (!existsSync(SRC)) {
  console.error('[copy-to-index] ERROR: 构建产物不存在: dist/index.bundle.js');
  console.error('[copy-to-index] 请先运行 npm run build');
  process.exit(1);
}

copyFileSync(SRC, DST);
const size = (statSync(DST).size / 1024).toFixed(1) + ' KB';
console.log(`[copy-to-index] dist/index.bundle.js -> index.js (${size})`);
