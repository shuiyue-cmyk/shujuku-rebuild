/**
 * useDebugPanel — Debug 日志采集与导出语义（用户确认的四条语义 + 连带缺陷）
 *
 * 覆盖：
 * ① 不点 Debug 时缓冲区只有 error（warn / debug 采集默认关）。
 * ② 点「开始 Debug」不清空缓冲区，采集前的 error 原样留着。
 * ③ 手动导出与停止自动导出都取「当时缓冲区全量」，不按 debugStartedAt 切片；
 *    meta.debugStartedAt 仍写，只作「本次采集起始」标注。
 * ④ 停止时自动导出成功后才清空缓冲区并留痕；导出失败绝不清空、如实提示手动导出（不许谎报成功）。
 * ⑤ 手动导出与停止自动导出共用同一个 payload builder（不许再复制第二份构造）。
 * ⑥ Debug 面板只动 warn 的临时来源，开发者选项的常驻来源不被开始/停止牵连。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type App, createApp, defineComponent, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import {
  buildDebugExportPayload_ACU,
  useDebugPanel,
} from '../../../src/presentation-v2/composables/useDebugPanel';
import { useToastStore, __resetToastStoreForTests } from '../../../src/presentation-v2/stores/toast-store';
import { useDevOptionsStore } from '../../../src/presentation-v2/stores/dev-options-store';
import * as logBuffer from '../../../src/shared/log-buffer';
import { logWarn_ACU } from '../../../src/shared/utils';

const {
  _resetForTesting,
  getAllLogs,
  getClearHistory_ACU,
  getLogCount,
  isDebugLogEnabled,
  isWarnLogEnabled,
  pushLog,
  setDebugLogEnabled,
} = logBuffer;

/** 停止 Debug 自动导出成功后清空的 caller 标识（导出里的 clearHistory 靠它自查）。 */
const AUTO_EXPORT_CALLER = 'debugPanel.stopDebug.autoExport';
const BASE_MS = Date.UTC(2026, 8, 27, 12, 0, 0);

const mounted: Array<{ app: App<Element>; el: HTMLElement }> = [];
/** downloadJson 走到 a.click() 才算真交给宿主：在这里收成功落盘的导出件。 */
const downloads: Array<{ filename: string; payload: any }> = [];
let lastBlobJson = '';
let downloadShouldFail = false;

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

/**
 * 替掉真实下载链路（jsdom 没有 createObjectURL）：Blob 记录序列化结果，a.click() 视为交付成功。
 * failDownload=true 模拟宿主拦下下载（click 抛错），用来验证「导出失败不许洗缓冲区」。
 */
function installDownloadHarness(options: { failDownload?: boolean } = {}) {
  downloadShouldFail = options.failDownload === true;
  (globalThis as any).Blob = class {
    constructor(parts: any[]) {
      lastBlobJson = String(parts[0] ?? '');
    }
  };
  (URL as any).createObjectURL = () => 'blob:acu-debug-panel-test';
  (URL as any).revokeObjectURL = () => {};
  (HTMLAnchorElement.prototype as any).click = function (this: HTMLAnchorElement) {
    if (downloadShouldFail) throw new Error('download rejected by host');
    downloads.push({ filename: this.download, payload: JSON.parse(lastBlobJson) });
  };
}

function latestDownload() {
  expect(downloads.length).toBeGreaterThan(0);
  return downloads[downloads.length - 1]!;
}

function noticeTexts(spies: Array<ReturnType<typeof vi.spyOn>>) {
  return spies.flatMap((spy: any) => (spy.mock.calls as any[][]).map((call) => String(call[0] ?? '')));
}

