import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_MODULE_FIELD_ACU, AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU, type AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import {
  buildEmptyAgentModuleSnapshot_ACU,
  agentModuleFrameDeps_ACU,
  readAgentModuleSnapshot_ACU,
  readAgentModuleSnapshotDiagnostics_ACU,
  writeAgentModuleSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-module-store';
import { relocateContinuationCheckpoint_ACU } from '../../../../src/service/continuation/agent/agent-module-frame';
import { notifyMaterialCheckpointFloor_ACU } from '../../../../src/service/chat/material-checkpoint-sync';
import { installMaterialCheckpointScheduler_ACU, readTableCheckpointCadence_ACU } from '../../../../src/service/continuation/agent/agent-checkpoint-scheduler';
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

describe('续写资料楼层增量折叠（TT-only 帧架构）', () => {
  it('多条 delta 按楼层顺序叠加后等于依次全量写入的结果', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);

    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0, { hooks: [hook('H1') as any] }));
    chat.push({ mes: 'b', is_user: false });
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [hook('H1') as any, hook('H2') as any] }));
    chat.push({ mes: 'c', is_user: false });
    await writeAgentModuleSnapshot_ACU(chat, 2, snapshotAt(2, { hooks: [hook('H2') as any] }));

    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['H2']);
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(2);
    expect(chat[0][AGENT_MODULE_FIELD_ACU].schemaVersion).toBe(AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU);
  });

  it('删掉中间楼或末楼后，该楼 delta 不再进入折叠', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0, { hooks: [hook('H1') as any] }));
    chat.push({ mes: 'b', is_user: false });
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [hook('H1') as any, hook('MID') as any] }));
    chat.push({ mes: 'c', is_user: false });
    await writeAgentModuleSnapshot_ACU(chat, 2, snapshotAt(2, { hooks: [hook('H1') as any, hook('MID') as any, hook('END') as any] }));

    const withoutEnd = chat.slice(0, 2);
    expect(readAgentModuleSnapshot_ACU(withoutEnd).hooks.map(item => item.id)).toEqual(['H1', 'MID']);

    const withoutMiddle = [chat[0], chat[2]];
    expect(readAgentModuleSnapshot_ACU(withoutMiddle).hooks.map(item => item.id)).toEqual(['H1', 'END']);
  });

  it('swipe 切走后不读取原 swipe 的基线和 delta，切回后恢复', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false, swipe_id: 0 }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 0, snapshotAt(0, { hooks: [hook('SWIPE0') as any] }));

    chat[0].swipe_id = 1;
    expect(readAgentModuleSnapshot_ACU(chat).hooks).toEqual([]);
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(-1);

    chat[0].swipe_id = 0;
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['SWIPE0']);
  });

  it('旧全量快照读取时归一成基线，磁盘 schema 保持不变', () => {
    const legacy = snapshotAt(3, { hooks: [hook('OLD') as any] });
    const chat = [{ mes: 'a', is_user: false, [AGENT_MODULE_FIELD_ACU]: legacy }];
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['OLD']);
    expect(chat[0][AGENT_MODULE_FIELD_ACU].schemaVersion).toBe(legacy.schemaVersion);
    expect(chat[0][AGENT_MODULE_FIELD_ACU].deltas).toBeUndefined();
  });

  it('表格 checkpoint 落层时续写基线搬到同一楼，之后的 delta 仍叠加', async () => {
    const chat: any[] = [
      { mes: 'root', is_user: false, TavernDB_ACU_IsolatedData: { '': { storageFrame: { version: 2, checkpoint: { kind: 'full', reason: 'init', data: {} }, logEntries: [] }, _acu_storage_version: 2 } } },
      { mes: 'mid', is_user: false },
      { mes: 'tail', is_user: false },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 2, snapshotAt(2, { hooks: [hook('LATE') as any] }));
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['LATE']);

    chat[0].TavernDB_ACU_IsolatedData[''].storageFrame.checkpoint = undefined;
    chat[2].TavernDB_ACU_IsolatedData = { '': { storageFrame: { version: 2, checkpoint: { kind: 'full', reason: 'periodic', data: {} }, logEntries: [] }, _acu_storage_version: 2 } };
    notifyMaterialCheckpointFloor_ACU(chat, 2);

    expect(chat[2][AGENT_MODULE_FIELD_ACU].checkpoint.snapshot.hooks.map((item: { id: string }) => item.id)).toEqual(['LATE']);
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['LATE']);
    expect(readTableCheckpointCadence_ACU().bufferLayers).toBe(20);
    expect(readTableCheckpointCadence_ACU().periodicStepLayers).toBe(20);
  });

  it('P1：水位前删楼导致前缀指纹失配时折叠拒绝复用旧基线', async () => {
    const chat: any[] = [{ mes: 'a' }, { mes: 'b' }, { mes: 'c' }, { mes: 'd' }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);
    await writeAgentModuleSnapshot_ACU(chat, 3, snapshotAt(3, { hooks: [hook('H1') as any] }));

    chat.splice(1, 1);

    expect(readAgentModuleSnapshot_ACU(chat).hooks).toEqual([]);
  });

  it('P1：水位前删楼后，尾楼损坏快照的宽容抢救也不得复活（salvage 指纹门控）', async () => {
    const chat: any[] = [
      { mes: 'a', is_user: false },
      { mes: 'b', is_user: false },
      { mes: 'c', is_user: false },
      { mes: 'd', is_user: false },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 3, snapshotAt(3, { hooks: [hook('H1') as any] }));

    // 水位前删楼：基线前缀指纹失配。
    chat.splice(1, 1);
    // 尾楼放一份可抢救的损坏快照（自身无指纹、条目合法）。
    chat.push({
      mes: 'e',
      is_user: false,
      [AGENT_MODULE_FIELD_ACU]: {
        schemaVersion: 99,
        settledThroughIndex: 1,
        revisions: {},
        hooks: [hook('SALVAGED')],
      },
    });

    const snapshot = readAgentModuleSnapshot_ACU(chat);
    expect(snapshot.hooks).toEqual([]);
    expect(snapshot.settledThroughIndex).toBe(-1);
    const diagnostics = readAgentModuleSnapshotDiagnostics_ACU();
    expect(diagnostics.salvaged).toBe(false);
    expect(diagnostics.adoptedIndex).toBeNull();
  });

  it('P1：水位前正文被替换后，尾楼损坏快照的宽容抢救也不得复活', async () => {
    const chat: any[] = [
      { mes: 'a', is_user: false },
      { mes: 'b', is_user: false },
      { mes: 'c', is_user: false },
      { mes: 'd', is_user: false },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 3, snapshotAt(3, { hooks: [hook('H1') as any] }));

    // 水位前正文被替换：基线前缀指纹失配（楼数不变）。
    chat[0].mes = 'TAMPERED';
    chat.push({
      mes: 'e',
      is_user: false,
      [AGENT_MODULE_FIELD_ACU]: {
        schemaVersion: 99,
        settledThroughIndex: 1,
        revisions: {},
        hooks: [hook('SALVAGED')],
      },
    });

    const snapshot = readAgentModuleSnapshot_ACU(chat);
    expect(snapshot.hooks).toEqual([]);
    expect(snapshot.settledThroughIndex).toBe(-1);
    expect(readAgentModuleSnapshotDiagnostics_ACU().salvaged).toBe(false);
  });

  it('旧 schema3 基线失配后写入自愈：建新 checkpoint 而不是在空基线上追 delta', async () => {
    const chat: any[] = [
      { mes: 'a', is_user: false },
      { mes: 'b', is_user: false },
      { mes: 'c', is_user: false },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 2, snapshotAt(1, { hooks: [hook('H1') as any] }));
    await writeAgentModuleSnapshot_ACU(chat, 2, snapshotAt(2, { hooks: [hook('H1') as any, hook('H2') as any] }));
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['H1', 'H2']);

    // 水位前正文被替换：基线指纹失配，折叠只剩旧 delta（H1 丢失为已知中间态）。
    chat[0].mes = 'TAMPERED';
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['H2']);

    await writeAgentModuleSnapshot_ACU(
      chat,
      2,
      snapshotAt(2, { hooks: [hook('H1') as any, hook('H2') as any, hook('H3') as any] }),
    );

    // 自愈：承载楼出现与新快照一致的新基线，而不是继续引用失配旧基线。
    const frame = chat[2][AGENT_MODULE_FIELD_ACU];
    expect(frame.checkpoint.snapshot.hooks.map((item: { id: string }) => item.id)).toEqual(['H1', 'H2', 'H3']);
    expect(frame.deltas).toEqual([]);
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['H1', 'H2', 'H3']);
  });

  it('strip 只清本次折进去的基线：他 swipe 的旧基线在搬运后仍保留，切回即恢复', () => {
    const deps = agentModuleFrameDeps_ACU();
    const chat: any[] = [
      { mes: 'a', is_user: false, [AGENT_MODULE_FIELD_ACU]: snapshotAt(0, { hooks: [hook('H0') as any] }) },
      {
        mes: 'b', is_user: false, swipe_id: 0,
        [AGENT_MODULE_FIELD_ACU]: {
          schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
          checkpoint: { swipeId: '1', snapshot: snapshotAt(0, { hooks: [hook('H1') as any] }) },
          deltas: [],
        },
      },
    ];

    expect(relocateContinuationCheckpoint_ACU(chat, 0, deps)).toBe(true);

    // f1 的基线属于 swipe 1，本次折叠（through 0、swipe 0）根本没采纳它，必须保留。
    expect(chat[1][AGENT_MODULE_FIELD_ACU]?.checkpoint?.swipeId).toBe('1');
    // 切回 swipe 1：旧基线仍在，资料恢复。
    chat[1].swipe_id = 1;
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['H1']);
  });

  it('strip 不碰锚点之后的基线：基线与其依赖 delta 必须互洽，不能只删基线留 delta', () => {
    const deps = agentModuleFrameDeps_ACU();
    const h3 = hook('H3');
    const chat: any[] = [
      { mes: 'a', is_user: false, [AGENT_MODULE_FIELD_ACU]: snapshotAt(0, { hooks: [hook('H0') as any] }) },
      { mes: 'b', is_user: false },
      {
        mes: 'c', is_user: false,
        [AGENT_MODULE_FIELD_ACU]: {
          schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
          checkpoint: { swipeId: '0', snapshot: snapshotAt(2, { hooks: [hook('H2') as any] }) },
          deltas: [{ seq: 1, swipeId: '0', writes: { hooks: [h3] }, revisions: {}, updatedAt: 1 }],
        },
      },
    ];

    expect(relocateContinuationCheckpoint_ACU(chat, 1, deps)).toBe(true);

    // 锚点（1）之后的基线不在本次折叠范围内，必须原样保留；否则 H0 基线 + H3 增量会拼出弗兰肯斯坦快照。
    expect(chat[2][AGENT_MODULE_FIELD_ACU]?.checkpoint?.snapshot.hooks.map((item: { id: string }) => item.id)).toEqual(['H2']);
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['H2', 'H3']);
  });

  it('模板重置形状：锚点恒为首个 AI 楼时尾部基线不被删除', () => {
    const deps = agentModuleFrameDeps_ACU();
    const h3 = hook('H3');
    const chat: any[] = [
      { mes: 'a', is_user: false, [AGENT_MODULE_FIELD_ACU]: snapshotAt(0, { hooks: [hook('H0') as any] }) },
      { mes: 'b', is_user: false },
      {
        mes: 'c', is_user: false,
        [AGENT_MODULE_FIELD_ACU]: {
          schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
          checkpoint: { swipeId: '0', snapshot: snapshotAt(2, { hooks: [hook('H2') as any] }) },
          deltas: [{ seq: 1, swipeId: '0', writes: { hooks: [h3] }, revisions: {}, updatedAt: 1 }],
        },
      },
    ];

    // 模板重置经 notify(chat, 0) 跟随新 init 根：尾部基线不在折叠范围内，必须无损。
    expect(relocateContinuationCheckpoint_ACU(chat, 0, deps)).toBe(true);
    expect(chat[2][AGENT_MODULE_FIELD_ACU]?.checkpoint?.snapshot.hooks.map((item: { id: string }) => item.id)).toEqual(['H2']);
    expect(chat[2][AGENT_MODULE_FIELD_ACU]?.deltas).toHaveLength(1);
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['H2', 'H3']);
  });
});
