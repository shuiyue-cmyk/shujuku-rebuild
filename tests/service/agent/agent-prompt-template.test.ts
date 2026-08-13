import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogDebug, mockLogWarn } = vi.hoisted(() => ({
  mockLogDebug: vi.fn(),
  mockLogWarn: vi.fn(),
}));

const mockRenderAgentReadOnlyQueryTemplates = vi.hoisted(() => vi.fn((content: string) => ({
  content: content.replace('{[sql "SELECT 1"]}', '1'),
  tagCount: content.includes('{[sql ') ? 1 : 0,
  executedCount: content.includes('{[sql "SELECT 1"]}') ? 1 : 0,
  rejectedCount: 0,
})));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
  logWarn_ACU: mockLogWarn,
}));

vi.mock('../../../src/service/runtime/template-vars/agent-read-only-template-render', () => ({
  splitAgentQueryTemplateParts_ACU: (content: string) => {
    const match = content.match(/\{\[(?:sql\s|db\.)[\s\S]*?\]\}/);
    if (!match || match.index === undefined) return [{ kind: 'text', value: content }];
    return [
      { kind: 'text', value: content.slice(0, match.index) },
      { kind: 'query', value: match[0] },
      { kind: 'text', value: content.slice(match.index + match[0].length) },
    ];
  },
  renderAgentReadOnlyQueryTemplates_ACU: mockRenderAgentReadOnlyQueryTemplates,
}));

import {
  normalizeAgentContextSettings_ACU,
  normalizeEditablePromptSegments_ACU,
  normalizePromptSegments_ACU,
  renderAgentPromptSegments_ACU,
} from '../../../src/service/agent/agent-prompt-template';

const fallback = [{ role: 'system', content: 'fallback', deletable: false }];

describe('agent prompt template normalization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps empty prompt segments in editing normalization', () => {
    const result = normalizeEditablePromptSegments_ACU([{ role: 'USER', content: '', deletable: true }], fallback);
    expect(result).toEqual([{ role: 'user', content: '', deletable: true }]);
  });

  it('filters empty prompt segments in runtime normalization', () => {
    const result = normalizePromptSegments_ACU([{ role: 'USER', content: '', deletable: true }], fallback);
    expect(result).toEqual(fallback);
  });

  it('preserves context settings above the former UI upper limits while retaining lower bounds', () => {
    const result = normalizeAgentContextSettings_ACU({
      decisionRecentContextCharLimit: 21,
      decisionWorldbookCandidateLimit: 301,
      skillifyMaxEntries: 301,
      plotWorldbookScanMessageLimit: 21,
      agentAiMaxRetries: 11,
      greenlightMinTkBudget: 200001,
      greenlightMaxTkBudget: 200001,
    });
    const safeIntegerResult = normalizeAgentContextSettings_ACU({ decisionWorldbookCandidateLimit: Number.MAX_SAFE_INTEGER + 1 });

    expect(result).toMatchObject({
      decisionRecentContextCharLimit: 21,
      decisionWorldbookCandidateLimit: 301,
      skillifyMaxEntries: 301,
      plotWorldbookScanMessageLimit: 21,
      agentAiMaxRetries: 11,
      greenlightMinTkBudget: 200001,
      greenlightMaxTkBudget: 200001,
    });
    expect(normalizeAgentContextSettings_ACU({ greenlightMinTkBudget: -1, greenlightMaxTkBudget: 0 })).toMatchObject({ greenlightMinTkBudget: 0, greenlightMaxTkBudget: 1 });
    expect(safeIntegerResult.decisionWorldbookCandidateLimit).toBe(Number.MAX_SAFE_INTEGER);
    expect(normalizeAgentContextSettings_ACU({ decisionWorldbookCandidateLimit: Infinity }).decisionWorldbookCandidateLimit).toBe(100);
  });

  it('keeps SQL rendering disabled by default', () => {
    const result = renderAgentPromptSegments_ACU(
      [{ role: 'system', content: 'value={[sql "SELECT 1"]}; user={{agent.userMessage}}' }],
      { 'agent.userMessage': 'hello' },
    );
    expect(result[0].content).toBe('value={[sql "SELECT 1"]}; user=hello');
    expect(mockRenderAgentReadOnlyQueryTemplates).not.toHaveBeenCalled();
  });

  it('protects placeholder payload from query parsing when SQL rendering is enabled', () => {
    const payload = '{[sql "DELETE FROM inventory"]}';
    const result = renderAgentPromptSegments_ACU(
      [{ role: 'system', content: 'value={[sql "SELECT 1"]}; user={{agent.userMessage}}' }],
      { 'agent.userMessage': payload },
      { enableSqlRender: true, promptKind: 'decision' },
    );
    expect(result[0].content).toBe(`value=1; user=${payload}`);
    const renderedInput = mockRenderAgentReadOnlyQueryTemplates.mock.calls[0][0];
    expect(renderedInput).toContain('{[sql "SELECT 1"]}');
    expect(renderedInput).not.toContain('DELETE FROM inventory');
    expect(mockLogDebug).toHaveBeenCalledWith(expect.stringContaining('kind=decision; segment=0; tags=1;'));
    const logs = [...mockLogDebug.mock.calls, ...mockLogWarn.mock.calls]
      .flat()
      .map(value => String(value))
      .join('\n');
    expect(logs).not.toContain('SELECT 1');
    expect(logs).not.toContain('DELETE FROM inventory');
    expect(logs).not.toContain(payload);
  });

  it('does not replace placeholders inside query tag intervals', () => {
    const result = renderAgentPromptSegments_ACU(
      [{ role: 'system', content: '{[sql "SELECT {{agent.userMessage}}"]}' }],
      { 'agent.userMessage': 'payload' },
      { enableSqlRender: true, promptKind: 'decision' },
    );
    expect(mockRenderAgentReadOnlyQueryTemplates).toHaveBeenCalledWith('{[sql "SELECT {{agent.userMessage}}"]}');
    expect(result[0].content).toContain('{{agent.userMessage}}');
  });
});
