import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockShowToastr, mockRenderSidebar, mockRenderMain } = vi.hoisted(() => ({
  mockShowToastr: vi.fn(),
  mockRenderSidebar: vi.fn(),
  mockRenderMain: vi.fn(),
}));

const { mockGetTableLocks, mockSaveTableLocks, mockSetSpecialIndexLockEnabled } = vi.hoisted(() => ({
  mockGetTableLocks: vi.fn(() => ({ rows: new Set<number>(), cols: new Set<number>(), cells: new Set<string>() })),
  mockSaveTableLocks: vi.fn(),
  mockSetSpecialIndexLockEnabled: vi.fn(),
}));
const mockPreflightSchemaMigrations = vi.hoisted(() => vi.fn());

const { state } = vi.hoisted(() => ({
  state: {
    tempData: {
      mate: { type: 'chatSheets', version: 1, globalInjectionConfig: { readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 }, wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 } } },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [['row_id', '姓名']], sourceData: { note: 'a', initNode: '', insertNode: '', updateNode: '', deleteNode: '' }, updateConfig: { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1, sendLatestRows: -1, groupId: -1 }, exportConfig: { enabled: false, splitByRow: false, entryName: 'A表', entryType: 'constant', keywords: '', preventRecursion: true, injectionTemplate: '', extraIndexEnabled: false, extraIndexEntryName: 'A表-索引', extraIndexColumns: [], extraIndexColumnModes: {}, extraIndexInjectionTemplate: '', entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 }, extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 }, fixedEntryPlacement: { position: 'at_depth_as_system', depth: 2, order: 99990 }, fixedIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 99991 } } },
    } as any,
    sheetOrder: ['sheet_a'],
    currentSheetKey: 'sheet_a',
    deletedSheetKeys: ['legacy_deleted'],
  },
}));

vi.mock('../../src/presentation/theme/toast', () => ({
  showToastr_ACU: mockShowToastr,
}));

vi.mock('../../src/presentation/pages/visualizer-main-render', () => ({
  renderVisualizerMain_ACU: mockRenderMain,
}));

vi.mock('../../src/presentation/pages/visualizer-sidebar', () => ({
  renderVisualizerSidebar_ACU: mockRenderSidebar,
}));

vi.mock('../../src/presentation/pages/visualizer', () => ({
  _acuVisState: state,
}));

vi.mock('../../src/service/runtime/helpers-remaining', () => ({
  getTableLocksForSheet_ACU: mockGetTableLocks,
  saveTableLocksForSheet_ACU: mockSaveTableLocks,
  setSpecialIndexLockEnabled_ACU: mockSetSpecialIndexLockEnabled,
}));

vi.mock('../../src/shared/utils', () => ({
  applySheetOrderNumbers_ACU: vi.fn((dataObj: any, orderedKeys: string[]) => {
    orderedKeys.forEach((key, index) => {
      if (dataObj?.[key]) dataObj[key].orderNo = index;
    });
    return true;
  }),
}));

vi.mock('../../src/service/template-assistant/service', () => ({
  buildTemplateAssistantFingerprint_ACU: vi.fn((data: any) => {
    const keys = Object.keys(data || {}).filter((key) => key.startsWith('sheet_')).sort();
    return `acu-struct:${keys.join('|')}`;
  }),
  getTemplateAssistantApplyBaselineFingerprint_ACU: vi.fn((result: any) => {
    if (result?.originalBaseFingerprint) return result.originalBaseFingerprint;
    if (result?.session || Array.isArray(result?.rounds)) return '';
    return result?.draft?.baseFingerprint || '';
  }),
}));

vi.mock('../../src/service/table/schema-migration-preflight', () => ({
  preflightSchemaMigrations_ACU: mockPreflightSchemaMigrations,
}));

import { buildTemplateAssistantFingerprint_ACU } from '../../src/service/template-assistant/service';
import { applyTemplateAssistantDraftToVisualizer_ACU } from '../../src/presentation/pages/visualizer-template-assistant-apply';

