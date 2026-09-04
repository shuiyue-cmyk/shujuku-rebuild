/**
 * tests/presentation/theme/toast.test.ts
 * 富文本 toast 净化器（sanitizeToastHtml_ACU）+ repair 路径集成测试
 *
 * 契约（0214ca7 富文本 + v9.1.8 XSS 净化）：
 * - 骰子/美化形状 div/span/table + style/class 必须原样通过，输出不变
 * - script/style/iframe/object/embed/link/meta 连内容移除；未知标签解包保留文本
 * - on* 事件属性一律剥除（含既有 renderToastActionButton 的 onmouseover/onmouseout）
 * - javascript: / data:(非图片) URL 的 href/src 剥除；img 允许非 SVG 位图 data:image/*
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockLogDebug } = vi.hoisted(() => ({
  mockLogDebug: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
}));

vi.mock('../../../src/shared/env', () => ({
  topLevelWindow_ACU: undefined,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: {} as any,
}));

import { showToastr_ACU, sanitizeToastHtml_ACU } from '../../../src/presentation/theme/toast';
import { _set_toastr_API_ACU } from '../../../src/shared/host-api';

afterEach(() => {
  _set_toastr_API_ACU(undefined);
  document.body.innerHTML = '';
});

// ═══════════════════════════════════════════════════════════════
// sanitizeToastHtml_ACU — 纯函数
// ═══════════════════════════════════════════════════════════════
describe('sanitizeToastHtml_ACU', () => {
  it('骰子形状 div/span/table+style+class 原样通过，输出不变（0214ca7 契约）', () => {
    // tbody 显式写出：HTML 解析器会为 <table><tr> 自动补 <tbody>（修复前 innerHTML=raw
    // 在真实 DOM 里同样被补 tbody，最终渲染一致；显式化使序列化输出可逐字节断言）。
    const dice = '<div style="display:flex; gap:6px"><span style="font-weight:600">掷骰结果</span>'
      + '<table style="border-collapse:collapse"><tbody><tr><td style="padding:2px 8px; border:1px solid #999" colspan="2">6</td></tr></tbody></table></div>';
    expect(sanitizeToastHtml_ACU(dice)).toBe(dice);
  });

  it('裸 <tr>（无 tbody）解析层自动补 tbody：与直写 innerHTML 的最终 DOM 一致', () => {
    const out = sanitizeToastHtml_ACU('<table style="x"><tr><td style="y">6</td></tr></table>');
    // 渲染语义不变：tr 必在 tbody 内（HTML 解析器行为，直写 innerHTML 同样如此）
    expect(out).toBe('<table style="x"><tbody><tr><td style="y">6</td></tr></tbody></table>');
  });

  it('既有富文本用例（div/br/small/button + style/id）原样通过', () => {
    const shape = '<div>正文替换完成<button id="acu-opt-stop-btn" style="border: 1px solid #7d4940; cursor: pointer;">取消优化</button><br><small style="opacity:0.7">摘要文本</small></div>';
    expect(sanitizeToastHtml_ACU(shape)).toBe(shape);
  });

  it('script 连内容整个移除', () => {
    expect(sanitizeToastHtml_ACU('<div>a<script>alert(1)</script>b</div>')).toBe('<div>ab</div>');
  });

  it('style/iframe/object/embed/link/meta 危险标签连内容移除', () => {
    const dirty = '<div>x<style>.p{color:red}</style><iframe src="https://evil.test"></iframe>'
      + '<object data="x"></object><embed src="y"><link rel="stylesheet" href="z"><meta http-equiv="refresh" content="0"></div>';
    const out = sanitizeToastHtml_ACU(dirty);
    expect(out).toBe('<div>x</div>');
  });

  it('on* 事件属性一律剥除，style/class 保留', () => {
    const out = sanitizeToastHtml_ACU('<div onclick="alert(1)" onmouseover="x()" style="color:red" class="t">文本</div>');
    expect(out).toBe('<div style="color:red" class="t">文本</div>');
  });

  it('a href：javascript: 与 data: 剥除，https 保留，实体混淆（java\\tscript:）剥除', () => {
    expect(sanitizeToastHtml_ACU('<a href="javascript:alert(1)">点我</a>')).toBe('<a>点我</a>');
    expect(sanitizeToastHtml_ACU('<a href="data:text/html;base64,PHNjcmlwdD4=">点我</a>')).toBe('<a>点我</a>');
    expect(sanitizeToastHtml_ACU('<a href="java&#9;script:alert(1)">点我</a>')).toBe('<a>点我</a>');
    expect(sanitizeToastHtml_ACU('<a href="https://example.com/doc">文档</a>')).toBe('<a href="https://example.com/doc">文档</a>');
  });

  it('img src：http(s) 与位图 data:image/* 保留，svg/非图片 data: 剥除', () => {
    expect(sanitizeToastHtml_ACU('<img src="https://example.com/a.png">')).toBe('<img src="https://example.com/a.png">');
    expect(sanitizeToastHtml_ACU('<img src="data:image/png;base64,iVBOR">')).toBe('<img src="data:image/png;base64,iVBOR">');
    expect(sanitizeToastHtml_ACU('<img src="data:image/svg+xml;base64,PHN2Zz4=">')).toBe('<img>');
    expect(sanitizeToastHtml_ACU('<img src="data:text/html,<script>alert(1)</script>">')).toBe('<img>');
    expect(sanitizeToastHtml_ACU('<img src="javascript:alert(1)">')).toBe('<img>');
  });

  it('未知标签解包保留内部合法内容', () => {
    expect(sanitizeToastHtml_ACU('<custom-el>前<b>中</b>后</custom-el>')).toBe('前<b>中</b>后');
  });

  it('未知属性剥除（仅 style/class/id/表格几何属性白名单）', () => {
    // td 必须置于 table 上下文：裸 <td> 会被 HTML 解析器连同属性一起丢弃
    const out = sanitizeToastHtml_ACU('<table><tbody><tr><td colspan="2" rowspan="1" width="10" formaction="x" srcdoc="y">v</td></tr></tbody></table>');
    expect(out).toBe('<table><tbody><tr><td colspan="2" rowspan="1" width="10">v</td></tr></tbody></table>');
  });

  it('纯文本原样返回；文本中的孤立 < 序列化为 &lt;（语义不变）', () => {
    expect(sanitizeToastHtml_ACU('没有标记的普通消息')).toBe('没有标记的普通消息');
    // '<' 后跟空格被 HTML 解析器视为文本，序列化时转义为 &lt;（与直写 innerHTML 的最终 DOM 一致）
    expect(sanitizeToastHtml_ACU('普通消息 < 提示')).toBe('普通消息 &lt; 提示');
  });
});

// ═══════════════════════════════════════════════════════════════
// showToastr_ACU repair 路径 — 被替换的 toastr 转义后经净化重写
// ═══════════════════════════════════════════════════════════════
describe('showToastr_ACU — repair 路径净化', () => {
  let host: HTMLElement;
  let messageEl: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    host.className = 'acu-toast';
    messageEl = document.createElement('div');
    messageEl.className = 'toast-message';
    host.appendChild(messageEl);
    document.body.appendChild(host);
  });

  it('被转义的富文本消息经 onShown 修复：净化后重写（script 剥除、button 保留）', () => {
    const message = '<div>正在规划<button class="qrf-abort-btn">终止</button><script>alert(1)</script></div>';
    // 模拟被替换的 toastr 实现：把 message 按纯文本转义（无子元素），再回调 onShown
    messageEl.textContent = message;
    let capturedOptions: any = null;
    _set_toastr_API_ACU({
      success: (_m: string, _t: string, o: any) => { capturedOptions = o; return {} as any; },
    } as any);

    showToastr_ACU('success', message, { escapeHtml: false });
    expect(capturedOptions).not.toBeNull();
    capturedOptions.onShown();

    // 净化生效：script 连内容消失，button/class 保留，文本保留
    expect(messageEl.querySelector('script')).toBeNull();
    expect(messageEl.textContent).not.toContain('alert(1)');
    expect(messageEl.querySelector('.qrf-abort-btn')).not.toBeNull();
    expect(messageEl.innerHTML).toBe('<div>正在规划<button class="qrf-abort-btn">终止</button></div>');
  });

  it('正常渲染（未被转义、有子元素）时不触发重写', () => {
    const message = '<div>正文替换完成</div>';
    messageEl.innerHTML = message; // 标准 toastr 尊重 escapeHtml:false 的正常形态
    let capturedOptions: any = null;
    _set_toastr_API_ACU({
      success: (_m: string, _t: string, o: any) => { capturedOptions = o; return {} as any; },
    } as any);

    showToastr_ACU('success', message, { escapeHtml: false });
    capturedOptions.onShown();
    expect(messageEl.innerHTML).toBe(message);
  });
});
