import { logDebug_ACU } from '../../shared/utils';
import { SillyTavern_API_ACU } from '../../shared/host-api';

/** 宿主分词器不可用时的字符→token 估算系数。中文在常见分词器下约 1 token / 1~1.5 字。 */
const FALLBACK_CHARS_PER_TOKEN_ACU = 1.5;

/**
 * 用宿主分词器统计文本 token 数，供 Skill 元数据的 tk 字段与预算判定共用。
 * 宿主分词器缺失或抛错时按字符数估算，绝不把异常抛给调用方：tk 只是预算参考，不值得中断整条链路。
 * 降级分支记一条 logDebug（TT 诊断用：真机上分词器是否可用、是否漂移，只看这条日志）。
 */
export async function countTextTokens_ACU(text: string): Promise<number> {
  const content = String(text ?? '');
  if (!content) return 0;
  const counter = SillyTavern_API_ACU?.getTokenCountAsync;
  if (typeof counter !== 'function') {
    logDebug_ACU('[TokenCounter] 宿主分词器缺失（getTokenCountAsync 不可用），按字符估算 token');
    return Math.ceil(content.length / FALLBACK_CHARS_PER_TOKEN_ACU);
  }
  try {
    const counted = await counter.call(SillyTavern_API_ACU, content);
    if (typeof counted === 'number' && Number.isFinite(counted) && counted >= 0) return Math.ceil(counted);
    logDebug_ACU(`[TokenCounter] 宿主分词器返回非法值（${String(counted)}），按字符估算 token`);
  } catch (error) {
    // 分词器异常降级为估算：tk 只用于预算与展示，不参与正确性判定。
    logDebug_ACU('[TokenCounter] 宿主分词器异常，按字符估算 token', error);
  }
  return Math.ceil(content.length / FALLBACK_CHARS_PER_TOKEN_ACU);
}
