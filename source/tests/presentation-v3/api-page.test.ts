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
  const testConnection = vi.fn(async (): Promise<any> => ({ ok: true, elapsedMs: 1234, reply: '连接成功' }));
  vi.doMock('../../src/service/ai/ai-service', async () => {
    const actual = await vi.importActual<any>('../../src/service/ai/ai-service');
    return { ...actual, getConnectionManagerProfiles_ACU: () => [], fetchAvailableModels_ACU: fetchModels, testApiConnection_ACU: testConnection };
  });
  const ctx = await mountV3({ settings, uiState: { router: { activePageId: 'api' } } });
  cleanup = ctx.mount.__resetAcuV2MountForTests;
  const page = () => document.querySelector<HTMLElement>('[data-ub-main]')!;
  const input = (label: string) => page().querySelector<HTMLInputElement>(`[data-ub-row="${label}"] input`)!;
  return { ...ctx, fetchModels, testConnection, page, input };
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

  it('点「+」新建后再选回已保存的预设（含当前这个），下面的表单载入该预设内容', { timeout: 60_000 }, async () => {
    const { page, input } = await mountApiPage();
    page().querySelector<HTMLButtonElement>('button[title="新建预设"]')!.click();
    await flush();
    expect(input('预设名称').value).toBe('');
    // 新建状态下选择器不再显示旧预设名，免得看上去「已选中」却是空表单
    expect(page().querySelector('.ub-picker__trigger')!.textContent).not.toContain('beta');

    const trigger = page().querySelector<HTMLButtonElement>('.ub-picker__trigger')!;
    trigger.click();
    await flush();
    byText<HTMLElement>('.ub-picker-panel__item', 'beta')!.click();
    await flush();

    expect(input('预设名称').value).toBe('beta');
    expect(input('端点（基础 URL）').value).toBe('https://beta.test');
    expect(page().textContent).not.toContain('正在新建预设');
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

  it('「测试连接」用未保存的填写内容发测试，显示成功回复与耗时；失败时显示原因', { timeout: 60_000 }, async () => {
    const { page, input, testConnection, settings } = await mountApiPage();
    typeValue(input('模型名'), 'draft-model');
    await flush();
    byText<HTMLButtonElement>('button', '测试连接', page())!.click();
    await flush();
    expect(testConnection).toHaveBeenCalledTimes(1);
    expect((testConnection.mock.calls[0] as any[])[0]).toMatchObject({ url: 'https://beta.test', model: 'draft-model' });
    expect(settings.apiPresets.find((preset: any) => preset.name === 'beta').apiConfig.model).toBe('beta-model');
    expect(page().textContent).toContain('连接成功（1.2 秒）：连接成功');

    testConnection.mockResolvedValueOnce({ ok: false, elapsedMs: 300, status: 401, error: 'API请求失败: 401 invalid key' });
    byText<HTMLButtonElement>('button', '测试连接', page())!.click();
    await flush();
    expect(page().textContent).toContain('连接失败（300 毫秒）：API请求失败: 401 invalid key');
  });

  it('测试连接在途时切到别的预设，迟到的结果不显示在新预设下', { timeout: 60_000 }, async () => {
    const { page, testConnection } = await mountApiPage();
    let resolveTest: ((value: any) => void) | null = null;
    testConnection.mockImplementationOnce(() => new Promise(resolve => { resolveTest = resolve; }));
    byText<HTMLButtonElement>('button', '测试连接', page())!.click();
    await flush();

    page().querySelector<HTMLButtonElement>('.ub-picker__trigger')!.click();
    await flush();
    byText<HTMLElement>('.ub-picker-panel__item', 'alpha')!.click();
    await flush();
    resolveTest?.({ ok: true, elapsedMs: 20_000, reply: '这是 beta 端点的回复' });
    await flush();

    expect(page().textContent).not.toContain('这是 beta 端点的回复');
    expect(page().textContent).not.toContain('连接成功');
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

  it('G02-03：加载模型后切预设 / 新建草稿，模型下拉不残留在新表单下', { timeout: 60_000 }, async () => {
    const { page } = await mountApiPage();
    byText<HTMLButtonElement>('button', '加载模型', page())!.click();
    await flush();
    expect(page().querySelector('select[aria-label="模型列表"]')).not.toBeNull();

    // 切到 alpha：beta 端点加载出来的模型下拉必须整份清掉
    page().querySelector<HTMLButtonElement>('.ub-picker__trigger')!.click();
    await flush();
    byText<HTMLElement>('.ub-picker-panel__item', 'alpha')!.click();
    await flush();
    expect(page().textContent).not.toContain('m1');
    expect(page().querySelector('select[aria-label="模型列表"]')).toBeNull();

    // 切回 beta 重新加载后点「+」新建：新建草稿同样不沿用
    byText<HTMLButtonElement>('button', '加载模型', page())!.click();
    await flush();
    expect(page().querySelector('select[aria-label="模型列表"]')).not.toBeNull();
    page().querySelector<HTMLButtonElement>('button[title="新建预设"]')!.click();
    await flush();
    expect(page().querySelector('select[aria-label="模型列表"]')).toBeNull();
  });

  it('加载模型后改名保存：保存的还是这份内容，模型下拉保留', { timeout: 60_000 }, async () => {
    const { page, input } = await mountApiPage();
    byText<HTMLButtonElement>('button', '加载模型', page())!.click();
    await flush();
    expect(page().querySelector('select[aria-label="模型列表"]')).not.toBeNull();

    typeValue(input('预设名称'), 'beta-renamed');
    await flush();
    byText<HTMLButtonElement>('button', '保存当前预设', page())!.click();
    await flush();
    expect(document.body.textContent).toContain('已保存当前 API 预设');
    expect(page().querySelector('select[aria-label="模型列表"]')).not.toBeNull();
  });

  it('G02-03：加载模型在途时切预设，迟到的模型列表不挂到新预设下', { timeout: 60_000 }, async () => {
    const { page, fetchModels } = await mountApiPage();
    let resolveModels: ((value: any) => void) | null = null;
    fetchModels.mockImplementationOnce(() => new Promise(resolve => { resolveModels = resolve; }));
    byText<HTMLButtonElement>('button', '加载模型', page())!.click();
    await flush();

    page().querySelector<HTMLButtonElement>('.ub-picker__trigger')!.click();
    await flush();
    byText<HTMLElement>('.ub-picker-panel__item', 'alpha')!.click();
    await flush();
    resolveModels?.({ success: true, models: ['beta-only-model'] });
    await flush();

    expect(page().textContent).not.toContain('beta-only-model');
    expect(page().querySelector('select[aria-label="模型列表"]')).toBeNull();
  });

  it('G02-03：加载失败的报错文案同样不随预设切换残留', { timeout: 60_000 }, async () => {
    const { page, fetchModels } = await mountApiPage();
    fetchModels.mockResolvedValueOnce({ success: false, error: '模型列表加载失败：501' });
    byText<HTMLButtonElement>('button', '加载模型', page())!.click();
    await flush();
    expect(page().textContent).toContain('模型列表加载失败：501');

    page().querySelector<HTMLButtonElement>('.ub-picker__trigger')!.click();
    await flush();
    byText<HTMLElement>('.ub-picker-panel__item', 'alpha')!.click();
    await flush();
    expect(page().textContent).not.toContain('模型列表加载失败：501');
  });

  it('未设置接口协议的旧预设探活回退 openai_compat', { timeout: 60_000 }, async () => {
    const { page, fetchModels } = await mountApiPage();
    byText<HTMLButtonElement>('button', '加载模型', page())!.click();
    await flush();
    expect(fetchModels).toHaveBeenCalledWith('https://beta.test', '', 'openai_compat', { force: true });
  });

  describe('OpenCode Go 用量', () => {
    function goSettings(): any {
      const settings = createSettings();
      const beta = settings.apiPresets.find((preset: any) => preset.name === 'beta');
      beta.apiConfig.url = 'https://opencode.ai/zen/go/v1';
      beta.apiConfig.apiKey = 'oc_sk_test';
      return settings;
    }

    function usageBody(rollingPercent: number, weeklyStatus = 'ok'): any {
      return {
        usage: {
          rolling: { status: 'ok', percent: rollingPercent, resetsAt: '2026-11-09T15:04:53.000Z' },
          weekly: { status: weeklyStatus, percent: 64, resetsAt: '2026-11-16T00:00:00.000Z' },
          monthly: { status: 'ok', percent: 93, resetsAt: '2026-11-09T19:38:32.000Z' },
        },
      };
    }

    /** 地址 / 密钥变动后停手片刻才查（含打开页面载入预设那一下）。 */
    async function waitQuery(): Promise<void> {
      await flush();
      await new Promise(resolve => setTimeout(resolve, 700));
      await flush();
    }

    function usageRow(page: () => HTMLElement): HTMLElement | null {
      return page().querySelector<HTMLElement>('[data-ub-row="Go 用量"]');
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('端点是 Go、填了密钥：显示三个周期的用量；一轮填表结束后刷新一次', { timeout: 60_000 }, async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(usageBody(60)), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(usageBody(72, 'rate-limited')), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const { page } = await mountApiPage(goSettings());
      await waitQuery();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://opencode.ai/inference/go/v1/usage');
      const row = usageRow(page)!;
      expect(row).not.toBeNull();
      expect(row.textContent).toContain('5 小时');
      expect(row.textContent).toContain('60%');
      expect(row.textContent).toContain('本周');
      expect(row.textContent).toContain('本月');
      expect(row.textContent).toContain('93%');

      const state = await import('../../src/service/runtime/state-manager');
      state._set_isAutoUpdatingCard_ACU(true);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      state._set_isAutoUpdatingCard_ACU(false);
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(usageRow(page)!.textContent).toContain('72%');
      expect(usageRow(page)!.textContent).toContain('已限流');
    });

    it('查询失败时在这一行说明原因', { timeout: 60_000 }, async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
      const { page } = await mountApiPage(goSettings());
      await waitQuery();
      expect(usageRow(page)!.textContent).toContain('没有订阅 OpenCode Go');
    });

    it('不是 Go 端点或没填密钥时不显示、不查询', { timeout: 60_000 }, async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const settings = goSettings();
      settings.apiPresets.find((preset: any) => preset.name === 'beta').apiConfig.apiKey = '';
      const { page, input } = await mountApiPage(settings);
      await waitQuery();
      expect(usageRow(page)).toBeNull();

      typeValue(input('端点（基础 URL）'), 'https://opencode.ai/zen/v1');
      typeValue(input('API 密钥'), 'oc_sk_test');
      await waitQuery();
      expect(usageRow(page)).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();

      const state = await import('../../src/service/runtime/state-manager');
      state._set_isAutoUpdatingCard_ACU(true);
      state._set_isAutoUpdatingCard_ACU(false);
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('查询在途时切到别的预设：旧预设迟到的结果不显示', { timeout: 60_000 }, async () => {
      let resolveFirst: ((value: Response) => void) | null = null;
      const fetchMock = vi.fn()
        .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve; }))
        .mockImplementation(async () => new Response(JSON.stringify(usageBody(11)), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const settings = goSettings();
      const alpha = settings.apiPresets.find((preset: any) => preset.name === 'alpha');
      alpha.apiConfig.url = 'https://opencode.ai/zen/go/v1';
      alpha.apiConfig.apiKey = 'oc_sk_alpha';
      const { page } = await mountApiPage(settings);
      await waitQuery();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      page().querySelector<HTMLButtonElement>('.ub-picker__trigger')!.click();
      await flush();
      byText<HTMLElement>('.ub-picker-panel__item', 'alpha')!.click();
      await waitQuery();
      expect(usageRow(page)!.textContent).toContain('11%');

      resolveFirst!(new Response(JSON.stringify(usageBody(60)), { status: 200 }));
      await flush();
      expect(usageRow(page)!.textContent).toContain('11%');
      expect(usageRow(page)!.textContent).not.toContain('60%');
    });

    it('改了密钥：旧密钥的用量立即撤下，停手后按新密钥重新查', { timeout: 60_000 }, async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify(usageBody(60)), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const { page, input } = await mountApiPage(goSettings());
      await waitQuery();
      expect(usageRow(page)!.textContent).toContain('60%');

      typeValue(input('API 密钥'), 'oc_sk_other');
      await flush();
      expect(usageRow(page)!.textContent).not.toContain('60%');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await waitQuery();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((fetchMock.mock.calls[1] as any[])[1].headers.Authorization).toBe('Bearer oc_sk_other');
    });
  });
});
