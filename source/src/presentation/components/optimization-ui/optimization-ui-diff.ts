/**
 * presentation/components/optimization-ui/optimization-ui-diff.ts
 * 优化 Diff 对话框
 */

import {
  _set_currentEditablePlotPresetState_ACU,
  _set_activePlotEditorSettings_ACU,
  _set_currentPlotTaskEditorId_ACU
} from '../../../service/plot/plot-state';
import {
  showToastr_ACU
} from '../../theme/toast';
import {
  jQuery_API_ACU
} from '../../dom-utils';
import {
  toastr_API_ACU
} from '../../../shared/host-api';



import {
  escapeHtml_ACU,
  renderToastActionButton_ACU
} from '../../../shared/html-helpers';
import {
  logDebug_ACU
} from '../../../shared/utils';

import {
  _set_optimizationProgressToast_ACU,
  _set_contentOptimizationAbortRequested_ACU
} from '../../../service/optimization/content-optimization';


// 循环 import — 运行时安全
import {
  getOriginalContent_ACU,
  reoptimizeMessage_ACU,
  replaceChatMessage_ACU
} from './optimization-ui-exec';

  export function showOptimizationDiffDialogForLoop_ACU(messageIndex: number, result: any, callback: Function) {
    const isLastLoop = result.currentLoop >= result.totalLoops;
    const applyButtonText = isLastLoop ? '应用并完成' : '应用并继续';
    const originalContent = getOriginalContent_ACU(messageIndex) || result.optimizedContent;
    
    const dialogHtml = `
      <div class="acu-optimization-dialog acu-dialog-classic" data-tt-mobile-surface="free-window" style="
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--acu-bg-0, #24221f);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
        border: 1px solid var(--acu-border, #36332e);
        border-radius: 2px;
        padding: 20px;
        max-width: 800px;
        width: calc(100% - 20px);
        max-height: calc(90vh - 20px);
        overflow-y: auto;
        z-index: 100000;
        color: var(--acu-text, #c1b9ad);
        font-family: "Noto Serif SC", "Source Han Serif CN", "Songti SC", "STSong", "SimSun", serif;
        box-sizing: border-box;
      ">
        <h3 style="margin: 0 0 8px 0; color: var(--acu-accent, #7d4940); font-size: 1.1em; letter-spacing: 1px;">正文替换建议</h3>
        <p style="margin: 0 0 12px 0; color: var(--acu-text-dim, #8a8075);">${result.summary}</p>
        ${result.totalLoops > 1 ? `<p style="margin: 0 0 12px 0; color: var(--acu-text-mute, #6a6055); font-size: 12px;">进度: 第 ${result.currentLoop}/${result.totalLoops} 轮</p>` : ''}
        <div class="optimization-list" style="margin-bottom: 16px; max-height: 400px; overflow-y: auto;">
          ${result.optimizations.map((opt: any, i: number) => `
            <div class="optimization-item" style="
              background: rgba(0, 0, 0, 0.2);
              border-radius: 1px;
              padding: 12px;
              margin-bottom: 8px;
              border-left: 2px solid var(--acu-border, #36332e);
            ">
              <div style="color: var(--acu-text-dim, #8a8075); margin-bottom: 8px; text-decoration: line-through; opacity: 0.7;">
                <strong>原文：</strong>${escapeHtml_ACU(opt.original.substring(0, 200))}${opt.original.length > 200 ? '...' : ''}
              </div>
              <div style="color: var(--acu-text, #c1b9ad); font-size: 12px; margin-bottom: 8px; padding: 8px; background: rgba(125, 73, 64, 0.1); border-radius: 1px; border-left: 2px solid var(--acu-accent, #7d4940);">
                <strong>修改方案：</strong>${escapeHtml_ACU(opt.plan || opt.reason || '未说明')}
              </div>
              <div style="color: #6a8a6a;">
                <strong>优化：</strong>${escapeHtml_ACU(opt.optimized.substring(0, 200))}${opt.optimized.length > 200 ? '...' : ''}
              </div>
            </div>
          `).join('')}
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; padding-bottom: 10px;">
          <button id="acu-opt-cancel" style="
            padding: 8px 16px;
            border: 1px solid var(--acu-border, #36332e);
            background: transparent;
            color: var(--acu-text-dim, #8a8075);
            border-radius: 1px;
            cursor: pointer;
            min-width: 80px;
            flex-shrink: 0;
            font-family: inherit;
          ">取消优化</button>
          ${!isLastLoop ? `
          <button id="acu-opt-skip" style="
            padding: 8px 16px;
            border: 1px solid var(--acu-border, #36332e);
            background: transparent;
            color: var(--acu-text-dim, #8a8075);
            border-radius: 1px;
            cursor: pointer;
            min-width: 80px;
            flex-shrink: 0;
            font-family: inherit;
          ">跳过本轮</button>
          ` : ''}
          <button id="acu-opt-reoptimize" style="
            padding: 8px 16px;
            border: 1px solid var(--acu-accent, #7d4940);
            background: transparent;
            color: var(--acu-accent, #7d4940);
            border-radius: 1px;
            cursor: pointer;
            min-width: 100px;
            flex-shrink: 0;
            font-family: inherit;
          ">🔄 重新优化</button>
          <button id="acu-opt-apply" style="
            padding: 8px 16px;
            border: none;
            background: var(--acu-accent, #7d4940);
            color: var(--acu-bg-0, #24221f);
            border-radius: 1px;
            cursor: pointer;
            font-weight: 600;
            min-width: 100px;
            flex-shrink: 0;
            font-family: inherit;
          ">${applyButtonText}</button>
        </div>
      </div>
      <div id="acu-opt-backdrop" data-tt-mobile-surface="backdrop" style="
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 99999;
      "></div>
    `;
    
    jQuery_API_ACU('body').append(dialogHtml);
    
    // 绑定取消事件
    jQuery_API_ACU('#acu-opt-cancel, #acu-opt-backdrop').on('click', function() {
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      callback('cancel');
    });
    
    // 绑定跳过事件（仅非最后一轮显示）
    jQuery_API_ACU('#acu-opt-skip').on('click', function() {
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      callback('skip');
    });
    
    // 绑定重新优化事件
    jQuery_API_ACU('#acu-opt-reoptimize').on('click', async function() {
      jQuery_API_ACU(this).prop('disabled', true).text('优化中...');
      
      // 关闭当前对话框
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      
      // 获取原始内容并重新优化
      const originalContent = getOriginalContent_ACU(messageIndex) || result.optimizedContent;
      
      logDebug_ACU(`[正文优化] 用户点击重新优化，messageIndex=${messageIndex}`);
      
      // 重新优化
      await reoptimizeMessage_ACU(messageIndex);
      
      // 触发回调，结束当前优化流程
      callback('cancel');
    });
    
    // 绑定应用事件
    jQuery_API_ACU('#acu-opt-apply').on('click', async function() {
      jQuery_API_ACU(this).prop('disabled', true).text('处理中...');
      
      logDebug_ACU(`[正文优化] 用户点击应用，isLastLoop=${isLastLoop}, messageIndex=${messageIndex}`);
      logDebug_ACU(`[正文优化] optimizedContent长度: ${result.optimizedContent?.length || 0}`);
      
      // 如果是最后一轮，先应用优化
      if (isLastLoop) {
        logDebug_ACU(`[正文优化] 准备调用 replaceChatMessage_ACU...`);
        const success = await replaceChatMessage_ACU(messageIndex, result.optimizedContent, { originalContent: getOriginalContent_ACU(messageIndex) || originalContent });
        logDebug_ACU(`[正文优化] replaceChatMessage_ACU 返回: ${success}`);
        if (!success) {
          jQuery_API_ACU(this).prop('disabled', false).text(applyButtonText);
          showToastr_ACU('error', '应用失败');
          return;
        }
      } else {
        logDebug_ACU(`[正文优化] 非最后一轮，跳过应用，直接回调`);
      }
      
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      callback('apply');
    });
  }
  
  /**
   * 显示优化结果摘要
   */
  export function showOptimizationDiff_ACU(messageIndex: number, result: any) {
    const message = `正文替换完成，共 ${result.optimizations.length} 处改进`;
    const reoptButtonHtml = renderToastActionButton_ACU('acu-opt-toast-reoptimize', '🔄 重新优化', 'var(--acu-accent, #7d4940)', '1px', '0.85em');
    const html = result.summary
      ? `<div>${message}${reoptButtonHtml}<br><small style="opacity:0.7">${result.summary}</small></div>`
      : `<div>${message}${reoptButtonHtml}</div>`;
    const toast = showToastr_ACU('success', html, {
      timeOut: 10000,
      extendedTimeOut: 3000,
      tapToDismiss: false,
      escapeHtml: false,
      onShown: function() {
        jQuery_API_ACU('#acu-opt-toast-reoptimize').off('click.acu_reopt').on('click.acu_reopt', async function(e) {
          e.preventDefault();
          e.stopPropagation();
          jQuery_API_ACU(this).prop('disabled', true).text('优化中...');
          if (toast && toastr_API_ACU) toastr_API_ACU.clear(toast);
          await reoptimizeMessage_ACU(messageIndex);
        });
      }
    });
  }
  
  /**
   * 自动链只读结果对话框：内容已由自动流程写回，这里只展示对比（原文/修改方案/优化），
   * 不提供「应用」按钮。用于 showDiff 开启 + 非无感模式的自动替换收尾；
   * 与 showOptimizationDiff_ACU 的 toast 不同，DOM 对话框不受静默提示框拦截。
   */
  export function showOptimizationResultDialog_ACU(messageIndex: number, result: any) {
    const optimizations = Array.isArray(result?.optimizations) ? result.optimizations : [];
    const dialogHtml = `
      <div class="acu-optimization-dialog acu-dialog-classic" data-tt-mobile-surface="free-window" style="
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--acu-bg-0, #24221f);
        border: 1px solid var(--acu-border, #36332e);
        border-radius: 2px;
        padding: 20px;
        max-width: 800px;
        width: calc(100% - 20px);
        max-height: calc(90vh - 20px);
        overflow-y: auto;
        z-index: 100000;
        color: var(--acu-text, #c1b9ad);
        font-family: "Noto Serif SC", "Source Han Serif CN", "Songti SC", "STSong", "SimSun", serif;
        box-sizing: border-box;
      ">
        <h3 style="margin: 0 0 8px 0; color: var(--acu-accent, #7d4940); font-size: 1.1em; letter-spacing: 1px;">正文替换完成</h3>
        <p style="margin: 0 0 12px 0; color: var(--acu-text-dim, #8a8075);">共 ${optimizations.length} 处改进${result?.summary ? `，${escapeHtml_ACU(String(result.summary))}` : ''}</p>
        <div class="optimization-list" style="margin-bottom: 16px; max-height: 400px; overflow-y: auto;">
          ${optimizations.map((opt: any) => `
            <div class="optimization-item" style="
              background: rgba(0, 0, 0, 0.2);
              border-radius: 1px;
              padding: 12px;
              margin-bottom: 8px;
              border-left: 2px solid var(--acu-border, #36332e);
            ">
              <div style="color: var(--acu-text-dim, #8a8075); margin-bottom: 8px; text-decoration: line-through; opacity: 0.7;">
                <strong>原文：</strong>${escapeHtml_ACU(String(opt?.original || '').substring(0, 200))}${String(opt?.original || '').length > 200 ? '...' : ''}
              </div>
              <div style="color: var(--acu-text, #c1b9ad); font-size: 12px; margin-bottom: 8px; padding: 8px; background: rgba(125, 73, 64, 0.1); border-radius: 1px; border-left: 2px solid var(--acu-accent, #7d4940);">
                <strong>修改方案：</strong>${escapeHtml_ACU(String(opt?.plan || opt?.reason || '未说明'))}
              </div>
              <div style="color: #6a8a6a;">
                <strong>优化：</strong>${escapeHtml_ACU(String(opt?.optimized || '').substring(0, 200))}${String(opt?.optimized || '').length > 200 ? '...' : ''}
              </div>
            </div>
          `).join('')}
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; padding-bottom: 10px;">
          <button id="acu-opt-result-reoptimize" style="
            padding: 8px 16px;
            border: 1px solid var(--acu-accent, #7d4940);
            background: transparent;
            color: var(--acu-accent, #7d4940);
            border-radius: 1px;
            cursor: pointer;
            min-width: 100px;
            flex-shrink: 0;
            font-family: inherit;
          ">🔄 重新优化</button>
          <button id="acu-opt-result-close" style="
            padding: 8px 16px;
            border: none;
            background: var(--acu-accent, #7d4940);
            color: var(--acu-bg-0, #24221f);
            border-radius: 1px;
            cursor: pointer;
            font-weight: 600;
            min-width: 100px;
            flex-shrink: 0;
            font-family: inherit;
          ">关闭</button>
        </div>
      </div>
      <div id="acu-opt-backdrop" data-tt-mobile-surface="backdrop" style="
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 99999;
      "></div>
    `;

    jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
    jQuery_API_ACU('body').append(dialogHtml);

    jQuery_API_ACU('#acu-opt-result-close, #acu-opt-backdrop').on('click', function() {
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
    });

    jQuery_API_ACU('#acu-opt-result-reoptimize').on('click', async function() {
      jQuery_API_ACU(this).prop('disabled', true).text('优化中...');
      jQuery_API_ACU('.acu-optimization-dialog, #acu-opt-backdrop').remove();
      logDebug_ACU(`[正文优化] 结果对话框点击重新优化，messageIndex=${messageIndex}`);
      await reoptimizeMessage_ACU(messageIndex);
    });
  }

  /**
   * HTML转义
   */

  // === 以下为 presentation 层独有的 UI 函数（DOM 操作/渲染）===

