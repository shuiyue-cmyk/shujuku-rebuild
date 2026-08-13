#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const root = process.cwd();

// spv3.8.1 still carries several legacy non-v2 import-direction exceptions.
// Keep them as an explicit baseline so this guard can continue enforcing the
// UI v2 rules without requiring an unrelated old-UI/data-layer refactor.
const legacyImportDirectionAllowlist = new Set([
  'src/data/models/chat-message-data.ts',
  'src/data/storage/vector-index-hot-cache.ts',
  'src/data/storage/vector-index-st-files-storage.ts',
  'src/data/storage/vector-index-temp-cache.ts',
  'src/presentation/pages/popup-bindings-data.ts',
  'src/presentation/pages/popup-bindings-worldbook.ts',
]);

const checks = [
  {
    section: 'Import direction checks',
    label: 'service -> presentation',
    dir: 'src/service',
    extensions: new Set(['.ts', '.js']),
    pattern: /from '.*presentation/,
  },
  {
    label: 'data -> service',
    dir: 'src/data',
    extensions: new Set(['.ts', '.js']),
    pattern: /from '.*service/,
    exclude: line => legacyImportDirectionAllowlist.has(line.path),
  },
  {
    label: 'data -> presentation',
    dir: 'src/data',
    extensions: new Set(['.ts', '.js']),
    pattern: /from '.*presentation/,
  },
  {
    label: 'presentation -> data',
    dir: 'src/presentation',
    extensions: new Set(['.ts', '.js']),
    pattern: /from '.*data\//,
    exclude: line => legacyImportDirectionAllowlist.has(line.path),
  },
  {
    label: 'shared -> service',
    dir: 'src/shared',
    extensions: new Set(['.ts', '.js']),
    pattern: /from '.*service/,
  },
  {
    label: 'shared -> data',
    dir: 'src/shared',
    extensions: new Set(['.ts', '.js']),
    pattern: /from '.*data\//,
  },
  {
    section: 'Service UI boundary checks',
    label: 'service showToastr calls',
    dir: 'src/service',
    extensions: new Set(['.ts']),
    pattern: /showToastr_ACU\(/,
    exclude: line => line.path.endsWith('toast-service.ts') || line.text.includes('export function showToastr'),
  },
  {
    label: 'service direct toastr_API usage',
    dir: 'src/service',
    extensions: new Set(['.ts']),
    pattern: /toastr_API_ACU\./,
    exclude: line => line.path.endsWith('toast-service.ts'),
  },
  {
    label: 'service _notifyTableUpdate',
    dir: 'src/service',
    extensions: new Set(['.ts']),
    pattern: /_notifyTableUpdate/,
  },
  {
    label: 'service Visualizer/WindowManager usage',
    dir: 'src/service',
    extensions: new Set(['.ts']),
    pattern: /ACU_Visualizer_Refresh|ACU_WindowManager/,
  },
  {
    label: 'service jQuery DOM usage',
    dir: 'src/service',
    extensions: new Set(['.ts']),
    pattern: /\.find\('|\.find\("|\.find\(`|\.on\('|\.on\("|\.off\('|\.off\("|\.append\(|\.empty\(|\.addClass\(|\.removeClass\(/,
    exclude: line => line.path.endsWith('toast-service.ts'),
  },
  {
    label: 'service DOM API usage',
    dir: 'src/service',
    extensions: new Set(['.ts']),
    pattern: /document\.createElement|document\.getElementById|document\.querySelector/,
    exclude: line => line.path.endsWith('toast-service.ts'),
  },
  {
    label: 'service addEventListener',
    dir: 'src/service',
    extensions: new Set(['.ts']),
    pattern: /addEventListener/,
  },
  {
    label: 'service .innerHTML',
    dir: 'src/service',
    extensions: new Set(['.ts']),
    pattern: /\.innerHTML/,
  },
  {
    label: 'service eventSource.emit',
    dir: 'src/service',
    extensions: new Set(['.ts']),
    pattern: /eventSource\.emit/,
  },
  {
    section: 'Data dependency injection checks',
    label: 'data UI dependency usage',
    dir: 'src/data',
    extensions: new Set(['.ts']),
    pattern: /showToastr|refreshMergedData|_notifyTableUpdate|deleteAllGeneratedEntries|refreshUI|renderUI/,
  },
  {
    section: 'presentation-v2 component control checks',
    label: '_lib hidden checkbox/radio inputs',
    dir: 'src/presentation-v2/components/_lib',
    extensions: new Set(['.vue']),
    pattern: /type=["'](?:checkbox|radio)["']/,
  },
  {
    label: '_lib clipped focusable controls',
    dir: 'src/presentation-v2/components/_lib',
    extensions: new Set(['.vue']),
    pattern: /clip: rect\(0 0 0 0\)|position: absolute; width: 1px; height: 1px/,
  },
  {
    label: 'presentation-v2 pages weighted panel columns',
    dir: 'src/presentation-v2/pages',
    extensions: new Set(['.vue']),
    pattern: /grid-template-columns:.*(?:\d+\.\d+|[2-9]\d*)fr/,
  },
  {
    section: 'presentation-v2 boundary checks (D17 / D21.2)',
    label: 'presentation-v2 -> service/runtime/state-manager (D17, .vue only)',
    dir: 'src/presentation-v2',
    extensions: new Set(['.vue']),
    pattern: /from ['"][^'"]*service\/runtime\/state-manager['"]/,
  },
  {
    label: 'presentation-v2 -> service/* (D17, .vue only)',
    dir: 'src/presentation-v2',
    extensions: new Set(['.vue']),
    pattern: /from ['"][^'"]*\/service\//,
  },
  {
    label: 'presentation-v2 -> presentation/* (D21.2)',
    dir: 'src/presentation-v2',
    extensions: new Set(['.vue', '.ts']),
    pattern: /from ['"][^'"]*\/presentation\/(?!v2)/,
  },
  {
    section: 'presentation-v2 lifecycle checks (D25)',
    label: 'manual UI-open refresh subscriptions',
    dir: 'src/presentation-v2',
    extensions: new Set(['.vue', '.ts']),
    pattern: /useUiOpenRefreshTick|openRefreshTick/,
    exclude: line =>
      line.path === 'src/presentation-v2/components/MainArea.vue'
      || line.path === 'src/presentation-v2/stores/root-shell-store.ts'
      || line.path === 'src/presentation-v2/bootstrap/mount.ts',
  },
];

const artifactChecks = [
  {
    section: 'Build artifact checks',
    label: 'compiled bundle literal Vue deep selectors',
    files: ['index.js', 'dist/index.bundle.js'],
    pattern: /:deep\(|::v-deep|\/deep\//,
  },
];

function listFiles(dir, extensions) {
  const absDir = join(root, dir);

  try {
    if (!statSync(absDir).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const result = [];
  const stack = [absDir];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
      } else if (entry.isFile() && extensions.has(extname(entry.name))) {
        result.push(absPath);
      }
    }
  }

  return result.sort();
}

function extname(fileName) {
  const index = fileName.lastIndexOf('.');
  return index === -1 ? '' : fileName.slice(index);
}

function findMatches(check) {
  const matches = [];

  for (const file of listFiles(check.dir, check.extensions)) {
    const relPath = relative(root, file).replaceAll('\\', '/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    lines.forEach((text, index) => {
      const line = { path: relPath, line: index + 1, text };

      if (text.includes('// arch-ok')) {
        return;
      }

      if (check.exclude?.(line)) {
        return;
      }

      if (check.pattern.test(text)) {
        matches.push(line);
      }
    });
  }

  return matches;
}

function findArtifactMatches(check) {
  const matches = [];

  for (const relPath of check.files) {
    const absPath = join(root, relPath);
    let text;

    try {
      text = readFileSync(absPath, 'utf8');
    } catch {
      matches.push({
        path: relPath,
        line: 1,
        text: '<missing build artifact>',
      });
      continue;
    }

    text.split(/\r?\n/).forEach((lineText, index) => {
      if (check.pattern.test(lineText)) {
        matches.push({
          path: relPath,
          line: index + 1,
          text: lineText,
        });
      }
    });
  }

  return matches;
}

function printMatch(match) {
  console.log(`${match.path}:${match.line}:${match.text}`);
}

console.log('===================================================');
console.log('  Architecture guard checks');
console.log('===================================================');

let total = 0;
let currentSection = '';

for (const check of checks) {
  if (check.section && check.section !== currentSection) {
    currentSection = check.section;
    console.log('');
    console.log(`-- ${currentSection} --`);
    console.log('');
  }

  const matches = findMatches(check);
  total += matches.length;

  if (matches.length > 0) {
    console.log(`[FAIL] ${check.label}: ${matches.length}`);
    matches.forEach(printMatch);
  } else {
    console.log(`[PASS] ${check.label}: 0`);
  }
}

for (const check of artifactChecks) {
  if (check.section && check.section !== currentSection) {
    currentSection = check.section;
    console.log('');
    console.log(`-- ${currentSection} --`);
    console.log('');
  }

  const matches = findArtifactMatches(check);
  total += matches.length;

  if (matches.length > 0) {
    console.log(`[FAIL] ${check.label}: ${matches.length}`);
    matches.forEach(printMatch);
  } else {
    console.log(`[PASS] ${check.label}: 0`);
  }
}

console.log('');
console.log('===================================================');
console.log(`  Total violations: ${total}`);
console.log('===================================================');

if (total > 0) {
  console.log('');
  console.log('Architecture violations found. Build failed.');
  console.log('If a line is a justified exception, add // arch-ok to that line.');
  process.exit(1);
}

console.log('');
console.log('All checks passed.');
