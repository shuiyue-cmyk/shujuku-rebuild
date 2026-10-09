/**
 * R10A-14：表名改动随模板提交成功后才迁移表级 API 预设覆盖。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  settings: { tableApiPresetOverridesByName: {} as Record<string, string> },
  save: vi.fn(() => ({ saved: true, storageType: 'memory' })),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: h.settings }));
vi.mock('../../../src/service/settings/settings-service', () => ({ saveSettings_ACU: h.save }));

import { migrateTableApiPresetOverridesForRenames_ACU } from '../../../src/presentation-v2/composables/visualizer/table-api-preset-rename';

beforeEach(() => {
  h.save.mockClear();
});

describe('migrateTableApiPresetOverridesForRenames_ACU', () => {
  it('按旧名→新名迁移，支持两表互换名字', () => {
    h.settings.tableApiPresetOverridesByName = { 甲: 'alpha', 乙: 'beta', 丙: 'gamma' };
    const base = { sheet_a: { name: '甲' }, sheet_b: { name: '乙' }, sheet_c: { name: '丙' } };
    const next = { sheet_a: { name: '乙' }, sheet_b: { name: '甲' }, sheet_c: { name: '丙' } };

    migrateTableApiPresetOverridesForRenames_ACU(base, next);

    expect(h.settings.tableApiPresetOverridesByName).toEqual({ 乙: 'alpha', 甲: 'beta', 丙: 'gamma' });
    expect(h.save).toHaveBeenCalledOnce();
  });

  it('新名撞上另一张未改名表的覆盖时不覆盖它，也不丢自己的', () => {
    h.settings.tableApiPresetOverridesByName = { 甲: 'alpha', 丙: 'gamma' };
    const base = { sheet_a: { name: '甲' }, sheet_c: { name: '丙' } };
    const next = { sheet_a: { name: '丙' }, sheet_c: { name: '丙' } };

    migrateTableApiPresetOverridesForRenames_ACU(base, next);

    expect(h.settings.tableApiPresetOverridesByName).toEqual({ 甲: 'alpha', 丙: 'gamma' });
  });
});
