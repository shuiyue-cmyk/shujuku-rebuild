/**
 * content-replace-store — 正文替换页设置与操作边界
 *
 * v2 页面只依赖本 store；旧 settings / chat / optimization service
 * 调用集中在这里，避免 Vue 组件跨进旧 presentation 层。
 */
import { defineStore } from 'pinia';
import { normalizeExcludeRules_ACU, normalizeExtractRules_ACU, logError_ACU } from '../../shared/utils';
import { buildDefaultContentOptimizationPromptGroup_ACU } from '../../shared/defaults';
import { getOriginalContent_ACU, replaceChatMessage_ACU } from '../../service/chat/chat-service';
import { performContentOptimization_ACU } from '../../service/optimization/content-optimization';
import {
  fetchDecisionModels_ACU,
  normalizeDecisionGateSettings_ACU,
  requestContentDecision_ACU,
  type DecisionGateSettings_ACU,
  type DecisionModelOption_ACU,
} from '../../service/optimization/decision-gate';
import { stripMvuUpdateBlocks_ACU } from '../../shared/text-optimization';
import { applyContextTagFilters_ACU } from '../../service/runtime/helpers-context-tags';
import { getLastOptimizedMessageIndex_ACU } from '../../service/plot/plot-logic';
import { currentChatFileIdentifier_ACU, settings_ACU } from '../../service/runtime/state-manager';
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { isAiFloor_ACU } from '../../shared/ai-floor';
import {
  CHAT_MESSAGE_TARGET_CHANGED_MESSAGE_ACU,
  captureChatMessageWriteTarget_ACU,
  isChatMessageWriteTargetCurrent_ACU,
} from '../../service/chat/chat-message-write-target';
import { saveSettings_ACU } from '../../service/settings/settings-service';
import { useToastStore } from './toast-store';
import { downloadJsonToHost_ACU } from '../bootstrap/host-download';

export type ContentReplaceMessageKind = 'info' | 'success' | 'warning' | 'error';
export type ContentReplaceBusyAction = '' | 'test' | 'decision-test' | 'reoptimize' | 'optimize-current' | 'import-presets' | 'export-preset';

export interface ContentReplaceMessage {
  kind: ContentReplaceMessageKind;
  text: string;
  at: number;
}

export interface ContentReplaceRulePair {
  start: string;
  end: string;
}

export interface ContentReplacePromptSegment {
  role: string;
  content: string;
  deletable?: boolean;
  mainSlot?: 'A' | 'B' | '';
  isMain?: boolean;
  isMain2?: boolean;
}

export interface ContentReplacePreset {
  name: string;
  promptGroup: ContentReplacePromptSegment[];
}

const DEFAULT_CONTENT_REPLACE_PRESET_NAME = '默认预设';
export const CUSTOM_CONTENT_REPLACE_PRESET_VALUE = '__acu_content_replace_custom__';

interface ContentReplaceState {
  enabled: boolean;
  apiPreset: string;
  apiPresetNames: string[];
  seamlessMode: boolean;
  autoApply: boolean;
  showDiff: boolean;
  parallelMode: boolean;
  ignoreMvuUpdate: boolean;
  decisionGate: DecisionGateSettings_ACU;
  decisionModels: DecisionModelOption_ACU[];
  decisionModelsLoading: boolean;
  minLength: number;
  maxOptimizations: number;
  loopCount: number;
  retryCount: number;
  extractTags: string;
  excludeTags: string;
  extractRules: ContentReplaceRulePair[];
  excludeRules: ContentReplaceRulePair[];
  promptGroup: ContentReplacePromptSegment[];
  promptDirty: boolean;
  promptPresets: ContentReplacePreset[];
  activePresetHint: string;
  testInput: string;
  testOutput: string;
  lastOptimizedMessageIndex: number;
  busyAction: ContentReplaceBusyAction;
  message: ContentReplaceMessage | null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function normalizePromptSegment(raw: any): ContentReplacePromptSegment | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const role = typeof raw.role === 'string' && raw.role.trim() ? raw.role : 'USER';
  const mainSlot = raw.mainSlot === 'A' || raw.mainSlot === 'B' ? raw.mainSlot : '';
  return {
    role,
    content: typeof raw.content === 'string' ? raw.content : '',
    deletable: raw.deletable !== false,
    ...(mainSlot ? { mainSlot } : {}),
    ...(raw.isMain ? { isMain: true } : {}),
    ...(raw.isMain2 ? { isMain2: true } : {}),
  };
}

