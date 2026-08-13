/**
 * table-defaults/index.js — 默认表模板组装入口
 *
 * 将 8 张表 + mate 元数据组装为消费端期望的双重编码 JSON 字符串。
 * 格式：`"{ ... }"` —— 外层引号包裹的 JSON 字符串。
 *
 * 消费端（parseTableTemplateJson_ACU）会先 JSON.parse 去掉外层引号得到内层 JSON 字符串，
 * 再 JSON.parse 得到最终对象。这里的组装逻辑精确复现这个格式。
 */
import { globalStateSheet } from './global-state.js';
import { protagonistInfoSheet } from './protagonist-info.js';
import { importantCharsSheet } from './important-chars.js';
import { protagonistSkillsSheet } from './protagonist-skills.js';
import { inventorySheet } from './inventory.js';
import { questsEventsSheet } from './quests-events.js';
import { chronicleSheet } from './chronicle.js';
import { optionsSheet } from './options.js';
import { mateConfig } from './mate.js';
import { romanceDefaultSheetOverrides } from './romance-overrides.js';

function cloneTableDefault_ACU(value) {
  return JSON.parse(JSON.stringify(value));
}

function relaxDefaultTableDdlLine_ACU(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return line;
  if (/^CREATE\s+TABLE\b/i.test(trimmed) || isDefaultTableDdlClosingLine_ACU(line)) {
    return line;
  }
  if (/^(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(trimmed)) {
    return null;
  }

  const commentIndex = line.indexOf('--');
  const beforeComment = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const comment = commentIndex >= 0 ? line.slice(commentIndex).trimEnd() : '';
  const comma = /,\s*$/.test(beforeComment) ? ',' : '';
  const columnMatch = beforeComment.trim().match(/^([^\s,()]+)/);
  if (!columnMatch) return line;

  const indentMatch = line.match(/^\s*/);
  const indent = indentMatch ? indentMatch[0] : '';
  const columnName = columnMatch[1];
  const suffix = comment ? `${comma ? ',' : ''} ${comment}` : comma;

  if (columnName.toLowerCase() === 'row_id') {
    return `${indent}row_id INTEGER PRIMARY KEY${suffix}`.trimEnd();
  }

  return `${indent}${columnName} TEXT${suffix}`.trimEnd();
}

function isDefaultTableDdlClosingLine_ACU(line) {
  return /^\)\s*;?\s*(?:--.*)?$/i.test(String(line || '').trim());
}

function removeTrailingCommaFromDdlLine_ACU(line) {
  return String(line || '').replace(/,(\s*(?:--.*)?)$/, '$1').trimEnd();
}

function removeTrailingCommaBeforeDdlClose_ACU(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!isDefaultTableDdlClosingLine_ACU(lines[i])) continue;

    for (let j = i - 1; j >= 0; j -= 1) {
      if (!String(lines[j] || '').trim()) continue;
      lines[j] = removeTrailingCommaFromDdlLine_ACU(lines[j]);
      break;
    }
  }
  return lines;
}

export function relaxDefaultTableDdl_ACU(ddl) {
  if (typeof ddl !== 'string' || !ddl.trim()) return ddl;
  const lines = ddl.split('\n');
  const relaxedLines = [];
  for (const line of lines) {
    const relaxedLine = relaxDefaultTableDdlLine_ACU(line);
    if (relaxedLine !== null) relaxedLines.push(relaxedLine);
  }
  return removeTrailingCommaBeforeDdlClose_ACU(relaxedLines).join('\n');
}

function relaxDefaultTableTemplateObjectDdls_ACU(templateObj) {
  Object.keys(templateObj || {}).forEach((key) => {
    const sheet = templateObj[key];
    if (!sheet?.sourceData || typeof sheet.sourceData.ddl !== 'string') return;
    sheet.sourceData.ddl = relaxDefaultTableDdl_ACU(sheet.sourceData.ddl);
  });
  return templateObj;
}

