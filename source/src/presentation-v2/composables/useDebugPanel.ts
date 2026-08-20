/**
 * useDebugPanel — 高级工具「Debug」卡片：傻瓜式问题上报
 *
 * 用法：用户遇到可复现问题 → 打开 Debug → 复现 → 导出 .json → 把文件喂给
 * 开发者/Agent 即可定位。
 *
 * 导出内容（全量）：
 * - meta：插件版本（manifest）/构建水印/宿主类型（ST/TT/Luker）/导出时间
 * - env：API 配置（密钥脱敏）/关键运行设置摘要
 * - logs：log-buffer 全量日志（含 Debug 采集开启后的细粒度日志）
 * - biotracker：最近一次追踪/注册请求与响应（biotracker debug 采集数据，body 已脱敏）
 * - tables：表名 + 行数（不含数据本身，避免体积爆炸与隐私）
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

/** 递归脱敏对象中的敏感字段（biotracker 请求/响应快照可能含 Authorization/key 回显） */
function maskSensitiveFields(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
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
    setDebugLogEnabled(false);
    setWarnLogEnabled(false);
    active.value = false;
    toast.success('Debug 采集已停止。');
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

    const tables: Record<string, { rows: number; headers: string[] }> = {};
    try {
      const data = currentJsonTableData_ACU || {};
      for (const [key, sheet] of Object.entries(data)) {
        if (key === 'mate') continue;
        const content = Array.isArray((sheet as any)?.content) ? (sheet as any).content : [];
        const rows = Math.max(0, content.length - 1);
        const headers = Array.isArray(content[0]) ? content[0].map(String) : [];
        tables[key] = { rows, headers };
      }
    } catch { /* 表统计失败不影响导出 */ }

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
    active.value = isDebugLogEnabled() || isWarnLogEnabled();
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
