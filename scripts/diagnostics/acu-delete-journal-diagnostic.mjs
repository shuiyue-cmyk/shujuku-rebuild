import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function usage() {
  console.error('Usage: node scripts/diagnostics/acu-delete-journal-diagnostic.mjs <input.jsonl> <targetSheetKey> [--output <copy.jsonl>] [--report <report.json>]');
  process.exit(2);
}

function parseArgs(argv) {
  const positional = [];
  const opts = { output: '', report: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output') opts.output = argv[++i] || '';
    else if (arg === '--report') opts.report = argv[++i] || '';
    else positional.push(arg);
  }
  if (positional.length !== 2 || !positional[0] || !positional[1]) usage();
  return { input: positional[0], targetKey: positional[1], ...opts };
}

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function assertSafeOutput(input, output) {
  const inAbs = path.resolve(input);
  const outAbs = path.resolve(output);
  if (inAbs === outAbs) throw new Error('Refusing to use the input file as output.');
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing output: ${output}`);
}

function loadJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => ({ line: index + 1, obj: JSON.parse(line) }));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactPaths(value, key, base = '$', out = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => exactPaths(child, key, `${base}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) {
      if (childKey === key) out.push(`${base}.${childKey}{key}`);
      if (child === key) out.push(`${base}.${childKey}{value}`);
      exactPaths(child, key, `${base}.${childKey}`, out);
    }
    return out;
  }
  if (value === key) out.push(`${base}{value}`);
  return out;
}