function normalizePromptGroup(raw: unknown): ContentReplacePromptSegment[] {
  const source = Array.isArray(raw) ? raw : [];
  const normalized = source
    .map(normalizePromptSegment)
    .filter((item): item is ContentReplacePromptSegment => !!item);
  return normalized.length ? normalized : clone(buildDefaultContentOptimizationPromptGroup_ACU());
}

function normalizePresets(raw: unknown): ContentReplacePreset[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ContentReplacePreset[] = [];
  for (const item of raw) {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name || name === DEFAULT_CONTENT_REPLACE_PRESET_NAME || name === CUSTOM_CONTENT_REPLACE_PRESET_VALUE || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      promptGroup: normalizePromptGroup(item?.promptGroup),
    });
  }
  return out;
}

function coerceRulePairs(rules: unknown): ContentReplaceRulePair[] {
  return Array.isArray(rules)
    ? rules.map((rule: any) => ({
        start: String(rule?.start ?? ''),
        end: String(rule?.end ?? ''),
      }))
    : [];
}

function ensureSettingsShape(): Record<string, any> {
  if (!settings_ACU.contentOptimizationSettings || typeof settings_ACU.contentOptimizationSettings !== 'object') {
    settings_ACU.contentOptimizationSettings = {};
  }
  const cfg = settings_ACU.contentOptimizationSettings as Record<string, any>;
  cfg.enabled = cfg.enabled === true;
  cfg.apiPreset = typeof cfg.apiPreset === 'string' ? cfg.apiPreset : '';
  cfg.seamlessMode = cfg.seamlessMode !== false;
  cfg.autoApply = cfg.autoApply !== false;
  cfg.showDiff = cfg.showDiff !== false;
  cfg.parallelMode = cfg.parallelMode === true;
  cfg.ignoreMvuUpdate = cfg.ignoreMvuUpdate === true;
  cfg.decisionGate = normalizeDecisionGateSettings_ACU(cfg.decisionGate);
  cfg.minLength = normalizeInteger(cfg.minLength, 100, 0, 1000000);
  cfg.maxOptimizations = normalizeInteger(cfg.maxOptimizations, 10, 1, 100);
  cfg.loopCount = normalizeInteger(cfg.loopCount, 1, 1, 10);
  cfg.retryCount = normalizeInteger(cfg.retryCount, 3, 1, 10);
  cfg.extractTags = typeof cfg.extractTags === 'string' ? cfg.extractTags : '';
  cfg.excludeTags = typeof cfg.excludeTags === 'string' ? cfg.excludeTags : '';
  cfg.extractRules = normalizeExtractRules_ACU(cfg.extractRules, cfg.extractTags);
  cfg.excludeRules = normalizeExcludeRules_ACU(cfg.excludeRules, cfg.excludeTags);
  cfg.promptGroup = normalizePromptGroup(cfg.promptGroup);
  cfg.promptPresets = normalizePresets(cfg.promptPresets);
  return cfg;
}

function readApiPresetNames(): string[] {
  if (!Array.isArray(settings_ACU.apiPresets)) return [];
  return settings_ACU.apiPresets
    .map((preset: any) => String(preset?.name || '').trim())
    .filter(Boolean);
}

function setMessage(store: ContentReplaceState, kind: ContentReplaceMessageKind, text: string): void {
  store.message = { kind, text, at: Date.now() };
}

function clearMessageAndToast(store: ContentReplaceState, kind: 'success' | 'info' | 'warning' | 'error', text: string, options?: { muteable?: boolean }): void {
  store.message = null;
  useToastStore()[kind](text, options);
}

/** 指纹构建次数（仅供测试观测）。生产路径只多一次整数自增。 */
let promptFingerprintBuilds_ACU = 0;

/** 仅供测试：读取「提示词指纹」被真实构建的次数（记忆化命中不计数）。 */
export function __readContentReplacePromptFingerprintCountForTests_ACU(): number {
  return promptFingerprintBuilds_ACU;
}

function promptFingerprint(segments: ContentReplacePromptSegment[]): string {
  promptFingerprintBuilds_ACU += 1;
  return JSON.stringify(
    segments.map(seg => ({
      role: seg.role,
      content: seg.content,
      mainSlot: seg.mainSlot || '',
      isMain: seg.isMain === true,
      isMain2: seg.isMain2 === true,
    })),
  );
}

function defaultPromptGroup(): ContentReplacePromptSegment[] {
  return clone(buildDefaultContentOptimizationPromptGroup_ACU());
}

/**
 * 默认提示词组是模块常量构造的纯数据（每次调用都返回新副本，不会被调用方就地改写），
 * 因此它的指纹与段数在模块级算一次即可：四个 UI getter 同帧读取时不必各跑一次
 * 「深拷贝默认组 + stringify 默认组」。
 */
