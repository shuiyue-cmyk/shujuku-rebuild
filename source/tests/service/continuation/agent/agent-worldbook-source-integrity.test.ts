/**
 * 世界书宿主正文完整性 —— 预取快照必须逐字保留宿主正文，并按正文内容计量 token
 *
 * 移植自上游 AlbusKen/shujuku `test` 分支的同名测试（f4e1fd55），按 TT 仓改写：
 * 上游第一用例断言的 `renderAgentWorldbookHitBodies_ACU` 是「命中条目全文直接注入」的
 * 新功能，我们没有该函数，改用同样消费 `entry.content` 的精读渲染
 * `renderAgentWorldbookEntries_ACU` 断言，锁的是同一件事：正文逐字保真。
 *
 * 锁住的行为：
 * 1. 首尾空白属于宿主正文的一部分，预取与渲染都不得裁掉；只用「trim 后为空」判空，
 *    以免纯空白条目占目录行。
 * 2. token 缓存必须按正文内容判等，不能按长度——等长改写（『原文内容』→『改写内容』）
 *    长度不变但内容不同，复用旧值会让目录里的「约 N token」变成陈旧估算。
 * 3. 判等要存正文，于是缓存从「几个数字」变成「攥着宿主正文字符串引用」；切角色、
 *    切世界书会不断攒旧副本，所以驻留必须有预算（本仓自己加的守卫，非上游内容）。
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
  readEntryTokenCacheStats_ACU,
  renderAgentWorldbookEntries_ACU,
} from '../../../../src/service/continuation/agent/agent-worldbook-read';

/** 造一本每页都不同的世界书：uid 连续、正文互不相同，用于把缓存推过预算。 */
async function loadBook(bookName: string, from: number, to: number, contentSize: number): Promise<void> {
  host.bookNames.mockResolvedValue([bookName]);
  host.entries.mockResolvedValue({
    [bookName]: Array.from({ length: to - from + 1 }, (_, index) => ({
      uid: String(from + index),
      comment: '正文',
      enabled: true,
      type: 'constant',
      content: '内'.repeat(contentSize),
    })),
  });
  await loadAgentWorldbookSnapshot_ACU();
}

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

  it('缓存驻留有预算，越界整表清空（判等存正文带来的新攥持必须封顶）', async () => {
    const budget = readEntryTokenCacheStats_ACU().maxRetainedChars;
    expect(budget, '必须声明驻留预算').toBeGreaterThan(0);

    // 灌入远超预算的互不相同条目：任何时刻驻留字符数都必须封在预算内。
    for (let round = 0; round < 10; round++) {
      await loadBook('大书', round * 40 + 1, round * 40 + 40, 20_000);
      const stats = readEntryTokenCacheStats_ACU();
      expect(stats.retainedChars, `第 ${round} 轮后驻留 ${stats.retainedChars} 字符越界`).toBeLessThanOrEqual(budget);
    }

    // 预算清空只允许「放弃缓存」，不允许把 token 数算错或漏算：
    // 越界后仍应能正常计量，且同内容重复加载不会漏掉任何一条的计数。
    host.count.mockClear();
    await loadBook('大书', 900, 902, 20_000);
    expect(host.count, '新条目必须各自计量一次').toHaveBeenCalledTimes(3);
    const snapshot = await loadAgentWorldbookSnapshot_ACU();
    expect(snapshot.entries.map(entry => entry.tokens)).toEqual([11, 11, 11]);
  });

  /**
   * 计数必须反映真实驻留，不能只增不减：同一条目被反复改写时，旧正文要扣掉。
   * 否则计数器会比真实占用爬得快，缓存被无谓地频繁整表清空（越界判定失真）。
   */
  it('同一条目反复改写不虚增驻留计数', async () => {
    host.bookNames.mockResolvedValue(['改写书']);
    const size = 30_000;
    const rewrite = (salt: string) => {
      host.entries.mockResolvedValue({
        改写书: [{ uid: '1', comment: '正文', enabled: true, type: 'constant', content: salt + '内'.repeat(size) }],
      });
    };

    rewrite('a');
    await loadAgentWorldbookSnapshot_ACU();
    const baseline = readEntryTokenCacheStats_ACU();
    for (let round = 0; round < 20; round++) {
      rewrite(String.fromCharCode(98 + round));
      await loadAgentWorldbookSnapshot_ACU();
    }
    const after = readEntryTokenCacheStats_ACU();
    expect(after.entries).toBe(baseline.entries);
    expect(after.retainedChars, `反复改写 20 轮后计数应从 ${baseline.retainedChars} 涨到 ${after.retainedChars}`).toBe(baseline.retainedChars);
  });

  it('纯空白条目不进快照，正文为空的判定按 trim 后结果', async () => {
    host.bookNames.mockResolvedValue(['空白书']);
    host.entries.mockResolvedValue({
      空白书: [
        { uid: 1, comment: 'A', enabled: true, type: 'constant', content: '\n\n  \t ' },
        { uid: 2, comment: 'B', enabled: true, type: 'constant', content: '有正文' },
        { uid: 3, comment: 'C', enabled: true, type: 'constant', content: '' },
      ],
    });
    const snapshot = await loadAgentWorldbookSnapshot_ACU();
    expect(snapshot.entries.map(entry => entry.uid)).toEqual(['2']);
  });
});
