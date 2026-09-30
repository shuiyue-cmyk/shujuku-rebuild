/**
 * 功能页面板分栏规范
 *
 * 页面清单必须从 `pages/` 目录派生，不能手维护。此前手维护的 11 项清单已经漏掉
 * AgentPage.vue 与 ContinuationPage.vue —— 这两个页面若哪天不再用统一分栏骨架，
 * 旧清单照样全绿，约定静默失效。派生后新增页面漏用骨架会直接红灯。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGES_DIR = join(process.cwd(), 'src/presentation-v2/pages');

/**
 * 显式豁免：确实不该用统一分栏骨架的页面必须在此登记并写明理由。
 * 留空是正常状态；它的作用是让「破例」变成一次显式决定，而不是一次静默遗漏。
 */
const EXEMPTED_PAGES: Record<string, string> = {};

function pageFiles(): string[] {
  return readdirSync(PAGES_DIR).filter(fileName => fileName.endsWith('.vue')).sort();
}

function readPage(fileName: string): string {
  return readFileSync(join(PAGES_DIR, fileName), 'utf8');
}

const conformantPages = pageFiles().filter(fileName => !(fileName in EXEMPTED_PAGES));

describe('功能页面板分栏规范', () => {
  it('扫描到的页面清单非空，且豁免表里没有指向已删除页面的陈旧条目', () => {
    expect(pageFiles().length).toBeGreaterThan(0);
    for (const fileName of Object.keys(EXEMPTED_PAGES)) {
      expect(pageFiles(), `豁免表里的 ${fileName} 已不存在，请清理`).toContain(fileName);
      expect(EXEMPTED_PAGES[fileName].trim(), `${fileName} 的豁免必须写明理由`).not.toBe('');
    }
  });

  // 断言模板里的真实使用，而不是裸名字：只 `import AcuPanelGrid` 而在模板里改用
  // 手写 <div class="grid"> 的页面，裸名字断言照样绿 —— 那是复述 import 声明，
  // 不是验证分栏骨架真的承载了布局。
  it.each(conformantPages)('%s 在模板里用 AcuPanelGrid 承载统一左右分栏骨架', (fileName) => {
    expect(readPage(fileName), `${fileName} 模板未使用 AcuPanelGrid`).toMatch(/<AcuPanelGrid[\s>]/);
    expect(readPage(fileName), `${fileName} 缺少 AcuPanelGrid 的闭合标签`).toContain('</AcuPanelGrid>');
  });

  it('单主面板页面保留右列空占位', () => {
    expect(readPage('ApiPage.vue')).toContain('aria-hidden="true"');
  });

  it('页面样式不再手写加权 fr 分栏', () => {
    const weightedFr = /grid-template-columns:.*(?:\d+\.\d+|[2-9]\d*)fr/;

    for (const fileName of conformantPages) {
      expect(readPage(fileName), fileName).not.toMatch(weightedFr);
    }
  });
});
