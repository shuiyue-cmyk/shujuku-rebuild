import { getCurrentWorldbookConfig_ACU } from '../../service/settings/settings-readers';
import { jQuery_API_ACU } from '../dom-utils';

// status-display.ts — 手动更新的交火索引提示 + 填表停止按钮绑定
// （旧弹窗的「立即手动更新」按钮已不存在，按钮状态同步随旧弹窗一并删除，R9-11）

  export function shouldShowVectorMemoryManualUpdateWarning_ACU() {
    try {
        return getCurrentWorldbookConfig_ACU().summaryVectorIndexModeEnabled === true;
    } catch (e) {
        return false;
    }
  }

  // [T173] 填表停止按钮绑定
  export function bindTableFillStopButton_ACU(buttonId: string, onStop: any) {
    const $stopButton = jQuery_API_ACU(`#${buttonId}`);
    if ($stopButton.length) {
        $stopButton.off('click.acu_stop').on('click.acu_stop', function(e) {
            e.stopPropagation();
            e.preventDefault();
            jQuery_API_ACU(this).closest('.toast').remove();
            if (typeof onStop === 'function') onStop();
        });
    }
  }
