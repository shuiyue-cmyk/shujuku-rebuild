import { describe, expect, it } from 'vitest';

import { AgentSubagentRuntime_ACU, renderStoryArcVolumePlanInstruction_ACU } from '../../../../src/service/continuation/agent/agent-subagent-runtime';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import type { AiUsageMetadata_ACU } from '../../../../src/service/continuation/internal-ai-call';

const preset_ACU = { presetName: 'p1', source: 'settings', reason: 'test' } as any;
const readReply_ACU = '{"action":"read","reads":["$TABLE:角色表"]}';
const finalReply_ACU = JSON.stringify({ summary: '结算完成', delta: {} });

function input_ACU(): Parameters<AgentSubagentRuntime_ACU['run']>[0] {
  const settings = buildDefaultContinuationSettings_ACU();
  settings.promptCacheEnabled = true;
  return {
    delegation: { agentName: 'hook-cognition-maintainer', prompt: '结算', reads: [] },
    settings,
    resolveContext: {
      chat: [
        { mes: '继续', is_user: true },
        { mes: '守门人挡在门后。', is_user: false },
      ],
      moduleSnapshot: buildEmptyAgentModuleSnapshot_ACU(),
      settledThroughIndex: 0,
      execution: {
        envelope: {}, task: { taskId: 't', stages: [] }, stage: null,
        revision: null, node: null, turn: null,
        turnNumber: null, nodeTurnNumber: null,
      } as any,
      originInstruction: '推进剧情',
      recentTurnCount: 2,
      tableData: { s1: { name: '角色表', content: [['姓名'], ['林瑶']] } },
    },
    budget: { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 1, maxReads: 8, maxExtraReads: 1 },
    preset: preset_ACU,
    createIdentity: (_name, attempt) => ({ taskId: 't', stageId: 's', turnId: 'u', attemptId: `a-${attempt}`, source: 'agent_subagent' }) as any,
    isCurrent: () => true,
  };
}


async function runWithUsageSequence_ACU(sequence: Array<AiUsageMetadata_ACU | null>) {
  const usages = [...sequence];
  const replies = [readReply_ACU, finalReply_ACU];
  const runtime = new AgentSubagentRuntime_ACU({
    resolveApiPreset: (() => preset_ACU) as any,
    callInternalAi: async (_messages, _preset, _identity, _signal, options) => {
      const usage = usages.shift();
      if (usage) options?.onUsage?.(usage);
      return replies.shift() ?? finalReply_ACU;
    },
  });
  return runtime.run(input_ACU());
}

