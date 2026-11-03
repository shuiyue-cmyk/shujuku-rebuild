import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListNames, mockGetPreset } = vi.hoisted(() => ({
  mockListNames: vi.fn<() => string[]>(() => []),
  mockGetPreset: vi.fn<(name: string) => { templateStr?: string } | null>(() => null),
}));

vi.mock('../../../src/service/template/template-preset-service', () => ({
  listTemplatePresetNames_ACU: mockListNames,
  getTemplatePreset_ACU: mockGetPreset,
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  getCurrentChatTemplateScopeState_ACU: () => null,
  getChatSheetGuideDataForIsolationKey_ACU: () => null,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  currentJsonTableData_ACU: null,
  getCurrentIsolationKey_ACU: () => 'iso-key',
}));

vi.mock('../../../src/data/storage/chat-history', () => ({
  CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU: '__acu_chatSheetGuideSeedRows',
}));

vi.mock('../../../src/service/template/template-data-preflight', () => ({
  extractBusinessKeyColumns_ACU: () => [],
}));

import { scanSeedPollution_ACU } from '../../../src/service/template/template-seed-pollution-diagnostics';

function buildPollutedPresetTemplateStr(): string {
  return JSON.stringify({
    sheet_a: {
      uid: 'sheet_a',
      name: 'A表',
      content: [['row_id', '姓名'], ['1', '甲']],
      __acu_chatSheetGuideSeedRows: [['2', '乙'], ['2', '丙']],
    },
  });
}

describe('scanSeedPollution_ACU 的 global preset 扫描面（G09-05）', () => {
  beforeEach(() => {
    mockListNames.mockReset();
    mockGetPreset.mockReset();
    mockListNames.mockReturnValue([]);
  });

  it('按 listTemplatePresetNames_ACU 枚举真实预设库并计入 scanned.globalPresets', () => {
    mockListNames.mockReturnValue(['我的预设']);
    mockGetPreset.mockImplementation((name: string) => (
      name === '我的预设' ? { templateStr: buildPollutedPresetTemplateStr() } : null
    ));

    const result = scanSeedPollution_ACU();

    expect(result.scanned.globalPresets).toBe(1);
    expect(mockGetPreset).toHaveBeenCalledWith('我的预设');
    const conflict = result.diagnostics.find(item => item.code === 'seed_row_id_conflict');
    expect(conflict?.source).toBe('global_preset');
    expect(conflict?.sheetKey).toBe('sheet_a');
    expect(conflict?.conflictingKeys).toEqual(['2']);
  });

  it('预设库为空时扫描 0 个预设，不再探测「默认模板/标准模板」固定名', () => {
    mockListNames.mockReturnValue([]);

    const result = scanSeedPollution_ACU();

    expect(result.scanned.globalPresets).toBe(0);
    expect(mockGetPreset).not.toHaveBeenCalled();
  });

  it('枚举预设名抛错时按空库处理（只读诊断不因存储异常中断）', () => {
    mockListNames.mockImplementation(() => { throw new Error('存储不可用'); });

    const result = scanSeedPollution_ACU();

    expect(result.scanned.globalPresets).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });
});
