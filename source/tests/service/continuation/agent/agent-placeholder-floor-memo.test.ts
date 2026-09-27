/**
 * tests/service/continuation/agent/agent-placeholder-floor-memo.test.ts
 *
 * 性能优化第二批 · P0-6「提示词楼层提取 memo」判别测试。
 *
 * 三条红线：
 * 1. 一次渲染的逐楼文本提取次数必须从旧值降到新值（先量旧值再钉，见用例里的实测数字）；
 * 2. 记忆化冷/热两条路径与「朴素参考实现」的 $STORY_TEXT/$STORY_TAIL/$STORY_CATALOG/
 *    $STORY_RANGE 输出必须逐字节相同——提示词字节形态一个字都不许动；
 * 3. 失效路径必须钉住：mes 重赋值（编辑 / swipe / 重生成）、楼层增删、规则换血、
 *    楼层被整体换新（宿主重载聊天），任一发生都不得读到记忆化旧值。
 *
 * 记忆化键的不变式：mes 是字符串（不可变），重赋值必换引用；楼层对象被换新也换引用；
 * 聊天数组是原地 push/splice 的，所以正文楼层数组的记忆化另带一份逐楼校验指纹
 * （楼层对象引用 + mes 引用 + AI 楼判定），任一变化即整条作废。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  __readAgentPlaceholderResolverCountersForTests_ACU,
  __resetAgentPlaceholderResolverCachesForTests_ACU,
  listAgentStoryWindowFloors_ACU,
  renderAgentStoryCatalog_ACU,
  renderAgentStoryRange_ACU,
  renderAgentStoryTail_ACU,
  renderAgentStoryText_ACU,
  type AgentContextRules_ACU,
  type AgentStoryFloorSource_ACU,
} from '../../../../src/service/continuation/agent/agent-placeholder-resolver';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { applyContextTagFilters_ACU } from '../../../../src/service/runtime/helpers-context-tags';
import { isAiFloor_ACU } from '../../../../src/shared/ai-floor';

const RULES: AgentContextRules_ACU = {
  extractRules: [{ start: '<keep>', end: '</keep>' }],
  excludeRules: [{ start: '<drop>', end: '</drop>' }],
};
const OTHER_RULES: AgentContextRules_ACU = {
  extractRules: [{ start: '<kept>', end: '</kept>' }],
  excludeRules: [],
};
const FLOOR_COUNT = 60;

/** 交替用户/AI 楼，每层正文带标签，便于验证规则过滤与窗口语义。 */
function buildChat(): any[] {
  return Array.from({ length: FLOOR_COUNT }, (_, index) => (index % 2 === 0
    ? { mes: `用户楼层 ${index}`, is_user: true }
    : { mes: `<drop>噪声</drop><keep>AI 楼层 ${index} 正文</keep>`, is_user: false }));
}

function source(chat: any[], rules?: AgentContextRules_ACU): AgentStoryFloorSource_ACU {
  return { chat, contextRules: rules, storyWindowFloors: 8, storyTailFloors: 3 };
}

function resolveContext(chat: any[], rules?: AgentContextRules_ACU): any {
  return { ...source(chat, rules), moduleSnapshot: buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 5, execution: {}, originInstruction: '' };
}

// ── 朴素参考实现（优化前逐字照抄的语义，用来钉死等价） ────────────────────────

function naiveText(message: any, rules?: AgentContextRules_ACU): string {
  const raw = String(message?.mes ?? '').trim();
  if (!rules || (!rules.extractRules.length && !rules.excludeRules.length)) return raw;
  return applyContextTagFilters_ACU(raw, { extractTags: '', extractRules: rules.extractRules, excludeTags: '', excludeRules: rules.excludeRules }).trim();
}

function naiveFloors(chat: any[], rules?: AgentContextRules_ACU): Array<{ index: number; text: string }> {
  return chat
    .map((message, index) => ({ index, text: naiveText(message, rules) }))
    .filter(item => isAiFloor_ACU(chat[item.index]) && item.text);
}

