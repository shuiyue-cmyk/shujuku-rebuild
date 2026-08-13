/**
 * tests/shared/template-preset-utils.test.ts
 * 模板预设纯工具函数 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU,
  normalizeTemplatePresetSelectionValue_ACU,
  isDefaultTemplatePresetSelection_ACU,
  getCurrentTemplatePresetName_ACU,
  derivePresetNameFromFilename_ACU,
  deriveTemplatePresetNameForImport_ACU,
  sanitizeFilenameComponent_ACU,
  getCurrentCharacterCardName_ACU,
} from '../../src/shared/template-preset-utils';

describe('normalizeTemplatePresetSelectionValue_ACU', () => {
  it('正常预设名原样返回', () => {
    expect(normalizeTemplatePresetSelectionValue_ACU('我的预设')).toBe('我的预设');
  });

  it('默认值标记返回空字符串', () => {
    expect(normalizeTemplatePresetSelectionValue_ACU(DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU)).toBe('');
  });

  it('null 返回空字符串', () => {
    expect(normalizeTemplatePresetSelectionValue_ACU(null)).toBe('');
  });

  it('undefined 返回空字符串', () => {
    expect(normalizeTemplatePresetSelectionValue_ACU(undefined)).toBe('');
  });

  it('纯空格返回空字符串', () => {
    expect(normalizeTemplatePresetSelectionValue_ACU('   ')).toBe('');
  });

  it('前后空格被 trim', () => {
    expect(normalizeTemplatePresetSelectionValue_ACU('  预设名  ')).toBe('预设名');
  });

  it('数字输入转为字符串', () => {
    expect(normalizeTemplatePresetSelectionValue_ACU(123)).toBe('123');
  });
});

describe('isDefaultTemplatePresetSelection_ACU', () => {
  it('默认值标记返回 true', () => {
    expect(isDefaultTemplatePresetSelection_ACU(DEFAULT_TEMPLATE_PRESET_OPTION_VALUE_ACU)).toBe(true);
  });

  it('空字符串返回 true', () => {
    expect(isDefaultTemplatePresetSelection_ACU('')).toBe(true);
  });

  it('null 返回 true', () => {
    expect(isDefaultTemplatePresetSelection_ACU(null)).toBe(true);
  });

  it('正常预设名返回 false', () => {
    expect(isDefaultTemplatePresetSelection_ACU('我的预设')).toBe(false);
  });
});

describe('getCurrentTemplatePresetName_ACU', () => {
  it('settings 中有预设名时返回预设名', () => {
    expect(getCurrentTemplatePresetName_ACU({ currentTemplatePresetName: '预设A' })).toBe('预设A');
  });

  it('settings 中无预设名时返回空字符串', () => {
    expect(getCurrentTemplatePresetName_ACU({})).toBe('');
  });

  it('settings 为 null 时返回空字符串', () => {
    expect(getCurrentTemplatePresetName_ACU(null)).toBe('');
  });

  it('requireExisting=true 且无校验函数时返回预设名', () => {
    expect(getCurrentTemplatePresetName_ACU(
      { currentTemplatePresetName: '预设A' },
      { requireExisting: true }
    )).toBe('预设A');
  });

  it('requireExisting=true 且校验函数返回有效时返回预设名', () => {
    const getPreset = vi.fn(() => ({ templateStr: '模板内容' }));
    expect(getCurrentTemplatePresetName_ACU(
      { currentTemplatePresetName: '预设A' },
      { requireExisting: true, getTemplatePresetFn: getPreset }
    )).toBe('预设A');
    expect(getPreset).toHaveBeenCalledWith('预设A');
  });

  it('requireExisting=true 且校验函数返回无效时返回空字符串', () => {
    const getPreset = vi.fn(() => null);
    expect(getCurrentTemplatePresetName_ACU(
      { currentTemplatePresetName: '预设A' },
      { requireExisting: true, getTemplatePresetFn: getPreset }
    )).toBe('');
  });
});

describe('derivePresetNameFromFilename_ACU', () => {
  it('去除 .json 扩展名', () => {
    expect(derivePresetNameFromFilename_ACU('预设A.json')).toBe('预设A');
  });

  it('去除 .txt 扩展名', () => {
    expect(derivePresetNameFromFilename_ACU('预设A.txt')).toBe('预设A');
  });

  it('无扩展名原样返回', () => {
    expect(derivePresetNameFromFilename_ACU('预设A')).toBe('预设A');
  });

  it('空字符串返回空字符串', () => {
    expect(derivePresetNameFromFilename_ACU('')).toBe('');
  });

  it('null 返回空字符串', () => {
    expect(derivePresetNameFromFilename_ACU(null)).toBe('');
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

  it('多个空格合并为一个', () => {
    expect(sanitizeFilenameComponent_ACU('a   b   c')).toBe('a b c');
  });

  it('超过 80 字符截断', () => {
    const longName = 'a'.repeat(100);
    expect(sanitizeFilenameComponent_ACU(longName).length).toBeLessThanOrEqual(80);
  });

  it('空字符串返回空字符串', () => {
    expect(sanitizeFilenameComponent_ACU('')).toBe('');
  });

  it('null 返回空字符串', () => {
    expect(sanitizeFilenameComponent_ACU(null)).toBe('');
  });
});

describe('deriveTemplatePresetNameForImport_ACU', () => {
  it('优先使用 presetName', () => {
    expect(deriveTemplatePresetNameForImport_ACU({
      presetName: '显式名称',
      filename: 'file.json',
    })).toBe('显式名称');
  });

  it('presetName 为空时使用 filename', () => {
    expect(deriveTemplatePresetNameForImport_ACU({
      presetName: '',
      filename: '从文件名.json',
    })).toBe('从文件名');
  });

  it('都为空时使用 fallbackLabel', () => {
    expect(deriveTemplatePresetNameForImport_ACU({
      presetName: '',
      filename: '',
      fallbackLabel: '兜底名称',
      allowCharacterFallback: false,
    })).toBe('兜底名称');
  });

  it('无参数时返回空字符串', () => {
    // allowCharacterFallback=true 但 window 上没有 SillyTavern，getCurrentCharacterCardName_ACU 返回 ''
    expect(deriveTemplatePresetNameForImport_ACU({
      allowCharacterFallback: false,
    })).toBe('');
  });
});

// ═══ getCurrentCharacterCardName_ACU ═══
describe('getCurrentCharacterCardName_ACU', () => {
  it('无 SillyTavern 环境时返回空字符串', () => {
    (globalThis as any).window = {};
    expect(getCurrentCharacterCardName_ACU()).toBe('');
  });
  it('有 TavernHelper 时返回角色名', () => {
    (globalThis as any).window = {
      TavernHelper: {
        getCharData: vi.fn(() => ({ name: '勇者' })),
      },
    };
    expect(getCurrentCharacterCardName_ACU()).toBe('勇者');
  });
  it('有 SillyTavern context 时返回 name2', () => {
    (globalThis as any).window = {
      SillyTavern: {
        getContext: () => ({ name2: '勇者B', characters: [], characterId: 0 }),
      },
    };
    expect(getCurrentCharacterCardName_ACU()).toBe('勇者B');
  });
  it('异常时返回空字符串', () => {
    (globalThis as any).window = {
      SillyTavern: {
        getContext: () => { throw new Error('fail'); },
      },
    };
    expect(getCurrentCharacterCardName_ACU()).toBe('');
  });
});