let toastStore: ReturnType<typeof useToastStore>;
let successSpy: ReturnType<typeof vi.spyOn>;
let warningSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  unmountAll();
  // 开发者选项是持久化 store：先清掉别的用例留下的 devOptions，再按用例意图设值
  localStorage.clear();
  setActivePinia(createPinia());
  _resetForTesting();
  // debugStartedAt 是面板模块私有状态：挂一次面板（未采集中会把标注复位成 0），
  // 保证每个用例都从「没记到采集起始」开始，不吃上个用例的残留。
  const probe = mountPanel();
  if (probe.active.value) probe.toggleDebug();
  unmountAll();
  downloads.length = 0;
  lastBlobJson = '';
  installDownloadHarness();
  // 只伪造 Date：导出是否被时间切片需要可控的时间差；定时器保持真实，避免牵连 Vue 调度。
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE_MS);
  toastStore = useToastStore();
  successSpy = vi.spyOn(toastStore, 'success');
  warningSpy = vi.spyOn(toastStore, 'warning');
  errorSpy = vi.spyOn(toastStore, 'error');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  unmountAll();
  // 提示条的自动关闭定时器是真的：用例结束先清掉，避免 jsdom 拆除后回调踩空
  __resetToastStoreForTests();
});

describe('语义②：开始 Debug 不清空缓冲区', () => {
  it('采集前攒下的 error 在点「开始 Debug」之后仍在缓冲区（旧实现被 clearLogs 洗掉）', () => {
    pushLog('error', ['[ACU]', '[导入] 开 Debug 之前就报的错']);
    expect(getLogCount()).toBe(1);

    vi.setSystemTime(BASE_MS + 5000);
    const panel = mountPanel();
    panel.toggleDebug();

    expect(panel.active.value).toBe(true);
    expect(isDebugLogEnabled()).toBe(true);
    expect(getLogCount()).toBe(1);
    expect(getAllLogs()[0]!.message).toContain('开 Debug 之前就报的错');
    // 开始 Debug 不再产生清空留痕
    expect(getClearHistory_ACU()).toEqual([]);
  });

  it('开始 Debug 只是多出 debug 与 warn 两级采集，原有 error 不被覆盖', () => {
    pushLog('error', ['[ACU]', '[导入] 采集前的 error']);
    vi.setSystemTime(BASE_MS + 5000);
    const panel = mountPanel();
    panel.toggleDebug();

    pushLog('debug', ['[ACU]', '[调试] 采集中的 debug']);
    pushLog('warn', ['[ACU]', '[SQL] 采集中的 warn']);

    expect(getAllLogs().map((entry) => entry.level)).toEqual(['error', 'debug', 'warn']);
  });
});

describe('语义③：导出范围＝当时缓冲区全量（取消时间切片）', () => {
  it('手动导出的 logs 含采集前的 error，meta.debugStartedAt 记的是本次采集起始', () => {
    pushLog('error', ['[ACU]', '[导入] 采集前的 error']);
    vi.setSystemTime(BASE_MS + 5000);
    const panel = mountPanel();
    panel.toggleDebug();
    pushLog('debug', ['[ACU]', '[调试] 采集中的 debug']);

    panel.exportDebugData();

    const payload = latestDownload().payload;
    expect(payload.logs.map((log: any) => log.message)).toEqual([
      '[ACU] [导入] 采集前的 error',
      '[ACU] [调试] 采集中的 debug',
    ]);
    expect(payload.logCount).toBe(2);
    expect(new Date(payload.meta.debugStartedAt).getTime()).toBe(BASE_MS + 5000);
  });

  it('停止 Debug 的自动导出的 logs 含采集前的 error，meta.debugStartedAt 仍在', () => {
    pushLog('error', ['[ACU]', '[导入] 采集前的 error']);
    vi.setSystemTime(BASE_MS + 5000);
    const panel = mountPanel();
    panel.toggleDebug();
    pushLog('error', ['[ACU]', '[导入] 采集中的 error']);

    panel.toggleDebug();

    const payload = latestDownload().payload;
    expect(payload.logs.map((log: any) => log.message)).toEqual([
      '[ACU] [导入] 采集前的 error',
      '[ACU] [导入] 采集中的 error',
    ]);
    expect(payload.logCount).toBe(2);
    expect(typeof payload.meta.debugStartedAt).toBe('string');
    expect(new Date(payload.meta.debugStartedAt).getTime()).toBe(BASE_MS + 5000);
  });

  it('采集被外部提前打开（面板没记采集起始）：导出全量，标注退化为最早日志时间', () => {
    setDebugLogEnabled(true);
    vi.setSystemTime(BASE_MS + 8000);
    pushLog('error', ['[ACU]', '[导入] 外部采集期的 error']);

    const panel = mountPanel();
    expect(panel.active.value).toBe(true);
    panel.exportDebugData();

    const payload = latestDownload().payload;
    expect(payload.logs).toHaveLength(1);
    expect(payload.logs[0].message).toContain('外部采集期的 error');
    expect(new Date(payload.meta.debugStartedAt).getTime()).toBe(getAllLogs()[0]!.timestamp);
  });
});

