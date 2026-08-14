// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import BiotrackerPage from '../../../src/presentation-v2/pages/BiotrackerPage.vue';

vi.mock('../../../src/service/biotracker/biotracker-adapter', () => ({
  isAutoRegisterEnabled_ACU: () => false,
  setAutoRegisterEnabled_ACU: vi.fn(),
  getAutoRegisterFrequency_ACU: () => 5,
  setAutoRegisterFrequency_ACU: vi.fn(),
  isRegisterInFlight_ACU: () => false,
  isAutoRegisterInFlight_ACU: () => false,
  isTrackerInFlight_ACU: () => false,
  registerCharacter_ACU: vi.fn(async () => ({ ok: true, message: 'ok' })),
  autoRegisterCharacters_ACU: vi.fn(async () => ({ ok: true, registered: [], message: 'none' })),
  runBiotrackerNow_ACU: vi.fn(async () => {}),
}));

vi.mock('../../../src/service/biotracker/vendor/race_config.js', () => ({
  ALL_BUILTIN_RACES: ['人类', '精灵'],
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: { bs_biotracker: { chatStates: {} }, apiConfig: { url: '', apiKey: '', model: '' } },
  currentChatFileIdentifier_ACU: 'test-chat',
  currentJsonTableData_ACU: {
    sheet_test: { name: '测试表', content: [['列A', '列B'], ['值1', '值2']] },
  },
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: vi.fn(),
}));

function mountPage() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(BiotrackerPage);
  app.use(createPinia());
  app.mount(el);
  return { el, app };
}

describe('BiotrackerPage 渲染', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('API 设置面板显示预设下拉与当前生效 API', () => {
    const { el, app } = mountPage();
    expect(el.textContent).toContain('API 设置');
    expect(el.textContent).toContain('跟随当前活动 API');
    expect(el.textContent).toContain('未配置 URL'); // mock apiConfig 为空
    app.unmount();
  });

  it('渲染手动注册与自动注册两卡片（按钮/频率）', () => {
    const { el, app } = mountPage();
    expect(el.textContent).toContain('注册角色');
    expect(el.textContent).toContain('立即追踪分析');
    expect(el.textContent).toContain('立即分析并注册');
    expect(el.textContent).toContain('更新频率');
    const inputs = el.querySelectorAll('input');
    expect(inputs.length).toBeGreaterThanOrEqual(1); // 角色名输入
    const raceOptions = el.querySelectorAll('option');
    expect(raceOptions.length).toBeGreaterThanOrEqual(2); // 空选项 + 种族
    app.unmount();
  });

  it('已注册角色为空时显示空态', () => {
    const { el, app } = mountPage();
    expect(el.textContent).toContain('尚未注册角色');
    app.unmount();
  });
});
