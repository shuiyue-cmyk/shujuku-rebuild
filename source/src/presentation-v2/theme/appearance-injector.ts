/**
 * appearance-injector — 把本机外观偏好翻成 v2 尺寸 token。
 *
 * 缩放只写入 #acu-app-v2 作用域下的 CSS 变量；组件消费语义 token，
 * 避免在 App.vue 内维护一份巨大的逐像素 style object。
 */
import { getAcuHostDocument } from '../bootstrap/host-document';
import { APP_ROOT_ID } from './theme-injector';
import type { AcuUiScaleOption } from '../stores/appearance-store';

export const APPEARANCE_STYLE_NODE_ID = 'acu-v2-appearance';

function scaledPx(base: number, scale: number): string {
  return `${Math.round(base * scale * 100) / 100}px`;
}

function buildCss(option: AcuUiScaleOption): string {
  const scale = Number(option.cssScale);
  const px = (base: number) => scaledPx(base, scale);
  return `#${APP_ROOT_ID} {
  --acu-ui-scale: ${option.cssScale};

  --acu-font-size-micro: ${px(10)};
  --acu-font-size-caption: ${px(11)};
  --acu-font-size-body: ${px(12)};
  --acu-font-size-body-lg: ${px(13)};
  --acu-font-size-section-title: ${px(12)};
  --acu-font-size-list-title: ${px(13)};
  --acu-font-size-panel-title: ${px(15)};
  --acu-font-size-page-title: ${px(22)};
  --acu-font-size-page-title-compact: ${px(18)};

  --acu-line-height-caption: 1.5;
  --acu-line-height-body: 1.45;
  --acu-line-height-readable: 1.55;

  --acu-space-025: ${px(1)};
  --acu-space-050: ${px(2)};
  --acu-space-075: ${px(3)};
  --acu-space-1: ${px(4)};
  --acu-space-125: ${px(5)};
  --acu-space-150: ${px(6)};
  --acu-space-175: ${px(7)};
  --acu-space-2: ${px(8)};
  --acu-space-225: ${px(9)};
  --acu-space-250: ${px(10)};
  --acu-space-3: ${px(12)};
  --acu-space-350: ${px(14)};
  --acu-space-4: ${px(16)};
  --acu-space-450: ${px(18)};
  --acu-space-5: ${px(20)};
  --acu-space-6: ${px(24)};
  --acu-space-7: ${px(28)};
  --acu-space-8: ${px(32)};
  --acu-space-850: ${px(34)};
  --acu-space-9: ${px(36)};
  --acu-space-10: ${px(40)};
  --acu-space-12: ${px(48)};
  --acu-space-1250: ${px(50)};

  --acu-control-height-sm: ${px(26)};
  --acu-control-height-md: ${px(32)};
  --acu-control-padding-y-sm: ${px(3)};
  --acu-control-padding-x-sm: ${px(7)};
  --acu-control-padding-y-md: ${px(6)};
  --acu-control-padding-x-md: ${px(9)};
  --acu-button-height-sm: ${px(28)};
  --acu-button-height-md: ${px(32)};
  --acu-icon-button-size-sm: ${px(22)};
  --acu-icon-button-size-md: ${px(32)};
  --acu-icon-inline-sm: ${px(10)};
  --acu-icon-inline-md: ${px(13)};
  --acu-checkbox-size: ${px(16)};
  --acu-checkbox-icon-size: ${px(12)};
  --acu-segment-height-sm: ${px(24)};
  --acu-segment-height-md: ${px(30)};
  --acu-toggle-width: ${px(36)};
  --acu-toggle-height: ${px(20)};
  --acu-toggle-radius: ${px(10)};
  --acu-toggle-thumb-size: ${px(16)};
  --acu-toggle-thumb-shift: ${px(16)};

  --acu-page-padding: ${px(20)};
  --acu-page-padding-compact: ${px(14)};
  --acu-page-gap: ${px(14)};
  --acu-panel-padding: ${px(16)};
  --acu-panel-gap: ${px(12)};
  --acu-panel-grid-gap: ${px(16)};
  --acu-sidebar-width: ${px(220)};
  --acu-shell-header-height: ${px(50)};
  --acu-shell-header-height-compact: ${px(48)};
  --acu-shell-header-action-size: ${px(30)};
  --acu-mobile-nav-width: ${px(360)};
  --acu-mobile-nav-edge-gap: ${px(24)};

  --acu-menu-offset: ${px(6)};
  --acu-menu-padding: ${px(4)};
  --acu-menu-min-width: ${px(240)};
  --acu-menu-width: ${px(300)};
  --acu-menu-max-height: ${px(240)};
  --acu-menu-section-gap: ${px(8)};
  --acu-menu-option-padding-y: ${px(7)};
  --acu-menu-option-padding-x: ${px(10)};
  --acu-menu-swatch-size: ${px(18)};
  --acu-menu-action-size: ${px(24)};

  --acu-dialog-edge-gap: ${px(18)};
  --acu-dialog-edge-gap-compact: ${px(12)};
  --acu-dialog-width: ${px(440)};
  --acu-dialog-max-height: ${px(560)};
  --acu-dialog-choice-min-width: ${px(128)};
  --acu-drawer-width: ${px(480)};
  --acu-toast-top: ${px(62)};
  --acu-toast-top-compact: ${px(58)};
  --acu-toast-width: ${px(360)};
  --acu-toast-edge-gap: ${px(18)};
  --acu-toast-edge-gap-compact: ${px(12)};
}
`;
}

export function applyAppearance(option: AcuUiScaleOption): void {
  const doc = getAcuHostDocument();
  let style = doc.getElementById(APPEARANCE_STYLE_NODE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = APPEARANCE_STYLE_NODE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = buildCss(option);

  const root = doc.getElementById(APP_ROOT_ID);
  if (root) {
    root.style.setProperty('--acu-ui-scale', option.cssScale);
    root.setAttribute('data-acu-ui-scale', option.value);
  }
}

/** 仅供测试：清掉注入的样式节点与根节点标记。 */
export function __resetAppearanceInjectorForTests(): void {
  const doc = getAcuHostDocument();
  doc.getElementById(APPEARANCE_STYLE_NODE_ID)?.remove();
  const root = doc.getElementById(APP_ROOT_ID);
  if (root) {
    root.style.removeProperty('--acu-ui-scale');
    root.removeAttribute('data-acu-ui-scale');
  }
}
