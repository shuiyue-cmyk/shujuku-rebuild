/**
 * tests/service/table/storage-frame-v2-write-guard.test.ts
 * 写时严格探针 / 兼容只读门闸的消息构造与识别谓词 + validateCurrentChatTableRecovery
 * 的兼容只读分支（真实回放：未知 operation kind 使严格回放失败、宽容回放通过）。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/service/runtime/state-manager', () => ({
  getCurrentIsolationKey_ACU: () => '',
  settings_ACU: { dataIsolationEnabled: false, dataIsolationCode: '' },
}));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => [],
}));

import {
  buildAppendedOperationsWriteRejectionMessage_ACU,
  buildCompatReadonlyWriteRejectionMessage_ACU,
  isAppendedOperationsWriteRejection_ACU,
  isCompatReadonlyWriteRejection_ACU,
  validateCurrentChatTableRecovery_ACU,
  V2_COMPAT_READONLY_MARKER_ACU,
  V2_WRITE_GUARD_MARKER_ACU,
} from '../../../src/service/table/storage-frame-v2-replay';

describe('写拒绝消息构造与识别', () => {
  it('兼容只读拒绝文案带统一关键短语，可被谓词识别', () => {
    const message = buildCompatReadonlyWriteRejectionMessage_ACU('V2 写入前', {
      legacyToleranceDiagnosis: { tolerances: [], strictError: 'strict boom', identityRemaps: [] },
    });
    expect(message).toContain(V2_COMPAT_READONLY_MARKER_ACU);
    expect(message).toContain('strict boom');
    expect(isCompatReadonlyWriteRejection_ACU(message)).toBe(true);
    expect(isCompatReadonlyWriteRejection_ACU(new Error(message))).toBe(true);
    expect(isCompatReadonlyWriteRejection_ACU('V2 写入前检测到结构性 replay repair')).toBe(false);
    expect(isCompatReadonlyWriteRejection_ACU(undefined)).toBe(false);
  });

  it('兼容只读拒绝缺诊断时回退未知错误', () => {
    const message = buildCompatReadonlyWriteRejectionMessage_ACU('V2 batch 写入前', null);
    expect(message).toContain('未知错误');
    expect(isCompatReadonlyWriteRejection_ACU(message)).toBe(true);
  });

  // G13-02：指引与真实 UI/行为对齐——不存在「固化兼容回放为过渡根」按钮；
  // 无身份归并 → 后台自动固化（重载聊天后重试）；含身份归并 → 指向真实的
  // 「历史恢复诊断」入口并说明当前版本无法自助修复。
  it('兼容只读拒绝的指引按是否含身份归并分支，不再指向不存在的按钮', () => {
    const plain = buildCompatReadonlyWriteRejectionMessage_ACU('V2 写入前', {
      legacyToleranceDiagnosis: { tolerances: [], strictError: 'boom', identityRemaps: [] },
    });
    expect(plain).toContain('重新加载聊天时由后台自动固化为过渡根');
    expect(plain).not.toContain('固化兼容回放为过渡根');
    expect(plain).not.toContain('诊断 V2 数据恢复');

    const remapped = buildCompatReadonlyWriteRejectionMessage_ACU('V2 写入前', {
      legacyToleranceDiagnosis: {
        tolerances: ['identity_remap'],
        strictError: 'boom',
        identityRemaps: [{ fromKey: 'sheet_old', toKey: 'sheet_new', canonicalName: '表', overriddenRows: 1, appendedRows: 0 } as any],
      },
    });
    expect(remapped).toContain('历史恢复诊断');
    expect(remapped).toContain('无法自助修复');
    expect(remapped).not.toContain('执行 V2 恢复（身份归一化）');
    expect(isCompatReadonlyWriteRejection_ACU(remapped)).toBe(true);
  });

  it('写时探针拒绝文案带统一关键短语，可被谓词识别', () => {
    const message = buildAppendedOperationsWriteRejectionMessage_ACU('UNIQUE constraint failed: t.row_id');
    expect(message).toContain(V2_WRITE_GUARD_MARKER_ACU);
    expect(message).toContain('UNIQUE constraint failed');
    expect(isAppendedOperationsWriteRejection_ACU(message)).toBe(true);
    expect(isAppendedOperationsWriteRejection_ACU(new Error(message))).toBe(true);
    expect(isAppendedOperationsWriteRejection_ACU('V2 写入前检测到结构性 replay repair')).toBe(false);
    // 两类标记互不串扰：分类顺序（先探针后兼容）稳定。
    expect(isCompatReadonlyWriteRejection_ACU(message)).toBe(false);
    expect(isAppendedOperationsWriteRejection_ACU(
      buildCompatReadonlyWriteRejectionMessage_ACU('V2 写入前', null),
    )).toBe(false);
  });
});

describe('validateCurrentChatTableRecovery_ACU 兼容只读分支', () => {
  it('宽容回放态返回恢复收敛诊断，不走临时补锚消息', async () => {
    // 真实回放：未知 operation kind 使严格回放失败、Tier-1 宽容回放通过。
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: {
              kind: 'full', createdAt: 1, reason: 'init',
              data: {
                mate: { type: 'acu', version: 1 },
                sheet_0: { uid: 'inventory', name: '背包', content: [['row_id', '名称'], ['1', '铁剑']], sourceData: {}, updateConfig: {}, exportConfig: {}, orderNo: 0 },
              },
            },
            logEntries: [{
              seq: 1, entryId: 'unknown-kind', createdAt: 2, source: 'system',
              targetMessageIndex: 0, aiFloor: 1, filledSheetKeys: [], changedSheetKeys: [], groupKeys: [],
              operations: [{ kind: 'bogus_kind_for_compat_test', sheetKey: 'sheet_0', reason: 'test' }],
            }],
          },
        },
      },
    }];
    const result = await validateCurrentChatTableRecovery_ACU({ chat, isolationKey: '' });
    expect(result).toMatchObject({
      success: false,
      diagnosticCode: 'replay_requires_checkpoint_convergence',
    });
    if (result.success === false) {
      expect(result.error).toContain('仅可经兼容宽容回放读出');
      expect(result.error).not.toContain('临时 Sheet 补锚');
    } else {
      throw new Error('unreachable');
    }
  });
});
