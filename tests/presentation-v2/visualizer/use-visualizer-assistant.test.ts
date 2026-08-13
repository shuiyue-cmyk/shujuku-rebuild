/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const {
  mockRunSession,
  mockFingerprint,
  mockGetBaselineFingerprint,
  mockCreateGuard,
} = vi.hoisted(() => ({
  mockRunSession: vi.fn(),
  mockFingerprint: vi.fn((data: any) => `fp:${JSON.stringify(data)}`),
  mockGetBaselineFingerprint: vi.fn((result: any) =>
    String(result?.originalBaseFingerprint || result?.draft?.baseFingerprint || ''),
  ),
  mockCreateGuard: vi.fn(() => ({
    createRunGuard: () => ({
      isCancelled: () => false,
      isStale: () => false,
      get signal() { return new AbortController().signal; },
    }),
    invalidate: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    getSignal: () => new AbortController().signal,
  })),
}));

vi.mock('../../../src/service/template-assistant/service', () => ({
  buildTemplateAssistantFingerprint_ACU: mockFingerprint,
  buildPseudoRoleTemplateAssistantPromptSegments_ACU: () => [
    { role: 'SYSTEM', content: '伪 role 模板卡', deletable: false },
  ],
  createTemplateAssistantSessionGuard_ACU: mockCreateGuard,
  getTemplateAssistantApplyBaselineFingerprint_ACU: mockGetBaselineFingerprint,
  hasTemplateAssistantApplicableDraft_ACU: (draft: any) =>
    Array.isArray(draft?.operations) && draft.operations.length > 0 || draft?.protocolVersion === 3 && ['replace', 'create', 'delete'].includes(draft?.result?.action),
  resolveAssistantSystemPrompt_ACU: (segments: any[]) => (Array.isArray(segments) && segments.length
    ? segments.map((seg: any) => ({ role: seg.role, content: seg.content }))
    : [{ role: 'SYSTEM', content: '伪 role 模板卡' }]),
  runTemplateAssistantSession_ACU: mockRunSession,
  setTemplateAssistantPrompt_ACU: vi.fn((segments: any[]) => ({ ok: true })),
  TemplateAssistantSessionStoppedError_ACU: class TemplateAssistantSessionStoppedError_ACU extends Error {},
}));

function buildResult(input: any, overrides: any = {}) {
  const baseFingerprint = mockFingerprint(input.tempData);
  return {
    draft: {
      protocolVersion: 2,
      mode: 'modify_current_template_incremental',
      requestId: 'req-v2',
      atomic: true,
      baseFingerprint,
      selectedSheetKey: input.currentSheetKey,
      summary: '已生成草稿',
      warnings: [],
      operations: [{ op: 'add_sheet', sheetName: '测试表', headers: ['名称'] }],
      ...overrides.draft,
    },
    aiRawText: '<templateAssistantDraft>{}</templateAssistantDraft>',
    messages: [],
    originalBaseFingerprint: baseFingerprint,
    rounds: [],
    session: {
      originalBaseFingerprint: baseFingerprint,
      finalWorkingFingerprint: 'next',
      stopReason: 'success',
      roundsExecuted: 1,
      maxRounds: 1,
      lastFailure: null,
      repairRetriesUsed: 0,
      maxRepairRetries: 1,
      lastErrorMessage: '',
      ...overrides.session,
    },
    compileResult: {
      candidateData: input.tempData,
      orderedSheetKeys: input.sheetOrder,
      deletedSheetKeys: [],
      focusSheetKey: input.currentSheetKey,
      diff: {
        addedSheets: [],
        deletedSheets: [],
        renamedSheets: [],
        movedSheets: [],
        patchedSourceDataSheets: [],
        patchedUpdateConfigSheets: [],
        patchedExportConfigSheets: [],
        patchedContentSheets: [],
        patchedSchemaSheets: [],
        patchedLockSheets: [],
        globalInjectionChanged: false,
      },
      highRiskItems: [],
      lockChanges: [],
      ...overrides.compileResult,
    },
    // 顶层标量字段兜底（aiRawText / messages / rounds / originalBaseFingerprint 等），
    // 不覆盖已展开的 draft / session / compileResult 对象，避免意外替换破坏结构。
    ...(Object.fromEntries(Object.entries(overrides).filter(([key]) => !['draft', 'session', 'compileResult'].includes(key)))),
  };
}

