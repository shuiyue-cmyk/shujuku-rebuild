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
  it('空文本应用预设：追加全部预设行', () => {
    const out = applyClientHeaderPreset_ACU('', claudePreset);
    expect(out).toBe('x-app: cli\nUser-Agent: claude-cli/2.1.207 (external, cli)');
  });

  it('受管身份键被替换为预设值，无关行（Authorization/自定义键）保留', () => {
    const current = 'Authorization: Bearer sk-xxx\nuser-agent: something/1.0\nX-Custom: keep-me';
    const out = applyClientHeaderPreset_ACU(current, claudePreset);
    const lines = out.split('\n');
    expect(lines).toContain('Authorization: Bearer sk-xxx');
    expect(lines).toContain('X-Custom: keep-me');
    expect(lines.filter((l) => /^user-agent:/i.test(l)).length).toBe(1);
    expect(lines.find((l) => /^user-agent:/i.test(l))).toBe('User-Agent: claude-cli/2.1.207 (external, cli)');
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
    expect(uaLines[0]).toBe('User-Agent: claude-cli/2.1.207 (external, cli)');
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
