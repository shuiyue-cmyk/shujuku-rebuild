import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { validateDDLTextAgainstHeaders_ACU } from '../../../src/shared/ddl-utils';

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentJsonTableData_ACU: {},
  _set_currentJsonTableData_ACU: vi.fn(),
}));
vi.mock('../../../src/service/runtime/helpers-remaining', () => ({
  getTableLocksForSheet_ACU: vi.fn(() => ({ rows: new Set(), cols: new Set(), cells: new Set() })),
  isSpecialIndexLockEnabled_ACU: vi.fn(() => false),
  mergeAllIndependentTables_ACU: vi.fn(async () => ({})),
}));
vi.mock('../../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: vi.fn(() => []),
  reorderDataBySheetKeys_ACU: vi.fn((data: Record<string, any>) => data),
}));
vi.mock('../../../src/service/template/template-preset-service', () => ({
  getActiveTemplatePresetMeta_ACU: vi.fn(() => ({ displayName: '测试预设', scopeLabel: '全局' })),
}));
vi.mock('../../../src/service/worldbook/pipeline', () => ({
  loadAllChatMessages_ACU: vi.fn(async () => undefined),
}));
vi.mock('../../../src/service/worldbook/injection-engine', () => ({
  buildDefaultExportConfig_ACU: vi.fn(() => ({})),
}));
vi.mock('../../../src/presentation-v2/stores/toast-store', () => ({
  useToastStore: () => ({ info: vi.fn(), warning: vi.fn() }),
}));

describe('useVisualizerData', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('新增默认表使用 canonical row_id 和可严格校验的中文表头 DDL', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerData } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerData');
    const store = useVisualizerStore();

    useVisualizerData().addSheet('新表');

    expect(store.sheetOrder).toHaveLength(1);
    const sheetKey = store.sheetOrder[0];
    const sheet = store.tempData[sheetKey];
    expect(sheetKey).toBe('sheet_xin_biao');
    expect(sheet.content[0]).toEqual(['row_id', '列1', '列2']);
    expect(sheet.sourceData.ddl).toContain('row_id INTEGER PRIMARY KEY');
    expect(sheet.sourceData.ddl).toContain('lie_1 TEXT, -- 列1');
    expect(sheet.sourceData.ddl).toContain('lie_2 TEXT -- 列2');
    expect(validateDDLTextAgainstHeaders_ACU(sheet.sourceData.ddl, sheet.content[0])).toEqual(
      expect.objectContaining({ valid: true }),
    );
  });

  it('新增表名称为空白时不创建 sheet', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerData } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerData');
    const store = useVisualizerStore();

    useVisualizerData().addSheet('   ');

    expect(store.sheetOrder).toEqual([]);
    expect(store.tempData).toBeNull();
  });

  it('新增 canonical 重名表时不覆盖既有草稿', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerData } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerData');
    const store = useVisualizerStore();

    useVisualizerData().addSheet('背包');
    const firstKey = store.sheetOrder[0];
    useVisualizerData().addSheet(' 背包 ');

    expect(store.sheetOrder).toEqual([firstKey]);
    expect(store.tempData[firstKey].uid).toBe(firstKey);
  });
});
