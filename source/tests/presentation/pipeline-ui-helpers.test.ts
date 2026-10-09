// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  refreshMerged: vi.fn(),
  surface: {
    refreshVisualizer: vi.fn(),
    isVisualizerActive: vi.fn(),
  },
  registeredSurface: { value: null as any },
}));

vi.mock('../../src/shared/env', () => ({
  topLevelWindow_ACU: { AutoCardUpdaterAPI: { _notifyTableUpdate: vi.fn() } },
}));
vi.mock('../../src/shared/ui-surface-registry', () => ({
  getUiSurface_ACU: () => h.registeredSurface.value,
}));
vi.mock('../../src/shared/utils', () => ({ logDebug_ACU: vi.fn() }));
vi.mock('../../src/service/worldbook/pipeline', () => ({
  refreshMergedDataAndNotify_ACU: h.refreshMerged,
}));

import { refreshMergedDataAndNotifyWithUI_ACU } from '../../src/presentation/components/pipeline-ui-helpers';
import { topLevelWindow_ACU } from '../../src/shared/env';

const notify = (topLevelWindow_ACU as any).AutoCardUpdaterAPI._notifyTableUpdate as ReturnType<typeof vi.fn>;

function registerSurface(isActive: boolean | undefined) {
  h.registeredSurface.value = {
    refreshVisualizer: h.surface.refreshVisualizer,
    ...(typeof isActive === 'boolean' ? { isVisualizerActive: () => isActive } : {}),
  };
}

async function runWithTimers(operation: Promise<unknown>, ms = 800) {
  await vi.runAllTicks();
  await vi.advanceTimersByTimeAsync(ms);
  return operation;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  h.registeredSurface.value = null;
  h.refreshMerged.mockResolvedValue({ ok: true });
  h.surface.refreshVisualizer.mockResolvedValue(undefined);
  h.surface.isVisualizerActive.mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('refreshMergedDataAndNotifyWithUI_ACU UI 可见性裁剪', () => {

  it('isVisualizerActive 返回 true 时安排一次可视化刷新', async () => {
    registerSurface(true);
    const operation = refreshMergedDataAndNotifyWithUI_ACU();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(200);
    expect(h.surface.refreshVisualizer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    await operation;
  });

  it('refreshVisualizer 被拒绝时不使外层函数 reject', async () => {
    registerSurface(true);
    h.surface.refreshVisualizer.mockRejectedValue(new Error('boom'));
    const operation = refreshMergedDataAndNotifyWithUI_ACU();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(800);
    await expect(operation).resolves.toMatchObject({ ok: true });
  });

  it('通知前端后调用 _notifyTableUpdate 一次', async () => {
    await runWithTimers(refreshMergedDataAndNotifyWithUI_ACU());
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
