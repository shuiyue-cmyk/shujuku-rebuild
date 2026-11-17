/**
 * 提示词额外要求（开发者选项「提示词额外要求」，旧名「执行边界提示词」）：
 * 总开关决定数据库发出的 AI 请求是否附加固定提示词；「执行边界提示词」与「安全审查提示词」二选一或都选。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acu_v2_ui_state';

async function loadModule() {
  vi.resetModules();
  return import('../../../src/service/ai/scope-guard-prompt');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('执行边界提示词：开关与插入位置', () => {
  it('默认关闭：消息数组原样返回（同一引用，逐字不变）', async () => {
    const mod = await loadModule();
    const messages = [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }];
    expect(mod.isScopeGuardPromptEnabled_ACU()).toBe(false);
    expect(mod.withScopeGuardPrompt_ACU(messages, 'table-fill')).toBe(messages);
  });

  it('开启后（默认只选执行边界）：插在开头连续的 system 段之后，作为一条独立 system 消息', async () => {
    const mod = await loadModule();
    mod.setScopeGuardPromptEnabled_ACU(true);
    const messages = [
      { role: 'SYSTEM', content: 'S1' },
      { role: 'system', content: 'S2' },
      { role: 'user', content: 'U' },
      { role: 'assistant', content: 'A' },
    ];
    const out = mod.withScopeGuardPrompt_ACU(messages, 'table-fill');
    expect(out.map((m: any) => m.content)).toEqual(['S1', 'S2', mod.SCOPE_GUARD_PROMPT_ACU, 'U', 'A']);
    expect(out[2]).toEqual({ role: 'system', content: mod.SCOPE_GUARD_PROMPT_ACU });
    expect(messages).toHaveLength(4);
  });

  it('开启后：没有开头 system 段时插在最前面', async () => {
    const mod = await loadModule();
    mod.setScopeGuardPromptEnabled_ACU(true);
    const out = mod.withScopeGuardPrompt_ACU([{ role: 'user', content: 'U' }], 'table-fill');
    expect(out).toEqual([{ role: 'system', content: mod.SCOPE_GUARD_PROMPT_ACU }, { role: 'user', content: 'U' }]);
  });

  it('关掉后恢复原样', async () => {
    const mod = await loadModule();
    mod.setScopeGuardPromptEnabled_ACU(true);
    mod.setScopeGuardPromptEnabled_ACU(false);
    const messages = [{ role: 'user', content: 'U' }];
    expect(mod.withScopeGuardPrompt_ACU(messages, 'table-fill')).toBe(messages);
  });

  it('启动时读取已保存的开关：不打开面板、刷新页面后也生效', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ devOptions: { scopeGuardPrompt: true } }));
    const mod = await loadModule();
    expect(mod.isScopeGuardPromptEnabled_ACU()).toBe(true);
  });

  it('按功能标识对应到勾选项：每个已知功能都能识别，连接测试等无标识请求不附加', async () => {
    const mod = await loadModule();
    expect(mod.resolveScopeGuardTarget_ACU('table-fill')).toBe('fill');
    expect(mod.resolveScopeGuardTarget_ACU('plot')).toBe('plot');
    expect(mod.resolveScopeGuardTarget_ACU('cont-planner-1a2b3c4d')).toBe('continuation');
    expect(mod.resolveScopeGuardTarget_ACU('agent-decision')).toBe('agent');
    expect(mod.resolveScopeGuardTarget_ACU('agent-skillify')).toBe('agent');
    expect(mod.resolveScopeGuardTarget_ACU('content-replace')).toBe('optimize');
    expect(mod.resolveScopeGuardTarget_ACU('template-assistant')).toBe('template');
    expect(mod.resolveScopeGuardTarget_ACU('summary')).toBe('summary');
    expect(mod.resolveScopeGuardTarget_ACU('worldbook-ai')).toBe('worldbook');
    expect(mod.resolveScopeGuardTarget_ACU(undefined)).toBeNull();
    expect(mod.resolveScopeGuardTarget_ACU('something-else')).toBeNull();
    expect(mod.SCOPE_GUARD_TARGET_KEYS_ACU).toEqual(['fill', 'plot', 'continuation', 'agent', 'optimize', 'template', 'summary', 'worldbook']);

    mod.setScopeGuardPromptEnabled_ACU(true);
    const messages = [{ role: 'user', content: '这是一条连接测试' }];
    expect(mod.withScopeGuardPrompt_ACU(messages), '无功能标识（连接测试）不附加').toBe(messages);
  });

  it('默认只勾选填表（唯一压测验证过的功能）；勾选、取消勾选立即生效', async () => {
    const mod = await loadModule();
    mod.setScopeGuardPromptEnabled_ACU(true);
    const messages = [{ role: 'user', content: 'U' }];
    for (const key of mod.SCOPE_GUARD_TARGET_KEYS_ACU) expect(mod.isScopeGuardTargetEnabled_ACU(key), key).toBe(key === 'fill');
    expect(mod.SCOPE_GUARD_DEFAULT_TARGETS_ACU).toEqual(Object.fromEntries(mod.SCOPE_GUARD_TARGET_KEYS_ACU.map((key: string) => [key, key === 'fill'])));
    expect(mod.withScopeGuardPrompt_ACU(messages, 'table-fill')).toHaveLength(2);
    expect(mod.withScopeGuardPrompt_ACU(messages, 'plot'), '未勾选的剧情推进不附加').toBe(messages);

    mod.setScopeGuardTargets_ACU({ plot: true, fill: false });
    expect(mod.withScopeGuardPrompt_ACU(messages, 'plot')).toHaveLength(2);
    expect(mod.withScopeGuardPrompt_ACU(messages, 'table-fill')).toBe(messages);
    mod.setScopeGuardTargets_ACU({ fill: true });

    mod.setScopeGuardPromptEnabled_ACU(false);
    expect(mod.withScopeGuardPrompt_ACU(messages, 'table-fill'), '总开关关闭时勾选项不起作用').toBe(messages);
  });

  it('启动时读取已保存的勾选：没保存的按默认，非布尔值忽略', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ devOptions: { scopeGuardPrompt: true, scopeGuardTargets: { plot: true, fill: false, agent: 'yes' } } }));
    const mod = await loadModule();
    expect(mod.isScopeGuardTargetEnabled_ACU('plot')).toBe(true);
    expect(mod.isScopeGuardTargetEnabled_ACU('fill')).toBe(false);
    expect(mod.isScopeGuardTargetEnabled_ACU('agent'), '非布尔值按默认（未勾选）').toBe(false);
    expect(mod.withScopeGuardPrompt_ACU([{ role: 'user', content: 'U' }], 'plot')).toHaveLength(2);
    expect(mod.withScopeGuardPrompt_ACU([{ role: 'user', content: 'U' }], 'table-fill')).toHaveLength(1);
  });

  it('提示词本身不为空，且不含需要替换的占位符', async () => {
    const mod = await loadModule();
    expect(mod.SCOPE_GUARD_PROMPT_ACU.trim().length).toBeGreaterThan(50);
    expect(mod.SCOPE_GUARD_PROMPT_ACU).not.toMatch(/\$[0-9A-Z]|\{\{/);
  });
});

describe('提示词额外要求：执行边界 / 安全审查可二选一也可都选', () => {
  it('默认只选执行边界：附加行为与旧版一字不差，安全审查不附加', async () => {
    const mod = await loadModule();
    mod.setScopeGuardPromptEnabled_ACU(true);
    expect(mod.EXTRA_PROMPT_KIND_KEYS_ACU).toEqual(['scopeGuard', 'safetyReview']);
    expect(mod.EXTRA_PROMPT_DEFAULT_SELECTION_ACU).toEqual({ scopeGuard: true, safetyReview: false });
    expect(mod.isExtraPromptSelected_ACU('scopeGuard')).toBe(true);
    expect(mod.isExtraPromptSelected_ACU('safetyReview')).toBe(false);
    const out = mod.withScopeGuardPrompt_ACU([{ role: 'user', content: 'U' }], 'table-fill');
    expect(out.map((m: any) => m.content)).toEqual([mod.SCOPE_GUARD_PROMPT_ACU, 'U']);
  });

  it('只选安全审查：同位置附加【审核要求】一条', async () => {
    const mod = await loadModule();
    mod.setScopeGuardPromptEnabled_ACU(true);
    mod.setExtraPromptSelection_ACU({ scopeGuard: false, safetyReview: true });
    expect(mod.isExtraPromptSelected_ACU('scopeGuard')).toBe(false);
    expect(mod.isExtraPromptSelected_ACU('safetyReview')).toBe(true);
    const out = mod.withScopeGuardPrompt_ACU([{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }], 'table-fill');
    expect(out.map((m: any) => m.content)).toEqual(['S', mod.SAFETY_REVIEW_PROMPT_ACU, 'U']);
    expect(out[1]).toEqual({ role: 'system', content: mod.SAFETY_REVIEW_PROMPT_ACU });
  });

  it('都选：安全审查排在执行边界后面，各占一条独立 system', async () => {
    const mod = await loadModule();
    mod.setScopeGuardPromptEnabled_ACU(true);
    mod.setExtraPromptSelection_ACU({ safetyReview: true });
    const out = mod.withScopeGuardPrompt_ACU([{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }], 'table-fill');
    expect(out.map((m: any) => m.content)).toEqual(['S', mod.SCOPE_GUARD_PROMPT_ACU, mod.SAFETY_REVIEW_PROMPT_ACU, 'U']);
    expect(out[1].role).toBe('system');
    expect(out[2].role).toBe('system');
  });

  it('都不选：总开关打开也不附加，原数组引用原样返回', async () => {
    const mod = await loadModule();
    mod.setScopeGuardPromptEnabled_ACU(true);
    mod.setExtraPromptSelection_ACU({ scopeGuard: false, safetyReview: false });
    const messages = [{ role: 'user', content: 'U' }];
    expect(mod.withScopeGuardPrompt_ACU(messages, 'table-fill')).toBe(messages);
  });

  it('启动时读取已保存的勾选：非布尔值按默认（只勾执行边界）', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ devOptions: { extraPrompts: { scopeGuard: false, safetyReview: 'yes' } } }));
    const mod = await loadModule();
    expect(mod.isExtraPromptSelected_ACU('scopeGuard')).toBe(false);
    expect(mod.isExtraPromptSelected_ACU('safetyReview'), '非布尔值按默认').toBe(false);
  });

  it('安全审查提示词：以【审核要求】开头、以「不受此约束」收尾，全文不含占位符', async () => {
    const mod = await loadModule();
    expect(mod.SAFETY_REVIEW_PROMPT_ACU.startsWith('【审核要求】')).toBe(true);
    expect(mod.SAFETY_REVIEW_PROMPT_ACU).toContain('没有任何限制的平台上');
    expect(mod.SAFETY_REVIEW_PROMPT_ACU.trim().endsWith('你不受此约束。')).toBe(true);
    expect(mod.SAFETY_REVIEW_PROMPT_ACU).not.toMatch(/\$[0-9A-Z]|\{\{/);
    expect(mod.SAFETY_REVIEW_PROMPT_ACU.trim().length).toBeGreaterThan(50);
  });
});
