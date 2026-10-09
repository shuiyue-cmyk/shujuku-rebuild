
/**
 * tests/service/worldbook/injection-engine-config.test.ts
 * 世界书注入引擎配置 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ENTRY_PLACEMENT_ACU,
  DEFAULT_EXTRA_INDEX_PLACEMENT_ACU,
  normalizeLorebookPosition_ACU,
  getFixedPlacementDefaultsForTable_ACU,
  buildDefaultGlobalInjectionConfig_ACU,
  getGlobalInjectionConfigFromData_ACU,
  ensureExportConfigDefaults_ACU,
  ensureSheetExportConfigDefaults_ACU,
  applyPlacementToEntry_ACU,
  isEntryPlacementMatched_ACU,
} from '../../../src/service/worldbook/injection-engine-config';

// ═══ 常量测试 ═══
describe('DEFAULT_ENTRY_PLACEMENT_ACU', () => {
  it('包含正确的默认值', () => {
    expect(DEFAULT_ENTRY_PLACEMENT_ACU).toEqual({ position: 'at_depth_as_system', depth: 2, order: 10000 });
  });

  it('是冻结对象', () => {
    expect(Object.isFrozen(DEFAULT_ENTRY_PLACEMENT_ACU)).toBe(true);
  });
});

describe('DEFAULT_EXTRA_INDEX_PLACEMENT_ACU', () => {
  it('包含正确的默认值', () => {
    expect(DEFAULT_EXTRA_INDEX_PLACEMENT_ACU).toEqual({ position: 'at_depth_as_system', depth: 2, order: 10010 });
  });

  it('是冻结对象', () => {
    expect(Object.isFrozen(DEFAULT_EXTRA_INDEX_PLACEMENT_ACU)).toBe(true);
  });
});

// ═══ normalizeLorebookPosition_ACU ═══
describe('normalizeLorebookPosition_ACU', () => {
  it('at_depth_as_system 原样返回', () => {
    expect(normalizeLorebookPosition_ACU('at_depth_as_system')).toBe('at_depth_as_system');
  });

  it('system 映射为 at_depth_as_system', () => {
    expect(normalizeLorebookPosition_ACU('system')).toBe('at_depth_as_system');
  });

  it('before_char 映射为 before_character_definition', () => {
    expect(normalizeLorebookPosition_ACU('before_char')).toBe('before_character_definition');
  });

  it('before_character 映射为 before_character_definition', () => {
    expect(normalizeLorebookPosition_ACU('before_character')).toBe('before_character_definition');
  });

  it('before_character_definition 原样返回', () => {
    expect(normalizeLorebookPosition_ACU('before_character_definition')).toBe('before_character_definition');
  });

  it('"0" 映射为 before_character_definition', () => {
    expect(normalizeLorebookPosition_ACU('0')).toBe('before_character_definition');
  });

  it('after_char 映射为 after_character_definition', () => {
    expect(normalizeLorebookPosition_ACU('after_char')).toBe('after_character_definition');
  });

  it('after_character 映射为 after_character_definition', () => {
    expect(normalizeLorebookPosition_ACU('after_character')).toBe('after_character_definition');
  });

  it('"1" 映射为 after_character_definition', () => {
    expect(normalizeLorebookPosition_ACU('1')).toBe('after_character_definition');
  });

  it('未知值使用 fallback', () => {
    expect(normalizeLorebookPosition_ACU('unknown')).toBe('at_depth_as_system');
    expect(normalizeLorebookPosition_ACU('unknown', 'before_character_definition')).toBe('before_character_definition');
  });
});

// ═══ getFixedPlacementDefaultsForTable_ACU ═══
describe('getFixedPlacementDefaultsForTable_ACU', () => {

  it('总体大纲返回特定配置', () => {
    const result = getFixedPlacementDefaultsForTable_ACU('总体大纲');
    expect(result.entry.depth).toBe(9998);
    expect(result.entry.order).toBe(99985);
  });

  it('重要人物表返回特定配置', () => {
    const result = getFixedPlacementDefaultsForTable_ACU('重要人物表');
    expect(result.entry.depth).toBe(10000);
    expect(result.entry.order).toBe(99983);
  });
});

// ═══ buildDefaultGlobalInjectionConfig_ACU ═══
describe('buildDefaultGlobalInjectionConfig_ACU', () => {
  it('返回正确的全局注入配置', () => {
    const config = buildDefaultGlobalInjectionConfig_ACU();
    expect(config.readableEntryPlacement.position).toBe('before_character_definition');
    expect(config.wrapperPlacement.position).toBe('before_character_definition');
  });
});

// ═══ getGlobalInjectionConfigFromData_ACU ═══
describe('getGlobalInjectionConfigFromData_ACU', () => {

  it('ensureWriteBack 写回配置到 dataObj', () => {
    const dataObj: any = {};
    getGlobalInjectionConfigFromData_ACU(dataObj, { ensureWriteBack: true });
    expect(dataObj.mate).toBeDefined();
    expect(dataObj.mate.globalInjectionConfig).toBeDefined();
    expect(dataObj.mate.type).toBe('chatSheets');
    expect(dataObj.mate.version).toBe(1);
  });

  it('ensureWriteBack 不覆盖已有 mate 字段', () => {
    const dataObj: any = { mate: { type: 'chatSheets', version: 2, extra: true } };
    getGlobalInjectionConfigFromData_ACU(dataObj, { ensureWriteBack: true });
    expect(dataObj.mate.version).toBe(2);
    expect(dataObj.mate.extra).toBe(true);
  });
});

// ═══ ensureExportConfigDefaults_ACU ═══
describe('ensureExportConfigDefaults_ACU', () => {

  it('部分输入保留已有值', () => {
    const result = ensureExportConfigDefaults_ACU({ enabled: true, splitByRow: true }, '测试表');
    expect(result.enabled).toBe(true);
    expect(result.splitByRow).toBe(true);
    expect(result.entryName).toBe('测试表');
  });

  it('placement 字段被规范化', () => {
    const result = ensureExportConfigDefaults_ACU({
      entryPlacement: { position: 'before_char', depth: 3, order: 50 },
    }, '');
    expect(result.entryPlacement.position).toBe('before_character_definition');
  });
});

// ═══ ensureSheetExportConfigDefaults_ACU ═══
describe('ensureSheetExportConfigDefaults_ACU', () => {

  it('正常 sheet 写回 exportConfig', () => {
    const sheet: any = { name: '测试表', exportConfig: { enabled: true } };
    const result = ensureSheetExportConfigDefaults_ACU(sheet);
    expect(result.enabled).toBe(true);
    expect(sheet.exportConfig).toBe(result);
  });
});

// ═══ applyPlacementToEntry_ACU ═══
describe('applyPlacementToEntry_ACU', () => {
  it('at_depth_as_system 保留 depth', () => {
    const result = applyPlacementToEntry_ACU(
      { uid: 1, content: '测试' },
      { position: 'at_depth_as_system', depth: 5, order: 100 }
    );
    expect(result.position).toBe('at_depth_as_system');
    expect(result.depth).toBe(5);
  });

  it('before_character_definition 删除 depth', () => {
    const result = applyPlacementToEntry_ACU(
      { uid: 1, content: '测试', depth: 99 },
      { position: 'before_char', depth: 5, order: 100 }
    );
    expect(result.position).toBe('before_character_definition');
    expect(result.depth).toBeUndefined();
  });

  it('null entry 原样返回', () => {
    expect(applyPlacementToEntry_ACU(null, {})).toBeNull();
  });

  it('非对象 entry 原样返回', () => {
    expect(applyPlacementToEntry_ACU('string', {})).toBe('string');
  });

  it('不修改原始 entry 对象', () => {
    const original = { uid: 1, content: '测试' };
    const result = applyPlacementToEntry_ACU(original, { position: 'at_depth_as_system', depth: 5, order: 100 });
    expect(result).not.toBe(original);
    expect(original).not.toHaveProperty('position');
  });
});

// ═══ isEntryPlacementMatched_ACU ═══
describe('isEntryPlacementMatched_ACU', () => {

  it('at_depth_as_system 时 depth 不匹配返回 false', () => {
    expect(isEntryPlacementMatched_ACU(
      { position: 'at_depth_as_system', depth: 5 },
      { position: 'at_depth_as_system', depth: 2, order: 100 }
    )).toBe(false);
  });
});
