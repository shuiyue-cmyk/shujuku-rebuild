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
 * - logs：调用那一刻 log-buffer 缓冲区全量（含点 Debug 之前攒下的 error，不按采集起始切片）
 * - tables：表名 + 行数 + 脱敏 sampleRows（前 3 行各前 8 列，超长截断）
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  clearLogs,
  getAllLogs,
  getLogCount,
  getClearHistory_ACU,
  isDebugLogEnabled,
  maskSensitiveText_ACU,
  subscribeToClear,
  setDebugLogEnabled,
  setWarnLogEnabledByDebugCapture_ACU,
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
  // 密钥一律全掩码：此前返回前后各 3 字符（如 sk-***123），6 个有效字符会显著降低爆破空间，
  // 且该值会进入可被转发的 acu-debug-*.json 导出包。
  if (typeof value !== 'string' || !value) return typeof value === 'string' ? value : String(value ?? '');
  return '***';
}

const SENSITIVE_KEYS = /^(api[_-]?key|apikey|key|token|authorization|auth|password|proxy[_-]?password|secret|bearer|accessToken|access_token)$/i;
// 复合键后缀：embeddingApiKey / rerankApiKey 这类以敏感词结尾但带前缀的键，锚定式漏网（与 log-buffer 同规则）。
const SENSITIVE_KEY_SUFFIX = /(api[_-]?key|apikey|token|authorization|password|secret|bearer)$/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.test(key) || SENSITIVE_KEY_SUFFIX.test(key);
}