function buildOriginalDefaultTableTemplateObjectInternal_ACU() {
  return {
    [globalStateSheet.uid]: cloneTableDefault_ACU(globalStateSheet),
    [protagonistInfoSheet.uid]: cloneTableDefault_ACU(protagonistInfoSheet),
    [importantCharsSheet.uid]: cloneTableDefault_ACU(importantCharsSheet),
    [protagonistSkillsSheet.uid]: cloneTableDefault_ACU(protagonistSkillsSheet),
    [inventorySheet.uid]: cloneTableDefault_ACU(inventorySheet),
    [questsEventsSheet.uid]: cloneTableDefault_ACU(questsEventsSheet),
    [chronicleSheet.uid]: cloneTableDefault_ACU(chronicleSheet),
    [optionsSheet.uid]: cloneTableDefault_ACU(optionsSheet),
    mate: cloneTableDefault_ACU(mateConfig)
  };
}

function applyRomanceDefaultOverrides_ACU(base) {
  const overridesByName = new Map(
    Object.values(romanceDefaultSheetOverrides || {})
      .filter(sheet => sheet && typeof sheet === 'object' && sheet.name)
      .map(sheet => [String(sheet.name), sheet])
  );
  Object.keys(base).forEach((sheetKey) => {
    if (sheetKey === 'mate') return;
    const currentSheet = base[sheetKey];
    const overrideSheet = overridesByName.get(String(currentSheet?.name || ''));
    if (!overrideSheet) return;
    const nextSheet = cloneTableDefault_ACU(overrideSheet);
    nextSheet.uid = currentSheet.uid || sheetKey;
    nextSheet.orderNo = currentSheet.orderNo ?? nextSheet.orderNo;
    base[sheetKey] = nextSheet;
  });
  return base;
}

/**
 * 构建原始默认表模板对象（普通 JS 对象，未序列化）。
 * 该模板保留 8 张原默认表，仅放宽 DDL 约束，供旧用户已保存模板继续使用。
 */
export function buildOriginalDefaultTableTemplateObject_ACU() {
  return relaxDefaultTableTemplateObjectDdls_ACU(buildOriginalDefaultTableTemplateObjectInternal_ACU());
}

/**
 * 构建当前默认表模板对象（普通 JS 对象，未序列化）。
 * 当前默认以原默认 8 张表为基础，同名表使用恋爱特化表内容覆盖，不引入恋爱表新增表。
 */
export function buildDefaultTableTemplateObject_ACU() {
  return relaxDefaultTableTemplateObjectDdls_ACU(
    applyRomanceDefaultOverrides_ACU(buildOriginalDefaultTableTemplateObjectInternal_ACU())
  );
}

export function buildOriginalDefaultTableTemplateString_ACU() {
  const obj = buildOriginalDefaultTableTemplateObject_ACU();
  const innerJson = JSON.stringify(obj, null, 2);
  return JSON.stringify(innerJson);
}

/**
 * 构建默认表模板的双重编码 JSON 字符串
 *
 * 返回格式：`"{ ... }"` —— 与原 DEFAULT_TABLE_TEMPLATE_ACU 完全一致的格式。
 * 消费端 parseTableTemplateJson_ACU 期望首尾有双引号。
 */
export function buildDefaultTableTemplateString_ACU() {
  const obj = buildDefaultTableTemplateObject_ACU();
  // JSON.stringify 生成内层 JSON，再用 JSON.stringify 包一层引号
  const innerJson = JSON.stringify(obj, null, 2);
  return JSON.stringify(innerJson);
}

// 导出所有单表定义，方便外部按需引用
export {
  globalStateSheet,
  protagonistInfoSheet,
  importantCharsSheet,
  protagonistSkillsSheet,
  inventorySheet,
  questsEventsSheet,
  chronicleSheet,
  optionsSheet,
  mateConfig
};
