import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildEmptyAgentModuleSnapshot_ACU,
  readAgentModuleFieldSnapshot_ACU,
  readAgentModuleSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-module-store';
import { buildEmptyAgentConversation_ACU } from '../../../../src/service/continuation/agent/agent-conversation-store';
import type { AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

/**
 * 主会话纠正 A 块判别（移植上游 365dd863，按本地架构改写）：
 * commit 沿用 store 逐栏提交（role=main），追溯边界经快照写盘持久化，不推进结算水位。
 */

function snapshotAt(settledThroughIndex: number, patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex, ...patch };
}

function conversationWithUser(id: number) {
  const conversation = buildEmptyAgentConversation_ACU();
  (conversation as { nextId: number }).nextId = id + 1;
  conversation.messages.push({ id, kind: 'user', text: '从第 1 楼开始', digest: '', turnKey: '', at: 1 });
  return conversation;
}

beforeEach(() => {
  _set_SillyTavern_API_ACU(null as any);
});

describe('主会话纠正（移植上游 365dd863）', () => {
  it('sql 纠正经 main 角色提交：committed 且回执可查', async () => {
    const correction = await import('../../../../src/service/continuation/agent/agent-main-correction');
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    await (store as Record<string, (chat: unknown[], index: number, snapshot: AgentModuleSnapshot_ACU) => Promise<void>>)
      .writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: '正文', is_user: false });
    const result = await (correction as Record<string, unknown>).correctAgentMaterials_ACU as unknown as
      ((input: Record<string, unknown>) => Promise<{ status: string; sqlReceipt?: { status: string } }>) | undefined;
    const out = await result!({
      action: { kind: 'correct_materials', thought: '纠正', reason: '正文写明是红布', sql: "INSERT INTO hooks (id, expected_revision, summary) VALUES ('H1', 0, '红布')" },
      chat,
      conversation: conversationWithUser(1),
      isCurrent: () => true,
      completedStages: [],
    });
    expect(out.status).toBe('committed');
    expect(out.sqlReceipt?.status).toBe('committed');
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.H1?.fields.summary.value).toBe('红布');
  });

  it('追溯起点必须引用最新真实用户消息，否则拒绝', async () => {
    const correction = await import('../../../../src/service/continuation/agent/agent-main-correction');
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    await (store as Record<string, (chat: unknown[], index: number, snapshot: AgentModuleSnapshot_ACU) => Promise<void>>)
      .writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: '正文', is_user: false });
    const correct = (correction as Record<string, unknown>).correctAgentMaterials_ACU as unknown as
      ((input: Record<string, unknown>) => Promise<{ status: string; reason?: string }>) | undefined;
    const wrongUser = await correct!({
      action: { kind: 'correct_materials', thought: '跳过', reason: '用户要求', settlementStartIndex: 1, userMessageId: 999 },
      chat,
      conversation: conversationWithUser(1),
      isCurrent: () => true,
      completedStages: [],
    });
    expect(wrongUser.status).toBe('rejected');
    const notAiFloor = await correct!({
      action: { kind: 'correct_materials', thought: '跳过', reason: '用户要求', settlementStartIndex: 99, userMessageId: 1 },
      chat,
      conversation: conversationWithUser(1),
      isCurrent: () => true,
      completedStages: [],
    });
    expect(notAiFloor.status).toBe('rejected');
  });

  it('合法追溯起点落盘 settlementBoundary 且不推进结算水位', async () => {
    const correction = await import('../../../../src/service/continuation/agent/agent-main-correction');
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    await (store as Record<string, (chat: unknown[], index: number, snapshot: AgentModuleSnapshot_ACU) => Promise<void>>)
      .writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: '正文', is_user: false });
    const correct = (correction as Record<string, unknown>).correctAgentMaterials_ACU as unknown as
      ((input: Record<string, unknown>) => Promise<{ status: string; settlementBoundary?: { startIndex: number } }>) | undefined;
    const out = await correct!({
      action: { kind: 'correct_materials', thought: '跳过', reason: '用户要求从第 1 楼开始', settlementStartIndex: 1, userMessageId: 1 },
      chat,
      conversation: conversationWithUser(1),
      isCurrent: () => true,
      completedStages: [],
    });
    expect(out.status).toBe('committed');
    const snapshot = readAgentModuleSnapshot_ACU(chat);
    expect(snapshot.settlementBoundary?.startIndex).toBe(1);
    expect(snapshot.settledThroughIndex).toBe(0);
  });

  it('纠正成功后同模块 invoke_failed 缺口一并清除（复审必须修）', async () => {
    const correction = await import('../../../../src/service/continuation/agent/agent-main-correction');
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    const stale = {
      module: 'hooks', agentName: 'hook-cognition-maintainer',
      violations: [{ path: 'hooks', message: '维护子代理调用失败' }], attempts: 1, firstFailedAtIndex: 0,
      lastError: '维护子代理调用失败', source: 'invoke_failed', completion: 'failed',
      rangeStartIndex: 0, rangeEndIndex: 0, acceptedKeys: [], createdAt: 1, updatedAt: 1,
    };
    await (store as Record<string, (chat: unknown[], index: number, snapshot: AgentModuleSnapshot_ACU) => Promise<void>>)
      .writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0, { pendingFixes: [stale as any] }));
    chat.push({ mes: '正文', is_user: false });
    const correct = (correction as Record<string, unknown>).correctAgentMaterials_ACU as unknown as
      ((input: Record<string, unknown>) => Promise<{ status: string }>) | undefined;
    const out = await correct!({
      action: { kind: 'correct_materials', thought: '纠正', reason: '正文写明是红布', sql: "INSERT INTO hooks (id, expected_revision, summary) VALUES ('H1', 0, '红布')" },
      chat,
      conversation: conversationWithUser(1),
      isCurrent: () => true,
      completedStages: [],
    });
    expect(out.status).toBe('committed');
    expect(readAgentModuleSnapshot_ACU(chat).pendingFixes.some(item => item.source === 'invoke_failed')).toBe(false);
  });

  it('纠正指引含最新用户消息 ID 与模块修订号', async () => {    const correction = await import('../../../../src/service/continuation/agent/agent-main-correction');
    const render = (correction as Record<string, unknown>).renderAgentCorrectionGuide_ACU as unknown as
      ((conversation: unknown, snapshot: AgentModuleSnapshot_ACU) => string) | undefined;
    const guide = render!(conversationWithUser(7), snapshotAt(0));
    expect(guide).toContain('7');
    expect(guide).toContain('correct_materials');
  });
});