describe('AgentSubagentRuntime_ACU usage 累计', () => {
  it('renders the configured story-arc volume plans without conflating them with stage size', () => {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.stageSize = 'short';

    const medium = renderStoryArcVolumePlanInstruction_ACU(settings);
    expect(medium).toContain('中线：新建或全量重构总纲时规划 10–14 卷');
    expect(medium).toContain('targetStageRange 是解释性容量锚');
    expect(medium).toContain('约 500–750 轮的数量级检查');
    expect(medium).toContain('不承诺固定字数或章节数');
    settings.storyArcVolumePlan = 'short';
    expect(renderStoryArcVolumePlanInstruction_ACU(settings)).toContain('短线：新建或全量重构总纲时规划 7–8 卷');
    settings.storyArcVolumePlan = 'long';
    const long = renderStoryArcVolumePlanInstruction_ACU(settings);
    expect(long).toContain('长线：新建或全量重构总纲时规划 20 卷');
    expect(long).toContain('约 500–750 轮的数量级检查');
    expect(long).not.toContain('100 章');
    settings.storyArcVolumePlan = 'custom';
    settings.customStoryArcVolumeCount = 16;
    expect(renderStoryArcVolumePlanInstruction_ACU(settings)).toContain('自定义：新建或全量重构总纲时规划 16 卷');
  });

  it('完整出站消息超过历史预算时在 AI 调用前拒绝，而不是只检查种子', async () => {
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => { calls.push(messages); return finalReply_ACU; },
    });
    const input = input_ACU();
    input.settings.agentHistoryTokenBudget = 1;

    await expect(runtime.run(input)).rejects.toMatchObject({ error: { code: 'CONTINUATION_AGENT_WRITE_REJECTED' } });
    expect(calls).toHaveLength(0);
  });

  it('malformed tool batch 纳入协议重试，而不是直接终止派工', async () => {
    const replies = [
      '{"action":"read"}',
      '{"action":"read","reads":["$TABLE:角色表"]}',
      finalReply_ACU,
    ];
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => { calls.push(messages); return replies.shift() ?? finalReply_ACU; },
    });
    const input = input_ACU();
    input.settings.internalAiRetryLimit = 1;

    const result = await runtime.run(input);

    expect(result.iterations).toBe(2);
    expect(calls).toHaveLength(3);
    expect(calls[1].map(message => message.content).join('\n')).toContain('没有被采纳');
    expect(result.expandedReads).toEqual(['$TABLE:角色表']);
  });

  it('维护类派工固定写入 hooks/infoGap/chronology，提示词注入年代学账本现状', async () => {
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return finalReply_ACU;
      },
    });

    const result = await runtime.run(input_ACU());

    expect(result.writes).toEqual(['hooks', 'infoGap', 'chronology']);
    const rendered = calls[0].map(message => message.content).join('\n');
    expect(rendered).toContain('【故事年代学账本现状】');
    expect(rendered).toContain('没有已结算的故事时间记录');
    expect(rendered).toContain('$CHRONOLOGY 故事年代学账本');
    expect(rendered).toContain('【故事时间结算契约】');
  });

  it('renders fixed user intent and the complete current-stage outline from one resolve context', async () => {
    const input = input_ACU();
    input.delegation = { agentName: 'arc-architect', prompt: '根据本轮任务校准总纲', reads: [] };
    // 总纲已建立：本用例只验证渲染，不触发“总纲为空时空写入需补条目”的门禁。
    input.resolveContext.moduleSnapshot = {
      ...input.resolveContext.moduleSnapshot,
      storyArc: [{ id: 'ARC-STORY', scope: 'story', title: '全书', direction: '追查真相', escalation: '', withheld: '', status: 'active', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '' }],
    } as any;
    input.settings.agentPrompts.arcArchitect = [{
      role: 'user',
      content: '【初始要求】\n$USER_INTENT\n【完整大纲】\n$OUTLINE_WINDOW\n【任务】\n$AGENT_TASK',
      enabled: true,
      deletable: true,
    }];
    input.resolveContext.execution = {
      envelope: {},
      task: { taskId: 't', stages: [] },
      stage: { stageNumber: 2, status: 'running' },
      revision: { outline: { title: '禁区试探', goal: '确认入口代价', tempo: 'mixed', totalTurns: 2 } },
      node: {
        id: 'node-1',
        title: '入口试探',
        goal: '确认守门人意图',
        turns: [
          { id: 'turn-1', pacing: 'setup', goal: '观察守门人' },
          { id: 'turn-2', pacing: 'pressure', goal: '支付试探代价' },
        ],
      },
      turn: { id: 'turn-1', pacing: 'setup', goal: '观察守门人' },
      turnNumber: 1,
      nodeTurnNumber: 1,
    } as any;
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return finalReply_ACU;
      },
    });

    await runtime.run(input);
    const rendered = calls[0].map(message => message.content).join('\n');
    expect(rendered).toContain('推进剧情');
    expect(rendered).toContain('阶段 2：禁区试探');
    expect(rendered).toContain('观察守门人');
    expect(rendered).toContain('支付试探代价');
    expect(rendered).toContain('根据本轮任务校准总纲');
  });

  it('keeps the arc-architect volume plan ahead of the trailing prefill so the prefill stays the last message', async () => {
    const input = input_ACU();
    input.delegation = { agentName: 'arc-architect', prompt: '立总纲', reads: [] };
    input.settings.internalAiRetryLimit = 2;
    input.resolveContext.moduleSnapshot = {
      ...input.resolveContext.moduleSnapshot,
      storyArc: [{ id: 'ARC-STORY', scope: 'story', title: '全书', direction: '追查真相', escalation: '', withheld: '', status: 'active', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '' }],
    } as any;
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return finalReply_ACU;
      },
    });

    await runtime.run(input);

    const messages = calls[0];
    const last = messages[messages.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toBe('{\n  "summary": "');
    // 读取预算状态是运行时信息，紧贴预填充注入，是模型看到的最后一条 user 消息。
    expect(messages[messages.length - 2].role).toBe('user');
    expect(messages[messages.length - 2].content).toContain('【读取预算状态】');
    expect(messages[messages.length - 3].role).toBe('user');
    expect(messages[messages.length - 3].content).toContain('【总纲卷数计划】');
    // 任务段（含全部固定资料注入）必须在卷数计划之前、预填充之前完整送达。
    expect(messages[messages.length - 4].content).toContain('【本次任务】\n立总纲');
    expect(messages[messages.length - 4].content).toContain('【故事总纲现状】');
  });

  it('runs final review through its own channel, evidence gate, and read-only tool loop', async () => {
    const base = input_ACU();
    base.settings.finalReview = { enabled: true, readTokenBudget: '50%', maxExtraReads: 1 };
    base.settings.agentReadTokenBudget = 1;
    base.resolveContext.worldbook = {
      available: true,
      entries: [{ bookName: '设定集', uid: '7', title: '晶屑设定', keys: ['晶屑'], constant: false, content: '晶屑不能带离铁门。', tokens: 8 }],
    };
    const roles: string[] = [];
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const replies = [
      '{"action":"read","reads":["$TABLE:角色表"]}',
      JSON.stringify({ verdict: 'revise', summary: '晶屑去向需要遵守设定', emotionFindings: [], worldFindings: ['晶屑不能带离铁门'], logicFindings: [], requiredFixes: ['保留铁门限制'], preserve: ['守门人边界'] }),
    ];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      resolveAgentApiPreset: ((_settings: unknown, role: string) => { roles.push(role); return preset_ACU; }) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return replies.shift() ?? null;
      },
    });

    const result = await runtime.runFinalReview({
      settings: base.settings,
      resolveContext: base.resolveContext,
      candidateInstruction: '主角拿起晶屑走出铁门。',
      currentUserInput: '让主角观察晶屑。',
      planningSummary: '主线建议主角试探守门人。',
      createIdentity: (_name, attempt) => ({ taskId: 't', stageId: 's', turnId: 'u', attemptId: `final-${attempt}`, source: 'agent_subagent' }) as any,
      isCurrent: () => true,
    });

    expect(roles).toEqual(['finalReviewer']);
    expect(result.output).toMatchObject({ verdict: 'revise', worldFindings: ['晶屑不能带离铁门'] });
    expect(result.expandedReads).toEqual(['$TABLE:角色表']);
    expect(result.toolRounds).toBe(1);
    expect(result.readTokens).toBeGreaterThan(0);
    expect(result.iterations).toBe(2);
    const firstCall = calls[0].map(message => message.content).join('\n');
    const secondCall = calls[1].map(message => message.content).join('\n');
    expect(firstCall).toContain('晶屑不能带离铁门。');
    expect(firstCall).toContain('【读取预算状态】');
    expect(firstCall).toContain('工具轮次剩余 1 / 1');
    expect(secondCall).toContain('角色表');
    expect(secondCall).toContain('工具轮次剩余 0 / 1');
  });

  it('首轮注入读取预算状态，并随工具批次刷新剩余轮次与遥测', async () => {
    const input = input_ACU();
    input.settings.agentReadTokenBudget = 300;
    input.settings.agentReadFallbackTokens = 50;
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const replies = [readReply_ACU, finalReply_ACU];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return replies.shift() ?? finalReply_ACU;
      },
    });

    const result = await runtime.run(input);

    expect(result.expandedReads).toEqual(['$TABLE:角色表']);
    const firstCall = calls[0].map(message => message.content).join('\n');
    expect(firstCall).toContain('【读取预算状态】单批次读取上限约 300 tokens');
    expect(firstCall).toContain('不超过 50 tokens 的精读批次');
    expect(firstCall).toContain('工具轮次剩余 1 / 1');
    const secondCall = calls[1].map(message => message.content).join('\n');
    expect(secondCall).toContain('工具轮次剩余 0 / 1');
    expect(secondCall).toContain('仅遥测、不扣减后续批次额度');
  });

  it('终审 malformed tool batch 也走协议重试', async () => {
    const base = input_ACU();
    base.settings.finalReview = { enabled: true, readTokenBudget: '50%', maxExtraReads: 1 };
    const replies = [
      '{"action":"read"}',
      '{"action":"read","reads":["$TABLE:角色表"]}',
      JSON.stringify({ verdict: 'pass', summary: '通过', emotionFindings: [], worldFindings: [], logicFindings: [], requiredFixes: [], preserve: [] }),
    ];
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      resolveAgentApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => { calls.push(messages); return replies.shift() ?? null; },
    });

    const result = await runtime.runFinalReview({
      settings: base.settings,
      resolveContext: base.resolveContext,
      candidateInstruction: '观察门口。',
      currentUserInput: '观察门口。',
      createIdentity: (_name, attempt) => ({ taskId: 't', stageId: 's', turnId: 'u', attemptId: `final-${attempt}`, source: 'agent_subagent' }) as any,
      isCurrent: () => true,
    });

    expect(result.output.verdict).toBe('pass');
    expect(calls).toHaveLength(3);
    expect(calls[1].map(message => message.content).join('\n')).toContain('工具输出没有被采纳');
  });

  it('所有调用均报告字段时逐字段求和，并保留明确 0', async () => {
    const result = await runWithUsageSequence_ACU([
      { promptTokens: 10, completionTokens: 2, cachedTokens: 0, cacheWriteTokens: 3 },
      { promptTokens: 5, completionTokens: 4, cachedTokens: 7, cacheWriteTokens: 1 },
    ]);

    expect(result.attempts).toBe(2);
    expect(result.usage).toEqual({
      promptTokens: 15,
      completionTokens: 6,
      cachedTokens: 7,
      cacheWriteTokens: 4,
    });
  });

  it('任一次已观测调用缺字段时，该累计字段保持 undefined', async () => {
    const result = await runWithUsageSequence_ACU([
      { promptTokens: 10, cachedTokens: 2, cacheWriteTokens: 1 },
      { promptTokens: 5, completionTokens: 3, cacheWriteTokens: 4 },
    ]);

    expect(result.usage).toEqual({
      promptTokens: 15,
      completionTokens: undefined,
      cachedTokens: undefined,
      cacheWriteTokens: 5,
    });
  });

  it('全部调用都没有 usage 回调时保持 null', async () => {
    const result = await runWithUsageSequence_ACU([null, null]);

    expect(result.usage).toBeNull();
  });
});

