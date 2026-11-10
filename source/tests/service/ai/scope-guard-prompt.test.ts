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
    expect(mod.withScopeGuardPrompt_ACU(messages)).toBe(messages);
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
    const out = mod.withScopeGuardPrompt_ACU(messages);
    expect(out.map((m: any) => m.content)).toEqual(['S1', 'S2', mod.SCOPE_GUARD_PROMPT_ACU, 'U', 'A']);
    expect(out[2]).toEqual({ role: 'system', content: mod.SCOPE_GUARD_PROMPT_ACU });
    expect(messages).toHaveLength(4);
  });

  it('开启后：没有开头 system 段时插在最前面', async () => {
    const mod = await loadModule();
    mod.setScopeGuardPromptEnabled_ACU(true);
    const out = mod.withScopeGuardPrompt_ACU([{ role: 'user', content: 'U' }]);
    expect(out).toEqual([{ role: 'system', content: mod.SCOPE_GUARD_PROMPT_ACU }, { role: 'user', content: 'U' }]);
  });

  it('关掉后恢复原样', async () => {
    const mod = await loadModule();
    mod.setScopeGuardPromptEnabled_ACU(true);
    mod.setScopeGuardPromptEnabled_ACU(false);
    const messages = [{ role: 'user', content: 'U' }];
    expect(mod.withScopeGuardPrompt_ACU(messages)).toBe(messages);
  });

  it('启动时读取已保存的开关：不打开面板、刷新页面后也生效', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ devOptions: { scopeGuardPrompt: true } }));
    const mod = await loadModule();
    expect(mod.isScopeGuardPromptEnabled_ACU()).toBe(true);
  });

  it('提示词本身不为空，且不含需要替换的占位符', async () => {
    const mod = await loadModule();
    expect(mod.SCOPE_GUARD_PROMPT_ACU.trim().length).toBeGreaterThan(50);
    expect(mod.SCOPE_GUARD_PROMPT_ACU).not.toMatch(/\$[0-9A-Z]|\{\{/);
  });
});
