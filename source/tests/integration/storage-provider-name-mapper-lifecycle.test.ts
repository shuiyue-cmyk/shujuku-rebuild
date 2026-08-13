/**
 * tests/integration/storage-provider-name-mapper-lifecycle.test.ts
 *
 * 覆盖 Provider 置换期间全局 NameMapper 的所有权语义。
 *
 * 这里必须使用真实 name-mapper 与真实 SqlTableService.dispose()：
 * tests/service/table/sql-table-service.test.ts 把 name-mapper 整体 mock 掉，
 * 只能断言调用次数，无法证明 binding 最终是 bound 还是 unbound，
 * 而本次事故的坏态恰好只体现在 binding 上。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/shared/utils', () => ({
  logDebug_ACU: vi.fn(),
  logWarn_ACU: vi.fn(),
  logError_ACU: vi.fn(),
  hashUserInput_ACU: vi.fn((text: string) => (text ? 'mock-ddl-digest' : '')),
  isSummaryOrOutlineTable_ACU: vi.fn(() => false),
  parseTableTemplateJson_ACU: vi.fn(() => null),
  stripSeedRowsFromTemplate_ACU: vi.fn((obj: any) => obj),
}));

let mockCurrentJsonTableData: any = null;
vi.mock('../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return mockCurrentJsonTableData; },
  _set_currentJsonTableData_ACU: vi.fn((v: any) => { mockCurrentJsonTableData = v; }),
}));

vi.mock('../../src/service/table/table-service', () => ({
  saveIndependentTableToChatHistory_ACU: vi.fn().mockResolvedValue({ saved: true }),
}));

vi.mock('../../src/service/runtime/helpers-data-merge', () => ({
  mergeAllIndependentTables_ACU: vi.fn().mockResolvedValue(null),
  seedGreetingLocalDataFromTemplate_ACU: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../src/service/template/chat-scope', () => ({
  getEffectiveSeedRowsForSheet_ACU: vi.fn(() => []),
  getCurrentChatTemplateScopeState_ACU: vi.fn(() => null),
  shouldUseInitialSeedRows_ACU: vi.fn(() => false),
  ensureStableRowIdsForSheetContent_ACU: vi.fn((content: any) => content),
  sanitizeTemplateSnapshotForChat_ACU: vi.fn(() => null),
}));

vi.mock('../../src/service/template/template-preset-service', () => ({
  getTemplatePreset_ACU: vi.fn(() => null),
}));

import { SqlTableService } from '../../src/service/table/sql-table-service';
import {
  disposeGlobalNameMapper,
  getGlobalNameMapperOwnershipSnapshot_ACU,
  getGlobalNameMapperStatus_ACU,
  getNameMapper,
} from '../../src/service/runtime/template-vars/name-mapper';

const INVENTORY_DDL = `CREATE TABLE inventory ( -- 背包物品表
  row_id INTEGER PRIMARY KEY, -- 行号
  item_name TEXT NOT NULL, -- 物品名称
  quantity INTEGER DEFAULT 1 -- 数量
);`;

function buildTableData_ACU(rows: string[][]): any {
  return {
    mate: {
      type: 'acu',
      version: 1,
      updateConfigUiSentinel: 0,
      globalInjectionConfig: {
        readableEntryPlacement: { position: '', depth: 0, order: 0 },
        wrapperPlacement: { position: '', depth: 0, order: 0 },
      },
    },
    sheet_0: {
      uid: 'inventory',
      name: 'inventory',
      sourceData: { note: '', initNode: '', deleteNode: '', updateNode: '', insertNode: '', ddl: INVENTORY_DDL },
      content: [['row_id', 'item_name', 'quantity'], ...rows],
      updateConfig: { uiSentinel: 0, contextDepth: 0, updateFrequency: 0, batchSize: 0, skipFloors: 0 },
      exportConfig: {},
      orderNo: 0,
    },
  };
}

describe('Provider 置换期间的 NameMapper 所有权', () => {
  beforeEach(() => {
    mockCurrentJsonTableData = null;
    disposeGlobalNameMapper();
  });

  it('新 Provider 发布映射后，旧 Provider 的迟到 dispose 不得把映射清成 unbound', async () => {
    const providerA = new SqlTableService();
    const loadA = await providerA.loadFromData(buildTableData_ACU([['1', '铁剑', '3']]));
    expect(loadA.loaded).toBe(true);
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('bound');

    // CHAT_CHANGED 延迟任务重载：新实例完成 hydrate 并发布映射。
    const providerB = new SqlTableService();
    const loadB = await providerB.loadFromData(buildTableData_ACU([['1', '治疗药水', '5']]));
    expect(loadB.loaded).toBe(true);

    const boundStatusAfterB = getGlobalNameMapperStatus_ACU();
    const ownerAfterB = getGlobalNameMapperOwnershipSnapshot_ACU();
    expect(boundStatusAfterB.binding).toBe('bound');

    // replaceActiveProvider_ACU 先切换 active 引用，再销毁旧实例。
    providerA.dispose();

    expect(getGlobalNameMapperStatus_ACU()).toEqual(boundStatusAfterB);
    expect(getGlobalNameMapperOwnershipSnapshot_ACU()).toEqual(ownerAfterB);
    // 映射仍可用：物理表名与中文列名解析不受旧实例销毁影响。
    expect(getNameMapper().resolveTableName('inventory')).toBe('inventory');
    expect(getNameMapper().resolveColumnName('inventory', '物品名称')).toBe('item_name');

    providerB.dispose();
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('unbound');
  });

  it('陈旧候选在更新实例发布后完成 hydrate，不得夺取所有权，其 dispose 也不得清空映射', async () => {
    const staleCandidate = new SqlTableService();
    const winner = new SqlTableService();

    await winner.loadFromData(buildTableData_ACU([['1', '治疗药水', '5']]));
    const winnerOwner = getGlobalNameMapperOwnershipSnapshot_ACU();
    expect(winnerOwner.binding).toBe('bound');

    // 更早创建的候选晚到完成：不能覆盖更新发布者。
    await staleCandidate.loadFromData(buildTableData_ACU([['1', '铁剑', '3']]));
    expect(getGlobalNameMapperOwnershipSnapshot_ACU()).toEqual(winnerOwner);

    staleCandidate.dispose();
    expect(getGlobalNameMapperOwnershipSnapshot_ACU()).toEqual(winnerOwner);
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('bound');
  });

  it('空 runtime 由当前实例发布 empty_schema，旧实例 dispose 不得将其降级为 unbound', async () => {
    const providerA = new SqlTableService();
    await providerA.loadFromData(buildTableData_ACU([['1', '铁剑', '3']]));

    const providerB = new SqlTableService();
    const loadB = await providerB.loadFromData(null);
    expect(loadB.source).toBe('empty');
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('empty_schema');

    providerA.dispose();

    expect(getGlobalNameMapperStatus_ACU().binding).toBe('empty_schema');
  });

  it('当前实例自行重载时仍按新 schema 重新发布映射', async () => {
    const provider = new SqlTableService();
    await provider.loadFromData(buildTableData_ACU([['1', '铁剑', '3']]));
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('bound');

    await provider.loadFromData(null);
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('empty_schema');

    await provider.loadFromData(buildTableData_ACU([['1', '治疗药水', '5']]));
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('bound');
    expect(getNameMapper().resolveColumnName('inventory', '数量')).toBe('quantity');

    provider.dispose();
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('unbound');
  });

  it('replaceAllData 成功后由本实例重新发布映射，失败时不留下 bound 假象', async () => {
    const provider = new SqlTableService();
    await provider.loadFromData(buildTableData_ACU([['1', '铁剑', '3']]));

    const replaced = await provider.replaceAllData(buildTableData_ACU([['1', '治疗药水', '5']]));
    expect(replaced.success).toBe(true);
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('bound');
    expect(getNameMapper().resolveColumnName('inventory', '物品名称')).toBe('item_name');

    // 非法行结构导致替换失败：必须真的失败，且不得保留可信映射或 ready 假象。
    const brokenData = buildTableData_ACU([]);
    brokenData.sheet_0.content = [['row_id', 'item_name', 'quantity'], 'not-an-array'];
    const failed = await provider.replaceAllData(brokenData);

    expect(failed.success).toBe(false);
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('unbound');
    expect(provider.isReady()).toBe(false);
  });

  it('restoreRuntimeSnapshot 恢复后重新发布映射，且旧实例无法清除', async () => {
    const provider = new SqlTableService();
    await provider.loadFromData(buildTableData_ACU([['1', '铁剑', '3']]));
    const snapshot = provider.createRuntimeSnapshot();
    expect(snapshot).toBeInstanceOf(Uint8Array);

    const stalePeer = new SqlTableService();

    await provider.restoreRuntimeSnapshot(snapshot as Uint8Array);
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('bound');

    // stalePeer 从未发布过映射，它的销毁不得影响当前 runtime。
    stalePeer.dispose();
    expect(getGlobalNameMapperStatus_ACU().binding).toBe('bound');
  });

  it('快照恢复时映射发布被更新 runtime 拒绝，不得宣称恢复成功', async () => {
    const provider = new SqlTableService();
    await provider.loadFromData(buildTableData_ACU([['1', '铁剑', '3']]));
    const snapshot = provider.createRuntimeSnapshot() as Uint8Array;

    // 更新的 runtime 接管发布权后，旧实例的恢复不再拥有发布资格。
    const newer = new SqlTableService();
    await newer.loadFromData(buildTableData_ACU([['1', '治疗药水', '5']]));
    const ownerAfterNewer = getGlobalNameMapperOwnershipSnapshot_ACU();

    await expect(provider.restoreRuntimeSnapshot(snapshot)).rejects.toThrow('name_mapper_publish_rejected');
    expect(provider.isReady()).toBe(false);
    expect(getGlobalNameMapperOwnershipSnapshot_ACU()).toEqual(ownerAfterNewer);
  });

  it('快照恢复后无法导出 canonical 视图时失败，且不残留半成功状态', async () => {
    const provider = new SqlTableService();
    await provider.loadFromData(buildTableData_ACU([['1', '铁剑', '3']]));
    const snapshot = provider.createRuntimeSnapshot() as Uint8Array;
    const viewBefore = mockCurrentJsonTableData;

    // 导出失败时残留的旧 JSON 与恢复后的 engine 不同源，不能拿它发布映射。
    const syncBridge = (provider as any).syncBridge;
    const exportSpy = vi.spyOn(syncBridge, 'exportToTableData').mockImplementation(() => {
      throw new Error('export failed');
    });

    await expect(provider.restoreRuntimeSnapshot(snapshot)).rejects.toThrow('sqlite_snapshot_restore_failed');

    expect(provider.isReady()).toBe(false);
    expect(mockCurrentJsonTableData).toBe(viewBefore);
    exportSpy.mockRestore();
  });

  it('恢复等待期间他人发布了新视图且本实例导出失败时，不得把该更新回退成旧值', async () => {
    const provider = new SqlTableService();
    await provider.loadFromData(buildTableData_ACU([['1', '铁剑', '3']]));
    const snapshot = provider.createRuntimeSnapshot() as Uint8Array;

    // 第三方视图必须在 await 期间产生，且与本实例进入恢复时捕获的旧值不同，
    // 否则「无条件写回旧值」这一回归无法被区分出来。
    const thirdPartyView = buildTableData_ACU([['1', '第三方', '9']]);
    const engine = (provider as any).engine;
    const loadSpy = vi.spyOn(engine, 'loadFromBinary').mockImplementation(async () => {
      mockCurrentJsonTableData = thirdPartyView;
    });
    // 本实例导出失败：它没有成功写入共享视图，因此没有回退资格。
    const exportSpy = vi.spyOn((provider as any).syncBridge, 'exportToTableData').mockImplementation(() => {
      throw new Error('export failed');
    });

    await expect(provider.restoreRuntimeSnapshot(snapshot)).rejects.toThrow('sqlite_snapshot_restore_failed');

    expect(mockCurrentJsonTableData).toBe(thirdPartyView);
    expect(provider.isReady()).toBe(false);
    loadSpy.mockRestore();
    exportSpy.mockRestore();
  });

  it('新实例 hydrate 失败时不得夺取所有权，活跃 runtime 的映射保持可用', async () => {
    const provider = new SqlTableService();
    await provider.loadFromData(buildTableData_ACU([['1', '铁剑', '3']]));
    const ownerBefore = getGlobalNameMapperOwnershipSnapshot_ACU();
    expect(ownerBefore.binding).toBe('bound');

    const failing = new SqlTableService();
    // 必须构造真正会在 hydrate 阶段失败的输入：存在真实数据行，但行结构非法。
    // 若只把 content 写成非数组，会被判定为「无数据行」而走合法的空 schema 分支。
    const brokenData = buildTableData_ACU([]);
    brokenData.sheet_0.content = [['row_id', 'item_name', 'quantity'], 'not-an-array'];
    const result = await failing.loadFromData(brokenData);

    expect(result.loaded).toBe(false);
    expect(result.error).toContain('sqlite_hydrate_failed');
    // 旧 runtime 仍活着并合法持有映射，失败候选既不得夺权也不得清空它。
    expect(getGlobalNameMapperOwnershipSnapshot_ACU()).toEqual(ownerBefore);
    expect(getNameMapper().resolveColumnName('inventory', '物品名称')).toBe('item_name');

    failing.dispose();
    expect(getGlobalNameMapperOwnershipSnapshot_ACU()).toEqual(ownerBefore);
  });
});
