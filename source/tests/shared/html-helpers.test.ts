/**
 * tests/shared/html-helpers.test.ts
 * HTML 工具函数 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  escapeHtml_ACU,
  renderOption_ACU,
  renderStopButton_ACU,
} from '../../src/shared/html-helpers';

describe('escapeHtml_ACU', () => {
  it('转义 & 符号', () => {
    expect(escapeHtml_ACU('a&b')).toBe('a&amp;b');
  });

  it('转义 < 符号', () => {
    expect(escapeHtml_ACU('a<b')).toBe('a&lt;b');
  });

  it('转义 > 符号', () => {
    expect(escapeHtml_ACU('a>b')).toBe('a&gt;b');
  });

  it('转义双引号', () => {
    expect(escapeHtml_ACU('a"b')).toBe('a&quot;b');
  });

  it('转义单引号', () => {
    expect(escapeHtml_ACU("a'b")).toBe('a&#039;b');
  });

  it('同时转义多种特殊字符', () => {
    expect(escapeHtml_ACU('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('空字符串返回空字符串', () => {
    expect(escapeHtml_ACU('')).toBe('');
  });

  it('非字符串输入返回空字符串', () => {
    expect(escapeHtml_ACU(null as any)).toBe('');
    expect(escapeHtml_ACU(undefined as any)).toBe('');
    expect(escapeHtml_ACU(123 as any)).toBe('');
  });

  it('纯文本不变', () => {
    expect(escapeHtml_ACU('hello world 你好')).toBe('hello world 你好');
  });
});

describe('renderOption_ACU', () => {

  it('value 和 text 中的特殊字符被转义', () => {
    const result = renderOption_ACU('<script>', '"xss"');
    expect(result).toContain('&lt;script&gt;');
    expect(result).toContain('&quot;xss&quot;');
  });
});

describe('renderStopButton_ACU', () => {

  it('id 中的特殊字符被转义', () => {
    const result = renderStopButton_ACU('<bad>', 'label');
    expect(result).toContain('&lt;bad&gt;');
  });
});

describe('renderToastActionButton_ACU（新界面样式）', () => {
  it('按钮靠样式类上色，不再内联写死颜色与鼠标事件', () => {
    const html = renderStopButton_ACU('stop-1', '终止');
    expect(html).toContain('class="acu-toast-action"');
    expect(html).not.toMatch(/style=|onmouse/);
  });
});
