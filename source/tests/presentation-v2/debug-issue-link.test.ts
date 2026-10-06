/**
 * Debug 面板「前往 GitHub 提交 issue」链接
 *
 * 上报路径的用户价值全在「有没有把导出的 Debug JSON 带上来」，所以正文模板的第一件事就是
 * 引导附件；环境项只留空位、不代填宿主版本（我们无法在页面里证实用户跑的是哪个 TT 版本，
 * 代填等于替用户下结论）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ACU_GITHUB_ISSUE_URL_ACU,
  buildDebugIssueBody_ACU,
  buildDebugIssueUrl_ACU,
} from '../../src/presentation-v2/composables/debug-issue-link';

describe('Debug issue 链接构造', () => {
  it('指向本插件仓库的 issue 新建页，标题与正文编码进 query', () => {
    expect(ACU_GITHUB_ISSUE_URL_ACU).toBe('https://github.com/shuiyue-cmyk/shujuku-rebuild/issues/new');

    const url = buildDebugIssueUrl_ACU('9.8.7');
    expect(url.startsWith(`${ACU_GITHUB_ISSUE_URL_ACU}?`)).toBe(true);

    const parsed = new URL(url);
    expect(parsed.searchParams.get('title')).toContain('9.8.7');
    expect(parsed.searchParams.get('body')).toContain('9.8.7');
  });

  it('正文引导用户附上导出的 Debug JSON，并留出复现步骤/期望/实际三个空位', () => {
    const body = buildDebugIssueBody_ACU('9.8.7');

    expect(body).toContain('导出 Debug 数据');
    expect(body).toContain('.json');
    expect(body).toContain('复现步骤');
    expect(body).toContain('期望行为');
    expect(body).toContain('实际行为');
  });

  it('不代填未经证实的宿主版本：环境项留「请填写」空位', () => {
    const body = buildDebugIssueBody_ACU('9.8.7');

    expect(body).toMatch(/宿主[^\n]*请填写/);
    expect(body).not.toMatch(/宿主[^\n]*：\s*TauriTavern\s+\d+\.\d+/);
  });

  it('版本读不到时回退 unknown，URL 里不出现 undefined', () => {
    // 测试环境没有 rollup 注入的 __ACU_BUILD_VERSION__，正好覆盖回退分支。
    const url = buildDebugIssueUrl_ACU();

    expect(url).not.toContain('undefined');
    expect(decodeURIComponent(url)).toContain('unknown');
  });
});

/**
 * 页面接线用源码文本断言：AdvancedToolsPage 依赖 log/debug/vector 多条宿主链路，
 * 这里只锁「Debug 操作区里确实有一个指向 issue 页的入口」。
 */
describe('Debug 操作区的 issue 入口接线', () => {
  const pageSource = readFileSync(
    join(process.cwd(), 'src/presentation-v3/pages/AdvancedToolsPage.vue'),
    'utf8',
  );

  it('操作区内有一个绑定 issue URL 的按钮（文案点明去向）', () => {
    expect(pageSource).toContain(':href="debugIssueUrl"');
    expect(pageSource).toContain('前往 GitHub 提交 issue');
  });

  it('URL 由 buildDebugIssueUrl_ACU 生成，不在模板里手写仓库地址', () => {
    expect(pageSource).toMatch(/const debugIssueUrl = buildDebugIssueUrl_ACU\(\)/);
    // 仓库地址只能有一个出处（composable），页面里不得再出现第二份硬编码。
    expect(pageSource).not.toContain('github.com/shuiyue-cmyk');
  });
});
