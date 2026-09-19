/**
 * tests/presentation/bootstrap/tauri-version-gate.test.ts
 * TT 版本闸门：低于 2.3.0 时弹模态提醒升级（每次启动都提醒；非 TT 宿主与读取失败不打扰）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const g = globalThis as any;
const toastSpy = vi.hoisted(() => ({ show: vi.fn() }));

vi.mock('../../../src/presentation/theme/toast', () => ({
  showToastr_ACU: toastSpy.show,
}));
vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

function installFakeWindow(win: any): void {
  g.window = win;
}

function makeTauriWindow(tauriVersion: string | null, opts: { withPopup?: boolean } = {}) {
  const safeInvoke = vi.fn().mockResolvedValue(tauriVersion === null ? {} : { tauriVersion });
  const callGenericPopup = vi.fn().mockResolvedValue(1);
  const win: any = { __TAURITAVERN__: { invoke: { safeInvoke } } };
  if (opts.withPopup !== false) {
    win.SillyTavern = { getContext: () => ({ callGenericPopup, POPUP_TYPE: { TEXT: 1 } }) };
  }
  installFakeWindow(win);
  return { win, callGenericPopup, safeInvoke };
}

/** 闸门模块带「本次页面加载只提醒一次」的模块级状态 ⇒ 每个用例取全新模块实例。 */
async function loadGate() {
  vi.resetModules();
  return await import('../../../src/presentation/bootstrap/tauri-version-gate');
}

afterEach(() => {
  delete g.window;
  vi.clearAllMocks();
});

describe('buildAcuTauriVersionWarningHtml_ACU', () => {
  it('同时给出当前版本与要求版本', async () => {
    const { buildAcuTauriVersionWarningHtml_ACU } = await loadGate();
    const html = buildAcuTauriVersionWarningHtml_ACU('2.2.0');
    expect(html).toContain('2.2.0');
    expect(html).toContain('2.3.0');
    expect(html).toContain('TauriTavern');
  });

  it('版本串经 HTML 转义（宿主返回值不外泄为标记）', async () => {
    const { buildAcuTauriVersionWarningHtml_ACU } = await loadGate();
    const html = buildAcuTauriVersionWarningHtml_ACU('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x');
  });
});

describe('notifyAcuTauriVersionIfOutdated_ACU', () => {
  it('非 TT 宿主不提醒、不弹窗', async () => {
    installFakeWindow({ SillyTavern: { getContext: () => ({ callGenericPopup: vi.fn(), POPUP_TYPE: { TEXT: 1 } }) } });
    const { notifyAcuTauriVersionIfOutdated_ACU } = await loadGate();
    await expect(notifyAcuTauriVersionIfOutdated_ACU()).resolves.toBe(false);
    expect(toastSpy.show).not.toHaveBeenCalled();
  });

  it('TT 版本低于 2.3.0 时弹模态提醒，正文带当前版本', async () => {
    const { callGenericPopup } = makeTauriWindow('2.2.0');
    const { notifyAcuTauriVersionIfOutdated_ACU } = await loadGate();

    await expect(notifyAcuTauriVersionIfOutdated_ACU()).resolves.toBe(true);
    expect(callGenericPopup).toHaveBeenCalledTimes(1);
    const [html, type] = callGenericPopup.mock.calls[0];
    expect(String(html)).toContain('2.2.0');
    expect(String(html)).toContain('2.3.0');
    expect(type).toBe(1);
    expect(toastSpy.show).not.toHaveBeenCalled();
  });

  it('同一次页面加载内只提醒一次（init 重入不叠窗）', async () => {
    const { callGenericPopup } = makeTauriWindow('2.1.1');
    const { notifyAcuTauriVersionIfOutdated_ACU } = await loadGate();

    await expect(notifyAcuTauriVersionIfOutdated_ACU()).resolves.toBe(true);
    await expect(notifyAcuTauriVersionIfOutdated_ACU()).resolves.toBe(false);
    expect(callGenericPopup).toHaveBeenCalledTimes(1);
  });

  it('版本满足要求时不提醒', async () => {
    const { callGenericPopup } = makeTauriWindow('2.3.0');
    const { notifyAcuTauriVersionIfOutdated_ACU } = await loadGate();
    await expect(notifyAcuTauriVersionIfOutdated_ACU()).resolves.toBe(false);
    expect(callGenericPopup).not.toHaveBeenCalled();
  });

  it('更高版本不提醒', async () => {
    const { callGenericPopup } = makeTauriWindow('3.1.4');
    const { notifyAcuTauriVersionIfOutdated_ACU } = await loadGate();
    await expect(notifyAcuTauriVersionIfOutdated_ACU()).resolves.toBe(false);
    expect(callGenericPopup).not.toHaveBeenCalled();
  });

  it('版本读取失败时 fail-open：不提醒也不抛错', async () => {
    const callGenericPopup = vi.fn();
    installFakeWindow({
      __TAURITAVERN__: { invoke: { safeInvoke: vi.fn().mockRejectedValue(new Error('invoke down')) } },
      SillyTavern: { getContext: () => ({ callGenericPopup, POPUP_TYPE: { TEXT: 1 } }) },
    });
    const { notifyAcuTauriVersionIfOutdated_ACU } = await loadGate();
    await expect(notifyAcuTauriVersionIfOutdated_ACU()).resolves.toBe(false);
    expect(callGenericPopup).not.toHaveBeenCalled();
    expect(toastSpy.show).not.toHaveBeenCalled();
  });

  it('弹窗 API 不可用时退化为 warning toast，不静默丢弃提醒', async () => {
    makeTauriWindow('2.0.0', { withPopup: false });
    const { notifyAcuTauriVersionIfOutdated_ACU } = await loadGate();

    await expect(notifyAcuTauriVersionIfOutdated_ACU()).resolves.toBe(true);
    expect(toastSpy.show).toHaveBeenCalledTimes(1);
    expect(toastSpy.show.mock.calls[0][0]).toBe('warning');
    expect(String(toastSpy.show.mock.calls[0][1])).toContain('2.0.0');
  });
});
