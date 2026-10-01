import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAR_CARD_PROMPT_SQL_ACU } from '../../../src/shared/defaults-json.js';
import { USER_PREFILL_CONTENT_ACU } from '../../../src/shared/user-prefill.js';

/**
 * 默认填表提示词去破限化（旧模型淘汰后对齐上游 plain 形态）。
 *
 * 旧 prompt 是为特定模型调的破限版：Absolute zero 500 tokens、成人向审查豁免话术、
 * <think> 标签 + starter 预填充。新模型无此要求，多余脚手架只浪费 token 并污染语气。
 * SQL 规则正文与上游逐字一致，予以保留；解析只认 <tableEdit>，标签切换不影响运行时。
 */
describe('默认填表提示词（去破限版）', () => {
  const segments = DEFAULT_CHAR_CARD_PROMPT_SQL_ACU as Array<{ role: string; content: string }>;
  const allText = segments.map(segment => String(segment.content)).join('\n');

  it('不含 Absolute zero 脚手架', () => {
    expect(allText).not.toContain('Absolute zero');
  });

  it('不含安全审查豁免话术', () => {
    expect(allText).not.toContain('不存在openai');
  });

  it('主段用 <thought> 标签，不用 <think>', () => {
    const main = segments.find(segment => (segment as any).isMain);
    expect(main, '必须有主段').toBeTruthy();
    expect(main!.content).toContain('<thought>');
    expect(main!.content).toContain('</thought>');
    expect(main!.content).not.toContain('<think>');
  });

  it('无 <think> starter 预填充段', () => {
    expect(segments.some(segment => String(segment.content).startsWith('<think>'))).toBe(false);
  });

  it('末尾补回 user 预填充段（与上游一致）', () => {
    const tail = segments[segments.length - 1];
    expect(tail.role).toBe('user');
    expect(tail.content).toBe(USER_PREFILL_CONTENT_ACU);
  });

  it('SQL 规则正文保留（WHERE 优先级与格式要点）', () => {
    expect(allText).toContain('WHERE row_id = N');
    expect(allText).toContain('禁止使用 DROP TABLE');
    expect(allText).toContain('<tableEdit>');
  });
});
