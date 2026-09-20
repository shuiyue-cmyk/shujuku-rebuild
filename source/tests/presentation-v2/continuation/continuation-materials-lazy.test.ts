/** @vitest-environment jsdom */
import { expect, it } from 'vitest';
import { createApp, h, nextTick, shallowRef } from 'vue';
import { createPinia } from 'pinia';
import ContinuationMaterialsPanel from '../../../src/presentation-v2/components/ContinuationMaterialsPanel.vue';
import { useChatChangedTick } from '../../../src/presentation-v2/composables/useChatChangedListener';
import { currentChatFileIdentifier_ACU, _set_currentChatFileIdentifier_ACU } from '../../../src/service/runtime/state-manager';

it('历史阶段仅在展开时挂载正文，关闭后卸载', async () => {
  const stage = { stageId: 'old-stage', stageNumber: 1, status: 'done', completedTurns: 1, activeRevision: 1, revisions: [{ revision: 1, frozen: true, outline: { title: '历史标题', goal: '历史阶段正文', totalTurns: 1, nodes: [{ id: 'n1', title: '节点', goal: '节点目标', turns: [{ id: 't1', goal: '历史轮次正文' }] }] } }] };
  const task = shallowRef<any>({ taskId: 'task-a', stages: [stage] });
  const previousChat = currentChatFileIdentifier_ACU;
  const root = document.createElement('div');
  const app = createApp({ render: () => h(ContinuationMaterialsPanel, { task: task.value, activeStage: null, activeRevision: null, busy: false }) });
  app.use(createPinia());
  app.mount(root);
  try {
    const details = root.querySelector('details.acu-v2-continuation-materials__block') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(root.textContent).not.toContain('历史轮次正文');
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await nextTick();
    expect(root.textContent).toContain('历史轮次正文');
    task.value = JSON.parse(JSON.stringify(task.value));
    await nextTick();
    expect(details.open).toBe(true);
    expect(root.textContent).toContain('历史轮次正文');
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    await nextTick();
    expect(root.textContent).not.toContain('历史轮次正文');
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await nextTick();
    task.value = { ...task.value, taskId: 'task-b' };
    await nextTick();
    expect(details.open).toBe(false);
    expect(root.textContent).not.toContain('历史轮次正文');
    for (const chat of ['chat-a', 'chat-b', 'chat-a']) {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
      await nextTick();
      expect(root.textContent).toContain('历史轮次正文');
      _set_currentChatFileIdentifier_ACU(chat);
      useChatChangedTick().value += 1;
      await nextTick();
      expect(details.open).toBe(false);
      expect(root.textContent).not.toContain('历史轮次正文');
    }
  } finally {
    app.unmount();
    _set_currentChatFileIdentifier_ACU(previousChat);
  }
});
