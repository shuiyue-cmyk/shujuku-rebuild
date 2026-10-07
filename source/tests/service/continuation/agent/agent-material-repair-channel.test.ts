import { describe, expect, it } from 'vitest';

import { ContinuationAgentTurnPlanner_ACU } from '../../../../src/service/continuation/agent/agent-main-loop';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { buildEmptyAgentConversation_ACU } from '../../../../src/service/continuation/agent/agent-conversation-store';
import { buildEmptyAgentWorldbookSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-worldbook-read';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';

/**
 * R4-03：资料补足的设计是「引擎只返回候选，编排器复核锚点/任务/资料指纹后才提交」。
 * 补足通道若开放 write_sql，子代理会在运行中直接写楼层，绕过编排器复核并改变资料指纹，
 * 编排器必然判 STALE、补足必然失败而草稿已落盘。所以补足通道只收整行契约。
 */
describe('资料补足通道', () => {
  it('不向补足子代理开放 write_sql 逐栏写入', async () => {
    const runInputs: any[] = [];
    const chat: any[] = [{ mes: 'a', is_user: false }, { mes: '正文', is_user: false }];
    const snapshot = { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 1 };
    const planner = new ContinuationAgentTurnPlanner_ACU({
      resolveApiPreset: (() => ({ presetName: 'p1', source: 'settings', reason: 'test' })) as any,
      callInternalAi: async () => null,
      subagentRuntime: {
        run: async (input: any) => {
          runInputs.push(input);
          return { agentName: input.delegation.agentName, kind: 'maintain', writes: ['hooks'], maintainer: { summary: '', delta: { hooks: [], hookPatches: [], infoGap: [], infoGapPatches: [], storyArc: [], storyArcPatches: [], chronology: [], chronologyPatches: [], constraintProposals: [], expectedRevisions: {} } }, completion: 'complete_no_change', moduleCompletion: { hooks: 'complete_no_change' }, unresolvedIssues: [], acceptedKeys: [] };
        },
      } as any,
      readChat: () => chat,
      readModuleSnapshot: () => snapshot,
      writeModuleSnapshot: async () => null,
      readConversation: () => buildEmptyAgentConversation_ACU(),
      readCompactionMark: (() => null) as any,
      appendConversationMessages: (async () => true) as any,
      writeCompactionMark: (async () => true) as any,
      loadWorldbook: async () => buildEmptyAgentWorldbookSnapshot_ACU(true),
      budget: { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 2, maxReads: 8, maxExtraReads: 1 },
    });
    await planner.repairMaterials({
      settings: buildDefaultContinuationSettings_ACU(),
      readContext: () => ({ envelope: {}, task: { taskId: 't', originInstruction: '', stages: [] }, stage: null, revision: null, node: null, turn: null, turnNumber: 1, nodeTurnNumber: 1 }) as any,
      snapshot,
      targetModules: ['hooks'],
      createInternalRequestIdentity: (attempt: number) => ({ attemptId: `a${attempt}`, source: 'turn_instruction' }) as any,
      isInternalRequestCurrent: () => true,
    });
    expect(runInputs.length).toBeGreaterThan(0);
    for (const input of runInputs) expect(input.writeSql).toBeUndefined();
  });
});
