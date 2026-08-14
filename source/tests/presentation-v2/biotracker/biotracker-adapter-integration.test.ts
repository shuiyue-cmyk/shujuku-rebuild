/**
 * 适配层 ↔ vendor 集成测试：
 * 1. loadWorldInfo 返回 {name, entries} 结构（vendor 过滤函数只认该结构——裸数组会绕过蓝灯+绿灯过滤）
 * 2. agent_greenlights 过滤整链：蓝灯（constant）+ 绿灯（uid 白名单）保留，其余（含 agent 接管关闭的）过滤
 * 3. console 桥接：biotracker vendor 日志（[BS BioTracker] 前缀）进数据库日志系统
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createBiotrackerCtx_ACU, initBiotracker_ACU } from '../../../src/service/biotracker/biotracker-adapter';
import { filterTrackerWorldbookEntries } from '../../../src/service/biotracker/vendor/tracker.js';
import { getAllLogs, clearLogs, setWarnLogEnabled } from '../../../src/shared/log-buffer';

vi.mock('../../../src/data/gateways/worldbook-gateway', () => ({
  getLorebookEntries_ACU: vi.fn(async () => [
    { uid: 'B1', name: '蓝灯条目', type: 'constant', enabled: true, content: 'c1' },
    { uid: 'K1', name: '普通条目', type: 'keyword', enabled: true, content: 'c2' },
  ]),
}));

describe('biotracker 适配层 ↔ vendor 集成', () => {
  beforeEach(() => {
    clearLogs();
  });

  it('loadWorldInfo 包装为 {name, entries} 结构（裸数组会绕过 vendor 过滤）', async () => {
    const ctx = createBiotrackerCtx_ACU();
    const loaded = await ctx.loadWorldInfo('测试世界书');
    expect(loaded).toEqual({
      name: '测试世界书',
      entries: [
        expect.objectContaining({ uid: 'B1' }),
        expect.objectContaining({ uid: 'K1' }),
      ],
    });
  });

  it('agent_greenlights 过滤：蓝灯 + 绿灯保留，agent 接管关闭的条目被过滤', () => {
    const worldbook = {
      name: '主书',
      entries: [
        { uid: 'B1', name: '蓝灯', type: 'constant', enabled: true, content: 'x' },
        { uid: 'K1', name: '普通未放行', type: 'keyword', enabled: true, content: 'y' },
        { uid: 'G1', name: '绿灯放行', type: 'keyword', enabled: true, content: 'z' },
        { uid: 'D1', name: 'agent 接管关闭', type: 'keyword', enabled: false, content: 'w' },
      ],
    };
    const filtered = filterTrackerWorldbookEntries(
      worldbook,
      new Set(),
      { trackerWorldbookMode: 'agent_greenlights', agentGreenlightUids: ['G1'] },
      [],
      {},
    );
    const kept = filtered.entries.map((e: any) => e.uid);
    expect(kept).toEqual(['B1', 'G1']);
  });

  it('console 桥接：vendor 的 [BS BioTracker] warn 日志进数据库日志系统', async () => {
    setWarnLogEnabled(true);
    const realWarn = console.warn;
    try {
      initBiotracker_ACU();
      console.warn('[BS BioTracker] 测试警告');
      const logs = getAllLogs();
      expect(logs.some((l) => l.level === 'warn' && l.message.includes('测试警告'))).toBe(true);
    } finally {
      console.warn = realWarn;
      setWarnLogEnabled(false);
    }
  });
});