describe('语义④：停止 Debug 的自动导出与清空', () => {
  it('downloadJson 成功后清空缓冲区，并写入本次清空的留痕', () => {
    const panel = mountPanel();
    panel.toggleDebug();
    pushLog('error', ['[ACU]', '[导入] 要一起导出的 error']);
    pushLog('debug', ['[ACU]', '[调试] 要一起导出的 debug']);
    expect(getLogCount()).toBe(2);

    panel.toggleDebug();

    expect(downloads).toHaveLength(1);
    // 导出件本身证明「先导出后清空」：交付那一刻缓冲区还是全量
    expect(latestDownload().payload.logs).toHaveLength(2);
    expect(getLogCount()).toBe(0);
    expect(getClearHistory_ACU().map((item) => item.caller)).toEqual([AUTO_EXPORT_CALLER]);
    expect(successSpy).toHaveBeenCalledTimes(1);
  });

  it('导出失败：缓冲区一条不少、无清空留痕，且提示是警告/错误级并指向手动导出', () => {
    installDownloadHarness({ failDownload: true });
    const panel = mountPanel();
    panel.toggleDebug();
    pushLog('error', ['[ACU]', '[导入] 不能被洗掉的 error']);
    pushLog('debug', ['[ACU]', '[调试] 不能被洗掉的 debug']);

    panel.toggleDebug();

    // 旧实现在 catch 里走 toast.success，把失败说成成功 ⇒ 红
    expect(successSpy).not.toHaveBeenCalled();
    const notices = noticeTexts([warningSpy, errorSpy]);
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.some((text) => text.includes('手动导出'))).toBe(true);
    // 诊断数据不许被洗掉
    expect(downloads).toHaveLength(0);
    expect(getLogCount()).toBe(2);
    expect(getAllLogs().map((entry) => entry.message)).toEqual([
      '[ACU] [导入] 不能被洗掉的 error',
      '[ACU] [调试] 不能被洗掉的 debug',
    ]);
    expect(getClearHistory_ACU()).toEqual([]);
    // 采集开关照常收回
    expect(isDebugLogEnabled()).toBe(false);
    expect(panel.active.value).toBe(false);
  });

  it('失败提示给出的指引必须真的可走通（不能指向被守卫拒绝的按钮）', async () => {
    // 复审抓到的坑：未开启采集时 exportDebugData 有 `!active` 守卫、按钮也是禁用态，
    // 所以"请点导出"这类指引单独出现就是必然失败的假出路。
    // 本用例照提示的措辞把路径走一遍，走不通即红。
    installDownloadHarness({ failDownload: true });
    const panel = mountPanel();
    panel.toggleDebug();
    pushLog('error', ['[ACU]', '[导入] 指引要保住的 error']);
    panel.toggleDebug();

    const notices = noticeTexts([warningSpy, errorSpy]);
    const guidance = notices.find((text) => text.includes('手动导出'));
    expect(guidance).toBeDefined();
    expect(guidance, '提示必须告知先重新开启采集，否则导出按钮是禁用的').toContain('开始 Debug');

    // 按提示执行：重新开启（新语义不清空）→ 手动导出 → 必须真的拿到含旧 error 的文件
    installDownloadHarness({});
    warningSpy.mockClear();
    panel.toggleDebug();
    expect(getLogCount(), '重新开始 Debug 不许洗掉缓冲区').toBe(1);
    panel.exportDebugData();

    expect(warningSpy).not.toHaveBeenCalled();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].payload.logs.map((entry: any) => entry.message)).toEqual([
      '[ACU] [导入] 指引要保住的 error',
    ]);
  });

  it('导出成功文案不得声称文件已落盘（blob 下载无回读信号）', () => {
    const panel = mountPanel();
    panel.toggleDebug();
    pushLog('error', ['[ACU]', '[导入] 措辞检查']);
    panel.exportDebugData();

    const text = successSpy.mock.calls.map((call: any[]) => String(call[0])).join('\n');
    expect(text).toContain('交给浏览器下载');
    // 不允许出现"导出成功/已保存"这类声称落盘的措辞
    expect(text).not.toMatch(/导出成功|已保存/);
  });

  it('手动导出不清空缓冲区（只有停止时的自动导出才收尾清空）', () => {
    const panel = mountPanel();
    panel.toggleDebug();
    pushLog('error', ['[ACU]', '[导入] 留着继续排查的 error']);

    panel.exportDebugData();

    expect(downloads).toHaveLength(1);
    expect(getLogCount()).toBe(1);
    expect(getClearHistory_ACU()).toEqual([]);
  });

  it('缓冲区为空时停止 Debug：不产导出件也不清空（无东西可洗）', () => {
    const panel = mountPanel();
    panel.toggleDebug();

    panel.toggleDebug();

    expect(downloads).toHaveLength(0);
    expect(getClearHistory_ACU()).toEqual([]);
    expect(isDebugLogEnabled()).toBe(false);
  });

  it('未开启 Debug 时点导出被拒且不下发文件（既有守卫不许弱化）', () => {
    pushLog('error', ['[ACU]', '[导入] 未采集时的 error']);
    const panel = mountPanel();

    panel.exportDebugData();

    expect(downloads).toHaveLength(0);
    expect(warningSpy).toHaveBeenCalledTimes(1);
  });
});

