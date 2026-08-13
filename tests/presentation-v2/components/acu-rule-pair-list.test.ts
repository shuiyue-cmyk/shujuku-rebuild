/**
 * AcuRulePairList — 规则对列表（折叠 / 展开）
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, defineComponent, h, ref } from 'vue';
import AcuRulePairList, {
  type RulePair,
} from '../../../src/presentation-v2/components/_lib/AcuRulePairList.vue';

interface Mounted {
  app: App<Element>;
  el: HTMLElement;
}

const mounted: Mounted[] = [];

function mountList(opts: {
  initial?: RulePair[];
  label?: string;
} = {}): Mounted {
  const initial = opts.initial ?? [];
  const label = opts.label ?? '提取规则';

  const wrapper = defineComponent({
    setup() {
      const rules = ref<RulePair[]>(initial);
      return () => h(AcuRulePairList, {
        modelValue: rules.value,
        label,
        addLabel: '添加规则',
        'onUpdate:modelValue': (next: RulePair[]) => {
          rules.value = next;
        },
      });
    },
  });

  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  const entry: Mounted = { app, el };
  mounted.push(entry);
  return entry;
}

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
});

function getHeader(el: HTMLElement): HTMLButtonElement | null {
  return el.querySelector<HTMLButtonElement>('.acu-rule-pair-list__header');
}

function getAddButton(el: HTMLElement): HTMLButtonElement | null {
  return Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
    .find(b => (b.textContent || '').includes('添加规则')) ?? null;
}

function getBody(el: HTMLElement): HTMLElement | null {
  return el.querySelector<HTMLElement>('.acu-rule-pair-list__body');
}

function isVisible(node: HTMLElement | null): boolean {
  if (!node) return false;
  return node.getAttribute('aria-hidden') !== 'true'
    && !node.classList.contains('acu-disclosure-group__body--collapsed');
}

describe('AcuRulePairList', () => {
  it('提供 label 时渲染可点击 header，显示当前规则条数', () => {
    const { el } = mountList({ initial: [
      { start: 'a', end: 'b' },
      { start: 'c', end: 'd' },
    ] });

    const header = getHeader(el);
    expect(header).not.toBeNull();
    expect(header!.getAttribute('aria-expanded')).toBe('false');
    expect(header!.textContent).toContain('提取规则');
    expect(header!.textContent).toContain('2 条');
  });

  it('非空规则列表默认折叠，body 不可见', () => {
    const { el } = mountList({ initial: [{ start: 'a', end: 'b' }] });

    const body = getBody(el);
    expect(isVisible(body)).toBe(false);
    // 折叠态下添加按钮也不应可见
    const addBtn = getAddButton(el);
    if (addBtn) {
      // 按钮存在于 DOM，但其祖先 body 处于可动画折叠态。
      const bodyAncestor = addBtn.closest('.acu-rule-pair-list__body') as HTMLElement | null;
      expect(isVisible(bodyAncestor)).toBe(false);
    }
  });

  it('点击 header 切换展开状态，chevron 旋转类同步', async () => {
    const { el } = mountList({ initial: [{ start: 'a', end: 'b' }] });

    const header = getHeader(el)!;
    const chevron = el.querySelector('.acu-rule-pair-list__chevron')!;

    expect(chevron.classList.contains('acu-rule-pair-list__chevron--open')).toBe(false);

    header.click();
    await Promise.resolve();
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(chevron.classList.contains('acu-rule-pair-list__chevron--open')).toBe(true);
    expect(isVisible(getBody(el))).toBe(true);

    header.click();
    await Promise.resolve();
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(chevron.classList.contains('acu-rule-pair-list__chevron--open')).toBe(false);
    expect(isVisible(getBody(el))).toBe(false);
  });

  it('空规则列表也默认折叠，header 显示“暂无”，需点击展开后才能添加', async () => {
    const { el } = mountList({ initial: [] });

    const header = getHeader(el)!;
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(header.textContent).toContain('暂无');
    expect(isVisible(getBody(el))).toBe(false);

    header.click();
    await Promise.resolve();
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(isVisible(getBody(el))).toBe(true);
    expect(getAddButton(el)).not.toBeNull();
  });

  it('未提供 label 时回退老接口：无 header，body 始终可见', () => {
    const wrapper = defineComponent({
      setup() {
        const rules = ref<RulePair[]>([{ start: 'a', end: 'b' }]);
        return () => h(AcuRulePairList, {
          modelValue: rules.value,
          'onUpdate:modelValue': (next: RulePair[]) => { rules.value = next; },
        });
      },
    });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = createApp(wrapper);
    app.mount(el);
    mounted.push({ app, el });

    expect(getHeader(el)).toBeNull();
    expect(isVisible(getBody(el))).toBe(true);
  });

  it('折叠态下点击 header 展开后可正常添加规则', async () => {
    const { el } = mountList({ initial: [{ start: 'a', end: 'b' }] });

    getHeader(el)!.click();
    await Promise.resolve();

    const addBtn = getAddButton(el)!;
    expect(addBtn).not.toBeNull();
    addBtn.click();
    await Promise.resolve();

    expect(getHeader(el)!.textContent).toContain('2 条');
  });
});
