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
import { settings_ACU, currentJsonTableData_ACU } from '../../service/runtime/state-manager';

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
    const m = (globalThis as any).__ACU_MANIFEST__;
    if (m && typeof m.version === 'string') return m.version;
  } catch { /* ignore */ }
  return 'unknown';
}

function maskSecret(value: unknown): string {
  if (typeof value !== 'string' || !value) return String(value ?? '');
  if (value.length <= 8) return '***';
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
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
  URL.revokeObjectURL(url);
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
    const logs: LogEntry[] = getAllLogs();
    const cfg = settings_ACU?.apiConfig || {};
    const env = {
      host: getAcuHostKind(),
      buildStamp: getBuildStamp(),
      version: getPluginVersion(),
      exportedAt: new Date().toISOString(),
      streamingEnabled: settings_ACU?.streamingEnabled === true,
      nonPrefillSupport: settings_ACU?.nonPrefillSupport === true,
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
      if (req) biotrackerDebug.lastRequest = req;
      if (resp) biotrackerDebug.lastResponse = resp;
      const trackerReq = (globalThis as any).__bs_biotracker_debug_last_tracker_request__;
      const trackerResult = (globalThis as any).__bs_biotracker_debug_last_tracker_result__;
      if (trackerReq) biotrackerDebug.lastTrackerRequest = trackerReq;
      if (trackerResult) biotrackerDebug.lastTrackerResult = trackerResult;
    } catch { /* biotracker debug 数据读取失败不影响导出 */ }

    const tables: Record<string, number> = {};
    try {
      const data = currentJsonTableData_ACU || {};
      for (const [key, sheet] of Object.entries(data)) {
        if (key === 'mate') continue;
        const rows = Array.isArray((sheet as any)?.content) ? Math.max(0, (sheet as any).content.length - 1) : 0;
        tables[key] = rows;
      }
    } catch { /* 表统计失败不影响导出 */ }

    const payload = {
      meta: {
        plugin: '幻想·数据库',
        version: env.version,
        buildStamp: env.buildStamp,
        host: env.host,
        exportedAt: env.exportedAt,
        debugStartedAt: new Date(startedAt).toISOString(),
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
