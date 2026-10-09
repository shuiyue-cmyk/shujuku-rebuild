/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';

import { useChatChangedListener, useChatMutationTick, watchChatChanged_ACU } from '../../../src/presentation-v2/composables/useChatChangedListener';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

function createEventSource() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on: vi.fn((name: string, listener: (...args: unknown[]) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    }),
    removeListener: vi.fn((name: string, listener: (...args: unknown[]) => void) => { listeners.get(name)?.delete(listener); }),
    emit: (name: string, ...args: unknown[]) => { for (const listener of listeners.get(name) ?? []) listener(...args); },
    count: (name: string) => listeners.get(name)?.size ?? 0,
  };
}

function mountListener() {
  const host = defineComponent({ setup() { useChatChangedListener(); return () => h('div'); } });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(host);
  app.mount(el);
  return app;
}

beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ''; });
afterEach(() => { vi.useRealTimers(); _set_SillyTavern_API_ACU(undefined); });

describe('useChatChangedListener · 楼层变动计数', () => {
  it('删楼与 swipe 事件聚合成一次楼层变动计数，卸载后退订', async () => {
    const eventSource = createEventSource();
    _set_SillyTavern_API_ACU({ eventSource, eventTypes: { CHAT_CHANGED: 'chat_changed', MESSAGE_DELETED: 'message_deleted', MESSAGE_SWIPED: 'message_swiped' } } as any);
    const tick = useChatMutationTick();
    const before = tick.value;
    const app = mountListener();

    // 批量删楼会连发多次事件：防抖窗口内只算一次。
    eventSource.emit('message_deleted', 5);
    eventSource.emit('message_deleted', 4);
    eventSource.emit('message_swiped', 3);
    expect(tick.value).toBe(before);
    await vi.advanceTimersByTimeAsync(300);
    expect(tick.value).toBe(before + 1);

    app.unmount();
    expect(eventSource.count('message_deleted')).toBe(0);
    expect(eventSource.count('message_swiped')).toBe(0);
    eventSource.emit('message_deleted', 2);
    await vi.advanceTimersByTimeAsync(300);
    expect(tick.value).toBe(before + 1);
  });

  it('同聊天重复 CHAT_CHANGED 只触发一次守卫回调', async () => {
    const eventSource = createEventSource();
    _set_SillyTavern_API_ACU({ eventSource, eventTypes: { CHAT_CHANGED: 'chat_changed' } } as any);
    const app = mountListener();
    const cb = vi.fn();
    const host = defineComponent({ setup() { watchChatChanged_ACU(cb); return () => h('div'); } });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app2 = createApp(host);
    app2.mount(el);
    eventSource.emit('chat_changed', 'chat-a');
    await vi.advanceTimersByTimeAsync(1500);
    eventSource.emit('chat_changed', 'chat-a');
    await vi.advanceTimersByTimeAsync(1500);
    expect(cb).toHaveBeenCalledTimes(1);
    app2.unmount();
    app.unmount();
  });

  it('R10A-01：收到切到其他聊天的 CHAT_CHANGED 时立即取消未决确认框', async () => {
    const { setActivePinia, createPinia } = await import('pinia');
    setActivePinia(createPinia());
    const { useDialogStore } = await import('../../../src/presentation-v2/stores/dialog-store');
    const { _set_currentChatFileIdentifier_ACU } = await import('../../../src/service/runtime/state-manager');
    _set_currentChatFileIdentifier_ACU('chat-a');
    const eventSource = createEventSource();
    _set_SillyTavern_API_ACU({ eventSource, eventTypes: { CHAT_CHANGED: 'chat_changed' } } as any);
    const app = mountListener();
    const confirmed = useDialogStore().confirm({ title: '删除', message: '删除？' });

    eventSource.emit('chat_changed', 'chat-b.jsonl');

    await expect(confirmed).resolves.toBe(false);
    app.unmount();
    _set_currentChatFileIdentifier_ACU('');
  });
});
