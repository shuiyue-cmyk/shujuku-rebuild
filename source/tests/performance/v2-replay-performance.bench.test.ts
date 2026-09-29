/**
 * 阶段 J：长历史 replay 性能基准（本地可复现，非浏览器验收）。
 *
 * 运行：npx vitest run tests/performance/v2-replay-performance.bench.test.ts
 *
 * 用 buildLongHistoryFixture_ACU（17 表 / 62 帧 / ~660 op）在真实 replay 核心上
 * 度量：多 boundary 一次前向捕获 vs 逐次冷 replay 的结果一致性（canonical data 深比较，
 * 不一致即红；绝对耗时只打印不设门禁）。
 *
 * 输出纯数值指标（metrics 已由 SAFE_METRIC_KEYS_ACU 白名单保证不含业务数据），
 * 结果打印为表格。纯耗时的观测用例（alias 开关对比、yield 计数）因零断言已删除，
 * 需要时本地用 git 历史找回或重写。
 */

import { describe, it, beforeAll, expect, vi } from 'vitest';
import { buildLongHistoryFixture_ACU } from '../service/table/v2-long-history-fixture';
import { loadTableStateFromFramesV2Detailed_ACU, loadTableStatesAtBoundariesFromFramesV2Detailed_ACU } from '../../src/service/table/storage-frame-v2-replay';

// 复用既有测试的模块解析方式：真实 state-manager/chat-gateway，仅静音 log。
vi.mock('../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../src/shared/utils');
  return { ...actual, logDebug_ACU: () => {}, logWarn_ACU: () => {} };
});

describe('阶段 J：长历史 replay 性能基准（本地可复现）', () => {
  let chat: any[];

  beforeAll(() => {
    chat = buildLongHistoryFixture_ACU().chat;
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
    // 结果一致性：3 个 boundary 的 canonical data 严格深比较（vitest 原生，key 顺序无关）。
    // 一致性失败即红；性能计时本身不设门禁。
    for (const boundary of boundaries) {
      expect(fwd.get(boundary)?.data, `boundary ${boundary}：前向捕获与逐次冷 replay 结果不一致`).toEqual(
        seq.get(boundary)?.data,
      );
    }
    // eslint-disable-next-line no-console
    console.table({
      forward_capture: { elapsedMs: fwdElapsed.toFixed(1), boundaryCount: fwd.size },
      sequential_cold: { elapsedMs: seqElapsed.toFixed(1), boundaryCount: seq.size },
    });
  });
});
