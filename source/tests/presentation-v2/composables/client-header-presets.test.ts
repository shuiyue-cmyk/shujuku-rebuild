import { describe, it, expect } from 'vitest';
import {
  CLIENT_HEADER_PRESETS_ACU,
  applyClientHeaderPreset_ACU,
  matchClientHeaderPreset_ACU,
} from '../../../src/presentation-v2/composables/client-header-presets';

const claudePreset = CLIENT_HEADER_PRESETS_ACU.find((p) => p.id === 'claude-code')!;

describe('client-header-presets · 客户端伪装头预设', () => {
  it('空文本应用预设：追加全部预设行', () => {
    const out = applyClientHeaderPreset_ACU('', claudePreset);
    expect(out).toBe('x-app: cli\nUser-Agent: claude-cli/2.1.207 (external, cli)');
  });

  it('同名键（不区分大小写）原位覆盖，其余行保留', () => {
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

  it('切换预设：旧预设键被新预设覆盖/清理语义正确', () => {
    const zcode = CLIENT_HEADER_PRESETS_ACU.find((p) => p.id === 'zcode')!;
    const withZcode = applyClientHeaderPreset_ACU('', zcode);
    const switched = applyClientHeaderPreset_ACU(withZcode, claudePreset);
    // claude 预设不含 HTTP-Referer/X-Title，这两行保留（用户可手删）
    expect(switched).toContain('HTTP-Referer: https://zcode.z.ai/');
    expect(switched).toContain('x-app: cli');
    const uaLines = switched.split('\n').filter((l) => /^user-agent:/i.test(l));
    expect(uaLines.length).toBe(1);
    expect(uaLines[0]).toBe('User-Agent: claude-cli/2.1.207 (external, cli)');
  });

  it('matchClientHeaderPreset：全部键命中才回显预设 id', () => {
    const withClaude = applyClientHeaderPreset_ACU('', claudePreset);
    expect(matchClientHeaderPreset_ACU(withClaude)).toBe('claude-code');
    expect(matchClientHeaderPreset_ACU('Authorization: Bearer sk-xxx')).toBe('');
    expect(matchClientHeaderPreset_ACU('')).toBe('');
  });
});
