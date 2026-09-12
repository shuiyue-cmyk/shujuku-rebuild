/**
 * useLogViewer — v9.5.4 修复钉（导出全量 / 暂停 O(1) 封顶 / 清空广播）
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useLogViewer } from '../../../src/presentation-v2/composables/useLogViewer';
import {
  clearLogs,
  pushLog,
  setDebugLogEnabled,
  setWarnLogEnabled,
  _resetForTesting,
} from '../../../src/shared/log-buffer';

const mounted: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountViewer() {
  let viewer: ReturnType<typeof useLogViewer> | null = null;
  const wrapper = defineComponent({
    setup() {
      viewer = useLogViewer();
      return () => h('div');
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  mounted.push({ app, el });
  if (!viewer) throw new Error('viewer not mounted');
  return viewer;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 30));

beforeEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
  setActivePinia(createPinia());
  _resetForTesting();
  setDebugLogEnabled(true);
  setWarnLogEnabled(true);
});

describe('useLogViewer v9.5.4 修复', () => {
  it('导出按当前筛选取全量缓冲（忽略显示窗口上限）', async () => {
    const viewer = mountViewer();
    for (let i = 0; i < 311; i++) pushLog('error', ['[ACU]', `boom-${i}`]);
    await flush();
    viewer.refresh();
    expect(viewer.logs.value.length).toBe(300);

    let captured = '';
    const OrigBlob = globalThis.Blob;
    (globalThis as any).Blob = class {
      constructor(parts: any[]) { captured = String(parts[0]); }
    };
    const OrigCreate = (URL as any).createObjectURL;
    const OrigRevoke = (URL as any).revokeObjectURL;
    (URL as any).createObjectURL = () => 'blob:mock';
    (URL as any).revokeObjectURL = () => {};
    try {
      viewer.exportFiltered();
    } finally {
      (globalThis as any).Blob = OrigBlob;
      (URL as any).createObjectURL = OrigCreate;
      (URL as any).revokeObjectURL = OrigRevoke;
    }
    const exported = JSON.parse(captured);
    expect(exported.logs.length).toBe(311);
    expect(exported.logs[0].message).toContain('boom-0');
  });

  it('暂停积压只计数封顶且恢复不回填旧积压', async () => {
    const viewer = mountViewer();
    viewer.setPaused(true);
    for (let k = 0; k < 400; k++) pushLog('info', ['ACU', `tick-${k}`]);
    await flush();
    expect(viewer.pendingCount.value).toBe(300);
    viewer.setPaused(false);
    await flush();
    const text = viewer.visibleLogs.value.map(e => e.message).join('|');
    expect(text).not.toContain('tick-0');
    expect(text).not.toContain('tick-50');
    expect(viewer.visibleLogs.value.length).toBeLessThanOrEqual(300);
  });

  it('清空广播丢弃在飞追加队列与暂停积压（无幽灵日志）', async () => {
    const viewer = mountViewer();
    viewer.setPaused(true);
    pushLog('info', ['ACU', 'ghost']);
    await flush();
    expect(viewer.pendingCount.value).toBe(1);
    viewer.clearAll();
    await flush();
    expect(viewer.pendingCount.value).toBe(0);
    expect(viewer.totalCount.value).toBe(0);
    expect(viewer.hiddenByWindow.value).toBe(0);
    expect(viewer.visibleLogs.value.map(e => e.message).join('')).not.toContain('ghost');
  });
});