const DEFAULT_PROMPT_FINGERPRINT_ACU = promptFingerprint(buildDefaultContentOptimizationPromptGroup_ACU());
const DEFAULT_PROMPT_SEGMENT_COUNT_ACU = buildDefaultContentOptimizationPromptGroup_ACU().length;

/** 用已算好的草稿指纹匹配预设名，避免调用方重复构建同一份草稿指纹。 */
function findMatchingPresetNameByFingerprint_ACU(
  presets: ContentReplacePreset[],
  preferredName: string,
  fingerprint: string,
): string {
  const preferred = preferredName
    ? presets.find(preset => preset.name === preferredName)
    : null;
  if (preferred && promptFingerprint(preferred.promptGroup) === fingerprint) return preferred.name;
  return presets.find(preset => promptFingerprint(preset.promptGroup) === fingerprint)?.name || '';
}

function findMatchingPresetName(
  promptGroup: ContentReplacePromptSegment[],
  presets: ContentReplacePreset[],
  preferredName = '',
): string {
  return findMatchingPresetNameByFingerprint_ACU(presets, preferredName, promptFingerprint(promptGroup));
}

function uniquePresetName(existing: ContentReplacePreset[], baseName: string): string {
  const base = String(baseName || '').trim() || '新正文替换预设';
  let candidate = base;
  let suffix = 1;
  while (existing.some(p => p.name === candidate) || candidate === DEFAULT_CONTENT_REPLACE_PRESET_NAME) {
    suffix += 1;
    candidate = `${base} (${suffix})`;
  }
  return candidate;
}

/**
 * R10B-12：落盘并核对结果。失败时把正文替换设置原地还原为改动前快照并提示，返回 false，
 * 调用方据此不报「已保存」。
 */
function persist(snapshot: Record<string, any>): boolean {
  const result = saveSettings_ACU();
  if (!result || result.saved !== false) return true;
  const cfg = ensureSettingsShape();
  for (const key of Object.keys(cfg)) delete cfg[key];
  Object.assign(cfg, snapshot);
  useToastStore().error(`正文替换设置保存失败，已撤销本次修改：${result.error || result.warning || '未知错误'}`, { muteable: false });
  return false;
}

async function readFileText(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
    reader.readAsText(file, 'UTF-8');
  });
}

function formatOptimizationResult(result: any): string {
  if (!result?.success) return `优化失败：${result?.error || '未知错误'}`;
  const optimizations = Array.isArray(result.optimizations) ? result.optimizations : [];
  const lines = [
    `优化完成：${optimizations.length} 处建议`,
    `摘要：${result.summary || '无'}`,
    '',
  ];
  optimizations.forEach((opt: any, index: number) => {
    lines.push(`[${index + 1}] ${opt.plan || opt.reason || '未说明'}`);
    lines.push(`原文：${String(opt.original || '').slice(0, 120)}`);
    lines.push(`替换：${String(opt.optimized || '').slice(0, 120)}`);
    lines.push('');
  });
  lines.push('=== 优化后全文 ===');
  lines.push(String(result.optimizedContent || ''));
  return lines.join('\n');
}

