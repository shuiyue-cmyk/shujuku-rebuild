/**
 * WorldbookSelector — 世界书下拉选项
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, defineComponent, h } from 'vue';
import WorldbookSelector from '../../../src/presentation-v2/components/WorldbookSelector.vue';

interface Mounted {
  app: App<Element>;
  el: HTMLElement;
}

const mounted: Mounted[] = [];

function mountSelector(props: Partial<InstanceType<typeof WorldbookSelector>['$props']> = {}) {
  const wrapper = defineComponent({
    setup() {
      return () => h(WorldbookSelector, {
        modelValue: 'character',
        names: ['world-A'],
        charPrimary: null,
        status: 'success',
        error: '',
        ...props,
      });
    },
  });

  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  mounted.push({ app, el });
  return el;
}

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
});

describe('WorldbookSelector', () => {
  it('调用方显式要求时，未解析出角色卡主世界书也显示 character 选项', async () => {
    const el = mountSelector({
      showCharacterOption: true,
      characterFallbackLabel: '当前角色卡所有世界书',
    });

    const trigger = el.querySelector<HTMLButtonElement>('.acu-select__trigger');
    expect(trigger).not.toBeNull();
    expect(trigger!.textContent).toContain('当前角色卡所有世界书');

    trigger!.click();
    await Promise.resolve();

    const labels = Array.from(el.querySelectorAll('.acu-select__item')).map(item => item.textContent?.trim());
    expect(labels).toContain('当前角色卡所有世界书');
    expect(labels).toContain('world-A');
  });
});
