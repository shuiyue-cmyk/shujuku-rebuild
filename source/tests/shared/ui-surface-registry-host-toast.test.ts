/**
 * 面板未打开时的提示走插件自己的提示框（与新界面同一设计），不再直接调宿主 toastr 的默认样式。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerHostToastRenderer_ACU,
  resetUiSurfaceRegistryForTests_ACU,
  showUiSurfaceToast_ACU,
} from '../../src/shared/ui-surface-registry';

afterEach(() => {
  resetUiSurfaceRegistryForTests_ACU();
});

describe('宿主提示框渲染器', () => {
  it('未注册面板时，统一入口交给已注册的插件提示框渲染', () => {
    const renderer = vi.fn();
    registerHostToastRenderer_ACU(renderer);
    const payload = { kind: 'warning' as const, text: '历史需要恢复收敛' };
    showUiSurfaceToast_ACU(payload);
    expect(renderer).toHaveBeenCalledWith(payload);
  });
});
