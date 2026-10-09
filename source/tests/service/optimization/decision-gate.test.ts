/**
 * tests/service/optimization/decision-gate.test.ts
 * 正文替换「替换前判定」：OpenRouter 决策模型的请求、结果解读与失败兜底。
 */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ settings: { contentOptimizationSettings: {} as any } }));
vi.mock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: h.settings }));

import {
  DECISION_API_URL_ACU,
  DEFAULT_DECISION_MODEL_ACU,
  buildDecisionRequestBody_ACU,
  fetchDecisionModels_ACU,
  interpretDecisionResponse_ACU,
  judgeContentForAutoReplace_ACU,
  normalizeDecisionGateSettings_ACU,
  requestContentDecision_ACU,
} from '../../../src/service/optimization/decision-gate';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any;
}

function choiceAnswer(choice: string, good: number) {
  return {
    model: 'typesafe/jev-1.13-20260917',
    answers: { quality: { type: 'choice', choice, confidence: 0.5, probabilities: { 好: good, 不好: 1 - good } } },
    usage: { input_tokens: 10, output_tokens: 0, cost: 0 },
  };
}

describe('normalizeDecisionGateSettings_ACU', () => {
  it('缺省时关闭、默认模型、门槛 50', () => {
    expect(normalizeDecisionGateSettings_ACU(undefined)).toEqual({
      enabled: false, apiKey: '', model: DEFAULT_DECISION_MODEL_ACU, threshold: 50,
    });
  });

  it('门槛夹到 0–100 并取整，key 去首尾空白', () => {
    expect(normalizeDecisionGateSettings_ACU({ enabled: true, apiKey: ' sk-or-x ', model: 'a/b', threshold: 140 }))
      .toEqual({ enabled: true, apiKey: 'sk-or-x', model: 'a/b', threshold: 100 });
    expect(normalizeDecisionGateSettings_ACU({ threshold: -3 }).threshold).toBe(0);
    expect(normalizeDecisionGateSettings_ACU({ threshold: '72.6' }).threshold).toBe(73);
  });
});

describe('buildDecisionRequestBody_ACU', () => {
  it('问「这篇文章写得好不好」，选项只有「好」「不好」', () => {
    const body = buildDecisionRequestBody_ACU('typesafe/jev-1.13', '正文');
    expect(body.model).toBe('typesafe/jev-1.13');
    expect(body.state).toBe('正文');
    const question = body.questions.quality;
    expect(question.type).toBe('choice');
    expect(question.instructions).toContain('这篇文章写得好不好');
    expect(Object.keys(question.criteria)).toEqual(['好', '不好']);
  });
});

describe('interpretDecisionResponse_ACU', () => {
  it('「好」的概率达到门槛才替换', () => {
    expect(interpretDecisionResponse_ACU(choiceAnswer('好', 0.8), 50))
      .toMatchObject({ kind: 'decided', replace: true, choice: '好', goodProbability: 0.8 });
    expect(interpretDecisionResponse_ACU(choiceAnswer('好', 0.6), 70))
      .toMatchObject({ kind: 'decided', replace: false, goodProbability: 0.6 });
    expect(interpretDecisionResponse_ACU(choiceAnswer('不好', 0.2), 50))
      .toMatchObject({ kind: 'decided', replace: false, choice: '不好' });
  });

  it('没给概率时按所选项计 0 / 1', () => {
    const payload = { answers: { quality: { type: 'choice', choice: '好' } } };
    expect(interpretDecisionResponse_ACU(payload, 50)).toMatchObject({ kind: 'decided', replace: true, goodProbability: 1 });
  });

  it('概率以数组形式返回也能读取', () => {
    const payload = { answers: { quality: { type: 'choice', choice: '不好', probabilities: [
      { choice: '好', probability: 0.45 }, { choice: '不好', probability: 0.55 },
    ] } } };
    expect(interpretDecisionResponse_ACU(payload, 40)).toMatchObject({ kind: 'decided', replace: true, goodProbability: 0.45 });
  });

  it('答非所问时报错，而不是当成「不好」', () => {
    expect(interpretDecisionResponse_ACU({ answers: {} }, 50).kind).toBe('error');
    expect(interpretDecisionResponse_ACU({ answers: { quality: { choice: 'maybe' } } }, 50).kind).toBe('error');
  });
});

describe('requestContentDecision_ACU', () => {
  const settings = normalizeDecisionGateSettings_ACU({ enabled: true, apiKey: 'sk-or-test', model: 'm/x', threshold: 50 });

  it('直连 OpenRouter 决策接口并带上 key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, choiceAnswer('好', 0.9)));
    const verdict = await requestContentDecision_ACU('一段正文', settings, { fetch: fetchImpl });

    expect(verdict).toMatchObject({ kind: 'decided', replace: true });
    const [url, init] = fetchImpl.mock.calls[0] as any[];
    expect(url).toBe(DECISION_API_URL_ACU);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-or-test');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'm/x', state: '一段正文' });
  });

  it('没填 key 时不发请求，直接报错', async () => {
    const fetchImpl = vi.fn();
    const verdict = await requestContentDecision_ACU('正文', { ...settings, apiKey: '' }, { fetch: fetchImpl });
    expect(verdict.kind).toBe('error');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('接口报错时带回状态码与原因', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: { code: 401, message: 'User not found.' } }));
    const verdict = await requestContentDecision_ACU('正文', settings, { fetch: fetchImpl });
    expect(verdict.kind).toBe('error');
    expect((verdict as any).message).toContain('401');
    expect((verdict as any).message).toContain('User not found.');
  });

  it('网络异常与超时都返回错误，不抛出', async () => {
    const failing = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect((await requestContentDecision_ACU('正文', settings, { fetch: failing })).kind).toBe('error');

    const hanging = vi.fn((_url: string, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const verdict = await requestContentDecision_ACU('正文', settings, { fetch: hanging as any, timeoutMs: 5 });
    expect(verdict.kind).toBe('error');
    expect((verdict as any).message).toContain('超时');
  });
});

