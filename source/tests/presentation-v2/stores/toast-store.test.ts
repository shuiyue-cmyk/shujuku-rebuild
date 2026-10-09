/**
 * toast-store - v2 scoped toast queue and mute rules.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createSettings() {
  return { toastMuteEnabled: false } as any;
}

async function freshStore(settings = createSettings()) {
  vi.resetModules();
  vi.doMock("../../../src/service/runtime/state-manager", () => ({
    settings_ACU: settings,
  }));
  const [{ createPinia, setActivePinia }, { useToastStore }] =
    await Promise.all([
      import("pinia"),
      import("../../../src/presentation-v2/stores/toast-store"),
    ]);
  setActivePinia(createPinia());
  return { store: useToastStore(), settings };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("toast-store", () => {

  it("keeps durationMs zero toasts until manual dismissal", async () => {
    const { store } = await freshStore();

    store.info("不会自动消失", { durationMs: 0 });
    vi.advanceTimersByTime(10000);

    expect(store.items.map((item) => item.text)).toEqual(["不会自动消失"]);
  });

  it("静默提示框只抑制普通 info / success", async () => {
    const settings = createSettings();
    settings.toastMuteEnabled = true;
    const { store } = await freshStore(settings);

    expect(store.success("已保存", { durationMs: 0 })).toBeNull();
    expect(store.info("已导出", { durationMs: 0 })).toBeNull();
    expect(store.warning("需要处理", { durationMs: 0 })).toBeTruthy();
    expect(store.error("操作失败", { durationMs: 0 })).toBeTruthy();
    expect(
      store.success("执行完成", { durationMs: 0, muteable: false }),
    ).toBeTruthy();
    expect(
      store.info("可查看日志", {
        durationMs: 0,
        action: { label: "查看", onClick: vi.fn() },
      }),
    ).toBeTruthy();

    expect(store.items.map((item) => item.text)).toEqual([
      "需要处理",
      "操作失败",
      "执行完成",
      "可查看日志",
    ]);
  });
});
