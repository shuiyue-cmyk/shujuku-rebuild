#!/usr/bin/env node
/**
 * scripts/copy-sql-wasm.mjs
 * 从 node_modules/sql.js/dist/sql-wasm.wasm 复制到目标目录，
 * 输出 SHA-256 与字节数；源缺失或复制后 hash 不一致则 process.exit(1)。
 *
 * 用法：node scripts/copy-sql-wasm.mjs <targetDir>
 */
import { copySqlWasmTo } from './sql-wasm-assets.mjs';
import { resolve } from 'path';

function main() {
  const targetDirArg = process.argv[2];
  if (!targetDirArg) {
    console.error('[copy-sql-wasm] 缺少目标目录参数');
    process.exit(1);
  }
  try {
    copySqlWasmTo(resolve(process.cwd(), targetDirArg));
  } catch (e) {
    console.error(`[copy-sql-wasm] ${e.message}`);
    process.exit(1);
  }
}

main();
