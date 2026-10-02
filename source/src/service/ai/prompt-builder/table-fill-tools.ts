/**
 * service/ai/prompt-builder/table-fill-tools.ts — 填表原生工具调用（可选项，默认关闭）
 *
 * 开启（settings tableFillNativeToolsEnabled === true）且非流式请求时，填表在
 * 自定义直连通道挂载 table_sql 工具：
 * - 提示词主段运行时注入中间态指引（有工具则调用、无则按正文输出），从不落盘，
 *   因此不需要版本化迁移；开关关闭时提示词字节与历史完全一致。
 * - 命中工具调用则参数合成为 <tableEdit> 块走既有解析链；未命中原样走正文提取兜底。
 * - 流式请求不挂工具（delta 组装 tool_calls 复杂度高，降级为正文路径）。
 */
export const TABLE_SQL_TOOL_NAME_ACU = 'table_sql';

export interface TableSqlToolDefinition_ACU {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: { sql: { type: 'string'; description: string } };
      required: ['sql'];
      additionalProperties: false;
    };
  };
}

const TABLE_SQL_TOOL_ACU: TableSqlToolDefinition_ACU = {
  type: 'function',
  function: {
    name: TABLE_SQL_TOOL_NAME_ACU,
    description: '一次性提交本轮全部表格修改。sql 填写完整 SQL 脚本（INSERT / UPDATE / DELETE，每条以分号结尾），格式与 <tableEdit> 块内完全相同；本轮没有修改时填空字符串。',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: '完整 SQL 脚本，多条语句换行分隔。' },
      },
      required: ['sql'],
      additionalProperties: false,
    },
  },
};

export { TABLE_SQL_TOOL_ACU };

/** SQLite 为唯一存储模式，填表只挂 table_sql 一个工具。 */
export function buildTableFillNativeTools_ACU(_sqlite: boolean): TableSqlToolDefinition_ACU[] {
  return [TABLE_SQL_TOOL_ACU];
}

const INTERMEDIATE_GUIDANCE_MARKER_ACU = '## 输出格式（严格执行）\n\n';

const TABLE_SQL_INTERMEDIATE_GUIDANCE_ACU = `【工具提交（优先）】
如果本次请求提供了 table_sql 工具，必须调用 table_sql 一次性提交本轮全部表格修改：sql 参数填写与下方 <tableEdit> 内格式完全相同的完整 SQL 脚本（每条语句以分号结尾、换行分隔）；本轮没有任何修改时 sql 填空字符串。调用工具后，正文中不要再输出 SQL。
如果本次请求没有提供该工具，则按下方格式在正文中输出。

`;

/**
 * 运行时向主段注入中间态指引（幂等；无输出格式节时原样返回）。
 * 只改本次请求的内存副本，不写回设置，因此开关关闭/打开都不需要迁移旧默认。
 */
export function injectTableSqlIntermediateGuidance_ACU(content: unknown): string {
  const text = typeof content === 'string' ? content : String(content ?? '');
  if (!text || text.includes('table_sql 工具，必须调用 table_sql')) return text;
  const index = text.indexOf(INTERMEDIATE_GUIDANCE_MARKER_ACU);
  if (index < 0) return text;
  const at = index + INTERMEDIATE_GUIDANCE_MARKER_ACU.length;
  return `${text.slice(0, at)}${TABLE_SQL_INTERMEDIATE_GUIDANCE_ACU}${text.slice(at)}`;
}

export interface TableFillToolCall_ACU {
  name?: unknown;
  arguments?: unknown;
}

export interface TableFillTurn_ACU {
  content?: unknown;
  toolCalls?: TableFillToolCall_ACU[] | null;
}

export type TableFillToolTurnResolution_ACU =
  | { ok: true; text: string; viaTool: boolean }
  | { ok: false; error: string };

/**
 * 把一次模型回复（正文 + 工具调用）归一为正文提取链可消费的文本。
 * - 命中 table_sql：参数合成为 <tableEdit> 块；正文残留块剔除，避免下游取块规则
 *   取到与工具不一致的内容。
 * - 未调用：原样返回正文，走既有正文提取兜底。
 * - 参数非 JSON / 缺 sql 字段：ok=false，调用方按可重试模型输出错误处理。
 */
export function resolveTableFillToolTurn_ACU(turn: TableFillTurn_ACU | null | undefined): TableFillToolTurnResolution_ACU {
  const content = typeof turn?.content === 'string' ? turn.content : '';
  const calls = (Array.isArray(turn?.toolCalls) ? turn.toolCalls : [])
    .filter(call => !!call && call.name === TABLE_SQL_TOOL_NAME_ACU);
  if (calls.length === 0) return { ok: true, text: content, viaTool: false };
  const parts: string[] = [];
  for (const call of calls) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(call.arguments ?? '{}'));
    } catch {
      return { ok: false, error: `${TABLE_SQL_TOOL_NAME_ACU} 工具参数不是合法 JSON，请重新调用并确保参数完整。` };
    }
    const value = parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>).sql
      : undefined;
    if (typeof value !== 'string') {
      return { ok: false, error: `${TABLE_SQL_TOOL_NAME_ACU} 工具参数缺少字符串字段 sql。` };
    }
    if (value.trim()) parts.push(value.trim());
  }
  const residual = content.replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '').trim();
  const block = `<tableEdit>\n${parts.join('\n')}\n</tableEdit>`;
  return { ok: true, text: residual ? `${residual}\n${block}` : block, viaTool: true };
}

export interface TableFillNativeToolsGate_ACU {
  /** 用户可选项总开关（settings tableFillNativeToolsEnabled），默认关闭。 */
  enabled: boolean;
  /** 本次请求是否为流式（流式 delta 不组装 tool_calls，直接走正文路径）。 */
  streaming: boolean;
}

/** 工具挂载纯判定：仅开启且非流式时为 true。 */
export function shouldUseTableFillNativeTools_ACU(gate: TableFillNativeToolsGate_ACU): boolean {
  return !!gate && gate.enabled === true && gate.streaming !== true;
}