describe('useVisualizerAssistant', () => {
  beforeEach(() => {
    vi.resetModules();
    mockRunSession.mockReset();
    mockFingerprint.mockClear();
    mockGetBaselineFingerprint.mockClear();
    mockCreateGuard.mockClear();
    setActivePinia(createPinia());
  });

  it('按当前锚点表分组展示 diff 范围', async () => {
    const { buildVisualizerAssistantDiffGroups } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const groups = buildVisualizerAssistantDiffGroups({
      compileResult: {
        diff: {
          addedSheets: [{ sheetKey: 'sheet_new', name: '战利品表' }],
          deletedSheets: [{ sheetKey: 'sheet_old', name: '旧表' }],
          renamedSheets: [],
          movedSheets: [{ sheetKey: 'sheet_b', name: 'B表', fromIndex: 2, toIndex: 1 }],
          patchedSourceDataSheets: [],
          patchedUpdateConfigSheets: [{ sheetKey: 'sheet_a', name: 'A表', keys: ['contextDepth'] }],
          patchedExportConfigSheets: [],
          patchedContentSheets: [{ sheetKey: 'sheet_b', name: 'B表', changes: ['新增 1 行'] }],
          patchedSchemaSheets: [],
          patchedLockSheets: [{ sheetKey: 'sheet_a', name: 'A表', changes: ['锁定列: 状态'] }],
          globalInjectionChanged: true,
        },
      },
    } as any, 'sheet_a');

    expect(groups.find(group => group.key === 'current')?.items.join('；')).toContain('A表: 更新参数 contextDepth');
    expect(groups.find(group => group.key === 'other')?.items.join('；')).toContain('B表: 新增 1 行');
    expect(groups.find(group => group.key === 'added')?.items.join('；')).toContain('战利品表 [sheet_new]');
    expect(groups.find(group => group.key === 'deleted')?.tone).toBe('warning');
    expect(groups.find(group => group.key === 'global')?.items[0]).toContain('全局注入配置');
    expect(groups.find(group => group.key === 'locks')?.items[0]).toContain('锁定列');
  });

  it('调用 session runner 并把确认后的草稿应用到 visualizer 临时态', async () => {
    const { settings_ACU } = await import('../../../src/service/runtime/state-manager');
    settings_ACU.apiPresets = [{ name: 'preset-beta' }] as any;
    settings_ACU.tableApiPreset = 'preset-alpha';
    settings_ACU.tableApiPresetOverridesByName = { A表: 'preset-beta' };

    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: {
        uid: 'sheet_a',
        name: 'A表',
        orderNo: 0,
        content: [[null, '姓名'], [null, 'A']],
      },
    }, ['sheet_a']);

    mockRunSession.mockImplementation(async (input: any) => buildResult(input, {
      compileResult: {
        candidateData: {
          mate: { type: 'chatSheets', version: 1 },
          sheet_a: {
            uid: 'sheet_a',
            name: 'A表',
            orderNo: 0,
            content: [[null, '姓名', '状态'], [null, 'A', '警觉']],
          },
          sheet_b: {
            uid: 'sheet_b',
            name: 'B表',
            orderNo: 1,
            content: [[null, '字段']],
          },
        },
        orderedSheetKeys: ['sheet_a', 'sheet_b'],
        deletedSheetKeys: ['sheet_old'],
        diff: {
          addedSheets: [{ sheetKey: 'sheet_b', name: 'B表' }],
          deletedSheets: [],
          renamedSheets: [],
          movedSheets: [],
          patchedSourceDataSheets: [],
          patchedUpdateConfigSheets: [],
          patchedExportConfigSheets: [],
          patchedContentSheets: [{ sheetKey: 'sheet_a', name: 'A表', changes: ['改单元格'] }],
          patchedSchemaSheets: [],
          patchedLockSheets: [],
          globalInjectionChanged: false,
        },
        highRiskItems: [{ type: 'delete_sheet', label: '删除表: 旧表' }],
      },
    }));

    const assistant = useVisualizerAssistant();
    expect(assistant.tableApiPreset.value).toBe('preset-beta');
    assistant.userRequest.value = '新增状态列';
    await assistant.run();

    expect(mockRunSession).toHaveBeenCalledWith(expect.objectContaining({
      currentSheetKey: 'sheet_a',
      sheetOrder: ['sheet_a'],
      userRequest: '新增状态列',
      tableApiPreset: 'preset-beta',
    }));
    expect(assistant.canApply.value).toBe(false);

    const finalTurn = assistant.turns.value.find(turn => turn.type === 'final') as any;
    assistant.setRiskConfirmation(finalTurn.id, 0, true);
    expect(assistant.canApply.value).toBe(true);
    expect(assistant.applyLatestDraft()).toBe(true);

    expect(visualizer.dirty).toBe(true);
    expect(visualizer.sheetOrder).toEqual(['sheet_a', 'sheet_b']);
    expect(visualizer.deletedSheetKeys).toContain('sheet_old');
    expect(visualizer.currentSheet.content[1][2]).toBe('警觉');
  });

  it('saving 状态下应用 AI 草稿会在任何草稿写入前拒绝', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);
    mockRunSession.mockImplementation(async (input: any) => buildResult(input, {
      compileResult: {
        candidateData: {
          mate: { type: 'chatSheets', version: 1 },
          sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名', '状态'], [null, 'A', '警觉']] },
        },
        orderedSheetKeys: ['sheet_a'],
        deletedSheetKeys: ['sheet_old'],
        lockChanges: [{ sheetKey: 'sheet_a', rows: [{ rowIndex: 0, locked: true }] }],
      },
    }));
    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '新增状态列';
    await assistant.run();
    visualizer.setSaving(true);
    const before = JSON.stringify({
      tempData: visualizer.tempData,
      sheetOrder: visualizer.sheetOrder,
      deletedSheetKeys: visualizer.deletedSheetKeys,
      tableLockDrafts: visualizer.tableLockDrafts,
      pendingLockChanges: visualizer.pendingLockChanges,
      dirty: visualizer.dirty,
    });

    expect(() => assistant.applyLatestDraft()).toThrow('保存正在进行中');

    expect(JSON.stringify({
      tempData: visualizer.tempData,
      sheetOrder: visualizer.sheetOrder,
      deletedSheetKeys: visualizer.deletedSheetKeys,
      tableLockDrafts: visualizer.tableLockDrafts,
      pendingLockChanges: visualizer.pendingLockChanges,
      dirty: visualizer.dirty,
    })).toBe(before);
  });

  it('schema/DDL 高风险项必须手动确认后才能应用', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名']] },
    }, ['sheet_a']);

    mockRunSession.mockImplementation(async (input: any) => buildResult(input, {
      compileResult: {
        highRiskItems: [{ type: 'patch_sheet_schema', label: '更新 DDL: A表' }],
      },
    }));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '更新 DDL';
    await assistant.run();

    expect(assistant.canApply.value).toBe(false);
    const finalTurn = assistant.turns.value.find(turn => turn.type === 'final') as any;
    assistant.setRiskConfirmation(finalTurn.id, 0, true);
    expect(assistant.canApply.value).toBe(true);
  });

  it('跨表变更会派生高风险确认，确认前不能应用', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
      sheet_b: { uid: 'sheet_b', name: 'B表', orderNo: 1, content: [[null, '状态'], [null, '平静']] },
    }, ['sheet_a', 'sheet_b']);

    mockRunSession.mockImplementation(async (input: any) => buildResult(input, {
      compileResult: {
        diff: {
          addedSheets: [],
          deletedSheets: [],
          renamedSheets: [],
          movedSheets: [],
          patchedSourceDataSheets: [],
          patchedUpdateConfigSheets: [],
          patchedExportConfigSheets: [],
          patchedContentSheets: [{ sheetKey: 'sheet_b', name: 'B表', changes: ['改单元格'] }],
          patchedSchemaSheets: [],
          patchedLockSheets: [],
          globalInjectionChanged: false,
        },
        highRiskItems: [],
      },
    }));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '顺便调整 B 表';
    await assistant.run();

    expect(assistant.highRiskItems.value.map(item => item.label).join('；')).toContain('跨表变更：B表 的数据内容');
    expect(assistant.canApply.value).toBe(false);
    expect(assistant.applyLatestDraft()).toBe(false);

    const finalTurn = assistant.turns.value.find(turn => turn.type === 'final') as any;
    assistant.setRiskConfirmation(finalTurn.id, 0, true);
    expect(assistant.canApply.value).toBe(true);
  });

  it('AI 草稿和完整 transcript 保存在 visualizer store，重新创建 composable 后仍可继续应用', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);

    mockRunSession.mockImplementation(async (input: any) => {
      const result = buildResult(input, {
        compileResult: {
          candidateData: {
            mate: { type: 'chatSheets', version: 1 },
            sheet_a: {
              uid: 'sheet_a',
              name: 'A表',
              orderNo: 0,
              content: [[null, '姓名', '状态'], [null, 'A', '警觉']],
            },
          },
          orderedSheetKeys: ['sheet_a'],
          diff: {
            addedSheets: [],
            deletedSheets: [],
            renamedSheets: [],
            movedSheets: [],
            patchedSourceDataSheets: [],
            patchedUpdateConfigSheets: [],
            patchedExportConfigSheets: [],
            patchedContentSheets: [{ sheetKey: 'sheet_a', name: 'A表', changes: ['改单元格'] }],
            patchedSchemaSheets: [],
            patchedLockSheets: [],
            globalInjectionChanged: false,
          },
          highRiskItems: [],
        },
      });
      const round = {
        round: 1,
        userRequest: input.userRequest,
        draft: {
          ...result.draft,
          summary: '第一轮草稿',
          warnings: ['请检查新增字段是否符合预期'],
        },
        aiRawText: '<templateAssistantDraft>{"round":1}</templateAssistantDraft>',
        messages: [],
        perRoundCompileResult: result.compileResult,
        workingFingerprint: 'round-fp',
      };
      input.onRoundComplete?.({ round, rounds: [round], maxRounds: input.maxRounds });
      return {
        ...result,
        rounds: [round],
      };
    });

    const firstAssistant = useVisualizerAssistant();
    firstAssistant.userRequest.value = '新增状态列';
    await firstAssistant.run();

    const remountedAssistant = useVisualizerAssistant();
    expect(remountedAssistant.latestResult.value?.draft.summary).toBe('已生成草稿');
    expect(remountedAssistant.turns.value.map(turn => turn.type)).toEqual(['user', 'final']);
    expect(remountedAssistant.getTurnSummary(remountedAssistant.turns.value[0])).toBe('新增状态列');
    expect(remountedAssistant.getTurnWarnings(remountedAssistant.turns.value[1])).toEqual([]);
    expect(remountedAssistant.getTurnDiffGroups(remountedAssistant.turns.value[1]).map(group => group.title).join('；')).toContain('当前锚点表内容');
    expect(remountedAssistant.canApply.value).toBe(true);
    expect(remountedAssistant.applyLatestDraft()).toBe(true);
    expect(visualizer.currentSheet.content[1][2]).toBe('警觉');
  });

  it('session runner 失败时把错误写入 transcript', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);
    mockRunSession.mockRejectedValue(new Error('模型返回格式错误'));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '生成非法草稿';
    expect(await assistant.run()).toBe(false);

    expect(assistant.turns.value.map(turn => turn.type)).toEqual(['user', 'error']);
    expect(assistant.getTurnSummary(assistant.turns.value[1])).toContain('模型返回格式错误');
    expect(assistant.latestResult.value).toBeNull();
  });

  it('切表后保留草稿原锚点分组，但禁止直接应用旧锚点草稿', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名']] },
      sheet_b: { uid: 'sheet_b', name: 'B表', orderNo: 1, content: [[null, '字段']] },
    }, ['sheet_a', 'sheet_b']);

    mockRunSession.mockImplementation(async (input: any) => buildResult(input, {
      compileResult: {
        diff: {
          addedSheets: [],
          deletedSheets: [],
          renamedSheets: [],
          movedSheets: [],
          patchedSourceDataSheets: [],
          patchedUpdateConfigSheets: [{ sheetKey: 'sheet_a', name: 'A表', keys: ['contextDepth'] }],
          patchedExportConfigSheets: [],
          patchedContentSheets: [],
          patchedSchemaSheets: [],
          patchedLockSheets: [],
          globalInjectionChanged: false,
        },
      },
    }));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '调整 A 表参数';
    await assistant.run();

    visualizer.selectSheet('sheet_b');

    expect(assistant.anchorSheetLabel.value).toBe('A表 (sheet_a)');
    expect(assistant.diffGroups.value.find(group => group.key === 'current')?.items.join('；')).toContain('A表: 更新参数 contextDepth');
    expect(assistant.canApply.value).toBe(false);
    expect(assistant.applyLatestDraft()).toBe(false);
  });

  it('应用 AI lockChanges 时只进入 visualizer 草稿，保存前不写入运行时锁设置', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);

    mockRunSession.mockImplementation(async (input: any) => buildResult(input, {
      compileResult: {
        lockChanges: [
          {
            sheetKey: 'sheet_a',
            rows: [{ rowIndex: 0, locked: true }],
            columns: [],
            cells: [],
            specialIndexLocked: false,
          },
        ],
      },
    }));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '锁定第一行';
    await assistant.run();

    expect(assistant.applyLatestDraft()).toBe(true);
    expect(visualizer.pendingLockChanges).toHaveLength(1);
    expect(visualizer.pendingLockChanges[0].sheetKey).toBe('sheet_a');
  });

  it('会话失败时透出 lastFailure（分类 + 原文）供失败横幅渲染', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);

    mockRunSession.mockImplementation(async (input: any) => buildResult(input, {
      session: {
        originalBaseFingerprint: 'fp:base',
        finalWorkingFingerprint: 'next',
        stopReason: 'repair_retry_capped',
        roundsExecuted: 0,
        maxRounds: 1,
        repairRetriesUsed: 1,
        maxRepairRetries: 1,
        lastErrorMessage: 'AI 响应中未找到 <templateAssistantDraft> 标签',
        lastFailure: {
          kind: 'parse',
          message: 'AI 响应中未找到 <templateAssistantDraft> 标签',
          rawText: '这只是一段解释文字',
        },
      },
    }));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '生成草稿';
    await assistant.run();

    expect(assistant.latestResult.value?.session.stopReason).toBe('repair_retry_capped');
    expect(assistant.lastFailure.value?.kind).toBe('parse');
    expect(assistant.lastFailure.value?.message).toContain('templateAssistantDraft');
    expect(assistant.lastFailure.value?.rawText).toBe('这只是一段解释文字');
    // 失败时无合法草稿 → 不可应用
    expect(assistant.canApply.value).toBe(false);
  });

  it('会话被取消（StoppedError）时：不写入 final turn / latestResult，只追加错误 turn（停止按钮语义）', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);

    const { TemplateAssistantSessionStoppedError_ACU } = await import('../../../src/service/template-assistant/service');
    // 真实时序：AI 返回 → onRoundComplete 已触发（service 会先写状态）→ 回调后 service 因
    // guard.cancel 抛出 StoppedError → UI catch。模拟 service 的这一行为。
    mockRunSession.mockImplementation(async (input: any) => {
      const round = {
        round: 1,
        userRequest: input.userRequest,
        draft: { protocolVersion: 2, requestId: 'req-cancel', atomic: true, selectedSheetKey: input.currentSheetKey, summary: '取消前草稿', warnings: [] },
        aiRawText: '<templateAssistantDraft>{"round":1}</templateAssistantDraft>',
        messages: [],
        perRoundCompileResult: {},
        workingFingerprint: 'round-fp',
      };
      input.onRoundComplete?.({ round, rounds: [round], maxRounds: 1 });
      throw new TemplateAssistantSessionStoppedError_ACU('cancelled');
    });

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '生成草稿';
    await assistant.run();

    // 真实取消时序下：round 状态可能已同步（assistantRounds），但绝不产生 final turn，
    // latestResult 保持 null，只追加错误 turn。
    expect(assistant.turns.value.map(turn => turn.type)).toEqual(['user', 'error']);
    expect(assistant.latestResult.value).toBeNull();
    expect(assistant.isRunning.value).toBe(false);
  });

  it('runWithRepairFeedback 会把修改意见拼进 userRequest 重新发起会话', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);

    mockRunSession.mockImplementation(async (input: any) => buildResult(input));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '新增状态列';
    const ok = await assistant.runWithRepairFeedback('不要输出解释文字，直接给 JSON');

    expect(ok).toBe(true);
    expect(mockRunSession).toHaveBeenCalledWith(expect.objectContaining({
      userRequest: '新增状态列\n\n补充要求：不要输出解释文字，直接给 JSON',
    }));
  });

  it('提示词抽屉子状态：默认 segments、编辑 dirty、保存/重置', async () => {
    const { settings_ACU } = await import('../../../src/service/runtime/state-manager');
    settings_ACU.templateAssistantPromptSegments = [];
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);

    const assistant = useVisualizerAssistant();
    expect(assistant.promptSegments.value).toEqual([{ role: 'SYSTEM', content: '伪 role 模板卡', deletable: false }]);
    expect(assistant.promptDirty.value).toBe(false);

    assistant.updatePromptSegment(0, { content: '修改后的规则' });
    expect(assistant.promptDirty.value).toBe(true);

    assistant.addPromptSegment('bottom');
    expect(assistant.promptSegments.value).toHaveLength(2);
    expect(assistant.promptDirty.value).toBe(true);

    expect(assistant.savePrompt()).toBe(true);
    expect(assistant.promptDirty.value).toBe(false);

    assistant.resetPrompt();
    expect(assistant.promptSegments.value).toEqual([{ role: 'SYSTEM', content: '伪 role 模板卡', deletable: false }]);
    expect(assistant.promptDirty.value).toBe(true);
  });

  it('getTurnApplyPayload：user/error/空 operations 返回 null，round/final 返回各自载荷', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant, getTurnApplyPayload } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);

    mockRunSession.mockImplementation(async (input: any) => {
      const result = buildResult(input, {
        compileResult: {
          candidateData: {
            mate: { type: 'chatSheets', version: 1 },
            sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名', '状态'], [null, 'A', '警觉']] },
          },
          orderedSheetKeys: ['sheet_a'],
        },
      });
      const round = {
        round: 1,
        userRequest: input.userRequest,
        draft: { ...result.draft, summary: '第一轮草稿' },
        aiRawText: '<templateAssistantDraft>{"round":1}</templateAssistantDraft>',
        messages: [],
        perRoundCompileResult: result.compileResult,
        workingFingerprint: 'round-fp',
      };
      input.onRoundComplete?.({ round, rounds: [round], maxRounds: input.maxRounds });
      return { ...result, rounds: [round] };
    });

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '新增状态列';
    await assistant.run();

    const turns = assistant.turns.value;
    const userTurn = turns[0];
    const finalTurn = turns[1];
    expect(getTurnApplyPayload(userTurn)).toBeNull();
    expect(getTurnApplyPayload(finalTurn)?.candidateData.sheet_a.content[1][2]).toBe('警觉');

    // 空 operations 的 final → null
    const emptyOpTurn = {
      id: 'final-empty',
      type: 'final',
      userRequest: 'x',
      result: buildResult({ tempData: visualizer.tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'] }, { draft: { operations: [] } }),
      anchorSheetKey: 'sheet_a',
      createdAt: Date.now(),
    };
    expect(getTurnApplyPayload(emptyOpTurn as any)).toBeNull();
  });

  it('canApplyTurn：指纹不一致 / 未确认高风险 / 锚点不符 → false，确认后 true', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);

    mockRunSession.mockImplementation(async (input: any) => buildResult(input, {
      compileResult: {
        highRiskItems: [{ type: 'delete_sheet', label: '删除表: 旧表' }],
        candidateData: {
          mate: { type: 'chatSheets', version: 1 },
          sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名', '状态'], [null, 'A', '警觉']] },
        },
        orderedSheetKeys: ['sheet_a'],
      },
    }));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '新增状态列';
    await assistant.run();

    const finalTurn = assistant.turns.value.find(turn => turn.type === 'final') as any;
    expect(assistant.canApplyTurn(finalTurn)).toBe(false); // 高风险未确认
    expect(assistant.getTurnApplyBlockReason(finalTurn)).toContain('高风险');

    assistant.setRiskConfirmation(finalTurn.id, 0, true);
    expect(assistant.canApplyTurn(finalTurn)).toBe(true);

    // 指纹不一致 → false
    visualizer.tempData = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'B']] },
    };
    expect(assistant.canApplyTurn(finalTurn)).toBe(false);
    expect(assistant.getTurnApplyBlockReason(finalTurn)).toContain('结构已变化');
  });

  it('风险确认按 turn 隔离：turn A 确认第 0 项不影响 turn B 的 canApplyTurn', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);

    mockRunSession.mockImplementation(async (input: any) => buildResult(input, {
      compileResult: { highRiskItems: [{ type: 'delete_sheet', label: '删除表: 旧表' }] },
    }));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '新增状态列';
    await assistant.run();

    const finalTurn = assistant.turns.value.find(turn => turn.type === 'final') as any;
    const otherTurn = {
      id: 'other-final',
      type: 'final',
      userRequest: '其他',
      result: finalTurn.result,
      anchorSheetKey: 'sheet_a',
      createdAt: Date.now(),
    };
    assistant.setRiskConfirmation(finalTurn.id, 0, true);
    expect(assistant.isTurnAllHighRiskConfirmed(finalTurn)).toBe(true);
    expect(assistant.isTurnAllHighRiskConfirmed(otherTurn as any)).toBe(false);
  });

  it('applyTurnDraft 应用到较早那张 final turn 时写入的是该 turn 自己的 candidateData', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);

    const candidateA = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名', '第A列'], [null, 'A', 'a1']] },
    };
    const candidateB = {
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名', '第B列'], [null, 'A', 'b1']] },
    };
    mockRunSession.mockImplementation(async (input: any) => buildResult(input, {
      compileResult: { candidateData: candidateA, orderedSheetKeys: ['sheet_a'] },
    }));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '第一版';
    await assistant.run();
    const firstFinal = assistant.turns.value.find(turn => turn.type === 'final') as any;

    // 第二次会话（不同 requestId）
    mockRunSession.mockImplementation(async (input: any) => buildResult(input, {
      draft: { requestId: 'req-v2-second' },
      compileResult: { candidateData: candidateB, orderedSheetKeys: ['sheet_a'] },
    }));
    assistant.userRequest.value = '第二版';
    await assistant.run();

    const secondFinal = assistant.turns.value.filter(turn => turn.type === 'final').pop() as any;
    expect(secondFinal.result.draft.requestId).toBe('req-v2-second');

    // 应用较早那张
    expect(assistant.applyTurnDraft(firstFinal)).toBe(true);
    expect(visualizer.tempData.sheet_a.content[1][2]).toBe('a1');
  });

  it('getTurnRawText 回退链：final 的 aiRawText 为空时回退 session.lastFailure.rawText', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);

    mockRunSession.mockImplementation(async (input: any) => buildResult(input, {
      aiRawText: '',
      session: {
        stopReason: 'repair_retry_capped',
        roundsExecuted: 0,
        lastFailure: { kind: 'parse', message: '未找到标签', rawText: '这是失败原文' },
      },
    }));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '生成草稿';
    await assistant.run();

    const finalTurn = assistant.turns.value.find(turn => turn.type === 'final') as any;
    expect(assistant.getTurnRawText(finalTurn)).toBe('这是失败原文');
  });

  it('getTurnApplyPayload：candidateData 为空对象时返回 null（防清空编辑器）', async () => {
    const { getTurnApplyPayload } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);

    const finalTurn = {
      id: 'final-empty-candidate',
      type: 'final',
      userRequest: 'x',
      result: buildResult(
        { tempData: visualizer.tempData, currentSheetKey: 'sheet_a', sheetOrder: ['sheet_a'] },
        { compileResult: { candidateData: {} } },
      ),
      anchorSheetKey: 'sheet_a',
      createdAt: Date.now(),
    };
    expect(getTurnApplyPayload(finalTurn as any)).toBeNull();
  });

  it('deleteTurn 删除 final turn → latestResult 回退到上一张存活 final turn', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);
    mockRunSession.mockImplementation(async (input: any) => buildResult(input, {
      draft: { summary: `草稿-${input.userRequest}` },
    }));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '第一轮';
    await assistant.run();
    assistant.userRequest.value = '第二轮';
    await assistant.run();

    const finals = assistant.turns.value.filter(turn => turn.type === 'final') as any[];
    expect(finals).toHaveLength(2);
    expect((visualizer.assistantLatestResult as any)?.draft?.summary).toBe('草稿-第二轮');

    const firstFinal = finals[0];
    expect(assistant.deleteTurn(firstFinal.id)).toBe(true);
    expect(assistant.turns.value.find(turn => turn.id === firstFinal.id)).toBeUndefined();
    // latestResult 回退到第二张 final（仍存活）
    expect((visualizer.assistantLatestResult as any)?.draft?.summary).toBe('草稿-第二轮');
  });

  it('deleteTurn 删除唯一 final turn → latestResult 变为 null、rounds 清空', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);
    mockRunSession.mockImplementation(async (input: any) => buildResult(input));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '生成';
    await assistant.run();
    const finalTurn = assistant.turns.value.find(turn => turn.type === 'final') as any;
    expect(visualizer.assistantLatestResult).not.toBeNull();

    expect(assistant.deleteTurn(finalTurn.id)).toBe(true);
    expect(visualizer.assistantLatestResult).toBeNull();
  });

  it('deleteTurn 后该 turn 的 riskConfirmations 键被清理，其它 turn 的键不受影响', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);
    mockRunSession.mockImplementation(async (input: any) => buildResult(input));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = 'A轮';
    await assistant.run();
    assistant.userRequest.value = 'B轮';
    await assistant.run();

    const finals = assistant.turns.value.filter(turn => turn.type === 'final') as any[];
    const [fa, fb] = finals;
    assistant.setRiskConfirmation(fa.id, 0, true);
    assistant.setRiskConfirmation(fb.id, 0, true);
    expect(visualizer.assistantRiskConfirmations[`${fa.id}:0`]).toBe(true);
    expect(visualizer.assistantRiskConfirmations[`${fb.id}:0`]).toBe(true);

    assistant.deleteTurn(fa.id);
    expect(visualizer.assistantRiskConfirmations[`${fa.id}:0`]).toBeUndefined();
    expect(visualizer.assistantRiskConfirmations[`${fb.id}:0`]).toBe(true);
  });

  it('regenerateFromUserTurn 截断该 user turn 及之后记录，并以原需求重新调用 session runner', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);
    mockRunSession.mockImplementation(async (input: any) => buildResult(input));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '第二轮';
    await assistant.run();
    const beforeCount = assistant.turns.value.length;
    const secondUser = assistant.turns.value.find(turn => turn.type === 'user') as any;
    // 该 user turn 是唯一 user turn；截断后 turns 清空，再以原需求重跑
    mockRunSession.mockClear();

    const ok = await assistant.regenerateFromUserTurn(secondUser);
    expect(ok).toBe(true);
    // 截断后原 turn 全部移除，重新发起一次会话
    expect(assistant.turns.value.find(turn => turn.id === secondUser.id)).toBeUndefined();
    expect(mockRunSession).toHaveBeenCalledTimes(1);
    expect(mockRunSession).toHaveBeenCalledWith(expect.objectContaining({ userRequest: '第二轮' }));
    // 重新生成后产生新的 user + final
    expect(assistant.turns.value.filter(turn => turn.type === 'user')).toHaveLength(1);
    expect(beforeCount).toBeGreaterThan(0);
  });

  it('regenerateFromUserTurn 对非 user turn 返回 false 且不调用 runner', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);
    mockRunSession.mockImplementation(async (input: any) => buildResult(input));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '生成';
    await assistant.run();
    const finalTurn = assistant.turns.value.find(turn => turn.type === 'final') as any;
    mockRunSession.mockClear();

    expect(await assistant.regenerateFromUserTurn(finalTurn)).toBe(false);
    expect(mockRunSession).not.toHaveBeenCalled();
  });

  it('isRunning 为 true 时 deleteTurn / regenerateFromUserTurn 均拒绝且不改动 turns', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);
    mockRunSession.mockImplementation(async (input: any) => buildResult(input));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '生成';
    await assistant.run();
    const before = assistant.turns.value.length;
    const userTurn = assistant.turns.value.find(turn => turn.type === 'user') as any;
    const finalTurn = assistant.turns.value.find(turn => turn.type === 'final') as any;
    // 模拟运行中
    visualizer.assistantIsRunning = true;

    expect(assistant.deleteTurn(finalTurn.id)).toBe(false);
    expect(await assistant.regenerateFromUserTurn(userTurn)).toBe(false);
    expect(assistant.turns.value.length).toBe(before);
    expect(assistant.turns.value.find(turn => turn.id === finalTurn.id)).toBeDefined();
  });


  it('v3 row_id 集合缩减派生高风险确认，确认前不能应用', async () => {
    const { useVisualizerStore } = await import('../../../src/presentation-v2/stores/visualizer-store');
    const { useVisualizerAssistant } = await import('../../../src/presentation-v2/composables/visualizer/useVisualizerAssistant');
    const visualizer = useVisualizerStore();
    visualizer.loadSnapshot({
      mate: { type: 'chatSheets', version: 1 },
      sheet_a: { uid: 'sheet_a', name: 'A表', orderNo: 0, content: [[null, '姓名'], [null, 'A']] },
    }, ['sheet_a']);
    mockRunSession.mockImplementation(async (input: any) => buildResult(input, {
      session: {
        v3RowIdGuardFindings: [{
          code: 'row_id_set_reduction',
          sheetKey: 'sheet_a',
          beforeRowCount: 3,
          afterRowCount: 1,
          message: 'row_id 集合缩减',
        }],
      },
    }));

    const assistant = useVisualizerAssistant();
    assistant.userRequest.value = '精简行数据';
    await assistant.run();

    expect(assistant.highRiskItems.value.map(item => item.label).join('；')).toContain('row_id 集合缩减');
    expect(assistant.canApply.value).toBe(false);
    expect(assistant.applyLatestDraft()).toBe(false);

    const finalTurn = assistant.turns.value.find(turn => turn.type === 'final') as any;
    assistant.setRiskConfirmation(finalTurn.id, 0, true);
    expect(assistant.canApply.value).toBe(true);
  });

});