function naiveWindow(chat: any[], rules: AgentContextRules_ACU | undefined, window = 8): Array<{ index: number; text: string }> {
  // 与 listAgentStoryWindowFloors_ACU 同口径：窗口 ≤ 0 直接空（注意 slice(-0) 是全量）。
  return window > 0 ? naiveFloors(chat, rules).slice(-window) : [];
}

function naiveOpening(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= 40 ? flat : `${flat.slice(0, 40)}…`;
}

function naiveTail(chat: any[], rules: AgentContextRules_ACU | undefined, window = 8, tailFloors = 3): string {
  const windowFloors = naiveWindow(chat, rules, window);
  if (!windowFloors.length) return '当前没有可注入的正文楼层（聊天里还没有 AI 正文，或可读窗口为 0）。';
  const tail = windowFloors.slice(-tailFloors);
  return `最近 ${tail.length} 楼全文（续写必须无缝衔接这里的结尾）：\n${tail.map(floor => `【楼层 ${floor.index}】\n${floor.text}`).join('\n\n')}`;
}

function naiveCatalog(chat: any[], rules: AgentContextRules_ACU | undefined, window = 8): string {
  const allFloors = naiveFloors(chat, rules);
  if (!allFloors.length) return '当前聊天还没有 AI 产出的正文楼层。';
  const windowFloors = naiveWindow(chat, rules, window);
  if (!windowFloors.length) return '正文可读窗口设置为 0 楼：正文楼层不可直接读取；剧情脉络请依靠事件概览与 $TABLE:纪要表。';
  const hidden = allFloors.length - windowFloors.length;
  const headNote = hidden > 0
    ? `更早的 ${hidden} 个 AI 楼层不在可读窗口内；其剧情脉络请查看事件概览，或用 $TABLE:纪要表:行区间 精读对应纪要。`
    : '当前全部 AI 楼层都在可读窗口内。';
  const lines = windowFloors.map(floor => `- 楼层 ${floor.index}｜约 ${floor.text.length} 字｜开头：${naiveOpening(floor.text)}｜读取地址 $STORY_RANGE:${floor.index}-${floor.index}`);
  return [
    `${headNote}\n可读窗口内的楼层索引（区间读取写 $STORY_RANGE:起始楼-结束楼；按内容找楼层用 search story）：`,
    lines.join('\n'),
    '注意：事件概览按剧情轮记录，与楼层号无一一映射；需要精确正文时按本索引区间读取。',
  ].join('\n');
}

function naiveRange(chat: any[], rules: AgentContextRules_ACU | undefined, start: number, end: number, window = 8): string {
  const windowFloors = naiveWindow(chat, rules, window);
  if (!windowFloors.length) return '正文可读窗口当前为空，无法读取正文；早期剧情脉络请查看事件概览或用 $TABLE:纪要表:行区间 精读。';
  const hit = windowFloors.filter(floor => floor.index >= start && floor.index <= end);
  if (!hit.length) {
    const first = windowFloors[0].index;
    const last = windowFloors[windowFloors.length - 1].index;
    return `区间 ${start}-${end} 内没有可读的 AI 楼层。可读窗口目前覆盖楼层 ${first}-${last}（只含 AI 楼）；更早的剧情脉络请查看事件概览或用 $TABLE:纪要表:行区间 精读。`;
  }
  return hit.map(floor => `【楼层 ${floor.index}】\n${floor.text}`).join('\n\n');
}

// ── 判别测试 ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  __resetAgentPlaceholderResolverCachesForTests_ACU();
});

