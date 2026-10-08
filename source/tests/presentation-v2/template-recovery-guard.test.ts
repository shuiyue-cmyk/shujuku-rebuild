/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

async function importGuard() {
  vi.resetModules();
  const validateCurrentChatTableRecovery_ACU = vi.fn(async () => ({ success: true }));

  vi.doMock('../../src/service/table/storage-frame-v2-replay', () => ({
    validateCurrentChatTableRecovery_ACU,
  }));

  setActivePinia(createPinia());
  const [{ ensureTemplateRecoveryReady_ACU }, { useDialogStore }] = await Promise.all([
    import('../../src/presentation-v2/composables/useTemplateRecoveryGuard'),
    import('../../src/presentation-v2/stores/dialog-store'),
  ]);
  return {
    ensureTemplateRecoveryReady_ACU,
    useDialogStore,
    validateCurrentChatTableRecovery_ACU,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useTemplateRecoveryGuard', () => {
  it('当前历史恢复验证通过时不弹窗', async () => {
    const { ensureTemplateRecoveryReady_ACU, useDialogStore, validateCurrentChatTableRecovery_ACU } = await importGuard();

    const result = await ensureTemplateRecoveryReady_ACU('save-template');

    expect(result).toEqual({ success: true, dataWasReset: false });
    expect(useDialogStore().active).toBeNull();
    expect(validateCurrentChatTableRecovery_ACU).toHaveBeenCalledWith();
  });

  it('恢复验证失败时显示非破坏性提示并保留数据', async () => {
    const {
      ensureTemplateRecoveryReady_ACU,
      useDialogStore,
      validateCurrentChatTableRecovery_ACU,
    } = await importGuard();
    validateCurrentChatTableRecovery_ACU.mockResolvedValueOnce({ success: false, error: 'CHECK constraint failed' });

    const pending = ensureTemplateRecoveryReady_ACU('save-template');
    await Promise.resolve();
    const dialog = useDialogStore();

    expect(dialog.active?.title).toBe('当前聊天历史恢复失败');
    expect(dialog.active?.message).toContain('已保留当前标识本地数据');
    expect(dialog.active?.message).toContain('CHECK constraint failed');
    expect(dialog.active?.confirmLabel).toBe('知道了');

    dialog.submitActive();
    await expect(pending).resolves.toEqual({ success: false, dataWasReset: false });
  });

  it('回放仍依赖临时补锚时显示恢复收敛提示并阻止模板切换', async () => {
    const {
      ensureTemplateRecoveryReady_ACU,
      useDialogStore,
      validateCurrentChatTableRecovery_ACU,
    } = await importGuard();
    validateCurrentChatTableRecovery_ACU.mockResolvedValueOnce({
      success: false,
      diagnosticCode: 'replay_requires_checkpoint_convergence',
      affectedSheetKeys: ['sheet_global'],
      error: '当前 V2 历史仍依赖临时 Sheet 补锚：sheet_global。请先在数据管理中完成恢复收敛。',
    });

    const pending = ensureTemplateRecoveryReady_ACU('switch-template');
    await Promise.resolve();
    const dialog = useDialogStore();

    expect(dialog.active?.title).toBe('当前 V2 历史需要恢复收敛');
    expect(dialog.active?.message).toContain('数据管理中诊断并完成恢复收敛');
    expect(dialog.active?.message).toContain('sheet_global');
    expect(dialog.active?.dangerMessage).toContain('不会保存或切换模板');

    dialog.submitActive();
    await expect(pending).resolves.toEqual({ success: false, dataWasReset: false });
  });
});
