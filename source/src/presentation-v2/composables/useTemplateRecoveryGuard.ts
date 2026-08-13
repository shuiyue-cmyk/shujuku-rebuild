import { validateCurrentChatTableRecovery_ACU } from '../../service/table/storage-frame-v2-replay';
import { useDialogStore } from '../stores/dialog-store';

export type TemplateRecoveryGuardAction_ACU = 'save-template' | 'switch-template';

export interface TemplateRecoveryGuardResult_ACU {
  success: boolean;
  dataWasReset: boolean;
}

function buildTemplateRecoveryConfirmMessage_ACU(action: TemplateRecoveryGuardAction_ACU, error?: string): string {
  const actionText = action === 'save-template' ? '保存这次聊天模板修改' : '切换并保存当前聊天模板';
  const detail = error ? `\n\n底层恢复错误：${error}` : '';
  return `无法确认当前聊天历史可以安全恢复；已保留当前标识本地数据，${actionText}已取消。请先在数据管理中诊断并完成恢复收敛，或备份/导出聊天后排查恢复错误。${detail}`;
}

export async function ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU(
  guideData: Record<string, any> | null,
  action: TemplateRecoveryGuardAction_ACU,
): Promise<TemplateRecoveryGuardResult_ACU> {
  void guideData;
  const validation = await validateCurrentChatTableRecovery_ACU();
  if (validation.success) return { success: true, dataWasReset: false };

  const dialogStore = useDialogStore();
  const requiresConvergence = 'diagnosticCode' in validation && validation.diagnosticCode === 'replay_requires_checkpoint_convergence';
  await dialogStore.confirm({
    title: requiresConvergence ? '当前 V2 历史需要恢复收敛' : '当前聊天历史恢复失败',
    message: buildTemplateRecoveryConfirmMessage_ACU(action, 'error' in validation ? validation.error : undefined),
    dangerMessage: requiresConvergence ? '当前标识本地数据未被删除；完成 V2 恢复收敛前不会保存或切换模板。' : '当前标识本地数据未被删除；请先备份或导出后再处理。',
    confirmLabel: '知道了',
    cancelLabel: '关闭',
    confirmVariant: 'primary',
  });
  return { success: false, dataWasReset: false };
}
