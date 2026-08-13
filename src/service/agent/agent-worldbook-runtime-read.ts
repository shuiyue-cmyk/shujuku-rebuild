/**
 * service/agent/agent-worldbook-runtime-read.ts
 * Agent 世界书只读 helper 唯一真源。
 *
 * decision-engine 与 skill-meta 共用同一实现，参数固定为 agent_runtime + trusted_direct，
 * 避免两份等价副本的错误分类与缓存策略漂移。
 */
import { getLorebookEntries_ACU } from '../../data/gateways/worldbook-gateway';
import { createStrictLorebookReadError_ACU, getLorebookEntriesStrict_ACU, type StrictLorebookReadContext_ACU } from '../worldbook/pipeline';

/**
 * 读取单本世界书条目。有 read context 时走请求级物理去重（agent_runtime + trusted_direct）；
 * 无 context 时退回 gateway 直接读取（UI/独立操作路径）。
 * not-found/unknown 读取失败统一以 StrictLorebookReadError 抛出，由调用方决定跳过或阻断。
 */
export async function getAgentRuntimeLorebookEntries_ACU(
  bookName: string,
  readContext?: StrictLorebookReadContext_ACU,
): Promise<any[]> {
  if (!readContext) return getLorebookEntries_ACU(bookName);
  const result = await getLorebookEntriesStrict_ACU([bookName], {
    source: 'agent_runtime',
    validationPolicy: 'trusted_direct',
    runId: readContext.runId,
    context: readContext,
  });
  if (result.status !== 'success') throw createStrictLorebookReadError_ACU(result);
  return result.entriesByBook[bookName] || [];
}
