/**
 * tests/shared/utils.test.ts
 * 通用工具函数 单元测试
 */
import { describe, it, expect, vi } from 'vitest';

// mock defaults-json.js（TABLE_TEMPLATE_ACU）
vi.mock('../../src/shared/defaults-json.js', () => ({
  TABLE_TEMPLATE_ACU: JSON.stringify({
    sheet_0: {
      name: '测试表',
      content: [['row_id', '列A'], ['1', 'https://example.com/a//b?x=1#hash'], ['2', '包含 /* 不是注释 */ 与 // 文本']],
    },
  }),
}));

// mock constants
vi.mock('../../src/shared/constants', () => ({
  DEBUG_MODE_ACU: false,
  SCRIPT_ID_PREFIX_ACU: 'ACU',
  TABLE_ORDER_FIELD_ACU: '_acu_order_',
}));

// mock json-helpers
vi.mock('../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (str: string, fallback: any = null) => {
    try { return JSON.parse(str); } catch { return fallback; }
  },
  safeJsonParseWithJsoncComments_ACU: (str: string, fallback: any = null) => {
    try { return JSON.parse(str); } catch { return fallback; }
  },
}));

import {
  cleanChatName_ACU,
  deepMerge_ACU,
  lightenDarkenColor_ACU,
  getContrastYIQ_ACU,
  escapeRegExp_ACU,
  hashUserInput_ACU,
  normalizeNonNegativeInteger_ACU,
  normalizePositiveInteger_ACU,
  isSummaryOrOutlineTable_ACU,
  isStandardTable_ACU,
  buildBoundaryRulesFromLegacyTags_ACU,
  normalizeExcludeRules_ACU,
  stripSeedRowsFromTemplate_ACU,
  applySheetOrderNumbers_ACU,
  ensureSheetOrderNumbers_ACU,
  getChatFirstLayerMessage_ACU,
  cloneScopedConfigData_ACU,
  formatPlotScopeUpdatedAt_ACU,
  isEntryBlocked_ACU,
  logDebug_ACU,
  logWarn_ACU,
  logError_ACU,
  normalizeExtractRules_ACU,
  parseTableTemplateJson_ACU,
} from '../../src/shared/utils';
import {
  _resetForTesting as resetLogBufferForTesting,
  getAllLogs,
  setWarnLogEnabled,
  subscribe,
} from '../../src/shared/log-buffer';

// ═══════════════════════════════════════════════════════════════
// cleanChatName_ACU
// ═══════════════════════════════════════════════════════════════
describe('cleanChatName_ACU', () => {
  it('去除路径前缀', () => {
    expect(cleanChatName_ACU('/path/to/chat.jsonl')).toBe('chat');
  });

  it('去除 .jsonl 扩展名', () => {
    expect(cleanChatName_ACU('chat.jsonl')).toBe('chat');
  });

  it('去除 .json 扩展名', () => {
    expect(cleanChatName_ACU('chat.json')).toBe('chat');
  });

  it('Windows 路径', () => {
    expect(cleanChatName_ACU('C:\\Users\\test\\chat.jsonl')).toBe('chat');
  });

  it('空字符串返回默认值', () => {
    expect(cleanChatName_ACU('')).toBe('unknown_chat_source');
  });

  it('null 返回默认值', () => {
    expect(cleanChatName_ACU(null as any)).toBe('unknown_chat_source');
  });

  it('非字符串返回默认值', () => {
    expect(cleanChatName_ACU(123 as any)).toBe('unknown_chat_source');
  });

  it('无扩展名原样返回', () => {
    expect(cleanChatName_ACU('chatname')).toBe('chatname');
  });
});

