/**
 * 世界书暴露范围收窄（TT 移植上游 86be318e 的可拆余料）判别测试：
 * Agent 世界书快照只屏蔽「纪要 + 纪要索引（含数字分片）」，其余已启用条目
 * （CustomExport 表格导出、OutlineTable 载体、重要人物条目等）放行；
 * enabled / 勾选表 / 屏蔽名单三道 P1 加固检查必须原样生效。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostDoubles = vi.hoisted(() => ({
  readConfig: vi.fn(() => ({ source: 'manual', manualSelection: ['设定集'] })),
  entriesByBook: {} as Record<string, unknown[]>,
}));

vi.mock('../../../../src/service/settings/settings-readers', () => ({
  getCurrentWorldbookConfig_ACU: hostDoubles.readConfig,
}));
vi.mock('../../../../src/service/worldbook/injection-engine-state', () => ({
  getIsolationPrefix_ACU: () => 'ACU-[chat-a]-',
  getInjectionTargetLorebook_ACU: () => '纪要书',
}));
vi.mock('../../../../src/service/worldbook/pipeline', () => ({
  getLorebookEntriesByNames_ACU: vi.fn(async () => hostDoubles.entriesByBook),
  getWorldbookEntryKeywords_ACU: (entry: Record<string, unknown>) => (Array.isArray(entry.keys) ? entry.keys as string[] : []),
  buildCombinedWorldbookContentByStrategy_ACU: vi.fn(),
}));
vi.mock('../../../../src/shared/utils', () => ({
  // 与真实实现同构的简化判据：命中名单即屏蔽，用来验证快照仍走 isEntryBlocked_ACU。
  isEntryBlocked_ACU: (entry: Record<string, unknown>) => String(entry?.comment ?? '').includes('BLOCKED'),
  logWarn_ACU: vi.fn(),
}));
vi.mock('../../../../src/data/gateways/character-gateway', () => ({
  getCurrentCharacterWorldbookBinding_ACU: async () => ({ orderedNames: [] }),
}));
vi.mock('../../../../src/data/gateways/worldbook-gateway', () => ({
  getActiveWorldbookNamesForFill_ACU: async () => [],
}));
vi.mock('../../../../src/service/continuation/agent/agent-token-budget', () => ({
  countAgentTokens_ACU: async (content: string) => content.length,
}));

import {
  loadAgentWorldbookSnapshot_ACU,
  renderAgentWorldbookCatalog_ACU,
  renderAgentWorldbookEntries_ACU,
  renderAgentWorldbookHits_ACU,
} from '../../../../src/service/continuation/agent/agent-worldbook-read';

function entry_ACU(uid: string, comment: string, content: string, patch: Record<string, unknown> = {}) {
  return { uid, enabled: true, comment, content, type: 'keyword', keys: [], ...patch };
}

function seedEntries_ACU(): void {
  hostDoubles.entriesByBook = {
    '设定集': [
      entry_ACU('1', 'ACU-[chat-a]-晶屑设定', '黑色晶屑是禁区核心的碎片。', { keys: ['晶屑'] }),
      // 旧总结残留：必须继续屏蔽。
      entry_ACU('2', 'ACU-[chat-a]-总结条目1', '旧总结正文。', { type: 'constant' }),
      entry_ACU('3', 'ACU-[chat-a]-小总结条目2', '旧小总结正文。', { type: 'constant' }),
      // 纪要索引与数字分片：由事件概览/快照单独呈现，世界书域必须继续屏蔽。
      entry_ACU('4', 'ACU-[chat-a]-TavernDB-ACU-CustomExport-纪要索引', '| 概览 | 编码索引 |', { type: 'constant', prevent_recursion: true }),
      entry_ACU('5', 'ACU-[chat-a]-TavernDB-ACU-CustomExport-纪要索引-2', '索引分片 2。', { type: 'constant' }),
      // 判据精确：非数字后缀不是索引分片，不该误屏蔽。
      entry_ACU('6', 'ACU-[chat-a]-TavernDB-ACU-CustomExport-纪要索引-说明', '写给人看的说明段。', { type: 'constant' }),
      // CustomExport 与其余插件载体条目按上游语义放行。
      entry_ACU('7', 'ACU-[chat-a]-TavernDB-ACU-CustomExport-角色表-1', '阿澜是主角。', { type: 'constant' }),
      entry_ACU('8', 'ACU-[chat-a]-TavernDB-ACU-OutlineTable-1', '阶段大纲载体。', { type: 'constant' }),
      entry_ACU('9', 'ACU-[chat-a]-TavernDB-ACU-CustomExport-纪要-3', 'AM0003｜守门人退开一步。', { keys: ['AM0003'] }),
      entry_ACU('10', 'ACU-[chat-a]-重要人物条目3', '守门人世代驻守铁门。', { keys: ['守门人'] }),
      // 三道既有检查各自独立验证：未启用 / 未勾选 / 命中屏蔽名单。
      entry_ACU('11', 'ACU-[chat-a]-未启用的设定', '不该出现。', { enabled: false }),
      entry_ACU('12', 'ACU-[chat-a]-BLOCKED-规则说明', '命中屏蔽名单。', { type: 'constant' }),
      entry_ACU('13', 'ACU-[chat-a]-未勾选的设定', '不在勾选表里。', { type: 'constant' }),
    ],
  };
}

describe('Agent 世界书快照暴露范围收窄（TT）', () => {
  beforeEach(() => {
    hostDoubles.readConfig.mockReturnValue({
      source: 'manual',
      manualSelection: ['设定集'],
      // 12 命中屏蔽名单且未被显式勾选（R7-03：显式勾选才可越过屏蔽词）。
      enabledEntries: { '设定集': ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'] },
    });
    seedEntries_ACU();
  });

  it('R7-03：命中屏蔽名单但被用户显式勾选的条目进快照', async () => {
    hostDoubles.readConfig.mockReturnValue({
      source: 'manual',
      manualSelection: ['设定集'],
      enabledEntries: { '设定集': ['1', '12'] },
    });
    const snapshot = await loadAgentWorldbookSnapshot_ACU();
    expect(snapshot.entries.map(item => item.uid)).toEqual(['1', '12']);
  });

  it('只屏蔽纪要与纪要索引：CustomExport 表格导出、大纲载体、重要人物条目全部进快照', async () => {
    const snapshot = await loadAgentWorldbookSnapshot_ACU();
    expect(snapshot.available).toBe(true);
    const uids = snapshot.entries.map(item => item.uid);
    // 纪要（旧总结残留）与纪要索引及其数字分片必须仍被屏蔽。
    expect(uids).not.toContain('2');
    expect(uids).not.toContain('3');
    expect(uids).not.toContain('4');
    expect(uids).not.toContain('5');
    // 其余已启用条目放行；判据精确不误伤非数字后缀。
    expect(uids).toEqual(['1', '6', '7', '8', '9', '10']);
    // 三道既有检查原样生效：未启用、未勾选、命中屏蔽名单都不进快照。
    expect(uids).not.toContain('11');
    expect(uids).not.toContain('12');
    expect(uids).not.toContain('13');
  });

  it('勾选表缺 uid 的条目依旧不进快照（P1 加固不弱化）', async () => {
    hostDoubles.readConfig.mockReturnValue({
      source: 'manual',
      manualSelection: ['设定集'],
      enabledEntries: { '设定集': ['1', '7', '10'] },
    });
    const snapshot = await loadAgentWorldbookSnapshot_ACU();
    expect(snapshot.entries.map(item => item.uid)).toEqual(['1', '7', '10']);
  });

  it('目录、命中提示与精读都不给纪要与纪要索引任何出口', async () => {
    const snapshot = await loadAgentWorldbookSnapshot_ACU();
    const catalog = renderAgentWorldbookCatalog_ACU(snapshot);
    expect(catalog).toContain('$WORLDBOOK:设定集:7');
    expect(catalog).not.toContain('$WORLDBOOK:设定集:4');
    expect(catalog).not.toContain('$WORLDBOOK:设定集:5');
    expect(catalog).not.toContain('$WORLDBOOK:设定集:2');

    // 纪要索引及其数字分片由事件概览/快照单独呈现，命中提示里不能给它们读口；
    // 判据按上游精确正则：非数字后缀的说明段按普通条目放行（uid 6），故用地址与旧文判别，不用「纪要索引」子串误伤。
    const hits = renderAgentWorldbookHits_ACU(snapshot, '主角捡起一枚晶屑端详。');
    expect(hits).not.toContain('$WORLDBOOK:设定集:4');
    expect(hits).not.toContain('$WORLDBOOK:设定集:5');
    expect(hits).not.toContain('$WORLDBOOK:设定集:2');
    expect(hits).not.toContain('总结条目');

    // 精读按 uid 取全文：被屏蔽条目回灌「不存在于已启用条目」，CustomExport 条目可读。
    const denied = renderAgentWorldbookEntries_ACU(snapshot, '设定集', ['4', '5']);
    expect(denied).toContain('以下 uid 不存在于「设定集」的已启用条目中：4、5');
    const granted = renderAgentWorldbookEntries_ACU(snapshot, '设定集', ['7']);
    expect(granted).toContain('阿澜是主角。');
  });
});
