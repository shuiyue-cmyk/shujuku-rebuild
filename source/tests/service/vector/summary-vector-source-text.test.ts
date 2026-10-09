/**
 * tests/service/vector/summary-vector-source-text.test.ts
 * spv9.2 remainder：向量源文本 = 概览 + 纪要正文（chronicle aliases）。
 * 说明：指纹哈希化落盘（vectorSourceHash）；旧格式识别 split3 已随
 * isSummaryVectorIndexSourceTextOutdated_ACU 落盘（archive-service），
 * 后台静默重建与 UI 自愈链路见 summary-vector-index-ui。
 * 本地存储格式不变，指纹仍对 vectorSourceText 内容计算。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return null; },
  currentChatFileIdentifier_ACU: 'test-chat',
  getCurrentIsolationKey_ACU: () => '',
  settings_ACU: { dataIsolationEnabled: false, dataIsolationCode: '' },
}));
vi.mock('../../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: () => [],
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => [],
  saveChatToHost_ACU: vi.fn(),
  saveChatToHostStrict_ACU: vi.fn(),
}));
vi.mock('../../../src/data/gateways/vector-embedding-gateway', () => ({
  createEmbeddings_ACU: vi.fn(),
  isVectorEmbeddingError_ACU: () => false,
  VectorEmbeddingError_ACU: class extends Error {},
}));
vi.mock('../../../src/data/storage/vector-index-hot-cache', () => ({
  assertSummaryVectorFlushGenerationCurrent_ACU: vi.fn(),
  SummaryVectorFlushGenerationInvalidatedError_ACU: class extends Error {},
}));
vi.mock('../../../src/service/vector/vector-memory-config', () => ({
  getEffectiveSummaryVectorIndexConfig_ACU: () => ({}),
  validateSummaryVectorIndexConfig_ACU: () => ({ valid: true, errors: [] }),
}));
vi.mock('../../../src/service/vector/summary-vector-index-storage-service', () => ({
  loadSummaryVectorIndexChunksFromManifest_ACU: vi.fn(),
  persistSummaryVectorIndexSnapshot_ACU: vi.fn(),
  deleteSummaryVectorIndexExternal_ACU: vi.fn(),
  abortSummaryVectorIndexSnapshotPublication_ACU: vi.fn(),
  finalizeSummaryVectorIndexSnapshotPublication_ACU: vi.fn(),
  isLegacySummaryVectorIndexManifest_ACU: () => false,
  logSummaryVectorIndexIdentityEvent_ACU: vi.fn(),
  normalizeSummaryVectorIndexManifestForRead_ACU: (m: any) => m,
}));
vi.mock('../../../src/data/repositories/chat-message-data-repo', () => ({
  readIsolatedTagData_ACU: () => null,
  writeMessageIdentity_ACU: vi.fn(),
}));

import {
  buildPreparedRows_ACU,
  buildSummaryVectorSourceText_ACU,
  SUMMARY_VECTOR_SOURCE_TEXT_MAX_CHARS_ACU,
} from '../../../src/service/vector/summary-vector-index-archive-service';

const HEADER = ['row_id', '时间跨度', '地点', '纪要', '概览', '编码索引'];

function table(rows: any[][]): any {
  return { name: '纪要表', content: [HEADER, ...rows] };
}

describe('buildSummaryVectorSourceText_ACU', () => {
  it('概览在前、纪要正文在后，用换行拼接', () => {
    expect(buildSummaryVectorSourceText_ACU(' 主角进城 ', '主角在黄昏时分到达王城，遇见了守门人。')).toBe('主角进城\n主角在黄昏时分到达王城，遇见了守门人。');
  });

  it('没有纪要正文时退化为只用概览', () => {
    expect(buildSummaryVectorSourceText_ACU('主角进城', '')).toBe('主角进城');
  });

  it('超长正文截断到上限', () => {
    const text = buildSummaryVectorSourceText_ACU('概览', 'x'.repeat(5000));
    expect(text.length).toBe(SUMMARY_VECTOR_SOURCE_TEXT_MAX_CHARS_ACU);
  });
});

describe('buildPreparedRows_ACU 源文本含纪要正文', () => {

  it('模板没有纪要列时回退为只用概览（旧模板兼容）', () => {
    const prepared = buildPreparedRows_ACU({
      name: '纪要表',
      content: [
        ['row_id', '时间跨度', '地点', '概要', '编码索引'],
        ['1', '上午', '甲地', '第一次事件。', 'AM-0001'],
      ],
    }, 'sheet_summary');

    expect(prepared.rows[0].chronicleText).toBe('');
    expect(prepared.rows[0].vectorSourceText).toBe('第一次事件。');
  });

  it('纪要列别名（纪要正文/正文）同样识别', () => {
    for (const alias of ['纪要正文', '正文']) {
      const prepared = buildPreparedRows_ACU({
        name: '纪要表',
        content: [
          ['row_id', '时间跨度', '地点', alias, '概览', '编码索引'],
          ['1', '上午', '甲地', '正文内容', '概览内容', 'AM-0001'],
        ],
      }, 'sheet_summary');
      expect(prepared.rows[0].chronicleText).toBe('正文内容');
      expect(prepared.rows[0].vectorSourceText).toBe('概览内容\n正文内容');
    }
  });

  it('row_id 为空时回退用编码索引作为行身份', () => {
    const prepared = buildPreparedRows_ACU({
      name: '纪要表',
      content: [
        ['row_id', '编码索引', '时间跨度', '概览', '纪要', '重要对话'],
        ['', 'AM0001', '1184-11-15 17:55 ~ 1184-11-15 18:00', '江南急报', '师徒启程前往江南查案。', '对话'],
      ],
    }, 'sheet_summary');
    expect(prepared.error).toBe('');
    expect(prepared.rows).toHaveLength(1);
    expect(prepared.rows[0].rowId).toBe('AM0001');
    expect(prepared.rows[0].indexCode).toBe('AM0001');
    expect(prepared.skippedRowCount).toBe(0);
  });

  it('只改纪要正文（概览不变）也会让指纹变化 → 增量归档会重新 embedding 该行', () => {
    const before = buildPreparedRows_ACU(table([['1', 't', 'l', '正文 A', '概览', 'AM0001']]), 'k').rows[0];
    const after = buildPreparedRows_ACU(table([['1', 't', 'l', '正文 B', '概览', 'AM0001']]), 'k').rows[0];
    expect(before.rowKey).toBe(after.rowKey);
    expect(before.sourceFingerprint).not.toBe(after.sourceFingerprint);
  });
});
