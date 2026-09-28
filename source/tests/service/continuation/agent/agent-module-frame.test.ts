import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_MODULE_FIELD_ACU, AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU, type AgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-model';
import {
  buildEmptyAgentModuleSnapshot_ACU,
  agentModuleFrameDeps_ACU,
  readAgentModuleSnapshot_ACU,
  readAgentModuleFieldSnapshot_ACU,
  readAgentModuleSnapshotDiagnostics_ACU,
  writeAgentModuleSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-module-store';
import { assertSingleActiveContinuationCheckpoint_ACU, graftContinuationCheckpoint_ACU, relocateContinuationCheckpoint_ACU } from '../../../../src/service/continuation/agent/agent-module-frame';
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

  /**
   * TT 2.3.0 的一等工具楼 `{role:'tool', is_system:true}` 会被 `chat.push` 成**物理尾楼**
   * （src/scripts/tool-calling.js:1058-1089），且是「可被用户独立删除的真实楼层」
   * （docs/CurrentState/ChatPayload.md §4）。checkpoint 落进这种楼＝资料挂在随时会消失的楼上，
   * 用户一删就退回「无可用基线」，宽容抢救整条禁用。锚点判定必须走 shared/ai-floor。
   */
  it('尾楼是工具楼时，checkpoint 落在最近的 AI 楼而不是工具楼', async () => {
    const chat: any[] = [
      { mes: 'a', is_user: false },
      { mes: 'b', is_user: false },
      { role: 'tool', name: 'exa_search', is_system: true, is_user: false, mes: '{"tool":"result"}', tool_call_id: 'call_1', error: false },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);

    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [hook('H1') as any] }));

    // 工具楼不得承载帧数据（它可被独立删除，也没有 swipe_id）。
    expect(chat[2][AGENT_MODULE_FIELD_ACU]).toBeUndefined();
    expect(chat[1][AGENT_MODULE_FIELD_ACU]?.checkpoint?.snapshot.hooks.map((item: { id: string }) => item.id)).toEqual(['H1']);
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['H1']);
  });

  /**
   * 已有可用基线时走的是「追 delta」分支，delta 此前一律落在 targetIndex（调用方传的物理尾楼）。
   * 工具楼尾时 delta 就挂在可被用户独立删除的工具楼上：删楼即丢这一整段资料增量，
   * 且工具楼没有 swipe_id（delta 的 swipeId 会退化成 '0'，切 swipe 后失效判定失去意义）。
   * 折叠是按**楼层序**应用 delta 的，所以承载楼必须是「≤ targetIndex 的最近 AI 楼」，
   * 不能更早（否则新 delta 会排在既有 delta 之前被应用）。
   */
  it('尾楼是工具楼时，delta 落在最近的 AI 楼而不是工具楼（已有基线的追加分支）', async () => {
    const chat: any[] = [
      { mes: 'a', is_user: false },
      { mes: 'b', is_user: false },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [hook('H1') as any] }));
    expect(chat[1][AGENT_MODULE_FIELD_ACU]?.checkpoint).toBeDefined();

    // 工具轮把一等工具楼推成物理尾楼，主循环仍按 chat.length-1 派工结算。
    chat.push({ role: 'tool', name: 'exa_search', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1', error: false });
    await writeAgentModuleSnapshot_ACU(chat, 2, snapshotAt(2, { hooks: [hook('H1') as any, hook('H2') as any] }));

    expect(chat[2][AGENT_MODULE_FIELD_ACU], '工具楼不得承载 delta').toBeUndefined();
    expect(chat[1][AGENT_MODULE_FIELD_ACU]?.deltas).toHaveLength(1);
    // 资料一条不丢：折叠后仍是 H1+H2
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['H1', 'H2']);
    // 水位跟着**承载楼**走（不是调用方给的 targetIndex）：基线只声明结算到它真正所在的那一楼，
    // 否则用户删掉尾部的工具楼就会让前缀指纹失配（见下一条用例）。
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(1);
  });

  /**
   * 生产形状（agent-main-loop.persistSnapshot_ACU 恒传 chat.length - 1）：bootstrap（没有可用基线）
   * + 工具楼尾 + 水位被主循环推到 targetIndex。
   *
   * 这是本轮最容易踩的坑：checkpoint 落在 AI 楼，但水位与前缀指纹若仍按 targetIndex 计算，
   * 用户删掉那栋工具楼（TT 2.3.0 允许独立删除）就会让 `chatPrefixFingerprint` 失配
   * ⇒ 基线被折叠拒绝、宽容抢救一并禁用 ⇒ 资料**整体**清零（比修复前只丢最后一段增量更糟）。
   */
  it('bootstrap + 工具楼尾：删掉工具楼后资料必须还在', async () => {
    const chat: any[] = [
      { mes: 'AI 正文', is_user: false },
      { role: 'tool', name: 'exa_search', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1' },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);

    await writeAgentModuleSnapshot_ACU(chat, chat.length - 1, snapshotAt(chat.length - 1, { hooks: [hook('H1') as any] }));

    expect(chat[1][AGENT_MODULE_FIELD_ACU], '工具楼不得承载帧').toBeUndefined();
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['H1']);

    chat.splice(1, 1);
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id), '删掉工具楼不得让基线失效').toEqual(['H1']);
  });

  /**
   * 存量自愈：v9.8.8 及更早把 delta 追加在物理尾楼，所以聊天里可能已经有「挂在工具楼上的帧」。
   * 落点改到 AI 楼之后，折叠会先应用本楼的新 delta、再应用更晚楼层的遗留 delta（楼层序），
   * 遗留内容把新值覆盖回去 —— 用户改一次、提示成功、重读还是旧值。
   * 整条快照写入必须把遗留帧吸收进全量基线并摘掉它。
   */
  it('工具楼上的遗留帧：整条写入吸收其内容并摘掉，新值不被旧值覆盖', async () => {
    const chat: any[] = [
      { mes: 'AI 正文', is_user: false },
      {
        role: 'tool', name: 'exa_search', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1',
        [AGENT_MODULE_FIELD_ACU]: {
          schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
          deltas: [{
            seq: 1, swipeId: '0',
            writes: { hooks: [{ ...hook('OLD'), summary: '旧摘要' }] },
            revisions: { hooks: 1 },
            settledThroughIndex: 1,
            updatedAt: 1,
          }],
        },
      },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);

    // 前提：遗留帧当前确实被折叠采纳（否则本用例测不到东西）
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.summary)).toEqual(['旧摘要']);

    // 遗留 delta 把 hooks 修订号推到了 1：新快照必须带上同一修订号，否则先被乐观锁拦下（测不到落点）。
    const next = snapshotAt(1, { hooks: [{ ...hook('OLD'), summary: '新摘要' }, hook('NEW')] as any });
    next.revisions = { ...next.revisions, hooks: 1 };
    await writeAgentModuleSnapshot_ACU(chat, 1, next);

    expect(chat[1][AGENT_MODULE_FIELD_ACU], '遗留帧必须被摘掉，否则折叠序倒挂').toBeUndefined();
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.summary)).toEqual(['新摘要', '伏笔 NEW']);
  });

  it('嫁接基线拒绝非 AI 楼：与 relocate 同款门（否则基线会在折叠里吞掉更晚楼层的新增量）', () => {
    const deps = agentModuleFrameDeps_ACU();
    const artifact = { swipeId: '0', snapshot: snapshotAt(0, { hooks: [hook('H1') as any] }) };

    const toolFloor: any = { role: 'tool', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1' };
    expect(graftContinuationCheckpoint_ACU(toolFloor, artifact, deps)).toBe(false);
    expect(toolFloor[AGENT_MODULE_FIELD_ACU]).toBeUndefined();

    const hiddenFloor: any = { mes: '（已隐藏）', is_user: false, is_system: true };
    expect(graftContinuationCheckpoint_ACU(hiddenFloor, artifact, deps)).toBe(false);

    const aiFloor: any = { mes: 'AI 正文', is_user: false };
    expect(graftContinuationCheckpoint_ACU(aiFloor, artifact, deps)).toBe(true);
  });

  /**
   * 基线跟随表格楼层搬迁（relocateContinuationCheckpoint_ACU）。
   *
   * 折叠结果的指纹来自被采纳的旧基线、水位却已被后续 delta 推高（applyDelta 推水位但**不改指纹**），
   * 原样落盘就是一份自相矛盾的基线：下一轮折叠按新水位重算指纹必然失配 ⇒ 基线被整体拒绝、
   * incompatibleSeen 连带禁用宽容抢救、同 swipe 的 delta 又已被 strip 掉 ⇒ **资料全量静默清零**。
   * 表格 checkpoint 每次落层都会走到这里，触发面比「工具楼尾」大得多。
   * 夹具全程走真实落盘路径让 store 盖上与自身水位配对的指纹——手工造的帧不带指纹，
   * 正是这个缺陷长期测不出来的原因（无指纹在兼容门里恒判通过）。
   */
  it('基线跟随表格楼层搬迁后，资料必须原样可读且仍只有一个活跃基线', async () => {
    const chat: any[] = [
      { mes: 'a', is_user: false },
      { mes: 'b', is_user: false },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [hook('H1') as any] }));
    expect(chat[1][AGENT_MODULE_FIELD_ACU]?.checkpoint?.snapshot.settledPrefixFingerprint, '夹具必须带真实落盘指纹').toBeTruthy();

    chat.push({ mes: 'c', is_user: false }, { mes: 'd', is_user: false });
    const second = snapshotAt(2, { hooks: [hook('H1') as any, hook('H2') as any] });
    second.revisions = { ...second.revisions, hooks: 2 };
    await writeAgentModuleSnapshot_ACU(chat, 2, second);
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['H1', 'H2']);

    const deps = agentModuleFrameDeps_ACU();
    expect(relocateContinuationCheckpoint_ACU(chat, chat.length - 1, deps)).toBe(true);
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id), '搬迁不得让基线被折叠拒绝').toEqual(['H1', 'H2']);
    expect(assertSingleActiveContinuationCheckpoint_ACU(chat, deps)).toBeNull();
  });

  /**
   * 遗留帧自愈不得造出「同一 swipe 多个活跃基线」：旧基线在别的楼上，新基线是全量且已吸收它。
   * 一旦违反，删楼恢复里的 `assertSingleActiveContinuationCheckpoint_ACU` 会抛错整批回滚
   * （表格回放根与向量 checkpoint 一并嫁不进去），且调用方丢弃返回值 ⇒ 对用户完全静默。
   */
  it('遗留帧自愈后仍只有一个活跃基线（旧基线必须一并清掉）', async () => {
    const chat: any[] = [
      { mes: 'a', is_user: false },
      { mes: 'b', is_user: false },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [hook('H1') as any] }));

    chat.push({ mes: 'c', is_user: false });
    chat.push({
      role: 'tool', name: 'exa_search', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1',
      [AGENT_MODULE_FIELD_ACU]: {
        schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
        deltas: [{ seq: 1, swipeId: '0', writes: {}, revisions: {}, fieldUpserts: { hooks: { LEGACY: { summary: { value: '遗留草稿' } } } }, updatedAt: 1 }],
      },
    });

    const next = snapshotAt(3, { hooks: [hook('H1') as any, hook('H2') as any] });
    next.revisions = { ...next.revisions, hooks: 1 };
    await writeAgentModuleSnapshot_ACU(chat, 3, next);

    expect(chat[3][AGENT_MODULE_FIELD_ACU], '遗留帧已被摘除').toBeUndefined();
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['H1', 'H2']);
    expect(assertSingleActiveContinuationCheckpoint_ACU(chat, agentModuleFrameDeps_ACU())).toBeNull();
  });

  /**
   * 摘除必须只动「参与当前折叠」的内容：非 AI 楼上属于**他 swipe** 的遗留帧不参与折叠（折叠按
   * delta.swipeId === 本楼当前 swipe 才应用），它不是倒挂源，删掉就等于抹掉用户切回 swipe 时的恢复能力。
   * 与 relocate 侧既有纪律「他 swipe 的旧基线在搬运后仍保留，切回即恢复」同口径。
   */
  it('非 AI 楼上他 swipe 的遗留帧不得被摘除（切回 swipe 仍能恢复）', async () => {
    const hiddenFloor: any = {
      mes: '（用户已隐藏的楼）', is_user: false, is_system: true, swipe_id: 0,
      [AGENT_MODULE_FIELD_ACU]: {
        schemaVersion: AGENT_MODULE_FRAME_SCHEMA_VERSION_ACU,
        deltas: [{ seq: 1, swipeId: '1', writes: {}, revisions: {}, fieldUpserts: { hooks: { LEGACY: { summary: { value: '另一 swipe 的草稿' } } } }, updatedAt: 1 }],
      },
    };
    const chat: any[] = [{ mes: 'a', is_user: false }, hiddenFloor];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);

    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [hook('H1') as any] }));

    expect(chat[1][AGENT_MODULE_FIELD_ACU]?.deltas).toHaveLength(1);
    expect(chat[1][AGENT_MODULE_FIELD_ACU]?.deltas?.[0]?.swipeId).toBe('1');
    // 用户切回 swipe 1：遗留草稿必须重新参与折叠（走真实折叠，不能只读字段对象——那样恒真）
    chat[1].swipe_id = 1;
    expect(readAgentModuleFieldSnapshot_ACU(chat).records.hooks?.LEGACY?.fields.summary.value)
      .toBe('另一 swipe 的草稿');
  });

  it('隐藏楼（is_system）尾同样不得承载 delta：落在它前面最近的 AI 楼', async () => {
    const chat: any[] = [
      { mes: 'a', is_user: false },
      { mes: 'b', is_user: false },
    ];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [hook('H1') as any] }));

    chat.push({ mes: '（用户已隐藏的楼）', is_user: false, is_system: true });
    await writeAgentModuleSnapshot_ACU(chat, 2, snapshotAt(2, { hooks: [hook('H1') as any, hook('H2') as any] }));

    expect(chat[2][AGENT_MODULE_FIELD_ACU]).toBeUndefined();
    expect(readAgentModuleSnapshot_ACU(chat).hooks.map(item => item.id)).toEqual(['H1', 'H2']);
  });

  it('整条聊天没有 AI 楼时 fail-closed：一帧都不写，也不抛', async () => {
    const chat: any[] = [
      { mes: '用户输入', is_user: true },
      { role: 'tool', is_system: true, is_user: false, mes: '{"result":"x"}', tool_call_id: 'c1' },
    ];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);

    await writeAgentModuleSnapshot_ACU(chat, 1, snapshotAt(1, { hooks: [hook('H1') as any] }));

    expect(chat[0][AGENT_MODULE_FIELD_ACU]).toBeUndefined();
    expect(chat[1][AGENT_MODULE_FIELD_ACU]).toBeUndefined();
  });
});
