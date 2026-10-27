/**
 * tests/service/decision-recall/decision-recall-runtime.test.ts
 * 决策召回一次完整选取：候选来源、分组并发、失败重试后跳过、没填 Key、中止，以及注入内容拼装。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: { decisionRecallSettings: {} } }));
vi.mock('../../../src/service/decision-recall/decision-recall-sources', async () => {
  const actual = await vi.importActual<any>('../../../src/service/decision-recall/decision-recall-sources');
  return {
    collectIndexedCodes_ACU: actual.collectIndexedCodes_ACU,
    DEFAULT_DECISION_RECALL_SOURCES_ACU: {
      loadRows: async () => ({ rows: [], error: '' }),
      loadChat: () => [],
      loadCrossfireIndexContent: async () => null,
    },
  };
});

import {
  buildDecisionRecallFinalMessage_ACU,
  buildDecisionRecallTagBlock_ACU,
  describeDecisionRecallResult_ACU,
  runDecisionRecall_ACU,
} from '../../../src/service/decision-recall/decision-recall-runtime';
import { collectIndexedCodes_ACU, type DecisionRecallSources_ACU } from '../../../src/service/decision-recall/decision-recall-sources';
import { normalizeDecisionRecallSettings_ACU } from '../../../src/service/decision-recall/decision-recall-settings';
import { DECISION_RECALL_LEVELS_ACU, type DecisionRecallRow_ACU } from '../../../src/service/decision-recall/decision-recall-scoring';
import { DEFAULT_DECISION_RECALL_DIRECTIVE_ACU } from '../../../src/shared/decision-recall-defaults';

function makeRows(count: number): DecisionRecallRow_ACU[] {
  return Array.from({ length: count }, (_, order) => {
    const code = `AM${String(order + 1).padStart(4, '0')}`;
    return { rowKey: `k-${code}`, rowOrder: order, indexCode: code, timeSpan: '', location: '', summary: `概要${order + 1}`, chronicleText: '' };
  });
}

function makeSources(rows: DecisionRecallRow_ACU[], indexContent: string | null = null, chat: any[] = []): DecisionRecallSources_ACU {
  return {
    loadRows: async () => ({ rows, error: '' }),
    loadChat: () => chat,
    loadCrossfireIndexContent: async () => indexContent,
  };
}

const settings = (patch: Record<string, unknown> = {}) => normalizeDecisionRecallSettings_ACU({ siliconflowApiKey: 'sk-test', recallCount: 3, maxRetries: 1, ...patch });

/** 题干里写着编码，按编码给分；scoreOf 返回 null 表示这一题不作答。 */
function scoringFetch(scoreOf: (code: string) => number | null) {
  return vi.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const answers: Record<string, any> = {};
    for (const [key, question] of Object.entries<any>(body.questions)) {
      const code = /编码：(AM\d+)/.exec(question.instructions)?.[1] || '';
      const score = scoreOf(code);
      if (score === null) continue;
      answers[key] = { type: 'choice', choice: DECISION_RECALL_LEVELS_ACU[score - 1].label };
    }
    return { ok: true, status: 200, json: async () => ({ answers }) } as any;
  });
}

const codes = (rows: DecisionRecallRow_ACU[]) => rows.map(row => row.indexCode);
const noSleep = async () => {};

