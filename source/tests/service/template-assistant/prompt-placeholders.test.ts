import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockCallAIWithPreset,
  mockCompileTemplateAssistantDraft,
  mockBuildTemplateAssistantCumulativeCompileResult,
  mockPreflightSchemaMigrations,
} = vi.hoisted(() => ({
  mockCallAIWithPreset: vi.fn(),
  mockPreflightSchemaMigrations: vi.fn(async () => ({ changedSheetKeys: [], blockers: [], operations: [] })),
  mockCompileTemplateAssistantDraft: vi.fn((input: any) => ({
    candidateData: input.tempData,
    orderedSheetKeys: input.sheetOrder || [],
    deletedSheetKeys: [],
    focusSheetKey: input.currentSheetKey,
    diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
    highRiskItems: [],
    lockChanges: [],
    schemaMigrationIntents: {},
  })),
  mockBuildTemplateAssistantCumulativeCompileResult: vi.fn((input: any) => ({
    candidateData: input.candidateData,
    orderedSheetKeys: input.candidateSheetOrder || [],
    deletedSheetKeys: [],
    focusSheetKey: input.focusSheetKey || null,
    diff: { addedSheets: [], deletedSheets: [], renamedSheets: [], movedSheets: [], patchedSourceDataSheets: [], patchedUpdateConfigSheets: [], patchedExportConfigSheets: [], patchedContentSheets: [], patchedSchemaSheets: [], patchedLockSheets: [], globalInjectionChanged: false },
    highRiskItems: [],
    lockChanges: [],
    schemaMigrationIntents: {},
  })),
}));

vi.mock('../../../src/service/ai/api-call', () => ({
  callAIWithPreset_ACU: mockCallAIWithPreset,
}));

// settings_ACU 为可变对象，方便测试中修改 templateAssistantPromptSegments
vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: { tableApiPreset: 'preset-1', apiPresets: [], tableApiPresetOverridesByName: {}, templateAssistantPromptSegments: [] },
}));

vi.mock('../../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: (data: any) => Object.keys(data || {}).filter((key) => key.startsWith('sheet_')).sort((a, b) => (data[a]?.orderNo ?? 0) - (data[b]?.orderNo ?? 0)),
}));

vi.mock('../../../src/service/worldbook/injection-engine', async () => {
  const actual = await vi.importActual<any>('../../../src/service/worldbook/injection-engine-config');
  return {
    getGlobalInjectionConfigFromData_ACU: actual.getGlobalInjectionConfigFromData_ACU,
  };
});

vi.mock('../../../src/service/template-assistant/compiler', () => ({
  compileTemplateAssistantDraft_ACU: mockCompileTemplateAssistantDraft,
  buildTemplateAssistantCumulativeCompileResult_ACU: mockBuildTemplateAssistantCumulativeCompileResult,
}));

vi.mock('../../../src/service/table/schema-migration-preflight', () => ({
  preflightSchemaMigrations_ACU: mockPreflightSchemaMigrations,
}));

import {
  applyTemplateAssistantPlaceholders_ACU,
  buildAssistantPlaceholderContext_ACU,
  buildTemplateAssistantMessages_ACU,
  buildPseudoRoleTemplateAssistantPromptSegments_ACU,
  buildUserPromptPayload_ACU,
  stringifyPlaceholderValue_ACU,
  TEMPLATE_ASSISTANT_PAYLOAD_PARTITION_ACU,
  TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU,
  TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU,
  TEMPLATE_ASSISTANT_PLACEHOLDER_CURRENT_SHEET_ACU,
  TEMPLATE_ASSISTANT_PLACEHOLDER_ALL_SHEETS_ACU,
  TEMPLATE_ASSISTANT_PLACEHOLDER_PROTOCOL_ACU,
  TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU,
} from '../../../src/service/template-assistant/service';
import { settings_ACU } from '../../../src/service/runtime/state-manager';

