/**
 * tests/service/loop/loop-evaluator.test.ts
 * 循环标签校验 单元测试
 *
 * 注：本模块的 evaluateLoopGenerationResult_ACU 已在 v9.5.7 随死代码清理移除
 * （仅被已删除的 loop-controller.ts 引用），故此处只覆盖存活的 validateLoopTags_ACU。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

import { validateLoopTags_ACU } from '../../../src/service/loop/loop-evaluator';

describe('validateLoopTags_ACU', () => {
  it('空标签返回 true', () => {
    expect(validateLoopTags_ACU('任意内容', '')).toBe(true);
  });
  it('null 标签返回 true', () => {
    expect(validateLoopTags_ACU('任意内容', null as any)).toBe(true);
  });
  it('所有标签都存在返回 true', () => {
    expect(validateLoopTags_ACU('<plot>剧情</plot><action>动作</action>', 'plot,action')).toBe(true);
  });
  it('部分标签缺失返回 false', () => {
    expect(validateLoopTags_ACU('<plot>剧情</plot>', 'plot,action')).toBe(false);
  });
  it('中文逗号分隔', () => {
    expect(validateLoopTags_ACU('<plot>剧情</plot><action>动作</action>', 'plot，action')).toBe(true);
  });
  it('标签前后空格被 trim', () => {
    expect(validateLoopTags_ACU('<plot>剧情</plot>', '  plot  ')).toBe(true);
  });
  it('空内容返回 false', () => {
    expect(validateLoopTags_ACU('', 'plot')).toBe(false);
  });
});
