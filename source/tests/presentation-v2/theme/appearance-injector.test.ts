/**
 * appearance-injector — 外观任一字段变更都会触发 applyAppearance（含 Claude 风格侧栏收起 / 展开）。
 * 缩放没变时不能重写样式表或根节点：同一帧里整段重写样式会让 iPad（WebKit）吞掉侧栏的过渡动画。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ACU_UI_SCALE_OPTIONS } from '../../../src/presentation-v2/stores/appearance-store';
import { APPEARANCE_STYLE_NODE_ID, applyAppearance } from '../../../src/presentation-v2/theme/appearance-injector';
import { APP_ROOT_ID } from '../../../src/presentation-v2/theme/theme-injector';

const [scale100, scale110] = ACU_UI_SCALE_OPTIONS;

function observe(): () => MutationRecord[] {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver(list => records.push(...list));
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  observer.observe(document.getElementById(APP_ROOT_ID)!, { attributes: true });
  return () => {
    records.push(...observer.takeRecords());
    observer.disconnect();
    return records;
  };
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = `<div id="${APP_ROOT_ID}"></div>`;
});

describe('applyAppearance', () => {
  it('缩放没变：不重写样式表，也不碰根节点的缩放变量与标记', () => {
    applyAppearance(scale110);
    const stop = observe();
    applyAppearance(scale110);
    expect(stop()).toEqual([]);
  });

  it('缩放变了：照常更新样式表与根节点', () => {
    applyAppearance(scale100);
    const stop = observe();
    applyAppearance(scale110);
    expect(stop().length).toBeGreaterThan(0);
    const root = document.getElementById(APP_ROOT_ID)!;
    expect(root.style.getPropertyValue('--acu-ui-scale')).toBe('1.1');
    expect(root.getAttribute('data-acu-ui-scale')).toBe('110');
    expect(document.getElementById(APPEARANCE_STYLE_NODE_ID)!.textContent).toContain('--acu-ui-scale: 1.1');
  });
});
