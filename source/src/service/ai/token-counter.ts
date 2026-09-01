import { SillyTavern_API_ACU } from '../../shared/host-api';

/** 宿主分词器不可用时的字符→token 估算系数。中文在常见分词器下约 1 token / 1~1.5 字。 */
const FALLBACK_CHARS_PER_TOKEN_ACU = 1.5;

/**
 * 用宿主分词器统计文本 token 数，供 Skill 元数据的 tk 字段与预算判定共用。
 * 宿主分词器缺失或抛错时按字符数估算，绝不把异常抛给调用方：tk 只是预算参考，不值得中断整条链路。
 */
export async function countTextTokens_ACU(text: string): Promise<number> {
  const content = String(text ?? '');
  if (!content) return 0;
  const counter = SillyTavern_API_ACU?.getTokenCountAsync;
  if (typeof counter === 'function') {
    try {
      const counted = await counter.call(SillyTavern_API_ACU, content);
      if (typeof counted === 'number' && Number.isFinite(counted) && counted >= 0) return Math.ceil(counted);
    } catch {
      // 分词器异常降级为估算：tk 只用于预算与展示，不参与正确性判定。
    }
  }
  return Math.ceil(content.length / FALLBACK_CHARS_PER_TOKEN_ACU);
}
