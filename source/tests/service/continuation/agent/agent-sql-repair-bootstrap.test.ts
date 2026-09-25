import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildEmptyAgentModuleSnapshot_ACU,
  readAgentModuleFieldSnapshot_ACU,
  writeAgentModuleSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-module-store';
import type { AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

/**
 * SQL 修复提示与空总纲引导（移植上游 9ee4f0f + 3c4beb9 TT 子集）：
 * - renderWriteSqlRepair_ACU: 把回执里的失败译成下一条 SQL 该怎么写
 * - renderArcSqlBootstrap_ACU: 总纲还没建立时，直接要一条 SQL，不再把模型赶回 delta.storyArc
 */

function snapshotAt(settledThroughIndex: number, patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex, ...patch };
}

beforeEach(() => {
  _set_SillyTavern_API_ACU(null as any);
});

describe('SQL 修复提示（移植上游 9ee4f0f TT 子集）', () => {
  it('字段数不一致时提示单引号要写成两个', async () => {
    const runtime = await import('../../../../src/service/continuation/agent/agent-subagent-runtime');
    const render = (runtime as Record<string, unknown>).renderWriteSqlRepair_ACU as unknown as
      ((receipt: Record<string, unknown>) => string) | undefined;
    const receipt = {
      status: 'rejected',
      accepted: [],
      rejected: [{ path: 'sql', reason: 'INSERT 字段数与值数量不一致' }],
      partials: [],
      revisions: { storyArc: 0, hooks: 0, infoGap: 0, chronology: 0, webRefs: 0 },
    };
    const repair = render!(receipt);
    // 上游 9ee4f0f：不再抱怨“字段个数”，改为解释引号拆值并安抚 id 缺失焦虑。
    expect(repair).toContain('单引号要写成两个单引号');
    expect(repair).toContain('不是缺 id');
    expect(repair).not.toContain('字段个数必须等于值的个数');
  });

  it('revision_conflict 时区分新行与已有行', async () => {
    const runtime = await import('../../../../src/service/continuation/agent/agent-subagent-runtime');
    const render = (runtime as Record<string, unknown>).renderWriteSqlRepair_ACU as unknown as
      ((receipt: Record<string, unknown>) => string) | undefined;
    const receipt = {
      status: 'rejected',
      accepted: [],
      rejected: [{ path: 'storyArc#VOL-01', reason: 'revision_conflict: expected=1, actual=0' }],
      partials: [],
      revisions: { storyArc: 0, hooks: 0, infoGap: 0, chronology: 0, webRefs: 0 },
    };
    const repair = render!(receipt);
    expect(repair).toContain('storyArc#VOL-01');
    expect(repair).toContain('新行 INSERT 固定写 0');
    expect(repair).toContain('不要改成这个号');
  });

  it('not_found 时提示用 INSERT', async () => {
    const runtime = await import('../../../../src/service/continuation/agent/agent-subagent-runtime');
    const render = (runtime as Record<string, unknown>).renderWriteSqlRepair_ACU as unknown as
      ((receipt: Record<string, unknown>) => string) | undefined;
    const receipt = {
      status: 'rejected',
      accepted: [],
      rejected: [{ path: 'hooks#H1', reason: 'not_found' }],
      partials: [],
      revisions: { storyArc: 0, hooks: 0, infoGap: 0, chronology: 0, webRefs: 0 },
    };
    const repair = render!(receipt);
    expect(repair).toContain('hooks#H1');
    expect(repair).toContain('用 INSERT');
  });

  it('id_exists 时提示用 UPDATE', async () => {
    const runtime = await import('../../../../src/service/continuation/agent/agent-subagent-runtime');
    const render = (runtime as Record<string, unknown>).renderWriteSqlRepair_ACU as unknown as
      ((receipt: Record<string, unknown>) => string) | undefined;
    const receipt = {
      status: 'rejected',
      accepted: [],
      rejected: [{ path: 'hooks#H1', reason: 'id_exists' }],
      partials: [],
      revisions: { storyArc: 0, hooks: 0, infoGap: 0, chronology: 0, webRefs: 0 },
    };
    const repair = render!(receipt);
    expect(repair).toContain('hooks#H1');
    expect(repair).toContain('用 UPDATE');
  });

  it('missingFields 时提示缺栏并建议用同一条 UPDATE 补完', async () => {
    const runtime = await import('../../../../src/service/continuation/agent/agent-subagent-runtime');
    const render = (runtime as Record<string, unknown>).renderWriteSqlRepair_ACU as unknown as
      ((receipt: Record<string, unknown>) => string) | undefined;
    const receipt = {
      status: 'committed',
      accepted: [{ module: 'storyArc', id: 'STORY-01', field: 'title', revision: 1 }],
      rejected: [],
      partials: [{ module: 'storyArc', id: 'STORY-01', missingFields: ['withheld'] }],
      revisions: { storyArc: 1, hooks: 0, infoGap: 0, chronology: 0, webRefs: 0 },
    };
    const repair = render!(receipt);
    expect(repair).toContain('STORY-01');
    expect(repair).toContain('withheld');
    expect(repair).toContain('同一条 UPDATE');
    expect(repair).toContain('不缺 id');
  });
});

