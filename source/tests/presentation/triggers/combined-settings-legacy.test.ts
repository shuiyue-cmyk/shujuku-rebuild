/**
 * R9-07：旧公开 API 的合并配置导入/导出。
 * - 导出不再读已停用的旧弹窗 DOM（恒为空导致永远「没有可导出的提示词」），改读设置；
 * - 导入不再访问已停用弹窗的引用（抛错导致半截导入），模板应用失败时回滚已写入的设置。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  applyImport: vi.fn(),
  applyTemplate: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../../src/service/settings/settings-service', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  applyCombinedSettingsImport_ACU: h.applyImport,
  saveSettings_ACU: vi.fn(() => ({ saved: true })),
}));
vi.mock('../../../src/service/template/template-preset-service', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  applyTemplateSnapshotToScope_ACU: h.applyTemplate,
}));
vi.mock('../../../src/presentation/theme/toast', () => ({ showToastr_ACU: h.toast }));

import { settings_ACU } from '../../../src/service/runtime/state-manager';
import { importCombinedSettings_ACU } from '../../../src/presentation/triggers/data-admin-ui';
import { exportCombinedSettings_ACU } from '../../../src/presentation/triggers/update-trigger';

const PAYLOAD = {
  prompt: [{ role: 'USER', content: '导入提示词' }],
  template: { mate: { type: 'chatSheets', version: 1 }, sheet_a: { name: 'A', content: [['row_id', 'c']], sourceData: {} } },
  mergeSummaryPrompt: 'm',
  mergeTargetCount: 9,
};

async function runImport(payload: unknown): Promise<void> {
  const realCreate = document.createElement.bind(document);
  let input: any = null;
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
    const element = realCreate(tag);
    if (tag === 'input') { input = element; (element as any).click = () => {}; }
    return element;
  });
  importCombinedSettings_ACU();
  spy.mockRestore();
  input.onchange({ target: { files: [new File([JSON.stringify(payload)], 'c.json', { type: 'application/json' })] } });
  await vi.waitFor(() => expect(h.toast).toHaveBeenCalled());
  await new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  h.applyImport.mockReset();
  h.applyTemplate.mockReset();
  h.toast.mockReset();
  (settings_ACU as any).charCardPrompt = [{ role: 'USER', content: '原始提示词' }];
  (settings_ACU as any).mergeTargetCount = 3;
});

describe('R9-07 旧公开 API 合并配置', () => {
  it('导出读取设置里的提示词，成功生成文件', () => {
    (URL as any).createObjectURL = vi.fn(() => 'blob:x');
    (URL as any).revokeObjectURL = vi.fn();

    expect(exportCombinedSettings_ACU()).toBe(true);
    expect(h.toast).toHaveBeenCalledWith('success', expect.stringContaining('导出'));
  });

  it('R10A-22 / R9-12：导出不再带已停用的合并总结与自动合并字段', async () => {
    const { buildCombinedSettingsExportPayload_ACU } = await import('../../../src/service/settings/combined-settings-transfer');
    (settings_ACU as any).autoMergeEnabled = true;
    const payload = buildCombinedSettingsExportPayload_ACU();
    expect(Object.keys(payload).filter(key => /^(auto)?merge/i.test(key))).toEqual([]);
    expect(payload.prompt).toEqual([{ role: 'USER', content: '原始提示词' }]);
  });

  it('导入成功时设置与模板都应用，只有成功提示', async () => {
    h.applyImport.mockImplementation(() => ['charCardPrompt', 'mergeSummaryPrompt', 'mergeTargetCount']);
    h.applyTemplate.mockResolvedValue({ saved: true });

    await runImport(PAYLOAD);

    expect(h.applyImport).toHaveBeenCalledOnce();
    expect(h.applyTemplate).toHaveBeenCalledOnce();
    expect(h.toast.mock.calls.some(call => call[0] === 'error')).toBe(false);
    expect(h.toast).toHaveBeenCalledWith('success', expect.stringContaining('合并配置已成功导入'));
  });

  it('模板应用失败时回滚已写入的设置并报错，不先报成功', async () => {
    h.applyImport.mockImplementation(() => {
      (settings_ACU as any).charCardPrompt = PAYLOAD.prompt;
      (settings_ACU as any).mergeTargetCount = 9;
      return ['charCardPrompt', 'mergeTargetCount'];
    });
    h.applyTemplate.mockResolvedValue({ saved: false, error: '模拟模板 blocker' });

    await runImport(PAYLOAD);

    expect((settings_ACU as any).charCardPrompt).toEqual([{ role: 'USER', content: '原始提示词' }]);
    expect((settings_ACU as any).mergeTargetCount).toBe(3);
    expect(h.toast.mock.calls.some(call => call[0] === 'success')).toBe(false);
    expect(h.toast).toHaveBeenCalledWith('error', expect.stringContaining('回滚'), expect.anything());
  });
});
