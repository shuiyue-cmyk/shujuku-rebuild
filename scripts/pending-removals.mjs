// 待删除文件清单（权限被自动拒绝时的落地方案）。
// 由用户在确认后执行：node scripts/pending-removals.mjs
// 或在会话中让 agent 重新执行删除（批准一次即可）。
import { existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  'manifest.plus-assistantembedded.json',
  'rollup.plus-assistantembedded.config.js',
  'src/index.ts',
  'src/entry-extension-plus-assistantembedded.ts',
  'src/service/table/native-table-service-adapter.ts',
  'tests/service/table/native-table-service-adapter.test.ts',
  'tests/scripts/fix-generated-whitespace.test.ts',
  'scripts/audit-bundle.cjs',
  'scripts/build-index.js',
  'scripts/check-arch.mjs',
  'scripts/check-arch.sh',
  'scripts/check-backup-hash.ps1',
  'scripts/copy-sql-wasm.mjs',
  'scripts/copy-to-index.mjs',
  'scripts/fix-generated-whitespace.mjs',
  'scripts/publish-extension.sh',
  'scripts/run-rollup.mjs',
  'scripts/split-round2.js',
  'scripts/split-round3-step2.js',
  'scripts/sync-userscript-json.mjs',
  'scripts/verify-build.sh',
  'scripts/diagnostics',
];

let ok = 0;
let missing = 0;
for (const rel of targets) {
  const p = join(root, rel);
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    console.log(`[deleted] ${rel}`);
    ok++;
  } else {
    console.log(`[missing] ${rel}`);
    missing++;
  }
}
console.log(`done: deleted=${ok} missing=${missing}`);
