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
  escapeRegExp_ACU,
  hashUserInput_ACU,
  normalizeNonNegativeInteger_ACU,
  normalizePositiveInteger_ACU,
  normalizeExcludeRules_ACU,
  stripSeedRowsFromTemplate_ACU,
  applySheetOrderNumbers_ACU,
  ensureSheetOrderNumbers_ACU,
  cloneScopedConfigData_ACU,
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
  setWarnLogEnabledByDevOption_ACU,
  subscribe,
} from '../../src/shared/log-buffer';

// ═══════════════════════════════════════════════════════════════
// cleanChatName_ACU
// ═══════════════════════════════════════════════════════════════
describe('cleanChatName_ACU', () => {

  it('Windows 路径', () => {
    expect(cleanChatName_ACU('C:\\Users\\test\\chat.jsonl')).toBe('chat');
  });

  it('无扩展名原样返回', () => {
    expect(cleanChatName_ACU('chatname')).toBe('chatname');
  });
});

// ═══════════════════════════════════════════════════════════════
// deepMerge_ACU
// ═══════════════════════════════════════════════════════════════
describe('deepMerge_ACU', () => {

  it('数组不合并，直接覆盖', () => {
    expect(deepMerge_ACU({ a: [1, 2] }, { a: [3, 4] })).toEqual({ a: [3, 4] });
  });

  it('不修改原始对象', () => {
    const target = { a: 1 };
    const source = { b: 2 };
    deepMerge_ACU(target, source);
    expect(target).toEqual({ a: 1 });
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
});

// ═══════════════════════════════════════════════════════════════
// normalizePositiveInteger_ACU
// ═══════════════════════════════════════════════════════════════
describe('normalizePositiveInteger_ACU', () => {
  it('正整数原样返回', () => {
    expect(normalizePositiveInteger_ACU(5)).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════
// normalizeExcludeRules_ACU
// ═══════════════════════════════════════════════════════════════
describe('normalizeExcludeRules_ACU', () => {

  it('空数组回退到旧标签', () => {
    const rules = normalizeExcludeRules_ACU([], 'tagA');
    expect(rules.length).toBe(1);
    expect(rules[0].start).toBe('<tagA');
  });

  it('null 规则回退到旧标签', () => {
    const rules = normalizeExcludeRules_ACU(null, 'tagA');
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

  it('循环引用返回 fallback', () => {
    const obj: any = {};
    obj.self = obj;
    expect(cloneScopedConfigData_ACU(obj)).toBeNull();
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
});

describe('ensureSheetOrderNumbers_ACU', () => {

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
    setWarnLogEnabledByDevOption_ACU(true);
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
  it('传入字符串数组时按 | 分割', () => {
    const rules = ['<plot>|</plot>'];
    const result = normalizeExtractRules_ACU(rules);
    expect(result).toEqual([{ start: '<plot>', end: '</plot>' }]);
  });
});

// ═══════════════════════════════════════════════════════════════
// parseTableTemplateJson_ACU
// ═══════════════════════════════════════════════════════════════
describe('parseTableTemplateJson_ACU', () => {
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
});

describe('块 7 复审：utils 小项', () => {
  it('R7-06：target 值为 null/字符串/数组时不吞掉 source 对象', () => {
    expect(deepMerge_ACU({ a: null }, { a: { x: 1 } })).toEqual({ a: { x: 1 } });
    expect(deepMerge_ACU({ a: 'ab' }, { a: { x: 1 } })).toEqual({ a: { x: 1 } });
    expect(deepMerge_ACU({ a: [1, 2] }, { a: { x: 1 } })).toEqual({ a: { x: 1 } });
    expect(deepMerge_ACU({ a: { y: 2 } }, { a: { x: 1 } })).toEqual({ a: { x: 1, y: 2 } });
  });

  it('R7-11：normalizePositiveInteger_ACU 取整后不足 1 时回落默认值', () => {
    expect(normalizePositiveInteger_ACU(0.5, 3)).toBe(3);
    expect(normalizePositiveInteger_ACU(2.7, 3)).toBe(2);
  });
});

describe('R7-03：屏蔽词的英文按整词匹配', () => {
  it('英文名里恰好含 cot/rule/status 的正常条目不再被屏蔽', () => {
    expect(isEntryBlocked_ACU({ comment: 'Scott 的档案' })).toBe(false);
    expect(isEntryBlocked_ACU({ comment: 'Escort mission' })).toBe(false);
    expect(isEntryBlocked_ACU({ comment: 'cottage' })).toBe(false);
    expect(isEntryBlocked_ACU({ comment: 'Ruler of the north' })).toBe(false);
    expect(isEntryBlocked_ACU({ comment: 'statusquo' })).toBe(false);
  });

  it('作为独立词出现的英文屏蔽词仍屏蔽', () => {
    expect(isEntryBlocked_ACU({ comment: 'COT思维链' })).toBe(true);
    expect(isEntryBlocked_ACU({ comment: '[Rules] 输出要求' })).toBe(true);
    expect(isEntryBlocked_ACU({ comment: 'Status bar' })).toBe(true);
    expect(isEntryBlocked_ACU({ comment: 'MVU变量' })).toBe(true);
    expect(isEntryBlocked_ACU({ comment: 'InitVar' })).toBe(true);
  });
});
