/**
 * service/agent/agent-worldbook-runtime-state.ts — Agent 世界书运行期开关与原生回退状态（移植上游 1.3.6）
 *
 * 只缓存已读取或已提交的功能配置，不作为接管快照的事实源：剧情推进 / 正文过滤据此判断
 * 「本会话是否运行 Agent」，未开启时整条 Agent 链路不读不写世界书，出错也牵连不到普通剧情。
 * revision 在切换会话与配置保存时递增，迟到的旧读取不得覆盖新结果。
 * 我方增补：loaded 标记本 revision 是否成功读到过配置；预加载失败时保持未加载，
 * 剧情推进开跑前会再补读一次，避免启动时一次读取失败就让 Agent 整个会话静默关闭。
 */
import type { AgentWorldbookControl_ACU } from '../../shared/models/agent-worldbook-model';

let revision = 0;
let loadedControl: AgentWorldbookControl_ACU | null = null;
let loaded = false;
let nativeFallback = false;

export function getAgentWorldbookRuntimeRevision_ACU(): number {
  return revision;
}

export function getLoadedAgentWorldbookControl_ACU(): AgentWorldbookControl_ACU | null {
  return loadedControl ? JSON.parse(JSON.stringify(loadedControl)) : null;
}

export function isAgentWorldbookRuntimeEnabled_ACU(): boolean {
  return loadedControl?.enabled === true && loadedControl.mode === 'agent';
}

/** 本 revision 是否已成功读到过功能配置（读到「无配置」也算已加载）。 */
export function isAgentWorldbookRuntimeControlLoaded_ACU(): boolean {
  return loaded;
}

/**
 * 写入缓存；revision 已变（切换会话 / 期间有配置保存）时拒绝并返回 false。
 * invalidatePendingReads：配置保存成功后递增 revision，使保存前发起的读取迟到时作废。
 * markLoaded=false 用于读取失败：清空开关但保持未加载，留给下一次补读。
 */
export function setLoadedAgentWorldbookControl_ACU(
  control: AgentWorldbookControl_ACU | null,
  expectedRevision: number,
  invalidatePendingReads = false,
  markLoaded = true,
): boolean {
  if (revision !== expectedRevision) return false;
  loadedControl = control ? JSON.parse(JSON.stringify(control)) : null;
  loaded = markLoaded;
  if (invalidatePendingReads) revision += 1;
  return true;
}

export function resetAgentWorldbookRuntime_ACU(): void {
  revision += 1;
  loadedControl = null;
  loaded = false;
  nativeFallback = false;
}

/** 本会话上一次 Agent 处理失败后已按持久快照恢复原生世界书状态；成功应用一次完整选择后清除。 */
export function isAgentWorldbookNativeFallback_ACU(): boolean {
  return nativeFallback;
}

export function setAgentWorldbookNativeFallback_ACU(value: boolean): void {
  nativeFallback = value;
}
