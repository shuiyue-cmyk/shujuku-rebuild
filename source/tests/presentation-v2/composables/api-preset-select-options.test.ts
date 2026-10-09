import { describe, expect, it } from 'vitest';
import { formatFollowActiveApiLabel } from '../../../src/presentation-v2/composables/useApiPresetSelectOptions';

describe('formatFollowActiveApiLabel：「跟随当前」选项直接显示预设名', () => {
  it('有当前预设时以预设名开头，只带短标记区分同名的固定选项', () => {
    expect(formatFollowActiveApiLabel('DeepSeek 官方')).toBe('DeepSeek 官方（当前）');
    expect(formatFollowActiveApiLabel('  Fast  ')).toBe('Fast（当前）');
  });

  it('没有当前预设时给短兜底，不出现「跟随当前活动 API」长句', () => {
    expect(formatFollowActiveApiLabel('')).toBe('当前 API');
    expect(formatFollowActiveApiLabel('   ')).toBe('当前 API');
  });
});
