/**
 * import-flow-store — 外部导入页响应式状态边界（阶段 2 / D21）
 *
 * 直接读写 settings_ACU 的导入相关字段；按 D21.5 反映底层暂存缓存实时状态。
 * Vue 组件只通过本 store 读写，绝不直接 import settings_ACU。
 */
import { defineStore } from 'pinia';
import { settings_ACU, currentJsonTableData_ACU } from '../../service/runtime/state-manager';
import { saveSettings_ACU } from '../../service/settings/settings-service';
import { importTempGet_ACU } from '../../shared/idb-import-temp';
import {
  STORAGE_KEY_IMPORTED_ENTRIES_ACU,
  STORAGE_KEY_IMPORTED_STATUS_ACU,
} from '../../shared/data-constants';
import { getSortedSheetKeys_ACU } from '../../service/template/chat-scope';
import { parseTableTemplateJson_ACU, logError_ACU } from '../../shared/utils';

export interface StagingMeta {
  /** Whether IndexedDB has cached chunks for the current import. */
  hasChunks: boolean;
  /** Number of chunks. */
  chunkCount: number;
  /** Total characters across all chunks. */
  totalChars: number;
  /** Resume status: how many chunks already processed. null if no resume status. */
  processedIndex: number | null;
  /** Selection signature stored alongside resume status. */
  selectionSig: string | null;
}

export interface ImportFlowState {
  /** Selected target worldbook for injection. Empty string means none. 'character' means current char primary. */
  worldbookTarget: string;
  /** Encoding for FileReader (transient, not persisted to settings). */
  encoding: 'UTF-8' | 'GBK' | 'Big5';
  /** Split size in characters. */
  splitSize: number;
  /** Selected sheet keys for table-targeted injection. */
  selectedSheetKeys: string[];
  /** Whether the user has explicitly chosen sheets at least once. */
  hasTableSelection: boolean;
  /** Available sheet keys derived from current data / template. */
  availableSheetKeys: string[];
  /** sheet key -> display name. */
  sheetNames: Record<string, string>;
  /** Reflects IndexedDB staging state (D21.5). */
  staging: StagingMeta;
  /** Status text (computed but stored for testability). */
  busy: boolean;
}

const EMPTY_STAGING: StagingMeta = {
  hasChunks: false,
  chunkCount: 0,
  totalChars: 0,
  processedIndex: null,
  selectionSig: null,
};

function clampSplitSize(value: any): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 10000;
  return Math.max(100, Math.floor(n));
}

function normalizeEncoding(value: any): 'UTF-8' | 'GBK' | 'Big5' {
  if (value === 'UTF-8' || value === 'GBK' || value === 'Big5') return value;
  return 'GBK';
}

function readSheetSource(): { keys: string[]; names: Record<string, string> } {
  let dataSource = currentJsonTableData_ACU;
  if (!dataSource) {
    try {
      dataSource = parseTableTemplateJson_ACU({ stripSeedRows: false });
    } catch (e) {
      logError_ACU('[ACU-V2] failed to parse template for sheet keys', e);
      return { keys: [], names: {} };
    }
  }
  if (!dataSource || typeof dataSource !== 'object') return { keys: [], names: {} };
  const keys = getSortedSheetKeys_ACU(dataSource) || [];
  const names: Record<string, string> = {};
  for (const k of keys) {
    const sheet = (dataSource as any)[k];
    names[k] = (sheet && typeof sheet === 'object' && typeof sheet.name === 'string' && sheet.name) || k;
  }
  return { keys, names };
}

function resolveSelectedSheetKeys(keys: string[], saved: string[], hasExplicitSelection: boolean): string[] {
  const valid = new Set(keys);
  if (!hasExplicitSelection) return keys.slice();
  return saved.filter(key => valid.has(key));
}

