/**
 * host-claude-skin — Claude 风格下面板外插件弹窗（提示条、确认框、正文替换对话框）的外观开关。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { applyHostClaudeSkin, HOST_CLAUDE_SKIN_STYLE_ID } from '../../../src/presentation-v2/theme/host-claude-skin';

const node = () => document.getElementById(HOST_CLAUDE_SKIN_STYLE_ID) as HTMLStyleElement | null;

beforeEach(() => {
  document.head.innerHTML = '';
});

describe('applyHostClaudeSkin', () => {
  it('Claude 风格：注入覆盖确认框、正文替换对话框、进行中遮罩与提示条的样式，只作用于插件弹窗', () => {
    applyHostClaudeSkin('light');
    const css = node()!.textContent!;
    for (const selector of ['.acu-hd-dialog', '.acu-hd-busy', '.acu-hd-btn--primary', '#toast-container > .acu-toast.toast.acu-host-surface']) {
      expect(css).toContain(selector);
    }
    expect(css).toContain('border-radius: 16px');
    expect(css).toContain('rgba(0, 0, 0, 0.30)');
  });

  it('深色：遮罩与软底色按深色取值', () => {
    applyHostClaudeSkin('dark');
    expect(node()!.textContent).toContain('rgba(0, 0, 0, 0.55)');
  });

  it('切回默认风格：清空样式，不残留覆盖；从未开启过时不建节点', () => {
    applyHostClaudeSkin(null);
    expect(node()).toBeNull();
    applyHostClaudeSkin('light');
    applyHostClaudeSkin(null);
    expect(node()!.textContent).toBe('');
  });
});