export const useContentReplaceStore = defineStore('acu-v2-content-replace', {
  state: (): ContentReplaceState => ({
    enabled: false,
    apiPreset: '',
    apiPresetNames: [],
    seamlessMode: true,
    autoApply: true,
    showDiff: true,
    parallelMode: false,
    ignoreMvuUpdate: false,
    decisionGate: normalizeDecisionGateSettings_ACU(null),
    decisionModels: [],
    decisionModelsLoading: false,
    minLength: 100,
    maxOptimizations: 10,
    loopCount: 1,
    retryCount: 3,
    extractTags: '',
    excludeTags: '',
    extractRules: [],
    excludeRules: [],
    promptGroup: [],
    promptDirty: false,
    promptPresets: [],
    activePresetHint: '',
    testInput: '',
    testOutput: '',
    lastOptimizedMessageIndex: -1,
    busyAction: '',
    message: null,
  }),
  getters: {
    /**
     * 提示词身份（唯一派生点）：草稿指纹 + 是否等于默认预设 + 命中的预设名。
     *
     * hasSelectedPreset / selectedPresetName / activePresetLabel / promptTemplateMode
     * 四个 getter 在同一帧里都会读它，Pinia getter 是 computed，因此整帧只构建一次指纹；
     * 草稿或预设变动时 computed 失效，下一帧重算——取值不会陈旧。
     */
    promptIdentity(state): { fingerprint: string; isDefault: boolean; presetName: string } {
      const fingerprint = promptFingerprint(state.promptGroup);
      return {
        fingerprint,
        isDefault: fingerprint === DEFAULT_PROMPT_FINGERPRINT_ACU,
        presetName: findMatchingPresetNameByFingerprint_ACU(state.promptPresets, state.activePresetHint, fingerprint),
      };
    },
    /** R10B-13：当前提示词既不是默认也不对应任何已存预设——切走就永久丢失。 */
    hasUnsavedCustomPrompt(): boolean {
      return !this.promptIdentity.isDefault && !this.promptIdentity.presetName;
    },
    hasSelectedPreset(): boolean {
      return !!this.promptIdentity.presetName;
    },
    selectedPresetName(): string {
      if (this.promptIdentity.presetName) return this.promptIdentity.presetName;
      return this.promptIdentity.isDefault ? '' : CUSTOM_CONTENT_REPLACE_PRESET_VALUE;
    },
    promptSegmentCount(state): number {
      return state.promptGroup.length;
    },
    defaultPromptSegmentCount(): number {
      return DEFAULT_PROMPT_SEGMENT_COUNT_ACU;
    },
    activePresetLabel(): string {
      return this.promptIdentity.presetName
        || (this.promptIdentity.isDefault ? DEFAULT_CONTENT_REPLACE_PRESET_NAME : '自定义提示词');
    },
    promptTemplateMode(): 'default' | 'custom' {
      return this.promptIdentity.isDefault ? 'default' : 'custom';
    },
    lastOptimizedLabel(state): string {
      return state.lastOptimizedMessageIndex >= 0
        ? `第 ${state.lastOptimizedMessageIndex + 1} 条消息`
        : '暂无可重新优化的消息';
    },
  },
  actions: {
    refreshFromSettings(): void {
      const cfg = ensureSettingsShape();
      this.enabled = cfg.enabled === true;
      this.apiPresetNames = readApiPresetNames();
      this.apiPreset = this.apiPresetNames.includes(cfg.apiPreset) ? cfg.apiPreset : '';
      if (cfg.apiPreset !== this.apiPreset) cfg.apiPreset = this.apiPreset;
      this.seamlessMode = cfg.seamlessMode !== false;
      this.autoApply = cfg.autoApply !== false;
      this.showDiff = cfg.showDiff !== false;
      this.parallelMode = cfg.parallelMode === true;
      this.ignoreMvuUpdate = cfg.ignoreMvuUpdate === true;
      this.decisionGate = { ...cfg.decisionGate };
      this.minLength = cfg.minLength;
      this.maxOptimizations = cfg.maxOptimizations;
      this.loopCount = cfg.loopCount;
      this.retryCount = cfg.retryCount;
      this.extractTags = cfg.extractTags || '';
      this.excludeTags = cfg.excludeTags || '';
      this.extractRules = clone(cfg.extractRules || []);
      this.excludeRules = clone(cfg.excludeRules || []);
      this.promptGroup = clone(cfg.promptGroup || []);
      this.promptDirty = false;
      this.promptPresets = clone(cfg.promptPresets || []);
      this.lastOptimizedMessageIndex = getLastOptimizedMessageIndex_ACU();
      if (this.activePresetHint && !findMatchingPresetName(this.promptGroup, this.promptPresets, this.activePresetHint)) {
        this.activePresetHint = '';
      }
    },
    /**
     * R10B-03：开关/数字/标签只写基础字段。提示词草稿只在显式保存提示词或切换预设时落盘，
     * 否则编辑器里已放弃（或尚未保存）的半成品会被任意一次开关修改顺带写进设置。
     */
    saveBasicSettings(): boolean {
      const cfg = ensureSettingsShape();
      const snapshot = clone(cfg);
      this.writeBasicFields(cfg);
      const saved = persist(snapshot);
      const draft = this.promptDirty ? clone(this.promptGroup) : null;
      this.refreshFromSettings();
      if (draft) {
        this.promptGroup = draft;
        this.promptDirty = true;
      }
      return saved;
    },
    /** 编辑器确认放弃修改：从设置重新载入提示词组并清脏标记。 */
    discardPromptDraft(): void {
      const cfg = ensureSettingsShape();
      this.promptGroup = clone(cfg.promptGroup || []);
      this.promptDirty = false;
    },
    writeBasicFields(cfg: Record<string, any>): void {
      cfg.enabled = this.enabled;
      cfg.apiPreset = this.apiPreset;
      cfg.seamlessMode = this.seamlessMode;
      cfg.autoApply = this.autoApply;
      cfg.showDiff = this.showDiff;
      cfg.parallelMode = this.parallelMode;
      cfg.ignoreMvuUpdate = this.ignoreMvuUpdate;
      cfg.decisionGate = normalizeDecisionGateSettings_ACU(this.decisionGate);
      cfg.minLength = normalizeInteger(this.minLength, 100, 0, 1000000);
      cfg.maxOptimizations = normalizeInteger(this.maxOptimizations, 10, 1, 100);
      cfg.loopCount = normalizeInteger(this.loopCount, 1, 1, 10);
      cfg.retryCount = normalizeInteger(this.retryCount, 3, 1, 10);
      cfg.extractTags = this.extractTags;
      cfg.excludeTags = this.excludeTags;
      cfg.extractRules = normalizeExtractRules_ACU(this.extractRules, this.extractTags);
      cfg.excludeRules = normalizeExcludeRules_ACU(this.excludeRules, this.excludeTags);
    },
    saveToSettings(): boolean {
      const cfg = ensureSettingsShape();
      const snapshot = clone(cfg);
      const attemptedPromptGroup = clone(this.promptGroup);
      this.writeBasicFields(cfg);
      cfg.promptGroup = normalizePromptGroup(this.promptGroup);
      cfg.promptPresets = normalizePresets(this.promptPresets);
      const saved = persist(snapshot);
      this.refreshFromSettings();
      // 保存失败：设置已还原，但用户要保存的提示词留在编辑器里作为未保存草稿，便于重试
      if (!saved && JSON.stringify(attemptedPromptGroup) !== JSON.stringify(this.promptGroup)) {
        this.promptGroup = attemptedPromptGroup;
        this.promptDirty = true;
      }
      return saved;
    },
    setBoolean(key: 'enabled' | 'seamlessMode' | 'autoApply' | 'showDiff' | 'parallelMode' | 'ignoreMvuUpdate', value: boolean): void {
      this[key] = !!value;
      this.saveBasicSettings();
    },
    /** 替换前判定的开关 / key / 模型 / 门槛：规整后与其它基础字段一起落盘（门槛清空时回到默认值）。 */
    setDecisionGate(patch: Partial<Record<keyof DecisionGateSettings_ACU, unknown>>): void {
      this.decisionGate = normalizeDecisionGateSettings_ACU({ ...this.decisionGate, ...patch });
      this.saveBasicSettings();
    },
    /** 拉取 OpenRouter 当前的决策模型列表（公开接口，不需要 key）。 */
    async loadDecisionModels(): Promise<void> {
      if (this.decisionModelsLoading) return;
      this.decisionModelsLoading = true;
      try {
        this.decisionModels = await fetchDecisionModels_ACU();
      } catch (e: any) {
        logError_ACU('[ACU-V2] load decision models failed', e);
        setMessage(this, 'warning', `读取决策模型列表失败（${e?.message || '未知错误'}），可稍后重试；当前所选模型不受影响。`);
      } finally {
        this.decisionModelsLoading = false;
      }
    },
    /** 用测试文本问一次决策模型，不写回聊天；与自动判定同口径，先按提取/排除标签处理。 */
    async runDecisionTest(): Promise<void> {
      const filtered = applyContextTagFilters_ACU(this.testInput, {
        extractTags: this.extractTags.trim(),
        extractRules: this.extractRules,
        excludeTags: this.excludeTags.trim(),
        excludeRules: this.excludeRules,
      });
      const input = stripMvuUpdateBlocks_ACU(filtered).trim();
      if (input.length < 10) {
        setMessage(this, 'warning', '请输入至少 10 个字符的测试文本。');
        return;
      }
      if (!this.decisionGate.apiKey) {
        setMessage(this, 'warning', '请先填写 OpenRouter Key。');
        return;
      }
      if (this.busyAction) return;
      this.busyAction = 'decision-test';
      this.testOutput = '正在请求决策模型...';
      try {
        const verdict = await requestContentDecision_ACU(input, this.decisionGate);
        if (verdict.kind === 'error') {
          this.testOutput = `判定失败：${verdict.message}\n（自动替换时遇到这种情况会照常替换）`;
          setMessage(this, 'error', '上一次判定测试失败，请检查 Key 与网络。');
          return;
        }
        const goodPercent = Math.round(verdict.goodProbability * 100);
        this.testOutput = [
          `决策模型判定：${verdict.choice}（好 ${goodPercent}%，门槛 ${this.decisionGate.threshold}%）`,
          verdict.replace ? '→ 会替换这段正文' : '→ 不会替换这段正文',
          verdict.model ? `模型：${verdict.model}` : '',
        ].filter(Boolean).join('\n');
        clearMessageAndToast(this, 'success', '判定测试完成。', { muteable: false });
      } finally {
        this.busyAction = '';
      }
    },
    setString(key: 'apiPreset' | 'extractTags' | 'excludeTags' | 'testInput', value: string): void {
      this[key] = String(value ?? '');
      if (key !== 'testInput') this.saveBasicSettings();
    },
    setNumber(key: 'minLength' | 'maxOptimizations' | 'loopCount' | 'retryCount', value: number | string): void {
      const bounds = {
        minLength: [100, 0, 1000000],
        maxOptimizations: [10, 1, 100],
        loopCount: [1, 1, 10],
        retryCount: [3, 1, 10],
      } as const;
      const [fallback, min, max] = bounds[key];
      this[key] = normalizeInteger(value, fallback, min, max);
      this.saveBasicSettings();
    },
    setExtractRules(value: ContentReplaceRulePair[]): void {
      this.extractRules = coerceRulePairs(value);
      const cfg = ensureSettingsShape();
      const snapshot = clone(cfg);
      cfg.extractRules = normalizeExtractRules_ACU(this.extractRules, this.extractTags);
      cfg.extractTags = this.extractTags;
      if (!persist(snapshot)) this.extractRules = clone(cfg.extractRules || []);
    },
    setExcludeRules(value: ContentReplaceRulePair[]): void {
      this.excludeRules = coerceRulePairs(value);
      const cfg = ensureSettingsShape();
      const snapshot = clone(cfg);
      cfg.excludeRules = normalizeExcludeRules_ACU(this.excludeRules, this.excludeTags);
      cfg.excludeTags = this.excludeTags;
      if (!persist(snapshot)) this.excludeRules = clone(cfg.excludeRules || []);
    },
    addPromptSegment(position: 'top' | 'bottom'): void {
      const segment: ContentReplacePromptSegment = { role: 'USER', content: '', deletable: true };
      if (position === 'top') this.promptGroup.unshift(segment);
      else this.promptGroup.push(segment);
      this.promptDirty = true;
    },
    updatePromptSegment(index: number, patch: Partial<ContentReplacePromptSegment>): void {
      if (index < 0 || index >= this.promptGroup.length) return;
      this.promptGroup[index] = { ...this.promptGroup[index], ...patch };
      this.promptDirty = true;
    },
    deletePromptSegment(index: number): void {
      const target = this.promptGroup[index];
      if (!target || target.deletable === false) return;
      this.promptGroup.splice(index, 1);
      this.promptDirty = true;
    },
    resetPromptGroup(): void {
      this.promptGroup = defaultPromptGroup();
      this.promptDirty = true;
      setMessage(this, 'warning', '已载入默认正文替换提示词组，保存后生效。');
    },
    savePromptGroup(): void {
      if (!this.saveToSettings()) return;
      clearMessageAndToast(this, 'success', '正文替换提示词已保存。');
    },
    savePromptGroupToPreset(name: string): void {
      const normalized = String(name || '').trim();
      if (!normalized || normalized === CUSTOM_CONTENT_REPLACE_PRESET_VALUE) {
        this.savePromptGroup();
        return;
      }
      const index = this.promptPresets.findIndex(p => p.name === normalized);
      if (index < 0) {
        setMessage(this, 'warning', '找不到要保存的正文替换预设。');
        return;
      }
      this.promptPresets[index] = {
        name: normalized,
        promptGroup: normalizePromptGroup(this.promptGroup),
      };
      this.activePresetHint = normalized;
      if (!this.saveToSettings()) return;
      clearMessageAndToast(this, 'success', `预设"${normalized}"已更新。`);
    },
    selectPreset(name: string): void {
      const normalized = String(name || '').trim();
      if (normalized === CUSTOM_CONTENT_REPLACE_PRESET_VALUE) return;
      if (!normalized) {
        this.activePresetHint = '';
        this.promptGroup = defaultPromptGroup();
        this.saveToSettings();
        this.message = null;
        return;
      }
      const preset = this.promptPresets.find(p => p.name === normalized);
      if (!preset) return;
      this.activePresetHint = preset.name;
      this.promptGroup = clone(preset.promptGroup);
      this.saveToSettings();
      this.message = null;
    },
    createPresetFromDefault(): void {
      const name = uniquePresetName(this.promptPresets, '新正文替换预设');
      const nextPreset = { name, promptGroup: defaultPromptGroup() };
      this.promptPresets.push(nextPreset);
      this.activePresetHint = name;
      this.promptGroup = clone(nextPreset.promptGroup);
      this.saveToSettings();
      this.message = null;
    },
    deletePresetByName(name: string): void {
      if (!name) return;
      this.promptPresets = this.promptPresets.filter(p => p.name !== name);
      if (this.selectedPresetName === name) {
        this.activePresetHint = '';
        this.promptGroup = defaultPromptGroup();
      }
      this.saveToSettings();
      this.message = null;
    },
    renamePreset(oldName: string, newName: string): void {
      const source = String(oldName || '').trim();
      const target = String(newName || '').trim();
      if (!source || !target || source === target) return;
      if (target === DEFAULT_CONTENT_REPLACE_PRESET_NAME || target === CUSTOM_CONTENT_REPLACE_PRESET_VALUE) {
        setMessage(this, 'warning', '「默认预设」是内置预设，请换一个名称。');
        return;
      }
      const sourceIndex = this.promptPresets.findIndex(p => p.name === source);
      if (sourceIndex < 0) {
        setMessage(this, 'warning', '找不到要重命名的正文替换预设。');
        return;
      }
      if (this.promptPresets.some(p => p.name === target)) {
        setMessage(this, 'warning', `预设"${target}"已存在，请换一个名称。`);
        return;
      }
      this.promptPresets[sourceIndex] = {
        ...this.promptPresets[sourceIndex],
        name: target,
      };
      if (this.activePresetHint === source) this.activePresetHint = target;
      this.saveToSettings();
      this.message = null;
    },
    exportPresetByName(name: string): void {
      const preset = this.promptPresets.find(p => p.name === name);
      if (!preset) {
        setMessage(this, 'warning', '请先选择要导出的预设。');
        return;
      }
      if (this.busyAction) return;
      this.busyAction = 'export-preset';
      try {
        const safeName = preset.name.replace(/[^a-z0-9_\-\u4e00-\u9fa5]/gi, '_');
        downloadJsonToHost_ACU(`optimization_preset_${safeName}.json`, [preset]);
        clearMessageAndToast(this, 'success', '正文替换预设 JSON 已导出。');
      } finally {
        this.busyAction = '';
      }
    },
    async importPresets(file: File): Promise<void> {
      // R10B-13：只有一个忙碌槽，在途时拒绝其它耗时操作，避免先结束者提前解锁按钮
      if (this.busyAction) return;
      this.busyAction = 'import-presets';
      try {
        const text = await readFileText(file);
        const imported = normalizePresets(JSON.parse(text));
        if (!imported.length) throw new Error('未找到有效的正文替换预设。');
        let added = 0;
        let replaced = 0;
        for (const preset of imported) {
          const index = this.promptPresets.findIndex(p => p.name === preset.name);
          if (index >= 0) {
            this.promptPresets[index] = preset;
            replaced += 1;
          } else {
            this.promptPresets.push(preset);
            added += 1;
          }
        }
        this.activePresetHint = imported[0].name;
        this.promptGroup = clone(imported[0].promptGroup);
        if (!this.saveToSettings()) return;
        clearMessageAndToast(this, 'success', `已导入 ${added} 个正文替换预设，覆盖 ${replaced} 个同名预设。`, { muteable: false });
      } catch (e: any) {
        logError_ACU('[ACU-V2] import content replace presets failed', e);
        setMessage(this, 'error', `导入预设失败：${e?.message || '未知错误'}`);
      } finally {
        this.busyAction = '';
      }
    },
    async runTest(): Promise<void> {
      const input = this.testInput.trim();
      if (input.length < 10) {
        setMessage(this, 'warning', '请输入至少 10 个字符的测试文本。');
        return;
      }
      if (this.busyAction) return;
      this.busyAction = 'test';
      this.testOutput = '正在调用 AI 进行正文替换测试...';
      try {
        const result = await performContentOptimization_ACU(input, { currentLoop: 1, userMessage: '' });
        this.testOutput = formatOptimizationResult(result);
        if (result?.success) {
          clearMessageAndToast(this, 'success', '正文替换测试完成。', { muteable: false });
        } else {
          setMessage(this, 'error', '上一次正文替换测试失败，请检查配置或查看运行日志。');
          useToastStore().error(`正文替换测试失败：${result?.error || '未知错误'}`, { muteable: false });
        }
      } catch (e: any) {
        logError_ACU('[ACU-V2] content replace test failed', e);
        this.testOutput = `优化出错：${e?.message || '未知错误'}`;
        setMessage(this, 'error', '上一次正文替换测试失败，请检查配置或查看运行日志。');
        useToastStore().error(`正文替换测试失败：${e?.message || '未知错误'}`, { muteable: false });
      } finally {
        this.busyAction = '';
      }
    },
    /**
     * 优化当前正文：取最新一条 AI 回复此刻显示的正文（含已替换过的部分）再优化一次，可多次叠加。
     * 与「重新优化」（从替换前的原文重来）互补；首次替换保存的原文不被覆盖，之后仍可从原文重来。
     */
    async optimizeCurrentContent(): Promise<void> {
      if (!this.enabled) {
        setMessage(this, 'warning', '正文替换功能未启用。');
        return;
      }
      if (this.busyAction) return;
      const chat = getChatArray_ACU() || [];
      let messageIndex = -1;
      for (let i = chat.length - 1; i >= 0; i--) {
        if (isAiFloor_ACU(chat[i])) { messageIndex = i; break; }
      }
      const currentContent = messageIndex >= 0 ? String(chat[messageIndex]?.mes || '') : '';
      if (!currentContent.trim()) {
        setMessage(this, 'warning', '当前聊天里还没有可优化的 AI 回复。');
        return;
      }
      const writeTarget = captureChatMessageWriteTarget_ACU(messageIndex);
      this.busyAction = 'optimize-current';
      try {
        const result = await performContentOptimization_ACU(currentContent, { currentLoop: 1, userMessage: '' });
        if (!isChatMessageWriteTargetCurrent_ACU(writeTarget)) throw new Error(CHAT_MESSAGE_TARGET_CHANGED_MESSAGE_ACU);
        if (!result?.success) throw new Error(result?.error || '正文替换失败。');
        if (!Array.isArray(result.optimizations) || result.optimizations.length === 0) {
          clearMessageAndToast(this, 'info', '当前正文已足够好，无需再优化。', { muteable: false });
          return;
        }
        const success = await replaceChatMessage_ACU(messageIndex, result.optimizedContent, {
          originalContent: currentContent,
          expected: writeTarget,
        });
        if (!success) throw new Error('写回聊天消息失败。');
        this.refreshFromSettings();
        clearMessageAndToast(this, 'success', `已在当前正文基础上优化 ${result.optimizations.length} 处内容。`, { muteable: false });
      } catch (e: any) {
        logError_ACU('[ACU-V2] optimize current content failed', e);
        setMessage(this, 'error', '上一次优化当前正文失败，请检查配置或查看运行日志。');
        useToastStore().error(`优化当前正文失败：${e?.message || '未知错误'}`, { muteable: false });
      } finally {
        this.busyAction = '';
      }
    },
    async reoptimizeLatest(): Promise<void> {
      if (!this.enabled) {
        setMessage(this, 'warning', '正文替换功能未启用。');
        return;
      }
      const messageIndex = getLastOptimizedMessageIndex_ACU();
      const chatAtStart = getChatArray_ACU();
      const messageAtStart = chatAtStart[messageIndex];
      const chatIdentityAtStart = String(currentChatFileIdentifier_ACU || '');
      const messageIdAtStart = messageAtStart?.message_id;
      this.lastOptimizedMessageIndex = messageIndex;
      if (messageIndex < 0) {
        setMessage(this, 'warning', '当前还没有已被正文替换过的 AI 回复。');
        return;
      }
      if (this.busyAction) return;
      this.busyAction = 'reoptimize';
      try {
        const originalContent = getOriginalContent_ACU(messageIndex);
        if (!originalContent) throw new Error('无法获取上次替换前的原文。');
        const result = await performContentOptimization_ACU(originalContent, { currentLoop: 1, userMessage: '' });
        const currentChat = getChatArray_ACU();
        const currentMessage = currentChat[messageIndex];
        const chatChanged = Boolean(chatIdentityAtStart || messageAtStart)
          && (currentChat !== chatAtStart
            || String(currentChatFileIdentifier_ACU || '') !== chatIdentityAtStart
            || currentMessage !== messageAtStart
            || (messageIdAtStart != null && currentMessage?.message_id !== messageIdAtStart));
        if (chatChanged) throw new Error('聊天已切换，旧正文的优化结果已拒绝写回。');
        if (!result?.success) throw new Error(result?.error || '正文替换失败。');
        if (!Array.isArray(result.optimizations) || result.optimizations.length === 0) {
          clearMessageAndToast(this, 'info', '原文已足够好，无需重新替换。', { muteable: false });
          return;
        }
        const success = await replaceChatMessage_ACU(messageIndex, result.optimizedContent, { originalContent });
        if (!success) throw new Error('写回聊天消息失败。');
        this.refreshFromSettings();
        clearMessageAndToast(this, 'success', `已重新优化并替换 ${result.optimizations.length} 处内容。`, { muteable: false });
      } catch (e: any) {
        logError_ACU('[ACU-V2] reoptimize latest failed', e);
        setMessage(this, 'error', '上一次重新优化失败，请检查配置或查看运行日志。');
        useToastStore().error(`重新优化失败：${e?.message || '未知错误'}`, { muteable: false });
      } finally {
        this.busyAction = '';
      }
    },
  },
});
