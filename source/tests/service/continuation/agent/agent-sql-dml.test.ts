import { describe, expect, it } from 'vitest';
import {
  parseAgentMaintainerOutput_ACU,
  parseAgentResearcherOutput_ACU,
} from '../../../../src/service/continuation/agent/agent-protocol';
import { AgentSubagentRuntime_ACU } from '../../../../src/service/continuation/agent/agent-subagent-runtime';
import { buildEmptyAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { buildDefaultContinuationSettings_ACU } from '../../../../src/service/continuation/defaults';

/** TT 判别测试：受限 SQL DML 写集映射为维护事务（移植上游 3fbc17f TT 子集，按本地脚手架重写）。 */
describe('受限 SQL 写集映射', () => {
  it('SQL 写集映射为维护事务，保留修订号、信息边界与显式退役', () => {
    const parsed = parseAgentMaintainerOutput_ACU({
      summary: '结算',
      sql: "INSERT INTO info_gap (id, topic, objective_fact, reader_known, character_knowledge, expected_revision) VALUES ('E2', '密信', '藏于木匣', '只见木匣', '[{\"name\":\"阿锦\",\"knows\":\"亲眼见到木匣\"}]', 2); UPDATE hooks SET summary = '新证据' WHERE id = 'H1' AND expected_revision = 3; DELETE FROM hooks WHERE id = 'H2' AND reason = '已被推翻' AND expected_revision = 3;",
    });
    expect(parsed.delta.expectedRevisions).toMatchObject({ infoGap: 2, hooks: 3 });
    expect(parsed.delta.infoGap[0]).toMatchObject({ objectiveFact: '藏于木匣', readerKnown: '只见木匣', characterKnowledge: [{ name: '阿锦', knows: '亲眼见到木匣' }] });
    expect(parsed.delta.hookPatches).toEqual([{ id: 'H1', summary: '新证据' }]);
    expect(parsed.delta.hooks).toEqual([expect.objectContaining({ action: 'retire', id: 'H2', reason: '已被推翻' })]);
  });

  it('SQL 拒绝越权、未知字段、额外 WHERE、混用 JSON 写集和非法修订号', () => {
    const parse = (sql: string) => parseAgentMaintainerOutput_ACU({ summary: '测试', sql });
    expect(() => parse("INSERT INTO web_refs (name) VALUES ('越权')")).toThrow(/无权/);
    expect(() => parse("INSERT INTO hooks (arbitrary) VALUES ('值')")).toThrow(/白名单/);
    expect(() => parse("UPDATE hooks SET summary = '假' WHERE id = 'H1' AND reason = '忽略' AND expected_revision = 0")).toThrow(/WHERE 不允许/);
    expect(() => parse("DELETE FROM hooks WHERE id = 'H1' AND reason = '删' AND expected_revision = -1")).toThrow(/非负整数/);
    expect(() => parseAgentMaintainerOutput_ACU({ sql: "DELETE FROM hooks WHERE id = 'H1' AND reason = '删'", delta: {} })).toThrow(/不能同时包含/);
    expect(() => parse(' ; ; ')).toThrow(/空写集/);
    expect(() => parseAgentResearcherOutput_ACU({ sql: ' ; ; ' })).toThrow(/空写集/);
    expect(() => parseAgentMaintainerOutput_ACU({ sql: "INSERT INTO hooks (id, summary) VALUES ('H1', '正常');", volumes: [{ id: 'V1', action: 'upsert', title: '夹带' }] })).toThrow(/不能同时包含 sql 与 JSON 写集字段 volumes/);
    expect(() => parseAgentMaintainerOutput_ACU({ sql: "INSERT INTO hooks (id, summary) VALUES ('H1', '正常');", expectedRevisions: { hooks: 999 } })).toThrow(/不能同时包含 sql 与 JSON 写集字段 expectedRevisions/);
  });

  it('SQL 更新及删除必须携带模块 revision，网页资料退役不需要 pageRef', () => {
    const retired = parseAgentResearcherOutput_ACU({ summary: '退役旧资料', sql: "DELETE FROM web_refs WHERE id = 'WR-001' AND reason = '来源失效' AND expected_revision = 4;" });
    expect(retired).toMatchObject({ expectedRevision: 4, items: [{ action: 'retire', id: 'WR-001', reason: '来源失效' }] });
    expect(() => parseAgentResearcherOutput_ACU({ sql: "DELETE FROM web_refs WHERE id = 'WR-001' AND reason = '来源失效';" })).toThrow(/expected_revision/);
    expect(() => parseAgentMaintainerOutput_ACU({ sql: "UPDATE hooks SET summary = '修正' WHERE id = 'H1';" })).toThrow(/expected_revision/);
    expect(() => parseAgentMaintainerOutput_ACU({ sql: "DELETE FROM hooks WHERE id = 'H1' AND reason = '过期';" })).toThrow(/expected_revision/);
  });

  it('网页资料与年代学 SQL UPDATE 经完整领域写集映射，不丢失 id 和 revision', () => {
    const web = parseAgentResearcherOutput_ACU({ summary: '更新百科', sql: "UPDATE web_refs SET page_ref = 'P1', name = '阿锦', brief = '人物', detail = '见网页' WHERE id = 'WR-001' AND expected_revision = 2;" });
    expect(web).toMatchObject({ expectedRevision: 2, items: [{ action: 'upsert', id: 'WR-001', pageRef: 'P1', title: '阿锦', brief: '人物' }] });
    const chronology = parseAgentMaintainerOutput_ACU({ summary: '修正时间', sql: "UPDATE chronology SET anchor = '隔日', elapsed = '两日', precision = 'exact', transition = '经过一夜', evidence_indexes = '[2]' WHERE id = 'T1' AND expected_revision = 4;" });
    expect(chronology.delta.expectedRevisions).toMatchObject({ chronology: 4 });
    expect(chronology.delta.chronology).toEqual([expect.objectContaining({ action: 'upsert', id: 'T1', anchor: '隔日', evidenceIndexes: [2] })]);
    expect(() => parseAgentResearcherOutput_ACU({ sql: "UPDATE hooks SET summary = '越权' WHERE id = 'H1';" })).toThrow(/只允许写入 web_refs/);
    expect(() => parseAgentResearcherOutput_ACU({ sql: "UPDATE web_refs SET brief = '不完整' WHERE id = 'WR-001' AND expected_revision = 0;" })).toThrow(/完整字段/);
  });

  it('DML 白名单之外一律拒绝：SELECT/DDL/函数/子查询不进事务', () => {
    expect(() => parseAgentMaintainerOutput_ACU({ summary: 'x', sql: 'SELECT * FROM hooks;' })).toThrow(/只允许 INSERT、UPDATE、DELETE/);
    expect(() => parseAgentMaintainerOutput_ACU({ summary: 'x', sql: "UPDATE hooks SET summary = upper(summary) WHERE id = 'H1' AND expected_revision = 0;" })).toThrow(/只允许字符串、数字或 NULL/);
  });

  it('researcher 的 sql 不能与顶层旧 JSON 写集字段混用（混用即拒绝，不静默丢弃）', () => {
    const sql = "INSERT INTO web_refs (page_ref, name, brief, detail, expected_revision) VALUES ('P1', '实体', '简介', '详情', 0);";
    expect(() => parseAgentResearcherOutput_ACU({ summary: 'x', sql, webRefs: [{ action: 'upsert', pageRef: 'P1', name: '夹带', brief: '夹带' }] })).toThrow(/不能同时包含 sql 与 JSON 写集字段 webRefs/);
    expect(() => parseAgentResearcherOutput_ACU({ summary: 'x', sql, entries: [] })).toThrow(/不能同时包含 sql 与 JSON 写集字段 entries/);
    expect(() => parseAgentResearcherOutput_ACU({ summary: 'x', sql, items: [] })).toThrow(/不能同时包含 sql 与 JSON 写集字段 items/);
    expect(() => parseAgentResearcherOutput_ACU({ summary: 'x', sql, expectedRevisions: { webRefs: 0 } })).toThrow(/不能同时包含 sql 与 JSON 写集字段 expectedRevisions/);
  });
});

describe('SQL 写集运行时修订守卫', () => {
  const preset_ACU = { presetName: 'p1', source: 'settings', reason: 'test' } as any;
  function baseInput_ACU(agentName: string): Parameters<AgentSubagentRuntime_ACU['run']>[0] {
    const settings = buildDefaultContinuationSettings_ACU();
    settings.promptCacheEnabled = true;
    settings.internalAiRetryLimit = 0;
    return {
      delegation: { agentName, prompt: '任务', reads: [] },
      settings,
      resolveContext: {
        chat: [{ mes: '继续', is_user: true }, { mes: '正文。', is_user: false }],
        moduleSnapshot: buildEmptyAgentModuleSnapshot_ACU(),
        settledThroughIndex: 0,
        execution: { envelope: {}, task: { taskId: 't', stages: [] }, stage: null, revision: null, node: null, turn: null, turnNumber: null, nodeTurnNumber: null } as any,
        originInstruction: '推进剧情',
        recentTurnCount: 2,
        tableData: {},
      },
      budget: { maxIterations: 4, maxDelegations: 4, maxSameAgent: 2, maxConcurrent: 1, maxReads: 8, maxExtraReads: 1 },
      preset: preset_ACU,
      createIdentity: (_name: string, attempt: number) => ({ taskId: 't', stageId: 's', turnId: 'u', attemptId: `a-${attempt}`, source: 'agent_subagent' }) as any,
      isCurrent: () => true,
    };
  }

  it('researcher SQL revision 与读集不一致时拒绝', async () => {
    const sql = JSON.stringify({ summary: '检索', sql: "INSERT INTO web_refs (page_ref, name, brief, detail, expected_revision) VALUES ('P1', '实体', '简介', '详情', 999);" });
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async () => sql,
    } as any);
    // 空快照 webRefs revision 为 0，声明 999 必须被守卫拦下（经重试耗尽后抛子代理失败，原因进 lastReason）。
    const error = await runtime.run(baseInput_ACU('web-researcher')).then(() => null, (e: any) => e);
    expect(error).toBeTruthy();
    const lastReason = (error as any)?.error?.details?.lastReason as string;
    expect(lastReason).toContain('expected_revision 与派工读集 revision 不一致');
  });

  it('maintainer SQL revision 与读集不一致时拒绝', async () => {
    const sql = JSON.stringify({ summary: '结算', sql: "UPDATE hooks SET summary = '新' WHERE id = 'H1' AND expected_revision = 999;" });
    const runtime = new AgentSubagentRuntime_ACU({
      resolveApiPreset: (() => preset_ACU) as any,
      callInternalAi: async () => sql,
    } as any);
    const error = await runtime.run(baseInput_ACU('hook-cognition-maintainer')).then(() => null, (e: any) => e);
    expect(error).toBeTruthy();
    const lastReason = (error as any)?.error?.details?.lastReason as string;
    expect(lastReason).toContain('SQL expected_revision 与派工读集 revision 不一致');
  });
});

