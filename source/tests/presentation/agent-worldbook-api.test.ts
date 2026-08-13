import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const {
  mockReadControl,
  mockWriteControl,
  mockTakeover,
  mockRestore,
  mockRefreshSnapshot,
  mockRunSkillify,
  mockSkillifyByBookNames,
  mockSaveMeta,
  mockDeleteMeta,
  mockClearMeta,
} = vi.hoisted(() => ({
  mockReadControl: vi.fn(),
  mockWriteControl: vi.fn(),
  mockTakeover: vi.fn(),
  mockRestore: vi.fn(),
  mockRefreshSnapshot: vi.fn(),
  mockRunSkillify: vi.fn(),
  mockSkillifyByBookNames: vi.fn(),
  mockSaveMeta: vi.fn(),
  mockDeleteMeta: vi.fn(),
  mockClearMeta: vi.fn(),
}));

vi.mock('../../src/shared/utils', () => ({
  logError_ACU: vi.fn(),
}));

vi.mock('../../src/service/agent/agent-worldbook-config-meta', () => ({
  readAgentWorldbookControlFromWorldbooks_ACU: mockReadControl,
  writeAgentWorldbookControlToWorldbook_ACU: mockWriteControl,
}));

vi.mock('../../src/service/agent/agent-worldbook-takeover', () => ({
  takeoverWorldbookGreenlights_ACU: mockTakeover,
  restoreWorldbookGreenlights_ACU: mockRestore,
  refreshPlotAgentWorldbookSnapshotFromWorldbooks_ACU: mockRefreshSnapshot,
}));

vi.mock('../../src/service/agent/agent-skillify-service', () => ({
  skillifyCurrentPlotWorldbookSelection_ACU: mockRunSkillify,
  skillifyWorldbookEntries_ACU: mockSkillifyByBookNames,
}));

vi.mock('../../src/service/agent/agent-worldbook-skill-meta', () => ({
  saveWorldbookEntrySkillMeta_ACU: mockSaveMeta,
  deleteWorldbookEntrySkillMeta_ACU: mockDeleteMeta,
  clearWorldbookSkillMetaBlocks_ACU: mockClearMeta,
}));

import { createAgentWorldbookApi } from '../../src/presentation/bootstrap/api-groups/agent-worldbook-api';

const defaultControl = { mode: 'disabled', enabled: false, agentApiPreset: '' };
const defaultSnapshot = { active: true, selectionSignature: 'sig', createdAt: 1, books: { BookA: [{ uid: 1, previousEnabled: true }] } };

function writeResult(mode: 'disabled' | 'passive' | 'agent', updated = true, reason?: string) {
  return { updated, bookName: '主世界书', entryUid: 'cfg', reason, control: { ...defaultControl, mode, enabled: mode !== 'disabled' } };
}

