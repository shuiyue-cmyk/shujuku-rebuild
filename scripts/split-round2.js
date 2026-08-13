#!/usr/bin/env node
/**
 * 第二轮激进拆分脚本：
 * - 在保持原始拼接顺序不变的前提下，把 UI 相关块拆到 src/ui/
 * - 同时把非 UI 块拆到 src/core/ 与 src/features/
 * - 最终仍然要求拼接结果与 index.js（标准化为 LF 后）完全一致
 *
 * 当前策略：严格按“连续行区间”切片，避免重排执行时序。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function abs(relPath) {
  return path.join(ROOT, relPath);
}

function readNormalized(relPath) {
  return fs.readFileSync(abs(relPath), 'utf8').replace(/\r\n/g, '\n');
}

function readLines(relPath) {
  return readNormalized(relPath).split('\n');
}

function ensureParentDir(relPath) {
  fs.mkdirSync(path.dirname(abs(relPath)), { recursive: true });
}

function sliceLines(lines, start, end, label) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lines.length) {
    throw new Error(`[split-round2] Invalid range for ${label}: ${start}-${end} (total ${lines.length})`);
  }
  return lines.slice(start - 1, end).join('\n');
}

function verifyContiguous(parts, totalLines, source) {
  const sorted = [...parts].sort((a, b) => a.start - b.start);
  let expected = 1;
  for (const part of sorted) {
    if (part.start !== expected) {
      throw new Error(`[split-round2] ${source} has gap/overlap before ${part.out}: expected line ${expected}, got ${part.start}`);
    }
    expected = part.end + 1;
  }
  if (expected !== totalLines + 1) {
    throw new Error(`[split-round2] ${source} does not fully cover source: stopped at ${expected - 1}, total ${totalLines}`);
  }
}

function findFirstDiffLine(a, b) {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) {
      return {
        line: i + 1,
        a: aLines[i],
        b: bLines[i],
      };
    }
  }
  return null;
}

const SOURCE_CORE = 'src/01_core.js';
const SOURCE_FEATURES = 'src/02_features.js';
const SOURCE_BOOTSTRAP = 'src/03_bootstrap.js';
const SOURCE_ORIGINAL = 'index.js';

const coreLines = readLines(SOURCE_CORE);
const featureLines = readLines(SOURCE_FEATURES);

const PARTS = [
  // =========================
  // src/01_core.js -> core/ui
  // =========================
  {
    source: SOURCE_CORE,
    start: 1,
    end: 67,
    out: 'src/core/01_header_and_env.js',
    note: 'UserScript头 / IIFE开头 / 环境与基础常量',
  },
  {
    source: SOURCE_CORE,
    start: 68,
    end: 957,
    out: 'src/ui/01_window_system.js',
    note: '独立窗口系统与基础主题切换',
  },
  {
    source: SOURCE_CORE,
    start: 958,
    end: 6103,
    out: 'src/core/02_storage_and_profile.js',
    note: '存储键 / 配置后端 / profile / 默认配置前半段',
  },
  {
    source: SOURCE_CORE,
    start: 6104,
    end: 6655,
    out: 'src/ui/02_shared_editors_and_selectors.js',
    note: '共享编辑器 / 剧情任务编辑器 / 通用界面渲染器',
  },
  {
    source: SOURCE_CORE,
    start: 6656,
    end: 9116,
    out: 'src/core/03_runtime_api.js',
    note: '共享运行时 / API挂载 / 非视觉逻辑',
  },
  {
    source: SOURCE_CORE,
    start: 9117,
    end: 9443,
    out: 'src/ui/03_theme_and_toast.js',
    note: 'Toast 主题与通知展示',
  },
  {
    source: SOURCE_CORE,
    start: 9444,
    end: 17902,
    out: 'src/core/04_shared_helpers.js',
    note: '共享 helper / 运行时工具 / 非 UI 逻辑',
  },
  {
    source: SOURCE_CORE,
    start: 17903,
    end: 18079,
    out: 'src/ui/04_table_selectors.js',
    note: '手动更新 / 导入表格选择器 UI',
  },
  {
    source: SOURCE_CORE,
    start: 18080,
    end: 21222,
    out: 'src/core/05_core_tail.js',
    note: 'core 尾段与 ready 边界',
  },

  // =========================
  // src/02_features.js -> features/ui/features/ui/features
  // =========================
  {
    source: SOURCE_FEATURES,
    start: 1,
    end: 1343,
    out: 'src/features/01_features_head.js',
    note: '主弹窗之前的非 UI 业务逻辑',
  },
  {
    source: SOURCE_FEATURES,
    start: 1344,
    end: 7077,
    out: 'src/ui/05_main_popup.js',
    note: '主弹窗 UI 与事件装配',
  },
  {
    source: SOURCE_FEATURES,
    start: 7078,
    end: 11266,
    out: 'src/features/02_features_middle.js',
    note: '主弹窗与 visualizer 之间的非 UI 业务逻辑',
  },
  {
    source: SOURCE_FEATURES,
    start: 11267,
    end: 14021,
    out: 'src/ui/06_visualizer.js',
    note: '可视化编辑器 CSS / 状态 / 打开逻辑 / 渲染逻辑 / 保存逻辑',
  },
  {
    source: SOURCE_FEATURES,
    start: 14022,
    end: 14057,
    out: 'src/features/03_features_tail.js',
    note: 'visualizer 之后的尾段业务逻辑',
  },
];

const BUILD_ORDER = [
  'src/core/01_header_and_env.js',
  'src/ui/01_window_system.js',
  'src/core/02_storage_and_profile.js',
  'src/ui/02_shared_editors_and_selectors.js',
  'src/core/03_runtime_api.js',
  'src/ui/03_theme_and_toast.js',
  'src/core/04_shared_helpers.js',
  'src/ui/04_table_selectors.js',
  'src/core/05_core_tail.js',
  'src/features/01_features_head.js',
  'src/ui/05_main_popup.js',
  'src/features/02_features_middle.js',
  'src/ui/06_visualizer.js',
  'src/features/03_features_tail.js',
  SOURCE_BOOTSTRAP,
];

console.log('[split-round2] 开始第二轮拆分...');
console.log(`[split-round2] 源文件: ${SOURCE_CORE}, ${SOURCE_FEATURES}, ${SOURCE_BOOTSTRAP}`);

verifyContiguous(
  PARTS.filter(part => part.source === SOURCE_CORE),
  coreLines.length,
  SOURCE_CORE,
);
verifyContiguous(
  PARTS.filter(part => part.source === SOURCE_FEATURES),
  featureLines.length,
  SOURCE_FEATURES,
);

for (const part of PARTS) {
  const sourceLines = part.source === SOURCE_CORE ? coreLines : featureLines;
  const content = sliceLines(sourceLines, part.start, part.end, part.out);
  ensureParentDir(part.out);
  fs.writeFileSync(abs(part.out), content, 'utf8');
  console.log(
    `[split-round2] ✓ ${part.out} <- ${part.source}:${part.start}-${part.end} (${part.end - part.start + 1} 行)`,
  );
}

const rebuilt = BUILD_ORDER.map(relPath => readNormalized(relPath)).join('\n');
const original = readNormalized(SOURCE_ORIGINAL);

console.log(`[split-round2] 构建顺序文件数: ${BUILD_ORDER.length}`);
console.log(`[split-round2] 重建总行数: ${rebuilt.split('\n').length}`);
console.log(`[split-round2] 原始总行数: ${original.split('\n').length}`);

if (rebuilt === original) {
  console.log('[split-round2] ✓ 第二轮拆分后的拼接结果与 index.js 完全一致');
} else {
  console.error('[split-round2] ✗ 第二轮拆分后的拼接结果与 index.js 不一致');
  const diff = findFirstDiffLine(rebuilt, original);
  if (diff) {
    console.error(`[split-round2] 首次差异行: ${diff.line}`);
    console.error(`[split-round2] rebuilt : ${JSON.stringify(diff.a)}`);
    console.error(`[split-round2] original: ${JSON.stringify(diff.b)}`);
  }
  process.exitCode = 1;
}

console.log('[split-round2] 完成');
