/**
 * service/chat/deleted-chat-resurrection-guard.ts — 删除当前聊天后被存盘写回的补删
 *
 * TT 2.4.0 删除打开中的角色聊天：排空宿主存盘队列 → 删文件 → 读剩余聊天列表、清空界面 →
 * 切到另一个聊天（CHAT_CHANGED）→ CHAT_DELETED(文件名)。排空之后、切走之前若插件的存盘进了宿主队列，
 * 宿主按仍指向被删聊天的文件名写盘，后端发现文件不在就直接新建（不留删除记录），被删聊天带着内容回到列表；
 * 写回早于宿主读列表时，宿主还会把它当作接替的聊天重新打开。
 *
 * CHAT_DELETED 只带文件名、不带角色，删别的聊天也发同一个事件。所以每次切换时记下「刚关掉的是哪个
 * 角色的哪个聊天」，紧随其后的同名删除才算删的是打开中的那个；稍后核对文件是否又在：在且没被打开就补删，
 * 被重新打开就交给调用方提示用户（在宿主脚下删打开中的聊天会让宿主状态错乱）。
 * 群聊不处理：宿主从内存列表挑接替聊天，写回的群聊文件不会出现在群聊列表里。
 */
import { SillyTavern_API_ACU } from '../../shared/host-api';
import { deleteCharacterChatFile_ACU, fetchCharacterChatNames_ACU } from '../../data/gateways/chat-gateway';

export interface CharacterChatRef_ACU {
  avatar: string;
  name: string;
}

export type DeletedChatResurrectionOutcome_ACU = 'absent' | 'redeleted' | 'reopened' | 'delete_failed' | 'unknown';

/** 宿主在同一次删除里先发切换、再发删除，中间只隔一次保存角色当前聊天的调用；超出这个间隔的删除与切换无关。 */
const DELETION_FOLLOWS_SWITCH_WITHIN_MS_ACU = 30_000;

let openChat_ACU: CharacterChatRef_ACU | null = null;
let closedChat_ACU: (CharacterChatRef_ACU & { at: number }) | null = null;

function readOpenCharacterChat_ACU(): CharacterChatRef_ACU | null {
  const api = SillyTavern_API_ACU;
  if (api.groupId) return null;
  const avatar = api.characters?.[Number(api.characterId)]?.avatar;
  const name = api.chatId;
  return avatar && name ? { avatar: String(avatar), name: String(name) } : null;
}

/** CHAT_CHANGED 时同步调用：此刻宿主已指向新聊天，上一次记下的就是刚关掉的那个。 */
export function noteChatSwitchForDeletionGuard_ACU(): void {
  closedChat_ACU = openChat_ACU ? { ...openChat_ACU, at: Date.now() } : null;
  openChat_ACU = readOpenCharacterChat_ACU();
}

/**
 * CHAT_DELETED 时同步调用：删的正是刚关掉的聊天才返回它。
 * 一次切换只认领紧随其后的一次删除，之后的删除事件与这次切换无关。
 */
export function takeDeletedOpenChatCandidate_ACU(deletedChatName: string): CharacterChatRef_ACU | null {
  const closed = closedChat_ACU;
  closedChat_ACU = null;
  if (!closed || closed.name !== deletedChatName || Date.now() - closed.at > DELETION_FOLLOWS_SWITCH_WITHIN_MS_ACU) return null;
  return { avatar: closed.avatar, name: closed.name };
}

/** 核对被删聊天的文件是否又出现，出现且没被宿主打开就补删。 */
export async function redeleteResurrectedChat_ACU(chat: CharacterChatRef_ACU): Promise<DeletedChatResurrectionOutcome_ACU> {
  const names = await fetchCharacterChatNames_ACU(chat.avatar);
  if (!names) return 'unknown';
  if (!names.has(chat.name)) return 'absent';
  const open = readOpenCharacterChat_ACU();
  if (open?.avatar === chat.avatar && open.name === chat.name) return 'reopened';
  return (await deleteCharacterChatFile_ACU(chat.avatar, chat.name)) ? 'redeleted' : 'delete_failed';
}
