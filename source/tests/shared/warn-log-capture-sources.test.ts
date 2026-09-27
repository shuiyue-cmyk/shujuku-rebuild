/**
 * tests/shared/warn-log-capture-sources.test.ts
 * warn 采集的两个来源（开发者选项 / Debug 面板）按「或」合并，互不覆盖。
 *
 * 背景：warn 采集曾经只有一个布尔，两个入口写同一个变量，于是
 * - 开发者选项开着 warn 的用户，一旦「停止 Debug」就被顺带关掉采集（他的常驻开关没了）；
 * - Debug 采集期间用户改任一开发者选项，store 初始化 / refresh 会把这次临时采集关掉。
 * 本文件钉住「按来源分治 + 取或」的语义：任一来源开 ⇒ 采集；两个来源都关 ⇒ 只有 error。
 *
 * 判别点（旧实现单布尔 ⇒ 红）：「停止 Debug 不影响常驻来源」「Debug 期间改 dev 选项」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logBuffer from '../../src/shared/log-buffer';
import { logWarn_ACU } from '../../src/shared/utils';

const {
  _resetForTesting,
  getAllLogs,
  getKnownTags,
  isWarnLogEnabled,
  pushLog,
  setDebugLogEnabled,
  setWarnLogEnabledByDebugCapture_ACU,
  setWarnLogEnabledByDevOption_ACU,
  subscribe,
} = logBuffer;

beforeEach(() => {
  // 双来源必须回到「都关」的出厂态：只有 error 进缓冲
  _resetForTesting();
});

describe('warn 采集双来源取或（缓冲区侧）', () => {
  it('两个来源默认都关：只有 error 进缓冲，warn / debug 都不进', () => {
    expect(isWarnLogEnabled()).toBe(false);
    pushLog('warn', ['[ACU]', '[SQL] 不该出现']);
    pushLog('debug', ['[ACU]', '[调试] 不该出现']);
    pushLog('error', ['[ACU]', '[导入] 必须出现']);

    expect(getAllLogs().map((entry) => entry.level)).toEqual(['error']);
  });

  it('仅开发者选项来源开启：不点 Debug 也采 warn（debug 级别仍不采）', () => {
    setWarnLogEnabledByDevOption_ACU(true);

    pushLog('warn', ['[ACU]', '[SQL] 常驻 warn']);
    pushLog('debug', ['[ACU]', '[调试] 未开 Debug']);

    expect(isWarnLogEnabled()).toBe(true);
    expect(getAllLogs().map((entry) => entry.level)).toEqual(['warn']);
  });

  it('仅 Debug 采集来源开启：dev 选项关着也采 warn', () => {
    setWarnLogEnabledByDevOption_ACU(false);
    setWarnLogEnabledByDebugCapture_ACU(true);

    pushLog('warn', ['[ACU]', '[SQL] Debug 期间的 warn']);

    expect(isWarnLogEnabled()).toBe(true);
    expect(getAllLogs().map((entry) => entry.level)).toEqual(['warn']);
  });

  it('停止 Debug（收回采集来源）不得关掉开发者选项已开启的常驻采集', () => {
    setWarnLogEnabledByDevOption_ACU(true);
    setWarnLogEnabledByDebugCapture_ACU(true);

    // stopDebug 只收回自己的来源
    setWarnLogEnabledByDebugCapture_ACU(false);

    expect(isWarnLogEnabled()).toBe(true);
    pushLog('warn', ['[ACU]', '[SQL] 停止 Debug 之后仍要采']);
    expect(getAllLogs().map((entry) => entry.message)).toEqual(['[ACU] [SQL] 停止 Debug 之后仍要采']);
  });

  it('Debug 采集期间改开发者选项（置 false / refresh 回写）不得收回本次临时采集', () => {
    setWarnLogEnabledByDebugCapture_ACU(true);

    // dev-options-store 在 state 初始化与 refresh() 里都会按持久化值回写 dev 来源
    setWarnLogEnabledByDevOption_ACU(false);

    expect(isWarnLogEnabled()).toBe(true);
    pushLog('warn', ['[ACU]', '[SQL] Debug 期间改选项后仍要采']);
    expect(getAllLogs()).toHaveLength(1);
  });

  it('两个来源都关后：warn 不入缓冲、不打标签、不通知订阅者（默认关不许弱化）', () => {
    setWarnLogEnabledByDevOption_ACU(true);
    setWarnLogEnabledByDebugCapture_ACU(true);
    setWarnLogEnabledByDevOption_ACU(false);
    setWarnLogEnabledByDebugCapture_ACU(false);

    const received: string[] = [];
    subscribe((entry) => received.push(entry.level));
    pushLog('warn', ['[ACU]', '[SQL] 两个来源都关了']);

    expect(isWarnLogEnabled()).toBe(false);
    expect(getAllLogs()).toEqual([]);
    expect(getKnownTags()).toEqual([]);
    expect(received).toEqual([]);
  });

  it('同一来源重复置值幂等，且不影响另一来源的记录', () => {
    setWarnLogEnabledByDevOption_ACU(true);
    setWarnLogEnabledByDevOption_ACU(true);
    setWarnLogEnabledByDebugCapture_ACU(false);

    expect(isWarnLogEnabled()).toBe(true);

    setWarnLogEnabledByDevOption_ACU(false);
    expect(isWarnLogEnabled()).toBe(false);
  });

  it('setDebugLogEnabled 与 warn 来源互不牵连（只开 debug 时 warn 依旧被挡）', () => {
    setDebugLogEnabled(true);
    pushLog('debug', ['[ACU]', '[调试] Debug 采集中']);
    pushLog('warn', ['[ACU]', '[SQL] warn 未开']);

    expect(getAllLogs().map((entry) => entry.level)).toEqual(['debug']);
  });
});

describe('warn 采集双来源取或（console 侧，logWarn_ACU 早退结构不变）', () => {
  it('两个来源都关：console.warn 不输出', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logWarn_ACU('[SQL] 未开采集');

    expect(spy).not.toHaveBeenCalled();
    expect(getAllLogs()).toEqual([]);
    spy.mockRestore();
  });

  it('仅 dev 来源开：console.warn 输出且写缓冲', () => {
    setWarnLogEnabledByDevOption_ACU(true);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logWarn_ACU('[SQL] 常驻采集');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(getAllLogs().map((entry) => entry.level)).toEqual(['warn']);
    spy.mockRestore();
  });

  it('停止 Debug 后 dev 来源仍开：console.warn 继续输出', () => {
    setWarnLogEnabledByDevOption_ACU(true);
    setWarnLogEnabledByDebugCapture_ACU(true);
    setWarnLogEnabledByDebugCapture_ACU(false);

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logWarn_ACU('[SQL] 停止 Debug 之后仍要出声');

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
