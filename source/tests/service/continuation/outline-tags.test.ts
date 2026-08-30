import { describe, expect, it } from 'vitest';
import { ContinuationValidationError_ACU, type StageOutline_ACU } from '../../../src/service/continuation/model';
import { buildStageOutlineFromTags_ACU, parseOutlineTags_ACU, spliceOutlineWithCompletedPrefix_ACU } from '../../../src/service/continuation/outline-tags';

function allocator_ACU() {
  let counter = 0;
  return (prefix: string) => `${prefix}-${++counter}`;
}

function tagText_ACU(): string {
  return [
    '<stage_title>初入江南</stage_title>',
    '<stage_goal>接管鬼船案调查权</stage_goal>',
    '<stage_tempo>buildup</stage_tempo>',
    '<node>',
    '<node_title>抵达江南府</node_title>',
    '<node_goal>宣示接管权力</node_goal>',
    '<turn pacing="setup">钦差抵达，宣读圣旨</turn>',
    '</node>',
    '<node>',
    '<node_title>现场勘验</node_title>',
    '<node_goal>寻找关键物证</node_goal>',
    '<turn pacing="pressure">登船勘验，发现符箓气息</turn>',
    '<turn>义庄闹鬼，稳住仵作问话</turn>',
    '</node>',
  ].join('\n');
}

function previousOutline_ACU(): StageOutline_ACU {
  return {
    schemaVersion: 1,
    title: '旧阶段标题',
    goal: '旧阶段目标',
    tempo: 'aftermath',
    totalTurns: 4,
    nodes: [
      { id: 'node-a', title: '节点A', goal: '目标A', suggestedTurns: 3, turns: [{ id: 'turn-a1', goal: '轮A1', pacing: 'setup' as const }, { id: 'turn-a2', goal: '轮A2', pacing: 'pressure' as const }, { id: 'turn-a3', goal: '轮A3', pacing: 'cooldown' as const }] },
      { id: 'node-b', title: '节点B', goal: '目标B', suggestedTurns: 1, turns: [{ id: 'turn-b1', goal: '轮B1', pacing: 'pressure' as const }] },
    ],
  };
}

async function expectParseFailure_ACU(raw: string, fragment: string) {
  try {
    parseOutlineTags_ACU(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(ContinuationValidationError_ACU);
    const validation = error as ContinuationValidationError_ACU;
    expect(validation.error.code).toBe('CONTINUATION_OUTLINE_JSON_INVALID');
    expect(validation.error.phase).toBe('outline_parse');
    expect(validation.error.retryable).toBe(true);
    expect(validation.error.message).toContain(fragment);
    return;
  }
  throw new Error('Expected parse failure');
}

describe('parseOutlineTags_ACU', () => {
  it('extracts stage, nodes and turns from clean tag output', () => {
    const parsed = parseOutlineTags_ACU(tagText_ACU());
    expect(parsed.title).toBe('初入江南');
    expect(parsed.goal).toBe('接管鬼船案调查权');
    expect(parsed.tempo).toBe('buildup');
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0]).toMatchObject({ title: '抵达江南府', goal: '宣示接管权力', turns: [{ goal: '钦差抵达，宣读圣旨', pacing: 'setup' }] });
    // 第二轮没写 pacing：缺属性回落 pressure，与 schema 的默认值口径一致。
    expect(parsed.nodes[1].turns).toEqual([
      { goal: '登船勘验，发现符箓气息', pacing: 'pressure' },
      { goal: '义庄闹鬼，稳住仵作问话', pacing: 'pressure' },
    ]);
  });

  it('解析 pacing 属性：合法值原样保留，非法值与缺失都回落 pressure', () => {
    const raw = [
      '<node>',
      '<node_title>节点</node_title>',
      '<node_goal>目标</node_goal>',
      '<turn pacing="cooldown">余波</turn>',
      "<turn pacing='turn'>反转</turn>",
      '<turn pacing="fast">非法值</turn>',
      '<turn>没写</turn>',
      '</node>',
    ].join('\n');
    expect(parseOutlineTags_ACU(raw).nodes[0].turns).toEqual([
      { goal: '余波', pacing: 'cooldown' },
      { goal: '反转', pacing: 'turn' },
      { goal: '非法值', pacing: 'pressure' },
      { goal: '没写', pacing: 'pressure' },
    ]);
  });

  it('解析 stage_tempo：合法值原样保留，非法值与缺失都留空交给构建层回落', () => {
    const body = '<node><node_goal>目标</node_goal><turn>一轮</turn></node>';
    expect(parseOutlineTags_ACU(`<stage_tempo>SURGE</stage_tempo>${body}`).tempo).toBe('surge');
    expect(parseOutlineTags_ACU(`<stage_tempo>激烈</stage_tempo>${body}`).tempo).toBeNull();
    expect(parseOutlineTags_ACU(body).tempo).toBeNull();
  });

  it('带属性的 node 正则不会吃掉 node_title', () => {
    const raw = '<node data-x="1"><node_title>真标题</node_title><node_goal>目标</node_goal><turn>一轮</turn></node>';
    const parsed = parseOutlineTags_ACU(raw);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].title).toBe('真标题');
    expect(parsed.nodes[0].goal).toBe('目标');
  });

  it('ignores prose, markdown fences and stray JSON around the tags', () => {
    const noisy = `先梳理一下思路：{"draft": true} 前半段做铺垫。\n\n\`\`\`xml\n${tagText_ACU()}\n\`\`\`\n\n以上就是我的规划说明。`;
    const parsed = parseOutlineTags_ACU(noisy);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[1].turns).toHaveLength(2);
  });

  it('tolerates uppercase tags and surrounding whitespace inside tags', () => {
    const upper = '<STAGE_TITLE>  标题  </STAGE_TITLE><NODE><NODE_GOAL>目标</NODE_GOAL><TURN>  第一轮  </TURN></NODE>';
    const parsed = parseOutlineTags_ACU(upper);
    expect(parsed.title).toBe('标题');
    expect(parsed.nodes[0].goal).toBe('目标');
    expect(parsed.nodes[0].turns).toEqual([{ goal: '第一轮', pacing: 'pressure' }]);
  });

  it('fails with a raw snippet when no node tag exists', async () => {
    await expectParseFailure_ACU('这是一段没有任何标签的散文，模型忘记了输出格式。', '模型返回片段：这是一段没有任何标签的散文');
    await expectParseFailure_ACU('', '大纲返回为空');
  });

  it('fails when a node has no non-empty turn', async () => {
    await expectParseFailure_ACU('<node><node_goal>目标</node_goal><turn>   </turn></node>', '没有任何非空 <turn>');
  });
});

