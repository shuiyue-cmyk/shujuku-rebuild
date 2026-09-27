/**
 * useDebugPanel — 关 UI 重开不丢采集态
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type App, createApp, defineComponent, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useDebugPanel } from '../../../src/presentation-v2/composables/useDebugPanel';
import { getAllLogs, isDebugLogEnabled, pushLog, setDebugLogEnabled } from '../../../src/shared/log-buffer';

const mounted: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountPanel() {
  let panel: ReturnType<typeof useDebugPanel> | null = null;
  const wrapper = defineComponent({
    setup() {
      panel = useDebugPanel();
      return () => h('div');
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  mounted.push({ app, el });
  if (!panel) throw new Error('panel not mounted');
  return panel;
}

function unmountAll() {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
}

beforeEach(() => {
  unmountAll();
  setActivePinia(createPinia());
  setDebugLogEnabled(false);
  // 模块级 active/startedAt 不随用例自动清：若上个用例异常中断在采集中，这里走一次真实停止复位
  const probe = mountPanel();
  if (probe.active.value) probe.toggleDebug();
  unmountAll();
  setDebugLogEnabled(false);
});

describe('useDebugPanel 跨 UI 开关', () => {
  it('关 UI 不停采集：重开后仍显示采集中', () => {
    const first = mountPanel();
    expect(first.active.value).toBe(false);

    first.toggleDebug();
    expect(first.active.value).toBe(true);
    expect(isDebugLogEnabled()).toBe(true);

    unmountAll();
    // 采集开关是模块级的，关 UI 不停
    expect(isDebugLogEnabled()).toBe(true);

    const second = mountPanel();
    // 重开显示真实状态，而不是弹回“开始 Debug”
    expect(second.active.value).toBe(true);
    expect(second.statusLabel.value).toBe('采集中');

    second.toggleDebug();
    expect(isDebugLogEnabled()).toBe(false);
  });

  it('重开后按钮作用于真实状态：点一次是停止而不是重开洗日志', () => {
    const first = mountPanel();
    first.toggleDebug();
    expect(isDebugLogEnabled()).toBe(true);
    unmountAll();

    const second = mountPanel();
    expect(second.active.value).toBe(true);
    // 显示采集中，点按钮走停止分支（会尝试自动导出，jsdom 下回退为普通提示）
    second.toggleDebug();
    expect(second.active.value).toBe(false);
    expect(isDebugLogEnabled()).toBe(false);
  });

  it('复现：开始采集后写入的日志，关 UI 重开后仍在缓冲区', () => {
    const first = mountPanel();
    first.toggleDebug();
    pushLog('debug', ['[repro] 采集中的标记日志']);
    const before = getAllLogs().length;
    expect(before).toBeGreaterThan(0);
    unmountAll();

    mountPanel();
    // 缓冲区是模块级的，UI 开关不应影响内容
    expect(getAllLogs().length).toBe(before);
    expect(getAllLogs().some(e => e.message.includes('[repro]'))).toBe(true);
  });

  it('复现：全新开始不清空缓冲区，采集前的旧日志跟着一起导出', () => {
    setDebugLogEnabled(true);
    pushLog('debug', ['[repro] 采集前旧日志']);
    setDebugLogEnabled(false);
    expect(getAllLogs().length).toBeGreaterThan(0);

    const panel = mountPanel();
    expect(panel.active.value).toBe(false);
    panel.toggleDebug();
    // 语义变更：点「开始 Debug」不再 clearLogs，用户开着 Debug 之前攒的报错才是排查材料
    expect(getAllLogs().some(e => e.message.includes('[repro]'))).toBe(true);
    panel.toggleDebug();
  });
});
