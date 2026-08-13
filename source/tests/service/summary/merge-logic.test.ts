/**
 * tests/service/summary/merge-logic.test.ts
 * 合并纪要逻辑 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSettings, mockCurrentJsonTableData, mockSendConnectionManager, mockExtractTableEditInner, mockBuildCustomBody } = vi.hoisted(() => {
  const mockSettings: any = {
    autoMergeEnabled: true,
    autoMergeThreshold: 5,
    autoMergeReserve: 0,
  };
  const mockCurrentJsonTableData: any = {
    sheet_0: {
      name: '纪要表',
      content: [
        ['row_id', '事件', '时间', '状态'],
        ['1', '勇者出发', '第1天', ''],
        ['2', '遇到恶龙', '第3天', ''],
        ['3', '击败恶龙', '第5天', ''],
        ['4', '返回城镇', '第7天', ''],
        ['5', '获得奖赏', '第8天', ''],
        ['6', '再次出发', '第10天', ''],
        ['7', '发现宝藏', '第12天', ''],
      ],
    },
  };
  const mockSendConnectionManager = vi.fn();
  const mockExtractTableEditInner = vi.fn(() => '');
  const mockBuildCustomBody = vi.fn(() => ({ messages: [], model: 'gpt-4', max_tokens: 4096, temperature: 1.0, top_p: 0.95, stream: false }));
  return { mockSettings, mockCurrentJsonTableData, mockSendConnectionManager, mockExtractTableEditInner, mockBuildCustomBody };
});

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
  currentJsonTableData_ACU: mockCurrentJsonTableData,
  currentChatFileIdentifier_ACU: 'test-chat',
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  isSummaryOrOutlineTable_ACU: vi.fn((name: string) => name.includes('总结') || name.includes('纪要')),
}));

vi.mock('../../../src/shared/env', () => ({
  topLevelWindow_ACU: {},
  FORBID_BROWSER_LOCAL_STORAGE_FOR_CONFIG_ACU: true,
}));

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_CHAR_CARD_PROMPT_ACU: '',
  DEFAULT_MERGE_SUMMARY_PROMPT_ACU: '合并纪要提示词',
}));

vi.mock('../../../src/data/gateways/ai-gateway', () => ({
  sendConnectionManagerRequest_ACU: mockSendConnectionManager,
  isGenerateRawAvailable_ACU: vi.fn(() => false),
  generateRaw_ACU: vi.fn(),
  getHostRequestHeaders_ACU: vi.fn(() => ({})),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getLastMessageIndex_ACU: vi.fn(() => 10),
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  updateReadableLorebookEntry_ACU: vi.fn(),
}));

const mockRunTableUpdateCommit = vi.hoisted(() => vi.fn(async (_options: any, apply: any) => {
  const applied = await apply({ transactionContext: { runCommit: async (task: any) => task() }, workingData: mockCurrentJsonTableData });
  return { success: applied.success !== false, value: applied.value, tableData: applied.tableData, saved: true };
}));

vi.mock('../../../src/service/table/table-update-commit', () => ({
  runTableUpdateCommit_ACU: mockRunTableUpdateCommit,
}));

vi.mock('../../../src/service/table/table-service', () => ({
  saveIndependentTableToChatHistory_ACU: vi.fn(),
}));

vi.mock('../../../src/service/ai/prompt-builder', () => ({
  handleApiResponse_ACU: vi.fn(),
  extractTableEditInner_ACU: mockExtractTableEditInner,
}));

vi.mock('../../../src/service/ai/api-call', () => ({
  buildCustomApiRequestBody_ACU: mockBuildCustomBody,
  getApiConfigByPreset_ACU: vi.fn(),
}));

import {
  checkAutoMergeTrigger_ACU,
  prepareAutoMergeBatches_ACU,
  executeAutoMergeBatch_ACU,
  finalizeAutoMerge_ACU,
} from '../../../src/service/summary/merge-logic';

beforeEach(() => {
  mockSettings.autoMergeEnabled = true;
  mockSettings.autoMergeThreshold = 5;
  mockSettings.autoMergeReserve = 0;
  delete mockSettings.autoMergedOrder;
  mockCurrentJsonTableData.sheet_0.name = '纪要表';
  mockCurrentJsonTableData.sheet_0.content = [
    ['row_id', '事件', '时间', '状态'],
    ['1', '勇者出发', '第1天', ''],
    ['2', '遇到恶龙', '第3天', ''],
    ['3', '击败恶龙', '第5天', ''],
    ['4', '返回城镇', '第7天', ''],
    ['5', '获得奖赏', '第8天', ''],
    ['6', '再次出发', '第10天', ''],
    ['7', '发现宝藏', '第12天', ''],
  ];
});

describe('checkAutoMergeTrigger_ACU', () => {
  it('返回 shouldTrigger 对象', () => {
    const result = checkAutoMergeTrigger_ACU();
    expect(result).toHaveProperty('shouldTrigger');
    expect(typeof result.shouldTrigger).toBe('boolean');
  });
  it('纪要行数超过阈值时触发', () => {
    // 7 行数据 > threshold 5
    const result = checkAutoMergeTrigger_ACU();
    expect(result.shouldTrigger).toBe(true);
    expect(result.mergeCount).toBe(7);
  });
  it('纪要行数不足阈值时不触发', () => {
    mockSettings.autoMergeThreshold = 20;
    const result = checkAutoMergeTrigger_ACU();
    expect(result.shouldTrigger).toBe(false);
  });
  it('自动合并未启用返回不触发', () => {
    mockSettings.autoMergeEnabled = false;
    const result = checkAutoMergeTrigger_ACU();
    expect(result.shouldTrigger).toBe(false);
  });
  it('无纪要表返回不触发', () => {
    mockCurrentJsonTableData.sheet_0.name = '背包物品表';
    const result = checkAutoMergeTrigger_ACU();
    expect(result.shouldTrigger).toBe(false);
  });
  it('reserve 影响触发阈值', () => {
    mockSettings.autoMergeThreshold = 5;
    mockSettings.autoMergeReserve = 3;
    // triggerThreshold = 5 + 3 = 8, summaryCount = 7 < 8
    const result = checkAutoMergeTrigger_ACU();
    expect(result.shouldTrigger).toBe(false);
  });
  it('autoMergedOrder 中的 row_id 不计入，普通 AM 行仍参与合并', () => {
    mockSettings.autoMergedOrder = { sheet_0: ['1', '2', '3', '4', '5', '6'] };
    mockCurrentJsonTableData.sheet_0.content[7][1] = 'AM-普通纪要';
    const result = checkAutoMergeTrigger_ACU();
    expect(result).toEqual({ shouldTrigger: false });
    mockSettings.autoMergeThreshold = 1;
    expect(checkAutoMergeTrigger_ACU()).toMatchObject({ shouldTrigger: true, mergeCount: 1, summaryCount: 1 });
  });
  it('已合并行不计入', () => {
    // 标记所有行为已合并
    for (let i = 1; i < mockCurrentJsonTableData.sheet_0.content.length; i++) {
      mockCurrentJsonTableData.sheet_0.content[i][3] = 'auto_merged';
    }
    const result = checkAutoMergeTrigger_ACU();
    expect(result.shouldTrigger).toBe(false);
  });
});

describe('prepareAutoMergeBatches_ACU', () => {
  it('返回批次准备结果', () => {
    const result = prepareAutoMergeBatches_ACU({
      startIndex: 0,
      endIndex: 7,
      targetCount: 7,
      batchSize: 3,
      promptTemplate: '合并提示词',
      isAutoMode: true,
    });
    expect(result).toHaveProperty('summaryKey');
    expect(result).toHaveProperty('batches');
    expect(Array.isArray(result.batches)).toBe(true);
  });
  it('按 batchSize 分批', () => {
    const result = prepareAutoMergeBatches_ACU({
      startIndex: 0,
      endIndex: 7,
      targetCount: 7,
      batchSize: 3,
      promptTemplate: '合并提示词',
      isAutoMode: true,
    });
    // 7 行 / batchSize 3 = 3 批（3+3+1）
    expect(result.batches.length).toBe(3);
  });
  it('每个批次有 batchIndex 和 batchRows', () => {
    const result = prepareAutoMergeBatches_ACU({
      startIndex: 0,
      endIndex: 7,
      targetCount: 7,
      batchSize: 5,
      promptTemplate: '合并提示词',
      isAutoMode: false,
    });
    expect(result.batches[0]).toHaveProperty('batchIndex');
    expect(result.batches[0]).toHaveProperty('batchRows');
    expect(result.batches[0].batchIndex).toBe(0);
  });
  it('无纪要表抛出错误', () => {
    mockCurrentJsonTableData.sheet_0.name = '背包物品表';
    expect(() => prepareAutoMergeBatches_ACU({
      startIndex: 0,
      endIndex: 7,
      targetCount: 7,
      batchSize: 3,
      promptTemplate: '',
      isAutoMode: true,
    })).toThrow('未找到纪要表');
  });
  it('startIndex/endIndex 控制范围', () => {
    const result = prepareAutoMergeBatches_ACU({
      startIndex: 2,
      endIndex: 5,
      targetCount: 3,
      batchSize: 10,
      promptTemplate: '',
      isAutoMode: true,
    });
    expect(result.batches.length).toBe(1);
    expect(result.batches[0].batchRows.length).toBe(3);
  });
});

// ═══ executeAutoMergeBatch_ACU ═══
describe('executeAutoMergeBatch_ACU', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSettings.apiMode = 'tavern';
    mockSettings.tavernProfile = 'default';
    mockSettings.apiConfig = { max_tokens: 4096, model: 'gpt-4' };
    mockSettings.charCardPrompt = [{ role: 'USER', content: '提示词', isMain: true, mainSlot: 'A' }];
    mockSettings.streamingEnabled = false;
  });

  afterEach(async () => {
    // 确保所有 pending timer 被清理，避免 Unhandled Rejection
    try { await vi.runAllTimersAsync(); } catch (_) { /* 忽略已预期的 rejection */ }
    vi.useRealTimers();
  });

  it('AI 返回有效 tableEdit 时累积合并行', async () => {
    mockExtractTableEditInner.mockReturnValue({ inner: 'insertRow(0, {"0": "合并纪要"})' });
    mockSendConnectionManager.mockResolvedValue({
      ok: true,
      result: { choices: [{ message: { content: '<tableEdit>insertRow(0, {"0": "合并纪要"})</tableEdit>' } }] },
    });

    const prepared = prepareAutoMergeBatches_ACU({
      startIndex: 0, endIndex: 3, targetCount: 3, batchSize: 3,
      promptTemplate: '$A $BASE_DATA $TARGET_COUNT', isAutoMode: true,
    });

    const promise = executeAutoMergeBatch_ACU(prepared, prepared.batches[0], []);
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(6000);
    const result = await promise;
    expect(result.accumulatedSummary).toHaveLength(1);
    expect(result.accumulatedSummary[0]).toEqual(['8', '合并纪要', '', '']);
  }, 30000);

  it('AI 返回无效内容时抛出错误', async () => {
    mockExtractTableEditInner.mockReturnValue(null);
    mockSendConnectionManager.mockResolvedValue({
      ok: true,
      result: { choices: [{ message: { content: '无效内容' } }] },
    });

    const prepared = prepareAutoMergeBatches_ACU({
      startIndex: 0, endIndex: 3, targetCount: 3, batchSize: 3,
      promptTemplate: '$A $BASE_DATA $TARGET_COUNT', isAutoMode: true,
    });

    // 先启动 promise，然后立即添加 catch 处理器防止 unhandled rejection
    let caughtError: Error | null = null;
    const promise = executeAutoMergeBatch_ACU(prepared, prepared.batches[0], [])
      .catch((e: Error) => { caughtError = e; });
    // 推进所有 timer 以完成重试循环
    await vi.runAllTimersAsync();
    await promise;
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain('均失败');
  }, 30000);
});

