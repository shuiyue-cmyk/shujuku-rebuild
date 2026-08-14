// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createApp } from 'vue';
import BiotrackerPage from '../../../src/presentation-v2/pages/BiotrackerPage.vue';

vi.mock('../../../src/service/biotracker/biotracker-adapter', () => ({
  isAutoRegisterEnabled_ACU: () => false,
  setAutoRegisterEnabled_ACU: vi.fn(),
  registerCharacter_ACU: vi.fn(async () => ({ ok: true, message: 'ok' })),
  autoRegisterCharacters_ACU: vi.fn(async () => ({ ok: true, registered: [], message: 'none' })),
  runBiotrackerNow_ACU: vi.fn(async () => {}),
}));

vi.mock('../../../src/service/biotracker/vendor/race_config.js', () => ({
  ALL_BUILTIN_RACES: ['人类', '精灵'],
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: { bs_biotracker: { apiUrl: '', apiKey: '', model: '', chatStates: {} } },
  currentChatFileIdentifier_ACU: 'test-chat',
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
  saveSettings_ACU: vi.fn(),
}));

function mountPage() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(BiotrackerPage);
  app.mount(el);
  return { el, app };
}

describe('BiotrackerPage 渲染', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('渲染 API 配置输入框（url/key/model）', () => {
    const { el, app } = mountPage();
    const inputs = el.querySelectorAll('input');
    expect(inputs.length).toBeGreaterThanOrEqual(3); // url / key / model
    expect(el.textContent).toContain('API 配置');
    app.unmount();
  });

  it('渲染注册区（角色名/种族/备注）与按钮', () => {
    const { el, app } = mountPage();
    expect(el.textContent).toContain('注册角色');
    expect(el.textContent).toContain('立即自动注册');
    expect(el.textContent).toContain('立即追踪分析');
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
