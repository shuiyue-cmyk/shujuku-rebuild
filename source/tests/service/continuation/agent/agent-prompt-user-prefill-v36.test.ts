/**
 * TT 移植上游 ce867f86 的 continuation Agent 提示词 V36（user-prefill 切换批）。
 *
 * V36 = 在冻结的本地 V35 默认组上：把每组尾部 assistant 预填充段换成 user + USER_PREFILL
 * （保留 enabled/deletable/pinned 旗标）；主 Agent 文本协议段与子代理 system 段各追加
 * 「独立 read/search 同回复并发」协议。上游 native-tool V35→V36 不在移植清单。
 * 锁定语义：终审/契约 JSON 解析走 AGENT_PREFILLS_ACU 静态拼接，不受尾段形态影响；
 * T13 dispatch 补齐与 T15 排布问答段不得因 V36 回退。
 */
import { describe, expect, it } from 'vitest';
import {
  AGENT_PREFILLS_ACU,
  CONTINUATION_CURRENT_COMPOSER_RULES_ACU,
  CONTINUATION_CURRENT_FINAL_REVIEW_RULES_ACU,
  CONTINUATION_CURRENT_MAIN_WORKFLOW_RULES_ACU,
  CONTINUATION_V35_DEFAULT_LINEAGE_ACU,
  buildDefaultContinuationAgentPrompts_ACU,
  buildV35ContinuationAgentPrompts_ACU,
  buildV36ContinuationAgentPrompts_ACU,
  buildV37ContinuationAgentPrompts_ACU,
  currentDefaultMainAgentLayoutAnswer_ACU,
  hashAgentPromptContent_ACU,
} from '../../../../src/service/continuation/agent/agent-defaults';
import { parseAgentJsonPayload_ACU, parseAgentMainOutput_ACU } from '../../../../src/service/continuation/agent/agent-protocol';
import { CONTINUATION_AGENT_PROMPT_KEYS_ACU } from '../../../../src/service/continuation/model';
import { USER_PREFILL_CONTENT_ACU } from '../../../../src/shared/user-prefill.js';

const MAIN_ADDENDUM_ACU = '\n独立 read/search 请在预算许可范围内于同一回复并发调用，不要分批等待；仅搜索结果决定的精读须等回执。上一轮的工具指令（尤其 SQL）和真实回执在会话历史中，按实际已存/未存栏目行动。';
const SUBAGENT_ADDENDUM_ACU = '\n独立 read/search 在授权和预算内于同一回复并发调用，不拆批等待；搜索结果决定的精读等回执后再读。逐栏写入只认真实回执中的已存栏目，缺栏只补缺失项。';

describe('V36 构建：尾段 user-prefill 切换 + 协议段并发追加', () => {
  it('每组尾部 assistant 预填充段换成 user + USER_PREFILL，旗标原样保留', () => {
    const previous = buildV35ContinuationAgentPrompts_ACU();
    const current = buildV36ContinuationAgentPrompts_ACU();
    for (const role of CONTINUATION_AGENT_PROMPT_KEYS_ACU as Array<keyof typeof previous>) {
      const oldTail = previous[role][previous[role].length - 1];
      const newTail = current[role][current[role].length - 1];
      if (oldTail.role === 'assistant') {
        expect(newTail.role, role).toBe('user');
        expect(newTail.content, role).toBe(USER_PREFILL_CONTENT_ACU);
        expect(newTail.enabled, role).toBe(oldTail.enabled);
        expect(newTail.deletable, role).toBe(oldTail.deletable);
        expect(newTail.pinned, role).toBe(oldTail.pinned);
      } else {
        expect(newTail, role).toEqual(oldTail);
      }
    }
  });

  it('终审组尾段是 user 任务段（含 $AGENT_TASK 与占位符），V36 原样保留不强拆', () => {
    const previous = buildV35ContinuationAgentPrompts_ACU();
    const current = buildV36ContinuationAgentPrompts_ACU();
    const oldTail = previous.finalReviewer[previous.finalReviewer.length - 1];
    expect(oldTail.content).toContain('$AGENT_TASK');
    expect(current.finalReviewer[current.finalReviewer.length - 1]).toEqual(oldTail);
  });

  it('主 Agent 文本协议段追加同回复并发协议；其余组 system 段追加子代理并发协议', () => {
    const current = buildV36ContinuationAgentPrompts_ACU();
    const mainProtocol = current.main.find(segment => segment.content.startsWith('【文本协议规范】'));
    expect(mainProtocol?.content.endsWith(MAIN_ADDENDUM_ACU)).toBe(true);
    for (const role of CONTINUATION_AGENT_PROMPT_KEYS_ACU as Array<keyof typeof current>) {
      if (role === 'main') continue;
      const systemSegment = current[role].find(segment => segment.role === 'system');
      expect(systemSegment?.content.endsWith(SUBAGENT_ADDENDUM_ACU), role).toBe(true);
      // 原正文只增不减：协议追加是尾附，不删块、不改写既有纪律。
      const oldSystem = buildV35ContinuationAgentPrompts_ACU()[role].find(segment => segment.role === 'system');
      expect(systemSegment?.content.startsWith(oldSystem!.content), role).toBe(true);
    }
  });

  it('buildDefaultContinuationAgentPrompts_ACU 即当前 V37 默认组', () => {
    expect(buildDefaultContinuationAgentPrompts_ACU()).toEqual(buildV37ContinuationAgentPrompts_ACU());
  });
});