describe('P0-6 楼层提取记忆化：开销', () => {
  it('一次渲染的逐楼文本提取次数 300→30（冷）→0（热）', () => {
    const chat = buildChat();
    // 旧实现实测（同 fixture、同一轮渲染）：5 趟全聊天枚举 × 60 楼 = 300 次规则扫描。
    renderEverything(chat, RULES);
    const cold = __readAgentPlaceholderResolverCountersForTests_ACU();
    expect(cold.textExtractions).toBe(FLOOR_COUNT / 2);
    expect(cold.floorListRebuilds).toBe(1);

    renderEverything(chat, RULES);
    const hot = __readAgentPlaceholderResolverCountersForTests_ACU();
    // 热路径：零次规则扫描，五次正文枚举全部命中记忆化。
    expect(hot.textExtractions).toBe(FLOOR_COUNT / 2);
    expect(hot.floorListRebuilds).toBe(1);
    expect(hot.floorListHits - cold.floorListHits).toBe(5);
  });

  it('追加一层楼只重算新增楼层，既有楼层不重跑规则', () => {
    const chat = buildChat();
    renderEverything(chat, RULES);
    const before = __readAgentPlaceholderResolverCountersForTests_ACU();
    chat.push({ mes: '<keep>新 AI 楼层</keep>', is_user: false });
    renderEverything(chat, RULES);
    const after = __readAgentPlaceholderResolverCountersForTests_ACU();
    expect(after.textExtractions - before.textExtractions).toBe(1);
    expect(after.floorListRebuilds - before.floorListRebuilds).toBe(1);
  });
});

describe('P0-6 楼层提取记忆化：输出等价（提示词字节形态）', () => {
  it('冷/热两次渲染与朴素参考实现逐字相同', () => {
    const chat = buildChat();
    __resetAgentPlaceholderResolverCachesForTests_ACU();
    const cold = renderEverything(chat, RULES);
    const hot = renderEverything(chat, RULES);
    const naive = {
      text: naiveStoryText(chat),
      tail: naiveTail(chat, RULES, 8, 3),
      catalog: naiveCatalog(chat, RULES, 8),
      range: naiveRange(chat, RULES, 40, 50),
    };
    expect(cold).toEqual(hot);
    expect(cold).toEqual(naive);
    // 窗口切片语义（起点/是否含 AI 楼/文本裁剪）逐条钉住。
    expect(listAgentStoryWindowFloors_ACU(source(chat, RULES))).toEqual(naiveWindow(chat, RULES));
  });

  it('无规则、窗口为 0、空聊天、含工具楼与隐藏楼时同样逐字相同', () => {
    const cases: Array<{ chat: any[]; rules?: AgentContextRules_ACU; window: number; tail: number }> = [
      { chat: buildChat(), window: 8, tail: 3 },
      { chat: buildChat(), rules: OTHER_RULES, window: 8, tail: 3 },
      { chat: buildChat(), rules: RULES, window: 1, tail: 9 },
      { chat: buildChat(), rules: RULES, window: 0, tail: 3 },
      { chat: [], rules: RULES, window: 8, tail: 3 },
      { chat: [{ mes: '只有用户楼', is_user: true }], rules: RULES, window: 8, tail: 3 },
      { chat: [
        { mes: 'AI 正文', is_user: false },
        { mes: '工具结果', is_user: false, role: 'tool', is_system: true },
        { mes: '隐藏楼', is_user: false, is_system: true },
        { mes: '   ', is_user: false },
        { mes: '<keep>只剩标签内容</keep>', is_user: false },
      ], rules: RULES, window: 8, tail: 3 },
    ];
    for (const item of cases) {
      __resetAgentPlaceholderResolverCachesForTests_ACU();
      const cold = renderEverything(item.chat, item.rules, item.window, item.tail);
      const hot = renderEverything(item.chat, item.rules, item.window, item.tail);
      expect(cold).toEqual(hot);
      expect(cold.tail).toBe(naiveTail(item.chat, item.rules, item.window, item.tail));
      expect(cold.catalog).toBe(naiveCatalog(item.chat, item.rules, item.window));
      expect(cold.range).toBe(naiveRange(item.chat, item.rules, 40, 50, item.window));
    }
  });
});

