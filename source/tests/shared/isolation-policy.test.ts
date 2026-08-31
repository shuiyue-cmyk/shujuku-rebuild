import { describe, expect, it } from 'vitest';

import {
    isUsableIsolationSlotKey_ACU,
    TAG_ISOLATION_FEATURE_RETIRED_ACU,
} from '../../src/shared/isolation-policy';
import { normalizeSummaryVectorIsolationKey_ACU } from '../../src/shared/summary-vector-index-scope';

describe('isolation-policy（标签隔离退役后的槽位键口径）', () => {
    it('只拒绝 null / undefined，空串默认槽必须放行', () => {
        expect(TAG_ISOLATION_FEATURE_RETIRED_ACU).toBe(true);
        expect(isUsableIsolationSlotKey_ACU('')).toBe(true);
        expect(isUsableIsolationSlotKey_ACU('iso-a')).toBe(true);
        expect(isUsableIsolationSlotKey_ACU(null)).toBe(false);
        expect(isUsableIsolationSlotKey_ACU(undefined)).toBe(false);
        expect(isUsableIsolationSlotKey_ACU(0)).toBe(false);
    });

    it('聊天槽位键与外置存储 canonical 身份是两套口径：空槽 canonicalize 为 default', () => {
        // 读写门禁按槽位键判定（'' 合法），身份比较按 canonical 判定（'' -> 'default'）。
        expect(isUsableIsolationSlotKey_ACU('')).toBe(true);
        expect(normalizeSummaryVectorIsolationKey_ACU('')).toBe('default');
        expect(normalizeSummaryVectorIsolationKey_ACU('  Profile-A  ')).toBe('Profile-A');
    });
});
