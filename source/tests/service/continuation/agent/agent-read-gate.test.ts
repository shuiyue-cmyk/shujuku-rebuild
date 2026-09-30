import { describe, expect, it } from 'vitest';

import {
  createAgentReadGateState_ACU,
  gateAgentReadBatch_ACU,
  resolveAgentReadBudget_ACU,
  type AgentReadGateConfig_ACU,
} from '../../../../src/service/continuation/agent/agent-read-gate';
import { AGENT_HISTORY_TOKEN_BUDGET_DEFAULT_ACU } from '../../../../src/service/continuation/agent/agent-model';

/** 确定性计数器：1 字符 = 1 token，让预算断言不依赖宿主分词器。 */
const countByLength_ACU = async (text: string): Promise<number> => text.length;

function config_ACU(overrides: Partial<AgentReadGateConfig_ACU> = {}): AgentReadGateConfig_ACU {
  return { historyTokenBudget: 1000, readTokenBudget: 300, fallbackTokens: 50, ...overrides };
}

describe('读取预算解析', () => {
  it('正整数按固定值生效，百分比按会话阈值折算', () => {
    expect(resolveAgentReadBudget_ACU(config_ACU({ readTokenBudget: 300 }))).toMatchObject({ effectiveMaxReadTokens: 300, basis: 'fixed' });
    expect(resolveAgentReadBudget_ACU(config_ACU({ readTokenBudget: '30%', historyTokenBudget: 2000 })))
      .toMatchObject({ effectiveMaxReadTokens: 600, basis: 'history-budget-percent' });
  });

  it('会话阈值不限（<=0）时百分比按默认历史预算折算，保证永远可解析', () => {
    const resolved = resolveAgentReadBudget_ACU(config_ACU({ readTokenBudget: '10%', historyTokenBudget: 0 }));
    expect(resolved.effectiveMaxReadTokens).toBe(Math.floor(AGENT_HISTORY_TOKEN_BUDGET_DEFAULT_ACU * 0.1));
  });

  it('损坏配置回退默认 20%，兜底额度不超过单批次上限', () => {
    const broken = resolveAgentReadBudget_ACU(config_ACU({ readTokenBudget: '瞎写', historyTokenBudget: 1000, fallbackTokens: 6000 }));
    expect(broken.effectiveMaxReadTokens).toBe(200);
    expect(broken.effectiveFallbackTokens).toBe(200);

    const capped = resolveAgentReadBudget_ACU(config_ACU({ readTokenBudget: 100, fallbackTokens: 500 }));
    expect(capped.effectiveFallbackTokens).toBe(100);
  });

  /**
   * 百分比必须整串匹配 `数字%`，不许从损坏串里「猜一个前缀数字」当预算。
   *
   * 背景：原先用 `endsWith('%')` + `parseFloat`，`parseFloat` 只吃合法前缀就停，
   * 于是 `'60garbage%'` 被当成 60%、`'1e2%'`（科学计数）被当成 100%——后者等于
   * 「单批次读取上限 = 整个会话阈值」，把读取预算放大到名存实亡。误解析方向只会
   * 抬高上限（20%·S → 100%·S），不会压低，因此对临近阈值的越界防线是净削弱。
   *
   * 这里锁定的是「非法输入一律回退 20%·S」，合法输入（正整数 / `'30%'` / `'.5%'` 边界）
   * 的行为由上面两条用例保证不变。
   */
  it.each([
    ['百分号前夹垃圾', '60garbage%'],
    ['重复百分号', '60%%'],
    ['百分号前有空格', '60 %'],
    ['小数点用逗号', '60,5%'],
    ['科学计数法', '1e2%'],
    ['十六进制', '0x64%'],
    ['带正号', '+50%'],
  ])('百分比串%s时回退 20% 而不是猜前缀（historyTokenBudget=1000 → 200）', (_label, raw) => {
    const resolved = resolveAgentReadBudget_ACU(config_ACU({ readTokenBudget: raw, historyTokenBudget: 1000 }));
    expect(resolved.effectiveMaxReadTokens).toBe(200);
    expect(resolved.basis).toBe('history-budget-percent');
  });

  it('合法百分比仍按阈值折算，不因收紧整串匹配而误回退（含 1% 下界与小数百分比）', () => {
    expect(resolveAgentReadBudget_ACU(config_ACU({ readTokenBudget: '30%', historyTokenBudget: 2000 })).effectiveMaxReadTokens).toBe(600);
    expect(resolveAgentReadBudget_ACU(config_ACU({ readTokenBudget: '1%', historyTokenBudget: 2000 })).effectiveMaxReadTokens).toBe(20);
    expect(resolveAgentReadBudget_ACU(config_ACU({ readTokenBudget: '12.5%', historyTokenBudget: 2000 })).effectiveMaxReadTokens).toBe(250);
    // 无整数部分的写法也是合法百分比形态（正则的 `\.\d+` 分支），但 0.5 < 1% 下界仍回退 20%。
    expect(resolveAgentReadBudget_ACU(config_ACU({ readTokenBudget: '.5%', historyTokenBudget: 2000 })).effectiveMaxReadTokens).toBe(400);
    expect(resolveAgentReadBudget_ACU(config_ACU({ readTokenBudget: '2.5%', historyTokenBudget: 2000 })).effectiveMaxReadTokens).toBe(50);
  });
});

