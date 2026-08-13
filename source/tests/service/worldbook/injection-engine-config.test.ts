
/**
 * tests/service/worldbook/injection-engine-config.test.ts
 * 世界书注入引擎配置 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ENTRY_PLACEMENT_ACU,
  DEFAULT_EXTRA_INDEX_PLACEMENT_ACU,
  normalizeLorebookPosition_ACU,
  normalizePlacementConfig_ACU,
  isSummaryTableName_ACU,
  isOutlineTableName_ACU,
  isImportantPersonsTableName_ACU,
  getFixedPlacementDefaultsForTable_ACU,
  buildDefaultExportConfig_ACU,
  buildDefaultGlobalInjectionConfig_ACU,
  ensureGlobalInjectionConfigDefaults_ACU,
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

  it('null/undefined 使用 fallback', () => {
    expect(normalizeLorebookPosition_ACU(null)).toBe('at_depth_as_system');
    expect(normalizeLorebookPosition_ACU(undefined)).toBe('at_depth_as_system');
  });

  it('大小写不敏感', () => {
    expect(normalizeLorebookPosition_ACU('AT_DEPTH_AS_SYSTEM')).toBe('at_depth_as_system');
    expect(normalizeLorebookPosition_ACU('BEFORE_CHAR')).toBe('before_character_definition');
  });

  it('前后空格被 trim', () => {
    expect(normalizeLorebookPosition_ACU('  at_depth_as_system  ')).toBe('at_depth_as_system');
  });
});

// ═══ normalizePlacementConfig_ACU ═══
describe('normalizePlacementConfig_ACU', () => {
  it('有效输入正常解析', () => {
    const result = normalizePlacementConfig_ACU(
      { position: 'before_char', depth: 5, order: 100 },
      DEFAULT_ENTRY_PLACEMENT_ACU
    );
    expect(result.position).toBe('before_character_definition');
    expect(result.depth).toBe(5);
    expect(result.order).toBe(100);
  });

  it('无效 depth 使用 fallback', () => {
    const result = normalizePlacementConfig_ACU(
      { position: 'at_depth_as_system', depth: 'abc', order: 100 },
      DEFAULT_ENTRY_PLACEMENT_ACU
    );
    expect(result.depth).toBe(2); // fallback 的 depth
  });

  it('无效 order 使用 fallback', () => {
    const result = normalizePlacementConfig_ACU(
      { position: 'at_depth_as_system', depth: 2, order: NaN },
      DEFAULT_ENTRY_PLACEMENT_ACU
    );
    expect(result.order).toBe(10000); // fallback 的 order
  });

  it('null 输入使用 fallback', () => {
    const result = normalizePlacementConfig_ACU(null, DEFAULT_ENTRY_PLACEMENT_ACU);
    expect(result).toEqual({ position: 'at_depth_as_system', depth: 2, order: 10000 });
  });

  it('空对象使用 fallback', () => {
    const result = normalizePlacementConfig_ACU({}, DEFAULT_ENTRY_PLACEMENT_ACU);
    expect(result).toEqual({ position: 'at_depth_as_system', depth: 2, order: 10000 });
  });

  it('fallback 为 null 时使用 DEFAULT_ENTRY_PLACEMENT_ACU', () => {
    const result = normalizePlacementConfig_ACU(null, null);
    expect(result.position).toBe('at_depth_as_system');
    expect(result.depth).toBe(2);
    expect(result.order).toBe(10000);
  });
});

// ═══ 表名判断函数 ═══
describe('isSummaryTableName_ACU', () => {
  it('匹配"总结表"', () => {
    expect(isSummaryTableName_ACU('总结表')).toBe(true);
  });

  it('前后空格被 trim', () => {
    expect(isSummaryTableName_ACU('  总结表  ')).toBe(true);
  });

  it('不匹配其他名称', () => {
    expect(isSummaryTableName_ACU('总体大纲')).toBe(false);
    expect(isSummaryTableName_ACU('')).toBe(false);
  });
});

describe('isOutlineTableName_ACU', () => {
  it('匹配"总体大纲"', () => {
    expect(isOutlineTableName_ACU('总体大纲')).toBe(true);
  });

  it('不匹配其他名称', () => {
    expect(isOutlineTableName_ACU('总结表')).toBe(false);
  });
});

describe('isImportantPersonsTableName_ACU', () => {
  it('匹配"重要人物表"', () => {
    expect(isImportantPersonsTableName_ACU('重要人物表')).toBe(true);
  });

  it('不匹配其他名称', () => {
    expect(isImportantPersonsTableName_ACU('总结表')).toBe(false);
  });
});

// ═══ getFixedPlacementDefaultsForTable_ACU ═══
describe('getFixedPlacementDefaultsForTable_ACU', () => {
  it('总结表返回特定配置', () => {
    const result = getFixedPlacementDefaultsForTable_ACU('总结表');
    expect(result.entry.depth).toBe(9999);
    expect(result.entry.order).toBe(99987);
  });

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

  it('全局数据表返回 before_character_definition', () => {
    const result = getFixedPlacementDefaultsForTable_ACU('全局数据表');
    expect(result.entry.position).toBe('before_character_definition');
  });

  it('全局表也匹配', () => {
    const result = getFixedPlacementDefaultsForTable_ACU('全局表');
    expect(result.entry.position).toBe('before_character_definition');
  });

  it('未知表名返回默认配置', () => {
    const result = getFixedPlacementDefaultsForTable_ACU('自定义表');
    expect(result.entry.position).toBe('at_depth_as_system');
    expect(result.entry.order).toBe(99990);
  });

  it('空表名返回默认配置', () => {
    const result = getFixedPlacementDefaultsForTable_ACU('');
    expect(result.entry.position).toBe('at_depth_as_system');
  });
});

// ═══ buildDefaultExportConfig_ACU ═══
describe('buildDefaultExportConfig_ACU', () => {
  it('返回完整的默认导出配置', () => {
    const config = buildDefaultExportConfig_ACU('测试表');
    expect(config.enabled).toBe(false);
    expect(config.splitByRow).toBe(false);
    expect(config.entryName).toBe('测试表');
    expect(config.entryType).toBe('constant');
    expect(config.keywords).toBe('');
    expect(config.preventRecursion).toBe(true);
    expect(config.extraIndexEnabled).toBe(false);
    expect(config.extraIndexEntryName).toBe('测试表-索引');
    expect(config.entryPlacement).toEqual(DEFAULT_ENTRY_PLACEMENT_ACU);
    expect(config.extraIndexPlacement).toEqual(DEFAULT_EXTRA_INDEX_PLACEMENT_ACU);
  });

  it('空表名使用空字符串', () => {
    const config = buildDefaultExportConfig_ACU();
    expect(config.entryName).toBe('');
    expect(config.extraIndexEntryName).toBe('表格-索引');
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

// ═══ ensureGlobalInjectionConfigDefaults_ACU ═══
describe('ensureGlobalInjectionConfigDefaults_ACU', () => {
  it('null 输入返回默认值', () => {
    const result = ensureGlobalInjectionConfigDefaults_ACU(null);
    expect(result.readableEntryPlacement.position).toBe('before_character_definition');
  });

  it('部分输入补全缺失字段', () => {
    const result = ensureGlobalInjectionConfigDefaults_ACU({
      readableEntryPlacement: { position: 'at_depth_as_system', depth: 5, order: 100 },
    });
    expect(result.readableEntryPlacement.position).toBe('at_depth_as_system');
    expect(result.readableEntryPlacement.depth).toBe(5);
    expect(result.wrapperPlacement.position).toBe('before_character_definition');
  });
});

// ═══ getGlobalInjectionConfigFromData_ACU ═══
describe('getGlobalInjectionConfigFromData_ACU', () => {
  it('从 dataObj.mate.globalInjectionConfig 读取', () => {
    const dataObj = {
      mate: {
        type: 'chatSheets',
        version: 1,
        globalInjectionConfig: {
          readableEntryPlacement: { position: 'at_depth_as_system', depth: 3, order: 200 },
        },
      },
    };
    const result = getGlobalInjectionConfigFromData_ACU(dataObj);
    expect(result.readableEntryPlacement.depth).toBe(3);
  });

  it('null dataObj 返回默认值', () => {
    const result = getGlobalInjectionConfigFromData_ACU(null);
    expect(result.readableEntryPlacement.position).toBe('before_character_definition');
  });

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
  it('null 输入返回默认值', () => {
    const result = ensureExportConfigDefaults_ACU(null, '测试表');
    expect(result.enabled).toBe(false);
    expect(result.entryName).toBe('测试表');
  });

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
  it('null sheet 返回默认配置', () => {
    const result = ensureSheetExportConfigDefaults_ACU(null);
    expect(result.enabled).toBe(false);
  });

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
  it('完全匹配返回 true', () => {
    expect(isEntryPlacementMatched_ACU(
      { position: 'at_depth_as_system', depth: 2 },
      { position: 'at_depth_as_system', depth: 2, order: 100 }
    )).toBe(true);
  });

  it('position 不匹配返回 false', () => {
    expect(isEntryPlacementMatched_ACU(
      { position: 'before_character_definition' },
      { position: 'at_depth_as_system', depth: 2, order: 100 }
    )).toBe(false);
  });

  it('at_depth_as_system 时 depth 不匹配返回 false', () => {
    expect(isEntryPlacementMatched_ACU(
      { position: 'at_depth_as_system', depth: 5 },
      { position: 'at_depth_as_system', depth: 2, order: 100 }
    )).toBe(false);
  });

  it('非 at_depth_as_system 时不检查 depth', () => {
    expect(isEntryPlacementMatched_ACU(
      { position: 'before_character_definition', depth: 999 },
      { position: 'before_char', depth: 2, order: 100 }
    )).toBe(true);
  });

  it('entry depth 为字符串时正确解析', () => {
    expect(isEntryPlacementMatched_ACU(
      { position: 'at_depth_as_system', depth: '2' },
      { position: 'at_depth_as_system', depth: 2, order: 100 }
    )).toBe(true);
  });

  it('entry depth 为 NaN 时返回 false', () => {
    expect(isEntryPlacementMatched_ACU(
      { position: 'at_depth_as_system', depth: 'abc' },
      { position: 'at_depth_as_system', depth: 2, order: 100 }
    )).toBe(false);
  });
});
