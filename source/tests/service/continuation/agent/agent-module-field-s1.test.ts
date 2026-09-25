import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_MODULE_FIELD_ACU, type AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import {
  buildEmptyAgentModuleSnapshot_ACU,
  readAgentModuleFieldSnapshot_ACU,
  readAgentModuleSnapshot_ACU,
  readAgentModuleSnapshotDiagnostics_ACU,
  writeAgentModuleFields_ACU,
  writeAgentModuleSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-module-store';
import { installMaterialCheckpointScheduler_ACU } from '../../../../src/service/continuation/agent/agent-checkpoint-scheduler';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

function snapshotAt(settledThroughIndex: number, patch: Partial<AgentModuleSnapshot_ACU> = {}): AgentModuleSnapshot_ACU {
  return { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex, ...patch };
}

function hook(id: string) {
  return { id, summary: `伏笔 ${id}`, status: 'planted', importance: 'mid', plantedIndex: 1, updatedIndex: 1, plannedPayoff: '', retired: false, retiredReason: '' };
}

beforeEach(() => {
  _set_SillyTavern_API_ACU(null as any);
  installMaterialCheckpointScheduler_ACU();
});

describe('S1 判别：逐栏写入与分栏视图（TT 六模块）', () => {
  it('同一 ID 分两次写不同栏目合并为 partial，且不进入领域数组', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));

    chat.push({ mes: 'b', is_user: false });
    await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: { summary: { value: '伏笔 P1' }, status: { value: 'planted' } } } });
    await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: { importance: { value: 'high' } } } });

    const record = readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1;
    expect(record?.status).toBe('partial');
    expect(record?.fields.summary.value).toBe('伏笔 P1');
    expect(record?.fields.importance.value).toBe('high');
    expect(record?.missingFields).toContain('plantedIndex');
    expect(readAgentModuleSnapshot_ACU(chat).hooks).toEqual([]);
    expect(chat[1][AGENT_MODULE_FIELD_ACU].deltas).toHaveLength(2);
  });

  it('整条写入覆盖同名 partial 并提升为完整条目', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: 'b', is_user: false });
    await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: { summary: { value: '伏笔 P1' } } } });
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1?.status).toBe('partial');

    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [hook('P1') as any] }));
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1?.status).toBe('legacy_unknown');
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['P1']);
  });

  it('领域条目被整条删除后 partial 仍保留，legacy_unknown 同步删除', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0, { hooks: [hook('H1') as any] }));
    chat.push({ mes: 'b', is_user: false });
    await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: { summary: { value: '伏笔 P1' } } } });

    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [] }));
    expect(readAgentModuleSnapshot_ACU(chat).hooks).toEqual([]);
    const records = readAgentModuleFieldSnapshot_ACU(chat).records.hooks ?? {};
    expect(records.H1).toBeUndefined();
    expect(records.P1?.status).toBe('partial');
  });

  it('swipe 切走后逐栏 delta 不进入折叠，切回后恢复', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false, swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: 'b', is_user: false, swipe_id: 0 });
    await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: { summary: { value: '伏笔 P1' } } } });
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1?.status).toBe('partial');

    chat[1].swipe_id = 1;
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks ?? {}).toEqual({});

    chat[1].swipe_id = 0;
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1?.fields.summary.value).toBe('伏笔 P1');
  });

  it('非法栏目被过滤；全非法返回 false 且不写帧', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: 'b', is_user: false });

    expect(await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: { noSuchField: { value: 1 } } as any } })).toBe(false);
    expect(chat[1][AGENT_MODULE_FIELD_ACU]?.deltas ?? []).toEqual([]);

    expect(await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: { summary: { value: 's' }, noSuchField: { value: 1 } } as any } })).toBe(true);
    const record = readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1;
    expect(record?.fields.summary.value).toBe('s');
    expect(record?.fields).not.toHaveProperty('noSuchField');
  });

  it('unset 撤销栏目；写齐必填变 complete 但仍不进领域数组', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0));
    chat.push({ mes: 'b', is_user: false });
    await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: { summary: { value: 's' }, status: { value: 'planted' } } } });
    await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: { summary: { unset: true } } } });
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1?.fields).not.toHaveProperty('summary');

    await writeAgentModuleFields_ACU(chat, 1, { hooks: { P1: {
      summary: { value: 's' }, status: { value: 'planted' }, importance: { value: 'mid' },
      plantedIndex: { value: 1 }, updatedIndex: { value: 1 }, plannedPayoff: { value: '' },
      retired: { value: false }, retiredReason: { value: '' },
    } } });
    const record = readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1;
    expect(record?.status).toBe('complete');
    expect(record?.missingFields).toEqual([]);
    // complete 也不投影领域数组：完整条目只由整条 writes 路径产生
    expect(readAgentModuleSnapshot_ACU(chat).hooks).toEqual([]);
  });

  it('P1 指纹失配时基线被拒，但楼层本地逐栏 delta 仍折叠（与整条 delta 语义一致）', async () => {
    const chat: any[] = [{ mes: 'a' }, { mes: 'b' }, { mes: 'c' }, { mes: 'd' }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 3, snapshotAt(3));
    chat.push({ mes: 'e', is_user: false });
    await writeAgentModuleFields_ACU(chat, 4, { hooks: { P1: { summary: { value: 's' } } } });
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1?.status).toBe('partial');

    chat.splice(1, 1); // 水位前删楼 → 基线指纹失配被拒
    expect(readAgentModuleSnapshot_ACU(chat).hooks).toEqual([]);
    // 逐栏 delta 是未被删除楼层的本地物理内容，仍正常折叠
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.P1?.status).toBe('partial');
  });

  it('目标楼为 schema-1 legacy 全量时逐栏写被拒绝且原字段不动', async () => {
    const legacy = snapshotAt(0, { hooks: [hook('OLD') as any] });
    const chat: any[] = [{ mes: 'a', is_user: false, [AGENT_MODULE_FIELD_ACU]: legacy }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const before = JSON.stringify(chat[0][AGENT_MODULE_FIELD_ACU]);

    expect(await writeAgentModuleFields_ACU(chat, 0, { hooks: { P1: { summary: { value: 's' } } } })).toBe(false);
    // legacy 全量未被替换为 schema-3 帧：原字段逐字不动，仍可正常折叠
    expect(JSON.stringify(chat[0][AGENT_MODULE_FIELD_ACU])).toBe(before);
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['OLD']);
  });

  it('目标楼字段损坏时逐栏写被拒绝且抢救路径保留', async () => {
    const chat: any[] = [{
      mes: 'a',
      is_user: false,
      [AGENT_MODULE_FIELD_ACU]: {
        schemaVersion: 99,
        settledThroughIndex: 0,
        revisions: {},
        hooks: [hook('SALVAGED')],
      },
    }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    const before = JSON.stringify(chat[0][AGENT_MODULE_FIELD_ACU]);

    expect(await writeAgentModuleFields_ACU(chat, 0, { hooks: { P1: { summary: { value: 's' } } } })).toBe(false);
    expect(JSON.stringify(chat[0][AGENT_MODULE_FIELD_ACU])).toBe(before);
    // 抢救机会未丧失：宽容路径仍可复活损坏快照
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['SALVAGED']);
    expect(readAgentModuleSnapshotDiagnostics_ACU().salvaged).toBe(true);
  });
});
