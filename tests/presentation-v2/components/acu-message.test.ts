/**
 * AcuMessage — panel status/reminder line formatting.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { type App, createApp, defineComponent, h } from 'vue';
import AcuMessage from '../../../src/presentation-v2/components/_lib/AcuMessage.vue';

const apps: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountMessage(kind: 'info' | 'success' | 'warning' | 'error'): HTMLElement {
  const wrapper = defineComponent({
    setup() {
      return () => h(AcuMessage, { kind }, { default: () => '状态：尚未加载文件。' });
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  apps.push({ app, el });
  return el.querySelector('.acu-message') as HTMLElement;
}

afterEach(() => {
  while (apps.length > 0) {
    const entry = apps.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
});

describe('AcuMessage', () => {
  it('all kinds use one status-line component class', () => {
    for (const kind of ['info', 'success', 'warning', 'error'] as const) {
      const message = mountMessage(kind);
      expect(message).not.toBeNull();
      expect(message.classList.contains(`acu-message--${kind}`)).toBe(true);
      expect(message.getAttribute('role')).toBe('status');
    }
  });

  it('semantic kinds do not color full sentence text', () => {
    const source = readFileSync(
      'src/presentation-v2/components/_lib/AcuMessage.vue',
      'utf8',
    );

    const colorDeclarations = source
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.startsWith('color:'));

    expect(colorDeclarations).toContain('color: var(--acu-text-2);');
    expect(colorDeclarations).not.toContain('color: var(--acu-success);');
    expect(colorDeclarations).not.toContain('color: var(--acu-warning);');
    expect(colorDeclarations).not.toContain('color: var(--acu-danger);');
  });
});