describe('V36 不回退 T13/T15 锁定语义', () => {
  it('T13 派遣补齐仍在 V36 主组与 composer/终审任务段里', () => {
    const current = buildV36ContinuationAgentPrompts_ACU();
    expect(current.main.some(segment => segment.content.includes(CONTINUATION_CURRENT_MAIN_WORKFLOW_RULES_ACU))).toBe(true);
    expect(current.instructionComposer.some(segment => segment.content.includes(CONTINUATION_CURRENT_COMPOSER_RULES_ACU))).toBe(true);
    expect(current.finalReviewer.some(segment => segment.content.includes(CONTINUATION_CURRENT_FINAL_REVIEW_RULES_ACU))).toBe(true);
  });

  it('T15 排布问答段保持当前默认（快照枚举已去表格目录），V36 未触碰', () => {
    const current = buildV36ContinuationAgentPrompts_ACU();
    const layout = current.main.find(segment => segment.content.startsWith('我收到的上下文分三层：'));
    expect(layout?.content).toBe(currentDefaultMainAgentLayoutAnswer_ACU());
    expect(layout?.content).not.toContain('【表格目录】');
    expect(current.main.some(segment => segment.content.includes('$TABLE_CATALOG'))).toBe(false);
  });
});

describe('V35 默认谱系表（运行时计算，T5 教训：哈希实测核验）', () => {
  it('谱系条目与逐段 diff 完全一致，哈希/长度等于对 V35 冻结正文的运行时重算值', () => {
    const previous = buildV35ContinuationAgentPrompts_ACU();
    const current = buildV36ContinuationAgentPrompts_ACU();
    for (const role of CONTINUATION_AGENT_PROMPT_KEYS_ACU as Array<keyof typeof previous>) {
      const expected = previous[role]
        .map((segment, index) => ({ index, segment }))
        .filter(({ index, segment }) => current[role][index]?.role !== segment.role || current[role][index]?.content !== segment.content)
        .map(({ index, segment }) => `${index}:${segment.role}:${hashAgentPromptContent_ACU(segment.content)}:${segment.content.length}`);
      const actual = CONTINUATION_V35_DEFAULT_LINEAGE_ACU[role]
        .map(entry => `${entry.index}:${entry.role}:${entry.hash}:${entry.length}`);
      expect(actual, role).toEqual(expected);
      for (const entry of CONTINUATION_V35_DEFAULT_LINEAGE_ACU[role]) {
        const segment = previous[role][entry.index];
        expect(segment.role).toBe(entry.role);
        expect(hashAgentPromptContent_ACU(segment.content)).toBe(entry.hash);
        expect(segment.content.length).toBe(entry.length);
        // 谱系条目必须指向会被 V36 改写的段，且不与 V36 当前正文重合。
        expect(current[role][entry.index].content).not.toBe(segment.content);
      }
    }
  });
});

describe('契约 JSON 解析不受尾段形态影响（P1 锁定）', () => {
  it('主 Agent 完整 JSON 重输与续写预填充两种回包都能解析', () => {
    const full = parseAgentMainOutput_ACU('{"thought":"信息已足够","action":"block","reason":"缺资料","unresolved":["x"]}', AGENT_PREFILLS_ACU.main, false);
    expect(full).toMatchObject({ kind: 'block' });
    const continued = parseAgentMainOutput_ACU('信息已足够","action":"block","reason":"缺资料","unresolved":["x"]}', AGENT_PREFILLS_ACU.main, false);
    expect(continued).toMatchObject({ kind: 'block' });
  });

  it('终审契约载荷按静态 prefill 拼接解析，即使默认组尾段已是 user 预填充', () => {
    const prefill = AGENT_PREFILLS_ACU.reviewer;
    const parsed = parseAgentJsonPayload_ACU('{"verdict":"pass","summary":"通过","emotionFindings":[],"worldFindings":[],"logicFindings":[],"requiredFixes":[],"preserve":[]}', prefill, ['verdict', 'summary']);
    expect(parsed.verdict).toBe('pass');
  });
});