describe('arc 派工的世界书目录浏览（上游 6aaa0a2 的 TT 子集）', () => {
  async function firstCallText_ACU(agentName: string): Promise<string> {
    const input = input_ACU();
    input.delegation = { agentName, prompt: '测试', reads: [] };
    input.resolveContext.worldbook = {
      available: true,
      entries: [{ bookName: '设定集', uid: '7', title: '晶屑设定', keys: ['晶屑'], constant: false, content: '黑色晶屑是禁区核心的碎片。', tokens: 18 }],
    } as any;
    if (agentName === 'arc-architect') {
      input.resolveContext.moduleSnapshot = {
        ...input.resolveContext.moduleSnapshot,
        storyArc: [{ id: 'ARC-STORY', scope: 'story', title: '全书', direction: '追查真相', escalation: '', withheld: '', status: 'active', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '' }],
      } as any;
    }
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => { calls.push(messages); return finalReply_ACU; },
    });
    await runtime.run(input);
    return calls[0].map(message => message.content).join('\n');
  }

  it('总纲代理的目录附浏览说明：自行按行尾地址 read，且不含条目全文', async () => {
    const text = await firstCallText_ACU('arc-architect');
    expect(text).toContain('这是全部已启用世界书条目的目录，不是命中清单');
    expect(text).toContain('$WORLDBOOK:设定集:7');
    // 目录与浏览说明都不注入全文：读取仍走 read 门禁预算。
    expect(text).not.toContain('黑色晶屑是禁区核心的碎片。');
  });

  it('其余子代理的目录保持普通清单口径，不带浏览说明', async () => {
    const text = await firstCallText_ACU('hook-cognition-maintainer');
    expect(text).not.toContain('这是全部已启用世界书条目的目录，不是命中清单');
    expect(text).toContain('已启用的世界书条目（共 1 条');
  });
});

