#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const allowedModes = new Set(['concat', 'extension', 'all']);
const [mode, ...rollupArgs] = process.argv.slice(2);

if (!mode || !allowedModes.has(mode)) {
  console.error('[run-rollup] 用法: node scripts/run-rollup.mjs <concat|extension|all> [rollup args...]');
  console.error(`[run-rollup] 收到的 mode: ${mode || '(空)'}`);
  process.exit(1);
}

const rollupBin = resolve(process.cwd(), 'node_modules', 'rollup', 'dist', 'bin', 'rollup');

if (!existsSync(rollupBin)) {
  console.error(`[run-rollup] 找不到本地 Rollup CLI: ${rollupBin}`);
  console.error('[run-rollup] 请先运行 npm install，确保 devDependencies 已安装。');
  process.exit(1);
}

const child = spawn(process.execPath, [rollupBin, '-c', ...rollupArgs], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    BUILD_MODE: mode,
  },
  stdio: 'inherit',
  shell: false,
});

child.on('error', (error) => {
  console.error(`[run-rollup] 启动 rollup 失败: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[run-rollup] rollup 被信号终止: ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});
