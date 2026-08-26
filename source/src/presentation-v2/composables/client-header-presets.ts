// presentation-v2/composables/client-header-presets.ts — API 预设「客户端伪装」可选预设
// 把常见模型 CLI/GUI 客户端的身份请求头（User-Agent / HTTP-Referer / X-Title / x-app /
// originator 等）做成可选预设。受管身份键由预设统一接管：应用预设时先移除全部受管键
// 旧行再追加新预设行（切换不残留）；无关行（如 Authorization）原样保留。

export interface ClientHeaderPreset_ACU {
  id: string;
  label: string;
  /** 该客户端的身份头键值对（版本号字段随客户端更新，取当前常见值） */
  headers: string[];
}

/**
 * 客户端身份头预设清单（键值对经源码/文档查证；版本号随上游更新会过期，
 * 仅作为「像该客户端」的伪装基线，用户可在文本框中手动改版本号）。
 * 查证结论（2026-08-26）：Codex/Gemini/Qwen/OpenCode/Roo/Kilo/Grok Build/MiMo Code/
 * DeepSeek Harness/OpenClaw/OpenDesign 源码实证；Claude Code/Z Code 为用户提供样本；
 * Trae（IDE 闭源未查到，trae-agent 无硬编码头）未实证故不收录。
 */
export const CLIENT_HEADER_PRESETS_ACU: ClientHeaderPreset_ACU[] = [
  {
    id: 'claude-code',
    label: 'Claude Code CLI',
    headers: [
      'x-app: cli',
      'User-Agent: claude-cli/2.1.207 (external, cli)',
    ],
  },
  {
    id: 'zcode',
    label: 'Z Code',
    headers: [
      'HTTP-Referer: https://zcode.z.ai/',
      'X-Title: Z Code@electron',
      'User-Agent: ZCode/3.7.7',
    ],
  },
  {
    id: 'codex-cli',
    label: 'OpenAI Codex CLI',
    headers: [
      'originator: codex_cli_rs',
      'User-Agent: codex_cli_rs/0.46.0 (Windows 10.0; x86_64) WindowsTerminal',
    ],
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    headers: [
      'User-Agent: GeminiCLI/v0.8.1 (windows; x86_64; cli)',
    ],
  },
  {
    id: 'qwen-code',
    label: 'Qwen Code',
    headers: [
      'User-Agent: QwenCode/v3.1.0 (windows; x86_64)',
    ],
  },
  {
    id: 'roo-code',
    label: 'Roo Code',
    headers: [
      'HTTP-Referer: https://github.com/RooVetGit/Roo-Cline',
      'X-Title: Roo Code',
      'User-Agent: RooCode/3.20.0',
    ],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    headers: [
      'HTTP-Referer: https://opencode.ai/',
      'X-Title: opencode',
    ],
  },
  {
    id: 'kilo-code',
    label: 'Kilo Code',
    headers: [
      'HTTP-Referer: https://kilo.ai/',
      'X-Title: Kilo Code',
    ],
  },
  {
    id: 'grok-build',
    label: 'Grok Build',
    headers: [
      'User-Agent: grok-shell/0.1.171 (windows; x86_64)',
    ],
  },
  {
    id: 'mimo-code',
    label: 'MiMo Code',
    headers: [
      'User-Agent: mimocode/stable/1.0.0/cli',
      'HTTP-Referer: https://mimo.xiaomi.com/coder/',
      'X-Title: mimocode',
    ],
  },
  {
    id: 'deepseek-harness',
    label: 'DeepSeek Harness',
    headers: [
      'User-Agent: deepseek-harness/0.1.0 (+https://github.com/deepseek-ai/deepseek-harness)',
    ],
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    headers: [
      'User-Agent: openclaw/1.0.0',
      'HTTP-Referer: https://openclaw.ai',
      'X-OpenRouter-Title: OpenClaw',
    ],
  },
  {
    id: 'open-design',
    label: 'OpenDesign',
    headers: [
      'APP-Code: DMCY9912',
    ],
  },
];

/** 提取一行头的键（冒号前），小写化用于不区分大小写比较 */
function headerKeyOf(line: string): string {
  const idx = line.indexOf(':');
  return (idx === -1 ? line : line.slice(0, idx)).trim().toLowerCase();
}

/** 所有预设管理的身份键并集（小写）：这些键由客户端伪装预设统一接管 */
const MANAGED_KEYS_ACU: ReadonlySet<string> = new Set(
  CLIENT_HEADER_PRESETS_ACU.flatMap((p) => p.headers.map(headerKeyOf)),
);

/**
 * 把预设头合并进现有附加请求标头文本：
 * - 所有被任一预设管理的身份键旧行先移除（切换预设时旧预设的独有键不留残留）
 * - 再追加新预设的全部行
 * - 与预设无关的行（含 Authorization 等敏感行）原样保留
 */
export function applyClientHeaderPreset_ACU(currentHeaders: string, preset: ClientHeaderPreset_ACU): string {
  const existingLines = String(currentHeaders || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const presetLines = preset.headers.map((l) => l.trim()).filter(Boolean);

  const kept = existingLines.filter((line) => !MANAGED_KEYS_ACU.has(headerKeyOf(line)));
  return [...kept, ...presetLines].join('\n');
}

/** 行的值（冒号后）小写化，用于键+值精确匹配 */
function headerValueOf(line: string): string {
  const idx = line.indexOf(':');
  return (idx === -1 ? '' : line.slice(idx + 1)).trim().toLowerCase();
}

/**
 * 从文本框内容反查当前命中的预设 id，供回显选中态。
 * 键+值双匹配（值不区分大小写、去首尾空白后比较）：任一预设的某行在文本中找不到同键同值即不命中。
 * 只按键匹配会把「键集相同但值不同」的预设误回显（如 OpenCode/Kilo Code）。
 */
export function matchClientHeaderPreset_ACU(currentHeaders: string): string {
  const lines = String(currentHeaders || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const byKey = new Map<string, Set<string>>();
  for (const line of lines) {
    const key = headerKeyOf(line);
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key)!.add(headerValueOf(line));
  }
  for (const preset of CLIENT_HEADER_PRESETS_ACU) {
    const allMatch = preset.headers.every((h) => byKey.get(headerKeyOf(h))?.has(headerValueOf(h)));
    if (allMatch) return preset.id;
  }
  return '';
}

/** 「不使用预设」下拉哨兵值：选中后清除全部受管身份键 */
export const CLIENT_HEADER_PRESET_NONE_ACU = '__none__';

/** 移除文本中全部受管身份键的行（「不使用预设」的实现），无关行保留 */
export function stripManagedClientHeaders_ACU(currentHeaders: string): string {
  const kept = String(currentHeaders || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !MANAGED_KEYS_ACU.has(headerKeyOf(l)));
  return kept.join('\n');
}

/** 文本中是否还残留任一受管身份键（区分「未使用」与「部分残留」两种回显态） */
export function hasManagedClientKeys_ACU(currentHeaders: string): boolean {
  return String(currentHeaders || '')
    .split(/\r?\n/)
    .some((l) => l.trim() && MANAGED_KEYS_ACU.has(headerKeyOf(l)));
}
