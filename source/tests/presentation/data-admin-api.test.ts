import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerUiSurface_ACU, resetUiSurfaceRegistryForTests_ACU } from '../../src/shared/ui-surface-registry';

const { mockPrepareV2Recovery, mockCommitV2Recovery } = vi.hoisted(() => ({
  mockPrepareV2Recovery: vi.fn(),
  mockCommitV2Recovery: vi.fn(),
}));

vi.mock('../../src/presentation/triggers/data-admin-ui', () => ({
  exportCurrentJsonData_ACU: vi.fn(),
  exportTableTemplate_ACU: vi.fn(),
  importCombinedSettings_ACU: vi.fn(),
  importTableTemplate_ACU: vi.fn(),
  overrideLatestLayerWithTemplate_ACU: vi.fn(),
  resetAllToDefaults_ACU: vi.fn(),
  resetTableTemplate_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/triggers/update-trigger', () => ({
  exportCombinedSettings_ACU: vi.fn(),
  handleManualMergeSummary_ACU: vi.fn(),
}));

vi.mock('../../src/service/table/table-v2-recovery-service', () => ({
  prepareV2Recovery_ACU: mockPrepareV2Recovery,
  commitPreparedV2Recovery_ACU: mockCommitV2Recovery,
}));

import { createDataAdminApi } from '../../src/presentation/bootstrap/api-groups/data-admin-api';
import { exportTableTemplate_ACU, importTableTemplate_ACU } from '../../src/presentation/triggers/data-admin-ui';
import { handleManualMergeSummary_ACU } from '../../src/presentation/triggers/update-trigger';

describe('createDataAdminApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUiSurfaceRegistryForTests_ACU();
    mockPrepareV2Recovery.mockReturnValue({ status: 'unrecoverable_no_base', isolationKey: '', requiresConfirmation: false, message: 'no base' });
    mockCommitV2Recovery.mockResolvedValue({ status: 'committed', planId: 'plan-1' });
  });

  it('通过注册的 V2 surface 打开 visualizer', async () => {
    const openVisualizer = vi.fn(async () => true);
    registerUiSurface_ACU({
      openSettings: vi.fn(async () => true),
      openVisualizer,
      refreshVisualizer: vi.fn(async () => undefined),
    });
    const api = createDataAdminApi({} as any);

    expect(typeof api.openVisualizer).toBe('function');
    await expect(api.openVisualizer()).resolves.toBe(true);

    expect(openVisualizer).toHaveBeenCalledTimes(1);
  });

  it('V2 surface 尚未注册时拒绝打开 visualizer', async () => {
    const api = createDataAdminApi({} as any);

    await expect(api.openVisualizer()).resolves.toBe(false);
  });

  it('暴露 V2 恢复诊断与严格确认提交入口', async () => {
    const api = createDataAdminApi({} as any);

    await expect(api.prepareV2Recovery()).resolves.toMatchObject({ status: 'unrecoverable_no_base' });
    await expect(api.commitV2Recovery(' plan-1 ', { confirmOrphanDataReplace: true })).resolves.toEqual({ status: 'committed', planId: 'plan-1' });

    expect(mockPrepareV2Recovery).toHaveBeenCalledTimes(1);
    expect(mockCommitV2Recovery).toHaveBeenCalledWith('plan-1', { confirmOrphanDataReplace: true });
  });

  it('模板导入/导出与合并总结失败返回可区分的 {success:false,error}（负向）', async () => {
    vi.mocked(importTableTemplate_ACU).mockRejectedValueOnce(new Error('boom-import'));
    vi.mocked(exportTableTemplate_ACU).mockRejectedValueOnce(new Error('boom-export'));
    vi.mocked(handleManualMergeSummary_ACU).mockRejectedValueOnce(new Error('boom-merge'));
    const api = createDataAdminApi({} as any);

    await expect(api.importTemplate()).resolves.toMatchObject({ success: false, error: 'boom-import' });
    await expect(api.exportTemplate()).resolves.toMatchObject({ success: false, error: 'boom-export' });
    await expect(api.mergeSummaryNow()).resolves.toMatchObject({ success: false, error: 'boom-merge' });
  });

  it('V2 恢复 API 拒绝空 planId、非对象选项及非严格布尔确认', async () => {
    const api = createDataAdminApi({} as any);

    await expect(api.commitV2Recovery(' ', { confirmOrphanDataReplace: true })).resolves.toMatchObject({ success: false, error: expect.stringContaining('planId') });
    await expect(api.commitV2Recovery('plan-1', 'yes')).resolves.toMatchObject({ success: false, error: expect.stringContaining('选项') });
    await api.commitV2Recovery('plan-1', { confirmOrphanDataReplace: 'yes' });

    expect(mockCommitV2Recovery).toHaveBeenCalledTimes(1);
    expect(mockCommitV2Recovery).toHaveBeenLastCalledWith('plan-1', { confirmOrphanDataReplace: false });
  });
});
