/**
 * R10B-11：输入对话框按回车提交时，中文输入法组字中的回车（上屏）不得提交。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import UbDialogHost from '../../src/presentation-v3/ui/UbDialogHost.vue';
import { useDialogStore } from '../../src/presentation-v2/stores/dialog-store';

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = '';
});

async function mountHost() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const portal = document.createElement('div');
  portal.id = 'ub-portal';
  document.body.appendChild(portal);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(UbDialogHost);
  app.use(pinia);
  app.mount(el);
  unmount = () => app.unmount();
  return useDialogStore(pinia);
}

function pressEnter(input: HTMLInputElement, init: KeyboardEventInit & { keyCode?: number } = {}) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init });
  if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode });
  input.dispatchEvent(event);
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
}

describe('UbDialogHost 输入框回车', () => {
  it('组字中的回车不提交，普通回车提交', async () => {
    const dialog = await mountHost();
    const pending = dialog.prompt({ title: '新增表格', label: '表名' });
    await nextTick();
    const input = document.querySelector<HTMLInputElement>('.ub-dialog__input')!;
    expect(input).not.toBeNull();

    dialog.inputValue = '人物';
    pressEnter(input, { isComposing: true });
    pressEnter(input, { keyCode: 229 });
    await nextTick();
    expect(dialog.active?.kind).toBe('prompt');

    pressEnter(input);
    await expect(pending).resolves.toBe('人物');
  });
});
