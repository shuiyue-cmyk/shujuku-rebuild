/**
 * tests/shared/vector-cross-origin-error.test.ts
 * 跨源（CORS）失败识别：向量两个网关共用的分类叶子模块。
 */
import { describe, expect, it } from 'vitest';
import {
  isCrossOriginFetchRejection_ACU,
  VECTOR_CROSS_ORIGIN_FAILURE_HINT_ACU,
} from '../../src/shared/vector-cross-origin-error';

describe('isCrossOriginFetchRejection_ACU', () => {
  it('识别 Chromium / WebKit / Gecko 三套跨源被拒文案', () => {
    expect(isCrossOriginFetchRejection_ACU(new TypeError('Failed to fetch'))).toBe(true);
    expect(isCrossOriginFetchRejection_ACU(new TypeError('Load failed'))).toBe(true);
    expect(isCrossOriginFetchRejection_ACU(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
  });

  it('AbortError（超时中断）不算跨源被拒', () => {
    const aborted = Object.assign(new Error('AbortError: The operation was aborted.'), { name: 'AbortError' });
    expect(isCrossOriginFetchRejection_ACU(aborted)).toBe(false);
  });

  it('无关网络文案与空值不贴跨源标签', () => {
    expect(isCrossOriginFetchRejection_ACU(new Error('socket hang up'))).toBe(false);
    expect(isCrossOriginFetchRejection_ACU(new Error('证书已过期'))).toBe(false);
    expect(isCrossOriginFetchRejection_ACU(null)).toBe(false);
    expect(isCrossOriginFetchRejection_ACU(undefined)).toBe(false);
    expect(isCrossOriginFetchRejection_ACU('Failed to fetch')).toBe(true);
  });

  it('提示文案同时给出成因与两条处置路径（配置允许跨源 / 换支持 CORS 的中转）', () => {
    expect(VECTOR_CROSS_ORIGIN_FAILURE_HINT_ACU).toContain('API 提供商未允许跨源访问（CORS）');
    expect(VECTOR_CROSS_ORIGIN_FAILURE_HINT_ACU).toContain('Access-Control-Allow-Origin');
    expect(VECTOR_CROSS_ORIGIN_FAILURE_HINT_ACU).toContain('中转地址');
  });
});
