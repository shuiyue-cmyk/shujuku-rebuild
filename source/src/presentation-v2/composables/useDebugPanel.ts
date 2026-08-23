/**
 * useDebugPanel — 高级工具「Debug」卡片：傻瓜式问题上报
 *
 * 用法：用户遇到可复现问题 → 打开 Debug → 复现 → 导出 .json → 把文件喂给
 * 开发者/Agent 即可定位。
 *
 * 导出内容（全量）：
 * - meta：插件版本（manifest）/构建水印/宿主类型（ST/TT/Luker）/导出时间
 * - env：API 配置（密钥脱敏）/关键运行设置摘要
 * - settingsSnapshot：全量 settings_ACU 脱敏快照
 * - worldbookDebug：最近一次世界书扫描（entryCount/baseScanLen/chatLen/triggeredCount/shouldUseWorker）
 * - lastApiBody：最近一次 buildCustomApiRequestBody 完整请求体（脱敏）与时间
 * - logs：log-buffer 全量日志（含 Debug 采集开启后的细粒度日志）
 * - biotracker：最近一次追踪/注册请求与响应（biotracker debug 采集数据，body 已脱敏）
 * - tables：表名 + 行数 + 脱敏 sampleRows（前 3 行各前 8 列，超长截断）
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  clearLogs,
  getAllLogs,
  isDebugLogEnabled,
  isWarnLogEnabled,
  setDebugLogEnabled,
  setWarnLogEnabled,
  subscribe,
  type LogEntry,
} from '../../shared/log-buffer';
import { getAcuHostDocument } from '../bootstrap/host-document';
import { useToastStore } from '../stores/toast-store';
import { getAcuHostKind } from '../../shared/host-bridge';
import { settings_ACU, currentJsonTableData_ACU, currentChatFileIdentifier_ACU } from '../../service/runtime/state-manager';

function getBuildStamp(): string {
  try {
    const stamp = (globalThis as any).__ACU_BUILD_STAMP__;
    return typeof stamp === 'string' && stamp ? stamp : 'dev';
  } catch {
    return 'dev';
  }
}

function getPluginVersion(): string {
  try {
    const v = (globalThis as any).__ACU_BUILD_VERSION__;
    return typeof v === 'string' && v ? v : 'unknown';
  } catch {
    return 'unknown';
  }
}

function maskSecret(value: unknown): string {
  if (typeof value !== 'string' || !value) return String(value ?? '');
  if (value.length <= 8) return '***';
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

const SENSITIVE_KEYS = /^(api[_-]?key|apikey|key|token|authorization|auth|password|proxy[_-]?password|secret|bearer|accessToken|access_token)$/i;

function maskSensitiveString(str: string): string {
  return str
    .replace(/(Authorization\s*:\s*Bearer\s+)([^\s"',}\n]+)/gi, '$1***')
    .replace(/(Bearer\s+)(sk-[A-Za-z0-9-_]+)/g, '$1***')
    .replace(/([?&](?:api[_-]?key|token|authorization)=)([^&#\s"',}]+)/gi, '$1***')
    .replace(/("(?:api[_-]?key|apikey|authorization|token|password|secret)"\s*:\s*")([^"]+)(")/gi, '$1***$3');
}

 /** 递归脱敏对象中的敏感字段（biotracker 请求/响应快照可能含 Authorization/key 回显） */
