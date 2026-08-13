#!/usr/bin/env node
/**
 * scripts/split-round3-step2.js
 * 第三轮第2步：将 features/02_features_middle.js (4189行) 拆分为8个功能域子模块
 *
 * 拆分方案（基于函数签名精确行号）：
 *   1. runtime:            行1-241      (updateCardUpdateStatusDisplay_ACU)
 *   2. worldbook_pipeline: 行242-585    (loadAllChatMessages ~ getCombinedWorldbookContent)
 *   3. ai/prompt:          行586-589    (prepareAIInput_ACU)
 *   4. ai/api:             行590-2121   (callCustomOpenAI_ACU ~ parseAndApplyTableEdits_ACU)
 *   5. table_update:       行2122-2364   (processUpdates_ACU)
 *   6. summary:            行2365-2728   (checkAndTriggerAutoMergeSummary ~ performAutoMergeSummary)
 *   7. ui/trigger:         行2729-3449   (proceedWithCardUpdate ~ handleManualUpdateCard)
 *   8. data_admin:         行3450-4185   (exportCombinedSettings ~ importTableTemplate)
 *   附加: ai/direct_bridge (features/03, 36行)
 *
 * 使用方法：node scripts/split-round3-step2.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_FEATURES = path.join(ROOT, 'src', 'features');

// 子模块定义：[输出路径, 起始行(1-based), 结束行(1-based), 功能描述]
const subModules = [
  ['src/features/runtime/01_runtime_state.js',       1,    241,   '运行时状态与消息加载'],
  ['src/features/worldbook/04_pipeline_core.js',   242,   585,   '世界书内容构建管道'],
  ['src/features/ai/01_prompt_prepare.js',          586,   589,   'AI输入准备'],
  ['src/features/ai/02_api_call.js',               590,  2121,   'AI API调用与TableEdit解析'],
  ['src/features/table/01_update_process.js',    2122,  2364,   '表格批量更新流程'],
  ['src/features/summary/01_summary_logic.js',    2365,  2728,   '自动合并总结逻辑'],
  ['src/features/ui/01_update_trigger.js',        2729,  3449,  'UI更新触发器'],
  ['src/features/data/01_data_admin.js',           3450,  4189,  '数据导入导出管理'],
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const sourceFile = path.join(SRC_FEATURES, '02_features_middle.js');
const sourceContent = fs.readFileSync(sourceFile, 'utf8').replace(/\r\n/g, '\n');
const sourceLines = sourceContent.split('\n');

let success = true;
for (const [outRelPath, startLine, endLine, desc] of subModules) {
  const slice = sourceLines.slice(startLine - 1, endLine);
  const outAbsPath = path.join(ROOT, outRelPath);
  const expected = endLine - startLine + 1;

  if (slice.length !== expected) {
    console.error(`[split-round3-step2] ✗ ${outRelPath}: 期望${expected}行，实际${slice.length}行`);
    success = false;
    continue;
  }

  ensureDir(path.dirname(outAbsPath));
  fs.writeFileSync(outAbsPath, slice.join('\n'), 'utf8');
  console.log(`[split-round3-step2] ✓ ${outRelPath} (${slice.length} 行)`);
}

// features/03 → ai/direct_bridge
const source03 = path.join(SRC_FEATURES, '03_features_tail.js');
const content03 = fs.readFileSync(source03, 'utf8').replace(/\r\n/g, '\n');
const lines03 = content03.split('\n');
const out03Path = path.join(ROOT, 'src/features/ai/direct_bridge.js');
ensureDir(path.dirname(out03Path));
fs.writeFileSync(out03Path, content03, 'utf8');
console.log(`[split-round3-step2] ✓ src/features/ai/direct_bridge.js (${lines03.length} 行)`);

if (success) {
  console.log('\n[split-round3-step2] 所有子模块拆分完成！');
} else {
  process.exit(1);
}
