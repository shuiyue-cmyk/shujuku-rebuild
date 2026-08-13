/**
 * tests/integration/ai-fill-table.test.ts
 * I2 集成测试：AI 填表完整流程
 * 验证 prompt 构建 → AI 调用 → 解析 → 应用的完整链路
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings, mockCurrentJsonTableDataRef } = vi.hoisted(() => ({
  mockSettings: {
    tableEditLastPairOnly: false,
    autoUpdateTokenThreshold: 0,
    streamingEnabled: false,
    apiMode: 'tavern',
    tavernProfile: 'default',
    apiConfig: { max_tokens: 4096, model: 'gpt-4', useMainApi: false },
    charCardPrompt: [{ role: 'USER', content: '你是填表助手', isMain: true, mainSlot: 'A' }],
  } as any,
  mockCurrentJsonTableDataRef: { value: null as any },
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableDataRef.value; },
  settings_ACU: mockSettings,
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
  _set_currentJsonTableData_ACU: vi.fn((v: any) => { mockCurrentJsonTableDataRef.value = v; }),
  coreApisAreReady_ACU: true,
  isAutoUpdatingCard_ACU: false,
  wasStoppedByUser_ACU: false,
  _set_isAutoUpdatingCard_ACU: vi.fn(),
  _set_wasStoppedByUser_ACU: vi.fn(),
  _set_manualExtraHint_ACU: vi.fn(),
}));

vi.mock('../../src/shared/utils', () => ({
  isSummaryOrOutlineTable_ACU: vi.fn((name: string) => name.includes('纪要')),
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  parseTableTemplateJson_ACU: vi.fn(),
}));

vi.mock('../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (json: string, fallback: any) => { try { return JSON.parse(json); } catch { return fallback; } },
  safeJsonStringify_ACU: (obj: any, fallback: string) => { try { return JSON.stringify(obj); } catch { return fallback; } },
  stripJsonCommentsPreservingStrings_ACU: (input: string) => {
    if (typeof input !== 'string' || !input) return input;
    let result = '';
    let inString = false;
    let escapeNext = false;
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      const nextChar = input[i + 1] || '';
      if (escapeNext) { result += char; escapeNext = false; continue; }
      if (inString) {
        result += char;
        if (char === '\\') escapeNext = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; result += char; continue; }
      if (char === '/' && nextChar === '/') break;
      result += char;
    }
    return result;
  },
}));

vi.mock('../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => false),
}));

vi.mock('../../src/service/table/table-storage-strategy', () => ({
  getStorageProvider: vi.fn(),
}));

vi.mock('../../src/service/template/chat-scope', () => ({
  getEffectiveSeedRowsForSheet_ACU: vi.fn(() => []),
  getSortedSheetKeys_ACU: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')).sort() : []),
}));

vi.mock('../../src/service/runtime/helpers-remaining', () => ({
  applySummaryIndexSequenceToTable_ACU: vi.fn(),
  formatSummaryIndexCode_ACU: vi.fn(),
  getSummaryIndexColumnIndex_ACU: vi.fn(() => -1),
  getTableLocksForSheet_ACU: vi.fn(() => ({})),
  isSpecialIndexLockEnabled_ACU: vi.fn(() => false),
}));

import { extractTableEditInner_ACU, parseAndApplyTableEdits_ACU } from '../../src/service/ai/prompt-builder/table-edit-parser';

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentJsonTableDataRef.value = {
    sheet_0: {
      name: '背包物品表',
      content: [['row_id', '物品名', '数量'], ['1', '铁剑', '3']],
      updateConfig: {},
      sourceData: { note: '背包', initNode: '', deleteNode: '', updateNode: '', insertNode: '' },
    },
  };
});

describe('I2: AI 填表完整流程', () => {
  describe('extractTableEditInner_ACU — 提取 tableEdit 块', () => {
    it('标准 <tableEdit> 标签提取', () => {
      const aiResponse = '一些文字\n<tableEdit>\ninsertRow(0, {"0": "药水", "1": "5"})\n</tableEdit>\n更多文字';
      const result = extractTableEditInner_ACU(aiResponse);
      expect(result).not.toBeNull();
      expect(result!.inner).toContain('insertRow');
    });

    it('无 tableEdit 标签时返回 null', () => {
      const result = extractTableEditInner_ACU('没有任何标签的文本');
      expect(result).toBeNull();
    });
  });

  describe('parseAndApplyTableEdits_ACU — 解析并应用编辑', () => {
    it('insertRow 指令正确添加行', () => {
      const aiResponse = '<tableEdit>insertRow(0, {"0": "药水", "1": "5"})</tableEdit>';
      const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
      // 验证数据被修改
      const table = mockCurrentJsonTableDataRef.value.sheet_0;
      expect(table.content.length).toBeGreaterThan(2); // header + 原有行 + 新行
    });

    it('updateRow 指令不抛错且返回成功', () => {
      // updateRow 内部依赖 materializeSeedRowsIfNeeded_ACU 和 getTableLocksForSheet_ACU
      // 集成测试验证函数不抛错，具体列更新逻辑由单元测试覆盖
      const aiResponse = '<tableEdit>updateRow(0, 0, {"0": "金剑", "1": "10"})</tableEdit>';
      const result = parseAndApplyTableEdits_ACU(aiResponse, 'standard');
      // 函数应返回成功（不抛错）
      expect(result).toBeTruthy();
    });

    it('deleteRow 指令正确删除行', () => {
      const aiResponse = '<tableEdit>deleteRow(0, 0)</tableEdit>';
      parseAndApplyTableEdits_ACU(aiResponse, 'standard');
      const table = mockCurrentJsonTableDataRef.value.sheet_0;
      // 删除后只剩 header
      expect(table.content.length).toBe(1);
    });

    it('空 tableEdit 块不修改数据', () => {
      const originalContent = JSON.parse(JSON.stringify(mockCurrentJsonTableDataRef.value.sheet_0.content));
      const result = parseAndApplyTableEdits_ACU('<tableEdit></tableEdit>', 'standard');
      expect(result).toBe(true); // 空块返回 true（无编辑）
      expect(mockCurrentJsonTableDataRef.value.sheet_0.content).toEqual(originalContent);
    });

    it('currentJsonTableData 为 null 时返回 false', () => {
      mockCurrentJsonTableDataRef.value = null;
      const result = parseAndApplyTableEdits_ACU('<tableEdit>insertRow(0, {"0": "x"})</tableEdit>');
      expect(result).toBe(false);
    });
  });

  describe('完整链路：提取 → 解析 → 应用', () => {
    it('AI 返回有效 insertRow → 数据正确更新', () => {
      const aiResponse = '好的，我来添加一个新物品。\n<tableEdit>\n<!-- insertRow(0, {"0": "药水", "1": "5"}) -->\n</tableEdit>';
      const extracted = extractTableEditInner_ACU(aiResponse, { allowNoTableEditTags: false });
      expect(extracted).not.toBeNull();

      parseAndApplyTableEdits_ACU(aiResponse, 'standard');
      const table = mockCurrentJsonTableDataRef.value.sheet_0;
      const lastRow = table.content[table.content.length - 1];
      expect(lastRow).toContain('药水');
    });
  });
});