describe('fetchDecisionModels_ACU', () => {
  it('只取决策类模型，标出免费版', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { data: [
      { id: 'typesafe/jev-1.13', name: 'TypeSafe: Jev 1.13', architecture: { output_modalities: ['decisions'] }, pricing: { prompt: '0.000000042' } },
      { id: 'inception/mercury-decide:free', name: 'Inception: Mercury Decide (free)', architecture: { output_modalities: ['decisions'] }, pricing: { prompt: '0' } },
      { id: 'some/chat-model', name: 'Chat', architecture: { output_modalities: ['text'] }, pricing: { prompt: '0.000001' } },
    ] }));

    const models = await fetchDecisionModels_ACU({ fetch: fetchImpl });

    expect(models).toEqual([
      { id: 'typesafe/jev-1.13', name: 'TypeSafe: Jev 1.13', free: false },
      { id: 'inception/mercury-decide:free', name: 'Inception: Mercury Decide (free)', free: true },
    ]);
  });
});

describe('judgeContentForAutoReplace_ACU', () => {
  it('开关关闭时不发请求', async () => {
    h.settings.contentOptimizationSettings = { decisionGate: { enabled: false, apiKey: 'sk-or-x' } };
    const fetchImpl = vi.fn();
    expect(await judgeContentForAutoReplace_ACU('正文', { fetch: fetchImpl })).toEqual({ kind: 'disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('送去判定的正文去掉 MVU 变量块，免得变量数据干扰判断', async () => {
    h.settings.contentOptimizationSettings = { decisionGate: { enabled: true, apiKey: 'sk-or-x', threshold: 50 } };
    const fetchImpl = vi.fn(async () => jsonResponse(200, choiceAnswer('好', 0.7)));

    const verdict = await judgeContentForAutoReplace_ACU('她推开门。\n\n<UpdateVariable>_.set("a", 1, 2);</UpdateVariable>', { fetch: fetchImpl });

    expect(verdict).toMatchObject({ kind: 'decided', replace: true });
    const body = JSON.parse((fetchImpl.mock.calls[0] as any[])[1].body);
    expect(body.state).toBe('她推开门。');
    expect(body.model).toBe(DEFAULT_DECISION_MODEL_ACU);
  });
});

describe('复审修正', () => {
  it('门槛清空 / 为 null 时回到 50，不会变成 0% 让判定形同虚设', () => {
    expect(normalizeDecisionGateSettings_ACU({ threshold: '' }).threshold).toBe(50);
    expect(normalizeDecisionGateSettings_ACU({ threshold: null }).threshold).toBe(50);
    expect(normalizeDecisionGateSettings_ACU({ threshold: '  ' }).threshold).toBe(50);
  });

  it('概率恰好等于门槛时算达到（不受浮点误差影响）', () => {
    expect(interpretDecisionResponse_ACU(choiceAnswer('好', 0.57), 57)).toMatchObject({ replace: true });
    expect(interpretDecisionResponse_ACU(choiceAnswer('不好', 0.29), 29)).toMatchObject({ replace: true });
    expect(interpretDecisionResponse_ACU(choiceAnswer('不好', 0.28), 29)).toMatchObject({ replace: false });
  });

  it('开启但没填 key 时视同未开启，不会每楼都报错', async () => {
    h.settings.contentOptimizationSettings = { decisionGate: { enabled: true, apiKey: '' } };
    const fetchImpl = vi.fn();
    expect(await judgeContentForAutoReplace_ACU('正文', { fetch: fetchImpl })).toEqual({ kind: 'disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('外部取消信号会中断在途判定', async () => {
    const settings = normalizeDecisionGateSettings_ACU({ enabled: true, apiKey: 'sk-or-x' });
    const hanging = vi.fn((_url: string, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const controller = new AbortController();
    const pending = requestContentDecision_ACU('正文', settings, { fetch: hanging as any, signal: controller.signal });
    controller.abort();
    const verdict = await pending;
    expect(verdict.kind).toBe('error');
    expect((verdict as any).message).toContain('取消');
  });

  it('只有价格明确全为 0 才标免费；价格缺失或按次收费都不算', async () => {
    const decisions = { output_modalities: ['decisions'] };
    const fetchImpl = vi.fn(async () => jsonResponse(200, { data: [
      { id: 'a/free', name: 'A', architecture: decisions, pricing: { prompt: '0', completion: '0' } },
      { id: 'b/unknown', name: 'B', architecture: decisions, pricing: { prompt: null } },
      { id: 'c/empty', name: 'C', architecture: decisions, pricing: { prompt: '' } },
      { id: 'd/per-request', name: 'D', architecture: decisions, pricing: { prompt: '0', request: '0.001' } },
      { id: 'e/none', name: 'E', architecture: decisions },
    ] }));
    const models = await fetchDecisionModels_ACU({ fetch: fetchImpl });
    expect(models.filter(model => model.free).map(model => model.id)).toEqual(['a/free']);
  });

  it('拉取模型列表卡住时超时报错，而不是一直等', async () => {
    const hanging = vi.fn((_url: string, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    await expect(fetchDecisionModels_ACU({ fetch: hanging as any, timeoutMs: 5 })).rejects.toThrow('超时');
  });
});