describe('buildStageOutlineFromTags_ACU', () => {
  it('generates ids and derives all counts at runtime', () => {
    const outline = buildStageOutlineFromTags_ACU(parseOutlineTags_ACU(tagText_ACU()), allocator_ACU());
    expect(outline.schemaVersion).toBe(1);
    expect(outline.totalTurns).toBe(3);
    expect(outline.nodes.map(node => node.id)).toEqual(['node-1', 'node-3']);
    expect(outline.nodes[0]).toMatchObject({ suggestedTurns: 1 });
    expect(outline.nodes[1]).toMatchObject({ suggestedTurns: 2 });
    expect(outline.nodes[1].turns.map(turn => turn.id)).toEqual(['turn-4', 'turn-5']);
  });

  it('falls back to positional node titles and previous stage title/goal', () => {
    const parsed = parseOutlineTags_ACU('<node><node_goal>目标</node_goal><turn>第一轮</turn></node>');
    const outline = buildStageOutlineFromTags_ACU(parsed, allocator_ACU(), { title: '沿用标题', goal: '沿用目标', tempo: 'surge' });
    expect(outline.title).toBe('沿用标题');
    expect(outline.goal).toBe('沿用目标');
    // 重规划时模型可以不重述形态，此时沿用旧大纲的；没有旧大纲可沿用才落 mixed。
    expect(outline.tempo).toBe('surge');
    expect(outline.nodes[0].title).toBe('节点1');
    expect(buildStageOutlineFromTags_ACU(parsed, allocator_ACU()).tempo).toBe('mixed');
  });

  it('模型写了形态就以模型的为准，不被旧大纲的形态覆盖', () => {
    const parsed = parseOutlineTags_ACU('<stage_tempo>aftermath</stage_tempo><node><node_goal>目标</node_goal><turn>第一轮</turn></node>');
    expect(buildStageOutlineFromTags_ACU(parsed, allocator_ACU(), { tempo: 'surge' }).tempo).toBe('aftermath');
  });
});

describe('spliceOutlineWithCompletedPrefix_ACU', () => {
  it('keeps completed prefix ids verbatim and appends the newly planned nodes', () => {
    const planned = buildStageOutlineFromTags_ACU(parseOutlineTags_ACU(tagText_ACU()), allocator_ACU());
    const spliced = spliceOutlineWithCompletedPrefix_ACU(previousOutline_ACU(), 2, planned);
    expect(spliced.nodes).toHaveLength(3);
    expect(spliced.nodes[0]).toMatchObject({ id: 'node-a', suggestedTurns: 2 });
    expect(spliced.nodes[0].turns.map(turn => turn.id)).toEqual(['turn-a1', 'turn-a2']);
    // 已完成前缀的节奏标签必须原样带过来，否则重规划会把历史轮次全部当成 pressure。
    expect(spliced.nodes[0].turns.map(turn => turn.pacing)).toEqual(['setup', 'pressure']);
    expect(spliced.nodes[1].id).toBe('node-1');
    expect(spliced.totalTurns).toBe(5);
    expect(spliced.title).toBe('初入江南');
    // 形态属于本次规划的决定，拼接后取新大纲的而不是旧的。
    expect(spliced.tempo).toBe('buildup');
  });

  it('keeps previous stage title and goal when the replan omits them', () => {
    const planned = buildStageOutlineFromTags_ACU(parseOutlineTags_ACU('<node><node_goal>目标</node_goal><turn>新的一轮</turn></node>'), allocator_ACU());
    const spliced = spliceOutlineWithCompletedPrefix_ACU(previousOutline_ACU(), 4, planned);
    expect(spliced.title).toBe('旧阶段标题');
    expect(spliced.goal).toBe('旧阶段目标');
    expect(spliced.nodes).toHaveLength(3);
    expect(spliced.nodes[1]).toMatchObject({ id: 'node-b', suggestedTurns: 1 });
    expect(spliced.totalTurns).toBe(5);
  });

  it('returns the planned outline unchanged when nothing is completed', () => {
    const planned = buildStageOutlineFromTags_ACU(parseOutlineTags_ACU(tagText_ACU()), allocator_ACU());
    expect(spliceOutlineWithCompletedPrefix_ACU(previousOutline_ACU(), 0, planned)).toBe(planned);
  });
});
