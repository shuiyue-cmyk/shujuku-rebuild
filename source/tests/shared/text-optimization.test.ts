/**
 * tests/shared/text-optimization.test.ts
 * 正文优化纯逻辑函数 单元测试
 */
import { describe, it, expect, vi } from 'vitest';

// mock 日志函数
vi.mock('../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  // 与 shared/utils 真实实现同语义：数组规则（对象/竖线字符串）+ 旧标签字符串回退
  normalizeExcludeRules_ACU: (rulesInput: any, legacyTags = '') => {
    const normalized: Array<{ start: string; end: string }> = [];
    const seen = new Set<string>();
    const pushRule = (startRaw: any, endRaw: any) => {
      const start = String(startRaw || '').trim();
      const end = String(endRaw || '').trim();
      if (!start || !end) return;
      const key = start + '\u0000' + end;
      if (seen.has(key)) return;
      seen.add(key);
      normalized.push({ start, end });
    };
    if (Array.isArray(rulesInput)) {
      rulesInput.forEach((rule: any) => {
        if (!rule) return;
        if (typeof rule === 'string') {
          const parts = rule.split('|');
          if (parts.length >= 2) {
            const start = parts.shift();
            pushRule(start, parts.join('|'));
          }
          return;
        }
        pushRule(rule.start ?? rule.begin ?? rule.open, rule.end ?? rule.close ?? rule.finish);
      });
    }
    if (normalized.length === 0 && legacyTags) {
      String(legacyTags)
        .split(/[,\uFF0C\s]+/g)
        .map((t: string) => t.trim())
        .filter(Boolean)
        .forEach((t: string) => {
          const tag = t.replace(/[<>]/g, '');
          pushRule('<' + tag, '</' + tag + '>');
        });
    }
    return normalized;
  },
}));

import {
  removePunctuation_ACU,
  mapCleanPositionToOriginal_ACU,
  findParagraphMatch_ACU,
  trimPunctuation_ACU,
  applyOptimizations_ACU,
  applyOptimizationsWithStats_ACU,
  filterOptimizationsByExcludeRules_ACU,
  collectOptimizationExcludeRanges_ACU,
  stripMvuUpdateBlocks_ACU,
} from '../../src/shared/text-optimization';

// ═══════════════════════════════════════════════════════════════
// removePunctuation_ACU
// ═══════════════════════════════════════════════════════════════
describe('removePunctuation_ACU', () => {

  it('保留中文字符', () => {
    expect(removePunctuation_ACU('测试文本')).toBe('测试文本');
  });

  it('保留英文和数字', () => {
    expect(removePunctuation_ACU('abc123')).toBe('abc123');
  });
});