describe('runDecisionRecall_ACU', () => {
  it('最新 5 条固定带上，其余打分后取最高的 3 条，按表号顺序排列', async () => {
    const fetch = scoringFetch(code => ({ AM0002: 5, AM0004: 4, AM0007: 4 } as Record<string, number>)[code] ?? 1);
    const result = await runDecisionRecall_ACU({ userInput: '我回到旧宅', settings: settings() }, { sources: makeSources(makeRows(12)), fetch, sleep: noSleep });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(codes(result.selected)).toEqual(['AM0002', 'AM0004', 'AM0007', 'AM0008', 'AM0009', 'AM0010', 'AM0011', 'AM0012']);
    expect(result.candidateSource).toBe('all_rows');
    expect(result.batchCount).toBe(1);
  });

  it('前文只在 state 里放一次：两楼 AI 回复加用户最新输入，不带世界书', async () => {
    const fetch = scoringFetch(() => 3);
    const chat = [{ is_user: false, mes: '回复甲' }, { is_user: true, mes: '问' }, { is_user: false, mes: '回复乙' }];
    await runDecisionRecall_ACU({ userInput: '最新输入', settings: settings() }, { sources: makeSources(makeRows(10), null, chat), fetch, sleep: noSleep });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.state).toContain('回复甲');
    expect(body.state).toContain('回复乙');
    expect(body.state).toContain('最新输入');
    expect(body.model).toBe('SemIf');
  });

  it('每组 20 条：45 条候选分 3 组，最多同时发 3 组', async () => {
    let inFlight = 0;
    let peak = 0;
    const base = scoringFetch(() => 2);
    const fetch = vi.fn(async (url: string, init: any) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      return base(url, init);
    });
    const result = await runDecisionRecall_ACU({ userInput: 'x', settings: settings() }, { sources: makeSources(makeRows(50)), fetch, sleep: noSleep });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(call => Object.keys(JSON.parse(call[1].body).questions).length)).toEqual([20, 20, 5]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(result.status === 'ok' && result.batchCount).toBe(3);
  });

  it('交火开着时只从它筛过的纪要索引里选，固定的最新 5 条照样带上', async () => {
    const fetch = scoringFetch(() => 3);
    const index = '| 时间 | 地点 | 概要 | 编码索引 |\n| a | b | c | AM0002 |\n| a | b | c | AM0003 |\n| a | b | c | AM0004 |\n| a | b | c | AM0005 |';
    const result = await runDecisionRecall_ACU({ userInput: 'x', settings: settings() }, { sources: makeSources(makeRows(30), index), fetch, sleep: noSleep });
    expect(result.status === 'ok' && result.candidateSource).toBe('crossfire_index');
    if (result.status !== 'ok') return;
    expect(result.candidateCount).toBe(4);
    expect(codes(result.selected)).toEqual(['AM0003', 'AM0004', 'AM0005', 'AM0026', 'AM0027', 'AM0028', 'AM0029', 'AM0030']);
  });

  it('候选不超过召回条数时不打分、不发请求，全部带上', async () => {
    const fetch = scoringFetch(() => 3);
    const result = await runDecisionRecall_ACU({ userInput: 'x', settings: settings({ recallCount: 10 }) }, { sources: makeSources(makeRows(12)), fetch, sleep: noSleep });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.status === 'ok' && result.selected.length).toBe(12);
  });

  it('一组失败按重试上限重试，仍失败就跳过这一组，从其余各组凑满条数', async () => {
    const fetch = vi.fn(async (url: string, init: any) => {
      const body = JSON.parse(init.body);
      const firstQuestion = Object.values<any>(body.questions)[0].instructions as string;
      if (firstQuestion.includes('AM0001')) return { ok: false, status: 503, json: async () => ({ message: '过载' }) } as any;
      return scoringFetch(() => 2)(url, init);
    });
    const sleep = vi.fn(noSleep);
    const result = await runDecisionRecall_ACU({ userInput: 'x', settings: settings({ maxRetries: 2 }) }, { sources: makeSources(makeRows(30)), fetch, sleep });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // 第一组 1 次 + 2 次重试，第二组 1 次
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(result.failedBatchCount).toBe(1);
    expect(result.unscoredCount).toBe(20);
    expect(result.errors[0]).toContain('503');
    expect(result.selected).toHaveLength(8);
    expect(result.selected.every(row => row.rowOrder >= 20)).toBe(true);
  });

  it('重试次数为 0 时失败不重试', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as any);
    const result = await runDecisionRecall_ACU({ userInput: 'x', settings: settings({ maxRetries: 0 }) }, { sources: makeSources(makeRows(12)), fetch, sleep: noSleep });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.status === 'ok' && result.failedBatchCount).toBe(1);
    expect(result.status === 'ok' && codes(result.selected)).toEqual(['AM0008', 'AM0009', 'AM0010', 'AM0011', 'AM0012']);
  });

  it('回复里一题都没答也算这一组失败，按上限重试', async () => {
    const fetch = scoringFetch(() => null);
    const result = await runDecisionRecall_ACU({ userInput: 'x', settings: settings({ maxRetries: 1 }) }, { sources: makeSources(makeRows(12)), fetch, sleep: noSleep });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.status === 'ok' && result.failedBatchCount).toBe(1);
  });

  it('漏答的纪要不带，答了的照常排序', async () => {
    const fetch = scoringFetch(code => (code === 'AM0001' ? null : 3));
    const result = await runDecisionRecall_ACU({ userInput: 'x', settings: settings({ recallCount: 6 }) }, { sources: makeSources(makeRows(12)), fetch, sleep: noSleep });
    expect(result.status === 'ok' && result.unscoredCount).toBe(1);
    expect(result.status === 'ok' && codes(result.selected)).not.toContain('AM0001');
  });

  it('遇到限流（429）时等得更久再重试', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ message: 'TPM limit' }) }) as any);
    const sleep = vi.fn(noSleep);
    await runDecisionRecall_ACU({ userInput: 'x', settings: settings({ maxRetries: 1 }) }, { sources: makeSources(makeRows(12)), fetch, sleep });
    const otherSleep = vi.fn(noSleep);
    const failing = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as any);
    await runDecisionRecall_ACU({ userInput: 'x', settings: settings({ maxRetries: 1 }) }, { sources: makeSources(makeRows(12)), fetch: failing, sleep: otherSleep });
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(otherSleep.mock.calls[0][0]);
  });

  it('没填 Key 时不发请求，只带固定的最新 5 条并标明', async () => {
    const fetch = scoringFetch(() => 3);
    const result = await runDecisionRecall_ACU({ userInput: 'x', settings: settings({ siliconflowApiKey: '' }) }, { sources: makeSources(makeRows(12)), fetch, sleep: noSleep });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.status === 'ok' && result.missingKey).toBe(true);
    expect(result.status === 'ok' && result.selected).toHaveLength(5);
  });

  it('用所选服务商的地址与 Key', async () => {
    const fetch = scoringFetch(() => 3);
    await runDecisionRecall_ACU(
      { userInput: 'x', settings: settings({ provider: 'aihubmix', aihubmixApiKey: 'sk-ahm', aihubmixModel: 'jev-1.14' }) },
      { sources: makeSources(makeRows(12)), fetch, sleep: noSleep },
    );
    expect(fetch.mock.calls[0][0]).toBe('https://aihubmix.com/v1/systemone');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-ahm');
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('jev-1.14');
  });

  it('纪要表为空或读不到时跳过，不发请求', async () => {
    const fetch = scoringFetch(() => 3);
    expect((await runDecisionRecall_ACU({ userInput: 'x', settings: settings() }, { sources: makeSources([]), fetch })).status).toBe('skipped');
    const broken: DecisionRecallSources_ACU = { ...makeSources([]), loadRows: async () => ({ rows: [], error: '纪要表缺少编码索引列' }) };
    const result = await runDecisionRecall_ACU({ userInput: 'x', settings: settings() }, { sources: broken, fetch });
    expect(result).toEqual({ status: 'skipped', reason: 'table_unavailable', message: '纪要表缺少编码索引列' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('中途中止时返回 aborted，不再发后面的组', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (url: string, init: any) => {
      controller.abort();
      return scoringFetch(() => 3)(url, init);
    });
    const result = await runDecisionRecall_ACU(
      { userInput: 'x', settings: settings(), signal: controller.signal },
      { sources: makeSources(makeRows(100)), fetch, sleep: noSleep },
    );
    expect(result.status).toBe('aborted');
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('运行日志摘要写明候选来源、分组、失败与带上的编码', async () => {
    const fetch = scoringFetch(() => 4);
    const result = await runDecisionRecall_ACU({ userInput: 'x', settings: settings() }, { sources: makeSources(makeRows(12)), fetch, sleep: noSleep });
    const text = describeDecisionRecallResult_ACU(result);
    expect(text).toContain('全部纪要');
    expect(text).toContain('分 1 组');
    expect(text).toContain('AM0012');
  });
});

describe('collectIndexedCodes_ACU', () => {
  const rows = makeRows(5);
  it('只认作为独立单元格出现的编码', () => {
    expect([...collectIndexedCodes_ACU('| x | AM0002 |\n| y | AM0004,AM0005 |', rows)!]).toEqual(['AM0002', 'AM0004', 'AM0005']);
  });
  it('一个都对不上或没有索引时返回 null（退回全部纪要）', () => {
    expect(collectIndexedCodes_ACU('| 没有编码 |', rows)).toBeNull();
    expect(collectIndexedCodes_ACU(null, rows)).toBeNull();
  });
});

describe('注入内容', () => {
  it('召回编码块是与模型回复同形的 recall 标签，一行一个编码', () => {
    expect(buildDecisionRecallTagBlock_ACU(['AM0001', 'AM0003'])).toBe('<recall>\nAM0001\nAM0003\n</recall>');
  });

  it('默认指令：用户输入替换 $8，编码块替换占位符', () => {
    const text = buildDecisionRecallFinalMessage_ACU(DEFAULT_DECISION_RECALL_DIRECTIVE_ACU, '我推开门', ['AM0002']);
    expect(text).toContain('<本轮用户输入>\n我推开门\n</本轮用户输入>');
    expect(text).toContain('<recall>\nAM0002\n</recall>');
    expect(text).not.toContain('$8');
    expect(text).not.toContain('{{recall}}');
  });

  it('指令里没有编码块占位符时追加在末尾；没有 $8 时把用户输入放在最前面', () => {
    expect(buildDecisionRecallFinalMessage_ACU('输入：$8', '你好', ['AM0001'])).toBe('输入：你好\n<recall>\nAM0001\n</recall>');
    expect(buildDecisionRecallFinalMessage_ACU('记忆：{{recall}}', '你好', ['AM0001'])).toBe('你好\n\n记忆：<recall>\nAM0001\n</recall>');
  });

  it('用户输入里碰巧带占位符字样也不会被二次替换', () => {
    const text = buildDecisionRecallFinalMessage_ACU('$8\n{{recall}}', '原样输出 {{recall}} 和 $8', ['AM0001']);
    expect(text.startsWith('原样输出 {{recall}} 和 $8\n')).toBe(true);
  });
});
