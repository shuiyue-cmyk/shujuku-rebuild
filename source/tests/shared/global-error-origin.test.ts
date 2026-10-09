import { describe, expect, it } from 'vitest';
import { classifyGlobalErrorOrigin_ACU, normalizeScriptUrl_ACU } from '../../src/shared/global-error-origin';

const OWN = normalizeScriptUrl_ACU('tauri://localhost/scripts/extensions/third-party/shujuku/index.js?v=4624#x');

describe('全局错误来源判定', () => {
  it('脚本地址去掉缓存参数与锚点', () => {
    expect(OWN).toBe('tauri://localhost/scripts/extensions/third-party/shujuku/index.js');
  });

  it('调用链含本插件脚本（含带缓存参数的帧）判为本插件', () => {
    const stack = 'Error: boom\n    at fill (tauri://localhost/scripts/extensions/third-party/shujuku/index.js?v=4624:120:9)';
    expect(classifyGlobalErrorOrigin_ACU(stack, OWN)).toBe('own');
  });

  it('调用链全是宿主代码（TT 内嵌运行时报错）判为外部', () => {
    const stack = [
      'invalidate@tauri://localhost/tauri/main/services/embedded-runtime/embedded-runtime-manager.js:324:28',
      'registerWrapper@tauri://localhost/tauri/main/adapters/embedded-runtime/js-slash-runner-runtime-adapter.js:96:27',
    ].join('\n');
    expect(classifyGlobalErrorOrigin_ACU(stack, OWN)).toBe('foreign');
  });

  it('没有任何文件位置或拿不到本插件地址时无从判断', () => {
    expect(classifyGlobalErrorOrigin_ACU('TypeError: x is undefined', OWN)).toBe('unknown');
    expect(classifyGlobalErrorOrigin_ACU('at a (tauri://localhost/x.js:1:1)', '')).toBe('unknown');
  });
});
