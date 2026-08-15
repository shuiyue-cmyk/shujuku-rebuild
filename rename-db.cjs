// rename-db.cjs — SP·数据库 → 幻想·数据库（去版本后缀）
const fs = require('fs');
const targets = [
  'README.md',
  'manifest.json',
  'index.js',
  'source/package.json',
  'source/src/presentation/theme/toast.ts',
  'source/src/presentation/triggers/settings-ui-sync/settings-ui-api.ts',
  'source/src/shared/defaults.ts',
  'source/src/shared/runtime-env.ts',
  'source/src/presentation-v2/components/Sidebar.vue',
  'source/src/presentation-v2/bootstrap/menu-button.ts',
  'source/src/presentation-v2/App.vue',
  'source/tests/presentation-v2/bootstrap/mount.test.ts',
];
const replacements = [
  [/SP·数据库(?: [IVX]+|（重构版）|\(重构版\))?/g, '幻想·数据库'],
  [/SP 数据库/g, '幻想·数据库'],
];
let total = 0;
for (const file of targets) {
  if (!fs.existsSync(file)) { console.log('SKIP (not found):', file); continue; }
  let c = fs.readFileSync(file, 'utf8');
  const before = c;
  for (const [re, rep] of replacements) c = c.replace(re, rep);
  if (c !== before) {
    fs.writeFileSync(file, c, 'utf8');
    const count = (before.match(/SP·数据库/g) || []).length;
    total += count;
    console.log('UPDATED:', file, `(${count} 处)`);
  } else {
    console.log('NO CHANGE:', file);
  }
}
console.log('TOTAL replacements:', total);
