/**
 * 世界书宿主正文完整性 —— 预取快照必须逐字保留宿主正文，并按正文内容计量 token
 *
 * 移植自上游 AlbusKen/shujuku `test` 分支的同名测试（f4e1fd55），按 TT 仓改写：
 * 上游第一用例断言的 `renderAgentWorldbookHitBodies_ACU` 是「命中条目全文直接注入」的
 * 新功能，我们没有该函数，改用同样消费 `entry.content` 的精读渲染
 * `renderAgentWorldbookEntries_ACU` 断言，锁的是同一件事：正文逐字保真。
 *
 * 两条锁住的行为：
 * 1. 首尾空白属于宿主正文的一部分，预取与渲染都不得裁掉；只用「trim 后为空」判空，
 *    以免纯空白条目占目录行（原先直接 trim 会在渲染时丢字节）。
 * 2. token 缓存必须按正文内容判等，不能按长度——等长改写（『原文内容』→『改写内容』）
 *    长度不变但内容不同，复用旧值会让目录里的「约 N token」变成陈旧估算。
 */
import { describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  entries: vi.fn(),
  bookNames: vi.fn(),
  count: vi.fn(async (text: string) => (text.includes('改') ? 23 : 11)),
}));

vi.mock('../../../../src/service/continuation/agent/agent-token-budget', () => ({ countAgentTokens_ACU: host.count }));
vi.mock('../../../../src/service/continuation/worldbook-context', () => ({
  resolveRelevantBookNames_ACU: host.bookNames,
  normalizeGeneratedComment_ACU: (entry: { comment?: string }) => entry.comment ?? '',
  isSummaryEntryComment_ACU: () => false,
  isSummaryIndexEntryComment_ACU: () => false,
}));
vi.mock('../../../../src/service/worldbook/pipeline', () => ({
  getLorebookEntriesByNames_ACU: host.entries,
  getWorldbookEntryKeywords_ACU: () => [],
}));
vi.mock('../../../../src/service/worldbook/injection-engine-state', () => ({ getIsolationPrefix_ACU: () => '' }));
vi.mock('../../../../src/service/settings/settings-readers', () => ({ getCurrentWorldbookConfig_ACU: () => ({}) }));

import {
  loadAgentWorldbookSnapshot_ACU,
  renderAgentWorldbookEntries_ACU,
} from '../../../../src/service/continuation/agent/agent-worldbook-read';

describe('世界书宿主正文完整性', () => {
  it('预取与精读注入保留宿主正文的首尾空白，仅排除纯空白条目', async () => {
    const content = `  开头\n${'完整正文。'.repeat(1000)}\n结尾  \n`;
    host.bookNames.mockResolvedValue(['设定集']);
    host.entries.mockResolvedValue({
      设定集: [
        { uid: 7, comment: '正文', enabled: true, type: 'constant', content },
        { uid: 8, comment: '空白', enabled: true, type: 'constant', content: ' \n ' },
      ],
    });

    const snapshot = await loadAgentWorldbookSnapshot_ACU();
    expect(snapshot.available).toBe(true);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].content).toBe(content);
    expect(renderAgentWorldbookEntries_ACU(snapshot, '设定集', ['7'])).toBe(`### 正文（设定集#7）\n${content}`);
  });

  it('同一条目等长改写后重新计量，未改正文才复用缓存', async () => {
    host.bookNames.mockResolvedValue(['等长改写测试']);
    const entry = (content: string) => ({ uid: 81, comment: '正文', enabled: true, type: 'constant', content });
    host.entries.mockResolvedValue({ 等长改写测试: [entry('原文内容')] });
    host.count.mockClear();

    const first = await loadAgentWorldbookSnapshot_ACU();
    expect(first.entries[0]).toMatchObject({ content: '原文内容', tokens: 11 });

    // 等长但内容不同：必须重算，否则目录里的 token 估算停留在旧正文上。
    host.entries.mockResolvedValue({ 等长改写测试: [entry('改写内容')] });
    const second = await loadAgentWorldbookSnapshot_ACU();
    expect(second.entries[0]).toMatchObject({ content: '改写内容', tokens: 23 });

    // 正文未变：命中缓存，不再触发计量。
    await loadAgentWorldbookSnapshot_ACU();
    expect(host.count).toHaveBeenCalledTimes(2);
  });
});