function buildTempData_ACU() {
  return {
    mate: {
      type: 'chatSheets',
      version: 1,
      globalInjectionConfig: {
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      },
    },
    sheet_a: {
      uid: 'sheet_a',
      name: 'A表',
      orderNo: 0,
      content: [['row_id', '姓名'], [1, '甲']],
      headers: ['row_id', '姓名'],
      sourceData: { note: 'a', initNode: '', insertNode: '', updateNode: '', deleteNode: '' },
      updateConfig: { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1, sendLatestRows: -1, groupId: -1 },
      exportConfig: {},
    },
  };
}

function buildInput_ACU() {
  return {
    tempData: buildTempData_ACU(),
    currentSheetKey: 'sheet_a',
    userRequest: '新增一列 备注',
    protocolVersion: 2,
    priorTurns: [
      { user: '帮我看看当前表', assistant: '好的，当前表为 A表' },
    ],
  };
}

beforeEach(() => {
  settings_ACU.templateAssistantPromptSegments = [];
});

describe('applyTemplateAssistantPlaceholders_ACU 替换安全', () => {
  it("值含 $& / $` / $' / $1 / $<x> 时输出字面完全一致（不解释 $ 特殊序列）", () => {
    const valueMap: Record<string, string> = {
      [TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU]: 'a$&b$`c$\'d$1e$<x>f',
    };
    const out = applyTemplateAssistantPlaceholders_ACU(
      `需求：${TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU}`,
      valueMap,
    );
    expect(out).toBe('需求：a$&b$`c$\'d$1e$<x>f');
  });

  it('$1 值内含 $3 字面量时，$3 不被二次替换（单次扫描消除跨 token 污染）', () => {
    const valueMap: Record<string, string> = {
      [TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU]: `需要引用 ${TEMPLATE_ASSISTANT_PLACEHOLDER_ALL_SHEETS_ACU} 的数据`,
      [TEMPLATE_ASSISTANT_PLACEHOLDER_ALL_SHEETS_ACU]: '全局结构',
    };
    const out = applyTemplateAssistantPlaceholders_ACU(
      `${TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU} | ${TEMPLATE_ASSISTANT_PLACEHOLDER_ALL_SHEETS_ACU}`,
      valueMap,
    );
    // $3 在 $1 值内保持字面量，模板中独立的 $3 被替换
    expect(out).toBe(`需要引用 ${TEMPLATE_ASSISTANT_PLACEHOLDER_ALL_SHEETS_ACU} 的数据 | 全局结构`);
  });

  it('valueMap 缺 key 时保留原 token 字面量', () => {
    const out = applyTemplateAssistantPlaceholders_ACU(
      `当前表：${TEMPLATE_ASSISTANT_PLACEHOLDER_CURRENT_SHEET_ACU}`,
      {},
    );
    expect(out).toBe(`当前表：${TEMPLATE_ASSISTANT_PLACEHOLDER_CURRENT_SHEET_ACU}`);
  });
});

describe('stringifyPlaceholderValue_ACU 序列化', () => {
  it('string 原样，number/boolean 走 String，对象走 safeJson', () => {
    expect(stringifyPlaceholderValue_ACU('abc')).toBe('abc');
    expect(stringifyPlaceholderValue_ACU(42)).toBe('42');
    expect(stringifyPlaceholderValue_ACU(true)).toBe('true');
    expect(stringifyPlaceholderValue_ACU({ a: 1 })).toBe('{"a":1}');
  });
});

describe('payload partition 完备性', () => {
  it('四组字段名并集 === payload 键集（双向包含）', () => {
    const partitionKeys = new Set<string>();
    Object.values(TEMPLATE_ASSISTANT_PAYLOAD_PARTITION_ACU).forEach((keys) => keys.forEach((k) => partitionKeys.add(k)));
    const payload = buildUserPromptPayload_ACU(buildInput_ACU() as any, 'acu-struct:fp');
    const payloadKeys = Object.keys(payload);

    // 每个 partition 字段都真实存在于 payload
    partitionKeys.forEach((k) => expect(payloadKeys).toContain(k));
    // payload 每个顶层键都被 partition 覆盖（无遗漏）
    payloadKeys.forEach((k) => expect(partitionKeys.has(k)).toBe(true));
  });

  it('占位符元数据: 5 项，kind=data 恰好 4 条', () => {
    expect(TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU).toHaveLength(5);
    expect(TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU.filter((d) => d.kind === 'data')).toHaveLength(4);
    expect(TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU.filter((d) => d.kind === 'reference')).toHaveLength(1);
  });
});