// ═══ finalizeAutoMerge_ACU ═══
describe('finalizeAutoMerge_ACU', () => {
  it('累积行为空时返回 mergedRows: 0', async () => {
    const result = await finalizeAutoMerge_ACU({ summaryKey: 'sheet_0', endIndex: 3 } as any, []);
    expect(result.mergedRows).toBe(0);
  });

  it('summaryKey 为空时返回 mergedRows: 0', async () => {
    const result = await finalizeAutoMerge_ACU({ summaryKey: '', endIndex: 3 } as any, [['row']]);
    expect(result.mergedRows).toBe(0);
  });

  it('有累积行时写入表格并保存', async () => {
    const { updateReadableLorebookEntry_ACU } = await import('../../../src/service/worldbook/pipeline');
    vi.mocked(updateReadableLorebookEntry_ACU).mockResolvedValue(undefined);
    mockRunTableUpdateCommit.mockClear();

    const accumulatedSummary = [
      ['8', '合并纪要1', '', ''],
      ['9', '合并纪要2', '', ''],
    ];
    const result = await finalizeAutoMerge_ACU(
      { summaryKey: 'sheet_0', endIndex: 3 } as any,
      accumulatedSummary,
    );
    expect(result.mergedRows).toBe(2);
    expect(mockRunTableUpdateCommit).toHaveBeenCalledWith(expect.objectContaining({
      source: 'merge_summary',
      targetSheetKeys: ['sheet_0'],
    }), expect.any(Function));
    expect(updateReadableLorebookEntry_ACU).toHaveBeenCalled();
    expect(mockCurrentJsonTableData.sheet_0.content.slice(1, 3)).toEqual(accumulatedSummary);
    expect(mockCurrentJsonTableData.sheet_0.content.slice(1).every((row: any[]) => row.length === 4)).toBe(true);
    expect(mockSettings.autoMergedOrder.sheet_0).toEqual(['8', '9']);
  });
});


