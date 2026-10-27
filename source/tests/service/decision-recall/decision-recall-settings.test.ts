/**
 * tests/service/decision-recall/decision-recall-settings.test.ts
 * 决策召回设置的规整：默认值、条数与重试上限的夹取、服务商与注入指令回退。
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeDecisionRecallSettings_ACU,
  resolveDecisionRecallEndpoint_ACU,
} from '../../../src/service/decision-recall/decision-recall-settings';
import { DECISION_API_URL_ACU, SILICONFLOW_DECISION_API_URL_ACU } from '../../../src/service/optimization/decision-gate';
import {
  DEFAULT_DECISION_RECALL_DIRECTIVE_ACU,
  DECISION_RECALL_MAX_COUNT_ACU,
} from '../../../src/shared/decision-recall-defaults';
import { DEFAULT_DECISION_MODEL_ACU, DEFAULT_SILICONFLOW_DECISION_MODEL_ACU } from '../../../src/shared/decision-gate-defaults';

describe('normalizeDecisionRecallSettings_ACU', () => {
  it('缺省时关闭、硅基流动、召回 20 条、看概要加正文、重试 2 次、默认注入指令', () => {
    expect(normalizeDecisionRecallSettings_ACU(undefined)).toEqual({
      enabled: false,
      provider: 'siliconflow',
      openrouterApiKey: '',
      openrouterModel: DEFAULT_DECISION_MODEL_ACU,
      siliconflowApiKey: '',
      siliconflowModel: DEFAULT_SILICONFLOW_DECISION_MODEL_ACU,
      aihubmixApiKey: '',
      aihubmixModel: 'jev-latest',
      recallCount: 20,
      scoringContent: 'full',
      maxRetries: 2,
      directive: DEFAULT_DECISION_RECALL_DIRECTIVE_ACU,
    });
  });

  it('召回条数夹到 1–45 并取整：固定 5 条加上它合计不超过 50', () => {
    expect(DECISION_RECALL_MAX_COUNT_ACU).toBe(45);
    expect(normalizeDecisionRecallSettings_ACU({ recallCount: 80 }).recallCount).toBe(45);
    expect(normalizeDecisionRecallSettings_ACU({ recallCount: 0 }).recallCount).toBe(1);
    expect(normalizeDecisionRecallSettings_ACU({ recallCount: '12.6' }).recallCount).toBe(13);
  });

  it('清空召回条数或重试次数时回到默认值，而不是被当成 0', () => {
    expect(normalizeDecisionRecallSettings_ACU({ recallCount: '' }).recallCount).toBe(20);
    expect(normalizeDecisionRecallSettings_ACU({ maxRetries: '' }).maxRetries).toBe(2);
    expect(normalizeDecisionRecallSettings_ACU({ maxRetries: null }).maxRetries).toBe(2);
  });

  it('重试次数夹到 0–5，0 表示不重试', () => {
    expect(normalizeDecisionRecallSettings_ACU({ maxRetries: 0 }).maxRetries).toBe(0);
    expect(normalizeDecisionRecallSettings_ACU({ maxRetries: 9 }).maxRetries).toBe(5);
    expect(normalizeDecisionRecallSettings_ACU({ maxRetries: -1 }).maxRetries).toBe(0);
  });

  it('只认已知的服务商与打分内容，其它值回到默认', () => {
    expect(normalizeDecisionRecallSettings_ACU({ provider: 'openrouter' }).provider).toBe('openrouter');
    expect(normalizeDecisionRecallSettings_ACU({ provider: 'aihubmix' }).provider).toBe('aihubmix');
    expect(normalizeDecisionRecallSettings_ACU({ provider: 'aliyun' }).provider).toBe('siliconflow');
    expect(normalizeDecisionRecallSettings_ACU({ scoringContent: 'summary' }).scoringContent).toBe('summary');
    expect(normalizeDecisionRecallSettings_ACU({ scoringContent: 'all' }).scoringContent).toBe('full');
  });

  it('注入指令清空时回到默认，Key 去首尾空白，模型清空回到默认', () => {
    const settings = normalizeDecisionRecallSettings_ACU({
      directive: '   ',
      openrouterApiKey: ' sk-or-x ',
      siliconflowApiKey: ' sk-y ',
      openrouterModel: ' ',
      siliconflowModel: 'Kev-4B',
    });
    expect(settings.directive).toBe(DEFAULT_DECISION_RECALL_DIRECTIVE_ACU);
    expect(settings.openrouterApiKey).toBe('sk-or-x');
    expect(settings.siliconflowApiKey).toBe('sk-y');
    expect(settings.openrouterModel).toBe(DEFAULT_DECISION_MODEL_ACU);
    expect(settings.siliconflowModel).toBe('Kev-4B');
  });

  it('自定义注入指令原样保留（不去掉首尾换行以外的内容）', () => {
    expect(normalizeDecisionRecallSettings_ACU({ directive: '记忆：{{recall}}\n输入：$8' }).directive).toBe('记忆：{{recall}}\n输入：$8');
  });
});

describe('resolveDecisionRecallEndpoint_ACU', () => {
  it('按所选服务商取各自的地址、Key 与模型，两家互不影响', () => {
    const base = normalizeDecisionRecallSettings_ACU({
      openrouterApiKey: 'sk-or', openrouterModel: 'a/b', siliconflowApiKey: 'sk-sf', siliconflowModel: 'SemIf',
      aihubmixApiKey: 'sk-ahm', aihubmixModel: 'jev-1.14',
    });
    expect(resolveDecisionRecallEndpoint_ACU({ ...base, provider: 'openrouter' })).toEqual({
      label: 'OpenRouter', url: DECISION_API_URL_ACU, apiKey: 'sk-or', model: 'a/b',
    });
    expect(resolveDecisionRecallEndpoint_ACU({ ...base, provider: 'siliconflow' })).toEqual({
      label: '硅基流动（中国）', url: SILICONFLOW_DECISION_API_URL_ACU, apiKey: 'sk-sf', model: 'SemIf',
    });
    expect(resolveDecisionRecallEndpoint_ACU({ ...base, provider: 'aihubmix' })).toEqual({
      label: 'AIHubMix', url: 'https://aihubmix.com/v1/systemone', apiKey: 'sk-ahm', model: 'jev-1.14',
    });
  });
});