function maskSensitiveString(str: string): string {
  return str
    .replace(/(Authorization\s*:\s*Bearer\s+)([^\s"',}\n]+)/gi, '$1***')
    .replace(/(Bearer\s+)(sk-[A-Za-z0-9-_]+)/g, '$1***')
    .replace(/([?&](?:api[_-]?key|apikey|key|secret|token|authorization)=)([^&#\s"',}]+)/gi, '$1***')
    .replace(/("(?:api[_-]?key|apikey|authorization|token|password|secret)"\s*:\s*")([^"]+)(")/gi, '$1***$3')
    .replace(/(^|[\s"',{;])(x-api-key|x-opencode-session|api[_-]?key|apikey|token|password|secret)(\s*[:=]\s*)(?!["\'])([^\s"',;}\n]+)/gi, '$1$2$3***')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-***');
}

 /** 递归脱敏对象中的敏感字段（API 请求/响应快照可能含 Authorization/key 回显） */
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
      if (isSensitiveKey(k)) {
        out[k] = v && typeof v === 'object' ? maskSensitiveFields(v, depth + 1, seen) : maskSecret(v);
      } else {
        out[k] = maskSensitiveFields(v, depth + 1, seen);
      }
    }
    return out;
  }
  return value;
}

/** 两份 Debug 导出共用的表格快照：敏感列按列名脱敏，字符串单元格过掩码规则 */
function buildDebugTables_ACU(): Record<string, { rows: number; headers: string[]; sampleRows?: unknown[][] }> {
  const tables: Record<string, { rows: number; headers: string[]; sampleRows?: unknown[][] }> = {};
  const data = currentJsonTableData_ACU || {};
  for (const [key, sheet] of Object.entries(data)) {
    if (key === 'mate') continue;
    const content = Array.isArray((sheet as any)?.content) ? (sheet as any).content : [];
    const rows = Math.max(0, content.length - 1);
    const headers = Array.isArray(content[0]) ? content[0].map(String) : [];
    const sensitiveCols = new Set(headers.map((h: string, idx: number) => isSensitiveKey(h) ? idx : -1).filter((idx: number) => idx !== -1));
    const sampleRows = content.slice(1, 4).map((r: any) => Array.isArray(r) ? r.slice(0, 8).map((c: any, colIdx: number) => {
      if (sensitiveCols.has(colIdx)) return '***';
      if (typeof c === 'string') {
        const masked = maskSensitiveString(c);
        return masked.length > 200 ? masked.slice(0, 200) + '…' : masked;
      }
      return c;
    }) : r);
    tables[key] = { rows, headers, ...(sampleRows.length ? { sampleRows } : {}) };
  }
  return tables;
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

/**
 * Debug 开启时刻（模块级，与采集开关同寿命）。
 * 只用作导出 meta 的「本次采集起始」标注：导出内容 = 调用时的缓冲区全量，不再按它切片。
 */
let debugStartedAt_ACU = 0;
/** 采集开关显示态（模块级）：与 log-buffer 真实开关一致，跨 UI 开关不丢。 */
const debugActive_ACU = ref(false);

/** 两条导出路径（手动 / 停止自动）共用同一文件名格式 */
function debugExportFilename_ACU(): string {
  return `acu-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
}

/**
 * 两条 Debug 导出路径共用的 payload 构造：面板「导出 Debug 数据」与停止 Debug 的自动导出必须
 * 出自同一函数，否则改字段 / 改脱敏只改到一处，两份导出件内容就不一致（此前正是两份复制代码）。
 *
 * 入参 logs 传「调用那一刻的缓冲区全量」（含点 Debug 之前攒下的 error）。
 * `meta.debugStartedAt` 仍写：值取本次采集起始；面板没记到（采集被外部提前打开）时退化为
 * 最早日志时间，再退化为当前时间——字段恒在，读的人一眼能看出这份包从什么时候开始采。
 *
 * 导出仅供测试当复用锚点（断言两条路径的产物就是本函数产物），业务侧一律走面板入口。
 */
export function buildDebugExportPayload_ACU(logs: LogEntry[]) {
  const effectiveStart = debugStartedAt_ACU || (logs[0]?.timestamp ?? Date.now());
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
      url: typeof cfg.url === 'string' ? maskSensitiveString(cfg.url) : '',
      model: typeof cfg.model === 'string' ? cfg.model : '',
      apiKey: maskSecret(cfg.apiKey),
      temperature: cfg.temperature,
      max_tokens: cfg.max_tokens,
    },
    plotEnabled: settings_ACU?.plotSettings?.enabled === true,
  };

  let tables: Record<string, { rows: number; headers: string[]; sampleRows?: unknown[][] }> = {};
  try { tables = buildDebugTables_ACU(); } catch { /* 表统计失败不影响导出 */ }

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

  return {
    meta: {
      plugin: 'TTonly·数据库',
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
    clearHistory: getClearHistory_ACU(),
    logs: logs.map((e) => ({
      time: new Date(e.timestamp).toISOString(),
      level: e.level,
      tag: e.tag,
      message: maskSensitiveString(e.message),
    })),
    tables,
  };
}

export function useDebugPanel() {
  const toast = useToastStore();
  // 模块级共享：关闭/重开数据库 UI 只是组件卸载，采集开关（log-buffer 模块级）
  // 不受影响；按钮状态必须跟开关一致，否则出现“显示未开启、实际采集中”，
  // 用户再点一次就会把 debugStartedAt 标注重置到更晚，导出 meta 里的采集起始对不上真实首轮复现。
  const active = debugActive_ACU;
  const entryCount = ref(0);
  let unsubscribe: (() => void) | null = null;
  let unsubscribeClear: (() => void) | null = null;

  const statusLabel = computed(() => (active.value ? '采集中' : '未开启'));

  function refreshCount(): void {
    entryCount.value = getLogCount();
  }

  function startDebug(): void {
    setDebugLogEnabled(true);
    // 只动 Debug 自己的 warn 来源：开发者选项已开启的常驻采集不归本面板管，不能被牵连。
    setWarnLogEnabledByDebugCapture_ACU(true);
    if (!active.value) {
      // 刻意不清空缓冲区：用户通常是「问题已经发生过」才想起开 Debug，采集前攒下的 error
      // 正是这次排查要一起导出的材料，在这里 clearLogs 等于把诊断现场洗掉。
      // debugStartedAt 只留作导出 meta 的采集起始标注，不再是导出切片依据。
      debugStartedAt_ACU = Date.now();
    }
    active.value = true;
    refreshCount();
    toast.info('Debug 采集已开启：请复现问题，完成后点「导出 Debug 数据」（开启前的报错也会一起导出）。');
  }

  function stopDebug(): void {
    if (!active.value) {
      toast.warning('Debug 未开启，无需停止。');
      return;
    }
    // 增强：停止时自动导出一次，避免用户忘记点导出。导出范围＝缓冲区全量（含采集前的 error）。
    try {
      const logs = getAllLogs();
      if (logs.length > 0) {
        const payload = buildDebugExportPayload_ACU(logs);
        downloadJson(debugExportFilename_ACU(), payload);
        // 清空只能在 downloadJson 成功返回之后：下载没成就把缓冲区留着，
        // 否则「自动导出失败」会变成「日志也没了」，用户连手动导出的机会都被洗掉。
        clearLogs('debugPanel.stopDebug.autoExport');
        // blob 下载在页面内没有"已落盘"的回读信号，`a.click()` 不抛只能证明"已交给浏览器"，
        // 因此措辞止步于此，不写成"导出成功/已保存"——用户按提示去下载列表确认才算闭环。
        toast.success(`Debug 采集已停止，已生成 ${payload.logCount} 条日志的导出文件并交给浏览器下载（请在下载列表确认）。`);
      } else {
        toast.success('Debug 采集已停止（无日志可导出）。');
      }
    } catch (e) {
      // 如实报错：这里曾走 toast.success，把失败说成成功，用户以为已经导出就不再手动导出。
      // 提示本身也要脱敏：宿主/内核的错误文案可能回显带密钥的 URL。
      // 指引必须可执行：未开启采集时「导出 Debug 数据」按钮是禁用的（composable 也有同语义守卫），
      // 所以这里要让用户先重新「开始 Debug」——新语义下它不再清空缓冲区，保留的日志仍在。
      toast.warning(
        `Debug 采集已停止，但自动导出失败：${maskSensitiveText_ACU((e as Error)?.message || '未知错误')}。日志缓冲区已保留，请重新点「开始 Debug」（现在不会清空日志），再点「导出 Debug 数据」手动导出。`,
        { muteable: false, durationMs: 8000 },
      );
    }
    setDebugLogEnabled(false);
    setWarnLogEnabledByDebugCapture_ACU(false);
    active.value = false;
    debugStartedAt_ACU = 0;
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
    // 手动导出不清空：用户可以边复现边反复导出，只有停止 Debug 的自动导出才做收尾清空。
    const payload = buildDebugExportPayload_ACU(getAllLogs());
    downloadJson(debugExportFilename_ACU(), payload);
    toast.success(`已生成 ${payload.logCount} 条日志的导出文件并交给浏览器下载（请在下载列表确认）。`);
  }

  onMounted(() => {
    // 进页不自动开启，但也不强关：如有关闭 UI 前开的采集（log-buffer 开关还在），
    // 按钮必须显示“采集中”，否则用户会以为没开、重按开始把采集起始标注改到更晚，
    // 导出 meta 里的 debugStartedAt 就对不上真实的第一次采集。
    active.value = isDebugLogEnabled();
    if (!active.value) debugStartedAt_ACU = 0;
    refreshCount();
    unsubscribe = subscribe(() => refreshCount());
    unsubscribeClear = subscribeToClear(() => refreshCount());
  });
  onBeforeUnmount(() => {
    unsubscribe?.();
    unsubscribe = null;
    unsubscribeClear?.();
    unsubscribeClear = null;
  });

  return {
    active,
    entryCount,
    statusLabel,
    toggleDebug,
    exportDebugData,
  };
}
