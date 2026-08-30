import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/plot/plot-logic', () => ({
  getCurrentRuntimePlotPresetName_ACU: vi.fn(),
}));
vi.mock('../../../src/service/settings/api-preset-service', () => ({
  resolveApiConfigByPreset_ACU: vi.fn(),
}));

import { buildDefaultContinuationSettings_ACU } from '../../../src/service/continuation/defaults';
import { ContinuationValidationError_ACU } from '../../../src/service/continuation/model';
import { resolveContinuationApiPreset_ACU } from '../../../src/service/continuation/api-preset';
import {
  renderContinuationPrompt_ACU,
  restoreContinuationPromptDefault_ACU,
} from '../../../src/service/continuation/prompt-template';

async function expectAsyncCode_ACU(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
    expect((error as ContinuationValidationError_ACU).error.code).toBe(code);
    return;
  }
  throw new Error(`Expected validation error ${code}`);
}

const apiConfig = { url: 'https://example.invalid', apiKey: '', model: 'test', useMainApi: false, max_tokens: 128, temperature: 1, bodyParams: '', excludeBodyParams: '', requestHeaders: '' };

describe('continuation prompt templates', () => {
  it('resolves only placeholders that are actually present and preserves unknown text', async () => {
    const origin = vi.fn(() => 'initial instruction');
    const worldbook = vi.fn(() => 'must not be read');

    const rendered = await renderContinuationPrompt_ACU(
      [{ role: 'user', content: '$ORIGIN_INSTRUCTION / $ORIGIN_INSTRUCTION / $NOT_A_TOKEN' }],
      { $ORIGIN_INSTRUCTION: origin, $1: worldbook },
      'outline_prompt',
    );

    expect(rendered.messages).toEqual([{ role: 'user', content: 'initial instruction / initial instruction / $NOT_A_TOKEN' }]);
    expect(rendered.usedPlaceholders).toEqual(['$ORIGIN_INSTRUCTION']);
    expect(origin).toHaveBeenCalledTimes(1);
    expect(worldbook).not.toHaveBeenCalled();
  });

  it('does not resolve placeholders from disabled segments and rejects an all-disabled prompt', async () => {
    const disabledResolver = vi.fn(() => 'must not resolve');
    const enabledResolver = vi.fn(() => 'current instruction');

    await expect(renderContinuationPrompt_ACU([
      { role: 'system', content: '$1', enabled: false },
      { role: 'user', content: '$ORIGIN_INSTRUCTION', enabled: true },
    ], { $1: disabledResolver, $ORIGIN_INSTRUCTION: enabledResolver }, 'outline_prompt'))
      .resolves.toMatchObject({ messages: [{ role: 'user', content: 'current instruction' }], usedPlaceholders: ['$ORIGIN_INSTRUCTION'] });
    expect(disabledResolver).not.toHaveBeenCalled();
    expect(enabledResolver).toHaveBeenCalledOnce();

    await expectAsyncCode_ACU(
      () => renderContinuationPrompt_ACU([{ role: 'user', content: 'disabled', enabled: false }], {}, 'outline_prompt'),
      'CONTINUATION_PROMPT_EMPTY',
    );
  });

  it('uses empty text for absent optional data and rejects invalid custom prompt segments', async () => {
    await expect(renderContinuationPrompt_ACU([{ role: 'system', content: 'A $STORY_TAIL B' }], {}, 'turn_prompt'))
      .resolves.toMatchObject({ messages: [{ content: 'A  B' }] });
    await expectAsyncCode_ACU(
      () => renderContinuationPrompt_ACU([{ role: 'tool', content: 'invalid' }], {}, 'outline_prompt'),
      'CONTINUATION_PROMPT_INVALID',
    );
  });

  it('restores only the selected prompt default', () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.outlinePrompt = [{ role: 'user', content: 'custom outline', deletable: true }];
    settings.agentPrompts.main = [{ role: 'user', content: 'custom main', deletable: true }];
    settings.agentPrompts.reviewer = [{ role: 'user', content: 'custom reviewer', deletable: true }];
    const restoredOutline = restoreContinuationPromptDefault_ACU(settings, 'outline');

    expect(restoredOutline.outlinePrompt[0].content).toContain('<stage_title>');
    expect(restoredOutline.agentPrompts.main[0].content).toBe('custom main');
    expect(restoredOutline.agentPrompts.reviewer[0].content).toBe('custom reviewer');
    expect(restoredOutline).toMatchObject({ apiPresetMode: 'current', maxAutomaticStages: 6 });

    const restoredMain = restoreContinuationPromptDefault_ACU(restoredOutline, 'agent_main');
    expect(restoredMain.agentPrompts.main[0].content).toContain('主控 Agent');
    expect(restoredMain.agentPrompts.reviewer[0].content).toBe('custom reviewer');
  });
});

describe('continuation API preset resolution', () => {
  it('resolves current at each call with explicit source diagnostics', () => {
    let plotPreset = 'plot-a';
    const resolvePreset = vi.fn((name: string) => ({ resolved: true, apiMode: 'custom' as const, apiConfig, tavernProfile: name }));
    const dependencies = { resolvePreset };
    const settings = buildDefaultContinuationSettings_ACU();

    expect(resolveContinuationApiPreset_ACU(settings, 'outline_call', dependencies)).toMatchObject({ presetName: '', source: 'current', reason: 'current_configuration' });
    plotPreset = 'plot-b';
    expect(resolveContinuationApiPreset_ACU(settings, 'turn_call', dependencies)).toMatchObject({ presetName: '', source: 'current', reason: 'current_configuration' });
    expect(resolvePreset).toHaveBeenCalledWith('');
  });

  it('fails closed when a fixed preset is empty or unresolved', () => {
    const settings = { ...buildDefaultContinuationSettings_ACU(), apiPresetMode: 'fixed' as const, fixedApiPresetName: 'deleted' };
    const missing = { resolvePreset: () => ({ resolved: false, apiMode: 'custom' as const, apiConfig, tavernProfile: '' }) };

    expect(() => resolveContinuationApiPreset_ACU(settings, 'outline_call', missing)).toThrow(ContinuationValidationError_ACU);
    try { resolveContinuationApiPreset_ACU(settings, 'outline_call', missing); } catch (error) {
      expect((error as ContinuationValidationError_ACU).error.code).toBe('CONTINUATION_API_PRESET_MISSING');
    }

    expect(() => resolveContinuationApiPreset_ACU({ ...settings, fixedApiPresetName: '  ' }, 'turn_call', missing)).toThrow(ContinuationValidationError_ACU);
    try { resolveContinuationApiPreset_ACU({ ...settings, fixedApiPresetName: '  ' }, 'turn_call', missing); } catch (error) {
      expect((error as ContinuationValidationError_ACU).error.code).toBe('CONTINUATION_API_PRESET_MISSING');
    }
  });
});
