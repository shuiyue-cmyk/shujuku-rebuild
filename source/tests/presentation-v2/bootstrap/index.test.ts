import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  registerUiSurface: vi.fn(),
  registerMenu: vi.fn(),
  installApi: vi.fn(),
  openShell: vi.fn(async () => true),
  openVisualizer: vi.fn(async () => true),
  refreshVisualizer: vi.fn(async () => undefined),
  isVisualizerActive: vi.fn(() => true),
}));

vi.mock('../../../src/shared/ui-surface-registry', () => ({
  registerUiSurface_ACU: h.registerUiSurface,
}));
vi.mock('../../../src/presentation-v2/bootstrap/menu-button', () => ({
  registerAcuV2MenuButton: h.registerMenu,
}));
vi.mock('../../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface', () => ({
  installAutoCardUpdaterV2Api_ACU: h.installApi,
  openAcuV2Shell_ACU: h.openShell,
  openVisualizerSurface_ACU: h.openVisualizer,
  requestVisualizerExternalRefresh_ACU: h.refreshVisualizer,
  isVisualizerSurfaceActive_ACU: h.isVisualizerActive,
}));

describe('bootstrapAcuV2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('注册 V2 UI surface 后再安装公开桥接与菜单', async () => {
    const { bootstrapAcuV2 } = await import('../../../src/presentation-v2/bootstrap');

    bootstrapAcuV2();

    expect(h.registerUiSurface).toHaveBeenCalledTimes(1);
    expect(h.installApi).toHaveBeenCalledTimes(1);
    expect(h.registerMenu).toHaveBeenCalledTimes(1);
    expect(h.registerUiSurface.mock.invocationCallOrder[0])
      .toBeLessThan(h.installApi.mock.invocationCallOrder[0]);
    expect(h.installApi.mock.invocationCallOrder[0])
      .toBeLessThan(h.registerMenu.mock.invocationCallOrder[0]);

    const handlers = h.registerUiSurface.mock.calls[0][0];
    await expect(handlers.openSettings()).resolves.toBe(true);
    await expect(handlers.openVisualizer()).resolves.toBe(true);
    await expect(handlers.refreshVisualizer()).resolves.toBeUndefined();

    expect(h.openShell).toHaveBeenCalledTimes(1);
    expect(h.openVisualizer).toHaveBeenCalledWith({ source: 'external-api' });
    expect(h.refreshVisualizer).toHaveBeenCalledTimes(1);
  });
});
