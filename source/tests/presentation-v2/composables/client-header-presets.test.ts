import { describe, it, expect } from 'vitest';
import {
  CLIENT_HEADER_PRESETS_ACU,
  applyClientHeaderPreset_ACU,
  matchClientHeaderPreset_ACU,
} from '../../../src/presentation-v2/composables/client-header-presets';

const claudePreset = CLIENT_HEADER_PRESETS_ACU.find((p) => p.id === 'claude-code')!;
const zcodePreset = CLIENT_HEADER_PRESETS_ACU.find((p) => p.id === 'zcode')!;
const opencodePreset = CLIENT_HEADER_PRESETS_ACU.find((p) => p.id === 'opencode')!;
const kiloPreset = CLIENT_HEADER_PRESETS_ACU.find((p) => p.id === 'kilo-code')!;

describe('client-header-presets · 客户端伪装头预设', () => {

  it('受管身份键被替换为预设值，无关行（Authorization/自定义键）保留', () => {
    const current = 'Authorization: Bearer sk-xxx\nuser-agent: something/1.0\nX-Custom: keep-me';
    const out = applyClientHeaderPreset_ACU(current, claudePreset);
    const lines = out.split('\n');
    expect(lines).toContain('Authorization: Bearer sk-xxx');
    expect(lines).toContain('X-Custom: keep-me');
    expect(lines.filter((l) => /^user-agent:/i.test(l)).length).toBe(1);
    expect(lines.find((l) => /^user-agent:/i.test(l))).toBe('User-Agent: claude-cli/2.1.283 (external, cli)');
    expect(lines.filter((l) => /^x-app:/i.test(l)).length).toBe(1);
  });

  it('重复应用同一预设幂等', () => {
    const once = applyClientHeaderPreset_ACU('', claudePreset);
    const twice = applyClientHeaderPreset_ACU(once, claudePreset);
    expect(twice).toBe(once);
  });

  it('切换预设：旧预设的独有受管键被清除，不留残留', () => {
    const withZcode = applyClientHeaderPreset_ACU('', zcodePreset);
    const switched = applyClientHeaderPreset_ACU(withZcode, claudePreset);
    // zcode 独有的 HTTP-Referer/X-Title 属受管键，切到 claude 时被移除
    expect(switched).not.toContain('HTTP-Referer');
    expect(switched).not.toContain('X-Title');
    expect(switched).toContain('x-app: cli');
    const uaLines = switched.split('\n').filter((l) => /^user-agent:/i.test(l));
    expect(uaLines.length).toBe(1);
    expect(uaLines[0]).toBe('User-Agent: claude-cli/2.1.283 (external, cli)');
  });

  it('matchClientHeaderPreset：键+值双匹配，值不同不回显', () => {
    const withClaude = applyClientHeaderPreset_ACU('', claudePreset);
    expect(matchClientHeaderPreset_ACU(withClaude)).toBe('claude-code');
    expect(matchClientHeaderPreset_ACU('Authorization: Bearer sk-xxx')).toBe('');
    expect(matchClientHeaderPreset_ACU('')).toBe('');
    // 同键不同值（用户改过 UA 版本号）→ 不回显预设
    expect(matchClientHeaderPreset_ACU('x-app: cli\nUser-Agent: claude-cli/9.9.9 (external, cli)')).toBe('');
  });

  it('键集相同但值不同的两个预设互不误回显（OpenCode vs Kilo Code）', () => {
    const withKilo = applyClientHeaderPreset_ACU('', kiloPreset);
    expect(matchClientHeaderPreset_ACU(withKilo)).toBe('kilo-code');
    expect(matchClientHeaderPreset_ACU(withKilo)).not.toBe('opencode');
    const withOpenCode = applyClientHeaderPreset_ACU('', opencodePreset);
    expect(matchClientHeaderPreset_ACU(withOpenCode)).toBe('opencode');
  });
});

// 版本刷新与新预设判别：查证于 2026-09-27，证据见数据文件头注释
describe('client-header-presets · 版本刷新与新预设（2026-09-27 查证）', () => {

  it('被刷新的旧版本串不再残留于任何预设', () => {
    const stale = ['2.1.207', 'ZCode/3.7.7', 'codex_cli_rs/0.46.0', 'GeminiCLI/v0.8.1',
      'QwenCode/v3.1.0', 'RooCode/3.20.0', 'grok-shell/0.1.171', 'openclaw/1.0.0',
      'mimocode/stable/1.0.0', 'deepseek-harness/0.1.0 '];
    const all = CLIENT_HEADER_PRESETS_ACU.map((p) => p.headers.join('\n')).join('\n');
    for (const s of stale) expect(all).not.toContain(s);
  });

  const newPresetHeaders: Record<string, string[]> = {
    'cline': ['HTTP-Referer: https://cline.bot', 'X-Title: Cline', 'User-Agent: Cline/3.0.65'],
    'iflow': ['User-Agent: iFlowCLI/0.5.19 (win32; x64)'],
    'cherry-studio': ['HTTP-Referer: https://cherry-ai.com', 'X-Title: Cherry Studio'],
    'lobehub': ['HTTP-Referer: https://lobehub.com', 'X-Title: LobeHub'],
  };

  it('新增预设存在、头与查证值一致、应用→回显闭环成立', () => {
    for (const [id, headers] of Object.entries(newPresetHeaders)) {
      const preset = CLIENT_HEADER_PRESETS_ACU.find((p) => p.id === id);
      expect(preset, id).toBeDefined();
      expect(preset!.headers, id).toEqual(headers);
      const applied = applyClientHeaderPreset_ACU('', preset!);
      expect(matchClientHeaderPreset_ACU(applied), id).toBe(id);
    }
  });

  it('新预设受管键被切换统一接管：切到 Claude Code 后无残留', () => {
    const clinePreset = CLIENT_HEADER_PRESETS_ACU.find((p) => p.id === 'cline')!;
    const switched = applyClientHeaderPreset_ACU(applyClientHeaderPreset_ACU('', clinePreset), claudePreset);
    expect(switched).toBe('x-app: cli\nUser-Agent: claude-cli/2.1.283 (external, cli)');
  });

  it('预设 id 全局唯一', () => {
    const ids = CLIENT_HEADER_PRESETS_ACU.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
