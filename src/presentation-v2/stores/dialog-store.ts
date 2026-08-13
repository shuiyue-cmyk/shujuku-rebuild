import { defineStore } from "pinia";

export type AcuDialogVariant = "default" | "primary" | "danger";
export type AcuDialogKind = "confirm" | "prompt" | "choice" | "multiselect";

export interface AcuDialogAction {
  value: string;
  label: string;
  variant?: AcuDialogVariant;
}

export interface AcuDialogCheckboxOption {
  value: string;
  label: string;
  description?: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}

export interface AcuDialogRequest {
  id: string;
  kind: AcuDialogKind;
  title: string;
  message: string;
  dangerMessage?: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmVariant?: AcuDialogVariant;
  actions?: AcuDialogAction[];
  checkboxOptions?: AcuDialogCheckboxOption[];
  badge?: {
    label: string;
    variant?: "neutral" | "accent" | "warning" | "success" | "danger";
  };
  requireNonEmpty?: boolean;
  resolve: (value: string | boolean | string[] | null) => void;
}

export interface ConfirmDialogOptions {
    title: string;
    message: string;
    dangerMessage?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmVariant?: AcuDialogVariant;
}

export interface PromptDialogOptions {
  title: string;
  message: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: AcuDialogVariant;
  requireNonEmpty?: boolean;
}

export interface ChoiceDialogOptions<T extends string> {
  title: string;
  message: string;
  actions: Array<AcuDialogAction & { value: T }>;
  cancelLabel?: string;
  badge?: AcuDialogRequest["badge"];
}

export interface MultiSelectDialogOptions<T extends string> {
  title: string;
  message: string;
  options: Array<AcuDialogCheckboxOption & { value: T }>;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: AcuDialogVariant;
  badge?: AcuDialogRequest["badge"];
  requireNonEmpty?: boolean;
}

let nextDialogId = 1;

function makeDialogId(): string {
  return `dialog-${nextDialogId++}`;
}

export const useDialogStore = defineStore("acu-v2-dialog", {
  state: () => ({
    active: null as AcuDialogRequest | null,
    queue: [] as AcuDialogRequest[],
    inputValue: "",
    checkedValues: {} as Record<string, boolean>,
  }),
  getters: {
    confirmDisabled(state): boolean {
      if (state.active?.kind === "prompt") {
        if (state.active.requireNonEmpty === false) return false;
        return !String(state.inputValue || "").trim();
      }
      if (state.active?.kind === "multiselect") {
        if (state.active.requireNonEmpty === false) return false;
        return !Object.values(state.checkedValues).some(Boolean);
      }
      return false;
    },
  },
  actions: {
    confirm(options: ConfirmDialogOptions): Promise<boolean> {
      return this.enqueue({
        id: makeDialogId(),
        kind: "confirm",
        title: options.title,
        message: options.message,
        dangerMessage: options.dangerMessage,
        confirmLabel: options.confirmLabel || "确认",
        cancelLabel: options.cancelLabel || "取消",
        confirmVariant: options.confirmVariant || "primary",
        requireNonEmpty: false,
        resolve: () => {},
      }).then((value) => value === true);
    },
    prompt(options: PromptDialogOptions): Promise<string | null> {
      return this.enqueue({
        id: makeDialogId(),
        kind: "prompt",
        title: options.title,
        message: options.message,
        label: options.label,
        initialValue: String(options.defaultValue || ""),
        placeholder: options.placeholder,
        confirmLabel: options.confirmLabel || "确认",
        cancelLabel: options.cancelLabel || "取消",
        confirmVariant: options.confirmVariant || "primary",
        requireNonEmpty: options.requireNonEmpty !== false,
        resolve: () => {},
      }).then((value) => (typeof value === "string" ? value : null));
    },
    choose<T extends string>(options: ChoiceDialogOptions<T>): Promise<T | null> {
      return this.enqueue({
        id: makeDialogId(),
        kind: "choice",
        title: options.title,
        message: options.message,
        actions: options.actions,
        cancelLabel: options.cancelLabel || "取消",
        badge: options.badge,
        requireNonEmpty: false,
        resolve: () => {},
      }).then((value) => (typeof value === "string" ? (value as T) : null));
    },
    selectMany<T extends string>(options: MultiSelectDialogOptions<T>): Promise<T[] | null> {
      return this.enqueue({
        id: makeDialogId(),
        kind: "multiselect",
        title: options.title,
        message: options.message,
        checkboxOptions: options.options,
        confirmLabel: options.confirmLabel || "确认",
        cancelLabel: options.cancelLabel || "取消",
        confirmVariant: options.confirmVariant || "primary",
        badge: options.badge,
        requireNonEmpty: options.requireNonEmpty !== false,
        resolve: () => {},
      }).then((value) => (Array.isArray(value) ? (value as T[]) : null));
    },
    setCheckedValue(value: string, checked: boolean): void {
      this.checkedValues = {
        ...this.checkedValues,
        [value]: checked,
      };
    },
    cancelActive(): void {
      const dialog = this.active;
      this.active = null;
      this.inputValue = "";
      this.checkedValues = {};
      dialog?.resolve(dialog.kind === "confirm" ? false : null);
      this.activateNext();
    },
    submitActive(value?: string): void {
      const dialog = this.active;
      if (!dialog) return;
      if (dialog.kind === "prompt") {
        const next = String(this.inputValue || "").trim();
        if (dialog.requireNonEmpty !== false && !next) return;
        this.active = null;
        this.inputValue = "";
        this.checkedValues = {};
        dialog.resolve(next);
        this.activateNext();
        return;
      }
      if (dialog.kind === "confirm") {
        this.active = null;
        this.inputValue = "";
        this.checkedValues = {};
        dialog.resolve(true);
        this.activateNext();
        return;
      }
      if (dialog.kind === "multiselect") {
        const selected = (dialog.checkboxOptions || [])
          .filter(option => this.checkedValues[option.value] === true)
          .map(option => option.value);
        if (dialog.requireNonEmpty !== false && selected.length === 0) return;
        this.active = null;
        this.inputValue = "";
        this.checkedValues = {};
        dialog.resolve(selected);
        this.activateNext();
        return;
      }
      this.active = null;
      this.inputValue = "";
      this.checkedValues = {};
      dialog.resolve(value ?? null);
      this.activateNext();
    },
    __resetForTests(): void {
      if (this.active) this.active.resolve(null);
      for (const dialog of this.queue) dialog.resolve(null);
      this.active = null;
      this.queue = [];
      this.inputValue = "";
      this.checkedValues = {};
    },
    enqueue(request: AcuDialogRequest): Promise<string | boolean | string[] | null> {
      return new Promise((resolve) => {
        const next = { ...request, resolve };
        if (this.active) this.queue.push(next);
        else this.activateRequest(next);
      });
    },
    activateNext(): void {
      this.activateRequest(this.queue.shift() || null);
    },
    activateRequest(request: AcuDialogRequest | null): void {
      this.active = request;
      this.inputValue = request?.kind === "prompt" ? String(request.initialValue || "") : "";
      if (request?.kind === "multiselect") {
        this.checkedValues = Object.fromEntries(
          (request.checkboxOptions || []).map(option => [option.value, option.defaultChecked === true]),
        );
      } else {
        this.checkedValues = {};
      }
    },
  },
});
