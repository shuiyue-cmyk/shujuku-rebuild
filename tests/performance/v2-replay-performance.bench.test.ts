/**
 * 阶段 J：长历史 replay 性能基准（本地可复现，非浏览器验收）。
 *
 * 运行：npx vitest run tests/performance/v2-replay-performance.bench.test.ts
 *
 * 用 buildLongHistoryFixture_ACU（17 表 / 62 帧 / ~660 op）在真实 replay 核心上
 * 度量：冷 replay（默认 alias 开启）与显式关闭 alias（enableAliasContext:false）
 * 的单次耗时、alias build 次数、SQL 操作数、yield 让出次数。
 *
 * 输出纯数值指标（metrics 已由 SAFE_METRIC_KEYS_ACU 白名单保证不含业务数据），
 * 结果打印为表格。本文件不做断言（性能抖动不设硬门禁，绝对耗时留本地/浏览器报告）。
 */

import { describe, it, beforeAll, expect, vi } from 'vitest';
import { buildLongHistoryFixture_ACU } from '../service/table/v2-long-history-fixture';
import { loadTableStateFromFramesV2Detailed_ACU, loadTableStatesAtBoundariesFromFramesV2Detailed_ACU } from '../../src/service/table/storage-frame-v2-replay';

// 复用既有测试的模块解析方式：真实 state-manager/chat-gateway，仅静音 log。
vi.mock('../../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../../src/shared/utils');
  return { ...actual, logDebug_ACU: () => {}, logWarn_ACU: () => {} };
});

describe('阶段 J：长历史 replay 性能基准（本地可复现）', () => {
  let chat: any[];

  beforeAll(() => {
    chat = buildLongHistoryFixture_ACU().chat;
  });

  it('冷 replay（alias 默认开启）与显式关闭 alias 的耗时与计数', async () => {
    // warm-up：首次调用加载 SQLite runtime，不计入统计
    await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });

    const runs = 5;
    const results: Record<string, any> = {};

    for (let i = 0; i < runs; i += 1) {
      const start = performance.now();
      const result = await loadTableStateFromFramesV2Detailed_ACU(chat, '', { updateRuntimeState: false });
      const elapsed = performance.now() - start;
      const m = result?.metrics;
      results[`alias_on_${i}`] = {
        elapsedMs: elapsed.toFixed(1),
        frameCount: m?.frameCount,
        sqlOperationCount: m?.sqlOperationCount,
        tableAliasBuildCount: m?.tableAliasBuildCount,
        columnAliasBuildCount: m?.columnAliasBuildCount,
        aliasInvalidateCount: m?.aliasInvalidateCount,
        aliasCacheHitCount: m?.aliasCacheHitCount,
        yieldCount: m?.yieldCount,
      };
    }

    for (let i = 0; i < runs; i += 1) {
      const start = performance.now();
      const result = await loadTableStateFromFramesV2Detailed_ACU(
        chat, '', { updateRuntimeState: false, enableAliasContext: false },
      );
      const elapsed = performance.now() - start;
      const m = result?.metrics;
      results[`alias_off_${i}`] = {
        elapsedMs: elapsed.toFixed(1),
        frameCount: m?.frameCount,
        sqlOperationCount: m?.sqlOperationCount,
        tableAliasBuildCount: m?.tableAliasBuildCount,
        columnAliasBuildCount: m?.columnAliasBuildCount,
        aliasInvalidateCount: m?.aliasInvalidateCount,
        aliasCacheHitCount: m?.aliasCacheHitCount,
        yieldCount: m?.yieldCount,
      };
    }

    // eslint-disable-next-line no-console
    console.table(results);
  });

  it('阶段 H：多 boundary 一次前向捕获 vs 逐次冷 replay 的耗时与结果一致性', async () => {
    const boundaries = [10, 30, 50];
    // 前向捕获：单次 replay 捕获 3 个 boundary
    const startFwd = performance.now();
    const fwd = await loadTableStatesAtBoundariesFromFramesV2Detailed_ACU(chat, '', boundaries, {
      updateRuntimeState: false,
    });
    const fwdElapsed = performance.now() - startFwd;
    // 逐次冷 replay：3 次独立全量回放
    const startSeq = performance.now();
    const seq = new Map<number, any>();
    for (const boundary of boundaries) {
      seq.set(boundary, await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
        updateRuntimeState: false,
        maxMessageIndex: boundary,
      }));
    }
    const seqElapsed = performance.now() - startSeq;
    // 结果一致性：3 个 boundary 的 canonical data 严格深比较（vitest 原生，key 顺序无关）
    const consistent = boundaries.every((boundary) => {
      const a = fwd.get(boundary)?.data;
      const b = seq.get(boundary)?.data;
      try { expect(a).toEqual(b); return true; } catch { return false; }
    });
    // eslint-disable-next-line no-console
    console.table({
      forward_capture: { elapsedMs: fwdElapsed.toFixed(1), boundaryCount: fwd.size },
      sequential_cold: { elapsedMs: seqElapsed.toFixed(1), boundaryCount: seq.size },
      consistent: consistent,
    });
  });

  it('yield 预算下让出事件循环且 metrics 记录 yieldCount', async () => {
    const start = performance.now();
    const result = await loadTableStateFromFramesV2Detailed_ACU(
      chat, '', { updateRuntimeState: false, yieldBudgetMs: 8 },
    );
    const elapsed = performance.now() - start;
    const m = result?.metrics;
    // eslint-disable-next-line no-console
    console.table({ yield_run: { elapsedMs: elapsed.toFixed(1), yieldCount: m?.yieldCount, frameCount: m?.frameCount } });
  });
});
