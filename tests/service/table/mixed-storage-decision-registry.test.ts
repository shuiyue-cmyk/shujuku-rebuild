import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: { value: [] as any[] },
  scope: { identifier: 'chat-a', isolationKey: 'alpha' },
  commit: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({ getChatArray_ACU: () => mocks.chat.value }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return mocks.scope.identifier; },
  getCurrentIsolationKey_ACU: () => mocks.scope.isolationKey,
}));
vi.mock('../../../src/service/table/mixed-storage-commit', () => ({ commitMixedStorageDecision_ACU: mocks.commit }));
vi.mock('../../../src/service/table/mixed-storage-snapshot-transfer', () => ({ buildMixedStorageSnapshotTransfer_ACU: mocks.snapshot }));

import {
  __resetMixedStorageDecisionRegistryForTests_ACU,
  buildRegisteredMixedStorageSnapshotTransfer_ACU,
  commitRegisteredMixedStorageDecision_ACU,
  getActiveMixedStorageDecisionSummary_ACU,
  registerMixedStorageDecision_ACU,
} from '../../../src/service/table/mixed-storage-decision-registry';

function decision(id = 'decision-a') {
  return {
    decisionId: id,
    kind: 'legacy_has_v2_missing_data',
    createdAt: 1,
    diagnosticCodes: ['merge_candidate_available'],
    allowedActions: ['noop', 'download_snapshots', 'commit_merge_candidate'],
    scopeSnapshot: { chatReference: mocks.chat.value, chatIdentifier: 'chat-a', activeIsolationKey: 'alpha' },
  } as any;
}

describe('mixed-storage-decision-registry', () => {
  beforeEach(() => {
    __resetMixedStorageDecisionRegistryForTests_ACU();
    mocks.chat.value = [];
    mocks.scope.identifier = 'chat-a';
    mocks.scope.isolationKey = 'alpha';
    mocks.commit.mockReset();
    mocks.snapshot.mockReset();
  });

  it('仅暴露 summary，并以 decisionId 重新取得冻结 decision 后提交', async () => {
    const item = decision();
    registerMixedStorageDecision_ACU(item, { enabled: true, code: 'alpha' });
    mocks.commit.mockResolvedValue({ status: 'committed', decisionId: item.decisionId });
    item.allowedActions.length = 0;
    item.diagnosticCodes.push('mutated_after_registration');

    expect(getActiveMixedStorageDecisionSummary_ACU()).toEqual({
      decisionId: item.decisionId,
      kind: item.kind,
      diagnosticCodes: ['merge_candidate_available'],
      allowedActions: ['noop', 'download_snapshots', 'commit_merge_candidate'],
      createdAt: 1,
      anchorStatus: 'missing_without_artifacts',
      replayStatus: 'unavailable',
      staticSheetKeyCount: 0,
    });
    await expect(commitRegisteredMixedStorageDecision_ACU(item.decisionId, 'commit_merge_candidate')).resolves.toEqual({ status: 'committed', decisionId: item.decisionId });
    expect(mocks.commit).toHaveBeenCalledWith({
      decision: expect.objectContaining({
        decisionId: item.decisionId,
        allowedActions: ['noop', 'download_snapshots', 'commit_merge_candidate'],
        diagnosticCodes: ['merge_candidate_available'],
      }),
      action: 'commit_merge_candidate',
      isolationConfig: { enabled: true, code: 'alpha' },
    });
    expect(getActiveMixedStorageDecisionSummary_ACU()).toBeNull();
  });

  it('scope 变化会令下载和提交决议失效，且不调用下游 service', () => {
    const item = decision();
    registerMixedStorageDecision_ACU(item, { enabled: true, code: 'alpha' });
    mocks.scope.isolationKey = 'beta';

    expect(getActiveMixedStorageDecisionSummary_ACU()).toBeNull();
    expect(() => buildRegisteredMixedStorageSnapshotTransfer_ACU(item.decisionId)).toThrow('不存在、已失效或已被替换');
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
