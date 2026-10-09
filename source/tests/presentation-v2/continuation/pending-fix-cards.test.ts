import { describe, expect, it } from 'vitest';

import { buildContinuationPendingFixCards_ACU } from '../../../src/presentation-v2/continuation/pending-fix-cards';

describe('续写待修复卡片（TT）', () => {

  it('R10B-18：模块名与资料面板同一套叫法', () => {
    const titles = buildContinuationPendingFixCards_ACU(['infoGap', 'chronology'].map(module => ({
      module: module as any, agentName: 'a', violations: [], attempts: 1, firstFailedAtIndex: 0, lastError: 'x',
    }))).map(card => card.title);
    expect(titles).toEqual(['认知与信息差', '故事年代学账本']);
  });
});
