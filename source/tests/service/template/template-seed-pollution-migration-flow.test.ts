/**
 * seed 污染迁移 prepare / commit / rollback 流程（块 6 复审 R6-09）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chatRef, guideSetter } = vi.hoisted(() => ({
  chatRef: { current: [] as any[] },
  guideSetter: vi.fn(),
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => chatRef.current,
  saveChatToHostStrict_ACU: vi.fn(async () => {}),
}));
vi.mock('../../../src/service/table/table-write-transaction', () => ({
  runTableWriteTransaction_ACU: vi.fn(async (_opts: any, fn: any) => fn({ runCommit: (inner: any) => inner() })),
}));
vi.mock('../../../src/service/table/table-storage-strategy', () => ({
  reloadStorageProvider: vi.fn(async () => {}),
  didSqliteFallbackAfterReload_ACU: vi.fn(() => false),
}));
vi.mock('../../../src/service/table/storage-mode', () => ({
  getCurrentStorageMode: vi.fn(() => 'native'),
}));
vi.mock('../../../src/data/storage/chat-history', () => ({
  CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU: 'seedRows',
  getChatSheetGuideContainer_ACU: (chat: any[]) => chat[0]?.guide ?? null,
  getChatScopedConfigContainer_ACU: (chat: any[]) => chat[0]?.scoped ?? null,
  setChatSheetGuideContainer_ACU: (chat: any[], value: any) => { chat[0].guide = value; },
  setChatScopedConfigContainer_ACU: (chat: any[], value: any) => { chat[0].scoped = value; },
}));
vi.mock('../../../src/service/template/chat-scope', () => ({
  getChatSheetGuideDataForIsolationKey_ACU: (key: string) => chatRef.current[0]?.guide?.tags?.[key]?.data ?? null,
  setChatSheetGuideDataForIsolationKey_ACU: guideSetter,
}));

import { _set_currentJsonTableData_ACU } from '../../../src/service/runtime/state-manager';
import { commitSeedMigration_ACU, prepareSeedMigration_ACU, rollbackSeedMigration_ACU } from '../../../src/service/template/template-seed-pollution-migration';

const DDL = 'CREATE TABLE t (\n  row_id INTEGER PRIMARY KEY,\n  code TEXT UNIQUE,\n  name TEXT\n);';

function makeChat() {
  const guideData = {
    sheet_x: {
      uid: 'sheet_x', name: '测试表', content: [['row_id', 'code', 'name']],
      sourceData: { ddl: DDL },
      seedRows: [['1', 'C1', '铁剑'], ['2', 'C2', '卷轴']],
    },
  };
  return [{ is_user: false, mes: '开场', guide: { version: 1, tags: { k: { data: guideData } } }, scoped: { version: 1, marker: 'before' } }];
}

beforeEach(() => {
  chatRef.current = makeChat();
  guideSetter.mockReset();
  guideSetter.mockImplementation((key: string, data: any) => {
    chatRef.current[0].guide = { version: 1, tags: { [key]: { data } } };
    chatRef.current[0].scoped = { version: 1, marker: 'after' };
    return true;
  });
  // 当前运行时数据里 C1 已物化（与 seed 同业务键）。
  _set_currentJsonTableData_ACU({ sheet_x: { content: [['row_id', 'code', 'name'], ['1', 'C1', '铁剑']] } });
});

describe('块 6 复审：seed 迁移流程', () => {
  it('与运行时数据同业务键的 seed 被识别为已物化残留', () => {
    const result = prepareSeedMigration_ACU({ isolationKey: 'k' });
    expect(result.status).toBe('plan_ready');
    if (result.status !== 'plan_ready') return;
    expect(result.plan.actions[0]).toMatchObject({ kind: 'drop_duplicate_seed_rows', droppedKeys: ['C1'] });
  });

  it('提交不强制把聊天改成 chat_override（由现有作用域决定）', async () => {
    const prepared = prepareSeedMigration_ACU({ isolationKey: 'k' });
    if (prepared.status !== 'plan_ready') throw new Error('plan not ready');
    const result = await commitSeedMigration_ACU(prepared.plan.planId, { confirm: true });
    expect(result.status).toBe('committed');
    expect(guideSetter).toHaveBeenCalledWith('k', expect.anything(), expect.objectContaining({ syncTemplateScope: false }));
  });

  it('回滚已提交的迁移只恢复 guide 与作用域配置，不清掉之后新增的楼层', async () => {
    const prepared = prepareSeedMigration_ACU({ isolationKey: 'k' });
    if (prepared.status !== 'plan_ready') throw new Error('plan not ready');
    expect((await commitSeedMigration_ACU(prepared.plan.planId, { confirm: true })).status).toBe('committed');
    chatRef.current.push({ is_user: true, mes: '迁移之后的新消息' });

    const result = await rollbackSeedMigration_ACU(prepared.plan.planId);

    expect(result.status).toBe('committed');
    expect(chatRef.current).toHaveLength(2);
    expect(chatRef.current[1].mes).toBe('迁移之后的新消息');
    expect(chatRef.current[0].scoped.marker).toBe('before');
    expect(chatRef.current[0].guide.tags.k.data.sheet_x.seedRows).toHaveLength(2);
  });

  it('未提交的计划回滚时不改动聊天', async () => {
    const prepared = prepareSeedMigration_ACU({ isolationKey: 'k' });
    if (prepared.status !== 'plan_ready') throw new Error('plan not ready');
    chatRef.current.push({ is_user: true, mes: '准备之后的新消息' });
    const result = await rollbackSeedMigration_ACU(prepared.plan.planId);
    expect(result.status).toBe('commit_failed_rolled_back');
    expect(chatRef.current).toHaveLength(2);
  });
});
