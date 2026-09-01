export interface AgentWorldbookRankingCandidate_ACU {
  keys: string[];
  comment: string;
  description: string;
  triggerWhen: string;
}

export interface AgentWorldbookRankingQuery_ACU {
  userInput: string;
  recentContext: string;
  taskContext: string;
}

function normalizeText_ACU(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase();
}

/** 拆出可比较的词项：拉丁词按整词（长度 ≥2），CJK 按双字滑窗（中文没有词间分隔，双字是稳定的最小语义单元）。 */
function extractRankingTerms_ACU(value: unknown): Set<string> {
  const text = normalizeText_ACU(value);
  const terms = new Set<string>();
  for (const word of text.match(/[a-z0-9][a-z0-9_-]*/g) || []) {
    if (word.length >= 2) terms.add(word);
  }
  for (const segment of text.match(/[\u3400-\u9fff]+/g) || []) {
    for (let index = 0; index < segment.length - 1; index++) {
      terms.add(segment.slice(index, index + 2));
    }
  }
  return terms;
}

/** 逐字段比对，绝不把多个字段拼接成一个查询：拼接会让分属不同字段的字凑出词项，产生假命中。 */
function hasTermOverlap_ACU(left: unknown, right: unknown): boolean {
  const leftTerms = extractRankingTerms_ACU(left);
  const rightTerms = extractRankingTerms_ACU(right);
  for (const term of leftTerms) {
    if (rightTerms.has(term)) return true;
  }
  return false;
}

/** 确定性打分：用户输入权重最高，其次最近上下文与任务描述；字段越靠近触发判据本体（关键词 > 名称 > 触发时机 > 描述）权重越大。 */
function scoreCandidate_ACU(candidate: AgentWorldbookRankingCandidate_ACU, query: AgentWorldbookRankingQuery_ACU): number {
  const userInput = query.userInput;
  const recentContext = query.recentContext;
  const taskContext = query.taskContext;
  let score = 0;

  for (const rawKey of candidate.keys || []) {
    if (hasTermOverlap_ACU(userInput, rawKey)) score += 100;
    if (hasTermOverlap_ACU(recentContext, rawKey)) score += 50;
    if (hasTermOverlap_ACU(taskContext, rawKey)) score += 50;
  }
  if (hasTermOverlap_ACU(userInput, candidate.comment)) score += 30;
  if (hasTermOverlap_ACU(recentContext, candidate.comment)) score += 15;
  if (hasTermOverlap_ACU(taskContext, candidate.comment)) score += 15;
  if (hasTermOverlap_ACU(userInput, candidate.triggerWhen)) score += 20;
  if (hasTermOverlap_ACU(recentContext, candidate.triggerWhen)) score += 10;
  if (hasTermOverlap_ACU(taskContext, candidate.triggerWhen)) score += 10;
  if (hasTermOverlap_ACU(userInput, candidate.description)) score += 10;
  if (hasTermOverlap_ACU(recentContext, candidate.description)) score += 5;
  if (hasTermOverlap_ACU(taskContext, candidate.description)) score += 5;
  return score;
}

/** 相关性排序；同分条目保持输入顺序，保证同一批候选多次排序结果一致（决策分片切分依赖这个稳定性）。 */
export function rankAgentWorldbookCandidates_ACU<T extends AgentWorldbookRankingCandidate_ACU>(
  candidates: readonly T[],
  query: AgentWorldbookRankingQuery_ACU,
): T[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, score: scoreCandidate_ACU(candidate, query) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(item => item.candidate);
}
