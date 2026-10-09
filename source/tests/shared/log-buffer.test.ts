/**
 * tests/shared/log-buffer.test.ts
 * 日志缓冲区单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  pushLog,
  getAllLogs,
  getLogCount,
  clearLogs,
  getKnownTags,
  subscribe,
  unsubscribe,
  getClearHistory_ACU,
  getRecentLogs_ACU,
  getSubscriberCount,
  extractTag,
  formatArgs,
  _resetForTesting,
  setDebugLogEnabled,
  setWarnLogEnabledByDevOption_ACU,
  isWarnLogEnabled,
  subscribeToClear,
} from '../../src/shared/log-buffer';

beforeEach(() => {
  _resetForTesting();
  // 通用测试显式启用可选级别；默认关闭行为由独立用例验证。
  // warn 走「常驻来源」（dev 选项）当夹具即可，双来源取或的矩阵见 warn-log-capture-sources.test.ts。
  setDebugLogEnabled(true);
  setWarnLogEnabledByDevOption_ACU(true);
});

// ═══════════════════════════════════════════════════════════════
// pushLog + getAllLogs
// ═══════════════════════════════════════════════════════════════
describe('pushLog + getAllLogs', () => {

  it('推送多条日志按顺序排列', () => {
    pushLog('debug', ['[ACU]', '第一条']);
    pushLog('warn', ['[ACU]', '第二条']);
    pushLog('error', ['[ACU]', '第三条']);
    const logs = getAllLogs();
    expect(logs).toHaveLength(3);
    expect(logs[0].level).toBe('debug');
    expect(logs[1].level).toBe('warn');
    expect(logs[2].level).toBe('error');
  });

  it('getAllLogs 返回副本（不影响内部缓冲区）', () => {
    pushLog('debug', ['[ACU]', 'test']);
    const logs = getAllLogs();
    logs.length = 0; // 清空副本
    expect(getLogCount()).toBe(1); // 内部缓冲区不受影响
  });
});

describe('Warn 日志开关', () => {
  it('默认关闭时不写入缓冲区且不通知订阅者', () => {
    _resetForTesting();
    const received: any[] = [];
    subscribe((entry) => received.push(entry));

    pushLog('warn', ['[ACU]', '[SQL] 应被隐藏']);

    expect(isWarnLogEnabled()).toBe(false);
    expect(getAllLogs()).toEqual([]);
    expect(getKnownTags()).toEqual([]);
    expect(received).toEqual([]);
  });

  it('显式开启后恢复写入与订阅通知', () => {
    const received: any[] = [];
    subscribe((entry) => received.push(entry));

    pushLog('warn', ['[ACU]', '[SQL] 已显示']);

    expect(isWarnLogEnabled()).toBe(true);
    expect(getAllLogs()).toHaveLength(1);
    expect(received).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 环形缓冲区上限
// ═══════════════════════════════════════════════════════════════
describe('环形缓冲区', () => {
  it('超过 50000 条时丢弃最旧的（环形覆盖）', () => {
    for (let i = 0; i < 50100; i++) {
      pushLog('debug', ['[ACU]', `日志 ${i}`]);
    }
    expect(getLogCount()).toBe(50000);
    const logs = getAllLogs();
    // 最旧的应该是第 100 条（0-99 被覆盖丢弃）
    expect(logs[0].message).toContain('日志 100');
    expect(logs[logs.length - 1].message).toContain('日志 50099');
  });

  it('未超上限时按写入顺序完整返回（环形游标不破坏顺序）', () => {
    for (let i = 0; i < 100; i++) {
      pushLog('debug', ['[ACU]', `顺序 ${i}`]);
    }
    const logs = getAllLogs();
    expect(logs).toHaveLength(100);
    expect(logs[0].message).toContain('顺序 0');
    expect(logs[99].message).toContain('顺序 99');
  });

  it('恰好等于上限时全部保留', () => {
    for (let i = 0; i < 50000; i++) {
      pushLog('debug', ['[ACU]', `满额 ${i}`]);
    }
    expect(getLogCount()).toBe(50000);
    expect(getAllLogs()[0].message).toContain('满额 0');
    expect(getAllLogs()[49999].message).toContain('满额 49999');
  });
});

// ═══════════════════════════════════════════════════════════════
// clearLogs
// ═══════════════════════════════════════════════════════════════
describe('clearLogs', () => {

  it('记录调用方留痕供导出自查', () => {
    clearLogs('debugPanel.stopDebug.autoExport');
    clearLogs('logViewer.clearAll');
    const history = getClearHistory_ACU();
    expect(history.map(item => item.caller)).toEqual(['debugPanel.stopDebug.autoExport', 'logViewer.clearAll']);
    expect(history[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('getLogCountsByLevel_ACU / getRecentLogs_ACU', () => {

  it('只读最近 N 条，不整表拷贝', () => {
    for (let index = 1; index <= 10; index += 1) pushLog('error', ['[ACU]', `line-${index}`]);
    const recent = getRecentLogs_ACU(3);
    expect(recent.map(entry => entry.message)).toEqual(['[ACU] line-8', '[ACU] line-9', '[ACU] line-10']);
    expect(getRecentLogs_ACU(0)).toEqual([]);
    expect(getRecentLogs_ACU(999)).toHaveLength(10);
  });
});
// ═══════════════════════════════════════════════════════════════
// extractTag
// ═══════════════════════════════════════════════════════════════
describe('extractTag', () => {

  it('多个参数时从第二个开始查找标签', () => {
    // extractTag 遍历 args[1] 开始的所有参数，找到第一个含 [xxx] 的
    expect(extractTag(['[ACU]', '无标签', '[SQL] 第三个参数'])).toBe('SQL');
  });
});

// ═══════════════════════════════════════════════════════════════
// subscribe / unsubscribe
// ═══════════════════════════════════════════════════════════════
describe('subscribe / unsubscribe', () => {

  it('取消订阅后不再收到日志', () => {
    const received: any[] = [];
    const unsub = subscribe((entry) => received.push(entry));
    pushLog('debug', ['[ACU]', 'before']);
    unsub();
    pushLog('debug', ['[ACU]', 'after']);
    expect(received).toHaveLength(1);
  });

  it('unsubscribe 函数也能取消', () => {
    const received: any[] = [];
    const callback = (entry: any) => received.push(entry);
    subscribe(callback);
    pushLog('debug', ['[ACU]', 'before']);
    unsubscribe(callback);
    pushLog('debug', ['[ACU]', 'after']);
    expect(received).toHaveLength(1);
  });

  it('订阅者回调出错不影响其他订阅者', () => {
    const received: any[] = [];
    subscribe(() => { throw new Error('boom'); });
    subscribe((entry) => received.push(entry));
    pushLog('debug', ['[ACU]', 'test']);
    expect(received).toHaveLength(1);
  });

  it('同一个回调重复订阅只注册一次', () => {
    const received: any[] = [];
    const callback = (entry: any) => received.push(entry);
    subscribe(callback);
    subscribe(callback);
    expect(getSubscriberCount()).toBe(1);
    pushLog('debug', ['[ACU]', 'test']);
    expect(received).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 敏感键脱敏（二轮审查 V4-g：此前 0 覆盖）
// ═══════════════════════════════════════════════════════════════
describe('敏感键脱敏', () => {
  it('对象整键脱敏：裸键与复合后缀键（embeddingApiKey 等）均打码', () => {
    const out = formatArgs(['[ACU]', {
      apiKey: 'sk-abcdefghijklmn012345678',
      embeddingApiKey: 'embed-secret-value',
      rerankApiKey: 'rerank-secret-value',
      accessToken: 'tok-abc',
      password: 'p@ss',
      username: 'visible',
      keyboardLayout: 'not-masked-should-stay',
      authority: 'should-stay',
    }]);
    expect(out).toContain('"apiKey":"***"');
    expect(out).toContain('"embeddingApiKey":"***"');
    expect(out).toContain('"rerankApiKey":"***"');
    expect(out).toContain('"accessToken":"***"');
    expect(out).toContain('"password":"***"');
    expect(out).toContain('"username":"visible"');
    // 非敏感复合词不得误伤：keyboardLayout 不以敏感后缀结尾；authority 尾缀是裸 auth 之外的词。
    expect(out).toContain('"keyboardLayout":"not-masked-should-stay"');
    expect(out).toContain('"authority":"should-stay"');
  });

  it('非枚举自有属性走结构化兜底分支时同样按键名打码（此前只判值形态，密钥会随值一起漏出）', () => {
    const carrier: Record<string, any> = {};
    Object.defineProperty(carrier, 'embeddingApiKey', { value: 'plain-secret-value', enumerable: false });
    Object.defineProperty(carrier, 'username', { value: 'visible', enumerable: false });
    const out = formatArgs(['[ACU]', carrier]);
    expect(out).toContain('embeddingApiKey=***');
    expect(out).not.toContain('plain-secret-value');
    expect(out).toContain('username=visible');
  });

  it('字符串内联 JSON 形态脱敏：复合键 "embeddingApiKey":"x" 被打码', () => {
    const out = formatArgs(['config={"embeddingApiKey":"leak-me","model":"m1"}']);
    expect(out).toContain('"embeddingApiKey":"***"');
    expect(out).not.toContain('leak-me');
    expect(out).toContain('"model":"m1"');
  });

  it('裸形态脱敏：embeddingApiKey=xxx / apiKey=xxx 值打码，tokenizer 不误伤', () => {
    const out = formatArgs(['请求 embeddingApiKey=supersecret apiKey=topsecret tokenizer=ok']);
    expect(out).not.toContain('supersecret');
    expect(out).not.toContain('topsecret');
    expect(out).toContain('tokenizer=ok');
  });

  it('Bearer 头与 sk- 密钥串脱敏', () => {
    const out = formatArgs(['Authorization: Bearer abc.def.ghi 与 sk-abcdefghijklmnopqrstuvwx']);
    expect(out).not.toContain('abc.def.ghi');
    expect(out).toContain('sk-***');
  });
});

// ═══════════════════════════════════════════════════════════════
// subscribeToClear
// ═══════════════════════════════════════════════════════════════
describe('subscribeToClear', () => {
  it('清空时通知订阅者，取消后不再通知', () => {
    const seen: string[] = [];
    const off = subscribeToClear(() => seen.push('cleared'));
    clearLogs('unit');
    clearLogs('unit2');
    expect(seen).toEqual(['cleared', 'cleared']);
    off();
    clearLogs('unit3');
    expect(seen).toEqual(['cleared', 'cleared']);
  });

  it('通知发生在缓冲重置之后，回调读到的计数已是 0', () => {
    pushLog('error', ['[ACU]', 'x']);
    let seenCount = -1;
    const off = subscribeToClear(() => { seenCount = getLogCount(); });
    clearLogs('unit');
    off();
    expect(seenCount).toBe(0);
  });

  it('订阅者抛错不影响清空本身，也不影响后续订阅者', () => {
    const seen: string[] = [];
    const offBad = subscribeToClear(() => { throw new Error('boom'); });
    const offGood = subscribeToClear(() => seen.push('ok'));
    pushLog('error', ['[ACU]', 'x']);
    expect(() => clearLogs('unit')).not.toThrow();
    expect(getLogCount()).toBe(0);
    expect(seen).toEqual(['ok']);
    offBad();
    offGood();
  });

  it('_resetForTesting 清掉清空订阅者', () => {
    const seen: string[] = [];
    subscribeToClear(() => seen.push('cleared'));
    _resetForTesting();
    clearLogs('unit');
    expect(seen).toEqual([]);
  });
});