function buildApplyResult_ACU(overrides: any = {}) {
  const fp = buildTemplateAssistantFingerprint_ACU(state.tempData);
  return {
    originalBaseFingerprint: overrides.originalBaseFingerprint ?? fp,
    draft: { baseFingerprint: fp, ...overrides.draft } as any,
    compileResult: {
      candidateData: state.tempData,
      orderedSheetKeys: ['sheet_a'],
      deletedSheetKeys: [],
      focusSheetKey: 'sheet_a',
      lockChanges: [],
      ...overrides.compileResult,
    },
  } as any;
}

describe('applyTemplateAssistantDraftToVisualizer_ACU', () => {
  beforeEach(() => {
    mockShowToastr.mockReset();
    mockRenderSidebar.mockReset();
    mockRenderMain.mockReset();
    mockGetTableLocks.mockReset();
    mockSaveTableLocks.mockReset();
    mockSetSpecialIndexLockEnabled.mockReset();
    mockGetTableLocks.mockReturnValue({ rows: new Set<number>(), cols: new Set<number>(), cells: new Set<string>() });
    mockPreflightSchemaMigrations.mockReset();
    mockPreflightSchemaMigrations.mockResolvedValue({ changedSheetKeys: [], blockers: [], operations: [] });
    state.tempData = {
      mate: { type: 'chatSheets', version: 1, globalInjectionConfig: { readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 }, wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 } } },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [['row_id', '姓名']], sourceData: { note: 'a', initNode: '', insertNode: '', updateNode: '', deleteNode: '' }, updateConfig: { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1, sendLatestRows: -1, groupId: -1 }, exportConfig: { enabled: false, splitByRow: false, entryName: 'A表', entryType: 'constant', keywords: '', preventRecursion: true, injectionTemplate: '', extraIndexEnabled: false, extraIndexEntryName: 'A表-索引', extraIndexColumns: [], extraIndexColumnModes: {}, extraIndexInjectionTemplate: '', entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 }, extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 }, fixedEntryPlacement: { position: 'at_depth_as_system', depth: 2, order: 99990 }, fixedIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 99991 } } },
    } as any;
    state.sheetOrder = ['sheet_a'];
    state.currentSheetKey = 'sheet_a';
    state.deletedSheetKeys = ['legacy_deleted'];
  });

  it('按 originalBaseFingerprint 校验并同步 tempData/sheetOrder/currentSheetKey/deletedSheetKeys', async () => {
    const ok = await applyTemplateAssistantDraftToVisualizer_ACU(buildApplyResult_ACU({
      draft: { baseFingerprint: 'acu-struct:working-session' },
      compileResult: {
        candidateData: {
          ...state.tempData,
          sheet_b: { ...state.tempData.sheet_a, uid: 'sheet_b', name: 'B表', orderNo: 1 },
        },
        orderedSheetKeys: ['sheet_a', 'sheet_b'],
        deletedSheetKeys: ['sheet_x'],
        focusSheetKey: 'sheet_b',
      },
    }));

    expect(ok).toBe(true);
    expect(state.sheetOrder).toEqual(['sheet_a', 'sheet_b']);
    expect(state.deletedSheetKeys).toEqual(['legacy_deleted', 'sheet_x']);
    expect(state.currentSheetKey).toBe('sheet_a');
    expect(mockRenderSidebar).toHaveBeenCalledTimes(1);
    expect(mockRenderMain).toHaveBeenCalledTimes(1);
  });

  it('原始 baseline fingerprint 不一致时阻止应用，即使 draft.baseFingerprint 看似可用', async () => {
    const ok = await applyTemplateAssistantDraftToVisualizer_ACU(buildApplyResult_ACU({
      originalBaseFingerprint: 'acu-struct:stale',
      draft: { baseFingerprint: buildTemplateAssistantFingerprint_ACU(state.tempData) },
    }));

    expect(ok).toBe(false);
    expect(mockRenderSidebar).not.toHaveBeenCalled();
  });

  it('schema migration preflight 有 blocker 时阻止应用且不污染运行时状态', async () => {
    const stateBeforeApply = JSON.parse(JSON.stringify(state));
    mockPreflightSchemaMigrations.mockResolvedValueOnce({
      changedSheetKeys: ['sheet_a'],
      blockers: ['sheet_a: 缺少显式 V2 intent'],
      operations: [],
    });

    const ok = await applyTemplateAssistantDraftToVisualizer_ACU(buildApplyResult_ACU({
      compileResult: {
        candidateData: {
          ...state.tempData,
          sheet_b: { ...state.tempData.sheet_a, uid: 'sheet_b', name: 'B表', orderNo: 1 },
        },
        orderedSheetKeys: ['sheet_a', 'sheet_b'],
        deletedSheetKeys: ['sheet_a'],
        focusSheetKey: 'sheet_b',
      },
    }));

    expect(ok).toBe(false);
    expect(mockPreflightSchemaMigrations).toHaveBeenCalledTimes(1);
    expect(mockShowToastr).toHaveBeenCalledWith('warning', expect.stringContaining('schema migration preflight'));
    expect(state).toEqual(stateBeforeApply);
    expect(mockRenderSidebar).not.toHaveBeenCalled();
    expect(mockRenderMain).not.toHaveBeenCalled();
    expect(mockSaveTableLocks).not.toHaveBeenCalled();
    expect(mockSetSpecialIndexLockEnabled).not.toHaveBeenCalled();
  });

  it('schema migration preflight 期间结构变化时不覆盖并发编辑', async () => {
    let resolvePreflight: (value: { changedSheetKeys: string[]; blockers: string[]; operations: any[] }) => void;
    mockPreflightSchemaMigrations.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePreflight = resolve;
    }));
    const applying = applyTemplateAssistantDraftToVisualizer_ACU(buildApplyResult_ACU({
      compileResult: {
        candidateData: {
          ...state.tempData,
          sheet_b: { ...state.tempData.sheet_a, uid: 'sheet_b', name: '草稿新增表', orderNo: 1 },
        },
        orderedSheetKeys: ['sheet_a', 'sheet_b'],
        deletedSheetKeys: [],
        focusSheetKey: 'sheet_b',
      },
    }));
    state.tempData = {
      ...state.tempData,
      sheet_concurrent: { ...state.tempData.sheet_a, uid: 'sheet_concurrent', name: '并发编辑表', orderNo: 1 },
    };
    state.sheetOrder = ['sheet_a', 'sheet_concurrent'];
    resolvePreflight!({ changedSheetKeys: [], blockers: [], operations: [] });

    await expect(applying).resolves.toBe(false);
    expect(state.tempData.sheet_concurrent).toBeTruthy();
    expect(state.tempData.sheet_b).toBeUndefined();
    expect(state.sheetOrder).toEqual(['sheet_a', 'sheet_concurrent']);
    expect(mockRenderSidebar).not.toHaveBeenCalled();
    expect(mockRenderMain).not.toHaveBeenCalled();
    expect(mockShowToastr).toHaveBeenCalledWith('warning', expect.stringContaining('preflight 期间已变化'));
  });

  it('schema migration preflight 期间 deletedSheetKeys 单独变化时不覆盖并发编辑', async () => {
    let resolvePreflight: (value: { changedSheetKeys: string[]; blockers: string[]; operations: any[] }) => void;
    mockPreflightSchemaMigrations.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePreflight = resolve;
    }));
    const applying = applyTemplateAssistantDraftToVisualizer_ACU(buildApplyResult_ACU({
      compileResult: {
        candidateData: state.tempData,
        orderedSheetKeys: ['sheet_a'],
        deletedSheetKeys: ['sheet_a'],
        focusSheetKey: null,
      },
    }));
    state.deletedSheetKeys = ['legacy_deleted', 'sheet_concurrent_deleted'];
    resolvePreflight!({ changedSheetKeys: [], blockers: [], operations: [] });

    await expect(applying).resolves.toBe(false);
    expect(state.deletedSheetKeys).toEqual(['legacy_deleted', 'sheet_concurrent_deleted']);
    expect(mockRenderSidebar).not.toHaveBeenCalled();
    expect(mockRenderMain).not.toHaveBeenCalled();
    expect(mockShowToastr).toHaveBeenCalledWith('warning', expect.stringContaining('preflight 期间已变化'));
  });

  it('未提供 originalBaseFingerprint 时回退到 draft.baseFingerprint', async () => {
    const fp = buildTemplateAssistantFingerprint_ACU(state.tempData);
    const ok = await applyTemplateAssistantDraftToVisualizer_ACU({
      draft: { baseFingerprint: fp } as any,
      compileResult: { candidateData: state.tempData, orderedSheetKeys: ['sheet_a'], deletedSheetKeys: [], focusSheetKey: 'sheet_a', lockChanges: [] },
    } as any);

    expect(ok).toBe(true);
  });

  it('多轮结果缺少 originalBaseFingerprint 时阻止应用', async () => {
    const fp = buildTemplateAssistantFingerprint_ACU(state.tempData);
    const ok = await applyTemplateAssistantDraftToVisualizer_ACU({
      draft: { baseFingerprint: fp } as any,
      session: { stopReason: 'empty_operations' } as any,
      compileResult: {
        candidateData: {
          ...state.tempData,
          sheet_b: { ...state.tempData.sheet_a, uid: 'sheet_b', name: 'B表', orderNo: 1 },
        },
        orderedSheetKeys: ['sheet_a', 'sheet_b'],
        deletedSheetKeys: [],
        focusSheetKey: 'sheet_b',
        lockChanges: [],
      },
    } as any);

    expect(ok).toBe(false);
    expect(mockRenderSidebar).not.toHaveBeenCalled();
  });

  it('删除当前表后优先回退到 focusSheetKey', async () => {
    const ok = await applyTemplateAssistantDraftToVisualizer_ACU(buildApplyResult_ACU({
      compileResult: {
        candidateData: {
          mate: state.tempData.mate,
          sheet_b: { ...state.tempData.sheet_a, uid: 'sheet_b', name: 'B表', orderNo: 0 },
        },
        orderedSheetKeys: ['sheet_b'],
        deletedSheetKeys: ['sheet_a'],
        focusSheetKey: 'sheet_b',
      },
    }));

    expect(ok).toBe(true);
    expect(state.currentSheetKey).toBe('sheet_b');
  });

  it('删除当前表且无可用 focus 时回退到 null', async () => {
    const ok = await applyTemplateAssistantDraftToVisualizer_ACU(buildApplyResult_ACU({
      compileResult: {
        candidateData: { mate: state.tempData.mate },
        orderedSheetKeys: [],
        deletedSheetKeys: ['sheet_a'],
        focusSheetKey: null,
        lockChanges: [],
      },
    }));

    expect(ok).toBe(true);
    expect(state.currentSheetKey).toBeNull();
  });

  it('应用 lockChanges 到运行时锁状态', async () => {
    const ok = await applyTemplateAssistantDraftToVisualizer_ACU(buildApplyResult_ACU({
      compileResult: {
        candidateData: state.tempData,
        orderedSheetKeys: ['sheet_a'],
        deletedSheetKeys: [],
        focusSheetKey: 'sheet_a',
        lockChanges: [
          {
            sheetKey: 'sheet_a',
            rows: [{ rowIndex: 0, locked: true }],
            columns: [{ colIndex: 0, locked: true }],
            cells: [{ rowIndex: 0, colIndex: 0, locked: false }],
            specialIndexLocked: true,
          },
        ],
      },
    }));

    expect(ok).toBe(true);
    expect(mockSaveTableLocks).toHaveBeenCalledTimes(1);
    expect(mockSetSpecialIndexLockEnabled).toHaveBeenCalledWith('sheet_a', true);
  });
});
