/**
 * service/ai/prompt-builder/table-fill-tools.ts — 填表原生工具调用（可选项，默认关闭）
 *
 * 开关开启（settings tableFillNativeToolsEnabled === true）且非流式请求时，填表在
 * 自定义直连通道挂载 table_sql 工具，主段整体切换为工具版（要求调用工具、正文不再写
 * SQL）；开关关闭时提示词字节与历史完全一致。切换只改本次请求的内存副本，不写回设置。
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

const TABLE_SQL_TOOL_SECTION_ACU = `分析完成后，必须调用 table_sql 工具一次性提交本轮全部表格修改：
- sql 参数填写完整 SQL 脚本，只允许 INSERT / UPDATE / DELETE，例如：
INSERT INTO table_name (col1, col2) VALUES ('值1', '值2');
UPDATE table_name SET col1 = '新值' WHERE row_id = 1;
DELETE FROM table_name WHERE row_id = 2;
- 本轮没有任何修改时，sql 填空字符串。
- 表格修改只能通过 table_sql 工具提交，正文中不要再写任何 SQL。`;

/** 取主段 <thought> 内的分析步骤与纪要规则，工具化后原样沿用。 */
function extractThoughtSteps_ACU(content: string): string | null {
  const start = content.indexOf('<thought>');
  const end = content.indexOf('</thought>', start);
  if (start < 0 || end < 0) return null;
  return content.slice(start + '<thought>'.length, end).trim();
}

function replacePromptSection_ACU(content: string, startMarker: string, endMarker: string, replacement: string): string | null {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) return null;
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}

/**
 * 开关开启时的工具版主段：输出格式节整体换成工具提交节，结尾句同步切换。
 * 缺输出格式节或 thought 块时原样返回（fail-closed：提示词保持正文版，
 * 工具照挂，模型未调用时走正文兜底，不破坏填表）。
 */
export function buildTableSqlToolPrompt_ACU(content: unknown): string {
  const text = typeof content === 'string' ? content : String(content ?? '');
  if (!text) return text;
  const steps = extractThoughtSteps_ACU(text);
  if (steps === null) return text;
  const section = `## 输出格式（严格执行）

先在正文中完成分析，可写在 <thought></thought> 内：
${steps}

${TABLE_SQL_TOOL_SECTION_ACU}

`;
  const replaced = replacePromptSection_ACU(text, '## 输出格式（严格执行）', '## 关键规则', section);
  if (replaced === null) return text;
  return replaced.replace(
    '现在开始按此格式执行填表任务。',
    '现在开始分析，并调用 table_sql 工具提交本轮填表结果。',
  );
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

/**
 * 按开关构造「当前生效的默认主段」：供填表设置编辑器展示与「恢复默认」对齐。
 * 逐段浅拷贝，不就地改写入参——否则默认值本身被工具化，关掉开关也回不去正文版。
 */
export function buildTableFillDefaultPromptSegments_ACU(segments: any[], toolEnabled: boolean): any[] {
    if (!Array.isArray(segments)) return segments;
    if (toolEnabled !== true) return segments.map(segment => ({ ...segment }));
    return segments.map(segment => (
        (segment?.mainSlot === 'A' || segment?.isMain) && typeof segment?.content === 'string'
            ? { ...segment, content: buildTableSqlToolPrompt_ACU(segment.content) }
            : { ...segment }
    ));
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
