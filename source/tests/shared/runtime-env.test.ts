/**
 * tests/shared/runtime-env.test.ts
 * 运行时环境检测 单元测试
 *
 * 每个测试用例通过 vi.resetModules() + 动态 import 获取干净的模块实例。
 * （R1-06：油猴 iframe 形态已移除，不再有运行模式探测。）
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

/** 动态导入 runtime-env 模块的类型 */
type RuntimeEnvModule = typeof import('../../src/shared/runtime-env');

/** 辅助函数：获取干净的 runtime-env 模块实例 */
async function freshImport(): Promise<RuntimeEnvModule> {
    vi.resetModules();
    return await import('../../src/shared/runtime-env');
}

// ═══ ACU_INSTANCE_FLAG 常量 ═══
describe('ACU_INSTANCE_FLAG', () => {
    it('是一个非空字符串', async () => {
        const mod = await freshImport();
        expect(typeof mod.ACU_INSTANCE_FLAG).toBe('string');
        expect(mod.ACU_INSTANCE_FLAG.length).toBeGreaterThan(0);
    });

    it('值为 __ACU_STAR_DB_III_LOADED__', async () => {
        const mod = await freshImport();
        expect(mod.ACU_INSTANCE_FLAG).toBe('__ACU_STAR_DB_III_LOADED__');
    });
});

// ═══ getHostWindow ═══
describe('getHostWindow', () => {
    it('返回 window 自身（插件运行在酒馆主窗口）', async () => {
        const mod = await freshImport();
        expect(mod.getHostWindow()).toBe(window);
    });
});

// ═══ checkAndMarkInstance ═══
describe('checkAndMarkInstance', () => {
    afterEach(() => {
        delete (window as any).__ACU_STAR_DB_III_LOADED__;
    });

    it('首次调用返回 false（无已有实例）', async () => {
        const mod = await freshImport();
        expect(mod.checkAndMarkInstance()).toBe(false);
    });

    it('首次调用后在 hostWindow 上设置标记', async () => {
        const mod = await freshImport();
        mod.checkAndMarkInstance();
        expect((window as any).__ACU_STAR_DB_III_LOADED__).toBe(true);
    });

    it('第二次调用返回 true（已有实例，且其 UI 根仍在）', async () => {
        const root = document.createElement('div');
        root.id = 'acu-app-v2';
        document.body.appendChild(root);
        try {
            const mod = await freshImport();
            mod.checkAndMarkInstance();
            expect(mod.checkAndMarkInstance()).toBe(true);
        } finally {
            root.remove();
        }
    });

    it('标记已存在但 UI 根已移除时允许接管（返回 false）', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        (window as any).__ACU_STAR_DB_III_LOADED__ = true;

        const mod = await freshImport();
        expect(mod.checkAndMarkInstance()).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('允许本实例接管')
        );

        warnSpy.mockRestore();
    });

    it('标记已存在且 UI 根仍在时返回 true 并输出警告', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const root = document.createElement('div');
        root.id = 'acu-app-v2';
        document.body.appendChild(root);
        (window as any).__ACU_STAR_DB_III_LOADED__ = true;

        try {
            const mod = await freshImport();
            expect(mod.checkAndMarkInstance()).toBe(true);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('检测到另一个实例已在运行')
            );
        } finally {
            root.remove();
            warnSpy.mockRestore();
        }
    });

    it('清理标记后可以重新注册', async () => {
        const mod = await freshImport();
        mod.checkAndMarkInstance();
        expect((window as any).__ACU_STAR_DB_III_LOADED__).toBe(true);

        delete (window as any).__ACU_STAR_DB_III_LOADED__;

        const mod2 = await freshImport();
        expect(mod2.checkAndMarkInstance()).toBe(false);
    });
});
