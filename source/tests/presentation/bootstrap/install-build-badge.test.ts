/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  installGlobalBuildBadge_ACU,
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

    it('重复安装幂等，不产生第二个节点', () => {
        installGlobalBuildBadge_ACU();
        installGlobalBuildBadge_ACU();
        expect(document.querySelectorAll(`#${BUILD_BADGE_ELEMENT_ID_ACU}`).length).toBe(1);
    });
});
