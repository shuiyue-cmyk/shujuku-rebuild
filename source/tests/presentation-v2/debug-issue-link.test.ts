
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