describe('P0-6 楼层提取记忆化：失效路径', () => {
  it('mes 重赋值（编辑 / swipe / 重生成）后必须读到新文本', () => {
    const chat = buildChat();
    renderEverything(chat, RULES);
    // 编辑正文（45 楼落在 $STORY_RANGE:40-50 区间内）
    chat[45].mes = '<keep>被编辑过的正文</keep>';
    expect(renderEverything(chat, RULES).range).toContain('被编辑过的正文');
    // swipe 切走再切回：宿主换的是另一个字符串
    chat[45].mes = '<keep>另一 swipe 的正文</keep>';
    expect(renderEverything(chat, RULES).range).toBe(naiveRange(chat, RULES, 40, 50));
    // 原地赋值成等值字符串不算变更（字符串按值判定）
    const same = chat[45].mes;
    chat[45].mes = `${same}`;
    expect(renderEverything(chat, RULES).range).toBe(naiveRange(chat, RULES, 40, 50));
  });

  it('删楼 / 中间插楼 / 楼层整体换新后楼层清单与窗口都跟着变', () => {
    const chat = buildChat();
    renderEverything(chat, RULES);
    const before = listAgentStoryWindowFloors_ACU(source(chat, RULES));
    chat.splice(3, 1);
    expect(listAgentStoryWindowFloors_ACU(source(chat, RULES))).toEqual(naiveWindow(chat, RULES));
    expect(listAgentStoryWindowFloors_ACU(source(chat, RULES)).length).toBe(before.length);
    chat.splice(10, 0, { mes: '<keep>插入的 AI 楼</keep>', is_user: false });
    expect(listAgentStoryWindowFloors_ACU(source(chat, RULES))).toEqual(naiveWindow(chat, RULES));
    // 楼层对象整体换新（宿主重载聊天 / 撤销恢复）
    chat[5] = { ...chat[5], mes: '<keep>换新的楼层对象</keep>' };
    expect(listAgentStoryWindowFloors_ACU(source(chat, RULES))).toEqual(naiveWindow(chat, RULES));
    // 用户楼/隐藏楼身份位原地变化也必须立刻生效（校验指纹含 AI 楼判定）
    chat[7].is_user = true;
    expect(listAgentStoryWindowFloors_ACU(source(chat, RULES))).toEqual(naiveWindow(chat, RULES));
  });

  it('换一套上下文规则不得串味', () => {
    const chat = buildChat();
    renderEverything(chat, RULES);
    const other = renderEverything(chat, OTHER_RULES);
    expect(other.range).toBe(naiveRange(chat, OTHER_RULES, 40, 50));
    expect(renderEverything(chat, RULES).range).toBe(naiveRange(chat, RULES, 40, 50));
    // 规则数组被原地改内容同样不得串味
    RULES.excludeRules.push({ start: '<x>', end: '</x>' });
    expect(renderEverything(chat, RULES).range).toBe(naiveRange(chat, RULES, 40, 50));
    RULES.excludeRules.pop();
  });
});

describe('P0-6 开头摘要有界扫描：与朴素压平逐字等价', () => {
  it('长正文的目录摘要只看开头几十码元（全文长度→41 码元/层）', () => {
    const long = '甲'.repeat(4000);
    const chat = [
      { mes: long, is_user: false },
      { mes: `尾部正文${long}`, is_user: false },
    ];
    __resetAgentPlaceholderResolverCachesForTests_ACU();
    renderAgentStoryCatalog_ACU({ chat, contextRules: undefined, storyWindowFloors: 8, storyTailFloors: 3 });
    const counters = __readAgentPlaceholderResolverCountersForTests_ACU();
    // 朴素压平：两层共 8000+ 码元；有界扫描：每层产出 41 码元即停。
    expect(counters.openingScanChars).toBe(82);
    expect(counters.openingScanChars).toBeLessThan(long.length);
  });

  it('对抗性样本逐条等价', () => {
    const samples = [
      '',
      ' ',
      '\n\n\t',
      '短文本',
      'x'.repeat(39),
      'x'.repeat(40),
      'x'.repeat(41),
      '  前导空白' + 'y'.repeat(60),
      '尾部空白'.repeat(20) + '   ',
      `a${' '.repeat(500)}b`,
      `${' '.repeat(500)}a`,
      `a${' '.repeat(500)}`,
      `a${'\u00a0'.repeat(300)}b${'z'.repeat(60)}`,
      `a${'\u3000'.repeat(300)}b`,
      `a${'\n'.repeat(300)}b`,
      `a${'\r\n'.repeat(300)}b`,
      `a${'\t\v\f'.repeat(300)}b`,
      `a${'\u2028\u2029'.repeat(300)}b`,
      `中文${' '.repeat(80)}结尾`,
      '😀'.repeat(60),
      `😀${' '.repeat(80)}尾`,
      'a b  c   d    e',
      '   x',
      `${'x'.repeat(39)} ${'y'.repeat(10)}`,
      `${'x'.repeat(40)} ${'y'.repeat(10)}`,
      `${'x'.repeat(41)}`,
    ];
    for (const sample of samples) {
      const chat = [{ mes: sample, is_user: false }];
      expect(renderCatalogOpening(chat)).toBe(naiveOpening(naiveText(chat[0], undefined)));
    }
  });

  it('确定性模糊测试：2000 条随机串与朴素压平逐字相等', () => {
    let seed = 20260927;
    const nextInt = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % bound;
    };
    const alphabet = ['a', 'b', '中', '😀', ' ', '  ', '\n', '\t', '\u00a0', '\u3000', '\r\n', '\u2028'];
    for (let round = 0; round < 2000; round += 1) {
      let text = '';
      const parts = 1 + nextInt(30);
      for (let part = 0; part < parts; part += 1) text += alphabet[nextInt(alphabet.length)];
      const chat = [{ mes: text, is_user: false }];
      expect(renderCatalogOpening(chat)).toBe(naiveOpening(naiveText(chat[0], undefined)));
    }
  });
});

