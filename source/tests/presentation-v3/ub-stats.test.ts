/**
 * @vitest-environment jsdom
 *
 * UbStats 数据卡片：
 * - 宽项（wide）在多列时占两格，用来让奇数项的网格整行排满（交火索引状态 11 项 = 10 + 1 宽 = 12 格，2/3/4 列都无空格）；
 *   单列时必须退回占一格，否则会凭空多出一条隐式列，后面的项被塞进去。
 * - 网格空位不再露出分隔线底色（旧实现靠 gap + 线色背景画分隔线，空位就成了一块灰）。
 *
 * jsdom 不做布局：列数由打桩的 getComputedStyle 提供，ResizeObserver 由测试手动触发。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import UbStats from '../../src/presentation-v3/ui/UbStats.vue';

let columns = '170px 170px';
let observerCallback: (() => void) | null = null;

class FakeResizeObserver {
  constructor(cb: () => void) { observerCallback = cb; }
  observe(): void {}
  disconnect(): void { observerCallback = null; }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  observerCallback = null;
});

function mountStats() {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    if (el instanceof HTMLElement && el.classList.contains('ub-stats')) {
      return { gridTemplateColumns: columns } as CSSStyleDeclaration;
    }
    return original(el, pseudo);
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp({
    render: () => h(UbStats, {
      items: [
        { label: '行 / 分片', value: '0 / 0' },
        { label: '身份健康', value: 'empty / 0 identity / 0 collision / 0 checksum', wide: true },
        { label: '更新时间', value: '—' },
      ],
    }),
  });
  app.mount(el);
  return { el, app };
}

function wideItem(el: HTMLElement): HTMLElement {
  return Array.from(el.querySelectorAll<HTMLElement>('.ub-stats__item'))
    .find(item => item.querySelector('dt')?.textContent === '身份健康')!;
}

describe('UbStats 宽项', () => {
  it('多列时宽项占两格，窄到单列时退回一格', async () => {
    columns = '170px 170px';
    const { el, app } = mountStats();
    await nextTick();
    expect(wideItem(el).classList.contains('ub-stats__item--wide')).toBe(true);

    columns = '343px';
    observerCallback?.();
    await nextTick();
    expect(wideItem(el).classList.contains('ub-stats__item--wide')).toBe(false);

    columns = '180px 180px 180px';
    observerCallback?.();
    await nextTick();
    expect(wideItem(el).classList.contains('ub-stats__item--wide')).toBe(true);
    app.unmount();
  });

  it('普通项永远不加宽', async () => {
    columns = '170px 170px';
    const { el, app } = mountStats();
    await nextTick();
    expect(el.querySelectorAll('.ub-stats__item--wide')).toHaveLength(1);
    app.unmount();
  });
});

function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1].replace(/\/\*[\s\S]*?\*\//g, '') : '';
}

describe('UbStats 样式约定', () => {
  const source = readFileSync(join(process.cwd(), 'src/presentation-v3/ui/UbStats.vue'), 'utf8');

  it('宽项占两格，并允许后面的项回填空位', () => {
    expect(ruleBody(source, '.ub-stats__item--wide')).toMatch(/grid-column:\s*span 2/);
    expect(ruleBody(source, '.ub-stats')).toMatch(/grid-auto-flow:\s*row dense/);
  });

  it('网格空位不露线色底：网格本身不铺分隔线颜色，分隔线由各格自己画并在外缘裁掉', () => {
    const grid = ruleBody(source, '.ub-stats');
    expect(grid).not.toMatch(/background:\s*var\(--ub-line/);
    expect(grid).toMatch(/overflow:\s*hidden/);
    expect(ruleBody(source, '.ub-stats__item')).toMatch(/box-shadow:[^;]*var\(--ub-line-soft\)/);
  });
});