describe('读取门禁状态机', () => {
  it('空批次直接放行；预算内批次放行并给出逐条实测值', async () => {
    const state = createAgentReadGateState_ACU();
    expect(await gateAgentReadBatch_ACU([], state, config_ACU(), 0, countByLength_ACU)).toMatchObject({ allowed: true, batchTokens: 0 });

    const decision = await gateAgentReadBatch_ACU(
      [{ label: '$A', text: 'x'.repeat(100) }, { label: '$B', text: 'y'.repeat(50) }],
      state, config_ACU(), 0, countByLength_ACU,
    );
    expect(decision).toMatchObject({ allowed: true, batchTokens: 150, itemTokens: [100, 50], report: '' });
  });

  it('单批次 B 超过上限 M 时整批打回，已读取额度不影响判定', async () => {
    const state = createAgentReadGateState_ACU();
    state.grantedTokens = 250;
    const decision = await gateAgentReadBatch_ACU([{ label: '$BIG', text: 'x'.repeat(301) }], state, config_ACU(), 0, countByLength_ACU);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('read-batch-too-large');
    expect(decision.report).toContain('超过单批次上限 300 tokens');
    expect(decision.report).toContain('$BIG：实测 301 tokens');
    expect(decision.report).toContain('修正协议');
  });

  it('临近压缩阈值时只放行兜底额度内的小读取', async () => {
    const nearThreshold = config_ACU({ historyTokenBudget: 1000, readTokenBudget: 300, fallbackTokens: 50 });
    // H=980，任何批次都会把上下文推过 S=1000。
    const big = await gateAgentReadBatch_ACU([{ label: '$BIG', text: 'x'.repeat(80) }], createAgentReadGateState_ACU(), nearThreshold, 980, countByLength_ACU);
    expect(big).toMatchObject({ allowed: false, reason: 'near-compaction-overflow' });
    expect(big.report).toContain('临近总结阈值');
    expect(big.report).toContain('精读兜底额度 50 tokens');

    // 即使 B <= F，也不能放行一个会把完整上下文推过 S 的批次；否则下一次主请求必超限。
    const small = await gateAgentReadBatch_ACU([{ label: '$SMALL', text: 'x'.repeat(40) }], createAgentReadGateState_ACU(), nearThreshold, 980, countByLength_ACU);
    expect(small).toMatchObject({ allowed: false, reason: 'near-compaction-overflow' });

    // 真正留有余量的小批次仍可放行。
    const fits = await gateAgentReadBatch_ACU([{ label: '$FITS', text: 'x'.repeat(40) }], createAgentReadGateState_ACU(), nearThreshold, 950, countByLength_ACU);
    expect(fits.allowed).toBe(true);
  });

  it('不同批次不累计：每批次都低于上限时，即使遥测账本已很大仍放行', async () => {
    const state = createAgentReadGateState_ACU();
    const config = config_ACU({ readTokenBudget: 100 });
    const first = await gateAgentReadBatch_ACU([{ label: '$A', text: 'x'.repeat(60) }], state, config, 0, countByLength_ACU);
    expect(first.allowed).toBe(true);
    state.grantedTokens += first.batchTokens;

    const second = await gateAgentReadBatch_ACU([{ label: '$B', text: 'x'.repeat(60) }], state, config, 0, countByLength_ACU);
    expect(second).toMatchObject({ allowed: true, batchTokens: 60 });
  });

  it('H 不可用（<=0）或 S 不限时跳过临近总结阈值判定，只看单批次上限', async () => {
    const decision = await gateAgentReadBatch_ACU(
      [{ label: '$A', text: 'x'.repeat(80) }],
      createAgentReadGateState_ACU(),
      config_ACU({ historyTokenBudget: 0, readTokenBudget: 100 }),
      999999,
      countByLength_ACU,
    );
    expect(decision.allowed).toBe(true);
  });

  it('负向控制：超限打回后缩小到上限内即放行', async () => {
    const state = createAgentReadGateState_ACU();
    const config = config_ACU({ readTokenBudget: 100 });
    const rejected = await gateAgentReadBatch_ACU([{ label: '$BIG', text: 'x'.repeat(150) }], state, config, 0, countByLength_ACU);
    expect(rejected.allowed).toBe(false);
    expect(rejected.reason).toBe('read-batch-too-large');
    const recovered = await gateAgentReadBatch_ACU([{ label: '$SMALL', text: 'x'.repeat(90) }], state, config, 0, countByLength_ACU);
    expect(recovered).toMatchObject({ allowed: true, batchTokens: 90, report: '' });
  });
});
