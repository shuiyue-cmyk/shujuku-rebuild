import { getCurrentWorldbookConfig_ACU } from '../../service/settings/settings-readers';
import { jQuery_API_ACU } from '../dom-utils';
import { $manualUpdateCardButton_ACU } from '../state/ui-refs';

// status-display.ts — 手动更新按钮状态显示/绑定

  const MANUAL_UPDATE_VECTOR_SOFT_DISABLED_CLASS_ACU = 'acu-manual-update-vector-soft-disabled';

  export function isVectorMemoryManualUpdateBlocked_ACU() {
    try {
        return getCurrentWorldbookConfig_ACU().summaryVectorIndexModeEnabled === true;
    } catch (e) {
        return false;
    }
  }

  export function shouldShowVectorMemoryManualUpdateWarning_ACU() {
    return isVectorMemoryManualUpdateBlocked_ACU();
  }

  export function syncManualUpdateButtonAvailability_ACU() {
    if (!$manualUpdateCardButton_ACU) return;

    if (shouldShowVectorMemoryManualUpdateWarning_ACU()) {
        $manualUpdateCardButton_ACU
            .prop('disabled', false)
            .addClass(MANUAL_UPDATE_VECTOR_SOFT_DISABLED_CLASS_ACU)
            .text('交火索引已启用')
            .attr('title', '交火模式纪要索引启用时不建议手动更新表格；特殊场景下仍可点击执行。');
        return;
    }

    $manualUpdateCardButton_ACU
        .prop('disabled', false)
        .removeClass(MANUAL_UPDATE_VECTOR_SOFT_DISABLED_CLASS_ACU)
        .text('立即手动更新')
        .removeAttr('title');
  }

  // [T173] 填表停止按钮绑定
  export function bindTableFillStopButton_ACU(buttonId: string, onStop: any) {
    const $stopButton = jQuery_API_ACU(`#${buttonId}`);
    if ($stopButton.length) {
        $stopButton.off('click.acu_stop').on('click.acu_stop', function(e) {
            e.stopPropagation();
            e.preventDefault();
            syncManualUpdateButtonAvailability_ACU();
            jQuery_API_ACU(this).closest('.toast').remove();
            if (typeof onStop === 'function') onStop();
        });
    }
  }

  // [T173] 重置手动更新按钮状态
  export function resetManualUpdateButton_ACU() {
    syncManualUpdateButtonAvailability_ACU();
  }
