import { describe, expect, it } from 'vitest';

import { runContinuationMaterialRepair_ACU } from '../../../src/service/continuation/agent/agent-workflow';

describe('TT 部分资料完成支持（判别红测）', () => {
  it('material-completion-status 卡片 fail-closed', async () => {
    const mod = await import('../../../src/presentation-v2/material-completion-status');
    // 未知状态不得误标 complete
    const cards = mod.buildMaterialCompletionCards_ACU({
      overallState: undefined,
      expectedModules: ['hooks'],
      modules: {},
      pendingModules: [],
      loadError: null,
    });
    expect(cards[0].state).toBe('legacy_unknown');
    // loadError 不得按空资料处理
    const failed = mod.buildMaterialCompletionCards_ACU({
      overallState: 'complete_changed',
      expectedModules: ['hooks'],
      modules: { hooks: 'complete_changed' },
      pendingModules: [],
      loadError: '读取失败',
    });
    expect(failed[0].state).toBe('load_failed');
    // partial 不得误标 complete
    const partial = mod.buildMaterialCompletionCards_ACU({
      overallState: 'partial',
      expectedModules: ['hooks', 'chronology'],
      modules: { hooks: 'complete_changed', chronology: 'failed' },
      pendingModules: ['chronology'],
      loadError: null,
    });
    expect(partial.find(c => c.module === 'chronology')!.state).toBe('pending');
  });

  it('workflow 模块可加载（补足入口与完成状态机由后文用例真实调用覆盖）', async () => {
    await import('../../../src/service/continuation/agent/agent-workflow');
  });

  it('orchestrator/engine/main-loop/subagent/transaction/model/frame/store 暴露对应改动', async () => {
    const orch = await import('../../../src/service/continuation/continuation-orchestrator');
    expect(typeof (orch.ContinuationOrchestrator_ACU.prototype as any).repairPendingMaterials).toBe('function');
    const engine = await import('../../../src/service/continuation/stage-execution-engine');
    expect(typeof (engine.StageExecutionEngine_ACU.prototype as any).repairMaterials).toBe('function');
    const planner = await import('../../../src/service/continuation/agent/agent-main-loop');
    expect(typeof (planner.ContinuationAgentTurnPlanner_ACU.prototype as any).repairMaterials).toBe('function');
    const model = await import('../../../src/service/continuation/agent/agent-model');
    expect(Array.isArray((model as any).AGENT_MATERIAL_COMPLETION_STATES_ACU)).toBe(true);
    expect(Array.isArray((model as any).AGENT_PENDING_FIX_SOURCES_ACU)).toBe(true);
    const store = await import('../../../src/service/continuation/agent/agent-module-store');
    const empty = store.buildEmptyAgentModuleSnapshot_ACU();
    expect((empty as any).materialCompletion?.state).toBe('legacy_unknown');
  });

  it('部分完成状态机 fail-closed：stale/未知不得把 partial 误标 complete', async () => {
    const store = await import('../../../src/service/continuation/agent/agent-module-store');
    const base = store.buildEmptyAgentModuleSnapshot_ACU();
    (base as any).settledThroughIndex = 4;
    (base as any).pendingFixes = [{
      module: 'hooks', agentName: 'hook-cognition-maintainer',
      violations: [{ path: 'hooks', message: '仍缺依据' }],
      attempts: 1, firstFailedAtIndex: 4, lastError: '仍缺依据',
      source: 'truncated', completion: 'failed',
      rangeStartIndex: 4, rangeEndIndex: 4, acceptedKeys: [], createdAt: 1, updatedAt: 1,
    }];
    (base as any).materialCompletion = { state: 'failed', rangeStartIndex: 4, rangeEndIndex: 4, modules: { hooks: 'failed' }, updatedAt: 1 };
    const result = await runContinuationMaterialRepair_ACU({
      snapshot: base,
      targetModules: ['hooks'],
      settledIndex: 4,
      completedStageNumbers: [],
      runAgent: async () => ({ ok: true, summary: '声称已改', completion: 'complete_changed', moduleCompletion: { hooks: 'complete_changed' } }),
    });
    // 无候选写入却声称 changed：不得清除 pending，不得误标 complete
    expect(result.snapshot.pendingFixes.map((x: any) => x.module)).toEqual(['hooks']);
    expect(result.snapshot.materialCompletion.modules.hooks).toBe('failed');
    expect(result.failedModules).toEqual(['hooks']);
  });

  it('显式补足只提交目标模块并保留其他 pending 与结算水位（TT ViaSql）', async () => {
    const store = await import('../../../src/service/continuation/agent/agent-module-store');
    const base = store.buildEmptyAgentModuleSnapshot_ACU();
    (base as any).settledThroughIndex = 4;
    (base as any).pendingFixes = [
      {
        module: 'hooks', agentName: 'hook-cognition-maintainer',
        violations: [{ path: 'hooks', message: '伏笔截断' }], attempts: 1, firstFailedAtIndex: 3, lastError: '伏笔截断',
        source: 'truncated', completion: 'failed', rangeStartIndex: 3, rangeEndIndex: 4, acceptedKeys: [], createdAt: 1, updatedAt: 1,
      },
      {
        module: 'chronology', agentName: 'hook-cognition-maintainer',
        violations: [{ path: 'chronology', message: '年代学截断' }], attempts: 1, firstFailedAtIndex: 3, lastError: '年代学截断',
        source: 'truncated', completion: 'failed', rangeStartIndex: 3, rangeEndIndex: 4, acceptedKeys: [], createdAt: 1, updatedAt: 1,
      },
    ];
    (base as any).materialCompletion = {
      state: 'partial', rangeStartIndex: 3, rangeEndIndex: 4,
      modules: { hooks: 'failed', chronology: 'failed' }, updatedAt: 1,
    };
    const calls: any[] = [];
    const result = await runContinuationMaterialRepair_ACU({
      snapshot: base,
      targetModules: ['hooks'],
      settledIndex: 8,
      completedStageNumbers: [],
      runAgent: async (call: any) => {
        calls.push(call);
        return {
          ok: true,
          summary: '只补伏笔',
          maintainer: {
            summary: '只补伏笔',
            delta: {
              expectedRevisions: {}, hooks: [{ action: 'upsert', id: 'H1', summary: '断裂的封印', status: 'planted', importance: 'mid', plantedIndex: 2, plannedPayoff: '后文回收', reason: '' }],
              hookPatches: [], infoGap: [], infoGapPatches: [], storyArc: [], storyArcPatches: [], chronology: [], constraintProposals: [],
            },
          },
          writes: ['hooks'],
          readRevisions: base.revisions,
          completion: 'complete_changed',
          moduleCompletion: { hooks: 'complete_changed' },
          acceptedKeys: ['hooks:H1'],
        };
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ agentName: 'hook-cognition-maintainer', repair: true, targetModules: ['hooks'] });
    expect(result.snapshot.hooks.map((x: any) => x.id)).toContain('H1');
    expect(result.snapshot.pendingFixes.map((x: any) => x.module)).toEqual(['chronology']);
    expect(result.snapshot.settledThroughIndex).toBe(4);
    expect(result.repairedModules).toEqual(['hooks']);
    expect(result.failedModules).toEqual([]);
    // complete 不得回退为 partial 丢数：已完成模块的 revision 已推进
    expect(result.snapshot.revisions.hooks).toBeGreaterThan(base.revisions.hooks);
  });

  it('未知完成态与并发挂账 fail-closed：非法模块态拒绝整份快照', async () => {
    const store = await import('../../../src/service/continuation/agent/agent-module-store');
    const empty = store.buildEmptyAgentModuleSnapshot_ACU();
    // 未知模块态不得入库
    expect(store.validateAgentModuleSnapshot_ACU({
      ...empty, materialCompletion: { state: 'complete_changed', rangeStartIndex: 0, rangeEndIndex: 0, modules: { hooks: 'not_a_state' }, updatedAt: 1 },
    })).toBeNull();
    // range 非法不得入库
    expect(store.validateAgentModuleSnapshot_ACU({
      ...empty, materialCompletion: { state: 'partial', rangeStartIndex: 5, rangeEndIndex: 3, modules: {}, updatedAt: 1 },
    })).toBeNull();
  });
});