describe('buildUserPromptPayload_ACU 字节级兼容', () => {
  it('payload 序列化为紧凑 JSON，且 baseFingerprint / userRequest 参与序列化', () => {
    const payload = buildUserPromptPayload_ACU(buildInput_ACU() as any, 'acu-struct:fp');
    // buildUserPrompt 是薄封装：safeJsonStringify(payload)，与 JSON.stringify 一致（无 undefined 键）
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
    expect(String(payload.userRequest)).toBe('新增一列 备注');
    expect(payload.baseFingerprint).toBe('acu-struct:fp');
  });
});

describe('buildAssistantPlaceholderContext_ACU 映射', () => {
  it('$1-$4 分别映射到对应 payload 切片', () => {
    const payload = buildUserPromptPayload_ACU(buildInput_ACU() as any, 'acu-struct:fp');
    const map = buildAssistantPlaceholderContext_ACU(payload, 'REF');
    expect(map[TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU]).toBe('新增一列 备注');
    expect(map[TEMPLATE_ASSISTANT_PLACEHOLDER_CURRENT_SHEET_ACU]).toContain('"selectedSheetKey":"sheet_a"');
    expect(map[TEMPLATE_ASSISTANT_PLACEHOLDER_ALL_SHEETS_ACU]).toContain('"sheetCount":1');
    expect(map[TEMPLATE_ASSISTANT_PLACEHOLDER_PROTOCOL_ACU]).toContain('"protocolVersion":2');
    expect(map[TEMPLATE_ASSISTANT_REFERENCE_DOCS_PLACEHOLDER_ACU]).toBe('REF');
  });
});

describe('伪 role 模板结构', () => {
  it('第 1 张 SYSTEM 卡包含完整标签字面量与 9 个顶层键清单', () => {
    const segments = buildPseudoRoleTemplateAssistantPromptSegments_ACU(2);
    const first = segments[0]!;
    expect(first.role).toBe('SYSTEM');
    expect(first.content).toContain('<templateAssistantDraft>');
    expect(first.content).toContain('</templateAssistantDraft>');
    expect(first.content).toContain('不要使用 <draft>');
    ['protocolVersion', 'mode', 'requestId', 'baseFingerprint', 'atomic', 'selectedSheetKey', 'summary', 'warnings', 'operations'].forEach(key => {
      expect(first.content).toContain(key);
    });
    expect(first.content).toContain('op 字段');
    expect(first.content).toContain('禁止使用');
    expect(first.content).toContain('type');
    expect(first.content).toContain('constraints');
    expect(first.content).toContain('requestIdRequired');
  });

  it('第 3 张 USER 协议卡包含全部 11 个白名单操作名且不含 patch_sheet_ddl', () => {
    const segments = buildPseudoRoleTemplateAssistantPromptSegments_ACU(2);
    const third = segments[2]!;
    expect(third.role).toBe('USER');
    const whitelist = [
      'add_sheet',
      'rename_sheet',
      'delete_sheet',
      'move_sheet',
      'patch_sheet_source_data',
      'patch_sheet_update_config',
      'patch_sheet_export_config',
      'patch_sheet_content',
      'patch_sheet_schema',
      'patch_sheet_locks',
      'patch_global_injection_config',
    ];
    whitelist.forEach(op => expect(third.content).toContain(op));
    expect(third.content).toContain('patch_sheet_schema');
    // 白名单行（操作白名单…）本身不得包含 patch_sheet_ddl（防回归）
    const whitelistLine = third.content.split('\n').find(line => line.includes('操作白名单')) || '';
    expect(whitelistLine).not.toContain('patch_sheet_ddl');
    // 但整卡必须包含「不存在 patch_sheet_ddl 操作」的教育句（实测踩坑项，不能删）
    expect(third.content).toContain('不存在 patch_sheet_ddl 操作');
    expect(third.content).toContain('add_sheet');
    expect(third.content).toContain('sheetKey');
    expect(third.content).toContain('note');
    expect(third.content).toContain('initNode');
    expect(third.content).toContain('insertNode');
    expect(third.content).toContain('updateNode');
    expect(third.content).toContain('deleteNode');
    expect(third.content).toContain('operations');
    expect(third.content).toContain('warnings');
  });

  it('10 卡，恰 1 张含 $1 且下标 8，末条 role 为 assistant 且不含 draft 开标签，role 交替', () => {
    const segments = buildPseudoRoleTemplateAssistantPromptSegments_ACU(2);
    expect(segments).toHaveLength(10);

    const dollarOneIndexes = segments
      .map((seg, i) => (seg.content.includes(TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU) ? i : -1))
      .filter((i) => i >= 0);
    expect(dollarOneIndexes).toEqual([8]);

    const last = segments[segments.length - 1]!;
    expect(last.role).toBe('assistant');
    expect(last.content).not.toContain('<templateAssistantDraft>');
    expect(last.content).not.toContain('{');

    // role 交替：SYSTEM → assistant → USER → assistant …
    const roles = segments.map((seg) => seg.role);
    expect(roles[0]).toBe('SYSTEM');
    expect(roles[1]).toBe('assistant');
    expect(roles[2]).toBe('USER');
    expect(roles[3]).toBe('assistant');
    expect(roles[4]).toBe('USER');
    expect(roles[5]).toBe('assistant');
    expect(roles[6]).toBe('USER');
    expect(roles[7]).toBe('assistant');
    expect(roles[8]).toBe('USER');
    expect(roles[9]).toBe('assistant');
  });
});

