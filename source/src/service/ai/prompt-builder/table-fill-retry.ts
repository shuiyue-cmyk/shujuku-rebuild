/**
 * service/ai/prompt-builder/table-fill-retry.ts — 填表失败重试的纠错历史回灌（思路移植上游 789f960b）
 *
 * 旧做法把报错拼进 $0 表格数据尾部：报错落在 <table_data> 不可信边界里，模型也看不到自己上次写了什么。
 * 现在按对话回灌：上次回复以 assistant 放回，报错与修正要求以 system 跟在后面；原有 assistant 预填充仍在最后。
 *
 * 与上游的差异（我方口径）：
 * - 只有 SQLite 一种存储模式，修正要求只针对 SQL / table_sql；
 * - 上次回复「仅供参考」：只针对报错修正，其余内容要求对照原任务重新判断、不照抄——
 *   否则模型倾向于原样复述首轮内容，把首轮的误判固化下来（用户要求）；
 * - 只回灌最近几轮，避免多轮重试把请求越堆越长。
 *
 * 纠错历史只活在本次请求里，不写表格、不写聊天。回灌在模板处理之后拼接，
 * 上次回复里的 $1、{{表名}} 等不会被当成占位符解析。
 */

export interface TableFillRetryTurn_ACU {
  /** 上次可读的原回复（正文 + 工具参数）；空回时为空串。 */
  response: string;
  /** 已脱敏、截短的报错。 */
  error: string;
}

/** 最多回灌最近几轮失败。 */
export const MAX_TABLE_FILL_RETRY_TURNS_ACU = 2;

const TABLE_FILL_RETRY_EDIT_GUIDE_ACU =
  'SQL 只用 INSERT、REPLACE、UPDATE、DELETE；表名、列名照抄本次提供的表结构，不写 CREATE、ALTER、DROP，不改隐藏列。';

function buildTableFillRetryCorrection_ACU(error: string, tools: boolean): string {
  const outputGuide = tools
    ? '重新调用 table_sql 提交，参数须为完整合法的 JSON，sql 字段须为字符串。'
    : '重新输出完整闭合的 <tableEdit>...</tableEdit> 块，不要只输出解释、续写残片或裸 SQL。';
  return [
    '【填表纠错】',
    `具体报错：${error}`,
    '修正要求：上一条回复仅供参考，只针对上述报错修正；其余内容请对照原任务、表格与聊天记录重新判断，不要照抄上一条回复，也不编造数据。按原任务重新提交本轮完整修改。',
    outputGuide,
    TABLE_FILL_RETRY_EDIT_GUIDE_ACU,
  ].join('\n');
}

/**
 * 把纠错历史接到本次请求消息后面（原 assistant 预填充保持最后）。
 * @param messages 已完成模板处理的请求消息；不会被改写
 * @param history 之前各次失败的回复与报错，按时间先后
 * @param mode tools：本次请求是否挂了 table_sql 工具
 */
export function withTableFillRetryHistory_ACU(
  messages: Array<{ role: string; content: string }>,
  history: readonly TableFillRetryTurn_ACU[] | null | undefined,
  mode: { tools: boolean },
): Array<{ role: string; content: string }> {
  if (!history?.length) return messages;
  const extra: Array<{ role: string; content: string }> = [];
  for (const turn of history.slice(-MAX_TABLE_FILL_RETRY_TURNS_ACU)) {
    if (turn.response) extra.push({ role: 'assistant', content: turn.response });
    extra.push({ role: 'system', content: buildTableFillRetryCorrection_ACU(turn.error, mode.tools) });
  }
  const last = messages[messages.length - 1];
  return last?.role === 'assistant'
    ? [...messages.slice(0, -1), ...extra, last]
    : [...messages, ...extra];
}
