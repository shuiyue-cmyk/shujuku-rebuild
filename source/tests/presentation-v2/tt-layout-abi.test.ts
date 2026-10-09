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
  const appSource = readSource('src/presentation-v3/App.vue');

  it('--ub-safe-* 四项全部绑到宿主 --tt-inset-*（bottom 并入键盘 inset），缺失时回退 0', () => {
    expect(appSource).toContain('--ub-safe-top: max(env(safe-area-inset-top, 0px), var(--tt-inset-top, 0px));');
    expect(appSource).toContain('--ub-safe-right: max(env(safe-area-inset-right, 0px), var(--tt-inset-right, 0px));');
    expect(appSource).toContain('--ub-safe-left: max(env(safe-area-inset-left, 0px), var(--tt-inset-left, 0px));');
    expect(appSource).toContain(
      '--ub-safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--tt-inset-bottom, 0px), var(--tt-ime-bottom, 0px));',
    );
  });

  it('为 TT firewall 强制 fixed 的 root 预置 shell 同级 z-index', () => {
    const rootBlock = appSource.slice(appSource.indexOf('#acu-app-v2 {'), appSource.indexOf('#acu-app-v2 button {'));
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

  it('侧边面板（含数据库编辑器的表格切换）遮罩层声明为 backdrop', () => {
    const sheetSource = readSource('src/presentation-v3/ui/UbSheet.vue');
    const layerBlock = sheetSource.slice(
      sheetSource.indexOf('class="ub-sheet-layer"'),
      sheetSource.indexOf('@click.self="requestClose"'),
    );
    expect(layerBlock).toContain('data-tt-mobile-surface="backdrop"');
    expect(readSource('src/presentation-v3/surfaces/VisualizerSurface.vue')).toContain('<UbSheet');
  });

  it('optimization-ui-exec 重优化对话框声明 free-window，配套遮罩声明 backdrop', () => {
    const execSource = readSource(
      'src/presentation/components/optimization-ui/optimization-ui-exec.ts',
    );
    expect(execSource).toContain('renderOptimizationReviewDialog_ACU({');
    const dialogSource = readSource('src/presentation/theme/host-dialog.ts');
    expect(dialogSource).toMatch(
      /<div class="acu-optimization-dialog [^"]*" data-tt-mobile-surface="free-window"/,
    );
    expect(dialogSource).toMatch(
      /<div id="acu-opt-backdrop" class="[^"]*" data-tt-mobile-surface="backdrop"/,
    );
  });
});
