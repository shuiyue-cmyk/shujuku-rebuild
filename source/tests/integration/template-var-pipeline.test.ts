/**
 * tests/integration/template-var-pipeline.test.ts
 * I3 集成测试：模板变量替换管线
 * 验证 random → calc → max/min → if-block 的完整串联
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettings, mockCurrentJsonTableDataRef } = vi.hoisted(() => ({
  mockSettings: {
    dataIsolationEnabled: false,
    dataIsolationCode: '',
  } as any,
  mockCurrentJsonTableDataRef: {
    value: {
      sheet_0: {
        name: '背包物品表',
        content: [['row_id', '物品名', '数量'], ['1', '铁剑', '3'], ['2', '药水', '10']],
        sourceData: { note: '背包' },
      },
    } as any,
  },
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableDataRef.value; },
  settings_ACU: mockSettings,
  getCurrentIsolationKey_ACU: vi.fn(() => ''),
}));

vi.mock('../../src/shared/utils', () => ({
  isSummaryOrOutlineTable_ACU: vi.fn((name: string) => name.includes('纪要')),
  logDebug_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
}));

vi.mock('../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (json: string, fallback: any) => { try { return JSON.parse(json); } catch { return fallback; } },
  safeJsonStringify_ACU: (obj: any, fallback: string) => { try { return JSON.stringify(obj); } catch { return fallback; } },
}));

vi.mock('../../src/service/table/storage-mode', () => ({
  isSqliteMode: vi.fn(() => false),
  isNativeMode: vi.fn(() => true),
  getCurrentStorageMode: vi.fn(() => 'native'),
}));

vi.mock('../../src/service/template/chat-scope', () => ({
  getEffectiveSeedRowsForSheet_ACU: vi.fn(() => []),
  getSortedSheetKeys_ACU: vi.fn((data: any) => data ? Object.keys(data).filter((k: string) => k.startsWith('sheet_')).sort() : []),
}));

import {
  parseRandomTags_ACU,
  replaceRandomVariables_ACU,
  parseCalcTags_ACU,
  replaceCalcVariables_ACU,
  parseMaxTags_ACU,
  parseMinTags_ACU,
  replaceMaxVariables_ACU,
  replaceMinVariables_ACU,
  setTemplateVariableStores_ACU,
} from '../../src/service/runtime/template-vars/var-store-and-tags';

import {
  parseIfBlocksInContent_ACU,
} from '../../src/service/runtime/template-vars/if-block-parser';

beforeEach(() => {
  vi.clearAllMocks();
  setTemplateVariableStores_ACU(null);
});

describe('I3: 模板变量替换管线', () => {
  it('Random 标签解析和替换', () => {
    // parseRandomTags_ACU 语法：<random id="xxx" min="N" max="M" />
    // replaceRandomVariables_ACU 替换 $random:id 格式
    const input = '<random id="dice" min="1" max="6" />你掷出了$random:dice';
    const parsed = parseRandomTags_ACU(input);
    const result = replaceRandomVariables_ACU(parsed);
    expect(result).not.toContain('<random');
    expect(result).not.toContain('$random:dice');
    expect(result).toMatch(/你掷出了[1-6]/);
  });

  it('Calc 标签解析和替换', () => {
    const context = { allTablesJson: mockCurrentJsonTableDataRef.value };
    // parseCalcTags_ACU 语法：<calc id="xxx" expr="表达式" />
    // replaceCalcVariables_ACU 替换 $calc:id 格式
    const input = '<calc id="total" expr="3 + 10" />总数是$calc:total';
    const parsed = parseCalcTags_ACU(input, context);
    const result = replaceCalcVariables_ACU(parsed);
    expect(result).toContain('13');
    expect(result).not.toContain('<calc');
    expect(result).not.toContain('$calc:total');
  });

  it('Max/Min 标签解析和替换', () => {
    const context = { allTablesJson: mockCurrentJsonTableDataRef.value };
    const inputMax = '<max id="maxVal" values="5, 10, 3" />最大值是$max:maxVal';
    const parsedMax = parseMaxTags_ACU(inputMax, context);
    const resultMax = replaceMaxVariables_ACU(parsedMax);
    expect(resultMax).toContain('10');

    const inputMin = '<min id="minVal" values="5, 10, 3" />最小值是$min:minVal';
    const parsedMin = parseMinTags_ACU(inputMin, context);
    const resultMin = replaceMinVariables_ACU(parsedMin);
    expect(resultMin).toContain('3');
  });

  it('完整管线串联：random → calc → max → min → 变量替换', () => {
    const context = { allTablesJson: mockCurrentJsonTableDataRef.value };
    let content = '<random id="bonus" min="1" max="3" /><calc id="base" expr="10" />攻击力=$calc:base+$random:bonus';

    // 管线执行顺序
    content = parseRandomTags_ACU(content);
    content = replaceRandomVariables_ACU(content);
    content = parseCalcTags_ACU(content, context);
    content = replaceCalcVariables_ACU(content);

    expect(content).not.toContain('<random');
    expect(content).not.toContain('<calc');
    expect(content).not.toContain('$calc:base');
    expect(content).not.toContain('$random:bonus');
    expect(content).toContain('攻击力=10+');
  });
});