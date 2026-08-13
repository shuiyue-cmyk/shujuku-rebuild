/**
 * AcuFileButton — 文件选择按钮
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

async function mountFileButton(props: Record<string, any> = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const { default: AcuFileButton } = await import('../../../src/presentation-v2/components/_lib/AcuFileButton.vue');
  const onFile = vi.fn();
  const app = createApp({
    components: { AcuFileButton },
    setup() {
      return { props, onFile };
    },
    template: `
      <AcuFileButton v-bind="props" @file="onFile">
        <i class="fa-solid fa-download"></i>
        <span v-if="!props.iconOnly">导入 JSON</span>
      </AcuFileButton>
    `,
  });
  app.mount('#app');
  await Promise.resolve();
  return { app, onFile };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('AcuFileButton', () => {
  it('icon-only default 按钮使用透明图标按钮样式', async () => {
    const { app } = await mountFileButton({ iconOnly: true, title: '导入预设 JSON' });

    const button = document.querySelector('button') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.classList.contains('acu-btn--icon-only')).toBe(true);
    expect(button!.classList.contains('acu-file-button__button--icon-only-default')).toBe(true);

    app.unmount();
  });

  it('普通文件按钮保持默认 AcuButton 样式', async () => {
    const { app } = await mountFileButton({ size: 'sm' });

    const button = document.querySelector('button') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.classList.contains('acu-btn--default')).toBe(true);
    expect(button!.classList.contains('acu-file-button__button--icon-only-default')).toBe(false);

    app.unmount();
  });

  it('block 文件按钮让外层和内层按钮都占满容器', async () => {
    const { app } = await mountFileButton({ block: true });

    const root = document.querySelector('.acu-file-button') as HTMLElement | null;
    const button = document.querySelector('button') as HTMLButtonElement | null;
    expect(root).not.toBeNull();
    expect(button).not.toBeNull();
    expect(root!.classList.contains('acu-file-button--block')).toBe(true);
    expect(button!.classList.contains('acu-btn--block')).toBe(true);

    app.unmount();
  });

  it('选择文件后派发 file 事件并清空 input', async () => {
    const { app, onFile } = await mountFileButton({ accept: 'application/json,.json' });
    const input = document.querySelector('.acu-file-button__input') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    const file = new File(['{}'], 'preset.json', { type: 'application/json' });
    Object.defineProperty(input!, 'files', { value: [file], configurable: true });
    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(onFile).toHaveBeenCalledWith(file);
    expect(input!.value).toBe('');

    app.unmount();
  });
});
