/**
 * tests/presentation-v2/tt-layout-abi.test.ts
 * TT Layout ABI 接入的源码守卫测试（jsdom 无法解析 CSS 自定义属性级联，
 * 纯 CSS 变量绑定与难以在测试内渲染的浮层用源文本断言兜底；
 * 可渲染的 surface 属性打标已在 mount / acu-drawer / acu-toast-viewport /
 * custom-confirm / optimization-ui-tt-surface 各套件做 DOM 级断言）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8');
}

describe('TT Layout ABI — App.vue safe-area 变量绑定', () => {
  const appSource = readSource('src/presentation-v2/App.vue');

  it('--acu-native-safe-* 四项全部绑到宿主 --tt-inset-*，缺失时回退 0', () => {
    expect(appSource).toContain('--acu-native-safe-top: max(var(--tt-inset-top, 0px), 0px);');
    expect(appSource).toContain('--acu-native-safe-right: max(var(--tt-inset-right, 0px), 0px);');
    expect(appSource).toContain('--acu-native-safe-left: max(var(--tt-inset-left, 0px), 0px);');
    // bottom 额外并入 surface-local 键盘 inset（宿主把 --tt-ime-bottom 注入 fullscreen-window root）
    expect(appSource).toContain(
      '--acu-native-safe-bottom: max(var(--tt-inset-bottom, 0px), var(--tt-ime-bottom, 0px), 0px);',
    );
  });

  it('为 TT firewall 强制 fixed 的 root 预置 shell 同级 z-index', () => {
    const rootBlock = appSource.slice(
      appSource.indexOf(':global(#acu-app-v2)'),
      appSource.indexOf('box-sizing: border-box;'),
    );
    expect(rootBlock).toContain('z-index: 9000;');
  });
});

describe('TT Layout ABI — 浮层 surface 声明', () => {
  it('mount.ts 把主挂载 root 声明为 fullscreen-window', () => {
    const mountSource = readSource('src/presentation-v2/bootstrap/mount.ts');
    expect(mountSource).toContain(
      'applyTtMobileSurface_ACU(root, TT_MOBILE_SURFACE_ACU.FullscreenWindow)',
    );
  });

  it('VisualizerSurface 移动端导航遮罩层声明为 backdrop', () => {
    const surfaceSource = readSource(
      'src/presentation-v2/surfaces/visualizer/VisualizerSurface.vue',
    );
    const layerBlock = surfaceSource.slice(
      surfaceSource.indexOf('class="acu-visualizer-surface__mobile-nav-layer"'),
      surfaceSource.indexOf('@click.self="closeMobileNav"'),
    );
    expect(layerBlock).toContain('data-tt-mobile-surface="backdrop"');
  });

  it('optimization-ui-exec 重优化对话框声明 free-window，配套遮罩声明 backdrop', () => {
    const execSource = readSource(
      'src/presentation/components/optimization-ui/optimization-ui-exec.ts',
    );
    expect(execSource).toContain(
      '<div class="acu-optimization-dialog acu-dialog-classic" data-tt-mobile-surface="free-window" style="',
    );
    expect(execSource).toContain(
      '<div id="acu-opt-backdrop" data-tt-mobile-surface="backdrop" style="',
    );
  });
});
