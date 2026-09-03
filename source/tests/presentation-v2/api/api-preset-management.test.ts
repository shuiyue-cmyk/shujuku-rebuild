/**
 * API preset draft helpers — 面板内新建/编辑表单的数据转换
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  apiPresetDraftFromPreset,
  apiPresetFromDraft,
  createEmptyApiPresetDraft,
} from '../../../src/presentation-v2/composables/useApiPresetManagement';

describe('api preset draft helpers', () => {
  it('从空白草稿开始新建预设', () => {
    const draft = createEmptyApiPresetDraft();

    expect(draft.name).toBe('');
    expect(draft.apiMode).toBe('custom');
  });

  it('把预设转换为可编辑草稿', () => {
    const draft = apiPresetDraftFromPreset({
      name: 'preset-a',
      apiMode: 'custom',
      apiConfig: {
        url: 'https://a.test',
        apiKey: 'k',
        model: 'gpt-4',
        max_tokens: 4096,
        temperature: 0.7,
      },
    });

    expect(draft.name).toBe('preset-a');
    expect(draft.url).toBe('https://a.test');
    expect(draft.model).toBe('gpt-4');
  });

  it('保存前归一化名称、端点、模型和数字参数', () => {
    const preset = apiPresetFromDraft({
      ...createEmptyApiPresetDraft(),
      name: '  preset-b  ',
      url: '  https://b.test/v1  ',
      model: '  model-b  ',
      max_tokens: 128.8,
      temperature: Number.NaN,
    });

    expect(preset.name).toBe('preset-b');
    expect(preset.apiConfig.url).toBe('https://b.test/v1');
    expect(preset.apiConfig.model).toBe('model-b');
    expect(preset.apiConfig.max_tokens).toBe(128);
    expect(preset.apiConfig.temperature).toBe(1);
  });

  it('三个附加参数字段在 draft 转换中保留', () => {
    const draft = apiPresetDraftFromPreset({
      name: 'extra',
      apiMode: 'custom',
      apiConfig: {
        url: 'https://x.test',
        apiKey: 'k',
        model: 'm',
        max_tokens: 1000,
        temperature: 1,
        bodyParams: 'top_k: 50',
        excludeBodyParams: 'top_p',
        requestHeaders: 'X-Custom: val',
      },
    });

    expect(draft.bodyParams).toBe('top_k: 50');
    expect(draft.excludeBodyParams).toBe('top_p');
    expect(draft.requestHeaders).toBe('X-Custom: val');

    const preset = apiPresetFromDraft(draft);
    expect(preset.apiConfig.bodyParams).toBe('top_k: 50');
    expect(preset.apiConfig.excludeBodyParams).toBe('top_p');
    expect(preset.apiConfig.requestHeaders).toBe('X-Custom: val');
  });

  it('旧预设缺失附加参数字段时归一为空字符串', () => {
    const draft = apiPresetDraftFromPreset({
      name: 'old',
      apiMode: 'custom',
      apiConfig: {
        url: 'https://old.test',
        apiKey: '',
        model: 'old-model',
        max_tokens: 2000,
        temperature: 0.5,
      } as any,
    });

    expect(draft.bodyParams).toBe('');
    expect(draft.excludeBodyParams).toBe('');
    expect(draft.requestHeaders).toBe('');
  });

  // ═══ A2 护栏：streamingEnabled / reasoningEffort 的 undefined（跟随全局）通道 ═══
  it('旧预设未配置流式/思考强度时 draft 保持 undefined，往返保存不写键（打开即污染回归锁）', () => {
    const legacy = {
      name: 'legacy',
      apiMode: 'custom',
      apiConfig: { url: 'https://l.test', apiKey: '', model: 'l', max_tokens: 100, temperature: 1 },
    } as any;

    const draft = apiPresetDraftFromPreset(legacy);
    expect(draft.streamingEnabled).toBeUndefined();
    expect(draft.reasoningEffort).toBeUndefined();

    // 用户没碰过这两个控件就保存：键必须缺席，api-call 的「预设优先」判定不会截胡全局回退。
    const preset = apiPresetFromDraft(draft);
    expect('streamingEnabled' in preset.apiConfig).toBe(false);
    expect('reasoningEffort' in preset.apiConfig).toBe(false);

    // 二次往返稳定：不再出现 false/'medium' 固化。
    const round2 = apiPresetFromDraft(apiPresetDraftFromPreset(preset as any));
    expect('streamingEnabled' in round2.apiConfig).toBe(false);
    expect('reasoningEffort' in round2.apiConfig).toBe(false);
  });

  it('显式配置流式 false / 思考强度后写键并往返保留（false 不被当成未配置丢弃）', () => {
    const draft = apiPresetDraftFromPreset({
      name: 'explicit',
      apiMode: 'custom',
      apiConfig: {
        url: 'https://e.test', apiKey: '', model: 'e', max_tokens: 100, temperature: 1,
        streamingEnabled: false, reasoningEffort: 'xhigh',
      },
    } as any);
    expect(draft.streamingEnabled).toBe(false);
    expect(draft.reasoningEffort).toBe('xhigh');

    const preset = apiPresetFromDraft(draft);
    expect(preset.apiConfig.streamingEnabled).toBe(false);
    expect(preset.apiConfig.reasoningEffort).toBe('xhigh');
  });

  it('思考强度 false / auto 往返保留（字符串档位不被当成未配置丢弃）', () => {
    for (const value of ['false', 'auto']) {
      const draft = apiPresetDraftFromPreset({
        name: 'effort-modes',
        apiMode: 'custom',
        apiConfig: {
          url: 'https://e.test', apiKey: '', model: 'e', max_tokens: 100, temperature: 1,
          reasoningEffort: value,
        },
      } as any);
      expect(draft.reasoningEffort).toBe(value);
      expect(apiPresetFromDraft(draft).apiConfig.reasoningEffort).toBe(value);
    }
  });

  // ═══ 提示词后处理 / 接口协议：与请求体共用归一化 ═══
  it('旧预设缺失 promptPostProcessing / customApiFormat 时草稿归一为运行时默认值，而不是「未选择」', () => {
    const draft = apiPresetDraftFromPreset({
      name: 'legacy',
      apiMode: 'custom',
      apiConfig: {
        url: 'https://old.test',
        apiKey: '',
        model: 'old-model',
        max_tokens: 2000,
        temperature: 0.5,
      } as any,
    });

    // 运行时请求体对缺失字段按 strict 发送；草稿若显示「未选择」，用户直接保存就会把行为静默改成透传。
    expect(draft.promptPostProcessing).toBe('strict');
    expect(draft.customApiFormat).toBe('openai_compat');

    const preset = apiPresetFromDraft(draft);
    expect(preset.apiConfig.promptPostProcessing).toBe('strict');
    expect(preset.apiConfig.customApiFormat).toBe('openai_compat');
  });

  it('提示词后处理与接口协议在草稿转换中往返保留，显式「未选择」（空串）不被改写', () => {
    const draft = apiPresetDraftFromPreset({
      name: 'protocol',
      apiMode: 'custom',
      apiConfig: {
        url: 'https://api.example.com',
        apiKey: 'k',
        model: 'claude',
        max_tokens: 1000,
        temperature: 1,
        promptPostProcessing: '',
        customApiFormat: 'claude_messages',
      } as any,
    });

    expect(draft.promptPostProcessing).toBe('');
    expect(draft.customApiFormat).toBe('claude_messages');

    const preset = apiPresetFromDraft(draft);
    expect(preset.apiConfig.promptPostProcessing).toBe('');
    expect(preset.apiConfig.customApiFormat).toBe('claude_messages');
  });

  it('草稿中的非法提示词后处理 / 接口协议值保存时回退默认，不写入预设', () => {
    const preset = apiPresetFromDraft({
      ...createEmptyApiPresetDraft(),
      name: 'invalid',
      url: 'https://x.test',
      model: 'm',
      promptPostProcessing: 'fake-mode' as any,
      customApiFormat: 'unknown_format' as any,
    });

    expect(preset.apiConfig.promptPostProcessing).toBe('strict');
    expect(preset.apiConfig.customApiFormat).toBe('openai_compat');
  });

  it('空白草稿默认 strict 后处理与兼容 OpenAI 协议', () => {
    const draft = createEmptyApiPresetDraft();

    expect(draft.promptPostProcessing).toBe('strict');
    expect(draft.customApiFormat).toBe('openai_compat');
  });
});
