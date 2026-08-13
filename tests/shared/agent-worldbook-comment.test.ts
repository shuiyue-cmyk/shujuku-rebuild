import { describe, expect, it } from 'vitest';
import {
  AGENT_TAKEOVER_META_END_ACU,
  AGENT_TAKEOVER_META_START_ACU,
  ACU_SKILL_META_END_ACU,
  ACU_SKILL_META_START_ACU,
  buildWorldbookEntryDisplayLabel_ACU,
  createAgentTakeoverMetaPattern_ACU,
  createSkillMetaPattern_ACU,
  stripAgentTakeoverMetaBlockLoose_ACU,
  stripAgentTakeoverMetaBlockStrict_ACU,
  stripWorldbookSkillMetaBlockCore_ACU,
} from '../../src/shared/agent-worldbook-comment';

const takeoverV1 = {
  version: 1,
  kind: 'agent_worldbook_takeover',
  selectionSignature: 'sig',
  createdAt: 1,
  previousEnabled: true,
};

function takeoverBlock(json: Record<string, unknown>): string {
  return `<!-- ${AGENT_TAKEOVER_META_START_ACU}\n${JSON.stringify(json)}\n${AGENT_TAKEOVER_META_END_ACU} -->`;
}

const skillBlock = `<!-- ${ACU_SKILL_META_START_ACU}\n{"version":1,"description":"描述","triggerWhen":"触发","tk":1,"updatedAt":1,"updatedBy":"manual"}\n${ACU_SKILL_META_END_ACU} -->`;

describe('stripAgentTakeoverMetaBlockStrict_ACU', () => {
  it('removes a valid v1 takeover block', () => {
    const comment = `正文\n\n${takeoverBlock(takeoverV1)}`;
    expect(stripAgentTakeoverMetaBlockStrict_ACU(comment)).toBe('正文');
  });

  it('keeps an unsupported version block (version: 2)', () => {
    const block = takeoverBlock({ version: 2, kind: 'agent_worldbook_takeover' });
    expect(stripAgentTakeoverMetaBlockStrict_ACU(`正文\n${block}`)).toBe(`正文\n${block}`);
  });

  it('keeps a non-JSON block', () => {
    const block = `<!-- ${AGENT_TAKEOVER_META_START_ACU}\nnot-json\n${AGENT_TAKEOVER_META_END_ACU} -->`;
    expect(stripAgentTakeoverMetaBlockStrict_ACU(`正文\n${block}`)).toBe(`正文\n${block}`);
  });
});

describe('stripAgentTakeoverMetaBlockLoose_ACU', () => {
  it('removes an invalid empty-object block', () => {
    const block = takeoverBlock({});
    expect(stripAgentTakeoverMetaBlockLoose_ACU(`正文\n${block}`)).toBe('正文');
  });
});

describe('stripWorldbookSkillMetaBlockCore_ACU', () => {
  it('removes a skill meta block and collapses blank lines', () => {
    expect(stripWorldbookSkillMetaBlockCore_ACU(`正文\n\n${skillBlock}`)).toBe('正文');
  });

  it('returns empty string for non-string input', () => {
    expect(stripWorldbookSkillMetaBlockCore_ACU(null)).toBe('');
    expect(stripWorldbookSkillMetaBlockCore_ACU(undefined)).toBe('');
  });
});

describe('buildWorldbookEntryDisplayLabel_ACU', () => {
  it('strips both takeover and skill blocks and collapses whitespace to a single line', () => {
    const comment = `标题 部分\n\n${takeoverBlock(takeoverV1)}\n\n${skillBlock}`;
    expect(buildWorldbookEntryDisplayLabel_ACU(comment, 1)).toBe('标题 部分');
  });

  it('falls back to 条目 ${uid} when comment is empty or meta-only', () => {
    expect(buildWorldbookEntryDisplayLabel_ACU('', 42)).toBe('条目 42');
    expect(buildWorldbookEntryDisplayLabel_ACU(`${takeoverBlock(takeoverV1)}\n${skillBlock}`, 7)).toBe('条目 7');
  });

  it('does not treat uid 0 as empty', () => {
    expect(buildWorldbookEntryDisplayLabel_ACU('', 0)).toBe('条目 0');
  });

  it('output never contains newlines', () => {
    expect(buildWorldbookEntryDisplayLabel_ACU(`多\n行\n标题`, 1)).not.toMatch(/\n/);
  });
});

describe('pattern factories', () => {
  it('each call returns a fresh instance with its own lastIndex', () => {
    const first = createAgentTakeoverMetaPattern_ACU();
    const second = createAgentTakeoverMetaPattern_ACU();
    const comment = `<!-- ${AGENT_TAKEOVER_META_START_ACU}\n{}\n${AGENT_TAKEOVER_META_END_ACU} -->`;
    first.exec(comment);
    second.exec(comment);
    expect(second.lastIndex).toBeGreaterThan(0);
    const third = createAgentTakeoverMetaPattern_ACU();
    expect(third.exec(comment)).not.toBeNull();
  });

  it('skill meta pattern matches the canonical block', () => {
    expect(createSkillMetaPattern_ACU().test(`正文\n${skillBlock}`)).toBe(true);
  });
});