describe('buildTemplateAssistantMessages_ACU 消息组装', () => {
  it('空 segments → 与现状等价：小写 system + priorTurns + 完整 payload', () => {
    settings_ACU.templateAssistantPromptSegments = [];
    const messages = buildTemplateAssistantMessages_ACU(buildInput_ACU() as any, 'acu-struct:fp');
    expect(messages[0]?.role).toBe('system');
    // 中间是 priorTurns（user/assistant 交替）
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toBe('帮我看看当前表');
    expect(messages[2]?.role).toBe('assistant');
    expect(messages[2]?.content).toBe('好的，当前表为 A表');
    // 末尾是完整 payload
    const last = messages[messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(last.content).toContain('"userRequest":"新增一列 备注"');
    expect(last.content).toContain('"baseFingerprint":"acu-struct:fp"');
  });

  it('segments 无任何 $1-$4 → 仍追加完整 payload', () => {
    settings_ACU.templateAssistantPromptSegments = [
      { role: 'SYSTEM', content: '你是助手', deletable: false },
    ];
    const messages = buildTemplateAssistantMessages_ACU(buildInput_ACU() as any, 'acu-struct:fp');
    expect(messages[0]?.role).toBe('SYSTEM');
    // 无 referenceDocs 占位符 → T5 防呆在 SYSTEM 卡末尾追加引用文档
    expect(messages[0]?.content).toContain('你是助手');
    // 无 $1 anchor → priorTurns 追加在 segments 之后
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toBe('帮我看看当前表');
    expect(messages[2]?.role).toBe('assistant');
    expect(messages[2]?.content).toBe('好的，当前表为 A表');
    const last = messages[messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(last.content).toContain('"userRequest":"新增一列 备注"');
  });

  it('有数据 token → 不自动追加 payload', () => {
    settings_ACU.templateAssistantPromptSegments = [
      { role: 'SYSTEM', content: `需求：${TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU}`, deletable: false },
    ];
    const messages = buildTemplateAssistantMessages_ACU(buildInput_ACU() as any, 'acu-struct:fp');
    // 单卡含 $1 → anchorIndex=0，多轮分支：提示词组整体放最顶 + priorTurns + 末尾 USER
    // messages = [该卡(已替换$1)] + priorTurns(2) + USER(1) = 4 条
    expect(messages).toHaveLength(4);
    expect(messages[0]?.role).toBe('SYSTEM');
    expect(messages[0]?.content).toContain('需求：新增一列 备注');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toBe('帮我看看当前表');
    expect(messages[2]?.role).toBe('assistant');
    expect(messages[2]?.content).toBe('好的，当前表为 A表');
    expect(messages[3]?.role).toBe('USER');
    expect(messages[3]?.content).toBe('新增一列 备注');
    // SYSTEM 卡无 referenceDocs 占位符 → T5 防呆在末尾追加引用文档
  });

  it('多轮：含 $1 模板其提示词组整体放最顶，priorTurns 紧跟其后，本轮需求作为最后 USER（两张含 $1 卡）', () => {
    settings_ACU.templateAssistantPromptSegments = [
      { role: 'SYSTEM', content: `说明：${TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU}`, deletable: true },
      { role: 'USER', content: `现在执行：${TEMPLATE_ASSISTANT_PLACEHOLDER_USER_REQUEST_ACU}`, deletable: true },
    ];
    const messages = buildTemplateAssistantMessages_ACU(buildInput_ACU() as any, 'acu-struct:fp');
    // resolved = [卡0(已替换), 卡1(已替换)]，anchorIndex=1（含 $1）
    // messages = 提示词组整体(卡0+卡1) + priorTurns(2) + 末尾 USER(1) = 5
    expect(messages).toHaveLength(5);
    expect(messages[0]?.role).toBe('SYSTEM');
    expect(messages[0]?.content).toContain('说明：新增一列 备注');
    expect(messages[1]?.role).toBe('USER');
    expect(messages[1]?.content).toContain('现在执行：新增一列 备注');
    expect(messages[2]?.role).toBe('user');
    expect(messages[2]?.content).toBe('帮我看看当前表');
    expect(messages[3]?.role).toBe('assistant');
    expect(messages[3]?.content).toBe('好的，当前表为 A表');
    expect(messages[4]?.role).toBe('USER');
    expect(messages[4]?.content).toBe('新增一列 备注');
  });

  it('无 $1 但有 $2 → priorTurns 追加在所有 segments 之后', () => {
    settings_ACU.templateAssistantPromptSegments = [
      { role: 'SYSTEM', content: `当前表：${TEMPLATE_ASSISTANT_PLACEHOLDER_CURRENT_SHEET_ACU}`, deletable: false },
    ];
    const messages = buildTemplateAssistantMessages_ACU(buildInput_ACU() as any, 'acu-struct:fp');
    // anchorIndex=-1，有 $2 → 不追加 payload；priorTurns 追加在 segments 后
    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe('SYSTEM');
    expect(messages[0]?.content).toContain('"selectedSheetKey":"sheet_a"');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toBe('帮我看看当前表');
    expect(messages[2]?.role).toBe('assistant');
    expect(messages[2]?.content).toBe('好的，当前表为 A表');
  });

  it('带 pinned 标记但无 $1 → 提示词组整体放最前，历史与本轮 USER 紧随其后', () => {
    settings_ACU.templateAssistantPromptSegments = [
      { role: 'SYSTEM', content: '固定规则卡', deletable: false, pinned: true },
      { role: 'USER', content: '用户临时补充卡', deletable: true },
    ];
    const messages = buildTemplateAssistantMessages_ACU(buildInput_ACU() as any, 'acu-struct:fp');
    // hasPinned → 提示词组整体(2) + 历史(2) + 本轮 USER(1) = 5
    expect(messages).toHaveLength(5);
    // 带 pinned 的卡放最前
    expect(messages[0]?.role).toBe('SYSTEM');
    expect(messages[0]?.content).toContain('固定规则卡');
    expect(messages[1]?.role).toBe('USER');
    expect(messages[1]?.content).toContain('用户临时补充卡');
    // 历史紧随其后
    expect(messages[2]?.role).toBe('user');
    expect(messages[2]?.content).toBe('帮我看看当前表');
    expect(messages[3]?.role).toBe('assistant');
    expect(messages[3]?.content).toBe('好的，当前表为 A表');
    // 本轮用户需求为最后一条
    expect(messages[4]?.role).toBe('USER');
    expect(messages[4]?.content).toBe('新增一列 备注');
  });


  it('伪 role 模板 + priorTurns → 提示词组整体放最前（预填充卡位于词组内），历史与本轮 USER 紧随其后', () => {
    settings_ACU.templateAssistantPromptSegments = buildPseudoRoleTemplateAssistantPromptSegments_ACU(2);
    const messages = buildTemplateAssistantMessages_ACU(buildInput_ACU() as any, 'acu-struct:fp');
    // 结构：提示词组整体(10) + 历史(2) + 本轮 USER(1) = 13
    expect(messages).toHaveLength(13);
    // 预填充卡位于提示词组内（下标 9），不再恒在末尾
    const prefill = messages[9]!;
    expect(prefill.role).toBe('assistant');
    expect(prefill.content).toBe('收到，我不会输出解释文本，现在直接输出完整的 draft 标签与 JSON：');
    // 预填充卡不含 draft 开标签
    expect(prefill.content).not.toContain('<templateAssistantDraft>');
    // 真实历史跟随提示词组之后（下标 10、11），本轮 USER 为最后一条（下标 12）
    expect(messages[10]?.role).toBe('user');
    expect(messages[10]?.content).toBe('帮我看看当前表');
    expect(messages[11]?.role).toBe('assistant');
    expect(messages[11]?.content).toBe('好的，当前表为 A表');
    expect(messages[12]?.role).toBe('USER');
    expect(messages[12]?.content).toBe('新增一列 备注');
    // 伪 role 模板含 $1 → 不追加完整 payload user 消息
    const userPayloadCount = messages.filter((m) => m.role === 'user' && m.content.includes('"userRequest"')).length;
    expect(userPayloadCount).toBe(0);
  });

  it('buildTemplateAssistantMessages_ACU 仍为同步函数（返回值不是 Promise）', () => {
    const result = buildTemplateAssistantMessages_ACU(buildInput_ACU() as any, 'acu-struct:fp');
    expect(result).not.toBeInstanceOf(Promise);
  });
});

  it('首轮（无 priorTurns）：完整伪 role 结构，含卡 9 包装语，末条为预填充卡', () => {
    settings_ACU.templateAssistantPromptSegments = buildPseudoRoleTemplateAssistantPromptSegments_ACU(2);
    const messages = buildTemplateAssistantMessages_ACU(
      { ...buildInput_ACU(), priorTurns: [] } as any,
      'acu-struct:fp',
    );
    // 首轮：完整 10 卡结构，不额外追加 payload
    expect(messages).toHaveLength(10);
    // 卡 9 包装语只出现一次（$1 替换后是本轮需求）
    const wrapperCount = messages.filter((m) => m.content.includes('现在请按照我的需求立刻开始工作')).length;
    expect(wrapperCount).toBe(1);
    // 末条为预填充卡
    const last = messages[messages.length - 1]!;
    expect(last.role).toBe('assistant');
    expect(last.content).toBe('收到，我不会输出解释文本，现在直接输出完整的 draft 标签与 JSON：');
  });

  it('多轮：伪 role 提示词组整体放最顶（含卡 9 包装语与卡 10 预填充），真实历史按 user→assistant 顺序，本轮需求作为最后 USER 消息', () => {
    settings_ACU.templateAssistantPromptSegments = buildPseudoRoleTemplateAssistantPromptSegments_ACU(2);
    const messages = buildTemplateAssistantMessages_ACU(
      {
        ...buildInput_ACU(),
        priorTurns: [
          { user: '第一轮需求', assistant: '<templateAssistantDraft>{}</templateAssistantDraft>' },
        ],
        userRequest: '第二轮需求',
      } as any,
      'acu-struct:fp',
    );
    // 结构：提示词组整体(10，含卡9包装语与卡10预填充) + 真实历史(2) + 本轮 USER(1) = 13
    expect(messages).toHaveLength(13);
    // 卡 9 包装语出现在最顶（提示词组内，$1 替换为第二轮需求）
    const wrapperCount = messages.filter((m) => m.content.includes('现在请按照我的需求立刻开始工作')).length;
    expect(wrapperCount).toBe(1);
    // 提示词组固定在最顶：末位卡 10 预填充位于下标 9
    expect(messages[0]?.role).toBe('SYSTEM');
    expect(messages[9]?.role).toBe('assistant');
    expect(messages[9]?.content).toBe('收到，我不会输出解释文本，现在直接输出完整的 draft 标签与 JSON：');
    // 真实历史按 user→assistant 顺序紧跟提示词组之后（下标 10、11）
    expect(messages[10]?.role).toBe('user');
    expect(messages[10]?.content).toBe('第一轮需求');
    expect(messages[11]?.role).toBe('assistant');
    expect(messages[11]?.content).toBe('<templateAssistantDraft>{}</templateAssistantDraft>');
    // 本轮需求作为最后一条独立 USER 消息（下标 12）
    expect(messages[12]?.role).toBe('USER');
    expect(messages[12]?.content).toBe('第二轮需求');
  });


  it('多轮：不追加完整 payload（不存在含 userRequest 的 JSON 消息）', () => {
    settings_ACU.templateAssistantPromptSegments = buildPseudoRoleTemplateAssistantPromptSegments_ACU(2);
    const messages = buildTemplateAssistantMessages_ACU(buildInput_ACU() as any, 'acu-struct:fp');
    const userPayloadCount = messages.filter((m) => m.role === 'user' && m.content.includes('"userRequest"')).length;
    expect(userPayloadCount).toBe(0);
  });

describe('resolveAssistantSystemPrompt_ACU 核心协议卡按协议版本分支', () => {
  beforeEach(() => {
    settings_ACU.templateAssistantPromptSegments = [];
  });

  it('v3 自定义 segments：追加 v3 核心卡，不注入 v2 patch_sheet_* 术语', async () => {
    const { resolveAssistantSystemPrompt_ACU } = await import('../../../src/service/template-assistant/service');
    const resolved = resolveAssistantSystemPrompt_ACU(
      [{ role: 'SYSTEM', content: '自定义规则', deletable: false }],
      null,
      3,
    );
    const joined = resolved.map((m: any) => m.content).join('\n');
    expect(joined).toContain('[ACU 改表助手核心协议]');
    expect(joined).toContain('v3 单表完整替换协议');
    expect(joined).toContain('result.action');
    expect(joined).not.toContain('patch_sheet_update_config');
    expect(joined).not.toContain('operations[i]');
    expect(joined).not.toContain('patch_sheet_schema');
  });

  it('v2 自定义 segments：追加 v2 核心卡（patch_sheet_* 路由），不注入 v3 术语', async () => {
    const { resolveAssistantSystemPrompt_ACU } = await import('../../../src/service/template-assistant/service');
    const resolved = resolveAssistantSystemPrompt_ACU(
      [{ role: 'SYSTEM', content: '自定义规则', deletable: false }],
      null,
      2,
    );
    const joined = resolved.map((m: any) => m.content).join('\n');
    expect(joined).toContain('[ACU 改表助手核心协议]');
    expect(joined).toContain('patch_sheet_update_config');
    expect(joined).toContain('operations');
    expect(joined).not.toContain('v3 单表完整替换协议');
  });

  it('用户自定义 segments 已含核心协议标记时不重复追加', async () => {
    const { resolveAssistantSystemPrompt_ACU } = await import('../../../src/service/template-assistant/service');
    const resolved = resolveAssistantSystemPrompt_ACU(
      [{ role: 'SYSTEM', content: '[ACU 改表助手核心协议]\n我自己的规则', deletable: false }],
      null,
      3,
    );
    expect(resolved).toHaveLength(1);
    const content = resolved[0]?.content || '';
    // 标记只出现一次（用户自带，未再追加）
    expect(content.match(/\[ACU 改表助手核心协议\]/g)).toHaveLength(1);
  });
});

