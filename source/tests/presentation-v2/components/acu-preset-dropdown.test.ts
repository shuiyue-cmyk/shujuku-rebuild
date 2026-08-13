/**
 * AcuPresetDropdown — 通用预设下拉
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { createApp, ref } from 'vue';

async function mountDropdown(props: Record<string, any>) {
  document.body.innerHTML = '<div id="app"></div>';
  const { default: AcuPresetDropdown } = await import('../../../src/presentation-v2/components/_lib/AcuPresetDropdown.vue');
  const selected = ref(props.modelValue ?? '');
  const setDefault = vi.fn();
  const app = createApp({
    components: { AcuPresetDropdown },
    setup() {
      return { props, selected, setDefault };
    },
    template: `
      <AcuPresetDropdown
        :items="props.items"
        :model-value="selected"
        :default-name="props.defaultName"
        :placeholder="props.placeholder"
        :disabled="props.disabled"
        @update:model-value="selected = $event"
        @set-default="setDefault"
      />
    `,
  });
  app.mount('#app');
  await Promise.resolve();
  return { app, selected, setDefault };
}

describe('AcuPresetDropdown', () => {
  it('兼容旧 name/meta 形态，支持选择与星标默认', async () => {
    const { app, selected, setDefault } = await mountDropdown({
      items: [
        { name: 'alpha', meta: '酒馆主 API' },
        { name: 'beta', meta: '自定义' },
      ],
      modelValue: 'alpha',
      defaultName: 'alpha',
    });

    expect(document.querySelector('.acu-preset-dd__trigger')!.textContent).toContain('alpha');
    (document.querySelector('.acu-preset-dd__trigger') as HTMLButtonElement).click();
    await Promise.resolve();
    const items = Array.from(document.querySelectorAll('.acu-preset-dd__item')) as HTMLElement[];
    expect(items.map(item => item.textContent || '')[1]).toContain('beta');
    items[1].click();
    await Promise.resolve();
    expect(selected.value).toBe('beta');

    (document.querySelector('.acu-preset-dd__trigger') as HTMLButtonElement).click();
    await Promise.resolve();
    const stars = Array.from(document.querySelectorAll('.acu-preset-dd__star')) as HTMLButtonElement[];
    stars[1].click();
    expect(setDefault).toHaveBeenCalledWith('beta');

    app.unmount();
  });

  it('支持 value/label 形态和空值默认项', async () => {
    const { app, selected, setDefault } = await mountDropdown({
      items: [
        { value: '', label: '跟随全局模板', meta: '继承全局' },
        { value: 'chat-A', label: 'chat-A', meta: '当前聊天' },
      ],
      modelValue: 'chat-A',
      defaultName: '',
      placeholder: '跟随全局模板',
    });

    expect(document.querySelector('.acu-preset-dd__trigger')!.textContent).toContain('chat-A');
    (document.querySelector('.acu-preset-dd__trigger') as HTMLButtonElement).click();
    await Promise.resolve();
    const items = Array.from(document.querySelectorAll('.acu-preset-dd__item')) as HTMLElement[];
    expect(items[0].textContent).toContain('跟随全局模板');
    items[0].click();
    await Promise.resolve();
    expect(selected.value).toBe('');

    (document.querySelector('.acu-preset-dd__trigger') as HTMLButtonElement).click();
    await Promise.resolve();
    const stars = Array.from(document.querySelectorAll('.acu-preset-dd__star')) as HTMLButtonElement[];
    stars[0].click();
    expect(setDefault).toHaveBeenCalledWith('');

    app.unmount();
  });

  it('meta 为空时不渲染辅助文字', async () => {
    const { app } = await mountDropdown({
      items: [
        { value: '', label: '跟随全局模板' },
        { value: 'chat-A', label: 'chat-A', meta: '' },
      ],
      modelValue: '',
      defaultName: '',
      placeholder: '跟随全局模板',
    });

    (document.querySelector('.acu-preset-dd__trigger') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(document.querySelector('.acu-preset-dd__item-meta')).toBeNull();

    app.unmount();
  });

  it('disabled 时不能展开或选择', async () => {
    const { app, selected } = await mountDropdown({
      items: [
        { name: 'alpha', meta: '酒馆主 API' },
        { name: 'beta', meta: '自定义' },
      ],
      modelValue: 'alpha',
      defaultName: 'alpha',
      disabled: true,
    });

    (document.querySelector('.acu-preset-dd__trigger') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(document.querySelector('.acu-preset-dd__menu')).toBeNull();
    expect(selected.value).toBe('alpha');

    app.unmount();
  });
});
