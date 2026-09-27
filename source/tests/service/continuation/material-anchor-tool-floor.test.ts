/**
 * 资料补足锚点 —— TT 2.3.0 一等工具楼不得成为锚点
 *
 * 宿主事实（TauriTavern v2.3.0，克隆 HEAD=a1855be）：
 * - 工具轮的结果是**一等楼层**：`{ role:'tool', name, is_system:true, is_user:false, send_date,
 *   mes, tool_call_id, error }`，经 `chat.push` + `addOneMessage` 落进聊天并渲染成独立 `.mes`
 *   （src/scripts/tool-calling.js:1058-1089）；
 * - 它是「可见、可编辑、**可独立删除**的真实楼层」（docs/CurrentState/ChatPayload.md §4）；
 * - 它**没有 `swipe_id`** 字段。
 *
 * 所以「资料补足结果写进哪一楼」不能无条件取物理尾楼：工具结果之后未再产出正文（用户中止、
 * 轮次上限、报错）时尾楼就是工具楼，写进去等于把资料挂在一栋随时会被用户删掉的楼上，
 * 删除后 assertContinuationMaterialAnchorCurrent 立即拒写；`swipe_id` 缺失还会让锚点回退 '0'，
 * 使 swipe 切换后的比对失去意义。判定统一走 shared/ai-floor（本库唯一出处）。
 */
import { describe, expect, it } from 'vitest';

import { __assertContinuationMaterialAnchorCurrentForTests_ACU, __resolveContinuationMaterialAnchorForTests_ACU } from '../../../src/service/continuation/continuation-orchestrator';
import { ContinuationValidationError_ACU } from '../../../src/service/continuation/model';

/** TT 2.3.0 一等工具楼（tool-calling.js:1058-1068 的字段集，注意没有 swipe_id）。 */
function toolFloor(mes = '{"tool":"result"}') {
  return { role: 'tool', name: 'exa_search', is_system: true, is_user: false, mes, tool_call_id: 'call_1', error: false };
}

describe('资料补足锚点（TT 2.3.0 一等工具楼）', () => {
  it('尾楼是工具楼时锚点前移到最近的 AI 楼，并带该楼真实 swipe_id', () => {
    const chat: any[] = [
      { mes: '用户输入', is_user: true },
      { mes: 'AI 正文', is_user: false, message_id: 7, swipe_id: 2 },
      toolFloor(),
    ];

    const anchor = __resolveContinuationMaterialAnchorForTests_ACU(chat, 'chat-a');

    expect(anchor.messageIndex).toBe(1);
    expect(anchor.messageKey).toBe('number:7');
    expect(anchor.swipeId).toBe('2');
    // chatLength 仍按物理长度记录：它是「期间聊天有没有变」的比对基准，不是锚点位置。
    expect(anchor.chatLength).toBe(3);
  });

  it('被 /unhide 过的工具楼（is_system 已被宿主清掉）同样不得成为锚点', () => {
    const chat: any[] = [
      { mes: 'AI 正文', is_user: false, message_id: 1, swipe_id: 0 },
      // 宿主 /unhide 会把 is_system 改回 false（src/scripts/chats.js:149-159），只剩 role 是类型事实。
      { ...toolFloor(), is_system: false },
    ];

    expect(__resolveContinuationMaterialAnchorForTests_ACU(chat, 'chat-a').messageIndex).toBe(0);
  });

  it('隐藏楼（is_system）也不得成为锚点：资料要挂在用户看得见的正文楼上', () => {
    const chat: any[] = [
      { mes: 'AI 正文', is_user: false, message_id: 3, swipe_id: 0 },
      { mes: '（已隐藏）', is_user: false, is_system: true, message_id: 4, swipe_id: 0 },
    ];

    expect(__resolveContinuationMaterialAnchorForTests_ACU(chat, 'chat-a').messageIndex).toBe(0);
  });

  it('整条聊天没有 AI 楼时 fail-closed 拒绝，不写进用户楼', () => {
    const chat: any[] = [{ mes: '用户输入', is_user: true }, toolFloor()];

    expect(() => __resolveContinuationMaterialAnchorForTests_ACU(chat, 'chat-a'))
      .toThrow(ContinuationValidationError_ACU);
  });

  it('普通 AI 尾楼行为不变（锚点仍是物理尾楼）', () => {
    const chat: any[] = [
      { mes: '用户输入', is_user: true },
      { mes: 'AI 正文', is_user: false, message_id: 9, swipe_id: 1 },
    ];

    const anchor = __resolveContinuationMaterialAnchorForTests_ACU(chat, 'chat-a');
    expect(anchor.messageIndex).toBe(1);
    expect(anchor.swipeId).toBe('1');
    expect(anchor.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});

/**
 * 锚点时效校验：旧写法额外要求「锚点必须是物理尾楼」（chat.length - 1 === messageIndex），
 * 锚点允许落在工具楼之前后，那条快速判据会把**合法**锚点误判成迟到写入 ⇒ 资料补足永远失败。
 */
describe('资料补足锚点的时效校验', () => {
  it('锚点不是尾楼（尾楼是工具楼）时，同一聊天复读必须通过校验', () => {
    const chat: any[] = [
      { mes: 'AI 正文', is_user: false, message_id: 7, swipe_id: 2 },
      { role: 'tool', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1' },
    ];
    const anchor = __resolveContinuationMaterialAnchorForTests_ACU(chat, 'chat-a');
    expect(anchor.messageIndex).toBe(0);

    expect(() => __assertContinuationMaterialAnchorCurrentForTests_ACU(anchor, chat, 'chat-a')).not.toThrow();
  });

  it('期间追加楼层 / 锚点楼正文被改，仍必须拒写迟到结果', () => {
    const chat: any[] = [
      { mes: 'AI 正文', is_user: false, message_id: 7, swipe_id: 2 },
      { role: 'tool', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1' },
    ];
    const anchor = __resolveContinuationMaterialAnchorForTests_ACU(chat, 'chat-a');

    const grown = [...chat, { mes: '新楼层', is_user: false, message_id: 8, swipe_id: 0 }];
    expect(() => __assertContinuationMaterialAnchorCurrentForTests_ACU(anchor, grown, 'chat-a'))
      .toThrow(ContinuationValidationError_ACU);

    const edited = [{ ...chat[0], mes: 'AI 正文（被改写）' }, chat[1]];
    expect(() => __assertContinuationMaterialAnchorCurrentForTests_ACU(anchor, edited as any[], 'chat-a'))
      .toThrow(ContinuationValidationError_ACU);
  });
});