describe('总纲空交付改要一条 SQL（上游 3c4beb9 的 TT 子集）', () => {
  it('总纲空交付后追加单条 SQL 的请求，不再索要 delta.storyArc 数组', async () => {
    const input = input_ACU();
    input.delegation = { agentName: 'arc-architect', prompt: '立总纲', reads: [] };
    input.writeSql = async () => ({
      status: 'committed', accepted: [], rejected: [], partials: [],
      revisions: input.resolveContext.moduleSnapshot.revisions, constraintProposals: [],
    }) as any;
    const messages: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async value => {
        messages.push(value);
        return messages.length === 1
          ? '{"summary":"资料已充分，直接交付总纲契约","delta":{}}'
          : JSON.stringify({ summary: '补写', sql: "INSERT INTO story_arc (id, scope, title, direction, escalation, withheld, status, expected_revision) VALUES ('STORY-01', 'story', '题', '方向', '台阶', '底牌', 'active', 0)" });
      },
    });
    const result = await runtime.run(input);
    const follow = messages[1].map(item => item.content).join('\n');
    expect(follow).toContain('新行 INSERT 的 expected_revision 固定写 0');
    expect(follow).toContain('story_arc 修订号');
    expect(follow).toContain('sustaining_threads');
    expect(follow).not.toContain('一次一个 id');
    expect(follow).not.toContain('必须在 delta.storyArc 里给出');
    expect(result.arc?.delta.storyArc.map(item => item.id)).toContain('STORY-01');
  });

  it('没有逐栏写端口的运行环境保留 delta.storyArc 旧弹回（双模兼容）', async () => {
    const input = input_ACU();
    input.delegation = { agentName: 'arc-architect', prompt: '立总纲', reads: [] };
    const messages: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async value => {
        messages.push(value);
        return '{"summary":"资料已充分，直接交付总纲契约","delta":{}}';
      },
    });
    await runtime.run(input);
    const follow = messages[1].map(item => item.content).join('\n');
    expect(follow).toContain('必须在 delta.storyArc 里给出');
  });
});

