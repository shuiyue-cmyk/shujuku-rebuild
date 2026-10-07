/**
 * 块 8 复审 R8-01：飞行模式启用/停用失败后的模板补偿不得落到切换后的聊天上。
 */
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => {
  const chatA: any[] = [{ is_user: false, mes: 'A0' }];
  const chatB: any[] = [{ is_user: false, mes: 'B0' }];
  return {
    chatA, chatB,
    chat: chatA as any[],
    chatId: 'chat-A',
    containers: new Map<any, any>(),
    data: null as any,
    applyCalls: [] as Array<{ chatId: string; source: string; hardDelete: boolean; sheetNames: string[] }>,
    saveCount: 0,
  };
});

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => h.chat,
  saveChatToHost_ACU: vi.fn(async () => {
    h.saveCount += 1;
    // 用户在飞行模式状态保存期间切到聊天 B
    if (h.saveCount === 1) { h.chat = h.chatB; h.chatId = 'chat-B'; }
  }),
}));
vi.mock('../../../src/data/storage/chat-history', () => ({
  getChatScopedConfigContainer_ACU: (chat: any) => h.containers.get(chat) || null,
  normalizeChatScopedConfigContainer_ACU: (v: any) => JSON.parse(JSON.stringify(v || { version: 1 })),
  setChatScopedConfigContainer_ACU: (chat: any, v: any) => { h.containers.set(chat, v); },
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return h.chatId; },
  get currentJsonTableData_ACU() { return h.data; },
  getCurrentIsolationKey_ACU: () => '',
}));
vi.mock('../../../src/service/runtime/helpers-table-lock', () => ({ deleteTableLocksForSheet_ACU: vi.fn(), setSpecialIndexLockEnabled_ACU: vi.fn() }));
vi.mock('../../../src/service/template/chat-scope/chat-scope-template', () => ({
  getCurrentChatTemplateScopeState_ACU: () => ({ templateStr: JSON.stringify(templateA()), presetName: 'A预设' }),
  getGlobalTemplateSnapshotForCurrentProfile_ACU: () => null,
}));
vi.mock('../../../src/service/template/template-preset-service', () => ({
  applyChatTemplateSnapshotWithReconciliation_ACU: vi.fn(async (template: any, options: any) => {
    h.applyCalls.push({
      chatId: h.chatId,
      source: options.source,
      hardDelete: options.hardDeleteMissingSheets === true,
      sheetNames: Object.values(template).map((s: any) => s?.name).filter(Boolean),
    });
    if (options.source === 'flight_mode_enable') {
      h.data = { ...h.data, sheet_da_zong_jie: { name: '大总结', content: [['row_id', '总结']] } };
    }
    return { saved: true };
  }),
}));

function sheet(name: string) {
  return { name, content: [['row_id', '事件']], sourceData: { ddl: '' }, updateConfig: {}, exportConfig: { enabled: true, entryName: name } };
}
function templateA() {
  return { sheet_ji: sheet('纪要表') };
}

import { enableFlightMode_ACU } from '../../../src/service/flight-mode/flight-mode-transition';

describe('块 8 复审 R8-01：切聊天后不在新聊天上做模板补偿', () => {
  it('启用后保存状态期间切到聊天 B：不对 B 提交任何补偿，并给出可操作的错误', async () => {
    h.data = { sheet_ji: { name: '纪要表', content: [['row_id', '事件'], ['1', 'x']] } };
    const result = await enableFlightMode_ACU();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('state_persist_failed');
    expect(h.applyCalls).toHaveLength(1);
    expect(h.applyCalls[0]).toMatchObject({ chatId: 'chat-A', source: 'flight_mode_enable' });
    expect(result.error).toContain('切换');
  });
});
