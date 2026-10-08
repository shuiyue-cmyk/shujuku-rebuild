/**
 * R10A-13：新版界面的下载不得在 click 后同步 revoke（WebView2 会取消下载，界面却已提示导出成功）。
 * 统一走 downloadJsonToHost_ACU：挂在 host document、延迟 revoke。
 *
 * @vitest-environment jsdom
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return /\.(ts|vue)$/.test(name) ? [path] : [];
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('新版界面下载约定（R10A-13）', () => {
  it('presentation-v2 / v3 源码里没有同步 revokeObjectURL', () => {
    const offenders = ['src/presentation-v2', 'src/presentation-v3']
      .flatMap(listSourceFiles)
      .filter(path => readFileSync(path, 'utf-8')
        .split('\n')
        .some(line => /^\s*URL\.revokeObjectURL\(/.test(line)));
    expect(offenders).toEqual([]);
  });

  it('R10B-18：新版界面只有统一下载入口创建下载链接，不再有内联/重复实现', () => {
    const offenders = ['src/presentation-v2', 'src/presentation-v3']
      .flatMap(listSourceFiles)
      .filter(path => !path.replace(/\\/g, '/').endsWith('bootstrap/host-download.ts'))
      .filter(path => readFileSync(path, 'utf-8').includes('URL.createObjectURL('));
    expect(offenders).toEqual([]);
  });

  it('downloadJsonToHost_ACU 点击后延迟 revoke', async () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    (URL as any).createObjectURL = vi.fn(() => 'blob:x');
    (URL as any).revokeObjectURL = revoke;
    const { downloadJsonToHost_ACU, DOWNLOAD_REVOKE_DELAY_MS_ACU } = await import('../../src/presentation-v2/bootstrap/host-download');

    downloadJsonToHost_ACU('a.json', { ok: true });
    expect(revoke).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DOWNLOAD_REVOKE_DELAY_MS_ACU);
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });
});
