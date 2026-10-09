/**
 * 正文替换默认提示词末尾的「审核要求」段（SYSTEM），以及存量默认提示词的升级。
 */
import { describe, expect, it } from 'vitest';
import {
  buildDefaultContentOptimizationPromptGroup_ACU,
  upgradeContentOptimizationDefaultPrompt_ACU,
} from '../../src/shared/defaults';

describe('正文替换默认提示词', () => {
  it('最后一段是 SYSTEM 发送的审核要求', () => {
    const group = buildDefaultContentOptimizationPromptGroup_ACU();
    const last = group[group.length - 1];
    expect(last.role).toBe('SYSTEM');
    expect(last.content.startsWith('【审核要求】')).toBe(true);
    expect(last.content).toContain('获得了创作内容上的真正意义上的自由');
  });

  it('还在用旧默认提示词（未改动）时升级为新默认', () => {
    const legacy = buildDefaultContentOptimizationPromptGroup_ACU().slice(0, -1);
    const settings: any = { contentOptimizationSettings: { promptGroup: legacy } };

    expect(upgradeContentOptimizationDefaultPrompt_ACU(settings)).toBe(true);
    expect(settings.contentOptimizationSettings.promptGroup).toEqual(buildDefaultContentOptimizationPromptGroup_ACU());
  });

  it('自定义过的提示词、已是新默认、或没有提示词时不动', () => {
    const custom = buildDefaultContentOptimizationPromptGroup_ACU().slice(0, -1);
    custom[0] = { ...custom[0], content: '我自己改过' };
    const customSettings: any = { contentOptimizationSettings: { promptGroup: custom } };
    expect(upgradeContentOptimizationDefaultPrompt_ACU(customSettings)).toBe(false);
    expect(customSettings.contentOptimizationSettings.promptGroup).toBe(custom);

    const current: any = { contentOptimizationSettings: { promptGroup: buildDefaultContentOptimizationPromptGroup_ACU() } };
    expect(upgradeContentOptimizationDefaultPrompt_ACU(current)).toBe(false);
    expect(upgradeContentOptimizationDefaultPrompt_ACU({ contentOptimizationSettings: {} })).toBe(false);
    expect(upgradeContentOptimizationDefaultPrompt_ACU({})).toBe(false);
  });
});