function maskSensitiveFields(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return maskSensitiveString(value);
  if (depth > 6) return '[Truncated]';
  if (Array.isArray(value)) {
    if (value.length > 200) return `[Array(${value.length}) truncated]`;
    return value.map(v => maskSensitiveFields(v, depth + 1, seen));
  }
  if (value && typeof value === 'object') {
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(k)) {
        out[k] = v && typeof v === 'object' ? maskSensitiveFields(v, depth + 1, seen) : maskSecret(v);
      } else {
        out[k] = maskSensitiveFields(v, depth + 1, seen);
      }
    }
    return out;
  }
  return value;
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const doc = getAcuHostDocument();
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  // 延迟 revoke：WebView2/部分内核在 click 后立即 revoke 会取消下载
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useDebugPanel() {
  const toast = useToastStore();
  const active = ref(false);
  const entryCount = ref(0);
  /** Debug 开启时刻：导出时只包含开启后的日志（避免无关历史噪音） */
  let startedAt = 0;
  let unsubscribe: (() => void) | null = null;

  const statusLabel = computed(() => (active.value ? '采集中' : '未开启'));

  function refreshCount(): void {
    entryCount.value = getAllLogs().length;
  }

  function startDebug(): void {
    setDebugLogEnabled(true);
    setWarnLogEnabled(true);
    // 清空旧日志，让导出只含本次排查内容
    clearLogs();
    startedAt = Date.now();
    active.value = true;
    refreshCount();
    toast.info('Debug 采集已开启：请复现问题，完成后点「导出 Debug 数据」。');
  }

  function stopDebug(): void {
    if (!active.value) {
      toast.warning('Debug 未开启，无需停止。');
      return;
    }
    // 增强：停止时自动导出一次，避免用户忘记点导出
    try {
      const allLogs = getAllLogs();
      const logs: LogEntry[] = startedAt ? allLogs.filter((e) => e.timestamp >= startedAt) : allLogs;
      if (logs.length > 0) {
        // 复用导出逻辑但不依赖 active 状态
        const effectiveStart = startedAt || (allLogs[0]?.timestamp ?? Date.now());
        const cfg = settings_ACU?.apiConfig || {};
        const activePreset = (() => {
          try {
            const name = String((settings_ACU as any)?.apiPresetBindingsByChat?.[String(currentChatFileIdentifier_ACU || '').trim()]?.presetName || (settings_ACU as any)?.defaultApiPresetName || '').trim();
            if (!name) return null;
            const list = Array.isArray((settings_ACU as any)?.apiPresets) ? (settings_ACU as any).apiPresets : [];
            return list.find((p: any) => p?.name === name) || null;
          } catch { return null; }
        })();
        const presetCfg = activePreset?.apiConfig || null;
        const env = {
          host: getAcuHostKind(),
          buildStamp: getBuildStamp(),
          version: getPluginVersion(),
          exportedAt: new Date().toISOString(),
          chatId: currentChatFileIdentifier_ACU,
          streamingEnabled: presetCfg ? presetCfg.streamingEnabled === true : settings_ACU?.streamingEnabled === true,
          streamingEnabledGlobal: settings_ACU?.streamingEnabled === true,
          streamingEnabledPreset: presetCfg ? presetCfg.streamingEnabled === true : undefined,
          reasoningEffort: presetCfg?.reasoningEffort || (settings_ACU as any)?.reasoningEffort || 'medium',
          reasoningEffortPreset: presetCfg?.reasoningEffort,
          reasoningEffortGlobal: (settings_ACU as any)?.reasoningEffort,
          activePresetName: activePreset?.name || '',
          worldbookSource: (settings_ACU as any)?.worldbookConfig?.source || (settings_ACU as any)?.characterSettings?.[String(currentChatFileIdentifier_ACU || '').trim()]?.worldbookConfig?.source || '',
          formFillPromptLength: Array.isArray((settings_ACU as any)?.charCardPrompt) ? (settings_ACU as any).charCardPrompt.length : 0,
          nonPrefillSupport: settings_ACU?.nonPrefillSupport === true,
          nonPrefillSupportPreset: activePreset?.nonPrefillSupport,
          apiMode: settings_ACU?.apiMode || '',
          apiConfig: {
            url: typeof cfg.url === 'string' ? cfg.url : '',
            model: typeof cfg.model === 'string' ? cfg.model : '',
            apiKey: maskSecret(cfg.apiKey),
            temperature: cfg.temperature,
            max_tokens: cfg.max_tokens,
          },
          plotEnabled: settings_ACU?.plotSettings?.enabled === true,
          biotrackerEnabled: settings_ACU?.bs_biotracker?.enabled === true,
          autoRegister: settings_ACU?.bs_biotracker?.autoRegister === true,
        };
        const biotrackerDebug: Record<string, unknown> = {};
        try {
          const req = (globalThis as any).__bs_biotracker_debug_last_effective_request__;
          const resp = (globalThis as any).__bs_biotracker_debug_last_api_response__;
          if (req) biotrackerDebug.lastRequest = maskSensitiveFields(req);
          if (resp) biotrackerDebug.lastResponse = maskSensitiveFields(resp);
          const trackerReq = (globalThis as any).__bs_biotracker_debug_last_tracker_request__;
          const trackerResult = (globalThis as any).__bs_biotracker_debug_last_tracker_result__;
          if (trackerReq) biotrackerDebug.lastTrackerRequest = maskSensitiveFields(trackerReq);
          if (trackerResult) biotrackerDebug.lastTrackerResult = maskSensitiveFields(trackerResult);
        } catch {}
        const tables: Record<string, { rows: number; headers: string[]; sampleRows?: unknown[][] }> = {};
        try {
          const data = currentJsonTableData_ACU || {};
          for (const [key, sheet] of Object.entries(data)) {
            if (key === 'mate') continue;
            const content = Array.isArray((sheet as any)?.content) ? (sheet as any).content : [];
            const rows = Math.max(0, content.length - 1);
            const headers = Array.isArray(content[0]) ? content[0].map(String) : [];
            const sampleRows = content.slice(1, 4).map((r: any) => Array.isArray(r) ? r.slice(0, 8).map((c: any) => typeof c === 'string' && c.length > 200 ? c.slice(0, 200) + '…' : c) : r);
            tables[key] = { rows, headers, ...(sampleRows.length ? { sampleRows } : {}) };
          }
        } catch {}
        let settingsSnapshot: unknown = null;
        try { settingsSnapshot = maskSensitiveFields(JSON.parse(JSON.stringify(settings_ACU))); } catch { settingsSnapshot = '[Snapshot failed]'; }
        const worldbookDebug = (() => {
          try { return (globalThis as any).__ACU_DEBUG_LAST_WORLDBOOK__ || null; } catch { return null; }
        })();
        const lastApiBody = (() => {
          try { return (globalThis as any).__ACU_DEBUG_LAST_API_BODY__ || null; } catch { return null; }
        })();
        const lastApiBodyAt = (() => {
          try { return (globalThis as any).__ACU_DEBUG_LAST_API_BODY_AT__ || null; } catch { return null; }
        })();
        const payload = {
          meta: {
            plugin: '幻想·数据库',
            version: env.version,
            buildStamp: env.buildStamp,
            host: env.host,
            exportedAt: env.exportedAt,
            debugStartedAt: new Date(effectiveStart).toISOString(),
          },
          env,
          settingsSnapshot,
          worldbookDebug: worldbookDebug ? maskSensitiveFields(worldbookDebug) : null,
          lastApiBody: lastApiBody ? maskSensitiveFields(lastApiBody) : null,
          lastApiBodyAt: lastApiBodyAt ? new Date(lastApiBodyAt).toISOString() : null,
          logCount: logs.length,
          logs: logs.map((e) => ({
            time: new Date(e.timestamp).toISOString(),
            level: e.level,
            tag: e.tag,
            message: e.message,
          })),
          biotracker: biotrackerDebug,
          tables,
        };
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        downloadJson(`acu-debug-${stamp}.json`, payload);
        toast.success(`Debug 采集已停止，已自动导出 ${logs.length} 条日志。`);
      } else {
        toast.success('Debug 采集已停止（无日志可导出）。');
      }
    } catch (e) {
      toast.success('Debug 采集已停止（自动导出失败，请手动导出）。');
    }
    setDebugLogEnabled(false);
    setWarnLogEnabled(false);
    active.value = false;
  }

  function toggleDebug(): void {
    if (active.value) stopDebug();
    else startDebug();
  }

  function exportDebugData(): void {
    if (!active.value) {
      toast.warning('请先开启 Debug 采集再导出。');
      return;
    }
    const allLogs = getAllLogs();
    // 仅当通过本页 startDebug 启动时才按时间切片；持久化 active 导致 startedAt===0 时不切片，避免空导出
    const logs: LogEntry[] = startedAt ? allLogs.filter((e) => e.timestamp >= startedAt) : allLogs;
    const effectiveStart = startedAt || (allLogs[0]?.timestamp ?? Date.now());
    const cfg = settings_ACU?.apiConfig || {};
    const activePreset = (() => {
      try {
        const name = String((settings_ACU as any)?.apiPresetBindingsByChat?.[String(currentChatFileIdentifier_ACU || '').trim()]?.presetName || (settings_ACU as any)?.defaultApiPresetName || '').trim();
        if (!name) return null;
        const list = Array.isArray((settings_ACU as any)?.apiPresets) ? (settings_ACU as any).apiPresets : [];
        return list.find((p: any) => p?.name === name) || null;
      } catch { return null; }
    })();
    const presetCfg = activePreset?.apiConfig || null;
    const env = {
      host: getAcuHostKind(),
      buildStamp: getBuildStamp(),
      version: getPluginVersion(),
      exportedAt: new Date().toISOString(),
      chatId: currentChatFileIdentifier_ACU,
      streamingEnabled: presetCfg ? presetCfg.streamingEnabled === true : settings_ACU?.streamingEnabled === true,
      streamingEnabledGlobal: settings_ACU?.streamingEnabled === true,
      streamingEnabledPreset: presetCfg ? presetCfg.streamingEnabled === true : undefined,
      reasoningEffort: presetCfg?.reasoningEffort || (settings_ACU as any)?.reasoningEffort || 'medium',
      reasoningEffortPreset: presetCfg?.reasoningEffort,
      reasoningEffortGlobal: (settings_ACU as any)?.reasoningEffort,
      activePresetName: activePreset?.name || '',
      worldbookSource: (settings_ACU as any)?.worldbookConfig?.source || (settings_ACU as any)?.characterSettings?.[String(currentChatFileIdentifier_ACU || '').trim()]?.worldbookConfig?.source || '',
      formFillPromptLength: Array.isArray((settings_ACU as any)?.charCardPrompt) ? (settings_ACU as any).charCardPrompt.length : 0,
      nonPrefillSupport: settings_ACU?.nonPrefillSupport === true,
      nonPrefillSupportPreset: activePreset?.nonPrefillSupport,
      apiMode: settings_ACU?.apiMode || '',
      apiConfig: {
        url: typeof cfg.url === 'string' ? cfg.url : '',
        model: typeof cfg.model === 'string' ? cfg.model : '',
        apiKey: maskSecret(cfg.apiKey),
        temperature: cfg.temperature,
        max_tokens: cfg.max_tokens,
      },
      plotEnabled: settings_ACU?.plotSettings?.enabled === true,
      biotrackerEnabled: settings_ACU?.bs_biotracker?.enabled === true,
      autoRegister: settings_ACU?.bs_biotracker?.autoRegister === true,
    };

    const biotrackerDebug: Record<string, unknown> = {};
    try {
      const req = (globalThis as any).__bs_biotracker_debug_last_effective_request__;
      const resp = (globalThis as any).__bs_biotracker_debug_last_api_response__;
      if (req) biotrackerDebug.lastRequest = maskSensitiveFields(req);
      if (resp) biotrackerDebug.lastResponse = maskSensitiveFields(resp);
      const trackerReq = (globalThis as any).__bs_biotracker_debug_last_tracker_request__;
      const trackerResult = (globalThis as any).__bs_biotracker_debug_last_tracker_result__;
      if (trackerReq) biotrackerDebug.lastTrackerRequest = maskSensitiveFields(trackerReq);
      if (trackerResult) biotrackerDebug.lastTrackerResult = maskSensitiveFields(trackerResult);
    } catch { /* biotracker debug 数据读取失败不影响导出 */ }

    const tables: Record<string, { rows: number; headers: string[]; sampleRows?: unknown[][] }> = {};
    try {
      const data = currentJsonTableData_ACU || {};
      for (const [key, sheet] of Object.entries(data)) {
        if (key === 'mate') continue;
        const content = Array.isArray((sheet as any)?.content) ? (sheet as any).content : [];
        const rows = Math.max(0, content.length - 1);
        const headers = Array.isArray(content[0]) ? content[0].map(String) : [];
        const sampleRows = content.slice(1, 4).map((r: any) => Array.isArray(r) ? r.slice(0, 8).map((c: any) => typeof c === 'string' && c.length > 200 ? c.slice(0, 200) + '…' : c) : r);
        tables[key] = { rows, headers, ...(sampleRows.length ? { sampleRows } : {}) };
      }
    } catch { /* 表统计失败不影响导出 */ }

    let settingsSnapshot: unknown = null;
    try { settingsSnapshot = maskSensitiveFields(JSON.parse(JSON.stringify(settings_ACU))); } catch { settingsSnapshot = '[Snapshot failed]'; }
    const worldbookDebug = (() => {
      try { return (globalThis as any).__ACU_DEBUG_LAST_WORLDBOOK__ || null; } catch { return null; }
    })();
    const lastApiBody = (() => {
      try { return (globalThis as any).__ACU_DEBUG_LAST_API_BODY__ || null; } catch { return null; }
    })();
    const lastApiBodyAt = (() => {
      try { return (globalThis as any).__ACU_DEBUG_LAST_API_BODY_AT__ || null; } catch { return null; }
    })();

    const payload = {
      meta: {
        plugin: '幻想·数据库',
        version: env.version,
        buildStamp: env.buildStamp,
        host: env.host,
        exportedAt: env.exportedAt,
        debugStartedAt: new Date(effectiveStart).toISOString(),
      },
      env,
      settingsSnapshot,
      worldbookDebug: worldbookDebug ? maskSensitiveFields(worldbookDebug) : null,
      lastApiBody: lastApiBody ? maskSensitiveFields(lastApiBody) : null,
      lastApiBodyAt: lastApiBodyAt ? new Date(lastApiBodyAt).toISOString() : null,
      logCount: logs.length,
      logs: logs.map((e) => ({
        time: new Date(e.timestamp).toISOString(),
        level: e.level,
        tag: e.tag,
        message: e.message,
      })),
      biotracker: biotrackerDebug,
      tables,
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(`acu-debug-${stamp}.json`, payload);
    toast.success(`已导出 ${logs.length} 条日志。`);
  }

  onMounted(() => {
    // 默认关闭：每次进入高级工具均不自动开启，需用户显式点“开始 Debug”
    setDebugLogEnabled(false);
    setWarnLogEnabled(false);
    active.value = false;
    startedAt = 0;
    refreshCount();
    unsubscribe = subscribe(() => refreshCount());
  });
  onBeforeUnmount(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  return {
    active,
    entryCount,
    statusLabel,
    toggleDebug,
    exportDebugData,
  };
}
