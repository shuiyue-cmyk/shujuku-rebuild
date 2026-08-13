#!/usr/bin/env node
/**
 * scripts/build-index.js
 * 多文件拼接脚本：将第二轮拆分后的 core / ui / features / bootstrap 拼接回 dist/index.bundle.js
 *
 * 使用方法：
 *   node scripts/build-index.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(DIST_DIR, 'index.bundle.js');
const ORIGINAL_FILE = path.join(ROOT, 'index.js');

const buildOrder = [
  'src/core/01_header_and_env.js',
  'src/ui/01_window_system.js',
  'src/core/02_storage_and_profile.js',
  'src/ui/02_shared_editors_and_selectors.js',
  'src/core/03_runtime_api.js',
  'src/ui/03_theme_and_toast.js',
  'src/core/04_shared_helpers.js',
  'src/ui/04_table_selectors.js',
  'src/core/05_core_tail.js',
  // features/01 拆分出的子模块（按原始顺序排列）
  'src/features/startup/01_ready_and_menu.js',
  'src/features/import/01_import_cleanup.js',
  'src/features/import/02_import_lorebook_snapshot.js',
  'src/features/import/03_import_processing.js',
  'src/features/worldbook/01_plot_worldbook.js',
  'src/features/worldbook/02_selection_support.js',
  'src/features/worldbook/03_worldbook_list.js',
  // main_popup 在原始 index.js 中位于 features/01 之后
  'src/ui/05_main_popup.js',
  // features/02 拆分出的子模块（按原始顺序排列）
  'src/features/runtime/01_runtime_state.js',
  'src/features/worldbook/04_pipeline_core.js',
  'src/features/ai/01_prompt_prepare.js',
  'src/features/ai/02_api_call.js',
  'src/features/table/01_update_process.js',
  'src/features/summary/01_summary_logic.js',
  'src/features/ui/01_update_trigger.js',
  'src/features/data/01_data_admin.js',
  // features/03 拆分出的子模块（按原始顺序排列）
  'src/ui/06_visualizer.js',
  'src/features/ai/direct_bridge.js',
  'src/03_bootstrap.js',
];

function readNormalized(absPath) {
  return fs.readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n');
}

if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

console.log('[build-index] 开始第三轮拼接(features/01拆分为子模块)...');
console.log(`[build-index] 输出文件: ${OUT_FILE}`);

const parts = buildOrder.map((relPath) => {
  const absPath = path.join(ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    console.error(`[build-index] ✗ 文件不存在: ${relPath}`);
    process.exit(1);
  }
  const content = readNormalized(absPath);
  const lineCount = content.split('\n').length;
  console.log(`[build-index]   ✓ ${relPath}: ${lineCount} 行`);
  return content;
});

const result = parts.join('\n');
fs.writeFileSync(OUT_FILE, result, 'utf8');

const outLines = result.split('\n').length;
console.log(`[build-index] 输出文件已写入: ${OUT_FILE}`);
console.log(`[build-index] 总行数: ${outLines}`);

if (fs.existsSync(ORIGINAL_FILE)) {
  const orig = readNormalized(ORIGINAL_FILE);
  const origLines = orig.split('\n').length;
  if (result === orig) {
    console.log('[build-index] ✓ 拼接结果与原始 index.js 完全一致');
  } else {
    console.log('[build-index] ✗ 拼接结果与原始 index.js 不一致');
    console.log(`[build-index]   原始: ${origLines} 行`);
    console.log(`[build-index]   拼接: ${outLines} 行`);
    console.log(`[build-index]   差异: ${outLines - origLines} 行`);

    const origLinesArr = orig.split('\n');
    const outLinesArr = result.split('\n');
    for (let i = 0; i < Math.max(origLinesArr.length, outLinesArr.length); i++) {
      if (origLinesArr[i] !== outLinesArr[i]) {
        console.log(`[build-index]   首次差异在第 ${i + 1} 行`);
        console.log(`[build-index]   原始: ${JSON.stringify(origLinesArr[i])}`);
        console.log(`[build-index]   拼接: ${JSON.stringify(outLinesArr[i])}`);
        break;
      }
    }
    process.exitCode = 1;
  }
} else {
  console.log('[build-index] ⚠ 未找到原始 index.js，跳过比对');
}

console.log('[build-index] 完成');
