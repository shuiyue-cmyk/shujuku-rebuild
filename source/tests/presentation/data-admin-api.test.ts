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
  migrateLegacySummaryVectorIndex_ACU: vi.fn(),
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
import {
  exportCurrentJsonData_ACU,
  exportTableTemplate_ACU,
  importCombinedSettings_ACU,
  importTableTemplate_ACU,
  migrateLegacySummaryVectorIndex_ACU,
  overrideLatestLayerWithTemplate_ACU,
  resetAllToDefaults_ACU,
  resetTableTemplate_ACU,
} from '../../src/presentation/triggers/data-admin-ui';
import { exportCombinedSettings_ACU, handleManualMergeSummary_ACU } from '../../src/presentation/triggers/update-trigger';

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

  it('模板导入/导出与合并总结失败返回恒为 false 并留诊断旁路（负向）', async () => {
    vi.mocked(importTableTemplate_ACU).mockRejectedValueOnce(new Error('boom-import'));
    vi.mocked(exportTableTemplate_ACU).mockRejectedValueOnce(new Error('boom-export'));
    vi.mocked(handleManualMergeSummary_ACU).mockRejectedValueOnce(new Error('boom-merge'));
    const api = createDataAdminApi({} as any);

    // 第三方契约：这批方法为 Promise<boolean>，失败必须可被 !r 判定捕获。
    await expect(api.importTemplate()).resolves.toBe(false);
    expect((globalThis as any).__ACU_LAST_DATA_ADMIN_ERROR__).toMatchObject({ method: 'importTemplate', error: expect.anything() });
    await expect(api.exportTemplate()).resolves.toBe(false);
    expect((globalThis as any).__ACU_LAST_DATA_ADMIN_ERROR__).toMatchObject({ method: 'exportTemplate', error: expect.anything() });
    await expect(api.mergeSummaryNow()).resolves.toBe(false);
    expect((globalThis as any).__ACU_LAST_DATA_ADMIN_ERROR__).toMatchObject({ method: 'mergeSummaryNow', error: expect.anything() });
  });

  it('V2 恢复 API 拒绝空 planId、非对象选项及非严格布尔确认', async () => {
    const api = createDataAdminApi({} as any);

    await expect(api.commitV2Recovery(' ', { confirmOrphanDataReplace: true })).resolves.toMatchObject({ success: false, error: expect.stringContaining('planId') });
    await expect(api.commitV2Recovery('plan-1', 'yes')).resolves.toMatchObject({ success: false, error: expect.stringContaining('选项') });
    await api.commitV2Recovery('plan-1', { confirmOrphanDataReplace: 'yes' });

    expect(mockCommitV2Recovery).toHaveBeenCalledTimes(1);
    expect(mockCommitV2Recovery).toHaveBeenLastCalledWith('plan-1', { confirmOrphanDataReplace: false });
  });

  // ═══ 布尔契约成功归一（v9.1.8）：文档 Promise<boolean>，underlying 返回 undefined 的
  // 异步文件选择/confirm 流程在 API 层归一为 true，第三方 if (r) 不再把成功误判为失败 ═══
  it('成功返 true：underlying 返回 undefined 的异步流程归一为 true', async () => {
    // 这批 underlying 均为"触发文件选择/confirm 后无显式 return"形状，同步返回 undefined
    vi.mocked(importTableTemplate_ACU).mockReturnValue(undefined as any);
    vi.mocked(exportCurrentJsonData_ACU).mockReturnValue(undefined as any);
    vi.mocked(importCombinedSettings_ACU).mockReturnValue(undefined as any);
    vi.mocked(exportCombinedSettings_ACU).mockReturnValue(undefined as any);
    vi.mocked(overrideLatestLayerWithTemplate_ACU).mockResolvedValue(undefined as any);
    const api = createDataAdminApi({} as any);

    await expect(api.importTemplate()).resolves.toBe(true);
    await expect(api.exportJsonData()).resolves.toBe(true);
    await expect(api.importCombinedSettings()).resolves.toBe(true);
    await expect(api.exportCombinedSettings()).resolves.toBe(true);
    await expect(api.overrideWithTemplate()).resolves.toBe(true);
  });

  it('成功返 true：underlying 显式 true / 文档布尔方法透传不变', async () => {
    vi.mocked(exportTableTemplate_ACU).mockReturnValue(true);
    vi.mocked(resetTableTemplate_ACU).mockResolvedValue(true as any);
    vi.mocked(resetAllToDefaults_ACU).mockResolvedValue(true as any);
    const api = createDataAdminApi({} as any);

    await expect(api.exportTemplate()).resolves.toBe(true);
    await expect(api.resetTemplate()).resolves.toBe(true);
    await expect(api.resetAllDefaults()).resolves.toBe(true);
  });

  it('显式 false 保持 false：用户取消/功能停用不得假成功', async () => {
    vi.mocked(resetAllToDefaults_ACU).mockResolvedValue(false as any);
    vi.mocked(exportTableTemplate_ACU).mockReturnValue(false);
    // handleManualMergeSummary_ACU 恒 false（合并总结已停用）
    vi.mocked(handleManualMergeSummary_ACU).mockResolvedValue(false as any);
    const api = createDataAdminApi({} as any);

    await expect(api.resetAllDefaults()).resolves.toBe(false);
    await expect(api.exportTemplate()).resolves.toBe(false);
    await expect(api.mergeSummaryNow()).resolves.toBe(false);
  });

  it('migrateLegacyVectorIndex 返回数据对象原样（布尔归一例外）', async () => {
    const diagnostics = { success: true, skipped: true, indexedRowCount: 0, skippedRowCount: 0, chunkCount: 0, reason: 'already_content_addressed' };
    vi.mocked(migrateLegacySummaryVectorIndex_ACU).mockResolvedValue(diagnostics as any);
    const api = createDataAdminApi({} as any);

    // 若被布尔归一会变成 true 并丢失诊断字段——必须原样返回
    await expect(api.migrateLegacyVectorIndex()).resolves.toEqual(diagnostics);
  });

  it('失败恒 false：其余布尔契约方法 reject 时双向可判且留诊断旁路', async () => {
    vi.mocked(exportCurrentJsonData_ACU).mockImplementation(() => { throw new Error('boom-json'); });
    vi.mocked(importCombinedSettings_ACU).mockImplementation(() => { throw new Error('boom-import-combined'); });
    vi.mocked(exportCombinedSettings_ACU).mockImplementation(() => { throw new Error('boom-export-combined'); });
    vi.mocked(overrideLatestLayerWithTemplate_ACU).mockRejectedValue(new Error('boom-override'));
    vi.mocked(migrateLegacySummaryVectorIndex_ACU).mockRejectedValue(new Error('boom-migrate'));
    vi.mocked(resetTableTemplate_ACU).mockRejectedValue(new Error('boom-reset'));
    vi.mocked(resetAllToDefaults_ACU).mockRejectedValue(new Error('boom-reset-all'));
    const api = createDataAdminApi({} as any);

    await expect(api.exportJsonData()).resolves.toBe(false);
    await expect(api.importCombinedSettings()).resolves.toBe(false);
    await expect(api.exportCombinedSettings()).resolves.toBe(false);
    await expect(api.overrideWithTemplate()).resolves.toBe(false);
    await expect(api.migrateLegacyVectorIndex()).resolves.toBe(false);
    await expect(api.resetTemplate()).resolves.toBe(false);
    await expect(api.resetAllDefaults()).resolves.toBe(false);
    expect((globalThis as any).__ACU_LAST_DATA_ADMIN_ERROR__).toMatchObject({ method: 'resetAllDefaults', error: expect.anything() });
  });
});
