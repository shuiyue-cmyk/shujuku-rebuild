import { describe, expect, it } from 'vitest';
import {
  applyCandidateTableFieldsToLiveChat_ACU,
  cloneChatWithTableFields_ACU,
} from '../../../src/service/table/chat-table-field-swap';

describe('chat-table-field-swap', () => {
  it('写回只替换变化的表格字段，消息对象与未变字段引用保持；回滚还原原引用', () => {
    const unchangedField = { '': { storageFrame: { version: 2 } } };
    const legacyField = { sheet_0: { rows: 1 } };
    const chat: any[] = [
      { is_user: false, mes: 'a', TavernDB_ACU_IsolatedData: unchangedField, TavernDB_ACU_Data: legacyField },
      { is_user: true, mes: 'u' },
      { is_user: false, mes: 'b' },
    ];
    const messages = [...chat];
    const candidate = JSON.parse(JSON.stringify(chat));
    delete candidate[0].TavernDB_ACU_Data;
    candidate[2].TavernDB_ACU_IsolatedData = { '': { storageFrame: { version: 2, checkpoint: { kind: 'full' } } } };
    candidate[1].mes = '候选里改了正文也不会写回';

    const rollback = applyCandidateTableFieldsToLiveChat_ACU(chat, candidate);

    messages.forEach((message, index) => expect(chat[index]).toBe(message));
    expect(chat[0].TavernDB_ACU_IsolatedData).toBe(unchangedField);
    expect(chat[0]).not.toHaveProperty('TavernDB_ACU_Data');
    expect(chat[1].mes).toBe('u');
    expect(chat[2].TavernDB_ACU_IsolatedData['']).toEqual({ storageFrame: { version: 2, checkpoint: { kind: 'full' } } });

    rollback();

    expect(chat[0].TavernDB_ACU_Data).toBe(legacyField);
    expect(chat[2]).not.toHaveProperty('TavernDB_ACU_IsolatedData');
  });

  it('候选与当前聊天长度不一致时拒绝写回', () => {
    expect(() => applyCandidateTableFieldsToLiveChat_ACU([{}], [{}, {}])).toThrow('长度不一致');
  });

  it('cloneChatWithTableFields_ACU 只深拷贝表格字段：改写候选不影响原消息，正文等其他字段共享', () => {
    const body = { long: '正文'.repeat(10) };
    const chat: any[] = [
      { is_user: false, extra: body, TavernDB_ACU_IsolatedData: { '': { storageFrame: { logEntries: [1] } } } },
      { is_user: true, mes: 'u' },
    ];
    const clone = cloneChatWithTableFields_ACU(chat);

    expect(clone).not.toBe(chat);
    expect(clone[0]).not.toBe(chat[0]);
    expect(clone[0].extra).toBe(body);
    expect(clone[1]).toEqual(chat[1]);
    clone[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries.push(2);
    delete clone[0].TavernDB_ACU_IsolatedData;
    expect(chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.logEntries).toEqual([1]);
  });
});
