import { describe, expect, it } from 'vitest';

import { createAgentMatchSnippet_ACU, runAgentSearch_ACU } from '../../../../src/service/continuation/agent/agent-search';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import type { AgentResolveContext_ACU } from '../../../../src/service/continuation/agent/agent-placeholder-resolver';
import type { AgentSearchCall_ACU } from '../../../../src/service/continuation/agent/agent-model';

function context_ACU(): AgentResolveContext_ACU {
  const moduleSnapshot = buildEmptyAgentModuleSnapshot_ACU();
  moduleSnapshot.hooks = [
    { id: 'H1', summary: '守门人手中的黑色晶屑', status: 'planted', importance: 'high', plantedIndex: 3, plannedPayoff: '', retired: false } as any,
    { id: 'H2', summary: '铁门后的低语', status: 'planted', importance: 'mid', plantedIndex: 1, plannedPayoff: '', retired: true } as any,
  ];
  return {
    chat: [
      { mes: '我要进禁区', is_user: true },
      { mes: '主角推开铁门，黑色晶屑散落一地。' },
      { mes: '守门人挡在门后。\n他右手攥着黑色晶屑。' },
    ],
    moduleSnapshot,
    settledThroughIndex: 0,
    execution: {
      envelope: {} as any,
      task: { taskId: 't', originInstruction: '推进剧情' } as any,
      stage: { stageNumber: 1 } as any,
      revision: { outline: { title: '禁区试探', goal: '摸清晶屑来历', totalTurns: 4, nodes: [{ id: 'node-1', title: '试探', goal: '不揭穿', turns: [{ id: 'turn-1', goal: '观察黑色晶屑的反应' }] }] } } as any,
      node: null,
      turn: null,
      turnNumber: null,
      nodeTurnNumber: null,
    } as any,
    originInstruction: '推进剧情',
    recentTurnCount: 2,
    storyWindowFloors: 10,
    tableData: { s1: { name: '角色表', content: [['姓名', '状态'], ['林瑶', '右臂有伤，随身带黑色晶屑']] } },
    worldbook: {
      available: true,
      entries: [{ bookName: '设定集', uid: '7', title: '晶屑设定', keys: ['晶屑'], constant: false, content: '黑色晶屑是禁区核心的碎片。\n接触过久会侵蚀心智。', tokens: 20 }],
    },
  };
}

function call_ACU(overrides: Partial<AgentSearchCall_ACU> = {}): AgentSearchCall_ACU {
  return { kind: 'search', query: '黑色晶屑', scope: ['story', 'tables', 'modules', 'outline', 'worldbook'], isRegex: false, maxResults: 20, ...overrides };
}

describe('五域搜索', () => {
  it('每条命中附带可直接复制进 read 的读取地址', () => {
    const result = runAgentSearch_ACU(call_ACU(), context_ACU());
    expect(result).toContain('读取地址 $STORY_RANGE:1-1');
    expect(result).toContain('读取地址 $STORY_RANGE:2-2');
    expect(result).toContain('读取地址 $TABLE:角色表:1-1');
    expect(result).toContain('读取地址 $HOOKS_LEDGER:H1');
    expect(result).toContain('读取地址 $OUTLINE_WINDOW');
    expect(result).toContain('读取地址 $WORLDBOOK:设定集:7');
    // 用户楼层不是正文，不进搜索。
    expect(result).not.toContain('我要进禁区');
  });

  it('退休模块条目也可被搜到并标注状态', () => {
    const result = runAgentSearch_ACU(call_ACU({ query: '低语', scope: ['modules'] }), context_ACU());
    expect(result).toContain('[H2]（已退休）');
    expect(result).toContain('$HOOKS_LEDGER:H2');
  });

  it('正文只搜可读窗口内的楼层，窗口外不命中', () => {
    const context = { ...context_ACU(), storyWindowFloors: 1 };
    const result = runAgentSearch_ACU(call_ACU({ scope: ['story'] }), context);
    expect(result).toContain('$STORY_RANGE:2-2');
    expect(result).not.toContain('$STORY_RANGE:1-1');
  });

  it('默认按字面关键词匹配（正则元字符被转义），isRegex 打开后按正则', () => {
    const literal = runAgentSearch_ACU(call_ACU({ query: '晶屑.', scope: ['story'] }), context_ACU());
    expect(literal).toContain('没有命中');
    const regex = runAgentSearch_ACU(call_ACU({ query: '晶屑.', scope: ['story'], isRegex: true }), context_ACU());
    expect(regex).toContain('命中');
  });

  it('非法正则返回可修正的编译失败说明而不是抛错', () => {
    const result = runAgentSearch_ACU(call_ACU({ query: '([未闭合', isRegex: true }), context_ACU());
    expect(result).toContain('编译失败');
    expect(result).toContain('去掉 isRegex');
  });

  it('无命中时给出可执行的调整建议', () => {
    const result = runAgentSearch_ACU(call_ACU({ query: '不存在的词汇' }), context_ACU());
    expect(result).toContain('没有命中');
    // 无命中指引：更早剧情走事件概览与纪要表行区间，不再有独立的纪要域。
    expect(result).toContain('事件概览');
    expect(result).toContain('$TABLE:纪要表');
  });

  it('达到条数上限时停止收集并如实标注截断', () => {
    const result = runAgentSearch_ACU(call_ACU({ maxResults: 2 }), context_ACU());
    expect(result).toContain('命中 2 处');
    expect(result).toContain('结果已截断');
  });
});

describe('命中行片段截断', () => {
  it('短行原样返回，长行以匹配词居中开窗并加省略号', () => {
    expect(createAgentMatchSnippet_ACU('短行', 0, 2)).toBe('短行');
    const long = `${'前'.repeat(200)}关键词${'后'.repeat(200)}`;
    const snippet = createAgentMatchSnippet_ACU(long, 200, 3, 100);
    expect(snippet.length).toBeLessThanOrEqual(102);
    expect(snippet).toContain('关键词');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });
});