export const useImportFlowStore = defineStore('acuV2ImportFlow', {
  state: (): ImportFlowState => ({
    worldbookTarget: '',
    encoding: 'GBK',
    splitSize: 10000,
    selectedSheetKeys: [],
    hasTableSelection: false,
    availableSheetKeys: [],
    sheetNames: {},
    staging: { ...EMPTY_STAGING },
    busy: false,
  }),

  getters: {
    canInject(state): boolean {
      if (!state.staging.hasChunks) return false;
      if (!state.worldbookTarget) return false;
      if (state.hasTableSelection && state.selectedSheetKeys.length === 0) return false;
      return !state.busy;
    },
    statusText(state): string {
      if (state.busy) return '状态：正在处理...';
      if (!state.staging.hasChunks) return '状态：尚未加载文件。';
      if (state.hasTableSelection && state.selectedSheetKeys.length === 0) {
        return '状态：未选择任何表格，无法注入。';
      }
      const total = state.staging.chunkCount;
      const idx = state.staging.processedIndex;
      if (idx != null && idx >= 0 && idx < total) {
        return `状态：已暂停，完成 ${idx}/${total}。`;
      }
      return `状态：已准备好 ${total} 个条目可供注入。`;
    },
  },

  actions: {
    refreshFromSettings(): void {
      const target = typeof settings_ACU.importWorldbookTarget === 'string'
        ? settings_ACU.importWorldbookTarget
        : '';
      this.worldbookTarget = target;
      this.splitSize = clampSplitSize(settings_ACU.importSplitSize);
      const selected = Array.isArray(settings_ACU.importSelectedTables)
        ? settings_ACU.importSelectedTables.filter((k: any) => typeof k === 'string')
        : [];
      const sheets = readSheetSource();
      this.availableSheetKeys = sheets.keys;
      this.sheetNames = sheets.names;
      this.hasTableSelection = settings_ACU.hasImportTableSelection === true;
      this.selectedSheetKeys = resolveSelectedSheetKeys(sheets.keys, selected, this.hasTableSelection);
    },

    setWorldbookTarget(value: string): void {
      this.worldbookTarget = value;
      settings_ACU.importWorldbookTarget = value;
      saveSettings_ACU();
    },

    setEncoding(value: 'UTF-8' | 'GBK' | 'Big5'): void {
      this.encoding = normalizeEncoding(value);
    },

    setSplitSize(value: number): void {
      this.splitSize = clampSplitSize(value);
      settings_ACU.importSplitSize = this.splitSize;
      saveSettings_ACU();
    },

    setSelectedSheetKeys(keys: string[]): void {
      const set = new Set(keys);
      const ordered = this.availableSheetKeys.filter(k => set.has(k));
      this.selectedSheetKeys = ordered;
      this.hasTableSelection = true;
      settings_ACU.importSelectedTables = ordered.slice();
      settings_ACU.hasImportTableSelection = true;
      saveSettings_ACU();
    },

    selectAllSheets(): void {
      this.setSelectedSheetKeys(this.availableSheetKeys.slice());
    },

    selectNoneSheets(): void {
      this.setSelectedSheetKeys([]);
    },

    refreshSheetSource(): void {
      const sheets = readSheetSource();
      this.availableSheetKeys = sheets.keys;
      this.sheetNames = sheets.names;
      const next = resolveSelectedSheetKeys(sheets.keys, this.selectedSheetKeys, this.hasTableSelection);
      if (next.length !== this.selectedSheetKeys.length) {
        this.selectedSheetKeys = next;
        if (this.hasTableSelection) {
          settings_ACU.importSelectedTables = next.slice();
          saveSettings_ACU();
        }
      }
    },

    async refreshStaging(): Promise<void> {
      try {
        const [entriesJson, statusJson] = await Promise.all([
          importTempGet_ACU(STORAGE_KEY_IMPORTED_ENTRIES_ACU),
          importTempGet_ACU(STORAGE_KEY_IMPORTED_STATUS_ACU),
        ]);

        if (!entriesJson) {
          this.staging = { ...EMPTY_STAGING };
          return;
        }
        let chunks: any[] = [];
        try { chunks = JSON.parse(entriesJson); } catch { chunks = []; }
        if (!Array.isArray(chunks) || chunks.length === 0) {
          this.staging = { ...EMPTY_STAGING };
          return;
        }
        let totalChars = 0;
        for (const c of chunks) {
          const text = c && typeof c === 'object' && typeof c.content === 'string' ? c.content : '';
          totalChars += text.length;
        }
        let processedIndex: number | null = null;
        let selectionSig: string | null = null;
        if (statusJson) {
          try {
            const s = JSON.parse(statusJson);
            if (s && typeof s.currentIndex === 'number') processedIndex = s.currentIndex;
            if (s && typeof s.selectionSig === 'string') selectionSig = s.selectionSig;
          } catch { /* swallow */ }
        }
        this.staging = {
          hasChunks: true,
          chunkCount: chunks.length,
          totalChars,
          processedIndex,
          selectionSig,
        };
      } catch (e) {
        logError_ACU('[ACU-V2] refreshStaging failed', e);
        this.staging = { ...EMPTY_STAGING };
      }
    },

    setBusy(value: boolean): void {
      this.busy = value;
    },
  },
});
