/**
 * 把「由 live chat 同步克隆并改写」的候选聊天写回 live chat（R2B-08）。
 * 只逐条替换表格相关字段，不整体 splice：宿主/插件持有的消息对象引用（删楼保管库按对象引用判定楼层
 * 是否幸存）保持有效；返回的回滚函数还原原字段引用，而不是再换一批克隆。
 */
export const CHAT_TABLE_MESSAGE_FIELDS_ACU = [
  'TavernDB_ACU_IsolatedData',
  'TavernDB_ACU_Identity',
  'TavernDB_ACU_IndependentData',
  'TavernDB_ACU_Data',
  'TavernDB_ACU_SummaryData',
  'TavernDB_ACU_ModifiedKeys',
  'TavernDB_ACU_UpdateGroupKeys',
] as const;

/**
 * 构造可安全改写表格字段的候选聊天：每条消息浅拷贝，只深拷贝表格字段。
 * 用于「先在候选上清理/改写，再校验或写回」的路径，避免把整段聊天正文做一次 JSON 往返（R2B-09）。
 * 候选只能改写表格字段；其他字段与原消息共享引用。
 */
export function cloneChatWithTableFields_ACU(chat: any[]): any[] {
  return chat.map(message => {
    if (!message || typeof message !== 'object') return message;
    const copy: Record<string, any> = { ...message };
    for (const field of CHAT_TABLE_MESSAGE_FIELDS_ACU) {
      if (Object.prototype.hasOwnProperty.call(copy, field) && copy[field] !== undefined) {
        copy[field] = JSON.parse(JSON.stringify(copy[field]));
      }
    }
    return copy;
  });
}

type FieldRestore_ACU ={ message: Record<string, any>; field: string; hadValue: boolean; value: unknown };

function sameJson_ACU(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyCandidateTableFieldsToLiveChat_ACU(chat: any[], candidateChat: any[]): () => void {
  if (!Array.isArray(chat) || !Array.isArray(candidateChat) || chat.length !== candidateChat.length) {
    throw new Error('候选聊天与当前聊天长度不一致，拒绝写回表格字段。');
  }
  const restores: FieldRestore_ACU[] = [];
  const rollback = () => {
    for (let index = restores.length - 1; index >= 0; index -= 1) {
      const { message, field, hadValue, value } = restores[index];
      if (hadValue) message[field] = value;
      else delete message[field];
    }
  };
  try {
    chat.forEach((message, index) => {
      const candidate = candidateChat[index];
      if (!message || typeof message !== 'object' || !candidate || typeof candidate !== 'object') return;
      for (const field of CHAT_TABLE_MESSAGE_FIELDS_ACU) {
        const hadValue = Object.prototype.hasOwnProperty.call(message, field);
        const candidateHasValue = Object.prototype.hasOwnProperty.call(candidate, field);
        if (hadValue === candidateHasValue && (!hadValue || sameJson_ACU(message[field], candidate[field]))) continue;
        restores.push({ message, field, hadValue, value: message[field] });
        if (candidateHasValue) message[field] = candidate[field];
        else delete message[field];
      }
    });
  } catch (error) {
    rollback();
    throw error;
  }
  return rollback;
}