// ═══════════════════════════════════════════════════════════════
// max_tokens ?? 回退验证
// ═══════════════════════════════════════════════════════════════
describe('executeAutoMergeBatch_ACU max_tokens 回退', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSettings.apiMode = 'tavern';
    mockSettings.tavernProfile = 'default';
    mockSettings.apiConfig = { max_tokens: 4096, model: 'gpt-4' };
    mockSettings.charCardPrompt = [{ role: 'USER', content: '提示词', isMain: true, mainSlot: 'A' }];
    mockSettings.streamingEnabled = false;
  });

  afterEach(async () => {
    try { await vi.runAllTimersAsync(); } catch (_) { /* ignore */ }
    vi.useRealTimers();
  });

  it('tavern 分支 max_tokens=0 不被 4096 覆盖', async () => {
    mockSettings.apiConfig.max_tokens = 0;
    mockExtractTableEditInner.mockReturnValue({ inner: 'insertRow(0, {"0": "test"})' });
    mockSendConnectionManager.mockResolvedValue({
      ok: true,
      result: { choices: [{ message: { content: '<tableEdit>insertRow(0, {"0": "test"})</tableEdit>' } }] },
    });

    const prepared = prepareAutoMergeBatches_ACU({
      startIndex: 0, endIndex: 3, targetCount: 3, batchSize: 3,
      promptTemplate: '$A $BASE_DATA $TARGET_COUNT', isAutoMode: true,
    });

    const promise = executeAutoMergeBatch_ACU(prepared, prepared.batches[0], []);
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(6000);
    await promise;

    expect(mockSendConnectionManager).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      0
    );
  });

  it('custom 分支 overrides 不含 temperature/topP/maxTokens', async () => {
    mockSettings.apiMode = 'custom';
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', max_tokens: 0 };
    mockSettings.streamingEnabled = false;
    mockBuildCustomBody.mockReturnValue({ messages: [], model: 'gpt-4', max_tokens: 0, temperature: 1.0, top_p: 0.95, stream: false });

    const { handleApiResponse_ACU, extractTableEditInner_ACU } = await import('../../../src/service/ai/prompt-builder');
    vi.mocked(handleApiResponse_ACU).mockResolvedValue('<tableEdit>insertRow(0, {"0": "test"})</tableEdit>');
    vi.mocked(extractTableEditInner_ACU).mockReturnValue({ inner: 'insertRow(0, {"0": "test"})' });

    const mockFetchLocal = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetchLocal);

    const prepared = prepareAutoMergeBatches_ACU({
      startIndex: 0, endIndex: 3, targetCount: 3, batchSize: 3,
      promptTemplate: '$A $BASE_DATA $TARGET_COUNT', isAutoMode: true,
    });

    const promise = executeAutoMergeBatch_ACU(prepared, prepared.batches[0], []);
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(6000);
    await promise;

    expect(mockBuildCustomBody).toHaveBeenCalled();
    const overrides = mockBuildCustomBody.mock.calls[mockBuildCustomBody.mock.calls.length - 1][2];
    expect(overrides).not.toHaveProperty('temperature');
    expect(overrides).not.toHaveProperty('topP');
    expect(overrides).not.toHaveProperty('maxTokens');
    expect(overrides.stripModelPrefix).toBe(false);
  });

});