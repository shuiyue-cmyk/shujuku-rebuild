/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    installGlobalBuildBadge_ACU,
    readBuildStamp_ACU,
    BUILD_BADGE_ELEMENT_ID_ACU,
} from '../../../src/presentation/bootstrap/install-build-badge';

describe('installGlobalBuildBadge_ACU', () => {
    let savedStamp: unknown;
    let stampDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
        document.getElementById(BUILD_BADGE_ELEMENT_ID_ACU)?.remove();
        savedStamp = (globalThis as any).__ACU_BUILD_STAMP__;
        stampDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__ACU_BUILD_STAMP__');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        document.getElementById(BUILD_BADGE_ELEMENT_ID_ACU)?.remove();
        if (stampDescriptor) Object.defineProperty(globalThis, '__ACU_BUILD_STAMP__', stampDescriptor);
        else delete (globalThis as any).__ACU_BUILD_STAMP__;
    });

    it('挂载右下角水印并写入构建戳', () => {
        (globalThis as any).__ACU_BUILD_STAMP__ = '20260903-01';
        expect(installGlobalBuildBadge_ACU()).toBe(true);
        const badge = document.getElementById(BUILD_BADGE_ELEMENT_ID_ACU);
        expect(badge?.textContent).toBe('TTonly·20260903-01');
        expect(badge?.style.position).toBe('fixed');
        expect(badge?.style.pointerEvents).toBe('none');
    });

    it('重复安装幂等，不产生第二个节点', () => {
        installGlobalBuildBadge_ACU();
        installGlobalBuildBadge_ACU();
        expect(document.querySelectorAll(`#${BUILD_BADGE_ELEMENT_ID_ACU}`).length).toBe(1);
    });

    it('无构建戳时回退 dev，不断链', () => {
        delete (globalThis as any).__ACU_BUILD_STAMP__;
        expect(readBuildStamp_ACU()).toBe('dev');
        expect(installGlobalBuildBadge_ACU()).toBe(true);
        expect(document.getElementById(BUILD_BADGE_ELEMENT_ID_ACU)?.textContent).toBe('TTonly·dev');
    });

    it('document 不可用时返回 false 不抛错', () => {
        vi.stubGlobal('document', undefined);
        expect(installGlobalBuildBadge_ACU()).toBe(false);
    });
});