describe('空总纲引导（移植上游 3c4beb9 TT 子集）', () => {
  it('空总纲时提示先写一条 scope=story 的全书方向', async () => {
    const runtime = await import('../../../../src/service/continuation/agent/agent-subagent-runtime');
    const render = (runtime as Record<string, unknown>).renderArcSqlBootstrap_ACU as unknown as
      ((chat: any[], remainingWriteRounds: number) => string) | undefined;
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    const bootstrap = render!(chat, 3);
    expect(bootstrap).toContain('总纲还不能执行');
    expect(bootstrap).toContain('scope=\'story\'');
    expect(bootstrap).toContain('全书方向');
    expect(bootstrap).toContain('expected_revision');
    // 上游 56540c9：批量语义修正——新行固定 0、全部放进同一条 sql，不再要求“一次一个 id”。
    expect(bootstrap).toContain('新行 INSERT 的 expected_revision 固定写 0');
    expect(bootstrap).toContain('同一条 sql 一次写入');
    expect(bootstrap).toContain('每条 INSERT 都必须带 withheld');
    expect(bootstrap).not.toContain('一次一个 id');
    expect(bootstrap).not.toContain('expected_revision 必须等于');
  });

  it('已有分栏记录时列出已有 ID 与缺栏', async () => {
    const runtime = await import('../../../../src/service/continuation/agent/agent-subagent-runtime');
    const render = (runtime as Record<string, unknown>).renderArcSqlBootstrap_ACU as unknown as
      ((chat: any[], remainingWriteRounds: number) => string) | undefined;
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: 'b', is_user: false });
    const store = await import('../../../../src/service/continuation/agent/agent-module-store');
    await (store as Record<string, unknown>).commitAgentModuleFieldWrites_ACU({
      chat, targetIndex: 1,
      sql: "INSERT INTO story_arc (id, scope, title, direction, escalation, withheld, status, expected_revision) VALUES ('STORY-01', 'story', '全书', '方向', '台阶', '底牌', 'active', 0)",
      role: 'arc-architect',
    });
    const bootstrap = render!(chat, 3);
    expect(bootstrap).toContain('STORY-01');
    expect(bootstrap).toContain('已有分栏记录');
  });

  it('write_sql 轮次用尽时提示只输出 JSON', async () => {
    const runtime = await import('../../../../src/service/continuation/agent/agent-subagent-runtime');
    const render = (runtime as Record<string, unknown>).renderArcSqlBootstrap_ACU as unknown as
      ((chat: any[], remainingWriteRounds: number) => string) | undefined;
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    const bootstrap = render!(chat, 0);
    expect(bootstrap).toContain('write_sql 轮次已用尽');
    expect(bootstrap).toContain('只输出一个 JSON');
  });
});
