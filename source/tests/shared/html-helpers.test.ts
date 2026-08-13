/**
 * tests/shared/html-helpers.test.ts
 * HTML 工具函数 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  escapeHtml_ACU,
  renderOption_ACU,
  renderStopButton_ACU,
  renderReoptButton_ACU,
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
  it('生成基本 option 标签', () => {
    const result = renderOption_ACU('val', 'text');
    expect(result).toBe('<option value="val">text</option>');
  });

  it('生成选中的 option 标签', () => {
    const result = renderOption_ACU('val', 'text', true);
    expect(result).toContain('selected');
  });

  it('未选中时不包含 selected', () => {
    const result = renderOption_ACU('val', 'text', false);
    expect(result).not.toContain('selected');
  });

  it('value 和 text 中的特殊字符被转义', () => {
    const result = renderOption_ACU('<script>', '"xss"');
    expect(result).toContain('&lt;script&gt;');
    expect(result).toContain('&quot;xss&quot;');
  });
});

describe('renderStopButton_ACU', () => {
  it('生成包含指定 id 的按钮', () => {
    const result = renderStopButton_ACU('btn-stop', '停止');
    expect(result).toContain('id="btn-stop"');
    expect(result).toContain('停止');
  });

  it('id 中的特殊字符被转义', () => {
    const result = renderStopButton_ACU('<bad>', 'label');
    expect(result).toContain('&lt;bad&gt;');
  });

  it('返回 button 标签', () => {
    const result = renderStopButton_ACU('id', 'label');
    expect(result).toMatch(/^<button/);
    expect(result).toMatch(/<\/button>$/);
  });
});

describe('renderReoptButton_ACU', () => {
  it('生成固定 id 的重新优化按钮', () => {
    const result = renderReoptButton_ACU();
    expect(result).toContain('acu-opt-toast-reoptimize');
    expect(result).toContain('重新优化');
  });

  it('返回 button 标签', () => {
    const result = renderReoptButton_ACU();
    expect(result).toMatch(/^<button/);
    expect(result).toMatch(/<\/button>$/);
  });
});