describe('createAgentWorldbookApi', () => {
  it('api-registry 注册 Agent 世界书 API group，避免全局 API 漏挂', () => {
    const registrySource = readFileSync('src/presentation/bootstrap/api-registry.ts', 'utf-8');

    expect(registrySource).toContain("import { createAgentWorldbookApi } from './api-groups/agent-worldbook-api';");
    expect(registrySource).toContain('createAgentWorldbookApi(ctx),');
    expect(registrySource.indexOf('createWorldbookAiApi(ctx),')).toBeGreaterThan(-1);
    expect(registrySource.indexOf('createAgentWorldbookApi(ctx),')).toBeGreaterThan(
      registrySource.indexOf('createWorldbookAiApi(ctx),')
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadControl.mockResolvedValue({
      control: defaultControl,
      source: 'worldbook',
      bookName: '主世界书',
      entryUid: 'cfg',
      duplicateCount: 0,
      writableBookName: '主世界书',
    });
    mockWriteControl.mockImplementation(async (patch: any) => writeResult(patch.mode));
    mockTakeover.mockResolvedValue({
      updated: true,
      reason: 'native_worldbook_trigger_disabled',
      bookNames: ['主世界书'],
      selectionSignature: 'sig',
      totalCandidates: 1,
      disabled:1,
      failed: 0,
      snapshot: defaultSnapshot,
      updates: [{ bookName: '主世界书', uid: 1 }],
    });
    mockRestore.mockResolvedValue({
      updated: true,
      reason: 'native_worldbook_trigger_restored',
      bookNames: ['主世界书'],
      selectionSignature: 'sig',
      restored: 1,
      skipped: 0,
      failed: 0,
      updates: [],
    });
    mockRefreshSnapshot.mockResolvedValue(defaultSnapshot);
    mockRunSkillify.mockResolvedValue({
      totalCandidates: 2,
      updated: 1,
      skipped: 1,
      failed: 0,
      results: [{ status: 'updated', bookName: '主世界书', uid: 1 }],
    });
    mockSkillifyByBookNames.mockResolvedValue({
      totalCandidates: 1,
      updated: 1,
      skipped: 0,
      failed: 0,
      results: [{ status: 'updated', bookName: 'BookA', uid: 1 }],
    });
    mockSaveMeta.mockResolvedValue({ updated: true, entry: { uid: 1, comment: 'meta' } });
    mockDeleteMeta.mockResolvedValue({ updated: true, entry: { uid: 1, comment: 'clean' } });
    mockClearMeta.mockResolvedValue({ total: 1, cleared: 1, skipped: 0, failed: 0, errors: [] });
  });


  it('getAgentWorldbookControl 返回世界书状态条目来源的控制配置', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.getAgentWorldbookControl();

    expect(result).toEqual({
      success: true,
      control: defaultControl,
      source: 'worldbook',
      bookName: '主世界书',
      entryUid: 'cfg',
      duplicateCount: 0,
      writableBookName: '主世界书',
    });
    expect(mockReadControl).toHaveBeenCalledTimes(1);
  });

  it('getAgentWorldbookControl 捕获异常并返回结构化错误', async () => {
    mockReadControl.mockRejectedValue('read failed');
    const api = createAgentWorldbookApi({} as any);

    const result = await api.getAgentWorldbookControl();

    expect(result).toEqual({ success: false, error: 'read failed' });
  });

  it('setAgentWorldbookMode 拒绝非法 mode 且不写入世界书状态', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.setAgentWorldbookMode('enabled');

    expect(result.success).toBe(false);
    expect(result.error).toContain('disabled、passive 或 agent');
    expect(mockWriteControl).not.toHaveBeenCalled();
    expect(mockTakeover).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('setAgentWorldbookMode passive 只写世界书控制配置，不触发接管或恢复', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.setAgentWorldbookMode('passive');

    expect(result.success).toBe(true);
    expect(mockWriteControl).toHaveBeenCalledWith({ mode: 'passive', enabled: true });
    expect(mockTakeover).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('setAgentWorldbookMode agent 默认写入状态条目并执行 takeover', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.setAgentWorldbookMode('agent');

    expect(result.success).toBe(true);
    expect(result.mode).toBe('agent');
    expect(mockWriteControl).toHaveBeenCalledWith({ mode: 'agent', enabled: true });
    expect(mockTakeover).toHaveBeenCalledTimes(1);
    expect(mockRestore).not.toHaveBeenCalled();
    expect(result.takeover).toEqual(expect.objectContaining({ failed: 0, snapshot: defaultSnapshot }));
  });

  it('setAgentWorldbookMode agent 支持跳过 takeover', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.setAgentWorldbookMode('agent', { runTakeover: false });

    expect(result.success).toBe(true);
    expect(mockWriteControl).toHaveBeenCalledWith({ mode: 'agent', enabled: true });
    expect(mockTakeover).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('setAgentWorldbookMode agent 在 takeover 部分失败时返回 success=false 并保留结果', async () => {
    mockTakeover.mockResolvedValue({
      updated: true,
      reason: 'snapshot_state_write_failed',
      bookNames: ['主世界书'],
      selectionSignature: 'sig',
      totalCandidates: 1,
      disabled: 0,
      failed: 1,
      snapshot: { ...defaultSnapshot, active: false },
      updates: [],
    });
    const api = createAgentWorldbookApi({} as any);

    const result = await api.setAgentWorldbookMode('agent');

    expect(result.success).toBe(false);
    expect(result.error).toBe('snapshot_state_write_failed');
    expect(result.takeover.failed).toBe(1);
  });

  it('setAgentWorldbookMode agent 在 takeover 无失败但 snapshot inactive 时返回 success=false', async () => {
    mockTakeover.mockResolvedValue({
      updated: false,
      reason: 'empty_candidates',
      bookNames: ['主世界书'],
      selectionSignature: 'sig',
      totalCandidates: 0,
      disabled: 0,
      failed: 0,
      snapshot: { ...defaultSnapshot, active: false },
      updates: [],
    });
    const api = createAgentWorldbookApi({} as any);

    const result = await api.setAgentWorldbookMode('agent');

    expect(result.success).toBe(false);
    expect(result.error).toBe('empty_candidates');
    expect(result.takeover.failed).toBe(0);
    expect(result.takeover.snapshot.active).toBe(false);
  });

  it('setAgentWorldbookMode disabled 默认使用 restore_only 恢复受控条目', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.setAgentWorldbookMode('disabled');

    expect(result.success).toBe(true);
    expect(mockWriteControl).toHaveBeenCalledWith({ mode: 'disabled', enabled: false });
    expect(mockRestore).toHaveBeenCalledWith({ cleanupMode: 'restore_only' });
    expect(mockTakeover).not.toHaveBeenCalled();
  });

  it('setAgentWorldbookMode disabled 支持跳过 restore', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.setAgentWorldbookMode('disabled', { restoreOnDisable: false });

    expect(result.success).toBe(true);
    expect(mockWriteControl).toHaveBeenCalledWith({ mode: 'disabled', enabled: false });
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('setAgentWorldbookMode disabled 在恢复 skipped 或 failed 时返回 success=false', async () => {
    mockRestore.mockResolvedValue({
      updated: true,
      reason: 'native_worldbook_trigger_restore_skipped',
      bookNames: ['主世界书'],
      selectionSignature: 'sig',
      restored: 0,
      skipped: 1,
      failed: 0,
      updates: [],
    });
    const api = createAgentWorldbookApi({} as any);

    const result = await api.setAgentWorldbookMode('disabled');

    expect(result.success).toBe(false);
    expect(result.error).toBe('native_worldbook_trigger_restore_skipped');
    expect(result.restore.skipped).toBe(1);
  });

  it('setAgentWorldbookMode disabled 在恢复 failed 时返回 success=false', async () => {
    mockRestore.mockResolvedValue({
      updated: true,
      reason: 'native_worldbook_trigger_restore_failed',
      bookNames: ['主世界书'],
      selectionSignature: 'sig',
      restored: 0,
      skipped: 0,
      failed: 1,
      updates: [],
    });
    const api = createAgentWorldbookApi({} as any);

    const result = await api.setAgentWorldbookMode('disabled');

    expect(result.success).toBe(false);
    expect(result.error).toBe('native_worldbook_trigger_restore_failed');
    expect(result.restore.skipped).toBe(0);
    expect(result.restore.failed).toBe(1);
  });

  it('setAgentWorldbookMode 在状态条目写入失败时不执行 takeover 或 restore', async () => {
    mockWriteControl.mockResolvedValue(writeResult('agent', false, 'no_config_host_book'));
    const api = createAgentWorldbookApi({} as any);

    const result = await api.setAgentWorldbookMode('agent');

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: 'no_config_host_book',
      mode: 'agent',
    }));
    expect(mockTakeover).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('setAgentWorldbookMode 捕获非 Error 异常并返回结构化错误', async () => {
    mockWriteControl.mockRejectedValue({ message: 'write exploded' });
    const api = createAgentWorldbookApi({} as any);

    const result = await api.setAgentWorldbookMode('passive');

    expect(result).toEqual({ success: false, error: 'write exploded' });
  });

  it('runAgentWorldbookSkillify 默认执行 Skill 化并在有更新时同步 takeover 与 snapshot', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.runAgentWorldbookSkillify({ presetName: 'preset-a', maxConcurrency: 2 });

    expect(result.success).toBe(true);
    expect(mockRunSkillify).toHaveBeenCalledWith({ presetName: 'preset-a', maxConcurrency: 2 });
    expect(mockTakeover).toHaveBeenCalledTimes(1);
    expect(mockRefreshSnapshot).toHaveBeenCalledTimes(1);
    expect(mockTakeover.mock.invocationCallOrder[0]).toBeLessThan(
      mockRefreshSnapshot.mock.invocationCallOrder[0]);
    expect(result.skillify.updated).toBe(1);
    expect(result.takeover.failed).toBe(0);
    expect(result.snapshot).toEqual(defaultSnapshot);
  });

  it('runAgentWorldbookSkillify 在 updated=0 时不执行 takeover 同步', async () => {
    mockRunSkillify.mockResolvedValue({ totalCandidates: 1, updated: 0, skipped: 1, failed: 0, results: [] });
    const api = createAgentWorldbookApi({} as any);

    const result = await api.runAgentWorldbookSkillify();

    expect(result).toEqual({ success: true, skillify: { totalCandidates: 1, updated: 0, skipped: 1, failed: 0, results: [] } });
    expect(mockTakeover).not.toHaveBeenCalled();
    expect(mockRefreshSnapshot).not.toHaveBeenCalled();
  });

  it('runAgentWorldbookSkillify 支持 runTakeover=false 跳过接管同步且不传给 service', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.runAgentWorldbookSkillify({ runTakeover: false, overwriteManual: true });

    expect(result.success).toBe(true);
    expect(mockRunSkillify).toHaveBeenCalledWith({ overwriteManual: true });
    expect(mockTakeover).not.toHaveBeenCalled();
    expect(mockRefreshSnapshot).not.toHaveBeenCalled();
  });

  it('skillifyWorldbookEntries 未指定 bookNames 时复用当前剧情选择 Skill 化 API', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.skillifyWorldbookEntries({ runTakeover: false, overwriteManual: true });

    expect(result.success).toBe(true);
    expect(mockRunSkillify).toHaveBeenCalledWith({ overwriteManual: true });
    expect(mockSkillifyByBookNames).not.toHaveBeenCalled();
    expect(mockTakeover).not.toHaveBeenCalled();
    expect(mockRefreshSnapshot).not.toHaveBeenCalled();
  });

  it('skillifyWorldbookEntries 指定 bookNames 时调用指定世界书 Skill 化 service', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.skillifyWorldbookEntries({
      bookNames: ['BookA', 'BookB'],
      runTakeover: false,
      overwriteManual: true,
      selectedEntries: [{ bookName: 'BookA', uid: 1 }],
    });

    expect(result.success).toBe(true);
    expect(mockSkillifyByBookNames).toHaveBeenCalledWith(['BookA', 'BookB'], {
      overwriteManual: true,
      selectedEntries: [{ bookName: 'BookA', uid: 1 }],
    });
    expect(mockRunSkillify).not.toHaveBeenCalled();
    expect(mockTakeover).not.toHaveBeenCalled();
    expect(mockRefreshSnapshot).not.toHaveBeenCalled();
  });

  it('runAgentWorldbookSkillify 在 takeover 同步失败时返回 success=false 并保留结果', async () => {
    mockTakeover.mockResolvedValue({
      updated: true,
      reason: 'skill_takeover_failed',
      bookNames: ['主世界书'],
      selectionSignature: 'sig',
      totalCandidates: 1,
      disabled: 0,
      failed: 1,
      snapshot: { ...defaultSnapshot, active: false },
      updates: [],
    });
    const api = createAgentWorldbookApi({} as any);

    const result = await api.runAgentWorldbookSkillify();

    expect(result.success).toBe(false);
    expect(result.error).toBe('skill_takeover_failed');
    expect(result.skillify.updated).toBe(1);
    expect(result.takeover.failed).toBe(1);
  });

  it('runAgentWorldbookSkillify 在刷新 snapshot inactive 时返回 success=false', async () => {
    mockRefreshSnapshot.mockResolvedValue({ ...defaultSnapshot, active: false });
    const api = createAgentWorldbookApi({} as any);

    const result = await api.runAgentWorldbookSkillify();

    expect(result.success).toBe(false);
    expect(result.error).toBe('native_worldbook_trigger_disabled');
    expect(result.snapshot.active).toBe(false);
  });

  it('runAgentWorldbookSkillify 捕获异常并返回结构化错误', async () => {
    mockRunSkillify.mockRejectedValue(new Error('skillify exploded'));
    const api = createAgentWorldbookApi({} as any);

    const result = await api.runAgentWorldbookSkillify();

    expect(result).toEqual({ success: false, error: 'skillify exploded' });
  });

  it('saveAgentWorldbookSkillMeta 保存 Skill 元数据并透传 service 结果', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.saveAgentWorldbookSkillMeta('主世界书', 1, { description: 'desc' }, 'agent-skillify');

    expect(result).toEqual({ success: true, result: { updated: true, entry: { uid: 1, comment: 'meta' } } });
    expect(mockSaveMeta).toHaveBeenCalledWith('主世界书', 1, { description: 'desc' }, 'agent-skillify');
  });

  it('saveAgentWorldbookSkillMeta 在未变化时仍返回成功业务结果', async () => {
    mockSaveMeta.mockResolvedValue({ updated: false, reason: '世界书 Skill 元数据未变化', entry: { uid: 1 } });
    const api = createAgentWorldbookApi({} as any);

    const result = await api.saveAgentWorldbookSkillMeta('主世界书', 1, { description: 'desc' });

    expect(result.success).toBe(true);
    expect(result.result.updated).toBe(false);
    expect(result.result.reason).toBe('世界书 Skill 元数据未变化');
    expect(mockSaveMeta).toHaveBeenCalledWith('主世界书', 1, { description: 'desc' }, 'manual');
  });

  it('saveAgentWorldbookSkillMeta 拒绝非法 updatedBy 且不调用 service', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.saveAgentWorldbookSkillMeta('主世界书', 1, {}, 'system');

    expect(result.success).toBe(false);
    expect(result.error).toContain('manual 或 agent-skillify');
    expect(mockSaveMeta).not.toHaveBeenCalled();
  });

  it('saveWorldbookEntrySkillMeta 作为计划名别名支持 options.updatedBy', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.saveWorldbookEntrySkillMeta('主世界书', 1, { description: 'desc' }, { updatedBy: 'agent-skillify' });

    expect(result).toEqual({ success: true, result: { updated: true, entry: { uid: 1, comment: 'meta' } } });
    expect(mockSaveMeta).toHaveBeenCalledWith('主世界书', 1, { description: 'desc' }, 'agent-skillify');
  });

  it('deleteAgentWorldbookSkillMeta 删除 Skill 元数据并允许无元数据业务结果', async () => {
    mockDeleteMeta.mockResolvedValue({ updated: false, reason: '世界书条目没有 Skill 元数据', entry: { uid: 1 } });
    const api = createAgentWorldbookApi({} as any);

    const result = await api.deleteAgentWorldbookSkillMeta('主世界书', 1);

    expect(result.success).toBe(true);
    expect(result.result.updated).toBe(false);
    expect(result.result.reason).toBe('世界书条目没有 Skill 元数据');
    expect(mockDeleteMeta).toHaveBeenCalledWith('主世界书', 1);
  });

  it('deleteWorldbookEntrySkillMeta 作为计划名别名复用删除 API', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.deleteWorldbookEntrySkillMeta('主世界书', 1);

    expect(result.success).toBe(true);
    expect(result.result.updated).toBe(true);
    expect(mockDeleteMeta).toHaveBeenCalledWith('主世界书', 1);
  });

  it('clearAgentWorldbookSkillMetas 成功清理时返回 success=true', async () => {
    const api = createAgentWorldbookApi({} as any);

    const result = await api.clearAgentWorldbookSkillMetas(['主世界书']);

    expect(result).toEqual({
      success: true,
      error: undefined,
      result: { total: 1, cleared: 1, skipped: 0, failed: 0, errors: [] },
    });
    expect(mockClearMeta).toHaveBeenCalledWith(['主世界书']);
  });

  it('clearAgentWorldbookSkillMetas 含 failed/errors 时返回 success=false 并透传详情', async () => {
    mockClearMeta.mockResolvedValue({
      total: 2,
      cleared: 1,
      skipped: 0,
      failed: 1,
      errors: [{ bookName: '主世界书', uid: 2, reason: 'write failed' }],
    });
    const api = createAgentWorldbookApi({} as any);

    const result = await api.clearAgentWorldbookSkillMetas(['主世界书']);

    expect(result.success).toBe(false);
    expect(result.error).toBe('清除 Agent 世界书 Skill 元数据未完全完成。');
    expect(result.result.errors[0].reason).toBe('write failed');
  });

  it('clearAgentWorldbookSkillMetas 在 failed=0 但 errors 非空时仍返回 success=false', async () => {
    mockClearMeta.mockResolvedValue({
      total: 1,
      cleared: 1,
      skipped: 0,
      failed: 0,
      errors: [{ bookName: '主世界书', uid: 1, reason: 'unexpected warning' }],
    });
    const api = createAgentWorldbookApi({} as any);

    const result = await api.clearAgentWorldbookSkillMetas(['主世界书']);

    expect(result.success).toBe(false);
    expect(result.error).toBe('清除 Agent 世界书 Skill 元数据未完全完成。');
    expect(result.result.failed).toBe(0);
    expect(result.result.errors[0].reason).toBe('unexpected warning');
  });
});