// ═══════════════════════════════════════════════════════════════
// deepMerge_ACU
// ═══════════════════════════════════════════════════════════════
describe('deepMerge_ACU', () => {
  it('浅层合并', () => {
    expect(deepMerge_ACU({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('source 覆盖 target 同名属性', () => {
    expect(deepMerge_ACU({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  it('深层嵌套合并', () => {
    const target = { a: { b: 1, c: 2 } };
    const source = { a: { b: 3, d: 4 } };
    expect(deepMerge_ACU(target, source)).toEqual({ a: { b: 3, c: 2, d: 4 } });
  });

  it('数组不合并，直接覆盖', () => {
    expect(deepMerge_ACU({ a: [1, 2] }, { a: [3, 4] })).toEqual({ a: [3, 4] });
  });

  it('target 中不存在的嵌套对象直接赋值', () => {
    expect(deepMerge_ACU({}, { a: { b: 1 } })).toEqual({ a: { b: 1 } });
  });

  it('不修改原始对象', () => {
    const target = { a: 1 };
    const source = { b: 2 };
    deepMerge_ACU(target, source);
    expect(target).toEqual({ a: 1 });
  });
});

// ═══════════════════════════════════════════════════════════════
// lightenDarkenColor_ACU
// ═══════════════════════════════════════════════════════════════
describe('lightenDarkenColor_ACU', () => {
  it('加亮颜色', () => {
    const result = lightenDarkenColor_ACU('#000000', 50);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
    expect(result).not.toBe('#000000');
  });

  it('减暗颜色', () => {
    const result = lightenDarkenColor_ACU('#ffffff', -50);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
    expect(result).not.toBe('#ffffff');
  });

  it('不超过 255 上限', () => {
    const result = lightenDarkenColor_ACU('#ffffff', 100);
    expect(result).toBe('#ffffff');
  });

  it('不低于 0 下限', () => {
    const result = lightenDarkenColor_ACU('#000000', -100);
    expect(result).toBe('#000000');
  });

  it('无 # 前缀也能处理', () => {
    const result = lightenDarkenColor_ACU('ff0000', 10);
    expect(result).not.toContain('#');
  });
});

// ═══════════════════════════════════════════════════════════════
// getContrastYIQ_ACU
// ═══════════════════════════════════════════════════════════════
describe('getContrastYIQ_ACU', () => {
  it('深色背景返回白色前景', () => {
    expect(getContrastYIQ_ACU('#000000')).toBe('#FFFFFF');
  });

  it('浅色背景返回黑色前景', () => {
    expect(getContrastYIQ_ACU('#ffffff')).toBe('#000000');
  });

  it('无 # 前缀也能处理', () => {
    expect(getContrastYIQ_ACU('000000')).toBe('#FFFFFF');
  });
});

// ═══════════════════════════════════════════════════════════════
// escapeRegExp_ACU
// ═══════════════════════════════════════════════════════════════
describe('escapeRegExp_ACU', () => {
  it('转义正则特殊字符', () => {
    expect(escapeRegExp_ACU('a.b*c?d')).toBe('a\\.b\\*c\\?d');
  });

  it('转义所有特殊字符', () => {
    const special = '.*+?^${}()|[]\\';
    const escaped = escapeRegExp_ACU(special);
    // 每个特殊字符前都应该有反斜杠
    expect(escaped).not.toBe(special);
    // 转义后的字符串可以安全用于 RegExp
    expect(() => new RegExp(escaped)).not.toThrow();
  });

  it('普通字符不变', () => {
    expect(escapeRegExp_ACU('hello')).toBe('hello');
  });
});

// ═══════════════════════════════════════════════════════════════
// hashUserInput_ACU
// ═══════════════════════════════════════════════════════════════
describe('hashUserInput_ACU', () => {
  it('相同输入产生相同哈希', () => {
    expect(hashUserInput_ACU('hello')).toBe(hashUserInput_ACU('hello'));
  });

  it('不同输入产生不同哈希', () => {
    expect(hashUserInput_ACU('hello')).not.toBe(hashUserInput_ACU('world'));
  });

  it('空字符串返回空字符串', () => {
    expect(hashUserInput_ACU('')).toBe('');
  });

  it('null 返回空字符串', () => {
    expect(hashUserInput_ACU(null as any)).toBe('');
  });

  it('前后空格被 trim', () => {
    expect(hashUserInput_ACU('  hello  ')).toBe(hashUserInput_ACU('hello'));
  });

  it('换行符归一化', () => {
    expect(hashUserInput_ACU('a\r\nb')).toBe(hashUserInput_ACU('a\nb'));
  });

  // T0b 依赖：preflight 的 indexId 占位 13 = 'snap_'(5) + 本函数输出上界(8)。
  // 本函数末轮不再 `^=` 截回 32 位，返回值可能为负，toString(36) 会带 `-` 号，
  // 因此上界是 8 而不是 7。若此不变量被破坏（输出更长），
  // preflightVectorIndexSnapshotPath_ACU 的占位将不再是上界，
  // 临界 scope 会通过 preflight 后在 persist 抛错（先烧 embedding 再失败）。
  it('输出长度不超过 8 字符（含负号），保证 V2 路径 preflight 占位为真实上界', () => {
    let maxLength = 0;
    let longestSample = '';
    for (let index = 0; index < 20000; index += 1) {
      // 覆盖真实 indexId 输入形状：chatKey\nisolationKey\nsourceTableKey\nrevision
      const hash = hashUserInput_ACU(`chat-${index}-中文名字\niso-${index % 7}\nsheet_summary\n${(index % 50) + 1}`);
      if (hash.length > maxLength) {
        maxLength = hash.length;
        longestSample = hash;
      }
    }

    expect(maxLength).toBeLessThanOrEqual(8);
    expect(`snap_${longestSample}`.length).toBeLessThanOrEqual(13);
  });

});

// ═══════════════════════════════════════════════════════════════
// normalizeNonNegativeInteger_ACU
// ═══════════════════════════════════════════════════════════════
describe('normalizeNonNegativeInteger_ACU', () => {
  it('正整数原样返回', () => {
    expect(normalizeNonNegativeInteger_ACU(5)).toBe(5);
  });

  it('0 返回 0', () => {
    expect(normalizeNonNegativeInteger_ACU(0)).toBe(0);
  });

  it('浮点数取整', () => {
    expect(normalizeNonNegativeInteger_ACU(3.7)).toBe(3);
  });

  it('负数返回 fallback', () => {
    expect(normalizeNonNegativeInteger_ACU(-1)).toBe(0);
  });

  it('字符串数字转换', () => {
    expect(normalizeNonNegativeInteger_ACU('10')).toBe(10);
  });

  it('非数字返回 fallback', () => {
    expect(normalizeNonNegativeInteger_ACU('abc')).toBe(0);
  });

  it('null 返回 fallback', () => {
    expect(normalizeNonNegativeInteger_ACU(null)).toBe(0);
  });

  it('自定义 fallback', () => {
    expect(normalizeNonNegativeInteger_ACU('abc', 5)).toBe(5);
  });

  it('Infinity 返回 fallback', () => {
    expect(normalizeNonNegativeInteger_ACU(Infinity)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// normalizePositiveInteger_ACU
// ═══════════════════════════════════════════════════════════════
describe('normalizePositiveInteger_ACU', () => {
  it('正整数原样返回', () => {
    expect(normalizePositiveInteger_ACU(5)).toBe(5);
  });

  it('0 返回 fallback（默认 1）', () => {
    expect(normalizePositiveInteger_ACU(0)).toBe(1);
  });

  it('负数返回 fallback', () => {
    expect(normalizePositiveInteger_ACU(-1)).toBe(1);
  });

  it('自定义 fallback', () => {
    expect(normalizePositiveInteger_ACU(0, 3)).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// isSummaryOrOutlineTable_ACU / isStandardTable_ACU
// ═══════════════════════════════════════════════════════════════
describe('isSummaryOrOutlineTable_ACU', () => {
  it('总结表返回 true', () => {
    expect(isSummaryOrOutlineTable_ACU('总结表')).toBe(true);
  });

  it('总体大纲返回 true', () => {
    expect(isSummaryOrOutlineTable_ACU('总体大纲')).toBe(true);
  });

  it('纪要表返回 true', () => {
    expect(isSummaryOrOutlineTable_ACU('纪要表')).toBe(true);
  });

  it('普通表名返回 false', () => {
    expect(isSummaryOrOutlineTable_ACU('背包物品表')).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(isSummaryOrOutlineTable_ACU('')).toBe(false);
  });

  it('null 返回 false', () => {
    expect(isSummaryOrOutlineTable_ACU(null as any)).toBe(false);
  });

  it('前后空格被 trim', () => {
    expect(isSummaryOrOutlineTable_ACU('  总结表  ')).toBe(true);
  });
});

describe('isStandardTable_ACU', () => {
  it('普通表名返回 true', () => {
    expect(isStandardTable_ACU('背包物品表')).toBe(true);
  });

  it('总结表返回 false', () => {
    expect(isStandardTable_ACU('总结表')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// buildBoundaryRulesFromLegacyTags_ACU
// ═══════════════════════════════════════════════════════════════
describe('buildBoundaryRulesFromLegacyTags_ACU', () => {
  it('逗号分隔的标签转为规则', () => {
    const rules = buildBoundaryRulesFromLegacyTags_ACU('tagA,tagB');
    expect(rules).toEqual([
      { start: '<tagA', end: '</tagA>' },
      { start: '<tagB', end: '</tagB>' },
    ]);
  });

  it('中文逗号分隔', () => {
    const rules = buildBoundaryRulesFromLegacyTags_ACU('标签A，标签B');
    expect(rules.length).toBe(2);
  });

  it('空格分隔', () => {
    const rules = buildBoundaryRulesFromLegacyTags_ACU('tagA tagB');
    expect(rules.length).toBe(2);
  });

  it('空字符串返回空数组', () => {
    expect(buildBoundaryRulesFromLegacyTags_ACU('')).toEqual([]);
  });

  it('去除尖括号', () => {
    const rules = buildBoundaryRulesFromLegacyTags_ACU('<tag>');
    expect(rules[0].start).toBe('<tag');
  });
});

// ═══════════════════════════════════════════════════════════════
// normalizeExcludeRules_ACU
// ═══════════════════════════════════════════════════════════════
describe('normalizeExcludeRules_ACU', () => {
  it('对象数组格式', () => {
    const rules = normalizeExcludeRules_ACU([{ start: '<a', end: '</a>' }]);
    expect(rules).toEqual([{ start: '<a', end: '</a>' }]);
  });

  it('字符串格式（管道分隔）', () => {
    const rules = normalizeExcludeRules_ACU(['<a|</a>']);
    expect(rules).toEqual([{ start: '<a', end: '</a>' }]);
  });

  it('去重', () => {
    const rules = normalizeExcludeRules_ACU([
      { start: '<a', end: '</a>' },
      { start: '<a', end: '</a>' },
    ]);
    expect(rules.length).toBe(1);
  });

  it('空数组回退到旧标签', () => {
    const rules = normalizeExcludeRules_ACU([], 'tagA');
    expect(rules.length).toBe(1);
    expect(rules[0].start).toBe('<tagA');
  });

  it('null 规则回退到旧标签', () => {
    const rules = normalizeExcludeRules_ACU(null, 'tagA');
    expect(rules.length).toBe(1);
  });

  it('跳过 null 元素', () => {
    const rules = normalizeExcludeRules_ACU([null, { start: '<a', end: '</a>' }]);
    expect(rules.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// stripSeedRowsFromTemplate_ACU
// ═══════════════════════════════════════════════════════════════
describe('stripSeedRowsFromTemplate_ACU', () => {
  it('保留表头行，移除数据行', () => {
    const template = {
      sheet_0: {
        name: '测试表',
        content: [['row_id', '列A'], ['1', '值A'], ['2', '值B']],
      },
    };
    const result = stripSeedRowsFromTemplate_ACU(template);
    expect(result.sheet_0.content).toEqual([['row_id', '列A']]);
  });

  it('非 sheet_ 开头的键不受影响', () => {
    const template = { other: { content: [['a'], ['b']] } };
    const result = stripSeedRowsFromTemplate_ACU(template);
    expect(result.other.content).toEqual([['a'], ['b']]);
  });

  it('null 输入返回 null', () => {
    expect(stripSeedRowsFromTemplate_ACU(null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// getChatFirstLayerMessage_ACU
// ═══════════════════════════════════════════════════════════════
describe('getChatFirstLayerMessage_ACU', () => {
  it('返回第一条消息', () => {
    expect(getChatFirstLayerMessage_ACU([{ id: 1 }, { id: 2 }])).toEqual({ id: 1 });
  });

  it('空数组返回 null', () => {
    expect(getChatFirstLayerMessage_ACU([])).toBeNull();
  });

  it('非数组返回 null', () => {
    expect(getChatFirstLayerMessage_ACU(null as any)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// cloneScopedConfigData_ACU
// ═══════════════════════════════════════════════════════════════
describe('cloneScopedConfigData_ACU', () => {
  it('深拷贝对象', () => {
    const obj = { a: { b: 1 } };
    const clone = cloneScopedConfigData_ACU(obj);
    expect(clone).toEqual(obj);
    expect(clone).not.toBe(obj);
    expect(clone.a).not.toBe(obj.a);
  });

  it('undefined 返回 fallback', () => {
    expect(cloneScopedConfigData_ACU(undefined)).toBeNull();
    expect(cloneScopedConfigData_ACU(undefined, 'default')).toBe('default');
  });

  it('循环引用返回 fallback', () => {
    const obj: any = {};
    obj.self = obj;
    expect(cloneScopedConfigData_ACU(obj)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// formatPlotScopeUpdatedAt_ACU
// ═══════════════════════════════════════════════════════════════
describe('formatPlotScopeUpdatedAt_ACU', () => {
  it('有效时间戳返回格式化字符串', () => {
    const result = formatPlotScopeUpdatedAt_ACU(1713264000000);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('0 返回空字符串', () => {
    expect(formatPlotScopeUpdatedAt_ACU(0)).toBe('');
  });

  it('null 返回空字符串', () => {
    expect(formatPlotScopeUpdatedAt_ACU(null)).toBe('');
  });

  it('非数字返回空字符串', () => {
    expect(formatPlotScopeUpdatedAt_ACU('abc')).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// isEntryBlocked_ACU
// ═══════════════════════════════════════════════════════════════
describe('isEntryBlocked_ACU', () => {
  it('包含"规则"关键词返回 true', () => {
    expect(isEntryBlocked_ACU({ comment: '系统规则' })).toBe(true);
  });

  it('包含"思维链"关键词返回 true', () => {
    expect(isEntryBlocked_ACU({ comment: '思维链设定' })).toBe(true);
  });

  it('包含"cot"关键词返回 true', () => {
    expect(isEntryBlocked_ACU({ name: 'cot_prompt' })).toBe(true);
  });

  it('包含"MVU"关键词返回 true', () => {
    expect(isEntryBlocked_ACU({ comment: 'MVU系统' })).toBe(true);
  });

  it('普通条目返回 false', () => {
    expect(isEntryBlocked_ACU({ comment: '角色描述' })).toBe(false);
  });

  it('null 返回 false', () => {
    expect(isEntryBlocked_ACU(null)).toBe(false);
  });

  it('空对象返回 false', () => {
    expect(isEntryBlocked_ACU({})).toBe(false);
  });

  it('comment 或 name 不是字符串时不抛错', () => {
    expect(() => isEntryBlocked_ACU({ comment: 2024, name: { invalid: true } })).not.toThrow();
    expect(isEntryBlocked_ACU({ comment: 2024, name: { invalid: true } })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// applySheetOrderNumbers_ACU / ensureSheetOrderNumbers_ACU
// ═══════════════════════════════════════════════════════════════
describe('applySheetOrderNumbers_ACU', () => {
  it('按顺序赋值 order 编号', () => {
    const data: any = {
      sheet_0: { name: 'A' },
      sheet_1: { name: 'B' },
    };
    const result = applySheetOrderNumbers_ACU(data, ['sheet_0', 'sheet_1']);
    expect(result).toBe(true);
    expect(data.sheet_0._acu_order_).toBe(0);
    expect(data.sheet_1._acu_order_).toBe(1);
  });

  it('已有正确编号时返回 false', () => {
    const data: any = {
      sheet_0: { name: 'A', _acu_order_: 0 },
      sheet_1: { name: 'B', _acu_order_: 1 },
    };
    const result = applySheetOrderNumbers_ACU(data, ['sheet_0', 'sheet_1']);
    expect(result).toBe(false);
  });

  it('null 数据返回 false', () => {
    expect(applySheetOrderNumbers_ACU(null as any, [])).toBe(false);
  });
});

describe('ensureSheetOrderNumbers_ACU', () => {
  it('无编号时自动赋值', () => {
    const data: any = {
      sheet_0: { name: 'A' },
      sheet_1: { name: 'B' },
    };
    const result = ensureSheetOrderNumbers_ACU(data);
    expect(result).toBe(true);
    expect(data.sheet_0._acu_order_).toBe(0);
  });

  it('编号合法且不重复时不修改', () => {
    const data: any = {
      sheet_0: { name: 'A', _acu_order_: 0 },
      sheet_1: { name: 'B', _acu_order_: 1 },
    };
    expect(ensureSheetOrderNumbers_ACU(data)).toBe(false);
  });

  it('编号重复时重建', () => {
    const data: any = {
      sheet_0: { name: 'A', _acu_order_: 0 },
      sheet_1: { name: 'B', _acu_order_: 0 },
    };
    expect(ensureSheetOrderNumbers_ACU(data)).toBe(true);
  });

  it('forceRebuild=true 强制重建', () => {
    const data: any = {
      sheet_0: { name: 'A', _acu_order_: 5 },
      sheet_1: { name: 'B', _acu_order_: 3 },
    };
    // forceRebuild 会重新按顺序赋值 0, 1
    expect(ensureSheetOrderNumbers_ACU(data, { forceRebuild: true })).toBe(true);
    expect(data.sheet_0._acu_order_).toBe(0);
    expect(data.sheet_1._acu_order_).toBe(1);
  });

  it('null 数据返回 false', () => {
    expect(ensureSheetOrderNumbers_ACU(null as any)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// logDebug_ACU
// ═══════════════════════════════════════════════════════════════
describe('logDebug_ACU', () => {
  it('DEBUG_MODE_ACU 为 false 时不调用 console.log', () => {
    const spy = vi.spyOn(console, 'log');
    logDebug_ACU('测试日志');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it('多参数调用不报错且不输出', () => {
    const spy = vi.spyOn(console, 'log');
    logDebug_ACU('测试', 123, { a: 1 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════
// logWarn_ACU
// ═══════════════════════════════════════════════════════════════
describe('logWarn_ACU', () => {
  it('默认关闭时不调用 console.warn、不写缓冲且不通知订阅者', () => {
    resetLogBufferForTesting();
    const received: any[] = [];
    subscribe((entry) => received.push(entry));
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logWarn_ACU('警告日志');

    expect(spy).not.toHaveBeenCalled();
    expect(getAllLogs()).toEqual([]);
    expect(received).toEqual([]);
    spy.mockRestore();
  });

  it('开启后恢复 console.warn、缓冲写入与订阅通知', () => {
    resetLogBufferForTesting();
    setWarnLogEnabled(true);
    const received: any[] = [];
    subscribe((entry) => received.push(entry));
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logWarn_ACU('警告日志');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('ACU');
    expect(spy.mock.calls[0][1]).toBe('警告日志');
    expect(getAllLogs()).toHaveLength(1);
    expect(getAllLogs()[0].level).toBe('warn');
    expect(received).toHaveLength(1);
    expect(received[0].level).toBe('warn');
    spy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════
// logError_ACU
// ═══════════════════════════════════════════════════════════════
describe('logError_ACU', () => {
  it('Warn 关闭时仍调用 console.error、写缓冲并通知订阅者', () => {
    resetLogBufferForTesting();
    const received: any[] = [];
    subscribe((entry) => received.push(entry));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError_ACU('错误日志');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('ACU');
    expect(spy.mock.calls[0][1]).toBe('错误日志');
    expect(getAllLogs()).toHaveLength(1);
    expect(getAllLogs()[0].level).toBe('error');
    expect(received).toHaveLength(1);
    expect(received[0].level).toBe('error');
    spy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════
// normalizeExtractRules_ACU
// ═══════════════════════════════════════════════════════════════
describe('normalizeExtractRules_ACU', () => {
  it('null 输入无旧标签时返回空数组', () => {
    const result = normalizeExtractRules_ACU(null, '');
    expect(result).toEqual([]);
  });
  it('与 normalizeExcludeRules_ACU 返回相同结果', () => {
    const input = [{ start: '<plot>', end: '</plot>' }];
    const extractResult = normalizeExtractRules_ACU(input);
    const excludeResult = normalizeExcludeRules_ACU(input);
    expect(extractResult).toEqual(excludeResult);
  });
  it('传入对象数组时返回 { start, end } 结构', () => {
    const rules = [{ start: '<plot>', end: '</plot>' }];
    const result = normalizeExtractRules_ACU(rules);
    expect(result).toEqual([{ start: '<plot>', end: '</plot>' }]);
  });
  it('传入字符串数组时按 | 分割', () => {
    const rules = ['<plot>|</plot>'];
    const result = normalizeExtractRules_ACU(rules);
    expect(result).toEqual([{ start: '<plot>', end: '</plot>' }]);
  });
  it('重复规则被去重', () => {
    const rules = [{ start: '<a>', end: '</a>' }, { start: '<a>', end: '</a>' }];
    const result = normalizeExtractRules_ACU(rules);
    expect(result.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// parseTableTemplateJson_ACU
// ═══════════════════════════════════════════════════════════════
describe('parseTableTemplateJson_ACU', () => {
  it('解析结果包含 sheet_0 且结构完整', () => {
    const result = parseTableTemplateJson_ACU();
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('sheet_0');
    expect(result.sheet_0.name).toBe('测试表');
    expect(result.sheet_0.content).toEqual([
      ['row_id', '列A'],
      ['1', 'https://example.com/a//b?x=1#hash'],
      ['2', '包含 /* 不是注释 */ 与 // 文本'],
    ]);
  });
  it('stripSeedRows=true 时种子行被移除，只保留表头', () => {
    const result = parseTableTemplateJson_ACU({ stripSeedRows: true });
    expect(result).not.toBeNull();
    expect(result.sheet_0.content.length).toBe(1); // 只有表头行
    expect(result.sheet_0.content[0]).toEqual(['row_id', '列A']);
  });
  it('字符串值中的 URL 和注释标记不会被模板解析截断', () => {
    const result = parseTableTemplateJson_ACU({ stripSeedRows: false });
    expect(result.sheet_0.content[1][1]).toBe('https://example.com/a//b?x=1#hash');
    expect(result.sheet_0.content[2][1]).toBe('包含 /* 不是注释 */ 与 // 文本');
  });
  it('解析结果是对象类型', () => {
    const result = parseTableTemplateJson_ACU();
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);
  });
});
