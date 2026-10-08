/**
 * R9-17：exportTableAsJson / 表格更新回调交出的是副本，第三方原地修改不得改写运行时 canonical 视图。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tableData: null as any,
}));

vi.mock('../../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mocks.tableData; },
  isAutoUpdatingCard_ACU: false,
  _set_isAutoUpdatingCard_ACU: vi.fn(),
}));
vi.mock('../../../../src/shared/constants', () => ({ ACU_TOAST_CATEGORY_ACU: {} }));
vi.mock('../../../../src/shared/env', () => ({ topLevelWindow_ACU: {} }));
vi.mock('../../../../src/shared/utils', () => ({
  isSummaryOrOutlineTable_ACU: vi.fn(), logDebug_ACU: vi.fn(), logError_ACU: vi.fn(), logWarn_ACU: vi.fn(),
}));
vi.mock('../../../../src/shared/host-api', () => ({ SillyTavern_API_ACU: {} }));
vi.mock('../../../../src/service/worldbook/pipeline', () => ({ loadAllChatMessages_ACU: vi.fn() }));
vi.mock('../../../../src/service/runtime/helpers-remaining', () => ({ getEffectiveAutoUpdateThreshold_ACU: vi.fn() }));
vi.mock('../../../../src/presentation/triggers/update-process', () => ({ proceedWithCardUpdate_ACU: vi.fn() }));
vi.mock('../../../../src/presentation/components/pipeline-ui-helpers', () => ({ refreshMergedDataAndNotifyWithUI_ACU: vi.fn() }));
vi.mock('../../../../src/presentation/theme/toast', () => ({ showToastr_ACU: vi.fn() }));
vi.mock('../../../../src/service/settings/settings-readers', () => ({ getCurrentWorldbookConfig_ACU: vi.fn() }));
vi.mock('../../../../src/service/vector/summary-vector-index-flush-queue', () => ({ enqueueSummaryVectorIndexFlush_ACU: vi.fn() }));
vi.mock('../../../../src/service/table/table-import-service', () => ({ importTableJsonThroughCommit_ACU: vi.fn() }));
vi.mock('../../../../src/shared/ai-floor', () => ({ isAiFloor_ACU: vi.fn() }));

import { createCoreDataApi } from '../../../../src/presentation/bootstrap/api-groups/core-data-api';
import { createCallbackApi } from '../../../../src/presentation/bootstrap/api-groups/callback-api';

beforeEach(() => {
  mocks.tableData = { sheet_a: { name: 'A', content: [[null, '名字'], ['r1', '甲']] } };
});

describe('R9-17：对外交出副本', () => {
  it('exportTableAsJson 返回的对象被原地修改不影响运行时数据', () => {
    const api = createCoreDataApi({ tableUpdateCallbacks: [], tableFillStartCallbacks: [], getApi: () => ({}) } as any);

    const exported = api.exportTableAsJson();
    exported.sheet_a.content.push(['r2', '乙']);

    expect(exported).not.toBe(mocks.tableData);
    expect(mocks.tableData.sheet_a.content).toHaveLength(2);
  });

  it('表格更新回调收到的数据被原地修改不影响运行时数据', () => {
    const ctx: any = { tableUpdateCallbacks: [], tableFillStartCallbacks: [], getApi: () => api };
    const api = createCallbackApi(ctx);
    api.registerTableUpdateCallback((data: any) => { data.sheet_a.content.push(['r2', '乙']); });

    api._notifyTableUpdate();

    expect(mocks.tableData.sheet_a.content).toHaveLength(2);
  });
});
