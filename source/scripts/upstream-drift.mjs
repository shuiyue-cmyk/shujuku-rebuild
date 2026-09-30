#!/usr/bin/env node
/**
 * scripts/upstream-drift.mjs — 上游终态符号级漂移比对（发版前置步骤）
 *
 * 为什么不用「commit message 里引用的上游 SHA」反查移植覆盖：
 * 我方大量上游修复是随 perf / review / 发版提交顺手带进来的，message 里没有上游 SHA。
 * 按 SHA 记账既虚报缺口（上游多轮修补的中途版本我们其实已跳到终态），
 * 也会漏报真实缺口。唯一可靠的口径是**比对终态**：上游某个导出在我们仓是否存在。
 *
 * 输出三类：
 * - MISSING_FILE：上游有该模块，我方完全没有（多为上游独有功能，如 world simulation）
 * - MISSING_EXPORTS：文件在、但少了这些导出（最可能是漏跟的修复）
 * - OURS_ONLY：我方独有（TT 适配），仅作规模参考
 *
 * 用法：node scripts/upstream-drift.mjs [--upstream <路径>] [--ref <上游 ref>] [--json] [--top <N>]
 * 只读：不写文件、不改上游仓状态（只用 git show / ls-tree）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = resolve(HERE, '..');            // …/shujuku-rebuild/source
const REPO_ROOT = resolve(SOURCE_ROOT, '..');       // …/shujuku-rebuild

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] || fallback);
};
const upstreamPath = resolve(readFlag('upstream', join(REPO_ROOT, '..', 'shujuku-upstream')));
const ref = readFlag('ref', 'origin/test');
const asJson = args.includes('--json');
const topLimit = Number(readFlag('top', '25')) || 25;

if (!existsSync(upstreamPath)) {
  console.error(`找不到上游克隆：${upstreamPath}\n先 clone：git clone https://github.com/AlbusKen/shujuku.git "${join(REPO_ROOT, '..', 'shujuku-upstream')}"`);
  process.exit(2);
}

const git = (gitArgs) => execFileSync('git', ['-C', upstreamPath, ...gitArgs], {
  encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  git(['rev-parse', '--verify', ref]);
} catch {
  console.error(`上游 ref 不存在：${ref}（先在 upstreamPath 里 git fetch）`);
  process.exit(2);
}

/** 抽取一个 TS/JS 模块的导出名。 */
function exportedNames(code) {
  const names = new Set();
  const patterns = [
    /export\s+(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
    /export\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) names.add(match[1]);
  }
  // export { a, b as c }
  for (const match of code.matchAll(/export\s*(?:\{([^}]*)\}|type\s*\{([^}]*)\})/g)) {
    const body = match[1] ?? match[2] ?? '';
    for (const piece of body.split(',')) {
      const token = piece.trim();
      if (!token || token === 'default') continue;
      const asMatch = token.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      names.add((asMatch ? asMatch[1] : token).replace(/^type\s+/, '').trim());
    }
  }
  for (const name of ['default']) names.delete(name);
  return names;
}

/** 符号是否在我方任意源文件里出现过（含被内部调用的私有实现）。 */
const ourSourceRoot = join(SOURCE_ROOT, 'src');
const ourFiles = git(['ls-tree', '-r', '--name-only', ref, '--', 'src'])
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean);

/** 我方全量源码文本一次读入，供「符号是否存在」子串判定，避免逐符号扫盘。 */
function readOurs(upstreamRelPath) {
  const rel = upstreamRelPath.replace(/^src\//, '');
  for (const candidate of [rel, rel.replace(/\.ts$/, '.js')]) {
    const absolute = join(ourSourceRoot, candidate);
    if (existsSync(absolute)) {
      try { return readFileSync(absolute, 'utf8'); } catch { return ''; }
    }
  }
  return null;
}

const report = { ref, upstreamPath, missingFiles: [], missingExports: [], oursOnlyCount: 0, scanned: 0 };

for (const upstreamFile of ourFiles) {
  if (/\.d\.ts$/.test(upstreamFile)) continue;
  let code;
  try { code = git(['show', `${ref}:${upstreamFile}`]); } catch { continue; }
  if (!/\bexport\b/.test(code)) continue;
  report.scanned += 1;

  const upstreamExports = exportedNames(code);
  if (upstreamExports.size === 0) continue;

  const ourCode = readOurs(upstreamFile);
  if (ourCode === null) {
    report.missingFiles.push({ file: upstreamFile, exports: [...upstreamExports].length });
    continue;
  }
  const ourExports = exportedNames(ourCode);
  const missing = [...upstreamExports].filter(name => !ourExports.has(name) && !ourCode.includes(name));
  if (missing.length) report.missingExports.push({ file: upstreamFile, missing });

  for (const name of ourExports) if (!upstreamExports.has(name)) report.oursOnlyCount += 1;
}

report.missingFiles.sort((a, b) => b.exports - a.exports);
report.missingExports.sort((a, b) => b.missing.length - a.missing.length);

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`上游终态比对：${ref} @ ${upstreamPath}`);
  console.log(`扫描上游模块 ${report.scanned} 个\n`);
  console.log(`【整模块缺失】${report.missingFiles.length} 个（多为上游独有功能，需人工分诊）`);
  for (const row of report.missingFiles.slice(0, topLimit)) {
    console.log(`   ${row.file}  (${row.exports} 个导出)`);
  }
  if (report.missingFiles.length > topLimit) console.log(`   …共 ${report.missingFiles.length} 个，用 --top 放大`);
  console.log(`\n【文件在、导出缺失】${report.missingExports.length} 个（最可能是漏跟的修复，逐个判定）`);
  for (const row of report.missingExports.slice(0, topLimit)) {
    console.log(`   ${row.file}`);
    console.log(`      缺 ${row.missing.length}: ${row.missing.slice(0, 8).join(', ')}${row.missing.length > 8 ? ' …' : ''}`);
  }
  if (report.missingExports.length > topLimit) console.log(`   …共 ${report.missingExports.length} 个，用 --top 放大或 --json 看全量`);
  console.log(`\n【我方独有导出（TT 适配）】约 ${report.oursOnlyCount} 个`);
  console.log('\n提醒：本脚本只做线索发现。每个「缺导出」必须人工判定：');
  console.log('  ① 我方是否已用不同实现覆盖同一缺陷  ② 是否上游独有功能  ③ 移植是否会弱化我方 P1 加固或改提示词字节。');
}
