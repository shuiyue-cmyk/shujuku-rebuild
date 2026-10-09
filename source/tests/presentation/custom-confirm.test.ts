// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const topLevelWindowMock_ACU = vi.hoisted(() => {
  return {
    document: null as unknown as Document,
    innerWidth: 1280,
  } as Window & typeof globalThis;
});

vi.mock('../../src/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/shared/constants')>()),
  SCRIPT_ID_PREFIX_ACU: 'acu-test',
}));

vi.mock('../../src/shared/env', () => ({
  topLevelWindow_ACU: topLevelWindowMock_ACU,
}));

import { showCustomConfirm_ACU } from '../../src/presentation/theme/custom-confirm';

describe('custom confirm', () => {
  beforeEach(() => {
    const doc = document.implementation.createHTMLDocument('acu-confirm-test');
    Object.defineProperty(doc, 'defaultView', { value: topLevelWindowMock_ACU, configurable: true });
    topLevelWindowMock_ACU.document = doc;
    topLevelWindowMock_ACU.document.body.innerHTML = '';
    topLevelWindowMock_ACU.innerWidth = 1280;
  });

  it('样式表注入到主窗口一次：遮罩铺满并有底色，窄屏按钮纵向铺满', () => {
    void showCustomConfirm_ACU('一', '甲');
    void showCustomConfirm_ACU('二', '乙');

    const styles = topLevelWindowMock_ACU.document.querySelectorAll('#acu-host-dialog-styles');
    expect(styles.length).toBe(1);
    const css = styles[0].textContent || '';
    expect(css).toMatch(/\.acu-hd-layer\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/);
    expect(css).toMatch(/\.acu-hd-layer\s*\{[^}]*background:\s*var\(--acu-hd-scrim/);
    expect(css).toContain('@media (max-width: 600px)');
    expect(css).toContain('flex-direction: column-reverse');
    expect(css).toContain('var(--acu-accent');
    expect(css).not.toContain('acuWindowSlideIn');
  });

  it('危险操作用危险色确认按钮与警示图标', () => {
    void showCustomConfirm_ACU('手动填表确认', '高风险', { tone: 'danger' });

    const doc = topLevelWindowMock_ACU.document;
    expect(doc.getElementById('acu-test-custom-confirm-ok')!.className).toContain('acu-hd-btn--danger');
    expect(doc.querySelector('.acu-hd-glyph')!.className).toContain('is-danger');
    expect(doc.querySelector('.acu-hd-glyph i')!.className).toContain('fa-triangle-exclamation');
  });

  it('点击遮罩空白处按取消结束，点击弹窗内部不关闭', async () => {
    const promise = showCustomConfirm_ACU('确认', '继续执行');
    const doc = topLevelWindowMock_ACU.document;

    (doc.getElementById('acu-test-custom-confirm') as HTMLElement).click();
    expect(doc.getElementById('acu-test-custom-confirm-overlay')).not.toBeNull();

    (doc.getElementById('acu-test-custom-confirm-overlay') as HTMLElement).click();
    await expect(promise).resolves.toBe(false);
    expect(doc.getElementById('acu-test-custom-confirm-overlay')).toBeNull();
  });

  it('标题与按钮文案转义', () => {
    void showCustomConfirm_ACU('<b>x</b>', 'm', { confirmLabel: '<i>ok</i>', cancelLabel: '<i>no</i>' });
    const doc = topLevelWindowMock_ACU.document;
    expect(doc.querySelector('.acu-hd-title b')).toBeNull();
    expect(doc.getElementById('acu-test-custom-confirm-ok')!.querySelector('i')).toBeNull();
    expect(doc.getElementById('acu-test-custom-confirm-ok')!.textContent).toBe('<i>ok</i>');
  });

  it('遮罩与弹窗按 TT Layout ABI 声明 surface 类型', () => {
    void showCustomConfirm_ACU('TT 打标', '校验 data-tt-mobile-surface');

    const overlay = topLevelWindowMock_ACU.document.getElementById('acu-test-custom-confirm-overlay') as HTMLElement;
    const dialog = topLevelWindowMock_ACU.document.getElementById('acu-test-custom-confirm') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(dialog).toBeTruthy();
    // full-bleed 遮罩 = backdrop；居中确认框 = free-window（宿主不钳制其 top/left）
    expect(overlay.getAttribute('data-tt-mobile-surface')).toBe('backdrop');
    expect(dialog.getAttribute('data-tt-mobile-surface')).toBe('free-window');
  });

  it('R9-13：新确认框顶掉旧确认框时，旧的 await 以「取消」结束而不是永久挂起', async () => {
    const first = showCustomConfirm_ACU('第一个', '甲');
    const second = showCustomConfirm_ACU('第二个', '乙');

    await expect(first).resolves.toBe(false);
    topLevelWindowMock_ACU.document.getElementById('acu-test-custom-confirm-ok')!.click();
    await expect(second).resolves.toBe(true);
  });
});

