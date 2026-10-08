import { describe, expect, it } from 'vitest';

import { buildContinuationPendingFixCards_ACU } from '../../../src/presentation-v2/continuation/pending-fix-cards';

describe('续写待修复卡片（TT）', () => {
  it('空队列不产生卡片', () => {
    expect(buildContinuationPendingFixCards_ACU([])).toEqual([]);
    expect(buildContinuationPendingFixCards_ACU(undefined)).toEqual([]);
  });

  it('展示模块名、违规摘要与失败次数', () => {
    const cards = buildContinuationPendingFixCards_ACU([{
      module: 'hooks',
      agentName: 'hook-cognition-maintainer',
      violations: [{ path: 'hooks', message: 'title 不能为空' }],
      attempts: 2,
      firstFailedAtIndex: 6,
      lastError: 'title 不能为空',
    }]);
    expect(cards).toEqual([{
      module: 'hooks',
      title: '伏笔账本',
      attempts: 2,
      detail: 'title 不能为空',
      meta: 'hook-cognition-maintainer · 第 2 次 · 自楼层 6 · title 不能为空',
    }]);
  });

  it('R10B-18：模块名与资料面板同一套叫法', () => {
    const titles = buildContinuationPendingFixCards_ACU(['infoGap', 'chronology'].map(module => ({
      module: module as any, agentName: 'a', violations: [], attempts: 1, firstFailedAtIndex: 0, lastError: 'x',
    }))).map(card => card.title);
    expect(titles).toEqual(['认知与信息差', '故事年代学账本']);
  });
});
