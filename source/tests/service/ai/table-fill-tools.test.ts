import { describe, expect, it } from 'vitest';
import {
  TABLE_SQL_TOOL_ACU,
  TABLE_SQL_TOOL_NAME_ACU,
  buildTableFillDefaultPromptSegments_ACU,
  buildTableSqlToolPrompt_ACU,
  resolveTableFillToolTurn_ACU,
  shouldUseTableFillNativeTools_ACU,
} from '../../../src/service/ai/prompt-builder/table-fill-tools';

/**
 * 填表原生工具调用（可选项，默认关闭）。
 *
 * 开启后填表请求挂载 table_sql 工具，主段整体切换为工具版（要求调用工具、
 * 正文不再写 SQL）；命中则工具参数合成为 <tableEdit> 块走既有解析链。
 * 模型选择不调用工具时原样走正文提取兜底。开关关闭时行为与历史完全一致。
 */
describe('填表原生工具（table_sql，可选项）', () => {
  it('工具定义为 OpenAI function 形态，参数只有 sql', () => {
    expect(TABLE_SQL_TOOL_NAME_ACU).toBe('table_sql');
    expect(TABLE_SQL_TOOL_ACU.type).toBe('function');
    expect(TABLE_SQL_TOOL_ACU.function.name).toBe('table_sql');
    expect(TABLE_SQL_TOOL_ACU.function.parameters.required).toEqual(['sql']);
    expect(Object.keys(TABLE_SQL_TOOL_ACU.function.parameters.properties)).toEqual(['sql']);
  });

  it('工具版主段：要求调用 table_sql，正文中不再写 SQL', () => {
    const content = '## 输出格式（严格执行）\n\n<thought>\n[分析步骤]\n</thought>\n\n<content>\n<tableEdit>\nX\n</tableEdit>\n</content>\n\n## 关键规则\n1. 守规\n\n现在开始按此格式执行填表任务。';
    const next = buildTableSqlToolPrompt_ACU(content);
    expect(next).toContain('必须调用 table_sql');
    expect(next).toContain('正文中不要再写任何 SQL');
    expect(next).toContain('[分析步骤]');
    expect(next).toContain('现在开始分析，并调用 table_sql 工具提交本轮填表结果。');
    expect(next).not.toContain('<tableEdit>');
    expect(next).not.toContain('现在开始按此格式执行填表任务。');
    expect(next).toContain('## 关键规则');
  });

  it('缺输出格式节或 thought 块时原样返回（fail-closed，不破坏填表）', () => {
    expect(buildTableSqlToolPrompt_ACU('普通文本')).toBe('普通文本');
    expect(buildTableSqlToolPrompt_ACU('## 输出格式（严格执行）\n\n无 thought 块\n\n## 关键规则')).toContain('## 输出格式（严格执行）');
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

  it('默认段构造：开关关返回正文版默认，开关开返回工具版默认', () => {
    const defaults = [{
      role: 'USER',
      content: '## 输出格式（严格执行）\n\n<thought>\n[分析步骤]\n</thought>\n\n<content>\n<tableEdit>\nX\n</tableEdit>\n</content>\n\n## 关键规则\n1. 守规\n\n现在开始按此格式执行填表任务。',
      mainSlot: 'A',
      isMain: true,
    }];

    const off = buildTableFillDefaultPromptSegments_ACU(defaults as any, false);
    const on = buildTableFillDefaultPromptSegments_ACU(defaults as any, true);

    expect(String(off[0].content)).toContain('<tableEdit>');
    expect(String(off[0].content)).not.toContain('必须调用 table_sql');
    expect(String(on[0].content)).toContain('必须调用 table_sql');
    // 逐段浅拷贝：不得就地改写入参（否则默认值本身被工具化，关闭开关也回不去）
    expect(String(defaults[0].content)).toContain('<tableEdit>');
    expect(String(defaults[0].content)).not.toContain('必须调用 table_sql');
  });

  it('门控：仅开启且非流式时挂工具（流式 delta 不组装 tool_calls）', () => {
    expect(shouldUseTableFillNativeTools_ACU({ enabled: true, streaming: false })).toBe(true);
    expect(shouldUseTableFillNativeTools_ACU({ enabled: false, streaming: false })).toBe(false);
    expect(shouldUseTableFillNativeTools_ACU({ enabled: true, streaming: true })).toBe(false);
  });
});
