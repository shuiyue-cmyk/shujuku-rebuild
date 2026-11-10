// shared/chat-positions.ts — 楼号是否仍对应原来的消息
//
// 宿主切聊天时复用同一个 chat 数组（先清空再放进新聊天的楼层），删楼会让后面的楼号整体前移：
// 早先算好的楼号在任何 await 之后都可能指向别的楼层，甚至别的聊天。按楼号读写楼层的代码先记下
// 此刻每个楼号上的消息对象，await 之后、动手之前核对一次。

/**
 * 记下此刻每个楼号上的消息对象。返回的函数核对 0..lastIndex（缺省为记下时的最后一楼）是否仍是
 * 原来那些消息：之后追加的新楼不算改动；lastIndex 超出记下时的楼数（当时还不存在）无从核对，算对不上。
 */
export function captureChatPositions_ACU(chat: readonly unknown[]): (lastIndex?: number) => boolean {
    const messages = chat.slice();
    return (lastIndex = messages.length - 1) => {
        if (lastIndex >= messages.length) return false;
        for (let index = 0; index <= lastIndex; index++) {
            if (chat[index] !== messages[index]) return false;
        }
        return true;
    };
}