function renderCatalogOpening(chat: any[]): string {
  const line = renderAgentStoryCatalog_ACU({ chat, contextRules: undefined, storyWindowFloors: 8, storyTailFloors: 3 })
    .split('\n')
    .find(item => item.startsWith('- 楼层 '));
  return (line ?? '').split('｜开头：')[1]?.split('｜读取地址')[0] ?? '';
}

function renderEverything(chat: any[], rules: AgentContextRules_ACU | undefined, window = 8, tail = 3): { text: string; tail: string; catalog: string; range: string } {
  const base = source(chat, rules);
  base.storyWindowFloors = window;
  base.storyTailFloors = tail;
  const context = resolveContext(chat, rules);
  context.storyWindowFloors = window;
  context.storyTailFloors = tail;
  return {
    text: renderAgentStoryText_ACU(context),
    tail: renderAgentStoryTail_ACU(base),
    catalog: renderAgentStoryCatalog_ACU(base),
    range: renderAgentStoryRange_ACU(context, '40', '50'),
  };
}

function naiveStoryText(chat: any[]): string {
  const highest = chat.length - 1;
  if (highest < 0) return '当前聊天还没有任何楼层，也就没有已经发生的正文。';
  const settledThrough = Math.min(5, highest);
  const floors = naiveFloors(chat, RULES);
  if (!floors.length) return '当前聊天还没有 AI 产出的正文楼层。';
  const window = 8;
  const settled = floors.filter(item => item.index <= settledThrough);
  const unsettled = floors.filter(item => item.index > settledThrough);
  const shownSettled = window > 0 ? settled.slice(-window) : [];
  const hiddenSettled = settled.length - shownSettled.length;
  const render = (items: Array<{ index: number; text: string }>) => items.map(item => `【楼层 ${item.index}】\n${item.text}`).join('\n\n');
  const sections: string[] = [];
  const settledHead = hiddenSettled > 0
    ? `## 已结算正文（只列最近 ${shownSettled.length} 楼；更早的 ${hiddenSettled} 楼未注入，其事实已沉淀进资料模块与纪要，需要时派工读取）`
    : '## 已结算正文';
  if (shownSettled.length) sections.push(`${settledHead}\n${render(shownSettled)}`);
  else if (settled.length) sections.push(`${settledHead}\n（本次未注入任何已结算正文。）`);
  sections.push(unsettled.length
    ? `## 尚未结算的最新正文（全量）\n${render(unsettled)}`
    : '## 尚未结算的最新正文\n没有尚未结算的正文楼层；上一轮已结算到当前最后一楼。');
  return sections.join('\n\n');
}
