/**
 * AcuToastViewport - v2 toast rendering and interactions.
 *
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type App, createApp, defineComponent, h, nextTick } from "vue";

const apps: Array<{ app: App<Element>; el: HTMLElement }> = [];

async function mountViewport() {
  vi.resetModules();
  vi.doMock("../../../src/service/runtime/state-manager", () => ({
    settings_ACU: { toastMuteEnabled: false },
  }));
  const [{ createPinia }, { default: AcuToastViewport }, { useToastStore }] =
    await Promise.all([
      import("pinia"),
      import("../../../src/presentation-v2/components/_lib/AcuToastViewport.vue"),
      import("../../../src/presentation-v2/stores/toast-store"),
    ]);
  const wrapper = defineComponent({
    setup() {
      return () => h(AcuToastViewport);
    },
  });
  const el = document.createElement("div");
  document.body.appendChild(el);
  const pinia = createPinia();
  const app = createApp(wrapper);
  app.use(pinia);
  app.mount(el);
  apps.push({ app, el });
  return { store: useToastStore(), el };
}

function installAppRoot(): HTMLElement {
  const root = document.createElement("div");
  root.id = "acu-app-v2";
  document.body.appendChild(root);
  return root;
}

function readToastViewportSource(): string {
  return readFileSync(
    join(process.cwd(), "src/presentation-v2/components/_lib/AcuToastViewport.vue"),
    "utf-8",
  );
}

afterEach(() => {
  vi.useRealTimers();
  while (apps.length > 0) {
    const entry = apps.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("AcuToastViewport", () => {
  it("renders stacked semantic toasts", async () => {
    const { store, el } = await mountViewport();

    store.success("提示词已保存", { durationMs: 0 });
    store.error("操作失败，详情见运行日志", { durationMs: 0 });
    await nextTick();

    const toasts = Array.from(document.querySelectorAll<HTMLElement>(".acu-v2-toast"));
    const viewport = document.querySelector<HTMLElement>(".acu-toast-viewport");
    const list = document.querySelector<HTMLElement>(".acu-toast-viewport__list");
    expect(viewport).not.toBeNull();
    expect(list).not.toBeNull();
    expect(viewport!.getAttribute("role")).toBe("status");
    expect(getComputedStyle(viewport!).zIndex).toBe("9410");
    expect(Number(getComputedStyle(viewport!).zIndex)).toBeGreaterThan(9300);
    expect(viewport!.style.zIndex).toBe("9410");
    expect(toasts).toHaveLength(2);
    expect(toasts[0].classList.contains("acu-v2-toast--success")).toBe(true);
    expect(toasts[0].classList.contains("acu-toast--success")).toBe(false);
    expect(toasts[0].getAttribute("role")).toBe("status");
    expect(toasts[1].classList.contains("acu-v2-toast--error")).toBe(true);
    expect(toasts[1].classList.contains("acu-toast--error")).toBe(false);
    expect(toasts[1].getAttribute("role")).toBe("alert");
    expect(el.textContent || "").toBe("");
    expect(document.body.textContent || "").toContain("提示词已保存");
    expect(document.body.textContent || "").toContain("操作失败，详情见运行日志");
  });

  it("dismiss button removes the toast item", async () => {
    vi.useFakeTimers();
    const { store, el } = await mountViewport();

    store.info("已开始导出", { durationMs: 0 });
    await nextTick();

    const dismiss = document.querySelector<HTMLButtonElement>(".acu-v2-toast__dismiss");
    expect(dismiss).not.toBeNull();
    dismiss!.click();
    await nextTick();

    expect(store.items).toHaveLength(0);
    expect(document.querySelector(".acu-v2-toast")?.classList.contains("is-closing")).toBe(true);
    vi.advanceTimersByTime(160);
    await nextTick();

    expect(el.querySelector(".acu-v2-toast")).toBeNull();
    expect(document.querySelector(".acu-v2-toast")).toBeNull();
  });

  it("does not render pruned closing toasts beyond the visible stack", async () => {
    const { store } = await mountViewport();

    for (let i = 1; i <= 4; i++) {
      store.info(`消息 ${i}`, { durationMs: 0 });
    }
    await nextTick();

    expect(Array.from(document.querySelectorAll(".acu-v2-toast"))).toHaveLength(4);

    store.info("消息 5", { durationMs: 0 });
    await nextTick();

    const toasts = Array.from(document.querySelectorAll<HTMLElement>(".acu-v2-toast"));
    expect(toasts).toHaveLength(4);
    expect(toasts.some((toast) => toast.classList.contains("is-closing"))).toBe(false);
    expect(document.body.textContent || "").not.toContain("消息 1");
    expect(document.body.textContent || "").toContain("消息 5");
  });

  it("runs toast action and follows dismissOnClick", async () => {
    const { store } = await mountViewport();
    const action = vi.fn();

    store.info("可查看日志", {
      durationMs: 0,
      action: {
        label: "查看",
        onClick: action,
        dismissOnClick: false,
      },
    });
    await nextTick();

    const actionButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".acu-v2-toast__action"))
      .find((button) => button.textContent?.includes("查看"));
    expect(actionButton).not.toBeUndefined();
    actionButton!.click();
    await nextTick();

    expect(action).toHaveBeenCalled();
    expect(store.items).toHaveLength(1);
  });

  it("portals the full-screen layer to #acu-app-v2 when available", async () => {
    const root = installAppRoot();
    const { store, el } = await mountViewport();

    store.info("手动填表开始。", { durationMs: 0, muteable: false });
    await nextTick();

    const viewport = document.querySelector<HTMLElement>(".acu-toast-viewport");
    expect(viewport).not.toBeNull();
    expect(viewport!.parentElement).toBe(root);
    expect(el.querySelector(".acu-toast-viewport")).toBeNull();
    expect(viewport!.style.zIndex).toBe("9410");
  });

  it("anchors to the upper-right and keeps mobile toasts compact with unclipped soft shadows", async () => {
    const { store } = await mountViewport();

    store.success("已切换到原生 JSON 模式。", { durationMs: 0 });
    await nextTick();

    const source = readToastViewportSource();
    expect(source).toContain("top: calc(var(--acu-toast-top, 62px) + var(--acu-safe-top, 0px));");
    expect(source).toContain("right: calc(var(--acu-toast-edge-gap, 18px) + var(--acu-safe-right, 0px));");
    expect(source).toContain("bottom: auto;");
    expect(source).toContain("box-shadow:");
    expect(source).toContain("overflow: visible;");
    expect(source).toContain("width: clamp(var(--acu-menu-min-width, 240px), 70vw");
    expect(source).not.toContain("backdrop-filter:");
    expect(source).not.toContain("bottom: calc(18px + var(--acu-safe-bottom, 0px));");
  });
});
