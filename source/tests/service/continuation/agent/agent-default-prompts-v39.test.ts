/**
 * V39 默认提示词的结构护栏：每组引用的占位符都是对应运行时会填充的，正文里不误写占位符本体
 * （例如把年代学地址写成占位符会在渲染时被替换成空串），且尾段恒为 user 预填充。
 */
import { describe, expect, it } from 'vitest';
import { buildDefaultContinuationAgentPrompts_ACU } from '../../../../src/service/continuation/agent/agent-defaults';
import { buildDefaultContinuationOutlinePrompt_ACU } from '../../../../src/service/continuation/defaults';
import { renderContinuationPrompt_ACU } from '../../../../src/service/continuation/prompt-template';
import { USER_PREFILL_CONTENT_ACU } from '../../../../src/shared/user-prefill.js';

const SUBAGENT_COMMON_ACU = ['$AGENT_READ_CATALOG', '$AGENT_READ_MATERIALS', '$AGENT_TASK', '$AGENT_WRITE_SCOPE', '$USER_REQUIREMENTS'];

const EXPECTED_PLACEHOLDERS_ACU: Record<string, string[]> = {
  main: ['$HISTORY_ANCHOR', '$STORY_CATALOG', '$STORY_OVERVIEW', '$STORY_TAIL'],
  arcArchitect: [...SUBAGENT_COMMON_ACU, '$OUTLINE_WINDOW', '$STORY_ARC', '$STORY_CATALOG', '$STORY_OVERVIEW', '$STORY_TAIL', '$WORLDBOOK_CATALOG', '$WORLDBOOK_HITS'],
  maintainer: [...SUBAGENT_COMMON_ACU, '$CHRONOLOGY', '$HISTORY_UNSETTLED', '$HOOKS_LEDGER', '$INFO_GAP', '$STORY_CATALOG', '$WORLDBOOK_CATALOG', '$WORLDBOOK_HITS'],
  mainlinePlanner: [...SUBAGENT_COMMON_ACU, '$HOOKS_LEDGER', '$INFO_GAP', '$OUTLINE_WINDOW', '$STORY_ARC', '$STORY_CATALOG', '$STORY_OVERVIEW', '$STORY_TAIL', '$WORLDBOOK_CATALOG', '$WORLDBOOK_HITS'],
  beatPlanner: [...SUBAGENT_COMMON_ACU, '$HOOKS_LEDGER', '$INFO_GAP', '$OUTLINE_WINDOW', '$STORY_CATALOG', '$STORY_TAIL', '$WORLDBOOK_CATALOG', '$WORLDBOOK_HITS'],
  // 终审由独立入口渲染，只提供这几项（含新增的伏笔账本与信息差）。
  finalReviewer: ['$AGENT_READ_MATERIALS', '$AGENT_TASK', '$HOOKS_LEDGER', '$INFO_GAP', '$OUTLINE_WINDOW', '$STORY_ARC', '$STORY_TAIL', '$USER_REQUIREMENTS', '$WORLDBOOK_HITS'],
  webResearcher: [...SUBAGENT_COMMON_ACU, '$STORY_TAIL', '$TABLE_CATALOG', '$WEB_REFS', '$WEB_TOOL_CATALOG', '$WORLDBOOK_CATALOG'],
  instructionComposer: ['$ACTIVE_CONSTRAINTS', '$AGENT_READ_MATERIALS', '$AGENT_TASK', '$CHRONOLOGY', '$HOOKS_LEDGER', '$INFO_GAP', '$OUTLINE_WINDOW', '$STORY_ARC', '$STORY_TAIL', '$USER_REQUIREMENTS'],
};

async function usedPlaceholders_ACU(segments: unknown): Promise<string[]> {
  const rendered = await renderContinuationPrompt_ACU(segments, {}, 'agent_delegate');
  return [...rendered.usedPlaceholders].sort();
}

describe('V39 默认提示词结构', () => {
  it.each(Object.keys(EXPECTED_PLACEHOLDERS_ACU))('%s 只引用运行时会填充的占位符', async role => {
    const prompts = buildDefaultContinuationAgentPrompts_ACU() as unknown as Record<string, unknown>;
    expect(await usedPlaceholders_ACU(prompts[role])).toEqual([...EXPECTED_PLACEHOLDERS_ACU[role]].sort());
  });

  it('每组以 system 身份段开头、以 user 预填充收尾；主 Agent 只有一个 system 段', () => {
    const prompts = buildDefaultContinuationAgentPrompts_ACU();
    for (const role of Object.keys(EXPECTED_PLACEHOLDERS_ACU) as Array<keyof typeof prompts>) {
      const segments = prompts[role];
      expect(segments[0].role).toBe('system');
      expect(segments[segments.length - 1]).toMatchObject({ role: 'user', content: USER_PREFILL_CONTENT_ACU });
    }
    expect(prompts.main.filter(segment => segment.role === 'system')).toHaveLength(1);
  });

  it('阶段大纲默认提示词引用规划器提供的全部资料，尾段为 user 预填充', async () => {
    const outline = buildDefaultContinuationOutlinePrompt_ACU();
    expect(await usedPlaceholders_ACU(outline)).toEqual([
      '$1', '$ACTIVE_CONSTRAINTS', '$CHRONOLOGY', '$COMPLETED_STAGE_PART', '$HOOKS_LEDGER', '$INFO_GAP', '$OUTLINE_WINDOW', '$PACING_CONTEXT',
      '$REMAINING_TURNS', '$REPLAN_INSTRUCTION', '$STAGE_HISTORY', '$STAGE_WORD_BUDGET', '$STORY_ARC', '$STORY_OVERVIEW', '$STORY_TAIL',
      '$TURN_RANGE', '$USER_REQUIREMENTS', '$VALIDATION_ERRORS',
    ].sort());
    expect(outline.map(segment => segment.content).join('\n')).toContain('$1');
    expect(outline[outline.length - 1]).toMatchObject({ role: 'user', content: USER_PREFILL_CONTENT_ACU });
  });
});