describe('语义①＋连带缺陷：warn 采集两个来源取或', () => {
  it('dev 选项开着：停止 Debug 之后常驻采集不受牵连', () => {
    const devOptions = useDevOptionsStore();
    devOptions.setWarnLogEnabled(true);
    const panel = mountPanel();
    panel.toggleDebug();
    expect(isWarnLogEnabled()).toBe(true);

    panel.toggleDebug();

    expect(isWarnLogEnabled()).toBe(true);
    // 改任一 dev 选项 + refresh 会按持久化值回写常驻来源，不能把已开的常驻采集关掉
    devOptions.setPlotAdvanced(true);
    devOptions.refresh();
    expect(isWarnLogEnabled()).toBe(true);
    pushLog('warn', ['[ACU]', '[SQL] 停止 Debug 后仍要采']);
    expect(getAllLogs().map((entry) => entry.level)).toEqual(['warn']);
  });

  it('dev 选项关着：开始 Debug 临时开采集，采集期间改 dev 选项不收回，停止后才收回', () => {
    const devOptions = useDevOptionsStore();
    devOptions.setWarnLogEnabled(false);
    const panel = mountPanel();
    panel.toggleDebug();

    expect(isWarnLogEnabled()).toBe(true);
    pushLog('warn', ['[ACU]', '[SQL] Debug 期间要采']);
    expect(getAllLogs()).toHaveLength(1);

    devOptions.setWarnLogEnabled(false);
    devOptions.refresh();
    expect(isWarnLogEnabled()).toBe(true);

    panel.toggleDebug();
    expect(isWarnLogEnabled()).toBe(false);
    // 自动导出成功 ⇒ 缓冲区已清空；此后 warn 不再被采，只有 error 留得下来
    expect(getLogCount()).toBe(0);
    pushLog('warn', ['[ACU]', '[SQL] 停止后不该再采']);
    pushLog('error', ['[ACU]', '[导入] 停止后的 error']);
    expect(getAllLogs().map((entry) => entry.level)).toEqual(['error']);
  });

  it('两个来源都关（不点 Debug）：缓冲区只有 error，logWarn_ACU 也不打控制台', () => {
    useDevOptionsStore().setWarnLogEnabled(false);
    expect(isWarnLogEnabled()).toBe(false);
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    pushLog('error', ['[ACU]', '[导入] 唯一的 error']);
    pushLog('warn', ['[ACU]', '[SQL] 不该出现']);
    pushLog('debug', ['[ACU]', '[调试] 不该出现']);
    logWarn_ACU('[SQL] 不该出声');

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(getAllLogs().map((entry) => entry.level)).toEqual(['error']);
    consoleSpy.mockRestore();
  });
});

