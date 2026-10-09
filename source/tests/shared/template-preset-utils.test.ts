/**
 * tests/shared/template-preset-utils.test.ts
 * 模板预设纯工具函数 单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeTemplatePresetSelectionValue_ACU,
  derivePresetNameFromFilename_ACU,
  deriveTemplatePresetNameForImport_ACU,
  sanitizeFilenameComponent_ACU,
  getCurrentCharacterCardName_ACU,
} from '../../src/shared/template-preset-utils';

describe('normalizeTemplatePresetSelectionValue_ACU', () => {
  it('正常预设名原样返回', () => {
    expect(normalizeTemplatePresetSelectionValue_ACU('我的预设')).toBe('我的预设');
  });
});

describe('derivePresetNameFromFilename_ACU', () => {

  it('无扩展名原样返回', () => {
    expect(derivePresetNameFromFilename_ACU('预设A')).toBe('预设A');
  });

  it('多个点号只去除最后一个扩展名', () => {
    expect(derivePresetNameFromFilename_ACU('my.preset.v2.json')).toBe('my.preset.v2');
  });
});

describe('sanitizeFilenameComponent_ACU', () => {
  it('正常文件名不变', () => {
    expect(sanitizeFilenameComponent_ACU('预设A')).toBe('预设A');
  });

  it('替换非法字符为下划线', () => {
    expect(sanitizeFilenameComponent_ACU('a\\b/c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('超过 80 字符截断', () => {
    const longName = 'a'.repeat(100);
    expect(sanitizeFilenameComponent_ACU(longName).length).toBeLessThanOrEqual(80);
  });
});

describe('deriveTemplatePresetNameForImport_ACU', () => {

  it('都为空时使用 fallbackLabel', () => {
    expect(deriveTemplatePresetNameForImport_ACU({
      presetName: '',
      filename: '',
      fallbackLabel: '兜底名称',
      allowCharacterFallback: false,
    })).toBe('兜底名称');
  });
});

// ═══ getCurrentCharacterCardName_ACU ═══
describe('getCurrentCharacterCardName_ACU', () => {
  it('有 SillyTavern context 时返回 name2', () => {
    (globalThis as any).window = {
      SillyTavern: {
        getContext: () => ({ name2: '勇者B', characters: [], characterId: 0 }),
      },
    };
    expect(getCurrentCharacterCardName_ACU()).toBe('勇者B');
  });
});