describe('TT 读取门禁保持（不移植上游依赖全文注入的 read 拒绝）', () => {
  it('子代理 read 世界书地址仍按读取门禁注入条目全文', async () => {
    const input = input_ACU();
    input.resolveContext.worldbook = {
      available: true,
      entries: [{ bookName: '设定集', uid: '7', title: '晶屑设定', keys: ['晶屑'], constant: false, content: '黑色晶屑是禁区核心的碎片。', tokens: 18 }],
    } as any;
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return calls.length === 1 ? '{"action":"read","reads":["$WORLDBOOK:设定集:7"]}' : finalReply_ACU;
      },
    });
    const result = await runtime.run(input);
    const toolText = calls[1].map(message => message.content).join('\n');
    expect(toolText).toContain('黑色晶屑是禁区核心的碎片。');
    expect(toolText).not.toContain('不要 read 世界书地址');
    expect(result.expandedReads).toContain('$WORLDBOOK:设定集:7');
  });
});

describe('契约解析被拒时改指 write_sql（上游 3c4beb9+56540c9 的 TT 子集）', () => {
  it('带写端口的角色输出非契约文本后，纠正提示指向一次 write_sql 批量提交', async () => {
    const input = input_ACU();
    input.delegation = { agentName: 'arc-architect', prompt: '立总纲', reads: [] };
    input.settings.internalAiRetryLimit = 2;
    input.resolveContext.moduleSnapshot = {
      ...input.resolveContext.moduleSnapshot,
      storyArc: [{ id: 'ARC-STORY', scope: 'story', title: '全书', direction: '追查真相', escalation: '', withheld: '', status: 'active', stageNumbers: [], completionStageNumber: null, completionState: '', continuationRationale: '', retired: false, retiredReason: '' }],
    } as any;
    input.writeSql = async () => ({
      status: 'committed', accepted: [], rejected: [], partials: [],
      revisions: input.resolveContext.moduleSnapshot.revisions, constraintProposals: [],
    }) as any;
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return calls.length === 1 ? '总纲我已经写好了，方向是追查真相。' : '{"summary":"资料已充分，交付","delta":{}}';
      },
    });
    await runtime.run(input);
    const repair = calls[1].map(message => message.content).join('\n');
    expect(repair).toContain('你上一次的输出没有被采纳');
    expect(repair).toContain('调用一次 write_sql，把全部语句放进同一个 sql 参数');
    expect(repair).toContain('新行 expected_revision 写 0');
    expect(repair).toContain('["条目"]');
  });

  it('只读角色被协议拒绝时仍是通用契约纠正，不指向 write_sql', async () => {
    const input = input_ACU();
    input.settings.internalAiRetryLimit = 2;
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async messages => {
        calls.push(messages);
        return calls.length === 1 ? '我先解释一下计划。' : finalReply_ACU;
      },
    });
    await runtime.run(input);
    const repair = calls[1].map(message => message.content).join('\n');
    expect(repair).toContain('请修正后重新输出符合契约的 JSON 对象');
    expect(repair).not.toContain('write_sql');
  });
});
