import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 删除当前聊天后被存盘写回的补删（TT 2.4.0 源码核实的删除顺序：删文件 → 切到别的聊天 → CHAT_DELETED）。
 * 删除事件只带文件名，所以靠「切换时记下刚关掉的聊天」判断删的是不是打开中的那个。
 */
const m = vi.hoisted(() => ({
  api: {} as any,
  fetchNames: vi.fn(async (_avatar: string): Promise<Set<string> | null> => new Set()),
  deleteFile: vi.fn(async (_avatar: string, _name: string) => true),
}));

vi.mock('../../../src/shared/host-api', () => ({ SillyTavern_API_ACU: m.api }));
vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  fetchCharacterChatNames_ACU: (avatar: string) => m.fetchNames(avatar),
  deleteCharacterChatFile_ACU: (avatar: string, name: string) => m.deleteFile(avatar, name),
}));

import {
  noteChatSwitchForDeletionGuard_ACU,
  redeleteResurrectedChat_ACU,
  takeDeletedOpenChatCandidate_ACU,
} from '../../../src/service/chat/deleted-chat-resurrection-guard';

function openChat(name: string, avatar = 'aria.png'): void {
  m.api.characters = [{ avatar: 'other.png' }, { avatar }];
  m.api.characterId = '1';
  m.api.groupId = null;
  m.api.chatId = name;
  noteChatSwitchForDeletionGuard_ACU();
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(m.api)) delete m.api[key];
  // 清掉上一个用例留下的「刚关掉的聊天」
  takeDeletedOpenChatCandidate_ACU('');
  openChat('起点');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('删除当前聊天后被存盘写回的补删', () => {
  it('删的是刚关掉的聊天、文件又出现、宿主已切到别的聊天：补删这个文件', async () => {
    openChat('旧聊天');
    openChat('接替聊天');
    const candidate = takeDeletedOpenChatCandidate_ACU('旧聊天');
    expect(candidate).toEqual({ avatar: 'aria.png', name: '旧聊天' });

    m.fetchNames.mockResolvedValueOnce(new Set(['旧聊天', '接替聊天']));
    expect(await redeleteResurrectedChat_ACU(candidate!)).toBe('redeleted');
    expect(m.fetchNames).toHaveBeenCalledWith('aria.png');
    expect(m.deleteFile).toHaveBeenCalledWith('aria.png', '旧聊天');
  });

  it('文件没被写回：什么都不删', async () => {
    openChat('旧聊天');
    openChat('接替聊天');
    const candidate = takeDeletedOpenChatCandidate_ACU('旧聊天')!;
    m.fetchNames.mockResolvedValueOnce(new Set(['接替聊天']));
    expect(await redeleteResurrectedChat_ACU(candidate)).toBe('absent');
    expect(m.deleteFile).not.toHaveBeenCalled();
  });

  it('写回的文件被宿主当作接替聊天重新打开：不在宿主脚下删打开中的聊天，交给调用方提示', async () => {
    openChat('旧聊天');
    openChat('旧聊天');
    const candidate = takeDeletedOpenChatCandidate_ACU('旧聊天')!;
    m.fetchNames.mockResolvedValueOnce(new Set(['旧聊天']));
    expect(await redeleteResurrectedChat_ACU(candidate)).toBe('reopened');
    expect(m.deleteFile).not.toHaveBeenCalled();
  });

  it('聊天列表读不全：无法判定，不删', async () => {
    openChat('旧聊天');
    openChat('接替聊天');
    const candidate = takeDeletedOpenChatCandidate_ACU('旧聊天')!;
    m.fetchNames.mockResolvedValueOnce(null);
    expect(await redeleteResurrectedChat_ACU(candidate)).toBe('unknown');
    expect(m.deleteFile).not.toHaveBeenCalled();
  });

  it('删的不是刚关掉的那个聊天（例如别处同名聊天）：不认领；一次切换只认领紧随其后的一次删除', () => {
    openChat('旧聊天');
    openChat('接替聊天');
    expect(takeDeletedOpenChatCandidate_ACU('别的聊天')).toBeNull();
    expect(takeDeletedOpenChatCandidate_ACU('旧聊天')).toBeNull();
  });

  it('切换之后隔了很久才来的同名删除与这次切换无关：不认领', () => {
    vi.useFakeTimers();
    openChat('旧聊天');
    openChat('接替聊天');
    vi.advanceTimersByTime(30_001);
    expect(takeDeletedOpenChatCandidate_ACU('旧聊天')).toBeNull();
  });

  it('刚关掉的是群聊：不认领（宿主不会从磁盘重新挑出写回的群聊）', () => {
    m.api.groupId = 'g1';
    m.api.chatId = '群聊A';
    noteChatSwitchForDeletionGuard_ACU();
    openChat('接替聊天');
    expect(takeDeletedOpenChatCandidate_ACU('群聊A')).toBeNull();
  });
});
