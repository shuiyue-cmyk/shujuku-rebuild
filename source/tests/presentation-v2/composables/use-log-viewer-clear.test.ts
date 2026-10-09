/**
 * useLogViewer — 清空缓冲区后视图必须刷新
 *
 * 复现：运行日志的「清空」与停止 Debug 的自动导出都会 clearLogs（模块级缓冲），而日志页只订阅 pushLog，
 * 清空不通知 → 页面继续显示清空前的旧数组；收起重开才拉到真实（空）缓冲。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type App, createApp, defineComponent, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useLogViewer } from '../../../src/presentation-v2/composables/useLogViewer';
import {
  clearLogs,
  pushLog,
  setDebugLogEnabled,
  setWarnLogEnabledByDevOption_ACU,
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

function unmountAll() {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
}

const flush = () => new Promise(resolve => setTimeout(resolve, 30));

beforeEach(() => {
  unmountAll();
  setActivePinia(createPinia());
  _resetForTesting();
  setDebugLogEnabled(true);
  setWarnLogEnabledByDevOption_ACU(true);
});

describe('useLogViewer 显示窗口', () => {
  it('超过窗口上限只保留最近 N 条，并累计折叠条数', async () => {
    const viewer = mountViewer();
    const limit = viewer.windowSizeLimit;
    for (let index = 1; index <= limit + 25; index += 1) pushLog('error', ['[ACU]', `w-${index}`]);
    await flush();

    expect(viewer.logs.value.length).toBe(limit);
    expect(viewer.hiddenByWindow.value).toBe(25);
    expect(viewer.totalCount.value).toBe(limit + 25);
    // 窗口保留的是最新一段（末尾是最后写入的那条）
    expect(viewer.logs.value[viewer.logs.value.length - 1]!.message).toBe(`[ACU] w-${limit + 25}`);
  });

  it('窗口封顶后总量继续增长，不会继续膨胀列表', async () => {
    const viewer = mountViewer();
    const limit = viewer.windowSizeLimit;
    for (let index = 1; index <= limit * 2; index += 1) pushLog('error', ['[ACU]', `x-${index}`]);
    await flush();

    expect(viewer.logs.value.length).toBe(limit);
    expect(viewer.totalCount.value).toBe(limit * 2);
    expect(viewer.hiddenByWindow.value).toBe(limit);
  });
});

describe('useLogViewer 清空刷新', () => {
  it('清空缓冲区后已展示的日志立即消失（不需要重挂页面）', async () => {
    const viewer = mountViewer();
    pushLog('error', ['[ACU]', '清空前的一条']);
    await flush();
    expect(viewer.logs.value.length).toBe(1);

    clearLogs('debugPanel.stopDebug.autoExport');
    await flush();

    expect(viewer.logs.value).toEqual([]);
    expect(viewer.totalCount.value).toBe(0);
  });
});
