/**
 * TT viewport 高度基线约定 —— 全屏壳/浮层的高必须首选宿主提供的无 IME 基准高度
 *
 * 为什么是源码文本断言而不是 getComputedStyle：与 tt-ime-safe-bottom-conventions.test.ts
 * 同理由（SFC scoped 样式在 vitest+jsdom 下不注入，jsdom 不解析 var()）。
 *
 * 宿主链路（TauriTavern v2.3.0 源码实证）：
 * 1. `--tt-base-viewport-height` 是宿主文档承诺长期稳定的硬 ABI（ExtensionDEV.md、docs/API/Layout.md：
 *    “Android 下无 IME 时的基准 viewport 高度”），由 WebViewInsetsStyleApplier.kt 仅在无 IME 时更新；
 * 2. Android IME 不再透传为 WebView viewport resize（docs/CurrentState/MobileStyleAdaptation.md），
 *    直接用 `100dvh` 会在键盘弹起/收起时抖动或双重扣减；宿主自己的消费范式一律带回退
 *    （mobile-geometry-firewall.js：`height: var(--tt-base-viewport-height, var(--doc-height, 100vh))`）；
 * 3. 桌面 TT / 原版 ST 下该变量不存在，回退到 `100vh/100dvh`，取值与原来逐字节一致。
 *
 * 结论：凡是表达“占满视口高度”的声明（含 `vh/dvh` 单位的 height/min-height/max-height），
 * 必须写成 `var(--tt-base-viewport-height, <原回退>)`。纯相对值（`100%`）不管——它们相对的是
 * 父层而非视口，换变量是错的；`width` 上的单位也不管（宽度不受 IME 高度契约影响）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 高度声明检查点：选择器可能在 @media 里出现多次（如对话框紧凑形态），必须每处都查。 */
const viewportHeightDeclarations = [
  { file: 'App.vue', selector: '.acu-v2-app__shell' },
  { file: 'App.vue', selector: '.acu-v2-app__mobile-nav-layer' },
  { file: 'components/_lib/AcuDrawer.vue', selector: '.acu-v2-drawer-layer' },
  { file: 'components/_lib/AcuDialogHost.vue', selector: '.acu-dialog-layer' },
  { file: 'components/_lib/AcuDialogHost.vue', selector: '.acu-dialog' },
  { file: 'surfaces/visualizer/VisualizerSurface.vue', selector: '.acu-visualizer-surface__mobile-nav-layer' },
];

function readComponent(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'src/presentation-v2', relativePath), 'utf8');
}

/** 取某个选择器的全部规则体（含 @media 嵌套内的），并剥掉 CSS 注释（防“删声明留注释”假绿）。 */
function ruleBodies(source: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const bodies: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    bodies.push(match[1].replace(/\/\*[\s\S]*?\*\//g, ''));
  }
  return bodies;
}

describe('TT viewport 高度基线：视口高度声明首选 --tt-base-viewport-height', () => {
  it.each(viewportHeightDeclarations)('$file 的 $selector 含 vh/dvh 的高度声明走宿主基线变量', ({ file, selector }) => {
    const bodies = ruleBodies(readComponent(file), selector);
    expect(bodies.length, `${selector} 规则必须存在（选择器改名会让本约定静默失效）`).toBeGreaterThan(0);

    // 只查含 vh/dvh 单位的 height/min-height/max-height：纯 100% 是相对父层的，不管。
    const viewportDecls = bodies.flatMap(body => body.match(/(?:min-|max-)?height\s*:[^;]+/g) ?? [])
      .filter(decl => /v[hw]/.test(decl));
    expect(viewportDecls.length, `${selector} 应有含视口单位的高度声明（否则本用例测不到东西）`).toBeGreaterThan(0);
    for (const decl of viewportDecls) {
      expect(decl, `${selector} 的“${decl.trim()}”必须首选 var(--tt-base-viewport-height, …)，否则 Android 键盘场景下高度抖动`)
        .toMatch(/var\(--tt-base-viewport-height,/);
    }
  });
});
