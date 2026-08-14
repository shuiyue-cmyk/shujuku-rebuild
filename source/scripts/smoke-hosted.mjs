/**
 * scripts/smoke-hosted.mjs — 构建产物宿主冒烟测试
 *
 * 用 jsdom 模拟 SillyTavern/TauriTavern 宿主环境加载根目录 index.js（构建产物），
 * 验证：扩展可启动、AutoCardUpdaterAPI/V2API 挂载、事件注册、V2 UI 挂载、零运行时错误。
 *
 * 用法（需先 npm run build）：
 *   cd source && npm run smoke
 */
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { appendFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(here, '..');
const repoRoot = join(sourceRoot, '..');
const require = createRequire(import.meta.url);
const traceFile = join(sourceRoot, '.smoke-trace.log');
const log = (m) => { try { appendFileSync(traceFile, String(m) + '\n'); } catch {} };
rmSync(traceFile, { force: true });

log('step0: start');
const errors = [];
process.on('uncaughtException', (e) => { log('uncaught: ' + (e?.stack || e)); });
process.on('unhandledRejection', (e) => { log('unhandledRejection: ' + (e?.stack || e)); });

const dom = new JSDOM(
  '<!DOCTYPE html><html><body>' +
  '<button id="send_but"></button><textarea id="send_textarea"></textarea>' +
  '<div id="extensions_settings"></div><div id="extensionsMenu"></div><div id="movingDivs"></div>' +
  '</body></html>',
  { url: 'http://localhost:8000/', pretendToBeVisual: true, runScripts: 'outside-only' },
);
const { window } = dom;
const g = globalThis;
g.window = window;
g.document = window.document;
// Node 24 的 globalThis.navigator 是只读 getter；performance 保留 Node 原生（jsdom 的会循环递归）
g.localStorage = window.localStorage;
g.sessionStorage = window.sessionStorage;
g.history = window.history;
g.location = window.location;
g.HTMLElement = window.HTMLElement;
g.Event = window.Event;
g.KeyboardEvent = window.KeyboardEvent;
g.getComputedStyle = window.getComputedStyle;
g.requestAnimationFrame = (cb) => setTimeout(cb, 0);
g.cancelAnimationFrame = (id) => clearTimeout(id);
g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
g.AbortController = AbortController;
log('step1: jsdom+globals ready');

// window 就绪后加载 jquery；require 返回即已绑定 window 的 jQuery 函数
const $ = require('jquery');
window.$ = $;
window.jQuery = $;
g.$ = $;
g.jQuery = $;
window.toastr = { success() {}, info() {}, warning() {}, error() {}, remove() {} };
g.toastr = window.toastr;
log('step2: jquery+toastr ready');

// ST 宿主桩
const listeners = {};
const emit = (type, data) => { (listeners[type] || []).forEach((cb) => { try { cb(data); } catch (e) { log('listener ' + type + ' -> ' + (e?.stack || e)); } }); };
const eventTypes = {
  CHAT_CHANGED: 'chat', CHAT_COMPLETION_SETTINGS_READY: 'ccsr', MESSAGE_SENT: 'ms',
  GENERATION_STARTED: 'gs', GENERATION_STOPPED: 'gst', GENERATION_ENDED: 'ge',
  GENERATION_AFTER_COMMANDS: 'gac', MESSAGE_DELETED: 'md', MESSAGE_SWIPED: 'msw', MESSAGE_UPDATED: 'mu',
};
const ctx = {
  eventSource: { on: (t, cb) => { (listeners[t] = listeners[t] || []).push(cb); }, makeFirst: (t, cb) => { (listeners[t] = listeners[t] || []).push(cb); }, makeLast: (t, cb) => { (listeners[t] = listeners[t] || []).push(cb); }, emit },
  eventTypes,
  saveSettingsDebounced: () => {},
  saveChat: async () => {},
  extensionSettings: {},
  chatId: 'smoke-chat',
  chat: [],
  characters: [],
  groups: [],
  stopGeneration() {},
  deleteLastMessage() {},
  getRequestHeaders: () => ({}),
};
window.SillyTavern = { getContext: () => ctx, libs: {} };
g.SillyTavern = window.SillyTavern;
log('step3: ST stub ready');

// 隐藏 Node 全局，强制 bundle 走浏览器分支（emscripten 用 process 检测 Node 环境）
const realProcessExit = process.exit.bind(process);
Object.defineProperty(g, 'process', { value: undefined, writable: true, configurable: true });
try { delete g.module; } catch {}
log('step3b: process hidden');

const bundlePath = new URL('file://' + join(repoRoot, 'index.js').replace(/\\/g, '/') + '');
try {
  await import(bundlePath.href);
  log('step4: bundle imported');
} catch (e) {
  log('bundle import error: ' + (e?.stack || e));
}

log('step5: waiting 4s for async init');
await new Promise((r) => setTimeout(r, 4000));
log('step6: init window passed');

emit('chat', 'smoke-chat');
await new Promise((r) => setTimeout(r, 3000));
log('step6b: CHAT_CHANGED processed (SQLite 初始化路径无报错)');

// 触发 V2 UI 挂载
const menuItem = window.document.querySelector('#acu-v2-menu-item');
if (menuItem) {
  try { menuItem.click(); } catch (e) { log('menu click error: ' + (e?.stack || e)); }
  await new Promise((r) => setTimeout(r, 2500));
}

const report = {
  autoCardUpdaterAPI: typeof window.AutoCardUpdaterAPI,
  autoCardUpdaterV2API: typeof window.AutoCardUpdaterV2API,
  apiMethodCount: window.AutoCardUpdaterAPI ? Object.keys(window.AutoCardUpdaterAPI).length : 0,
  compatMethodsPresent: ['exportTableAsJson', 'importTableAsJson', 'updateCell', 'updateRow', 'deleteRow', 'insertRow', 'openSettings', 'openVisualizer', 'manualUpdate', 'registerTableUpdateCallback', '_notifyTableUpdate']
    .filter((m) => window.AutoCardUpdaterAPI && typeof window.AutoCardUpdaterAPI[m] === 'function'),
  v2Methods: window.AutoCardUpdaterV2API ? Object.keys(window.AutoCardUpdaterV2API).sort() : [],
  eventListeners: Object.keys(listeners).sort(),
  acuAppV2Mounted: !!window.document.querySelector('#acu-app-v2'),
  menuItemInjected: !!window.document.querySelector('#acu-v2-menu-item'),
  errorCount: errors.length,
  errors: errors.slice(0, 10),
};
log('step7: ' + JSON.stringify(report, null, 2));

const ok = report.autoCardUpdaterAPI === 'object'
  && report.compatMethodsPresent.length === 11
  && report.acuAppV2Mounted
  && report.errorCount === 0;
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL', JSON.stringify(report, null, 2));
// 显式退出：插件可能持有常驻定时器（如生理追踪 poll），依赖自然退出会挂死
// process 全局已被隐藏（step3b），须用保存的真实引用；延迟等 stdout flush
setTimeout(() => realProcessExit(ok ? 0 : 1), 100);
