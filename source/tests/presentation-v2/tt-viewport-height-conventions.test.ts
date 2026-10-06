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
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI_ROOT = join(process.cwd(), 'src/presentation-v3');

/** 界面目录下全部 SFC：清单从目录派生，新增组件漏写基线变量会直接红灯。 */
function listVueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listVueFiles(full);
    return entry.name.endsWith('.vue') ? [full] : [];
  });
}

/** 取 <style> 内含视口单位的高度声明，剥掉 CSS 注释（防"删声明留注释"假绿）。 */
function viewportHeightDecls(source: string): string[] {
  const styles = Array.from(source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)).map(m => m[1].replace(/\/\*[\s\S]*?\*\//g, ''));
  return styles.flatMap(css => css.match(/(?:min-|max-)?height\s*:[^;]+/g) ?? [])
    .filter(decl => /\d(?:d|s|l)?vh(?![a-z])/.test(decl));
}

describe('TT viewport 高度基线：视口高度声明首选 --tt-base-viewport-height', () => {
  const files = listVueFiles(UI_ROOT);
  const withDecls = files
    .map(file => ({ file: relative(UI_ROOT, file), decls: viewportHeightDecls(readFileSync(file, 'utf8')) }))
    .filter(item => item.decls.length > 0);

  it('能扫到含视口单位的高度声明（外壳本身就有一处），否则本约定测不到东西', () => {
    expect(withDecls.map(item => item.file.replace(/\\/g, '/'))).toContain('App.vue');
  });

  it.each(withDecls)('$file 的视口高度声明都走宿主基线变量', ({ file, decls }) => {
    for (const decl of decls) {
      expect(decl, `${file} 的"${decl.trim()}"必须首选 var(--tt-base-viewport-height, …)，否则 Android 键盘场景下高度抖动`)
        .toMatch(/var\(--tt-base-viewport-height,/);
    }
  });
});
