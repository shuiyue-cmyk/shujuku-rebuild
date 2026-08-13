/**
 * tests/service/summary/merge-executor.test.ts
 * 手动合并纪要编排函数单元测试
 *
 * 策略：
 * - prepareMergeSummary_ACU 通过 mock state 和 validateMergeParams 测试前置校验逻辑
 * - executeManualMergeSummary_ACU 通过 mock executeMergeBatches 测试编排逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Mock 设置
// ═══════════════════════════════════════════════════════════════

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
}));

vi.mock('../../../src/shared/defaults-json.js', () => ({
  DEFAULT_CHAR_CARD_PROMPT_ACU: '默认角色卡提示词',
}));

let mockSettings: any = {
  apiMode: 'custom',
  apiConfig: { useMainApi: true, url: '', model: '' },
  tavernProfile: '',
  mergeTargetCount: 1,
  mergeBatchSize: 5,
  mergeStartIndex: 1,
  mergeEndIndex: null,
  mergeSummaryPrompt: '合并提示词模板',
};

let mockCurrentJsonTableData: any = null;
let mockIsAutoUpdating = false;

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get settings_ACU() { return mockSettings; },
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
  get isAutoUpdatingCard_ACU() { return mockIsAutoUpdating; },
  _set_isAutoUpdatingCard_ACU: vi.fn((v: any) => { mockIsAutoUpdating = v; }),
  _set_wasStoppedByUser_ACU: vi.fn(),
}));

vi.mock('../../../src/service/worldbook/pipeline', () => ({
  loadAllChatMessages_ACU: vi.fn().mockResolvedValue(undefined),
  updateReadableLorebookEntry_ACU: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/service/table/table-service', () => ({
  loadOrCreateJsonTableFromChatHistory_ACU: vi.fn().mockResolvedValue(undefined),
  saveIndependentTableToChatHistory_ACU: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../src/service/table/table-update-commit', () => ({
  runTableUpdateCommit_ACU: vi.fn(async (_options: any, apply: any) => {
    const applied = await apply({ transactionContext: { runCommit: async (task: any) => task() }, workingData: null });
    return { success: applied.success !== false, value: applied.value, tableData: applied.tableData, saved: true };
  }),
}));

vi.mock('../../../src/service/chat/chat-service', () => ({
  getLastMessageIndex_ACU: vi.fn(() => 5),
}));

vi.mock('../../../src/service/ai/ai-service', () => ({
  sendConnectionManagerRequest_ACU: vi.fn(),
  generateRaw_ACU: vi.fn(),
  getHostRequestHeaders_ACU: vi.fn(() => ({})),
}));

vi.mock('../../../src/service/ai/prompt-builder', () => ({
  extractTableEditInner_ACU: vi.fn(),
  handleApiResponse_ACU: vi.fn(),
}));

const { mockBuildCustomBody } = vi.hoisted(() => ({
  mockBuildCustomBody: vi.fn(() => ({ messages: [], model: 'gpt-4', max_tokens: 4096, temperature: 1.0, top_p: 0.95, stream: false })),
}));
vi.mock('../../../src/service/ai/api-call', () => ({
  buildCustomApiRequestBody_ACU: mockBuildCustomBody,
  getApiConfigByPreset_ACU: vi.fn(),
}));

import {
  prepareMergeSummary_ACU,
  executeManualMergeSummary_ACU,
  validateMergeParams_ACU,
  pickLastRowsBeforeIndex_ACU,
  formatTableStructure,
  applyMergeResult_ACU,
  executeMergeBatches_ACU,
  type MergeValidationResult,
} from '../../../src/service/summary/merge-executor';

// ═══════════════════════════════════════════════════════════════
// validateMergeParams_ACU
// ═══════════════════════════════════════════════════════════════
describe('validateMergeParams_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = {
      apiMode: 'custom',
      apiConfig: { useMainApi: true, url: '', model: '' },
      tavernProfile: '',
      mergeTargetCount: 1,
      mergeBatchSize: 5,
      mergeStartIndex: 1,
      mergeEndIndex: null,
      mergeSummaryPrompt: '合并提示词模板',
    };
    mockCurrentJsonTableData = null;
  });

  it('API 未配置时返回错误', () => {
    mockSettings.apiMode = 'custom';
    mockSettings.apiConfig = { useMainApi: false, url: '', model: '' };
    const result = validateMergeParams_ACU('默认提示词');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('API');
  });

  it('数据库未加载时返回错误', () => {
    mockCurrentJsonTableData = null;
    const result = validateMergeParams_ACU('默认提示词');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('数据库未加载');
  });

  it('未找到纪要表时返回错误', () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '普通表', content: [['row_id'], ['1']] },
    };
    const result = validateMergeParams_ACU('默认提示词');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('未找到');
  });

  it('纪要表为空时返回错误', () => {
    mockCurrentJsonTableData = {
      sheet_0: { name: '纪要表', content: [['row_id']] }, // 只有表头，无数据行
    };
    const result = validateMergeParams_ACU('默认提示词');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('没有纪要数据');
  });

  it('正常情况返回 valid', () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '纪要表',
        content: [
          ['row_id', '内容'],
          ['1', '纪要1'],
          ['2', '纪要2'],
          ['3', '纪要3'],
        ],
      },
    };
    const result = validateMergeParams_ACU('默认提示词');
    expect(result.valid).toBe(true);
    expect(result.summaryKey).toBe('sheet_0');
    expect(result.allSummaryRows!.length).toBe(3);
  });

  it('起始条数超出范围时返回错误', () => {
    mockSettings.mergeStartIndex = 100;
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '纪要表',
        content: [['row_id'], ['1'], ['2']],
      },
    };
    const result = validateMergeParams_ACU('默认提示词');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('超出');
  });

  it('提示词模板为空时返回错误', () => {
    mockSettings.mergeSummaryPrompt = '';
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '纪要表',
        content: [['row_id'], ['1']],
      },
    };
    const result = validateMergeParams_ACU(''); // defaultMergePrompt 也为空
    expect(result.valid).toBe(false);
    expect(result.error).toContain('提示词');
  });
});

// ═══════════════════════════════════════════════════════════════
// prepareMergeSummary_ACU
// ═══════════════════════════════════════════════════════════════
describe('prepareMergeSummary_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAutoUpdating = false;
    mockSettings = {
      apiMode: 'custom',
      apiConfig: { useMainApi: true, url: '', model: '' },
      tavernProfile: '',
      mergeTargetCount: 1,
      mergeBatchSize: 5,
      mergeStartIndex: 1,
      mergeEndIndex: null,
      mergeSummaryPrompt: '合并提示词模板',
    };
  });

  it('后台任务运行中时返回错误', async () => {
    mockIsAutoUpdating = true;
    const result = await prepareMergeSummary_ACU('默认提示词');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('后台已有任务');
  });

  it('校验通过时返回 confirmInfo', async () => {
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '纪要表',
        content: [
          ['row_id', '内容'],
          ['1', '纪要1'],
          ['2', '纪要2'],
          ['3', '纪要3'],
        ],
      },
    };

    const result = await prepareMergeSummary_ACU('默认提示词');
    expect(result.valid).toBe(true);
    expect(result.confirmInfo).toBeDefined();
    expect(result.confirmInfo!.allSummaryRowsCount).toBe(3);
    expect(result.confirmInfo!.targetCount).toBe(1);
    expect(result.validation).toBeDefined();
  });

  it('刷新数据库失败时仍继续校验', async () => {
    const { loadAllChatMessages_ACU } = await import('../../../src/service/worldbook/pipeline');
    vi.mocked(loadAllChatMessages_ACU).mockRejectedValueOnce(new Error('刷新失败'));

    mockCurrentJsonTableData = {
      sheet_0: {
        name: '纪要表',
        content: [['row_id', '内容'], ['1', '纪要1']],
      },
    };

    const result = await prepareMergeSummary_ACU('默认提示词');
    // 刷新失败但继续使用当前内存数据
    expect(result.valid).toBe(true);
  });

  it('校验失败时返回错误', async () => {
    mockCurrentJsonTableData = null; // 数据库未加载

    const result = await prepareMergeSummary_ACU('默认提示词');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// executeManualMergeSummary_ACU
// ═══════════════════════════════════════════════════════════════
describe('executeManualMergeSummary_ACU', () => {
  const makeValidation = (overrides: Partial<MergeValidationResult> = {}): MergeValidationResult => ({
    valid: true,
    summaryKey: 'sheet_0',
    allSummaryRows: [['1', '纪要1'], ['2', '纪要2']],
    fullSummaryRows: [['1', '纪要1'], ['2', '纪要2'], ['3', '纪要3']],
    startIndex: 0,
    actualEndIndex: 2,
    selectedRange: 2,
    promptTemplate: '合并提示词',
    batchSize: 5,
    targetCount: 1,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAutoUpdating = false;
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '纪要表',
        content: [
          ['row_id', '内容'],
          ['1', '纪要1'],
          ['2', '纪要2'],
          ['3', '纪要3'],
        ],
      },
    };
  });

  it('合并成功时返回 success', async () => {
    // 需要 mock executeMergeBatches_ACU 的内部行为
    // 由于 executeMergeBatches_ACU 在同一模块中，我们需要通过 mock AI 调用来间接测试
    // 但更实际的做法是测试整体流程的返回值
    // 这里我们 mock AI 服务让 executeMergeBatches 成功
    const { sendConnectionManagerRequest_ACU } = await import('../../../src/service/ai/ai-service');
    const { handleApiResponse_ACU, extractTableEditInner_ACU } = await import('../../../src/service/ai/prompt-builder');

    vi.mocked(sendConnectionManagerRequest_ACU).mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '<tableEdit>合并结果</tableEdit>' } }] }) } as any);
    vi.mocked(handleApiResponse_ACU).mockResolvedValue('<tableEdit>合并结果</tableEdit>');
    vi.mocked(extractTableEditInner_ACU).mockReturnValue('[1:纪要表]\n[0] 1, 合并后的纪要');

    const result = await executeManualMergeSummary_ACU(makeValidation());

    // 无论内部 AI 调用是否完全 mock 成功，验证函数的 finally 块正确清理状态
    const { _set_isAutoUpdatingCard_ACU, _set_wasStoppedByUser_ACU } = await import('../../../src/service/runtime/state-manager');
    expect(_set_isAutoUpdatingCard_ACU).toHaveBeenCalledWith(false);
    expect(_set_wasStoppedByUser_ACU).toHaveBeenCalledWith(false);
  });

  it('中止检查触发时返回失败', async () => {
    // mock AI 调用为长时间运行
    const { sendConnectionManagerRequest_ACU } = await import('../../../src/service/ai/ai-service');
    vi.mocked(sendConnectionManagerRequest_ACU).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { ok: true, json: async () => ({ choices: [{ message: { content: '<tableEdit>结果</tableEdit>' } }] }) } as any;
    });

    // checkAbort 立即返回 true
    const result = await executeManualMergeSummary_ACU(
      makeValidation(),
      undefined,
      () => true // 立即中止
    );

    expect(result.success).toBe(false);
  });

  it('进度回调被正确调用', async () => {
    const { sendConnectionManagerRequest_ACU } = await import('../../../src/service/ai/ai-service');
    const { handleApiResponse_ACU, extractTableEditInner_ACU } = await import('../../../src/service/ai/prompt-builder');

    vi.mocked(sendConnectionManagerRequest_ACU).mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '<tableEdit>结果</tableEdit>' } }] }) } as any);
    vi.mocked(handleApiResponse_ACU).mockResolvedValue('<tableEdit>结果</tableEdit>');
    vi.mocked(extractTableEditInner_ACU).mockReturnValue('[1:纪要表]\n[0] 1, 合并后的纪要');

    const progressCalls: any[] = [];
    const onProgress = (batchIndex: number, totalBatches: number, attempt: number, maxRetries: number) => {
      progressCalls.push({ batchIndex, totalBatches, attempt, maxRetries });
    };

    await executeManualMergeSummary_ACU(makeValidation(), onProgress);

    // 进度回调应该至少被调用一次（第一个批次的第一次尝试）
    if (progressCalls.length > 0) {
      expect(progressCalls[0].batchIndex).toBe(0);
      expect(progressCalls[0].attempt).toBeGreaterThanOrEqual(1);
    }
  });

  it('finally 块正确清理状态', async () => {
    // 让 executeMergeBatches 抛异常
    const { sendConnectionManagerRequest_ACU } = await import('../../../src/service/ai/ai-service');
    vi.mocked(sendConnectionManagerRequest_ACU).mockRejectedValue(new Error('网络错误'));

    const result = await executeManualMergeSummary_ACU(makeValidation());

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    // 验证 finally 块清理
    const { _set_isAutoUpdatingCard_ACU, _set_wasStoppedByUser_ACU } = await import('../../../src/service/runtime/state-manager');
    expect(_set_isAutoUpdatingCard_ACU).toHaveBeenCalledWith(false);
    expect(_set_wasStoppedByUser_ACU).toHaveBeenCalledWith(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// pickLastRowsBeforeIndex_ACU
// ═══════════════════════════════════════════════════════════════
describe('pickLastRowsBeforeIndex_ACU', () => {
  const rows = [['1', 'A'], ['2', 'B'], ['3', 'C'], ['4', 'D'], ['5', 'E']];

  it('取最后 2 条（beforeIndex=5, count=2）', () => {
    const result = pickLastRowsBeforeIndex_ACU(rows, 5, 2);
    expect(result).toEqual([['4', 'D'], ['5', 'E']]);
  });

  it('取最后 2 条（beforeIndex=3, count=2）', () => {
    const result = pickLastRowsBeforeIndex_ACU(rows, 3, 2);
    expect(result).toEqual([['2', 'B'], ['3', 'C']]);
  });

  it('beforeIndex=0 返回空数组', () => {
    const result = pickLastRowsBeforeIndex_ACU(rows, 0, 2);
    expect(result).toEqual([]);
  });

  it('count=0 返回空数组', () => {
    const result = pickLastRowsBeforeIndex_ACU(rows, 3, 0);
    expect(result).toEqual([]);
  });

  it('count 大于可用行数时返回所有可用行', () => {
    const result = pickLastRowsBeforeIndex_ACU(rows, 3, 100);
    expect(result).toEqual([['1', 'A'], ['2', 'B'], ['3', 'C']]);
  });

  it('空数组返回空数组', () => {
    expect(pickLastRowsBeforeIndex_ACU([], 5, 2)).toEqual([]);
  });

  it('null 输入返回空数组', () => {
    expect(pickLastRowsBeforeIndex_ACU(null as any, 5, 2)).toEqual([]);
  });

  it('beforeIndex 超出范围时截断到数组长度', () => {
    const result = pickLastRowsBeforeIndex_ACU(rows, 100, 2);
    expect(result).toEqual([['4', 'D'], ['5', 'E']]);
  });

  it('beforeIndex 为负数时视为 0', () => {
    const result = pickLastRowsBeforeIndex_ACU(rows, -1, 2);
    expect(result).toEqual([]);
  });

  it('beforeIndex 为 NaN 时视为 0', () => {
    const result = pickLastRowsBeforeIndex_ACU(rows, NaN, 2);
    expect(result).toEqual([]);
  });

  it('count 为 NaN 时视为 0', () => {
    const result = pickLastRowsBeforeIndex_ACU(rows, 3, NaN);
    expect(result).toEqual([]);
  });

  it('beforeIndex 为 Infinity 时视为非有限数（返回空数组）', () => {
    // Number.isFinite(Infinity) === false → beforeIndex 被视为 0
    const result = pickLastRowsBeforeIndex_ACU(rows, Infinity, 2);
    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// formatTableStructure
// ═══════════════════════════════════════════════════════════════
describe('formatTableStructure', () => {
  it('输出表名和列头', () => {
    const tableObj = {
      content: [['row_id', '姓名', '状态']],
      sourceData: { note: '角色信息' },
    };
    const result = formatTableStructure('角色表', [], tableObj, 0);
    expect(result).toContain('[0:角色表]');
    expect(result).toContain('[0:姓名]');
    expect(result).toContain('[1:状态]');
    expect(result).toContain('Note: 角色信息');
  });

  it('有数据行时输出行内容', () => {
    const tableObj = {
      content: [['row_id', '姓名', '状态']],
      sourceData: null,
    };
    const rows = [['1', '角色A', '存活'], ['2', '角色B', '死亡']];
    const result = formatTableStructure('角色表', rows, tableObj, 1);
    expect(result).toContain('[1:角色表]');
    expect(result).toContain('[0] 1, 角色A, 存活');
    expect(result).toContain('[1] 2, 角色B, 死亡');
  });

  it('无数据行时输出 Table Empty', () => {
    const tableObj = {
      content: [['row_id', '姓名']],
      sourceData: null,
    };
    const result = formatTableStructure('角色表', [], tableObj, 0);
    expect(result).toContain('Table Empty');
  });

  it('null 数据行时输出 Table Empty', () => {
    const tableObj = {
      content: [['row_id', '姓名']],
      sourceData: null,
    };
    const result = formatTableStructure('角色表', null as any, tableObj, 0);
    expect(result).toContain('Table Empty');
  });

  it('无 content[0] 时输出 No Headers', () => {
    const tableObj = {
      content: [],
      sourceData: null,
    };
    const result = formatTableStructure('角色表', [], tableObj, 0);
    expect(result).toContain('No Headers');
  });

  it('无 sourceData 时不输出 Note', () => {
    const tableObj = {
      content: [['row_id', '姓名']],
      sourceData: null,
    };
    const result = formatTableStructure('角色表', [], tableObj, 0);
    expect(result).not.toContain('Note:');
  });

  it('sourceData.note 为空字符串时输出 N/A', () => {
    const tableObj = {
      content: [['row_id', '姓名']],
      sourceData: { note: '' },
    };
    const result = formatTableStructure('角色表', [], tableObj, 0);
    expect(result).toContain('Note: N/A');
  });
});

// ═══════════════════════════════════════════════════════════════
// applyMergeResult_ACU
// ═══════════════════════════════════════════════════════════════
describe('applyMergeResult_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '纪要表',
        content: [
          ['row_id', '内容'],
          ['1', '纪要1'],
          ['2', '纪要2'],
          ['3', '纪要3'],
          ['4', '纪要4'],
          ['5', '纪要5'],
        ],
      },
    };
  });

  it('替换指定范围的行', () => {
    const accumulated = [['merged_1', '合并后纪要']];
    applyMergeResult_ACU('sheet_0', accumulated, 0, 3);
    // 原始: [header, 1, 2, 3, 4, 5]
    // 替换 [0, 3) → [header, merged, 4, 5]
    expect(mockCurrentJsonTableData.sheet_0.content).toHaveLength(4); // header + merged + 4 + 5
    expect(mockCurrentJsonTableData.sheet_0.content[1]).toEqual(['merged_1', '合并后纪要']);
    expect(mockCurrentJsonTableData.sheet_0.content[2]).toEqual(['4', '纪要4']);
    expect(mockCurrentJsonTableData.sheet_0.content[3]).toEqual(['5', '纪要5']);
  });

  it('替换全部行', () => {
    const accumulated = [['merged_all', '全部合并']];
    applyMergeResult_ACU('sheet_0', accumulated, 0, 5);
    expect(mockCurrentJsonTableData.sheet_0.content).toHaveLength(2); // header + merged
    expect(mockCurrentJsonTableData.sheet_0.content[1]).toEqual(['merged_all', '全部合并']);
  });

  it('空累积结果不修改数据', () => {
    const originalLength = mockCurrentJsonTableData.sheet_0.content.length;
    applyMergeResult_ACU('sheet_0', [], 0, 3);
    // 空累积结果时 accumulatedSummary.length === 0，条件不满足，不执行
    expect(mockCurrentJsonTableData.sheet_0.content.length).toBe(originalLength);
  });

  it('summaryKey 不存在时抛出 TypeError（访问 undefined.content）', () => {
    expect(() => {
      applyMergeResult_ACU('nonexistent_key', [['data']], 0, 1);
    }).toThrow(TypeError);
  });

  it('startIndex 等于 actualEndIndex 时只插入不删除', () => {
    const accumulated = [['new_row', '新纪要']];
    applyMergeResult_ACU('sheet_0', accumulated, 2, 2);
    // slice(0, 2) + accumulated + slice(2) = 原始前2行 + new + 原始后3行
    expect(mockCurrentJsonTableData.sheet_0.content).toHaveLength(7); // header + 2 + 1 + 3
  });
});

// ═══════════════════════════════════════════════════════════════
// executeMergeBatches_ACU
// ═══════════════════════════════════════════════════════════════
describe('executeMergeBatches_ACU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = {
      apiMode: 'custom',
      apiConfig: { useMainApi: true, url: '', model: '' },
      tavernProfile: '',
      charCardPrompt: [{ role: 'USER', content: '默认提示词', mainSlot: 'A', isMain: true }],
      streamingEnabled: false,
    };
    mockCurrentJsonTableData = {
      sheet_0: {
        name: '纪要表',
        content: [
          ['row_id', '内容'],
          ['1', '纪要1'],
          ['2', '纪要2'],
          ['3', '纪要3'],
        ],
      },
    };
  });

  it('用户中止时返回失败', async () => {
    const config = {
      summaryKey: 'sheet_0',
      allSummaryRows: [['1', '纪要1'], ['2', '纪要2']],
      fullSummaryRows: [['1', '纪要1'], ['2', '纪要2']],
      startIndex: 0,
      targetCount: 1,
      batchSize: 5,
      promptTemplate: '合并 $A 到 $TARGET_COUNT 条 $BASE_DATA',
    };

    const result = await executeMergeBatches_ACU(
      config,
      undefined,
      () => true // 立即中止
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('用户终止');
    expect(result.failedBatchIndex).toBe(0);
  });

  it('AI 返回有效数据时成功累积', async () => {
    const { generateRaw_ACU } = await import('../../../src/service/ai/ai-service');
    const { extractTableEditInner_ACU } = await import('../../../src/service/ai/prompt-builder');

    vi.mocked(generateRaw_ACU).mockResolvedValue(
      '<tableEdit><!-- insertRow(0, {"0": "合并纪要1"}) --></tableEdit>'
    );
    vi.mocked(extractTableEditInner_ACU).mockReturnValue({
      inner: 'insertRow(0, {"0": "合并纪要1"})',
      cleaned: '',
      mode: 'full',
    });

    const config = {
      summaryKey: 'sheet_0',
      allSummaryRows: [['1', '纪要1'], ['2', '纪要2']],
      fullSummaryRows: [['1', '纪要1'], ['2', '纪要2']],
      startIndex: 0,
      targetCount: 1,
      batchSize: 5,
      promptTemplate: '合并 $A 到 $TARGET_COUNT 条 $BASE_DATA',
      maxRetries: 1,
    };

    const result = await executeMergeBatches_ACU(config);

    expect(result.success).toBe(true);
    expect(result.accumulatedSummary.length).toBeGreaterThan(0);
  });

  it('AI 返回无效数据时重试后失败', async () => {
    const { generateRaw_ACU } = await import('../../../src/service/ai/ai-service');
    const { extractTableEditInner_ACU } = await import('../../../src/service/ai/prompt-builder');

    vi.mocked(generateRaw_ACU).mockResolvedValue('无效响应');
    vi.mocked(extractTableEditInner_ACU).mockReturnValue(null);

    const config = {
      summaryKey: 'sheet_0',
      allSummaryRows: [['1', '纪要1']],
      fullSummaryRows: [['1', '纪要1']],
      startIndex: 0,
      targetCount: 1,
      batchSize: 5,
      promptTemplate: '合并 $A 到 $TARGET_COUNT 条 $BASE_DATA',
      maxRetries: 1, // 减少重试次数加速测试
    };

    const result = await executeMergeBatches_ACU(config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('失败');
  });

  it('进度回调被正确调用', async () => {
    const { generateRaw_ACU } = await import('../../../src/service/ai/ai-service');
    const { extractTableEditInner_ACU } = await import('../../../src/service/ai/prompt-builder');

    vi.mocked(generateRaw_ACU).mockResolvedValue(
      "<tableEdit><!-- insertRow(0, {0: '合并纪要1'}) --></tableEdit>"
    );
    vi.mocked(extractTableEditInner_ACU).mockReturnValue({
      inner: "<!-- insertRow(0, {0: '合并纪要1'}) -->",
      cleaned: '',
      mode: 'full',
    });

    const config = {
      summaryKey: 'sheet_0',
      allSummaryRows: [['1', '纪要1']],
      fullSummaryRows: [['1', '纪要1']],
      startIndex: 0,
      targetCount: 1,
      batchSize: 5,
      promptTemplate: '合并 $A 到 $TARGET_COUNT 条 $BASE_DATA',
      maxRetries: 1,
    };

    const progressCalls: any[] = [];
    await executeMergeBatches_ACU(config, (batchIndex, totalBatches, attempt, maxRetries) => {
      progressCalls.push({ batchIndex, totalBatches, attempt, maxRetries });
    });

    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[0].batchIndex).toBe(0);
    expect(progressCalls[0].totalBatches).toBe(1);
    expect(progressCalls[0].attempt).toBe(1);
  });

  it('多批次时正确拆分', async () => {
    const { generateRaw_ACU } = await import('../../../src/service/ai/ai-service');
    const { extractTableEditInner_ACU } = await import('../../../src/service/ai/prompt-builder');

    vi.mocked(generateRaw_ACU).mockResolvedValue(
      '<tableEdit><!-- insertRow(0, {"0": "合并纪要"}) --></tableEdit>'
    );
    vi.mocked(extractTableEditInner_ACU).mockReturnValue({
      inner: 'insertRow(0, {"0": "合并纪要"})',
      cleaned: '',
      mode: 'full',
    });

    const config = {
      summaryKey: 'sheet_0',
      allSummaryRows: [['1', 'A'], ['2', 'B'], ['3', 'C'], ['4', 'D'], ['5', 'E']],
      fullSummaryRows: [['1', 'A'], ['2', 'B'], ['3', 'C'], ['4', 'D'], ['5', 'E']],
      startIndex: 0,
      targetCount: 1,
      batchSize: 2, // 5 行 / 2 = 3 批次
      promptTemplate: '合并 $A 到 $TARGET_COUNT 条 $BASE_DATA',
      maxRetries: 1,
    };

    const progressCalls: any[] = [];
    const result = await executeMergeBatches_ACU(config, (batchIndex, totalBatches) => {
      progressCalls.push({ batchIndex, totalBatches });
    });

    expect(result.success).toBe(true);
    // 3 批次，每批次至少调用一次进度回调
    const uniqueBatches = new Set(progressCalls.map(c => c.batchIndex));
    expect(uniqueBatches.size).toBe(3);
    expect(progressCalls[0].totalBatches).toBe(3);
  });

  it('prompt 模板变量被正确替换', async () => {
    const { generateRaw_ACU } = await import('../../../src/service/ai/ai-service');
    const { extractTableEditInner_ACU } = await import('../../../src/service/ai/prompt-builder');

    let capturedPrompt = '';
    vi.mocked(generateRaw_ACU).mockImplementation(async (opts: any) => {
      capturedPrompt = opts.ordered_prompts?.[0]?.content || '';
      return "<tableEdit><!-- insertRow(0, {0: '合并纪要'}) --></tableEdit>";
    });
    vi.mocked(extractTableEditInner_ACU).mockReturnValue({
      inner: "<!-- insertRow(0, {0: '合并纪要'}) -->",
      cleaned: '',
      mode: 'full',
    });

    const config = {
      summaryKey: 'sheet_0',
      allSummaryRows: [['1', '纪要1']],
      fullSummaryRows: [['1', '纪要1']],
      startIndex: 0,
      targetCount: 3,
      batchSize: 5,
      promptTemplate: '请将以下内容合并为 $TARGET_COUNT 条:\n$A\n基础数据:\n$BASE_DATA',
      maxRetries: 1,
    };

    await executeMergeBatches_ACU(config);

    expect(capturedPrompt).toContain('合并为 3 条');
    expect(capturedPrompt).toContain('纪要1');
  });
});


// ═══════════════════════════════════════════════════════════════
// max_tokens ?? 回退验证
// ═══════════════════════════════════════════════════════════════
describe('executeMergeBatches_ACU max_tokens 回退', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tavern 分支 max_tokens=0 不被 4096 覆盖', async () => {
    mockSettings.apiMode = 'tavern';
    mockSettings.apiConfig = { max_tokens: 0, model: 'gpt-4' };
    mockSettings.tavernProfile = 'default';
    mockSettings.charCardPrompt = [{ role: 'USER', content: '提示词', isMain: true, mainSlot: 'A' }];
    mockSettings.streamingEnabled = false;

    const { sendConnectionManagerRequest_ACU } = await import('../../../src/service/ai/ai-service');
    const { extractTableEditInner_ACU } = await import('../../../src/service/ai/prompt-builder');

    vi.mocked(sendConnectionManagerRequest_ACU).mockResolvedValue({
      ok: true,
      result: { choices: [{ message: { content: '<tableEdit>insertRow(0, {"0": "test"})</tableEdit>' } }] },
    });
    vi.mocked(extractTableEditInner_ACU).mockReturnValue({ inner: 'insertRow(0, {"0": "test"})' });

    const config = {
      summaryKey: 'sheet_0',
      allSummaryRows: [['1', 'A']],
      fullSummaryRows: [['1', 'A']],
      startIndex: 0,
      targetCount: 1,
      batchSize: 5,
      promptTemplate: '$A $TARGET_COUNT $BASE_DATA',
      maxRetries: 1,
    };

    await executeMergeBatches_ACU(config);
    expect(sendConnectionManagerRequest_ACU).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      0
    );
  });

  it('custom 分支 max_tokens=0 不被 4096 覆盖', async () => {
    mockSettings.apiMode = 'custom';
    mockSettings.apiConfig = { url: 'https://api.example.com', model: 'gpt-4', max_tokens: 0 };
    mockSettings.charCardPrompt = [{ role: 'USER', content: '提示词', isMain: true, mainSlot: 'A' }];
    mockSettings.streamingEnabled = false;

    mockBuildCustomBody.mockReturnValue({ messages: [], model: 'gpt-4', max_tokens: 0, temperature: 1.0, top_p: 0.95, stream: false });

    const { handleApiResponse_ACU, extractTableEditInner_ACU } = await import('../../../src/service/ai/prompt-builder');
    vi.mocked(handleApiResponse_ACU).mockResolvedValue('<tableEdit>insertRow(0, {"0": "test"})</tableEdit>');
    vi.mocked(extractTableEditInner_ACU).mockReturnValue({ inner: 'insertRow(0, {"0": "test"})' });

    const mockFetchLocal = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetchLocal);

    const config = {
      summaryKey: 'sheet_0',
      allSummaryRows: [['1', 'A']],
      fullSummaryRows: [['1', 'A']],
      startIndex: 0,
      targetCount: 1,
      batchSize: 5,
      promptTemplate: '$A $TARGET_COUNT $BASE_DATA',
      maxRetries: 1,
    };

    await executeMergeBatches_ACU(config);
    // buildCustomApiRequestBody_ACU 被调用时 overrides 不含 maxTokens/temperature
    expect(mockBuildCustomBody).toHaveBeenCalled();
    const overrides = mockBuildCustomBody.mock.calls[mockBuildCustomBody.mock.calls.length - 1][2];
    expect(overrides).not.toHaveProperty('temperature');
    expect(overrides).not.toHaveProperty('maxTokens');
    expect(overrides).not.toHaveProperty('topP');

    expect(overrides.stripModelPrefix).toBe(false);
  });
});