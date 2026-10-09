/**
 * mount.test — D15.1 自动验证：两种 jsdom 场景下挂载点和样式注入位置正确
 *
 * 场景 1（当前文档）：window.parent === window，根节点与样式在当前 document
 * 场景 2（父文档）：mock window.parent 指向另一个 JSDOM，根节点与样式必须
 *                  出现在父 document，且子 document 不残留可见根节点
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { nextTick } from 'vue';

const ROOT_ID = 'acu-app-v2';
const STYLE_DATA_ATTR = 'data-acu-v2-sfc';
const STORAGE_KEY = 'acu_v2_ui_state';
const APPEARANCE_STYLE_NODE_ID = 'acu-v2-appearance';

type MountModule = typeof import('../../../src/presentation-v2/bootstrap/mount');
type HostModule = typeof import('../../../src/presentation-v2/bootstrap/host-document');
type StyleRuntimeModule = typeof import('../../../src/presentation-v2/build/sfc-style-runtime');

async function freshImport(): Promise<{
  mount: MountModule;
  host: HostModule;
  styleRuntime: StyleRuntimeModule;
}> {
  vi.resetModules();
  const [mount, host, styleRuntime] = await Promise.all([
    import('../../../src/presentation-v2/bootstrap/mount'),
    import('../../../src/presentation-v2/bootstrap/host-document'),
    import('../../../src/presentation-v2/build/sfc-style-runtime'),
  ]);
  return { mount, host, styleRuntime };
}

function setParent(parent: any) {
  Object.defineProperty(window, 'parent', {
    value: parent,
    writable: true,
    configurable: true,
  });
}

function persistAdvancedMode(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiMode: { mode: 'advanced' } }));
}

afterEach(() => {
  // jsdom 默认 window.parent === window；测试结束恢复
  setParent(window);
});

describe('mount — 当前文档场景', () => {
  beforeEach(() => {
    setParent(window);
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('window.parent === window 时，根节点和 SFC 样式都注入当前 document', async () => {
    persistAdvancedMode();
    const { mount, host, styleRuntime } = await freshImport();
    expect(host.getAcuHostSource()).toBe('current-document');

    await mount.openAcuV2App();

    const root = document.getElementById(ROOT_ID);
    expect(root).not.toBeNull();
    expect(root!.parentElement).toBe(document.body);
    // TT Layout ABI：主挂载 root 声明为 fullscreen-window（宿主仅移动端 TT 消费，桌面惰性）
    expect(root!.getAttribute('data-tt-mobile-surface')).toBe('fullscreen-window');

    // 直接驱动样式运行时，验证 host document 路由（vitest 的 vite 接入会把
    // SFC 真实 <style> 块走 vite 自己的 CSS 管线，绕过 sfc-style-injector，
    // 所以测试在生产路径之外手动触发一次 injectSfcStyle）
    styleRuntime.injectSfcStyle('.acu-v2-test{color:red}', 'mount-test#current');
    const styles = document.head.querySelectorAll(`style[${STYLE_DATA_ATTR}]`);
    expect(styles.length).toBeGreaterThan(0);

    const text = root!.textContent || '';
    expect(text).toContain('UnbirthDB');
    // 高手模式默认页是 dashboard，sidebar 有"概览/配置/功能/工具"四组标题
    expect(text).toContain('仪表盘');
    expect(text).toContain('概览');
    expect(text).toContain('配置');
    expect(text).toContain('功能');
    expect(text).toContain('工具');

    mount.__resetAcuV2MountForTests();
  });

  it('渲染异常被 errorHandler 收进运行日志', async () => {
    const { mount } = await freshImport();
    await mount.openAcuV2App();

    const app = mount.__getAcuV2AppForTests();
    expect(app).not.toBeNull();
    expect(typeof app!.config.errorHandler).toBe('function');

    const { getAllLogs } = await import('../../../src/shared/log-buffer');
    const before = getAllLogs().length;
    app!.config.errorHandler!(new Error('boom-render'), {}, 'render');
    const after = getAllLogs();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].level).toBe('error');
    expect(after[after.length - 1].message).toContain('render error');

    mount.__resetAcuV2MountForTests();
  });

  it('打开后再关闭，根节点保留但 display 变 none', async () => {
    const { mount } = await freshImport();
    await mount.openAcuV2App();
    mount.closeAcuV2App();

    const root = document.getElementById(ROOT_ID);
    expect(root).not.toBeNull();
    expect(root!.style.display).toBe('none');

    mount.__resetAcuV2MountForTests();
  });

  function findButton(doc: Document, title: string): HTMLButtonElement | null {
    return doc.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
      ?? Array.from(doc.querySelectorAll<HTMLButtonElement>('.ub-rail button')).find(button => button.textContent?.includes(title))
      ?? null;
  }

  it('外观面板可以切换界面缩放，并持久化到 appearance section', async () => {
    const { mount } = await freshImport();
    await mount.openAcuV2App();

    const root = document.getElementById(ROOT_ID);
    const style = document.getElementById(APPEARANCE_STYLE_NODE_ID) as HTMLStyleElement | null;
    expect(root).not.toBeNull();
    expect(style).not.toBeNull();
    expect(root!.getAttribute('data-acu-ui-scale')).toBe('100');
    expect(style!.textContent).toContain('--acu-ui-scale: 1;');

    findButton(document, '外观与界面')!.click();
    await nextTick();

    const scale = document.querySelector<HTMLElement>('#ub-portal [aria-label="界面缩放"]');
    expect(scale).not.toBeNull();
    const option125 = Array.from(scale!.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '125%');
    expect(option125).toBeDefined();

    option125!.click();
    await nextTick();

    expect(root!.getAttribute('data-acu-ui-scale')).toBe('125');
    expect(style!.textContent).toContain('--acu-ui-scale: 1.25;');
    expect(style!.textContent).toContain('--acu-font-size-body: 15px;');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      appearance: { uiScale: '125' },
    });

    mount.__resetAcuV2MountForTests();
  });

  it('通知层传送到浮层容器，不留在外壳内', async () => {
    const { mount } = await freshImport();
    await mount.openAcuV2App();

    const pinia = mount.getAcuV2PiniaForBridge();
    expect(pinia).not.toBeNull();
    const { useToastStore } = await import('../../../src/presentation-v2/stores/toast-store');
    useToastStore(pinia!).info('手动填表开始。', { durationMs: 0, muteable: false });
    await nextTick();

    const portal = document.getElementById('ub-portal');
    const shell = document.querySelector<HTMLElement>('.ub-shell');
    const toasts = document.querySelector<HTMLElement>('.ub-toasts');

    expect(portal).not.toBeNull();
    expect(shell).not.toBeNull();
    expect(toasts).not.toBeNull();
    expect(toasts!.parentElement).toBe(portal);
    expect(shell!.contains(toasts!)).toBe(false);
    expect(toasts!.textContent).toContain('手动填表开始。');

    mount.__resetAcuV2MountForTests();
  });

  it('页面面板点遮罩关闭，遮罩声明为 backdrop', async () => {
    const { mount } = await freshImport();
    await mount.openAcuV2App();

    const menuButton = findButton(document, '全部页面')!;
    menuButton.click();
    await nextTick();

    const launcher = document.querySelector<HTMLElement>('.ub-launcher');
    expect(launcher).not.toBeNull();
    expect(launcher!.getAttribute('data-tt-mobile-surface')).toBe('backdrop');

    launcher!.querySelector<HTMLElement>('.ub-launcher__panel')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(document.querySelector('.ub-launcher')).not.toBeNull();

    launcher!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(document.querySelector('.ub-launcher')).toBeNull();
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');

    mount.__resetAcuV2MountForTests();
  });
});

describe('mount — 父文档场景（iframe 模拟）', () => {
  let parentDom: JSDOM;

  beforeEach(() => {
    parentDom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    setParent(parentDom.window);
    document.body.innerHTML = '';
    localStorage.clear();
  });

  afterEach(() => {
    parentDom.window.close();
  });

  it('window.parent !== window 且可访问 parent.document 时，根节点出现在父文档', async () => {
    const { mount, host, styleRuntime } = await freshImport();
    expect(host.getAcuHostSource()).toBe('parent-document');
    expect(host.getAcuHostDocument()).toBe(parentDom.window.document);

    await mount.openAcuV2App();

    const parentRoot = parentDom.window.document.getElementById(ROOT_ID);
    expect(parentRoot).not.toBeNull();
    expect(parentRoot!.parentElement).toBe(parentDom.window.document.body);
    expect(parentRoot!.getAttribute('data-acu-host-source')).toBe('parent-document');
    // 父文档挂载场景同样要打 TT surface 标（宿主 classifier 只看最外层 document）
    expect(parentRoot!.getAttribute('data-tt-mobile-surface')).toBe('fullscreen-window');

    const childRoot = document.getElementById(ROOT_ID);
    expect(childRoot).toBeNull();

    // 模拟 SFC <style> 通过运行时注入，验证落点是父文档而不是子文档
    styleRuntime.injectSfcStyle('.acu-v2-test{color:blue}', 'mount-test#parent');
    const parentStyles = parentDom.window.document.head.querySelectorAll(
      `style[${STYLE_DATA_ATTR}]`,
    );
    expect(parentStyles.length).toBeGreaterThan(0);
    const childStyles = document.head.querySelectorAll(
      `style[${STYLE_DATA_ATTR}]`,
    );
    expect(childStyles.length).toBe(0);

    mount.__resetAcuV2MountForTests();
  });

  it('嵌套 iframe 时选择可访问链路中最外层宿主文档', async () => {
    const narrowParent = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    const wideTop = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    Object.defineProperty(narrowParent.window, 'innerWidth', { value: 184, configurable: true });
    Object.defineProperty(narrowParent.window, 'innerHeight', { value: 720, configurable: true });
    Object.defineProperty(wideTop.window, 'innerWidth', { value: 1024, configurable: true });
    Object.defineProperty(wideTop.window, 'innerHeight', { value: 768, configurable: true });
    Object.defineProperty(narrowParent.window, 'parent', {
      value: wideTop.window,
      configurable: true,
    });
    setParent(narrowParent.window);

    const { mount, host } = await freshImport();
    expect(host.getAcuHostSource()).toBe('parent-document');
    expect(host.getAcuHostDocument()).toBe(wideTop.window.document);

    await mount.openAcuV2App();

    expect(wideTop.window.document.getElementById(ROOT_ID)).not.toBeNull();
    expect(narrowParent.window.document.getElementById(ROOT_ID)).toBeNull();
    expect(document.getElementById(ROOT_ID)).toBeNull();

    mount.__resetAcuV2MountForTests();
    narrowParent.window.close();
    wideTop.window.close();
  });

  it('嵌套 iframe 时即使最外层视口指标为 0，也选择最外层可访问文档', async () => {
    const narrowParent = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    const outerTop = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    Object.defineProperty(narrowParent.window, 'innerWidth', { value: 184, configurable: true });
    Object.defineProperty(narrowParent.window, 'innerHeight', { value: 720, configurable: true });
    Object.defineProperty(outerTop.window, 'innerWidth', { value: 0, configurable: true });
    Object.defineProperty(outerTop.window, 'innerHeight', { value: 0, configurable: true });
    Object.defineProperty(narrowParent.window, 'parent', {
      value: outerTop.window,
      configurable: true,
    });
    setParent(narrowParent.window);

    const { mount, host } = await freshImport();
    expect(host.getAcuHostDocument()).toBe(outerTop.window.document);

    await mount.openAcuV2App();

    expect(outerTop.window.document.getElementById(ROOT_ID)).not.toBeNull();
    expect(narrowParent.window.document.getElementById(ROOT_ID)).toBeNull();

    mount.__resetAcuV2MountForTests();
    narrowParent.window.close();
    outerTop.window.close();
  });

  it('父文档挂载时，Vue 创建的表单控件属于父文档 realm', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      uiMode: { mode: 'advanced' },
      router: { activePageId: 'api' },
    }));

    const { mount } = await freshImport();
    await mount.openAcuV2App();

    const pinia = mount.getAcuV2PiniaForBridge();
    expect(pinia).not.toBeNull();
    const { useDialogStore } = await import('../../../src/presentation-v2/stores/dialog-store');
    void useDialogStore(pinia!).prompt({
      title: '测试输入框',
      message: '用于确认父文档挂载节点的 realm。',
      label: '名称',
      requireNonEmpty: false,
    });
    await nextTick();

    const parentDoc = parentDom.window.document;
    const dialogLayer = parentDoc.querySelector('.ub-dialog-layer') as HTMLElement | null;
    expect(dialogLayer).not.toBeNull();
    // 弹窗遮罩层声明为 backdrop
    expect(dialogLayer!.getAttribute('data-tt-mobile-surface')).toBe('backdrop');

    const input = dialogLayer!.querySelector('input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.ownerDocument).toBe(parentDoc);
    expect(input!).toBeInstanceOf(parentDom.window.HTMLInputElement);
    expect(input!).not.toBeInstanceOf(window.HTMLInputElement);

    mount.__resetAcuV2MountForTests();
  });

  it('父文档挂载时，外观面板渲染在父文档并可点遮罩关闭', async () => {
    const { mount } = await freshImport();

    await mount.openAcuV2App();

    const parentDoc = parentDom.window.document;
    const appearanceButton = Array.from(parentDoc.querySelectorAll<HTMLButtonElement>('.ub-rail button')).find(button => button.textContent?.includes('外观与界面')) ?? null;
    expect(appearanceButton).not.toBeNull();

    appearanceButton!.click();
    await nextTick();

    const layer = parentDoc.querySelector('#ub-portal .ub-sheet-layer') as HTMLElement | null;
    expect(layer).not.toBeNull();
    expect(document.querySelector('.ub-sheet-layer')).toBeNull();

    layer!.dispatchEvent(new parentDom.window.MouseEvent('click', { bubbles: true }));
    await nextTick();
    await nextTick();

    expect(layer!.classList.contains('is-closing')).toBe(true);

    mount.__resetAcuV2MountForTests();
  });

  it('父文档不可访问时降级到当前文档（getter 抛错）', async () => {
    setParent({
      get document() {
        throw new Error('SecurityError: cross-origin');
      },
    });

    const { mount, host } = await freshImport();
    expect(host.getAcuHostSource()).toBe('current-document');

    await mount.openAcuV2App();

    expect(document.getElementById(ROOT_ID)).not.toBeNull();

    mount.__resetAcuV2MountForTests();
  });
});