describe('语义⑤：两份导出共用同一个 payload builder（P1 脱敏不许降级）', () => {
  it('手动导出与停止自动导出的 payload 键集合逐字相同，且与 builder 产物一致', () => {
    (globalThis as any).__ACU_DEBUG_LAST_API_BODY__ = {
      model: 'some-model',
      headers: { authorization: 'Bearer sk-abcdefghijklmnopqrstuvwx', 'x-api-key': 'leak-me-please' },
    };
    (globalThis as any).__ACU_DEBUG_LAST_WORLDBOOK__ = { entryCount: 3, note: 'password=hunter2' };
    try {
      pushLog('error', ['[ACU]', '[导入] 采集前的 error']);
      const panel = mountPanel();
      panel.toggleDebug();
      // 直接从共享 builder 取一份基线：两条导出路径的产物必须与它逐字相同
      const expected = JSON.parse(JSON.stringify(buildDebugExportPayload_ACU(getAllLogs())));

      panel.exportDebugData();
      const manual = latestDownload().payload;
      panel.toggleDebug();
      const auto = latestDownload().payload;

      expect(Object.keys(auto)).toEqual(Object.keys(manual));
      expect(Object.keys(manual)).toEqual([
        'meta', 'env', 'settingsSnapshot', 'worldbookDebug', 'lastApiBody',
        'lastApiBodyAt', 'logCount', 'clearHistory', 'logs', 'tables',
      ]);
      expect(Object.keys(auto.meta)).toEqual(Object.keys(manual.meta));
      expect(Object.keys(auto.env)).toEqual(Object.keys(manual.env));
      expect(manual).toEqual(expected);
      expect(auto).toEqual(expected);
    } finally {
      delete (globalThis as any).__ACU_DEBUG_LAST_API_BODY__;
      delete (globalThis as any).__ACU_DEBUG_LAST_WORLDBOOK__;
      delete (globalThis as any).__ACU_DEBUG_LAST_API_BODY_AT__;
    }
  });

  it('导出内容仍走脱敏：Bearer / 裸 apiKey / 复合键与 sk- 密钥串都不出明文', () => {
    (globalThis as any).__ACU_DEBUG_LAST_API_BODY__ = {
      headers: { authorization: 'Authorization: Bearer abc.def.ghi', embeddingApiKey: 'plain-secret-value' },
      url: 'https://api.example.com/v1/chat/completions?key=urlsecretvalue',
    };
    (globalThis as any).__ACU_DEBUG_LAST_WORLDBOOK__ = { entryCount: 3, note: 'password=hunter2' };
    try {
      pushLog('error', ['[ACU]', '[导入] 上游回显 sk-abcdefghijklmnopqrstuvwx']);
      const panel = mountPanel();
      panel.toggleDebug();
      panel.exportDebugData();

      const json = JSON.stringify(latestDownload().payload);
      expect(json).not.toContain('abc.def.ghi');
      expect(json).not.toContain('plain-secret-value');
      expect(json).not.toContain('urlsecretvalue');
      expect(json).not.toContain('hunter2');
      expect(json).toContain('***');
      expect(json).toContain('sk-***');
    } finally {
      delete (globalThis as any).__ACU_DEBUG_LAST_API_BODY__;
      delete (globalThis as any).__ACU_DEBUG_LAST_WORLDBOOK__;
    }
  });

  it('代码复用锚点：payload 构造在源文件里只出现一次，两个入口都调它', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../src/presentation-v2/composables/useDebugPanel.ts'),
      'utf8',
    );
    const count = (needle: string) => source.split(needle).length - 1;

    // 唯一的 builder 定义 + 两个调用点（手动导出 / 停止自动导出）
    expect(count('function buildDebugExportPayload_ACU(')).toBe(1);
    expect(count('buildDebugExportPayload_ACU(')).toBe(3);
    // 复制代码的标志物：这些构造片段各自只允许出现在 builder 里
    expect(count('settingsSnapshot = maskSensitiveFields(')).toBe(1);
    expect(count("plugin: 'TTonly·数据库'")).toBe(1);
    expect(count('clearHistory: getClearHistory_ACU()')).toBe(1);
    expect(count('function debugExportFilename_ACU(')).toBe(1);
    expect(count('downloadJson(debugExportFilename_ACU()')).toBe(2);
  });
});
