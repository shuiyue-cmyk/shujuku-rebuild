/**
 * templateFollowGlobalFlow — "跟随全局（清除聊天覆盖）"的共享 UI 流程（S1-2）。
 *
 * 三个消费口复用同一流程，避免破坏性确认/stale 重试逻辑出现第三份复制：
 * 1. 模板面板的"跟随全局"按钮（useTableTemplatePresets.followGlobalTemplate）
 * 2. 下拉星标设全局默认后的清覆盖确认（useTableTemplatePresets.selectGlobalPreset）
 * 3. 抽屉星标设全局默认后的清覆盖确认（useTablePresetManagement.setAsDefault）
 *
 * 流程：数据恢复守卫 → followGlobalTemplateForCurrentChat_ACU（单次 stale 重试）
 * → 破坏性 blockers 二次确认 → toast 反馈。模块级函数、不持 Vue 状态，
 * dialogStore/toast/signal 由调用方注入。
 */
import {
  followGlobalTemplateForCurrentChat_ACU,
} from '../../service/template/template-preset-service';
import {
  buildChatSheetGuideDataFromTemplateObj_ACU,
  getGlobalTemplateSnapshotForCurrentProfile_ACU,
} from '../../service/template/chat-scope';
import { ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU } from './useTemplateRecoveryGuard';
import type { useDialogStore } from '../stores/dialog-store';
import type { useToastStore } from '../stores/toast-store';
import { applyTemplateWithDestructiveConfirm_ACU } from './template-destructive-confirm';

type DialogStore = ReturnType<typeof useDialogStore>;
type ToastStore = ReturnType<typeof useToastStore>;

/**
 * 执行"跟随全局"完整流程。返回 true 表示已成功跟随全局（或本就在跟随），
 * false 表示用户取消、守卫失败或提交失败（失败已 toast）。
 */
export async function runFollowGlobalTemplateFlow_ACU({
  dialogStore,
  toast,
  signal,
}: {
  dialogStore: DialogStore;
  toast: ToastStore;
  signal?: AbortSignal;
}): Promise<boolean> {
  const globalSnapshot = getGlobalTemplateSnapshotForCurrentProfile_ACU();
  const guideData = globalSnapshot?.templateObj
    ? buildChatSheetGuideDataFromTemplateObj_ACU(globalSnapshot.templateObj, { stripSeedRows: false })
    : null;
  const recoveryGuard = await ensureTemplateRecoveryOrDeleteCurrentIsolationData_ACU(guideData, 'switch-template');
  if (!recoveryGuard.success) return false;

  let userCancelled = false;
  const result = await applyTemplateWithDestructiveConfirm_ACU(
    destructiveChangeConfirmed => followGlobalTemplateForCurrentChat_ACU({ destructiveChangeConfirmed, signal }),
    {
      signal,
      confirm: async destructiveBlockers => {
        const confirmed = await dialogStore.confirm({
          title: '确认破坏性模板变更',
          message: `跟随全局模板会删除现有表或列：\n${destructiveBlockers.join('\n')}`,
          dangerMessage: '确认后将按 V2 原子提交执行。删除的数据只能通过聊天备份或 checkpoint 恢复。',
          confirmLabel: '确认删除并继续',
          cancelLabel: '取消',
          confirmVariant: 'danger',
        });
        userCancelled = !confirmed;
        return confirmed;
      },
    },
  );
  if (userCancelled) return false;

  if (!result || result.saved !== true) {
    toast.error((result && typeof result.error === 'string' && result.error) || '跟随全局模板失败。');
    return false;
  }
  if (result.alreadyFollowing) {
    toast.info('当前聊天已跟随全局模板，无需清除覆盖。');
    return true;
  }
  const warning = typeof result.postCommitWarning === 'string' ? result.postCommitWarning : '';
  if (warning) {
    toast.warning(warning, { muteable: false, durationMs: 6000 });
  } else {
    toast.success('已清除聊天模板覆盖，当前聊天跟随全局模板。', { muteable: false });
  }
  return true;
}

/**
 * 星标设全局默认成功后的清覆盖确认（S1-2 成因 c）：
 * 当前聊天存在 chat_override 时询问是否清除；拒绝则保持覆盖（合法状态）。
 * 返回 true 表示已清除覆盖。
 */
export async function promptFollowGlobalAfterSetDefault_ACU({
  dialogStore,
  toast,
  signal,
  newDefaultName,
}: {
  dialogStore: DialogStore;
  toast: ToastStore;
  signal?: AbortSignal;
  newDefaultName: string;
}): Promise<boolean> {
  const confirmed = await dialogStore.confirm({
    title: '清除当前聊天的模板覆盖？',
    message: `「${newDefaultName || '默认预设'}」已设为全局默认，但当前聊天正在使用聊天级模板覆盖，新的全局默认不会在本聊天生效。\n是否清除覆盖，让当前聊天跟随全局模板？`,
    confirmLabel: '清除覆盖并跟随全局',
    cancelLabel: '保留聊天覆盖',
  });
  if (!confirmed) return false;
  return runFollowGlobalTemplateFlow_ACU({ dialogStore, toast, signal });
}