describe('SQL 提示词与版本迁移', () => {
  it('默认提示词切换为受限 SQL 写集且版本推进到 V34（V33 信息边界纪律保持，V34 对齐 SQL 提示词）', async () => {
    const { buildDefaultContinuationSettings_ACU, CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V34_ACU } = await import('../../../../src/service/continuation/defaults');
    const { buildDefaultContinuationAgentPrompts_ACU, findAgentPromptSlot_ACU } = await import('../../../../src/service/continuation/agent/agent-defaults');
    const settings = buildDefaultContinuationSettings_ACU();
    expect(settings.promptForceDefaultVersion).toBe(CONTINUATION_PROMPT_FORCE_DEFAULT_VERSION_V34_ACU);
    const prompts = buildDefaultContinuationAgentPrompts_ACU();
    for (const role of ['arcArchitect', 'maintainer', 'webResearcher'] as const) {
      const contract = findAgentPromptSlot_ACU((prompts as any)[role], 'outputContract')?.content ?? '';
      expect(contract).toContain('sql');
      expect(contract).toContain('expected_revision');
      expect(contract).toContain('不输出 delta');
    }
    // 终审 JSON 契约不变：finalReviewer 仍用 delta/verdict，不出现 sql 写集。
    const reviewer = findAgentPromptSlot_ACU((prompts as any).finalReviewer, 'outputContract')?.content ?? '';
    expect(reviewer).not.toContain('INSERT INTO');
  });
});
