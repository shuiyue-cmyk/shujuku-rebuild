import { defineStore } from "pinia";
import { settings_ACU } from "../../service/runtime/state-manager";
import { acuClearTimeout, acuSetTimeout, type AcuTimerHandle } from "../bootstrap/host-env";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
  dismissOnClick?: boolean;
  variant?: "default" | "danger";
}

export interface ToastItem {
  id: string;
  kind: ToastKind;
  text: string;
  createdAt: number;
  durationMs: number;
  dismissible: boolean;
  action?: ToastAction;
}

export interface ToastOptions {
  durationMs?: number;
  dismissible?: boolean;
  action?: ToastAction;
  /** Set false for execution-chain or important results that bypass "静默提示框". */
  muteable?: boolean;
  maxItems?: number;
}

const DEFAULT_DURATION_BY_KIND: Record<ToastKind, number> = {
  info: 2600,
  success: 2600,
  warning: 4000,
  error: 5000,
};

const DEFAULT_MAX_ITEMS = 4;

let nextToastId = 1;
const dismissTimers = new Map<string, AcuTimerHandle>();
let nextClearVersion = 0;

function makeToastId(): string {
  return `toast-${nextToastId++}`;
}

function isToastMuteEnabled(): boolean {
  try {
    return settings_ACU?.toastMuteEnabled === true;
  } catch {
    return false;
  }
}

function shouldMuteToast(kind: ToastKind, options: ToastOptions): boolean {
  if (!isToastMuteEnabled()) return false;
  if (options.muteable === false || options.action) return false;
  return kind === "info" || kind === "success";
}

function clearDismissTimer(id: string): void {
  const timer = dismissTimers.get(id);
  if (timer === undefined) return;
  acuClearTimeout(timer);
  dismissTimers.delete(id);
}

function resolveDuration(kind: ToastKind, options: ToastOptions): number {
  return typeof options.durationMs === "number"
    ? Math.max(0, Math.trunc(options.durationMs))
    : DEFAULT_DURATION_BY_KIND[kind];
}

export const useToastStore = defineStore("acu-v2-toast", {
  state: () => ({
    items: [] as ToastItem[],
    clearVersion: 0,
  }),
  actions: {
    notify(kind: ToastKind, text: string, options: ToastOptions = {}): string | null {
      const normalizedText = String(text || "").trim();
      if (!normalizedText || shouldMuteToast(kind, options)) return null;

      const id = makeToastId();
      const durationMs = resolveDuration(kind, options);
      const item: ToastItem = {
        id,
        kind,
        text: normalizedText,
        createdAt: Date.now(),
        durationMs,
        dismissible: options.dismissible !== false,
        action: options.action,
      };

      this.items.push(item);
      this.pruneToMax(options.maxItems ?? DEFAULT_MAX_ITEMS);
      if (this.items.some((current) => current.id === id) && durationMs > 0) {
        dismissTimers.set(id, acuSetTimeout(() => this.dismiss(id), durationMs));
      }
      return id;
    },
    success(text: string, options?: ToastOptions): string | null {
      return this.notify("success", text, options);
    },
    info(text: string, options?: ToastOptions): string | null {
      return this.notify("info", text, options);
    },
    warning(text: string, options?: ToastOptions): string | null {
      return this.notify("warning", text, options);
    },
    error(text: string, options?: ToastOptions): string | null {
      return this.notify("error", text, options);
    },
    dismiss(id: string): void {
      clearDismissTimer(id);
      this.items = this.items.filter((item) => item.id !== id);
    },
    update(id: string, kind: ToastKind, text: string, options: ToastOptions = {}): boolean {
      const normalizedText = String(text || "").trim();
      if (!normalizedText) return false;
      const item = this.items.find((current) => current.id === id);
      if (!item) return false;

      clearDismissTimer(id);
      item.kind = kind;
      item.text = normalizedText;
      item.durationMs = resolveDuration(kind, options);
      item.dismissible = options.dismissible !== false;
      item.action = options.action;
      if (item.durationMs > 0) {
        dismissTimers.set(id, acuSetTimeout(() => this.dismiss(id), item.durationMs));
      }
      return true;
    },
    clear(): void {
      for (const item of this.items) {
        clearDismissTimer(item.id);
      }
      this.items = [];
      this.clearVersion = ++nextClearVersion;
    },
    pruneToMax(maxItems: number): void {
      const max = Math.max(1, Math.trunc(maxItems));
      if (this.items.length <= max) return;
      const removed = this.items.slice(0, this.items.length - max);
      for (const item of removed) {
        clearDismissTimer(item.id);
      }
      this.items = this.items.slice(this.items.length - max);
    },
  },
});

/** 仅供测试使用：清理模块级自动关闭定时器，避免 jsdom teardown 后回调访问已销毁的 window。 */
export function __resetToastStoreForTests(): void {
  for (const timer of dismissTimers.values()) {
    acuClearTimeout(timer);
  }
  dismissTimers.clear();
  nextToastId = 1;
  nextClearVersion = 0;
}
