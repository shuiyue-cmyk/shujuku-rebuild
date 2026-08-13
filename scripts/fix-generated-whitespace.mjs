import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactPaths = [
  path.join(process.cwd(), 'dist', 'index.bundle.js'),
  path.join(process.cwd(), 'index.js'),
];

function updateState(line, state) {
  let s = state;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (s === 'lineComment') break;
    if (s === 'blockComment') {
      if (ch === '*' && next === '/') { s = 'code'; i += 1; }
      continue;
    }
    if (s === 'single' || s === 'double' || s === 'template') {
      const quote = s === 'single' ? "'" : s === 'double' ? '"' : '`';
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) s = 'code';
      continue;
    }
    if (ch === '/' && next === '/') { s = 'lineComment'; break; }
    if (ch === '/' && next === '*') { s = 'blockComment'; i += 1; continue; }
    if (ch === "'") s = 'single';
    else if (ch === '"') s = 'double';
    else if (ch === '`') s = 'template';
  }
  return s === 'lineComment' ? 'code' : s;
}

export function normalizeGeneratedWhitespace_ACU(input) {
  let fixedIndentLineCount = 0;
  let fixedClosingLineCount = 0;
  let fixedTrailingWhitespaceLineCount = 0;
  let state = 'code';
  const lines = String(input).split(/(\r?\n)/);
  for (let i = 0; i < lines.length; i += 2) {
    const originalLine = lines[i];
    let line = originalLine;
    if (state === 'code') {
      line = line.replace(/^( +)(\t+)/, (_match, _spaces, tabs) => {
        fixedIndentLineCount += 1;
        return tabs;
      });
      line = line.replace(/^([\t ]*[})\];,]+) +$/, (_match, code) => {
        fixedClosingLineCount += 1;
        return code;
      });
      line = line.replace(/[\t ]+$/, match => {
        fixedTrailingWhitespaceLineCount += 1;
        return '';
      });
    }
    lines[i] = line;
    state = updateState(originalLine, state);
  }
  return {
    text: lines.join(''),
    fixedIndentLineCount,
    fixedClosingLineCount,
    fixedTrailingWhitespaceLineCount,
  };
}

function runCli() {
  let fixedIndentLineCount = 0;
  let fixedClosingLineCount = 0;
  let fixedTrailingWhitespaceLineCount = 0;
  for (const artifactPath of artifactPaths) {
    if (!fs.existsSync(artifactPath)) continue;
    const original = fs.readFileSync(artifactPath, 'utf8');
    const result = normalizeGeneratedWhitespace_ACU(original);
    fixedIndentLineCount += result.fixedIndentLineCount;
    fixedClosingLineCount += result.fixedClosingLineCount;
    fixedTrailingWhitespaceLineCount += result.fixedTrailingWhitespaceLineCount;
    if (result.text !== original) fs.writeFileSync(artifactPath, result.text, 'utf8');
  }
  console.log(
    `[fix-generated-whitespace] normalized ${fixedIndentLineCount} generated indentation line(s), `
    + `${fixedClosingLineCount} generated closing line(s), `
    + `${fixedTrailingWhitespaceLineCount} generated trailing-whitespace line(s).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runCli();
