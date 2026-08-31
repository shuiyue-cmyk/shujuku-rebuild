/**
 * shared/vector-cross-origin-error.ts — 向量服务（embedding / rerank）跨源失败归类
 *
 * 依赖零、只读的小叶子模块：两个 gateway 共用同一份识别规则与文案，
 * 避免 gateway 互相 import 带来的 mock 连锁（gateway 模块在测试里常被整体 vi.mock）。
 */

/**
 * 跨源（CORS）失败的可行动提示。向量服务由前端直连第三方 endpoint（不走 TT 后端代理），
 * 提供商没开跨源访问是这类失败最常见、且用户唯一能自己修的成因。
 */
export const VECTOR_CROSS_ORIGIN_FAILURE_HINT_ACU = 'API 提供商未允许跨源访问（CORS）：请求被浏览器拦下，未拿到任何响应。'
    + '请为该 embedding/rerank 服务配置允许跨源访问（Access-Control-Allow-Origin），或改用支持 CORS 的中转地址。';

/**
 * 跨源被拒时 fetch 抛的是不透明 TypeError，没有任何 HTTP 状态可读
 * （Chromium/WebView2「Failed to fetch」、WebKit「Load failed」、Gecko「NetworkError when attempting to fetch resource」）。
 * 该形态与真断网同形、无法区分，因此只用于改写用户可见文案（归类为 CORS + 给出处置建议），
 * 不改既有错误分类：仍按原 kind 走有限重试/退避，避免把瞬时断网误判成终态而要求手动重建。
 */
const CROSS_ORIGIN_FETCH_REJECTION_PATTERN_ACU = /failed to fetch|load failed|networkerror when attempting to fetch|network request failed|err_network|err_failed|err_connection/i;

export function isCrossOriginFetchRejection_ACU(error: unknown): boolean {
    if ((error as any)?.name === 'AbortError') return false;
    const message = String((error as any)?.message ?? error ?? '');
    return CROSS_ORIGIN_FETCH_REJECTION_PATTERN_ACU.test(message);
}
