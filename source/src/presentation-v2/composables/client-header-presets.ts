// presentation-v2/composables/client-header-presets.ts — API 预设「客户端伪装」可选预设
// 把常见模型 CLI/GUI 客户端的身份请求头（User-Agent / HTTP-Referer / X-Title / x-app /
// originator 等）做成可选预设，选中后合并进附加请求标头文本框（同名键覆盖、其余行保留）。

export interface ClientHeaderPreset_ACU {
  id: string;
  label: string;
  /** 该客户端的身份头键值对（版本号字段随客户端更新，取当前常见值） */
  headers: string[];
}

/**
 * 客户端身份头预设清单（键值对经源码/文档查证；版本号随上游更新会过期，
 * 仅作为「像该客户端」的伪装基线，用户可在文本框中手动改版本号）。
 * 查证结论（2026-08-26）：Codex/Gemini/Qwen/OpenCode/Roo/Kilo 源码实证；
 * Claude Code/Z Code 为用户提供样本；Cline/Cherry Studio/Chatbox 未实证故不收录。
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
    label: 'Z Code（智谱桌面端）',
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
      'User-Agent: GeminiCLI/v0.8.1/gemini-2.5-pro (windows; x86_64; cli)',
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
];

/** 提取一行头的键（冒号前），小写化用于不区分大小写比较 */
function headerKeyOf(line: string): string {
  const idx = line.indexOf(':');
  return (idx === -1 ? line : line.slice(0, idx)).trim().toLowerCase();
}

/**
 * 把预设头合并进现有附加请求标头文本：
 * - 与预设键同名（不区分大小写）的现有行被替换为预设行（保持原有行序位置）
 * - 现有行中与预设不同名的行原样保留（含 Authorization 等敏感行，不动）
 * - 预设中现有文本没有的键追加到末尾
 */
export function applyClientHeaderPreset_ACU(currentHeaders: string, preset: ClientHeaderPreset_ACU): string {
  const existingLines = String(currentHeaders || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const presetLines = preset.headers.map((l) => l.trim()).filter(Boolean);

  const replacedKeys = new Set<string>();
  const merged: string[] = [];
  for (const line of existingLines) {
    const key = headerKeyOf(line);
    const presetLine = presetLines.find((p) => headerKeyOf(p) === key);
    if (presetLine) {
      merged.push(presetLine);
      replacedKeys.add(key);
    } else {
      merged.push(line);
    }
  }
  for (const presetLine of presetLines) {
    if (!replacedKeys.has(headerKeyOf(presetLine))) {
      merged.push(presetLine);
    }
  }
  return merged.join('\n');
}

/** 从文本框内容反查当前命中的预设 id（全部键都命中才算），供回显选中态 */
export function matchClientHeaderPreset_ACU(currentHeaders: string): string {
  const lines = String(currentHeaders || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const existingKeys = new Set(lines.map(headerKeyOf));
  for (const preset of CLIENT_HEADER_PRESETS_ACU) {
    const allMatch = preset.headers.every((h) => existingKeys.has(headerKeyOf(h)));
    if (allMatch) return preset.id;
  }
  return '';
}