function substringPaths(value, key, base = '$', out = []) {
  if (typeof value === 'string') {
    if (value.includes(key)) out.push(base);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => substringPaths(child, key, `${base}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) substringPaths(child, key, `${base}.${childKey}`, out);
  }
  return out;
}

function purgeArray(value, key) {
  if (!Array.isArray(value)) return false;
  const next = value.filter(item => item !== key && !(item && typeof item === 'object' && (item.sheetKey === key || item.key === key || item.targetSheetKey === key || item.sheet === key)));
  const changed = next.length !== value.length;
  if (changed) {
    value.length = 0;
    value.push(...next);
  }
  for (const child of value) {
    if (child && typeof child === 'object') purgeRecord(child, key);
  }
  return changed;
}

function purgeRuntimeRevision(value, key) {
  if (typeof value !== 'string' || !value.startsWith('runtime-v1:')) return { value, changed: false };
  try {
    const snapshot = JSON.parse(value.slice('runtime-v1:'.length));
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.sheets || typeof snapshot.sheets !== 'object' || !Object.hasOwn(snapshot.sheets, key)) {
      return { value, changed: false };
    }
    delete snapshot.sheets[key];
    return { value: `runtime-v1:${JSON.stringify(snapshot)}`, changed: true };
  } catch {
    return { value, changed: false };
  }
}

function purgeEntryRevisions(entry, key) {
  let changed = false;
  for (const field of ['baseRevision', 'parentRevision']) {
    const result = purgeRuntimeRevision(entry?.[field], key);
    if (result.changed) {
      entry[field] = result.value;
      changed = true;
    }
  }
  return changed;
}


function purgeRecord(value, key) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return purgeArray(value, key);
  let changed = false;
  if (Object.hasOwn(value, key)) {
    delete value[key];
    changed = true;
  }
  for (const childKey of Object.keys(value)) {
    const child = value[childKey];
    if (child && typeof child === 'object') changed = purgeRecord(child, key) || changed;
  }
  return changed;
}

function otherSheetKeyCount(value, key) {
  const keys = new Set();
  (function walk(node) {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [childKey, child] of Object.entries(node)) {
      if (childKey.startsWith('sheet_') && childKey !== key) keys.add(childKey);
      walk(child);
    }
  })(value);
  return keys.size;
}

function purgeMessageLikeCurrentManual(value, key) {
  let changed = false;
  const isolated = value?.TavernDB_ACU_IsolatedData;
  if (!isolated || typeof isolated !== 'object' || Array.isArray(isolated)) return false;
  for (const tagData of Object.values(isolated)) {
    const frame = tagData && typeof tagData === 'object' ? tagData.storageFrame : null;
    if (!frame || typeof frame !== 'object') continue;
    if (frame.checkpoint?.manualRefillProgress) changed = purgeRecord(frame.checkpoint.manualRefillProgress, key) || changed;
    if (frame.manualRefillProgress) changed = purgeRecord(frame.manualRefillProgress, key) || changed;
    if (Array.isArray(frame.logEntries)) {
      for (const entry of frame.logEntries) {
        changed = purgeRecord(entry, key) || changed;
        changed = purgeEntryRevisions(entry, key) || changed;
      }
    }
  }
  return changed;
}


function defaultOutputPath(input) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${input}.diagnostic-copy.${ts}.jsonl`;
}

function buildCandidateSets(messages, key) {
  const exactCandidates = messages.filter(item => exactPaths(item.obj, key).length > 0).slice(-3);
  const substringOnlyCandidates = messages
    .filter(item => exactPaths(item.obj, key).length === 0 && substringPaths(item.obj, key).length > 0)
    .slice(-5);
  const byLine = new Map();
  for (const item of [...exactCandidates, ...substringOnlyCandidates]) byLine.set(item.line, item);
  return {
    exactCandidates,
    substringOnlyCandidates,
    candidates: Array.from(byLine.values()).sort((a, b) => a.line - b.line),
  };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.input)) throw new Error(`Input file not found: ${args.input}`);
  const output = args.output || defaultOutputPath(args.input);
  assertSafeOutput(args.input, output);
  if (args.report) assertSafeOutput(args.input, args.report);

  const originalHashBefore = sha(args.input);
  const messages = loadJsonl(args.input);
  const { exactCandidates, substringOnlyCandidates, candidates } = buildCandidateSets(messages, args.targetKey);
  const report = {
    input: args.input,
    output,
    targetKey: args.targetKey,
    originalHashBefore,
    exactCandidateLines: exactCandidates.map(item => item.line),
    substrOnlyRecentLines: substringOnlyCandidates.map(item => item.line),
    candidateLines: candidates.map(item => item.line),
    before: {
      fileExactCount: messages.reduce((sum, item) => sum + exactPaths(item.obj, args.targetKey).length, 0),
      fileSubstringFieldCount: messages.reduce((sum, item) => sum + substringPaths(item.obj, args.targetKey).length, 0),
      candidates: candidates.map(item => ({
        line: item.line,
        exactCount: exactPaths(item.obj, args.targetKey).length,
        substringFields: substringPaths(item.obj, args.targetKey).slice(0, 8),
        exactPaths: exactPaths(item.obj, args.targetKey).slice(0, 12),
        otherSheets: otherSheetKeyCount(item.obj, args.targetKey),
      })),
    },
    simulatedManualCleanup: [],
  };

  const outputMessages = messages.map(item => ({ line: item.line, obj: clone(item.obj) }));
  const candidateLines = new Set(candidates.map(item => item.line));
  for (const item of outputMessages) {
    if (!candidateLines.has(item.line)) continue;
    const changed = purgeMessageLikeCurrentManual(item.obj, args.targetKey);
    report.simulatedManualCleanup.push({
      line: item.line,
      changed,
      afterExactCount: exactPaths(item.obj, args.targetKey).length,
      afterSubstringFields: substringPaths(item.obj, args.targetKey).length,
      otherSheets: otherSheetKeyCount(item.obj, args.targetKey),
    });
  }

  fs.writeFileSync(output, outputMessages.map(item => JSON.stringify(item.obj)).join('\n') + '\n', 'utf8');
  const after = loadJsonl(output);
  const originalHashAfter = sha(args.input);
  report.afterCopy = {
    fileExactCount: after.reduce((sum, item) => sum + exactPaths(item.obj, args.targetKey).length, 0),
    fileSubstringFieldCount: after.reduce((sum, item) => sum + substringPaths(item.obj, args.targetKey).length, 0),
    originalHashAfter,
    copyHash: sha(output),
    originalUntouched: originalHashBefore === originalHashAfter,
  };

  const json = JSON.stringify(report, null, 2);
  if (args.report) {
    assertSafeOutput(output, args.report);
    fs.writeFileSync(args.report, json + '\n', 'utf8');
  }
  console.log(json);
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
