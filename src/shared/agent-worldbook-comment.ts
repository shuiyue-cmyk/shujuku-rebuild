/**
 * Agent 世界书 comment 元数据标记/剥离的单一出口。
 *
 * 本模块是跨 service 与 presentation-v2 两层的纯字符串工具：
 * - service 层：takeover / snapshot-restore / skill-meta / decision-engine
 * - presentation 层：三个条目列表 composable 的 label 派生
 *
 * 约束（防止回归）：
 * 1. 本模块除 TS 类型外不得 import 任何项目内模块，保持零依赖。
 * 2. strict / loose / skill 三个剥离函数必须与迁移前逐字符等价（含空白归一化），
 *    任何改动都会破坏 commentHash 比对与快照恢复的一致性。
 * 3. 单行压缩只发生在 buildWorldbookEntryDisplayLabel_ACU（展示专用），
 *    绝不进入任何 hash 输入路径。
 */

export const AGENT_TAKEOVER_META_START_ACU = 'ACU_AGENT_WORLDBOOK_TAKEOVER_META_START';
export const AGENT_TAKEOVER_META_END_ACU = 'ACU_AGENT_WORLDBOOK_TAKEOVER_META_END';
export const ACU_SKILL_META_START_ACU = 'ACU_SKILL_META_START';
export const ACU_SKILL_META_END_ACU = 'ACU_SKILL_META_END';

/**
 * 工厂而非共享常量实例：带 g 标志的 RegExp 共享 lastIndex，
 * 跨调用 exec/test 会漏匹配。每次返回新实例避免污染。
 */
export function createAgentTakeoverMetaPattern_ACU(): RegExp {
  return /\n?<!--\s*ACU_AGENT_WORLDBOOK_TAKEOVER_META_START\s*\n([\s\S]*?)\nACU_AGENT_WORLDBOOK_TAKEOVER_META_END\s*-->\n?/g;
}

export function createSkillMetaPattern_ACU(): RegExp {
  return /\n?<!--\s*ACU_SKILL_META_START\s*\n([\s\S]*?)\nACU_SKILL_META_END\s*-->\n?/g;
}

function normalizeCommentText_ACU(comment: unknown): string {
  return typeof comment === 'string' ? comment : '';
}

/**
 * 严格剥离：仅移除 version===1 且 kind==='agent_worldbook_takeover' 的块。
 * 未知版本 / 非 JSON 块原样保留（恢复路径需识别为不支持并跳过）。
 * 逐字照搬自 agent-worldbook-takeover.ts 的 stripTakeoverMetaBlock_ACU。
 */
export function stripAgentTakeoverMetaBlockStrict_ACU(comment: unknown): string {
  return normalizeCommentText_ACU(comment)
    .replace(createAgentTakeoverMetaPattern_ACU(), (block, rawMeta: string) => {
      try {
        const meta = JSON.parse(rawMeta.trim()) as Record<string, unknown>;
        return meta.version === 1 && meta.kind === 'agent_worldbook_takeover' ? '\n' : block;
      } catch {
        return block;
      }
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 宽松剥离：不校验 version/kind，清除任何残留 takeover 块（含 {} 等非法 meta）。
 * 逐字照搬自 agent-worldbook-snapshot-restore.ts 的 stripTakeoverMeta_ACU。
 * 与 strict 版行为相反，禁止合并。
 */
export function stripAgentTakeoverMetaBlockLoose_ACU(comment: unknown): string {
  return String(comment || '').replace(createAgentTakeoverMetaPattern_ACU(), '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 剥离 Skill meta 块（不校验内容）。逐字照搬自 agent-worldbook-skill-meta.ts 的 stripWorldbookSkillMetaBlock_ACU。 */
export function stripWorldbookSkillMetaBlockCore_ACU(comment: unknown): string {
  return normalizeCommentText_ACU(comment)
    .replace(createSkillMetaPattern_ACU(), '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 展示专用标题：strict 剥 takeover → 剥 Skill → 压成单行 → 空则回退 `条目 ${uid}`。
 * 注意：单行压缩只在这里，绝不进入任何 hash 输入路径。
 */
export function buildWorldbookEntryDisplayLabel_ACU(comment: unknown, uid: unknown): string {
  const cleaned = stripWorldbookSkillMetaBlockCore_ACU(stripAgentTakeoverMetaBlockStrict_ACU(comment))
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || `条目 ${uid}`;
}
