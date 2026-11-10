/**
 * 执行边界提示词（开发者选项）：开关决定数据库发出的 AI 请求是否附加一段固定约束提示词。
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

  it('开启后：插在开头连续的 system 段之后，作为一条独立 system 消息', async () => {
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
