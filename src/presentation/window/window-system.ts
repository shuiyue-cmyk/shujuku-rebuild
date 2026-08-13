// window-system.ts
// 从 01_window_system.js 整体迁入

import { getConfigStorage_ACU, persistTavernSettings_ACU } from '../../service/settings/settings-service';
import { applyACUThemeToDocument_ACU, injectACUWindowStyles, syncACUThemeButtons_ACU, toggleACUTheme_ACU } from './window-styles';
import { applyTheme, loadCustomThemes } from '../theme/theme-registry';
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { topLevelWindow_ACU } from '../../shared/env';
import { safeJsonParse_ACU, safeJsonStringify_ACU } from '../../shared/json-helpers';
import { jQuery_API_ACU } from '../dom-utils';

  export const ACU_WindowManager = {
    windows: new Map(), // id -> { $el, zIndex, ... }
    baseZIndex: 10000,
    topZIndex: 10000,
    
    register(id: string, $el: any) {
      this.topZIndex++;
      this.windows.set(id, { $el, zIndex: this.topZIndex });
      $el.css('z-index', this.topZIndex);
    },
    
    unregister(id: string) {
      this.windows.delete(id);
    },
    
    bringToFront(id: string) {
      const win = this.windows.get(id);
      if (!win) return;
      this.topZIndex++;
      win.zIndex = this.topZIndex;
      win.$el.css('z-index', this.topZIndex);
    },
    
    getWindow(id: string) {
      return this.windows.get(id)?.$el || null;
    },
    
    isOpen(id: string) {
      return this.windows.has(id);
    },
    
    closeAll() {
      this.windows.forEach((_: any, id: string) => {
        const $el = this.windows.get(id)?.$el;
        if ($el) $el.remove();
      });
      this.windows.clear();
    }
  };

  // ═══ 窗口状态存储键 ═══
  const ACU_WINDOW_STATE_STORAGE_KEY = `${SCRIPT_ID_PREFIX_ACU}_windowStates`;
  
  /**
   * 获取窗口状态存储对象
   */
  export function getWindowStates_ACU() {
    try {
      const store = getConfigStorage_ACU();
      const raw = store?.getItem?.(ACU_WINDOW_STATE_STORAGE_KEY);
      if (raw) {
        const parsed = safeJsonParse_ACU(raw, {});
        return (typeof parsed === 'object' && parsed !== null) ? parsed : {};
      }
    } catch (e) {
      console.warn('[ACU] Failed to read window states:', e);
    }
    return {};
  }
  
  /**
   * 保存窗口状态
   * @param {string} windowId - 窗口ID
   * @param {object} state - 窗口状态 { width, height, isMaximized }
   */
  export function saveWindowState_ACU(windowId: string, state: any) {
    try {
      const states = getWindowStates_ACU();
      states[windowId] = state;
      const store = getConfigStorage_ACU();
      store?.setItem?.(ACU_WINDOW_STATE_STORAGE_KEY, safeJsonStringify_ACU(states, '{}'));
      // 触发酒馆设置持久化
      persistTavernSettings_ACU();
    } catch (e) {
      console.warn('[ACU] Failed to save window state:', e);
    }
  }
  
  /**
   * 获取指定窗口的状态
   * @param {string} windowId - 窗口ID
   * @returns {object|null} 窗口状态或null
   */
  export function getWindowState_ACU(windowId: string) {
    const states = getWindowStates_ACU();
    return states[windowId] || null;
  }

  /**
   * 创建独立浮动窗口
   * @param {object} options
   * @param {string} options.id - 窗口唯一ID
   * @param {string} options.title - 窗口标题
   * @param {string} options.content - 窗口内容HTML
   * @param {number} [options.width=900] - 初始宽度
   * @param {number} [options.height=700] - 初始高度
   * @param {boolean} [options.modal=false] - 是否为模态窗口（带遮罩）
   * @param {boolean} [options.resizable=true] - 是否可调整大小
   * @param {boolean} [options.maximizable=true] - 是否可最大化
   * @param {boolean} [options.startMaximized=false] - 是否启动时全屏
   * @param {boolean} [options.rememberState=true] - 是否记住窗口状态
   * @param {function} [options.onClose] - 关闭回调
   * @param {function} [options.onReady] - 窗口就绪回调（DOM已插入）
   * @returns {jQuery} 窗口jQuery对象
   */
  export function createACUWindow(options: any) {
    const {
      id,
      title = '窗口',
      content = '',
      width = 900,
      height = 700,
      modal = false,
      resizable = true,
      maximizable = true,
      startMaximized = false,
      forcePhoneFullscreen = false,
      rememberState = true, // 默认记住窗口状态
      onClose,
      onReady
    } = options;
    
    // 确保窗口基础样式和当前主题变量都已提前注入到主文档。
    // 不能等窗口 DOM 插入后再补主题，否则在 [`createACUWindow()`](src/presentation/window/window-system.ts:116)
    // 生命周期早期出现的遮罩、确认框、首帧窗口 chrome 会回退到默认基础 UI。
    injectACUWindowStyles();
    loadCustomThemes();
    applyTheme();
    
    // 如果窗口已存在，直接显示并置顶
    if (ACU_WindowManager.isOpen(id)) {
      ACU_WindowManager.bringToFront(id);
      return ACU_WindowManager.getWindow(id);
    }
    
    // ═══ 关键：始终挂载到酒馆主窗口（topLevelWindow_ACU）═══
    const targetWin = topLevelWindow_ACU || window;
    const targetDoc = targetWin.document;
    const $ = (targetWin as any).jQuery || jQuery_API_ACU || null;
    if (!$) {
      console.error('[ACU] jQuery not available for window creation');
      return null;
    }
    
    // 计算初始位置（居中）—— 使用主窗口的尺寸
    const viewW = targetWin.innerWidth || 1200;
    const viewH = targetWin.innerHeight || 800;
    
    // ═══ 窄屏检测：≤1100px 视为窄屏，≤768px 视为手机屏 ═══
    const isNarrowScreen = viewW <= 1100;
    const isPhoneScreen = viewW <= 768;
    
    // ═══ 恢复上次保存的窗口状态 ═══
    let savedState = null;
    let useSavedState = false;
    if (rememberState) {
      savedState = getWindowState_ACU(id);
      // 只有在非窄屏模式下才使用保存的状态，窄屏始终使用响应式尺寸
      if (savedState && !isNarrowScreen) {
        useSavedState = true;
      }
    }
    
    // 确保宽高不超过视口；手机端使用更紧凑的浮层尺寸，避免遮挡过多聊天内容
    let initialW, initialH;
    if (useSavedState && savedState.width && savedState.height) {
      // 使用保存的窗口尺寸（确保不超过当前视口）
      initialW = Math.max(400, Math.min(savedState.width, viewW - 40));
      initialH = Math.max(300, Math.min(savedState.height, viewH - 40));
    } else if (isPhoneScreen && !forcePhoneFullscreen) {
      const phoneHorizontalMargin = 12;
      const phoneVerticalMargin = 12;
      const phoneMinWidth = Math.min(320, Math.max(280, viewW - phoneHorizontalMargin));
      const phoneMinHeight = Math.min(360, Math.max(280, viewH - phoneVerticalMargin));
      initialW = Math.max(phoneMinWidth, Math.min(460, viewW - phoneHorizontalMargin));
      initialH = Math.max(phoneMinHeight, Math.min(Math.round(viewH * 0.82), viewH - phoneVerticalMargin));
    } else if (isPhoneScreen && forcePhoneFullscreen) {
      initialW = viewW;
      initialH = viewH;
    } else {
      initialW = Math.max(400, Math.min(width, viewW - 40));
      initialH = Math.max(300, Math.min(height, viewH - 40));
    }
    // 居中并确保不跑出屏幕
    const screenEdgePadding = isPhoneScreen && !forcePhoneFullscreen ? 6 : 20;
    const initialX = Math.max(screenEdgePadding, Math.min((viewW - initialW) / 2, viewW - initialW - screenEdgePadding));
    const initialY = Math.max(screenEdgePadding, Math.min((viewH - initialH) / 2, viewH - initialH - screenEdgePadding));
    
    // 构建窗口HTML
    // ═══ 窄屏模式下不显示全屏按钮，只显示关闭按钮 ═══
    const showMaximizeBtn = maximizable && !isNarrowScreen;
    const windowHtml = `
      <div class="acu-window${forcePhoneFullscreen ? ' acu-window-phone-fullscreen' : ''}" id="${id}" data-phone-fullscreen="${forcePhoneFullscreen ? 'true' : 'false'}" style="left:${forcePhoneFullscreen && isPhoneScreen ? 0 : initialX}px; top:${forcePhoneFullscreen && isPhoneScreen ? 0 : initialY}px; width:${initialW}px; height:${initialH}px;">
        <div class="acu-window-header">
          <div class="acu-window-title">
            <i class="fa-solid fa-database"></i>
            <span>${title}</span>
          </div>
          <div class="acu-window-controls">
            <button class="acu-window-btn theme-toggle" title="切换主题"><span class="acu-theme-toggle-text">素纱</span></button>
            ${showMaximizeBtn ? '<button class="acu-window-btn maximize" title="最大化/还原"><i class="fa-solid fa-expand"></i></button>' : ''}
            <button class="acu-window-btn close" title="关闭"><i class="fa-solid fa-times"></i></button>
          </div>
        </div>
        <div class="acu-window-body">${content}</div>
        ${resizable && !(isPhoneScreen && forcePhoneFullscreen) ? `
          <div class="acu-window-resize-handle se"></div>
          <div class="acu-window-resize-handle e"></div>
          <div class="acu-window-resize-handle s"></div>
          <div class="acu-window-resize-handle w"></div>
          <div class="acu-window-resize-handle n"></div>
          <div class="acu-window-resize-handle nw"></div>
          <div class="acu-window-resize-handle ne"></div>
          <div class="acu-window-resize-handle sw"></div>
        ` : ''}
      </div>
    `;
    
    // 创建遮罩层（模态窗口）—— 挂载到主窗口 body
    let $overlay = null;
    if (modal) {
      $overlay = $(`<div class="acu-window-overlay" data-for="${id}"></div>`);
      $(targetDoc.body).append($overlay);
    }
    
    // 插入窗口 —— 挂载到主窗口 body
    const $window = $(windowHtml);
    $(targetDoc.body).append($window);
    applyACUThemeToDocument_ACU(targetDoc);
    syncACUThemeButtons_ACU(targetDoc);
    
    // ═══ 动画完成后移除 animation 属性 ═══
    // .acu-window 的 slide-in 动画引用了 transform，在 Chromium 内核中会为
    // position:fixed 后代创建 containing block，导致子元素无法相对于视口定位。
    // 动画结束后（0.22s）移除 animation 属性，消除 containing block。
    // 使用 { once: true } 避免内存泄漏，同时用 setTimeout 作为兜底。
    const winEl = $window[0] as HTMLElement | undefined;
    if (winEl) {
      const removeAnimation = () => { winEl.style.animation = 'none'; };
      winEl.addEventListener('animationend', removeAnimation, { once: true });
      setTimeout(removeAnimation, 400); // 兜底：略长于动画时长 0.22s
    }
    
    // 注册到窗口管理器
    ACU_WindowManager.register(id, $window);
    
    // 点击窗口置顶
    $window.on('mousedown', () => ACU_WindowManager.bringToFront(id));

    // 主题切换
    $window.find('.acu-window-btn.theme-toggle').on('click', (e: any) => {
      e.preventDefault();
      e.stopPropagation();
      toggleACUTheme_ACU(targetDoc);
    });
    
    // 关闭按钮
    $window.find('.acu-window-btn.close').on('click', () => {
      // ═══ 关闭时保存窗口状态 ═══
      if (rememberState && maximizable) {
        const currentState = {
          width: isMaximized ? restoreState.width : $window.width(),
          height: isMaximized ? restoreState.height : $window.height(),
          isMaximized: isMaximized
        };
        saveWindowState_ACU(id, currentState);
      }
      
      if (onClose) onClose();
      if ($overlay) $overlay.remove();
      $window.remove();
      ACU_WindowManager.unregister(id);
      // 清理事件
      $(targetDoc).off('.acuWindowDrag' + id);
      $(targetDoc).off('.acuWindowResize' + id);
    });
    
    // 遮罩层点击关闭（可选）
    if ($overlay) {
      $overlay.on('click', (e: any) => {
        if (e.target === $overlay[0]) {
          // 可以选择不关闭，或者关闭
          // 这里选择不关闭，用户必须点击关闭按钮
        }
      });
    }
    
    // 最大化/还原
    let isMaximized = false;
    let restoreState = { left: initialX, top: initialY, width: initialW, height: initialH };
    
    const doMaximize = () => {
      restoreState = {
        left: parseInt($window.css('left')),
        top: parseInt($window.css('top')),
        width: $window.width(),
        height: $window.height()
      };
      $window.addClass('maximized');
      $window.find('.acu-window-btn.maximize i').removeClass('fa-expand').addClass('fa-compress');
      isMaximized = true;
    };
    
    const doRestore = () => {
      $window.removeClass('maximized');
      $window.css({
        left: restoreState.left + 'px',
        top: restoreState.top + 'px',
        width: restoreState.width + 'px',
        height: restoreState.height + 'px'
      });
      $window.find('.acu-window-btn.maximize i').removeClass('fa-compress').addClass('fa-expand');
      isMaximized = false;
    };
    
    $window.find('.acu-window-btn.maximize').on('click', () => {
      if (isMaximized) {
        doRestore();
      } else {
        doMaximize();
      }
    });
    
    // ═══ 启动时全屏逻辑（优先级：手机强制真全屏 > 平板窄屏最大化 > 保存的状态 > startMaximized参数）═══
    // 手机 forcePhoneFullscreen 直接依赖专用 fullscreen CSS，不再叠加 maximized 语义；
    // 否则会重新引入边距、圆角、resize 手柄与高度错位。
    if (isPhoneScreen && forcePhoneFullscreen) {
      isMaximized = false;
    } else if (isNarrowScreen && !isPhoneScreen && maximizable) {
      doMaximize();
    } else if (useSavedState && savedState.isMaximized && maximizable) {
      // 恢复上次的全屏状态
      doMaximize();
    } else if (startMaximized && maximizable) {
      // 使用传入的 startMaximized 参数
      doMaximize();
    }
    
    // 拖拽移动 —— 事件绑定到主窗口 document
    let isDragging = false;
    let dragStartX: number = 0, dragStartY: number = 0, windowStartX: number = 0, windowStartY: number = 0;
    
    $window.find('.acu-window-header').on('mousedown', (e: any) => {
      if ($(e.target).closest('.acu-window-controls').length) return;
      if (isMaximized) return;
      
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      windowStartX = parseInt($window.css('left'));
      windowStartY = parseInt($window.css('top'));
      
      $(targetDoc.body).css('user-select', 'none');
    });
    
    $(targetDoc).on('mousemove.acuWindowDrag' + id, (e: any) => {
      if (!isDragging) return;
      
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      
      $window.css({
        left: Math.max(0, windowStartX + dx) + 'px',
        top: Math.max(0, windowStartY + dy) + 'px'
      });
    });
    
    $(targetDoc).on('mouseup.acuWindowDrag' + id, () => {
      if (isDragging) {
        isDragging = false;
        $(targetDoc.body).css('user-select', '');
      }
    });
    
    // 调整大小 —— 事件绑定到主窗口 document
    if (resizable) {
      let isResizing = false;
      let resizeType = '';
      let resizeStartX: number, resizeStartY: number, startWidth: number, startHeight: number, startLeft: number, startTop: number;
      
      $window.find('.acu-window-resize-handle').on('mousedown', function(this: HTMLElement, e: any) {
        if (isMaximized) return;
        
        isResizing = true;
        resizeType = '';
        if (jQuery_API_ACU(this).hasClass('se')) resizeType = 'se';
        else if (jQuery_API_ACU(this).hasClass('e')) resizeType = 'e';
        else if (jQuery_API_ACU(this).hasClass('s')) resizeType = 's';
        else if (jQuery_API_ACU(this).hasClass('w')) resizeType = 'w';
        else if (jQuery_API_ACU(this).hasClass('n')) resizeType = 'n';
        else if (jQuery_API_ACU(this).hasClass('nw')) resizeType = 'nw';
        else if (jQuery_API_ACU(this).hasClass('ne')) resizeType = 'ne';
        else if (jQuery_API_ACU(this).hasClass('sw')) resizeType = 'sw';
        
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        startWidth = $window.width();
        startHeight = $window.height();
        startLeft = parseInt($window.css('left'));
        startTop = parseInt($window.css('top'));
        
        $(targetDoc.body).css('user-select', 'none');
        e.stopPropagation();
      });
      
      $(targetDoc).on('mousemove.acuWindowResize' + id, (e: any) => {
        if (!isResizing) return;
        
        const dx = e.clientX - resizeStartX;
        const dy = e.clientY - resizeStartY;
        const minW = 400, minH = 300;
        
        let newW = startWidth, newH = startHeight, newL = startLeft, newT = startTop;
        
        if (resizeType.includes('e')) newW = Math.max(minW, startWidth + dx);
        if (resizeType.includes('s')) newH = Math.max(minH, startHeight + dy);
        if (resizeType.includes('w')) {
          const proposedW = startWidth - dx;
          if (proposedW >= minW) {
            newW = proposedW;
            newL = startLeft + dx;
          }
        }
        if (resizeType.includes('n')) {
          const proposedH = startHeight - dy;
          if (proposedH >= minH) {
            newH = proposedH;
            newT = startTop + dy;
          }
        }
        
        $window.css({
          width: newW + 'px',
          height: newH + 'px',
          left: newL + 'px',
          top: newT + 'px'
        });
      });
      
      $(targetDoc).on('mouseup.acuWindowResize' + id, () => {
        if (isResizing) {
          isResizing = false;
          $(targetDoc.body).css('user-select', '');
        }
      });
    }
    
    // 清理事件（窗口关闭时）
    $window.on('remove', () => {
      $(targetDoc).off('.acuWindowDrag' + id);
      $(targetDoc).off('.acuWindowResize' + id);
    });
    
    // 回调
    if (onReady) {
      setTimeout(() => onReady($window), 50);
    }
    
    return $window;
  }

  /**
   * 关闭指定窗口
   */
  export function closeACUWindow(id: string) {
    const $window = ACU_WindowManager.getWindow(id);
    if ($window) {
      // 获取主窗口 jQuery
      const targetWin = topLevelWindow_ACU || window;
      const $ = (targetWin as any).jQuery || (typeof jQuery_API_ACU !== 'undefined' ? jQuery_API_ACU : null);
      if ($) {
        $(`.acu-window-overlay[data-for="${id}"]`).remove();
        // 清理事件
        $(targetWin.document).off('.acuWindowDrag' + id);
        $(targetWin.document).off('.acuWindowResize' + id);
      }
      $window.remove();
      ACU_WindowManager.unregister(id);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // ███ 独立窗口系统结束 ███
  // ═══════════════════════════════════════════════════════════════════════════════

  // --- [Legacy] 旧版"单份设置/单份模板"存储键（仅用于迁移；新版本不再直接读写它们） ---