// ═══════════════════════════════════════════════════════════════
// mapCleanPositionToOriginal_ACU
// ═══════════════════════════════════════════════════════════════
describe('mapCleanPositionToOriginal_ACU', () => {

  it('含标点的文本正确映射', () => {
    // "你，好" → clean: "你好"
    // clean[0] = '你' → original[0]
    // clean[1] = '好' → original[2]
    const result = mapCleanPositionToOriginal_ACU('你，好', 0, 2);
    expect(result.start).toBe(0);
    expect(result.end).toBe(3);
  });

  it('起始位置在标点之后', () => {
    // "，你好" → clean: "你好"
    // clean[0] = '你' → original[1]
    const result = mapCleanPositionToOriginal_ACU('，你好', 0, 1);
    expect(result.start).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// findParagraphMatch_ACU
// ═══════════════════════════════════════════════════════════════
describe('findParagraphMatch_ACU', () => {

  it('短文本（<10字符去标点后）返回 -1', () => {
    const result = findParagraphMatch_ACU('短', '这是一段包含短的文本');
    // 精确匹配会成功
    expect(result.start).not.toBe(-1);
  });
  // NOTE(test-audit 2026-09-29)：此处曾有一条「标点不同但内容相同时模糊匹配」，
  // 仅含条件断言（可能不执行）与恒真断言（typeof 必为 number），任何阈值调整都绿，
  // 按 junk patterns 整条删除；模糊阈值的真实交付由精确/不匹配用例与写回保护覆盖。
});

// ═══════════════════════════════════════════════════════════════
// trimPunctuation_ACU
// ═══════════════════════════════════════════════════════════════
describe('trimPunctuation_ACU', () => {

  it('无标点时原样返回', () => {
    const result = trimPunctuation_ACU('你好');
    expect(result.trimmed).toBe('你好');
    expect(result.prefix).toBe('');
    expect(result.suffix).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// applyOptimizations_ACU
// ═══════════════════════════════════════════════════════════════
describe('applyOptimizations_ACU', () => {
  it('精确替换成功', () => {
    const result = applyOptimizations_ACU('你好世界', [
      { type: 'replace', original: '你好', optimized: '哈喽' },
    ]);
    expect(result).toContain('哈喽');
    expect(result).toContain('世界');
  });

  it('多个替换按顺序执行', () => {
    const result = applyOptimizations_ACU('AABBCC', [
      { type: 'replace', original: 'AA', optimized: 'XX' },
      { type: 'replace', original: 'BB', optimized: 'YY' },
    ]);
    expect(result).toContain('XX');
    expect(result).toContain('YY');
    expect(result).toContain('CC');
  });

  it('匹配失败时返回 no-op 统计而不是可写回的成功结果', () => {
    const result = applyOptimizationsWithStats_ACU('你好世界', [
      { type: 'replace', original: '不存在的文本', optimized: '替换' },
    ]);
    expect(result).toMatchObject({ content: '你好世界', appliedCount: 0, failedCount: 1 });
  });

  it('匹配失败时原文不变', () => {
    const result = applyOptimizations_ACU('你好世界', [
      { type: 'replace', original: '不存在的文本', optimized: '替换' },
    ]);
    expect(result).toBe('你好世界');
  });

  it('非 replace 类型被忽略', () => {
    const result = applyOptimizations_ACU('你好', [
      { type: 'delete', original: '你好', optimized: '' },
    ]);
    expect(result).toBe('你好');
  });
});

// ═══════════════════════════════════════════════════════════════
// 标签排除规则 · 写回保护（用户拍板 B 语义：命中排除段的建议不写回、不占替换数）
// ═══════════════════════════════════════════════════════════════
describe('排除规则写回保护（filterOptimizationsByExcludeRules_ACU + applyOptimizations_ACU）', () => {
  const COMMENT_RULE = { start: '<!--', end: '-->' };
  const BODY_A = '夜色漫过屋檐，她收起最后一封信。';
  const NOTE = '<!-- 作者注：这里的伏笔保持原样，不要改动 -->';
  const BODY_B = '雨还在下，她没有回头。';
  const CONTENT = `${BODY_A}${NOTE}${BODY_B}`;

  const makeOpt = (original: string, optimized: string) => ({
    type: 'replace',
    original,
    optimized,
    plan: '测试方案',
  });

  it('①建议原文完全落在注释段内 → 整条丢弃，不计入替换数，注释保持原样', () => {
    const opt = makeOpt('这里的伏笔保持原样', '这里的伏笔被改写');
    const outcome = filterOptimizationsByExcludeRules_ACU(CONTENT, [opt], {
      excludeRules: [COMMENT_RULE],
    });

    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.dropped[0].index).toBe(1);
    expect(outcome.dropped[0].reason).toContain('命中排除段');
    expect(outcome.kept).toHaveLength(0);
    // 「共 N 处改进」按 kept 统计 → 被丢弃的建议不占数
    expect(outcome.kept.length).toBe(0);

    const result = applyOptimizations_ACU(CONTENT, [opt], { excludeRules: [COMMENT_RULE] });
    expect(result).toBe(CONTENT);
    expect(result).toContain(NOTE);
    expect(result).not.toContain('这里的伏笔被改写');
  });

  it('②建议原文命中正文段 → 正常应用', () => {
    const opt = makeOpt('她收起最后一封信', '她把信折进口袋');
    const outcome = filterOptimizationsByExcludeRules_ACU(CONTENT, [opt], {
      excludeRules: [COMMENT_RULE],
    });

    expect(outcome.kept).toHaveLength(1);
    expect(outcome.dropped).toHaveLength(0);

    const result = applyOptimizations_ACU(CONTENT, [opt], { excludeRules: [COMMENT_RULE] });
    expect(result).toContain('她把信折进口袋');
    expect(result).toContain(NOTE);
    expect(result).toContain(BODY_B);
  });

  it('③部分重叠（原文跨注释边界）→ 整条丢弃', () => {
    const cross = '封信。<!-- 作者注';
    expect(CONTENT.indexOf(cross)).toBeGreaterThan(-1);

    const opt = makeOpt(cross, '跨界改写');
    const outcome = filterOptimizationsByExcludeRules_ACU(CONTENT, [opt], {
      excludeRules: [COMMENT_RULE],
    });

    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.kept).toHaveLength(0);
    expect(applyOptimizations_ACU(CONTENT, [opt], { excludeRules: [COMMENT_RULE] })).toBe(CONTENT);
  });

  it('④excludeRules 为空 / 未配置 → 与既有行为逐字一致（回归锁）', () => {
    const opts = [
      makeOpt('这里的伏笔保持原样', '改写一'),
      makeOpt('她收起最后一封信', '改写二'),
    ];
    const baseline = applyOptimizations_ACU(CONTENT, opts);

    expect(applyOptimizations_ACU(CONTENT, opts, undefined)).toBe(baseline);
    expect(applyOptimizations_ACU(CONTENT, opts, null)).toBe(baseline);
    expect(applyOptimizations_ACU(CONTENT, opts, {})).toBe(baseline);
    expect(applyOptimizations_ACU(CONTENT, opts, { excludeRules: [] })).toBe(baseline);
    expect(applyOptimizations_ACU(CONTENT, opts, { excludeRules: [], excludeTags: '' })).toBe(baseline);

    // 未配置规则时维持旧行为：注释段内的建议照样写回（这正是启用规则后要保护的场景）
    expect(baseline).toContain('改写一');
    expect(baseline).not.toContain('这里的伏笔保持原样');

    const outcome = filterOptimizationsByExcludeRules_ACU(CONTENT, opts);
    expect(outcome.kept).toEqual(opts);
    expect(outcome.dropped).toEqual([]);
    expect(outcome.ranges).toEqual([]);
  });

  it('⑤未闭合注释尾巴 → 与排除段匹配器一致：不构成排除区间，建议照常应用', () => {
    const dangling = `${BODY_A}<!-- 尾巴没有闭合边界，改写这里`;
    const opt = makeOpt('改写这里', '已改写');

    expect(
      collectOptimizationExcludeRanges_ACU(dangling, { excludeRules: [COMMENT_RULE] })
    ).toEqual([]);

    const outcome = filterOptimizationsByExcludeRules_ACU(dangling, [opt], {
      excludeRules: [COMMENT_RULE],
    });
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.dropped).toHaveLength(0);
    expect(applyOptimizations_ACU(dangling, [opt], { excludeRules: [COMMENT_RULE] })).toContain('已改写');
  });

  it('孤立结束边界（只有 --> 没有 <!--）同样不构成排除区间', () => {
    const orphanEnd = `${BODY_A}--> 孤立结束边界，改写这里`;
    const outcome = filterOptimizationsByExcludeRules_ACU(
      orphanEnd,
      [makeOpt('改写这里', '已改写')],
      { excludeRules: [COMMENT_RULE] },
    );
    expect(outcome.ranges).toEqual([]);
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.dropped).toHaveLength(0);
  });

  it('多段排除区间 + 混合建议：只丢命中排除段的条目，替换数等于保留条目数', () => {
    const multi = `正文一。<!-- 注一别改 -->正文二。<!-- 注二别改 -->正文三。`;
    const opts = [
      makeOpt('正文一', '改写正文一'),
      makeOpt('注一别改', '不该出现'),
      makeOpt('正文二', '改写正文二'),
      makeOpt('注二别改', '也不该出现'),
    ];
    const outcome = filterOptimizationsByExcludeRules_ACU(multi, opts, {
      excludeRules: [COMMENT_RULE],
    });

    expect(outcome.kept).toHaveLength(2);
    expect(outcome.dropped).toHaveLength(2);
    expect(outcome.kept.map((item: any) => item.original)).toEqual(['正文一', '正文二']);

    const result = applyOptimizations_ACU(multi, opts, { excludeRules: [COMMENT_RULE] });
    expect(result).toContain('改写正文一');
    expect(result).toContain('改写正文二');
    expect(result).toContain('注一别改');
    expect(result).toContain('注二别改');
  });

  it('旧标签字符串（excludeTags）回退同样受写回保护', () => {
    const tagged = '正文前<plot>规划内容保持原样</plot>正文后';
    const opt = makeOpt('规划内容保持原样', '不该被改写');
    const outcome = filterOptimizationsByExcludeRules_ACU(tagged, [opt], {
      excludeRules: [],
      excludeTags: 'plot',
    });

    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.kept).toHaveLength(0);
    expect(applyOptimizations_ACU(tagged, [opt], { excludeTags: 'plot' })).toBe(tagged);
  });

  it('非 replace 项与定位不到的建议原样放行（不新增失败统计口径）', () => {
    const notReplace = { type: 'delete', original: '这里的伏笔保持原样', optimized: '' };
    const unlocatable = makeOpt('这段文本根本不在原文里出现啊', '改写');
    const outcome = filterOptimizationsByExcludeRules_ACU(
      CONTENT,
      [notReplace, unlocatable],
      { excludeRules: [COMMENT_RULE] },
    );

    expect(outcome.kept).toHaveLength(2);
    expect(outcome.dropped).toHaveLength(0);
  });
});

describe('块 7 复审 R7-01：写回不改动引号', () => {
  it('段末嵌套中文引号原样保留', () => {
    const original = '他回头看了一眼，说：“她说‘别等我’。”';
    const { content } = applyOptimizationsWithStats_ACU(original, [{ type: 'replace', original, optimized: '他回头望了一眼，说：“她说‘别等我’。”' }]);
    expect(content).toBe('他回头望了一眼，说：“她说‘别等我’。”');
  });

  it('英文撇号不被改成弯引号', () => {
    const original = "Tom's sword and Ann's shield were left behind.";
    const { content } = applyOptimizationsWithStats_ACU(original, [{ type: 'replace', original, optimized: "Tom's blade and Ann's shield were left behind." }]);
    expect(content).toBe("Tom's blade and Ann's shield were left behind.");
  });
});

// MVU 把变量更新写成 <UpdateVariable>/<JSONPatch> 块留在正文里，手动重试还会按标签裁掉旧块重解析。
// 替换模型改了块内文字，变量与正文就对不上，所以无论用户配没配排除规则，块内都不许写回。
describe('MVU 变量更新块始终受写回保护', () => {
  const BODY = '她推开门，屋里一片寂静。';
  const BLOCK = '<UpdateVariable>\n<JSONPatch>[{"op":"replace","path":"/好感度","value":12}]</JSONPatch>\n</UpdateVariable>';
  const CONTENT = `${BODY}\n\n${BLOCK}`;
  const makeOpt = (original: string, optimized: string) => ({ type: 'replace', original, optimized, plan: '测试' });

  it('未配置任何排除规则时，块内建议也被丢弃，正文建议照常写回', () => {
    const opts = [makeOpt('屋里一片寂静', '屋里静得出奇'), makeOpt('"value":12', '"value":99')];
    const outcome = filterOptimizationsByExcludeRules_ACU(CONTENT, opts);

    expect(outcome.kept.map((o: any) => o.original)).toEqual(['屋里一片寂静']);
    expect(outcome.dropped).toHaveLength(1);

    const result = applyOptimizations_ACU(CONTENT, opts);
    expect(result).toContain('屋里静得出奇');
    expect(result).toContain(BLOCK);
  });

  it('前一条建议改掉正文里的出现位置后，后一条建议不会落到变量块里的同名文字上', () => {
    const content = '好感度上升了。\n\n<UpdateVariable>_.set("好感度", 1, 2);</UpdateVariable>';
    const opts = [makeOpt('好感度上升了', '她更信任他了'), makeOpt('好感度', '亲密度')];

    const result = applyOptimizationsWithStats_ACU(content, opts);

    expect(result.content).toBe('她更信任他了。\n\n<UpdateVariable>_.set("好感度", 1, 2);</UpdateVariable>');
    expect(result.appliedCount).toBe(1);
  });

  it('已预过滤时不再重复预过滤，但前一条建议改过正文后仍按当前正文复核用户排除段', () => {
    const content = '甲说：你好。<think>甲说：你好。</think>';
    const opts = [makeOpt('甲说：你好。', '甲笑着说：你好呀。'), makeOpt('甲说：你好。', '不该写进思考段')];
    const result = applyOptimizationsWithStats_ACU(content, opts, {
      excludeRules: [{ start: '<think>', end: '</think>' }],
      alreadyFiltered: true,
    });
    expect(result.content).toBe('甲笑着说：你好呀。<think>甲说：你好。</think>');
    expect(result.appliedCount).toBe(1);
  });

  it('stripMvuUpdateBlocks_ACU 去掉变量块，夹在中间的块换成换行', () => {
    expect(stripMvuUpdateBlocks_ACU(`甲。<UpdateVariable>x</UpdateVariable>乙。\n\n<JSONPatch>[]</JSONPatch>`)).toBe('甲。\n乙。');
  });

  it('标签大小写不敏感、未闭合的块保护到正文末尾', () => {
    const lower = `${BODY}<updatevariable>_.set('金钱', 10, 20);</updatevariable>`;
    expect(collectOptimizationExcludeRanges_ACU(lower)).toEqual([{ start: BODY.length, end: lower.length }]);

    const open = `${BODY}<UpdateVariable>_.set('金钱', 10, 20);`;
    expect(collectOptimizationExcludeRanges_ACU(open)).toEqual([{ start: BODY.length, end: open.length }]);
  });

  it('与用户排除规则合并生效', () => {
    const text = `<!-- 注 -->${BODY}${BLOCK}`;
    const ranges = collectOptimizationExcludeRanges_ACU(text, { excludeRules: [{ start: '<!--', end: '-->' }] });
    expect(ranges).toHaveLength(2);
    expect(ranges[1]).toEqual({ start: text.indexOf(BLOCK), end: text.length });
  });
});
