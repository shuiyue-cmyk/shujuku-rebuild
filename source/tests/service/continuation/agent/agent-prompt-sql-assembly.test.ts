import { describe, expect, it } from 'vitest';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';
import { buildV33ContinuationAgentPrompts_ACU } from '../../../../src/service/continuation/agent/agent-defaults';
import { validateContinuationSettings_ACU } from '../../../../src/service/continuation/continuation-store';
import { renderContinuationPrompt_ACU, restoreContinuationPromptDefault_ACU } from '../../../../src/service/continuation/prompt-template';

const writers = ['arcArchitect', 'maintainer', 'webResearcher'] as const;

async function sentPrompt(role: typeof writers[number], settings = buildDefaultContinuationSettings_ACU()) {
  const rendered = await renderContinuationPrompt_ACU(settings.agentPrompts[role], {}, 'agent_delegate');
  return rendered.messages.map(message => message.content).join('\n');
}

describe('续写维护代理最终组装的 SQL 写集提示', () => {
  it.each(writers)('%s 只要求在 JSON 的 sql 字段提交受限 SQL DML', async role => {
    const text = await sentPrompt(role);
    expect(text).toContain('"sql"');
    expect(text).toContain('INSERT INTO');
    expect(text).toContain('UPDATE');
    expect(text).toContain('DELETE');
    expect(text).not.toMatch(/"delta"\s*:|delta\.chronology|"action"\s*:\s*"(?:upsert|retire|patch)|expectedRevisions/);
  });

  it('年代学段仍要求真实正文证据、模糊时间精度和显式删除理由', async () => {
    const text = await sentPrompt('maintainer');
    expect(text).toContain('UPDATE chronology');
    expect(text).toContain('DELETE FROM chronology');
    expect(text).toContain('evidence_indexes');
    expect(text).toContain('approximate');
    expect(text).toContain('DELETE 必须给出理由');
  });

  /**
   * UPDATE/DELETE 范例不得示范 `expected_revision = 0`。
   *
   * 只有新建 INSERT 才填 0；UPDATE/DELETE 的 WHERE 必须带当前条目修订号
   *（agent-protocol.ts:1032 强制要求字段、:1054 不一致即 failProtocol 整轮失败）。
   * 范例写「一律写 0」，模型照抄 → 非零修订模块整轮作废。
   * 用词与 maintainer 年代学契约已有的「当前条目修订号」保持一致，不引入新词汇。
   */
  it.each(writers)('%s 的 UPDATE/DELETE 范例用当前条目修订号，不示范 = 0', async role => {
    const text = await sentPrompt(role);
    expect(text, `${role} 的 UPDATE/DELETE 范例不得示范 expected_revision = 0`).not.toContain('expected_revision = 0');
  });

  it('V33 旧默认逐段升级，自定义和追加段原样保留；恢复默认使用当前版本组', async () => {    const settings = buildDefaultContinuationSettings_ACU();
    settings.promptForceDefaultVersion = 'spv4.1-continuation-information-boundary-v33';
    settings.agentPrompts = buildV33ContinuationAgentPrompts_ACU();
    const custom = settings.agentPrompts.maintainer.find(segment => segment.content.startsWith('我的边界有五条：'))!;
    custom.content += '\n用户定制：保留此段。';
    const extra = { role: 'user', content: '用户添加的额外段', enabled: true, deletable: true };
    settings.agentPrompts.webResearcher.push(extra);
    const migrated = validateContinuationSettings_ACU(settings);
    expect(migrated.agentPrompts.maintainer).toContainEqual(custom);
    expect(migrated.agentPrompts.webResearcher).toContainEqual(extra);
    for (const role of writers) expect(await sentPrompt(role, migrated)).not.toMatch(/"delta"\s*:|delta\.chronology|expectedRevisions/);
    const restored = restoreContinuationPromptDefault_ACU(migrated, 'agent_maintainer');
    expect(await sentPrompt('maintainer', restored)).toContain('UPDATE chronology');
  });
});
