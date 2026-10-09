/**
 * 新版界面按钮不被 flex 挤压的约定
 *
 * 现象（iPhone / iPad）：数据管理「导入 Checkpoint」「历史恢复诊断」行的按钮只剩图标；
 * API 页「加载模型」被截成「加…」。
 *
 * 成因：flex 收缩按 flex-basis 加权分摊。设置行的说明文字很长（basis = 整段说明的单行宽），
 * 输入框是 width:100%（basis = 整行宽），按钮 basis 只有几十像素却按同一比例被压，
 * 而按钮文字允许省略号截断 ⇒ 屏幕越窄截得越狠，直到只剩图标。
 *
 * 约定：普通按钮、文件按钮、设置行控件区都不参与收缩（与 UbIconButton 的 flex: 0 0 auto 一致）；
 * 撑满整行的 block 按钮仍可收缩，避免与同行元素挤出横向滚动。
 *
 * 用源码文本断言：SFC 的 scoped 样式在 vitest+jsdom 下不注入，jsdom 也不做布局（同 tt-ime-safe-bottom-conventions）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readComponent(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'src/presentation-v3', relativePath), 'utf8');
}

/** 取平铺规则的规则体并剥掉注释（注释里提到 flex-shrink 不算数）。 */
function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1].replace(/\/\*[\s\S]*?\*\//g, '') : '';
}

/** 规则体声明的 flex-shrink：显式 flex-shrink 优先，其次 flex 简写的第二个数。 */
function declaredShrink(body: string): string | null {
  const explicit = body.match(/(?:^|;|\s)flex-shrink:\s*([\d.]+)/);
  if (explicit) return explicit[1];
  const shorthand = body.match(/(?:^|;|\s)flex:\s*[\d.]+\s+([\d.]+)/);
  return shorthand ? shorthand[1] : null;
}

const cases = [
  { file: 'ui/UbButton.vue', selector: '.ub-btn', shrink: '0' },
  { file: 'ui/UbButton.vue', selector: '.ub-btn--block', shrink: '1' },
  { file: 'ui/UbFileButton.vue', selector: '.ub-file', shrink: '0' },
  { file: 'ui/UbFileButton.vue', selector: '.ub-file--block', shrink: '1' },
  { file: 'ui/UbRow.vue', selector: '.ub-row__control', shrink: '0' },
];

describe('新版界面：按钮与设置行控件区不被 flex 挤压', () => {
  it.each(cases)('$file 的 $selector 声明 flex-shrink: $shrink', ({ file, selector, shrink }) => {
    const body = ruleBody(readComponent(file), selector);
    expect(body, `${selector} 规则必须存在（选择器改名会让本约定静默失效）`).not.toBe('');
    expect(declaredShrink(body)).toBe(shrink);
  });
});
