/**
 * tests/integration/merge-summary.test.ts
 * I4 集成测试：合并纪要完整流程
 * 验证 validateParams → executeBatches → applyResult 的完整链路
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings, mockCurrentJsonTableDataRef } = vi.hoisted(() => ({
  mockSettings: {
    apiMode: 'tavern',
    tavernProfile: 'default',
    apiConfig: { max_tokens: 4096, model: 'gpt-4', useMainApi: false, url: '', apiKey: '' },
    charCardPrompt: [{ role: 'USER', content: '合并纪要', isMain: true, mainSlot: 'A' }],
    streamingEnabled: false,
    autoMergeEnabled: true,
    mergeTargetCount: 2,
    mergeBatchSize: 5,
    mergeStartIndex: 1,
    mergeEndIndex: null,
    mergeSummaryPrompt: '将以下纪要合并为 $TARGET_COUNT 条：\n$A\n基础数据：\n$BASE_DATA',
    autoMergeTriggerThreshold: 5,
    autoMergeReserveCount: 2,
  } as any,
  mockCurrentJsonTableDataRef: { value: null as any },
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableDataRef.value; },
  settings_ACU: mockSettings,
  isAutoUpdatingCard_ACU: false,
  _set_isAutoUpdatingCard_ACU: vi.fn(),
  _set_wasStoppedByUser_ACU: vi.fn(),
}));

vi.mock('../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../src/shared/defaults-json.js', () => ({
  DEFAULT_CHAR_CARD_PROMPT_ACU: { role: 'USER', content: '默认提示词' },
}));

vi.mock('../../src/service/ai/ai-service', () => ({
  sendConnectionManagerRequest_ACU: vi.fn(),
  generateRaw_ACU: vi.fn(),
  getHostRequestHeaders_ACU: vi.fn(() => ({})),
}));

vi.mock('../../src/service/ai/prompt-builder', () => ({
  extractTableEditInner_ACU: vi.fn(),
  handleApiResponse_ACU: vi.fn(),
}));

vi.mock('../../src/service/worldbook/pipeline', () => ({
  loadAllChatMessages_ACU: vi.fn().mockResolvedValue(undefined),
  updateReadableLorebookEntry_ACU: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/service/table/table-service', () => ({
  loadOrCreateJsonTableFromChatHistory_ACU: vi.fn().mockResolvedValue({ loaded: true }),
  saveIndependentTableToChatHistory_ACU: vi.fn().mockResolvedValue({ saved: true }),
}));

vi.mock('../../src/service/chat/chat-service', () => ({
  getLastMessageIndex_ACU: vi.fn(() => 5),
}));

import {
  validateMergeParams_ACU,
  applyMergeResult_ACU,
  executeMergeBatches_ACU,
  pickLastRowsBeforeIndex_ACU,
  formatTableStructure,
} from '../../src/service/summary/merge-executor';

import { sendConnectionManagerRequest_ACU } from '../../src/service/ai/ai-service';
import { extractTableEditInner_ACU } from '../../src/service/ai/prompt-builder';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.apiMode = 'tavern';
  mockSettings.tavernProfile = 'default';
  mockSettings.apiConfig = { max_tokens: 4096, model: 'gpt-4', useMainApi: false, url: '', apiKey: '' };
  mockCurrentJsonTableDataRef.value = {
    sheet_0: { name: '背包物品表', content: [['row_id', '物品名'], ['1', '铁剑']] },
    sheet_1: {
      name: '纪要表',
      content: [
        ['row_id', '事件'],
        ['1', '冈部遇到了红莉栖'],
        ['2', '发现了时间机器'],
        ['3', '进行了D-Mail实验'],
        ['4', '世界线变动'],
        ['5', '到达命运石之门'],
      ],
      sourceData: { note: '纪要' },
    },
  };
});

describe('I4: 合并纪要完整流程', () => {
  describe('validateMergeParams_ACU — 参数校验', () => {
    it('API 未配置时返回 valid=false', () => {
      mockSettings.apiMode = 'custom';
      mockSettings.apiConfig = { useMainApi: false, url: '', model: '' };
      const result = validateMergeParams_ACU('默认提示词');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('API');
    });

    it('数据库未加载时返回 valid=false', () => {
      mockCurrentJsonTableDataRef.value = null;
      const result = validateMergeParams_ACU('默认提示词');
      expect(result.valid).toBe(false);
    });

    it('无纪要表时返回 valid=false', () => {
      mockCurrentJsonTableDataRef.value = {
        sheet_0: { name: '背包物品表', content: [['row_id', '物品名']] },
      };
      const result = validateMergeParams_ACU('默认提示词');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('纪要表');
    });

    it('有效参数时返回 valid=true 和完整数据', () => {
      const result = validateMergeParams_ACU('默认提示词');
      expect(result.valid).toBe(true);
      expect(result.summaryKey).toBe('sheet_1');
      expect(result.allSummaryRows!.length).toBe(5);
    });
  });

  describe('applyMergeResult_ACU — 结果写入', () => {
    it('合并结果正确替换原数据', () => {
      const accumulatedSummary = [
        [null, '合并纪要1：冈部遇到红莉栖并发现时间机器'],
        [null, '合并纪要2：D-Mail实验导致世界线变动'],
      ];
      applyMergeResult_ACU('sheet_1', accumulatedSummary, 0, 5);

      const table = mockCurrentJsonTableDataRef.value.sheet_1;
      // header + 2 条合并后的纪要
      expect(table.content.length).toBe(3);
      expect(table.content[1][1]).toContain('合并纪要1');
      expect(table.content[2][1]).toContain('合并纪要2');
    });
  });

  describe('executeMergeBatches_ACU — 批次执行', () => {
    it('AI 返回有效数据时成功累积', async () => {
      vi.mocked(sendConnectionManagerRequest_ACU).mockResolvedValue({
        ok: true,
        result: { choices: [{ message: { content: '<tableEdit>insertRow(0, {"0": "合并纪要"})</tableEdit>' } }] },
      });
      vi.mocked(extractTableEditInner_ACU).mockReturnValue({
        inner: 'insertRow(0, {"0": "合并纪要"})',
        cleaned: '',
        mode: 'full',
      } as any);

      const config = {
        summaryKey: 'sheet_1',
        allSummaryRows: [['1', '事件1'], ['2', '事件2']],
        fullSummaryRows: [['1', '事件1'], ['2', '事件2']],
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

    it('用户中止时返回 success=false', async () => {
      const config = {
        summaryKey: 'sheet_1',
        allSummaryRows: [['1', '事件1']],
        fullSummaryRows: [['1', '事件1']],
        startIndex: 0,
        targetCount: 1,
        batchSize: 5,
        promptTemplate: '$A $BASE_DATA $TARGET_COUNT',
        maxRetries: 1,
      };

      const result = await executeMergeBatches_ACU(config, undefined, () => true);
      expect(result.success).toBe(false);
      expect(result.error).toContain('终止');
    });
  });

  describe('辅助函数', () => {
    it('pickLastRowsBeforeIndex_ACU 正确取最近 N 条', () => {
      const rows = [['a'], ['b'], ['c'], ['d'], ['e']];
      expect(pickLastRowsBeforeIndex_ACU(rows, 3, 2)).toEqual([['b'], ['c']]);
      expect(pickLastRowsBeforeIndex_ACU(rows, 0, 2)).toEqual([]);
      expect(pickLastRowsBeforeIndex_ACU([], 3, 2)).toEqual([]);
    });

    it('formatTableStructure 正确格式化', () => {
      const tableObj = {
        content: [['row_id', '事件']],
        sourceData: { note: '纪要' },
      };
      const result = formatTableStructure('纪要表', [['合并纪要1']], tableObj, 0);
      expect(result).toContain('纪要表');
      expect(result).toContain('合并纪要1');
    });
  });
});