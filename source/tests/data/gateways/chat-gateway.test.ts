/**
 * tests/data/gateways/chat-gateway.test.ts
 * 聊天数组访问网关 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSillyTavern, mockLogDebug, mockLogWarn } = vi.hoisted(() => ({
  mockSillyTavern: {} as any,
  mockLogDebug: vi.fn(),
  mockLogWarn: vi.fn(),
}));

vi.mock('../../../src/shared/host-api', () => ({
  SillyTavern_API_ACU: mockSillyTavern,
}));

vi.mock('../../../src/shared/utils', () => ({
  logDebug_ACU: mockLogDebug,
  logWarn_ACU: mockLogWarn,
  // 真实实现的最小复刻（去路径前缀 + 去 .jsonl/.json 后缀），
  // 供 listAllHostChatNames_ACU 归一化聊天名使用。
  cleanChatName_ACU: (fileName: string) => {
    if (!fileName || typeof fileName !== 'string') return 'unknown_chat_source';
    const parts = fileName.split(/[\\/]/);
    return parts[parts.length - 1].replace(/\.jsonl$/, '').replace(/\.json$/, '');
  },
}));

import {
  getChatArray_ACU,
  getChatLength_ACU,
  getLastMessageIndex_ACU,
  saveChatToHost_ACU,
  saveChatToHostStrict_ACU,
  stopGeneration_ACU,
  deleteLastMessage_ACU,
  setChatMessages_ACU,
  emitMessageUpdated_ACU,
  listAllHostChatNames_ACU,
} from '../../../src/data/gateways/chat-gateway';

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockSillyTavern).forEach(k => delete mockSillyTavern[k]);
});

describe('getChatArray_ACU', () => {
  it('无 chat 时返回空数组', () => {
    expect(getChatArray_ACU()).toEqual([]);
  });

  it('有 chat 时返回引用', () => {
    const chat = [{ mes: '消息1' }, { mes: '消息2' }];
    mockSillyTavern.chat = chat;
    expect(getChatArray_ACU()).toBe(chat);
  });
});

describe('getChatLength_ACU', () => {
  it('无 chat 时返回 0', () => {
    expect(getChatLength_ACU()).toBe(0);
  });

  it('有 chat 时返回长度', () => {
    mockSillyTavern.chat = [{ mes: '1' }, { mes: '2' }, { mes: '3' }];
    expect(getChatLength_ACU()).toBe(3);
  });
});

describe('getLastMessageIndex_ACU', () => {
  it('空聊天返回 0', () => {
    expect(getLastMessageIndex_ACU()).toBe(0);
  });

  it('有消息时返回最后索引', () => {
    mockSillyTavern.chat = [{ mes: '1' }, { mes: '2' }];
    expect(getLastMessageIndex_ACU()).toBe(1);
  });
});

describe('saveChatToHost_ACU', () => {
  it('saveChat 不可用时静默跳过', async () => {
    await saveChatToHost_ACU();
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('saveChat 可用时调用', async () => {
    mockSillyTavern.saveChat = vi.fn().mockResolvedValue(undefined);
    await saveChatToHost_ACU();
    expect(mockSillyTavern.saveChat).toHaveBeenCalled();
  });
});

describe('saveChatToHostStrict_ACU', () => {
  it('saveChat 不可用时抛错，不把未提交误认为保存成功', async () => {
    await expect(saveChatToHostStrict_ACU()).rejects.toThrow('宿主 saveChat 不可用');
  });

  it('saveChat 可用时执行真实保存', async () => {
    mockSillyTavern.saveChat = vi.fn().mockResolvedValue(undefined);

    await saveChatToHostStrict_ACU();

    expect(mockSillyTavern.saveChat).toHaveBeenCalledTimes(1);
  });
});

describe('stopGeneration_ACU', () => {
  it('不可用时静默跳过', () => {
    stopGeneration_ACU();
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('可用时调用', () => {
    mockSillyTavern.stopGeneration = vi.fn();
    stopGeneration_ACU();
    expect(mockSillyTavern.stopGeneration).toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalled();
  });
});

describe('deleteLastMessage_ACU', () => {
  it('不可用时静默跳过', async () => {
    await deleteLastMessage_ACU();
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('可用时调用', async () => {
    mockSillyTavern.deleteLastMessage = vi.fn().mockResolvedValue(undefined);
    await deleteLastMessage_ACU();
    expect(mockSillyTavern.deleteLastMessage).toHaveBeenCalled();
  });
});

describe('setChatMessages_ACU', () => {
  it('不可用时返回 false', async () => {
    expect(await setChatMessages_ACU([{ message_id: 0, mes: '新内容' }])).toBe(false);
  });

  it('可用时调用并返回 true', async () => {
    mockSillyTavern.setChatMessages = vi.fn().mockResolvedValue(undefined);
    const result = await setChatMessages_ACU([{ message_id: 0, mes: '新内容' }], { refresh: 'affected' });
    expect(result).toBe(true);
    expect(mockSillyTavern.setChatMessages).toHaveBeenCalledWith(
      [{ message_id: 0, mes: '新内容' }],
      { refresh: 'affected' },
    );
  });
});

describe('emitMessageUpdated_ACU', () => {
  it('eventSource 不可用时静默跳过', () => {
    emitMessageUpdated_ACU(0);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('有 eventTypes.MESSAGE_UPDATED 时使用常量', () => {
    const emit = vi.fn();
    mockSillyTavern.eventSource = { emit };
    mockSillyTavern.eventTypes = { MESSAGE_UPDATED: 'MESSAGE_UPDATED_CONST' };
    emitMessageUpdated_ACU(5);
    expect(emit).toHaveBeenCalledWith('MESSAGE_UPDATED_CONST', 5);
  });

  it('无 eventTypes 时降级使用小写字符串事件名（TT events.js:12 注册名）', () => {
    const emit = vi.fn();
    mockSillyTavern.eventSource = { emit };
    emitMessageUpdated_ACU(3);
    // TT 事件字面量为小写 'message_updated'（events.js:12），大写 'MESSAGE_UPDATED'
    // 从未被注册，emit 等于空放（纯一致性修复，正常路径始终走 eventTypes 常量）。
    expect(emit).toHaveBeenCalledWith('message_updated', 3);
    expect(emit).not.toHaveBeenCalledWith('MESSAGE_UPDATED', 3);
  });
});

// ═══ listAllHostChatNames_ACU（孤儿判定的存活枚举，fail-safe 契约）═══
describe('listAllHostChatNames_ACU', () => {
  function stubHost(options: {
    characters?: any[] | null;
    contextGroups?: any;
    chatsByAvatar?: Record<string, string[]>;
    chatsHttpStatus?: number;
  }) {
    const { characters, contextGroups, chatsByAvatar = {}, chatsHttpStatus = 200 } = options;
    if (characters !== null) mockSillyTavern.characters = characters;
    vi.stubGlobal('SillyTavern', {
      getContext: () => (contextGroups === undefined ? {} : { groups: contextGroups }),
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      const avatar = JSON.parse(init.body).avatar_url;
      if (url === '/api/characters/chats') {
        return {
          ok: chatsHttpStatus === 200,
          status: chatsHttpStatus,
          json: async () => (chatsByAvatar[avatar] || []).map(fileName => ({ file_name: fileName })),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('characters 列表不可用时返回 null（不得当成空集合）', async () => {
    stubHost({ characters: null });
    expect(await listAllHostChatNames_ACU()).toBeNull();
  });

  it('groups 与角色聊天都可用时枚举两者', async () => {
    stubHost({
      characters: [{ avatar: 'aria.png' }],
      contextGroups: [{ chats: ['group-live.jsonl'] }, { chats: null }],
      chatsByAvatar: { 'aria.png': ['role-chat.jsonl'] },
    });
    const names = await listAllHostChatNames_ACU();
    expect(names).not.toBeNull();
    expect([...(names as Set<string>)].sort()).toEqual(['group-live', 'role-chat']);
  });

  it('groups 字段缺失（老宿主 / 派生 context）时返回 null，不能只交角色枚举', async () => {
    // 回归：曾经只判 Array.isArray(groups) 而无 else，群组不可用时仍返回非 null 的
    // 残缺集合 → 聊天删除 GC 把存活群组聊天判为孤儿并误删其向量外置文件。
    stubHost({
      characters: [{ avatar: 'aria.png' }],
      contextGroups: undefined,
      chatsByAvatar: { 'aria.png': ['role-chat.jsonl'] },
    });
    expect(await listAllHostChatNames_ACU()).toBeNull();
  });

  it('getContext 抛异常时返回 null', async () => {
    stubHost({ characters: [{ avatar: 'aria.png' }], contextGroups: undefined });
    vi.stubGlobal('SillyTavern', {
      getContext: () => { throw new Error('context 不可用'); },
    });
    expect(await listAllHostChatNames_ACU()).toBeNull();
  });

  it('groups 是空数组属合法「无群组」，仍返回角色枚举（不误伤）', async () => {
    stubHost({
      characters: [{ avatar: 'aria.png' }],
      contextGroups: [],
      chatsByAvatar: { 'aria.png': ['role-chat.jsonl'] },
    });
    const names = await listAllHostChatNames_ACU();
    expect(names).not.toBeNull();
    expect([...(names as Set<string>)]).toEqual(['role-chat']);
  });

  it('角色聊天列表请求失败时返回 null', async () => {
    stubHost({
      characters: [{ avatar: 'aria.png' }],
      contextGroups: [],
      chatsHttpStatus: 500,
    });
    expect(await listAllHostChatNames_ACU()).toBeNull();
  });
});