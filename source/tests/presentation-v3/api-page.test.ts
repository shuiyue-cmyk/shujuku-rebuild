/**
 * API 页集成：预设选择/默认、草稿保存与当前聊天绑定、新建首个预设、加载模型探活参数、思考强度档位。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, flush, mountV3 } from './v3-harness';

function createSettings(): any {
  return {
    apiMode: 'custom',
    apiConfig: { url: 'https://alpha.test', apiKey: '', model: 'ma', max_tokens: 1000, temperature: 0.7 },
    tavernProfile: '',
    streamingEnabled: false,
    apiPresets: [
      { name: 'alpha', apiMode: 'custom', apiConfig: { url: 'https://alpha.test', apiKey: '', model: 'ma', max_tokens: 1000, temperature: 0.7 } },
      { name: 'beta', apiMode: 'custom', apiConfig: { url: 'https://beta.test', apiKey: '', model: 'beta-model', max_tokens: 60000, temperature: 1 } },
    ],
    defaultApiPresetName: 'alpha',
    apiPresetBindingsByChat: { 'chat-v3': { presetName: 'beta', updatedAt: 1 } },
    tableApiPresetOverridesByName: {},
    contentOptimizationSettings: { apiPreset: '' },
  };
}

async function mountApiPage(settings = createSettings()) {
  const fetchModels = vi.fn(async () => ({ success: true, models: ['m1'] }));
  vi.doMock('../../src/service/ai/ai-service', async () => {
    const actual = await vi.importActual<any>('../../src/service/ai/ai-service');
    return { ...actual, getConnectionManagerProfiles_ACU: () => [], fetchAvailableModels_ACU: fetchModels };
  });
  const ctx = await mountV3({ settings, uiState: { router: { activePageId: 'api' } } });
  cleanup = ctx.mount.__resetAcuV2MountForTests;
  const page = () => document.querySelector<HTMLElement>('[data-ub-main]')!;
  const input = (label: string) => page().querySelector<HTMLInputElement>(`[data-ub-row="${label}"] input`)!;
  return { ...ctx, fetchModels, page, input };
}

function typeValue(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.doUnmock('../../src/service/ai/ai-service');
});

describe('API 页', () => {
  it('当前预设直接展开编辑：五个预设级开关齐全，没有导入导出，也不混入交火模式设置', { timeout: 60_000 }, async () => {
    const { page, input, errors } = await mountApiPage();
    const text = page().textContent!;
    expect(page().querySelector('.ub-picker__trigger')!.textContent).toContain('beta');
    expect(input('预设名称').value).toBe('beta');
    for (const label of ['流式输出', '非预填充支持', '公益站兼容', '需要时格式化输出', '保留多个 system 消息']) {
      expect(page().querySelector(`[data-ub-row="${label}"] [role="switch"]`), label).not.toBeNull();
    }
    expect(page().querySelectorAll('[role="switch"]')).toHaveLength(5);
    expect(page().querySelector('button[title="新建预设"]')).not.toBeNull();
    expect(page().querySelector('button[title="删除当前预设"]')).not.toBeNull();
    expect(text).not.toContain('导入');
    expect(text).not.toContain('导出');
    expect(text).not.toContain('Embedding');
    expect(errors).toEqual([]);
  });

  it('改名后保存当前预设，并同步当前聊天绑定', { timeout: 60_000 }, async () => {
    const { page, input, settings } = await mountApiPage();
    typeValue(input('预设名称'), 'beta-renamed');
    await flush();
    const save = byText<HTMLButtonElement>('button', '保存当前预设', page())!;
    expect(save.disabled).toBe(false);
    save.click();
    await flush();
    expect(settings.apiPresets.some((preset: any) => preset.name === 'beta-renamed')).toBe(true);
    expect(settings.apiPresetBindingsByChat['chat-v3'].presetName).toBe('beta-renamed');
    expect(document.body.textContent).toContain('已保存当前 API 预设');
  });

  it('不合步进的数值（温度 0.73）也能保存：不交给浏览器原生校验去静默拦截', { timeout: 60_000 }, async () => {
    const { page, input, settings } = await mountApiPage();
    typeValue(input('温度'), '0.73');
    await flush();
    byText<HTMLButtonElement>('button', '保存当前预设', page())!.click();
    await flush();
    expect(settings.apiPresets.find((preset: any) => preset.name === 'beta').apiConfig.temperature).toBe(0.73);
  });

  it('预设选择器可切换当前聊天，点星标设为全局默认', { timeout: 60_000 }, async () => {
    const { page, settings } = await mountApiPage();
    const trigger = page().querySelector<HTMLButtonElement>('.ub-picker__trigger')!;
    trigger.click();
    await flush();
    byText<HTMLElement>('.ub-picker-panel__item', 'alpha')!.click();
    await flush();
    expect(settings.apiPresetBindingsByChat['chat-v3'].presetName).toBe('alpha');

    trigger.click();
    await flush();
    byText<HTMLElement>('.ub-picker-panel__item', 'beta')!.querySelector<HTMLButtonElement>('.ub-picker-panel__star')!.click();
    await flush();
    expect(settings.defaultApiPresetName).toBe('beta');
  });

  it('没有预设时给出提示；新建并保存第一个预设后自动选中', { timeout: 60_000 }, async () => {
    const empty = createSettings();
    empty.apiPresets = [];
    empty.defaultApiPresetName = '';
    empty.apiPresetBindingsByChat = {};
    const { page, input, settings } = await mountApiPage(empty);
    expect(page().textContent).toContain('暂无可用 API 预设');

    page().querySelector<HTMLButtonElement>('button[title="新建预设"]')!.click();
    await flush();
    typeValue(input('预设名称'), 'first-api');
    typeValue(input('端点（基础 URL）'), 'https://first.test');
    typeValue(page().querySelector<HTMLInputElement>('[data-ub-row="模型名"] input')!, 'first-model');
    await flush();
    byText<HTMLButtonElement>('button', '保存并选中预设', page())!.click();
    await flush();
    expect(settings.apiPresets.some((preset: any) => preset.name === 'first-api')).toBe(true);
    expect(settings.apiPresetBindingsByChat['chat-v3'].presetName).toBe('first-api');
    expect(document.body.textContent).toContain('已保存当前 API 预设');
  });

  it('「加载模型」按草稿的接口协议探活：customApiFormat 透传', { timeout: 60_000 }, async () => {
    const settings = createSettings();
    settings.apiPresets[1].apiConfig.customApiFormat = 'claude_messages';
    const { page, fetchModels } = await mountApiPage(settings);
    byText<HTMLButtonElement>('button', '加载模型', page())!.click();
    await flush();
    expect(fetchModels).toHaveBeenCalledTimes(1);
    expect(fetchModels).toHaveBeenCalledWith('https://beta.test', '', 'claude_messages', { force: true });
  });

  it('未设置接口协议的旧预设探活回退 openai_compat', { timeout: 60_000 }, async () => {
    const { page, fetchModels } = await mountApiPage();
    byText<HTMLButtonElement>('button', '加载模型', page())!.click();
    await flush();
    expect(fetchModels).toHaveBeenCalledWith('https://beta.test', '', 'openai_compat', { force: true });
  });

  it('思考强度下拉包含全部档位（含 Minimal / Ultra）', { timeout: 60_000 }, async () => {
    const { page } = await mountApiPage();
    const labels = Array.from(page().querySelectorAll<HTMLOptionElement>('[data-ub-row="思考强度"] option'))
      .filter(option => !option.disabled)
      .map(option => option.textContent!.trim());
    expect(labels).toEqual(['Minimal', 'Low', 'Medium', 'High', 'XHigh', 'Max', 'Ultra', 'Auto（自动）']);
  });
});
