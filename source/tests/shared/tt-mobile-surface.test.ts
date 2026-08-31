/**
 * tests/shared/tt-mobile-surface.test.ts
 * TT Layout ABI 打标工具：属性名/枚举与宿主（TauriTavern dev docs/API/Layout.md §1.2）对齐，
 * 空元素与非法值静默跳过（不打脏属性）。
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';

import {
  TT_MOBILE_SURFACE_ACU,
  TT_MOBILE_SURFACE_ATTR_ACU,
  applyTtMobileSurface_ACU,
} from '../../src/shared/tt-mobile-surface';

describe('tt-mobile-surface — 宿主 ABI 对齐', () => {
  it('属性名与宿主 layout-kit SURFACE_ATTR 一致', () => {
    expect(TT_MOBILE_SURFACE_ATTR_ACU).toBe('data-tt-mobile-surface');
  });

  it('枚举值与 docs/API/Layout.md §1.2 taxonomy 一致', () => {
    expect(TT_MOBILE_SURFACE_ACU).toEqual({
      Backdrop: 'backdrop',
      FullscreenWindow: 'fullscreen-window',
      FreeWindow: 'free-window',
      ViewportHost: 'viewport-host',
      EdgeWindow: 'edge-window',
      None: 'none',
    });
  });
});

describe('applyTtMobileSurface_ACU', () => {
  it('写入 data-tt-mobile-surface 属性并返回 true', () => {
    const el = document.createElement('div');
    expect(applyTtMobileSurface_ACU(el, TT_MOBILE_SURFACE_ACU.FullscreenWindow)).toBe(true);
    expect(el.getAttribute('data-tt-mobile-surface')).toBe('fullscreen-window');
    expect(el.dataset.ttMobileSurface).toBe('fullscreen-window');
  });

  it('backdrop / free-window 同样按字面值写入', () => {
    const mask = document.createElement('div');
    const bubble = document.createElement('div');
    applyTtMobileSurface_ACU(mask, TT_MOBILE_SURFACE_ACU.Backdrop);
    applyTtMobileSurface_ACU(bubble, TT_MOBILE_SURFACE_ACU.FreeWindow);
    expect(mask.getAttribute('data-tt-mobile-surface')).toBe('backdrop');
    expect(bubble.getAttribute('data-tt-mobile-surface')).toBe('free-window');
  });

  it('null/undefined 元素静默跳过并返回 false', () => {
    expect(applyTtMobileSurface_ACU(null, TT_MOBILE_SURFACE_ACU.Backdrop)).toBe(false);
    expect(applyTtMobileSurface_ACU(undefined, TT_MOBILE_SURFACE_ACU.None)).toBe(false);
  });

  it('非法 surface 值不写属性并返回 false（避免打脏宿主不识别的值）', () => {
    const el = document.createElement('div');
    expect(applyTtMobileSurface_ACU(el, 'popup-window' as never)).toBe(false);
    expect(el.hasAttribute('data-tt-mobile-surface')).toBe(false);
  });

  it('重复打标幂等覆盖，不产生第二个属性', () => {
    const el = document.createElement('div');
    applyTtMobileSurface_ACU(el, TT_MOBILE_SURFACE_ACU.FreeWindow);
    applyTtMobileSurface_ACU(el, TT_MOBILE_SURFACE_ACU.Backdrop);
    expect(el.getAttributeNames()).toEqual(['data-tt-mobile-surface']);
    expect(el.getAttribute('data-tt-mobile-surface')).toBe('backdrop');
  });
});
