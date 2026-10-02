import { describe, expect, it } from 'vitest';
import {
  TABLE_SQL_TOOL_ACU,
  TABLE_SQL_TOOL_NAME_ACU,
  buildTableFillNativeTools_ACU,
  injectTableSqlIntermediateGuidance_ACU,
  resolveTableFillToolTurn_ACU,
  shouldUseTableFillNativeTools_ACU,
} from '../../../src/service/ai/prompt-builder/table-fill-tools';

/**
 * 填表原生工具调用（可选项，默认关闭）。
 *
 * 开启后填表请求挂载 table_sql 工具：命中则工具参数合成为 <tableEdit> 块走既有
 * 解析链；未命中（宿主/模型不支持）则原样走正文提取兜底。提示词用中间态写法
 * （有工具则调用、无则按正文输出），任一侧缺失都不破坏填表。
 */
describe('填表原生工具（table_sql，可选项）', () => {
  it('工具定义为 OpenAI function 形态，参数只有 sql', () => {
    expect(TABLE_SQL_TOOL_NAME_ACU).toBe('table_sql');
    expect(TABLE_SQL_TOOL_ACU.type).toBe('function');
    expect(TABLE_SQL_TOOL_ACU.function.name).toBe('table_sql');
    expect(TABLE_SQL_TOOL_ACU.function.parameters.required).toEqual(['sql']);
    expect(Object.keys(TABLE_SQL_TOOL_ACU.function.parameters.properties)).toEqual(['sql']);
  });

  it('按 SQLite 模式返回唯一的 table_sql 工具', () => {
    expect(buildTableFillNativeTools_ACU(true)).toEqual([TABLE_SQL_TOOL_ACU]);
  });

  it('中间态指引插在输出格式节之后', () => {
    const content = '## 输出格式（严格执行）\n\n<content>\n<tableEdit>\nX\n</tableEdit>\n</content>';
    const next = injectTableSqlIntermediateGuidance_ACU(content);
    expect(next).toContain('如果本次请求提供了 table_sql 工具，必须调用 table_sql');
    expect(next).toContain('如果本次请求没有提供该工具，则按下方格式在正文中输出');
    expect(next.indexOf('table_sql')).toBeGreaterThan(next.indexOf('## 输出格式（严格执行）'));
  });

  it('重复注入幂等', () => {
    const once = injectTableSqlIntermediateGuidance_ACU('## 输出格式（严格执行）\n\n正文');
    expect(injectTableSqlIntermediateGuidance_ACU(once)).toBe(once);
  });

  it('无输出格式节时原样返回', () => {
    expect(injectTableSqlIntermediateGuidance_ACU('普通文本')).toBe('普通文本');
  });

  it('命中工具调用时合成为 <tableEdit> 块', () => {
    const result = resolveTableFillToolTurn_ACU({
      content: '分析完毕',
      toolCalls: [{ name: 'table_sql', arguments: JSON.stringify({ sql: 'UPDATE t SET a = 1;' }) }],
    });
    expect(result).toEqual({
      ok: true,
      viaTool: true,
      text: '分析完毕\n<tableEdit>\nUPDATE t SET a = 1;\n</tableEdit>',
    });
  });

  it('正文残留的 <tableEdit> 块被剔除，避免与工具内容双写冲突', () => {
    const result = resolveTableFillToolTurn_ACU({
      content: '分析<tableEdit>\nDELETE FROM t;\n</tableEdit>完毕',
      toolCalls: [{ name: 'table_sql', arguments: JSON.stringify({ sql: 'UPDATE t SET a = 1;' }) }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).not.toContain('DELETE FROM t;');
      expect(result.text).toContain('UPDATE t SET a = 1;');
    }
  });

  it('多次调用按顺序合并', () => {
    const result = resolveTableFillToolTurn_ACU({
      content: '',
      toolCalls: [
        { name: 'table_sql', arguments: JSON.stringify({ sql: 'UPDATE t SET a = 1;' }) },
        { name: 'table_sql', arguments: JSON.stringify({ sql: 'DELETE FROM t WHERE a = 0;' }) },
      ],
    });
    expect(result).toEqual({
      ok: true,
      viaTool: true,
      text: '<tableEdit>\nUPDATE t SET a = 1;\nDELETE FROM t WHERE a = 0;\n</tableEdit>',
    });
  });

  it('未调用工具时原样返回正文，走正文提取兜底', () => {
    const result = resolveTableFillToolTurn_ACU({ content: '<tableEdit>\nUPDATE t SET a = 1;\n</tableEdit>', toolCalls: [] });
    expect(result).toEqual({
      ok: true,
      viaTool: false,
      text: '<tableEdit>\nUPDATE t SET a = 1;\n</tableEdit>',
    });
  });

  it('工具参数非 JSON 时判失败，由调用方按可重试错误处理', () => {
    expect(resolveTableFillToolTurn_ACU({ content: '', toolCalls: [{ name: 'table_sql', arguments: '{oops' }] }))
      .toEqual({ ok: false, error: expect.stringContaining('table_sql') });
  });

  it('工具参数缺 sql 字段时判失败', () => {
    expect(resolveTableFillToolTurn_ACU({ content: '', toolCalls: [{ name: 'table_sql', arguments: '{}' }] }))
      .toEqual({ ok: false, error: expect.stringContaining('sql') });
  });

  it('门控：仅开启且非流式时挂工具（流式 delta 不组装 tool_calls）', () => {
    expect(shouldUseTableFillNativeTools_ACU({ enabled: true, streaming: false })).toBe(true);
    expect(shouldUseTableFillNativeTools_ACU({ enabled: false, streaming: false })).toBe(false);
    expect(shouldUseTableFillNativeTools_ACU({ enabled: true, streaming: true })).toBe(false);
  });
});
