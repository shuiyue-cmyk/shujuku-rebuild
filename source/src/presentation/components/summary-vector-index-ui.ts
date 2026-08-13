/**
 * presentation/components/summary-vector-index-ui.ts — 交火模式纪要索引 UI 层封装
 *
 * 负责：交火发送前召回过程的进度 toast 与结果提示。
 * 不负责：关键词生成、向量召回、rerank、世界书覆盖等业务逻辑。
 */
import { toastr_API_ACU } from '../../shared/host-api';
import { ACU_TOAST_CATEGORY_ACU } from '../../shared/constants';
import { logDebug_ACU } from '../../shared/utils';
import { processSummaryVectorIndexBeforeGeneration_ACU, type SummaryVectorIndexRuntimeResult_ACU } from '../../service/vector/summary-vector-index-runtime';
import { rebuildCurrentSummaryVectorIndexNow_ACU } from '../../service/vector/summary-vector-index-rebuild-service';
import type { SummaryVectorIndexArchiveResult_ACU } from '../../service/vector/summary-vector-index-archive-service';
import { showToastr_ACU } from '../theme/toast';

const SUMMARY_VECTOR_REBUILD_REQUIRED_REASONS_ACU = new Set([
  'external_vector_files_missing_rebuild_required',
  'external_files_missing_state_cleared_rebuild_required',
  'external_files_identity_invalid_rebuild_required',
  'external_vector_identity_invalid_rebuild_required',
  'runtime_stale_rows_rebuild_required',
]);

function clearToastElement_ACU($toast: JQuery<HTMLElement> | null) {
  try { if ($toast) toastr_API_ACU?.clear?.($toast); } catch (e) {}
  try { if ($toast && $toast.closest) $toast.closest('.toast').remove(); } catch (e) {}
}

function shouldShowSummaryVectorResultToast_ACU(result: SummaryVectorIndexRuntimeResult_ACU): boolean {
  if (!result || result.skipped) return false;
  return result.success === true && Number(result.injectedCount || 0) > 0;
}

export function shouldRebuildSummaryVectorIndexWithUI_ACU(reason: string | undefined): boolean {
  return SUMMARY_VECTOR_REBUILD_REQUIRED_REASONS_ACU.has(String(reason || ''));
}

/** 复用“立即构建交火纪要索引”的普通业务链路，并提供阻塞式进度提示。 */
export async function rebuildCurrentSummaryVectorIndexWithUI_ACU(): Promise<SummaryVectorIndexArchiveResult_ACU> {
  const $toast = showToastr_ACU('info', '正在重建交火索引快照...', {
    timeOut: 0,
    extendedTimeOut: 0,
    tapToDismiss: false,
    closeButton: false,
    progressBar: false,
    acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLANNING,
  });
  try {
    const result = await rebuildCurrentSummaryVectorIndexNow_ACU();
    if (result.success && !result.skipped) {
      showToastr_ACU(
        'success',
        `交火索引快照重建完成：${result.indexedRowCount || 0} 行，${result.chunkCount || 0} 个 chunks。`,
        { acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLAN_OK },
      );
      return result;
    }
    const reason = result.errors?.length
      ? result.errors.join('；')
      : (result.reason || '无可重建内容');
    showToastr_ACU(result.success ? 'info' : 'error', `交火索引快照未完成：${reason}`);
    return result;
  } catch (error: any) {
    showToastr_ACU('error', `交火索引快照重建失败：${error?.message || '未知错误'}`);
    throw error;
  } finally {
    clearToastElement_ACU($toast);
  }
}

/**
 * 包装交火发送前处理，显示“正在召回记忆”进度提示。
 */
export async function processSummaryVectorIndexBeforeGenerationWithUI_ACU(
  options: { userInput?: string; source?: string } = {},
): Promise<SummaryVectorIndexRuntimeResult_ACU> {
  const toastMsg = `
      <div style="display: flex; align-items: center; justify-content: space-between;">
          <span class="toastr-message" style="margin-right: 10px;">正在召回交火记忆并重排纪要索引，请稍后...</span>
      </div>
  `;

  const $toast = showToastr_ACU('info', toastMsg, {
    timeOut: 0,
    extendedTimeOut: 0,
    escapeHtml: false,
    tapToDismiss: false,
    closeButton: false,
    progressBar: false,
    toastClass: 'toast acu-toast acu-toast--info',
    acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLANNING,
  });

  let result: SummaryVectorIndexRuntimeResult_ACU;
  try {
    result = await processSummaryVectorIndexBeforeGeneration_ACU(options);
    if (shouldShowSummaryVectorResultToast_ACU(result)) {
      showToastr_ACU(
        'success',
        `交火记忆召回完成，已覆盖纪要索引 ${result.injectedCount || 0} 条。`,
        '交火召回完成',
        { acuToastCategory: ACU_TOAST_CATEGORY_ACU.PLAN_OK },
      );
    } else {
      logDebug_ACU(`[交火模式纪要索引] UI 包装完成：success=${result?.success === true}, skipped=${result?.skipped === true}, reason=${result?.reason || 'none'}`);
    }
  } finally {
    clearToastElement_ACU($toast);
  }

  if (shouldRebuildSummaryVectorIndexWithUI_ACU(result.reason)) {
    try {
      await rebuildCurrentSummaryVectorIndexWithUI_ACU();
    } catch (error) {
      logDebug_ACU(`[交火模式纪要索引] 失效索引已删除，但普通重建路径执行失败；继续原始生成：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
