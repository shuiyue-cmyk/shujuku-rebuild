/**
 * TT Android IME 键盘避让约定 —— 承载输入框的 backdrop 浮层必须就地重算底部安全区
 *
 * 为什么是源码文本断言而不是 getComputedStyle：SFC 的 `<style scoped>` 在 vitest+jsdom 下
 * 不会被注入，且 jsdom 不解析 var()/max()/env()，行为级断言无从谈起。本仓库同类约定测试
 * （panel-grid-conventions.test.ts）走的也是 readFileSync 路线。
 *
 * 宿主链路（TauriTavern v2.3.0 源码实证，克隆 HEAD=a1855be）：
 * 1. 焦点进入可编辑元素后，`resolveImeSurfaceRoot` 先取「最近的 `data-tt-mobile-surface` 祖先」，
 *    但**只有值 === 'fullscreen-window' 才在第一分支返回**；标 `backdrop` 的层会继续往下走，
 *    最终被兜底分支选中为 IME root
 *    （src/tauri/main/compat/mobile/mobile-ime-surface-controller.js:123-144）；
 * 2. 原生侧把 `--tt-ime-bottom` **inline 写到该 root**，切换目标时还会从旧 target
 *    `removeProperty`（WebViewInsetsStyleApplier.kt 的 applyImeBottom）⇒ 该变量是 surface-local；
 * 3. 我们的 `--acu-safe-bottom` 只声明在 `#acu-app-v2`（App.vue）。CSS 自定义属性在**声明处**
 *    完成替换、后代只继承算好的值 ⇒ 浮层继承到的 bottom 永远不含键盘高度；
 * 4. 宿主也救不了：`bottom` 钳制那条规则硬绑 `fullscreen-window`
 *    （mobile-geometry-firewall.js:390），通用规则只给 `scroll-padding-bottom`（:339-344），
 *    而这些浮层是 `overflow:hidden`、真正滚动的是内部子元素 ⇒ scroll-padding 落空。
 *
 * 结论：凡是「打标 backdrop 且承载输入框（含经 slot 传入的编辑器）」的浮层，必须在**自己身上**
 * 重算底部安全区。两个更省事的改法都已实证否掉，见下面第二条用例的说明。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 承载输入框的全屏浮层清单。**手工维护**：输入框多半经 slot 从别处传入
 * （AcuDrawer.vue 自身一个 textarea 都没有），静态扫描扫不出来。
 */
const inputBearingOverlays = [
  { file: 'components/_lib/AcuDrawer.vue', selector: '.acu-v2-drawer-layer' },
  { file: 'components/_lib/AcuDialogHost.vue', selector: '.acu-dialog-layer' },
];

function readComponent(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'src/presentation-v2', relativePath), 'utf8');
}

/** 取某个选择器的规则体（这两条规则都是平铺的，没有嵌套与 @media），并剥掉 CSS 注释。 */
function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  // 必须剥注释：规则体上方那段说明里就写着 `--tt-ime-bottom`，不剥的话「删掉真声明、只留注释」
  // 也能让断言通过——那就是因错误原因而绿。
  return match ? match[1].replace(/\/\*[\s\S]*?\*\//g, '') : '';
}

describe('TT IME 键盘避让：承载输入框的 backdrop 浮层就地重算底部安全区', () => {
  it.each(inputBearingOverlays)('$file 的 $selector 自己消费 --tt-ime-bottom', ({ file, selector }) => {
    const body = ruleBody(readComponent(file), selector);

    expect(body, `${selector} 规则必须存在（选择器改名会让本约定静默失效）`).not.toBe('');
    // 键盘高度是 surface-local 的：只有在本层声明，才能拿到宿主 inline 写在本元素上的那份值。
    // 断言收紧到「声明式本身消费了 --tt-ime-bottom」，不接受注释或其它声明里的同名文本。
    expect(body, `${selector} 必须就地用 --tt-ime-bottom 重算底部安全区，否则继承到的是不含键盘高度的旧值`)
      .toMatch(/--acu-native-safe-bottom:\s*max\([^;]*var\(--tt-ime-bottom/);
    expect(body).toMatch(/--acu-safe-bottom:\s*max\([^;]*var\(--acu-native-safe-bottom/);
  });

  /**
   * 锁住「为什么不换成别的打标值」这个决定，避免后人好心改坏：
   * - 改标 `fullscreen-window`：宿主 geometry firewall 会强制 `top/left/right/bottom = insets`、
   *   `width/height:auto`、`margin:0`（mobile-geometry-firewall.js:131-144），与我们自己的
   *   `padding: var(--acu-safe-*)` 叠成**双重 inset**；
   * - 干脆不打标：分类器会把近全屏的它判成 `fullscreen-window`
   *   （mobile-overlay-surface-admission.js:240-244，`/(overlay|backdrop|mask)/i` 不匹配 `*-layer`）
   *   ⇒ 同样被宿主接管几何；
   * - 标 `none` 也没用：IME 兜底分支只看属性**存在**，不看值。
   */
  it('两层保持 backdrop 打标（改标会被宿主接管几何，与自绘 padding 双重 inset）', () => {
    for (const { file } of inputBearingOverlays) {
      expect(readComponent(file), file).toContain('data-tt-mobile-surface="backdrop"');
    }
  });
});
