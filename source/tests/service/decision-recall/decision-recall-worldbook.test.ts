/**
 * tests/service/decision-recall/decision-recall-worldbook.test.ts
 * 决策召回附加的世界书条目：按角色卡保存、默认正文接收，条目取舍走填表同一条管线。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  charSettings: {} as Record<string, any>,
  combined: vi.fn(async (_scanText: string, _options: any) => '世界书正文'),
  snapshot: vi.fn(async () => ({ snapshot: { books: {} }, expectedSignature: 'sig-1' })),
}));

vi.mock('../../../src/service/settings/settings-readers', () => ({
  getCurrentCharSettings_ACU: () => m.charSettings,
}));
vi.mock('../../../src/service/worldbook/pipeline', () => ({
  getCombinedWorldbookContent_ACU: (scanText: string, options: any) => m.combined(scanText, options),
}));
vi.mock('../../../src/service/agent/agent-worldbook-takeover', () => ({
  resolvePreTakeoverWorldbookSnapshot_ACU: () => m.snapshot(),
}));

import {
  getCurrentDecisionRecallWorldbookConfig_ACU,
  loadDecisionRecallWorldbookContent_ACU,
} from '../../../src/service/decision-recall/decision-recall-worldbook';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(m.charSettings)) delete m.charSettings[key];
  m.snapshot.mockResolvedValue({ snapshot: { books: {} }, expectedSignature: 'sig-1' });
});

describe('getCurrentDecisionRecallWorldbookConfig_ACU', () => {
  it('角色卡还没有这份配置时建一份：默认正文接收、没有手选的书、没有勾选的条目，并存进角色卡设置', () => {
    const cfg = getCurrentDecisionRecallWorldbookConfig_ACU();
    expect(cfg).toEqual({ source: 'active', manualSelection: [], enabledEntries: {} });
    expect(m.charSettings.decisionRecallWorldbookConfig).toBe(cfg);
    // 页面原地改配置再保存：两次读到的是同一个对象
    expect(getCurrentDecisionRecallWorldbookConfig_ACU()).toBe(cfg);
  });

  it('不合法的字段就地补成默认，合法的保留', () => {
    m.charSettings.decisionRecallWorldbookConfig = { source: 'nowhere', manualSelection: 'x', enabledEntries: [1] };
    expect(getCurrentDecisionRecallWorldbookConfig_ACU()).toEqual({ source: 'active', manualSelection: [], enabledEntries: {} });

    m.charSettings.decisionRecallWorldbookConfig = { source: 'manual', manualSelection: ['书A'], enabledEntries: { 书A: [3] } };
    expect(getCurrentDecisionRecallWorldbookConfig_ACU()).toEqual({ source: 'manual', manualSelection: ['书A'], enabledEntries: { 书A: [3] } });
  });
});

describe('loadDecisionRecallWorldbookContent_ACU', () => {
  it('把这份配置与扫描文本交给填表同一条世界书管线，按接管前的条目状态取舍', async () => {
    m.charSettings.decisionRecallWorldbookConfig = { source: 'manual', manualSelection: ['书A'], enabledEntries: {} };
    expect(await loadDecisionRecallWorldbookContent_ACU('前文\n本轮输入')).toBe('世界书正文');
    expect(m.combined).toHaveBeenCalledTimes(1);
    const [scanText, options] = m.combined.mock.calls[0];
    expect(scanText).toBe('前文\n本轮输入');
    expect(options.worldbookConfig).toBe(m.charSettings.decisionRecallWorldbookConfig);
    expect(options.entryStateView).toBe('pre_takeover');
    expect(options.entryStateSnapshot).toEqual({ books: {} });
    expect(options.entryStateSnapshotSignature).toBe('sig-1');
  });

  it('接管快照读不到时照样读世界书，按当前条目状态取舍', async () => {
    m.snapshot.mockRejectedValue(new Error('快照不可用'));
    expect(await loadDecisionRecallWorldbookContent_ACU('x')).toBe('世界书正文');
    const options = m.combined.mock.calls[0][1];
    expect(options.entryStateView).toBe('pre_takeover');
    expect(options.entryStateSnapshot).toBeUndefined();
    expect(options.entryStateSnapshotSignature).toBe('');
  });
});
