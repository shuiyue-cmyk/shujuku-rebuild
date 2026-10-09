import { describe, expect, it } from 'vitest';
import { rankAgentWorldbookCandidates_ACU } from '../../../src/service/agent/agent-worldbook-ranking';

const emptyQuery = { userInput: '', recentContext: '', taskContext: '' };

function candidate(comment: string, keys: string[] = [], description = '', triggerWhen = '') {
  return { comment, keys, description, triggerWhen };
}

describe('rankAgentWorldbookCandidates_ACU', () => {

  it('3000 候选 + 长上下文排序在 1.5s 内完成（query 词项只提一次）', () => {
    const bigContext = '夜色漫过屋檐，她收起最后一封信。'.repeat(400);
    const longComment = '条目正文酒馆传闻矿洞地图，附带冗长的背景描述与人物关系铺陈。'.repeat(60);
    const candidates = Array.from({ length: 3000 }, (_, i) =>
      candidate(`${longComment}条目${i}`, [`key${i % 100}`, `地点${i % 50}`], `描述${i}地下通道`, `触发${i}调查时使用`));
    const startedAt = Date.now();
    const ranked = rankAgentWorldbookCandidates_ACU(candidates, {
      userInput: '寻找矿洞入口',
      recentContext: bigContext,
      taskContext: '',
    });
    expect(Date.now() - startedAt).toBeLessThan(1500);
    expect(ranked).toHaveLength(3000);
  });

  it('preserves input order for empty queries and equal scores', () => {
    const first = candidate('第一条');
    const second = candidate('第二条');
    const third = candidate('第三条');

    expect(rankAgentWorldbookCandidates_ACU([first, second, third], emptyQuery)).toEqual([first, second, third]);
    expect(rankAgentWorldbookCandidates_ACU([first, second, third], {
      ...emptyQuery,
      userInput: '不存在的词项',
    })).toEqual([first, second, third]);
  });
});
