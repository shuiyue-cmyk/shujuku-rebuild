/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountListener() {
  const refreshVisualizer = vi.fn(async () => undefined);
  vi.doMock('../../src/presentation-v2/surfaces/visualizer/open-visualizer-surface', () => ({
    requestVisualizerExternalRefresh_ACU: refreshVisualizer,
  }));
  const [{ createApp, h, nextTick }, listener, bridge] = await Promise.all([
    import('vue'),
    import('../../src/presentation-v2/composables/useTemplateRuntimeChangeListener'),
    import('../../src/shared/template-runtime-change'),
  ]);
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({
    setup: () => {
      listener.useTemplateRuntimeChangeListener();
      return () => h('div');
    },
  });
  app.mount(host);
  await nextTick();
  return { app, bridge, listener, refreshVisualizer, host };
}

describe('useTemplateRuntimeChangeListener', () => {
  it('合并同一 microtask 内的提交，并刷新 visualizer', async () => {
    const { app, bridge, listener, refreshVisualizer, host } = await mountListener();
    const initialTick = listener.useTemplateRuntimeChangeTick().value;

    bridge.notifyTemplateRuntimeCommitted_ACU();
    bridge.notifyTemplateRuntimeCommitted_ACU();
    await Promise.resolve();

    expect(listener.useTemplateRuntimeChangeTick().value).toBe(initialTick + 1);
    expect(refreshVisualizer).toHaveBeenCalledOnce();
    app.unmount();
    host.remove();
  });

  it('卸载后取消订阅，不再刷新', async () => {
    const { app, bridge, listener, refreshVisualizer, host } = await mountListener();
    const initialTick = listener.useTemplateRuntimeChangeTick().value;
    app.unmount();
    host.remove();

    bridge.notifyTemplateRuntimeCommitted_ACU();
    await Promise.resolve();

    expect(listener.useTemplateRuntimeChangeTick().value).toBe(initialTick);
    expect(refreshVisualizer).not.toHaveBeenCalled();
    expect(bridge.getTemplateRuntimeChangeSubscriberCountForTests_ACU()).toBe(0);
  });
});
