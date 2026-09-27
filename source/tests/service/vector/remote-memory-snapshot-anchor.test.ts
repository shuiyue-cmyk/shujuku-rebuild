/**
 * 远端记忆快照锚的角色解析 —— TT 2.3.0 一等工具楼不得冒充 assistant
 *
 * 宿主事实：工具结果楼是 `{role:'tool', is_system:true, is_user:false, mes, tool_call_id, error}`
 * （src/scripts/tool-calling.js:1058-1068），但用户 `/unhide` 会把 `is_system` 改回 false
 * （src/scripts/chats.js:149-159）⇒ 只看 is_user/is_system 的二分法会把工具结果 JSON 标成 assistant。
 * role 才是类型事实，判据与 shared/ai-floor.ts 同源。
 */
import { describe, expect, it } from 'vitest';

import { resolveRemoteMemorySnapshotAnchor_ACU } from '../../../src/service/vector/remote-memory-snapshot-anchor';

describe('远端记忆快照锚的角色解析', () => {
  it('被 /unhide 过的工具楼（is_system 已被清掉）标为 system，不冒充 assistant', () => {
    const chat: any[] = [
      { mes: 'AI 正文', is_user: false, send_date: 1 },
      { role: 'tool', name: 'exa_search', is_system: false, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1', send_date: 2 },
    ];

    expect(resolveRemoteMemorySnapshotAnchor_ACU(chat, 1)?.role).toBe('system');
    // 真实 AI 楼不受影响
    expect(resolveRemoteMemorySnapshotAnchor_ACU(chat, 0)?.role).toBe('assistant');
  });

  it('默认形态的工具楼、用户楼角色不变', () => {
    const chat: any[] = [
      { mes: '用户输入', is_user: true, send_date: 1 },
      { role: 'tool', name: 'exa_search', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1', send_date: 2 },
    ];

    expect(resolveRemoteMemorySnapshotAnchor_ACU(chat, 0)?.role).toBe('user');
    expect(resolveRemoteMemorySnapshotAnchor_ACU(chat, 1)?.role).toBe('system');
  });

  it('锚点身份仍按 index+send_date 生成：角色修正不会漂移已落盘锚点的取值路径', () => {
    const chat: any[] = [
      { role: 'tool', is_system: false, is_user: false, mes: '{"result":"x"}', send_date: 4242 },
    ];

    const anchor = resolveRemoteMemorySnapshotAnchor_ACU(chat, 0);
    expect(anchor?.anchor).toMatch(/^chat-message:/);
    expect(anchor?.messageIndex).toBe(0);
    // 同一楼重复解析必须稳定（持久化后按 anchor 相等判定是否需要重写）
    expect(resolveRemoteMemorySnapshotAnchor_ACU(chat, 0)?.anchor).toBe(anchor?.anchor);
  });
});
