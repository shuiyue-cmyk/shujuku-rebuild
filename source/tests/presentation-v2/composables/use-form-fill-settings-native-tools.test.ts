/**
 * useFormFillSettings — 填表工具开关与默认主段的同步契约。
 *
 * 三条不变量（均有真实回归风险，故在此锁死）：
 * 1. 开关开启后，设置里存着「工具版默认主段」时不得误判为「已自定义」——
 *    否则每次重载都显示自定义，再切开关也不再跟随默认。
 * 2. 工具版主段不得落进 charCardPrompt：运行时只在开关开启时替换主段，一旦持久化，
 *    关掉开关后提示词仍在要求调用未挂载的工具 → 填表退化。
 * 3. 用户改写过主段时（与两套默认都不同），切换开关必须原样保留。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const { mockSettings, mockSaveSettings, mockSetCharCardPrompt } = vi.hoisted(() => {
    const settings: any = {
        tableApiPreset: '',
        charCardPrompt: [],
        tableEditLastPairOnly: true,
        discardUnauthorizedTableEditsEnabled: true,
        tableFillNativeToolsEnabled: false,
        tableContextExtractTags: '',
        tableContextExcludeTags: '',
        tableContextExtractRules: [],
        tableContextExcludeRules: [],
        promptTemplateSettings: { enabled: false },
    };
    return {
        mockSettings: settings,
        mockSaveSettings: vi.fn(() => ({ saved: true })),
        mockSetCharCardPrompt: vi.fn(() => ({ ok: true })),
    };
});

vi.mock('../../../src/service/runtime/state-manager', () => ({
    get settings_ACU() { return mockSettings; },
}));

vi.mock('../../../src/service/settings/settings-service', () => ({
    saveSettings_ACU: mockSaveSettings,
}));

vi.mock('../../../src/service/settings/settings-write-service', () => ({
    setUpdateNumberFields_ACU: vi.fn(() => ({ ok: true })),
    setTableContextRules_ACU: vi.fn(() => ({ ok: true })),
    setCharCardPrompt_ACU: mockSetCharCardPrompt,
}));

vi.mock('../../../src/service/settings/feature-preset-reference-service', () => ({
    setFeatureApiPreset_ACU: vi.fn(() => ({ ok: true })),
}));

vi.mock('../../../src/service/table/storage-mode', () => ({
    getCurrentStorageMode: () => 'sqlite',
}));

import { useFormFillSettings } from '../../../src/presentation-v2/composables/useFormFillSettings';
import { buildTableFillDefaultPromptSegments_ACU } from '../../../src/service/ai/prompt-builder/table-fill-tools';
import { DEFAULT_CHAR_CARD_PROMPT_SQL_ACU } from '../../../src/shared/defaults-json.js';

function mainTextOf(segments: any[]): string {
    const main = segments.find(segment => segment?.mainSlot === 'A' || segment?.isMain === true);
    return String(main?.content ?? '');
}

function defaultMainText(toolEnabled: boolean): string {
    return mainTextOf(buildTableFillDefaultPromptSegments_ACU(
        DEFAULT_CHAR_CARD_PROMPT_SQL_ACU as any[],
        toolEnabled,
    ));
}

beforeEach(() => {
    setActivePinia(createPinia());
    mockSettings.charCardPrompt = [];
    mockSettings.tableFillNativeToolsEnabled = false;
    mockSaveSettings.mockClear();
    mockSetCharCardPrompt.mockClear();
});

describe('填表工具开关与默认主段', () => {
    it('开关开启但设置里存着正文版默认主段（关闭时保存的）时，仍判定为「使用默认」', () => {
        // 真实场景：开关关闭时保存过提示词 → 存的是正文版；随后开启开关，
        // 基准变成工具版，不归一就会每次重载都误判「已自定义」。
        mockSettings.tableFillNativeToolsEnabled = true;
        mockSettings.charCardPrompt = buildTableFillDefaultPromptSegments_ACU(
            DEFAULT_CHAR_CARD_PROMPT_SQL_ACU as any[],
            false,
        );

        const settings = useFormFillSettings();
        expect(settings.promptTemplateMode.value).toBe('default');
        expect(mainTextOf(settings.promptSegments.value)).toContain('必须调用 table_sql');
    });

    it('开关开启且设置里存着工具版默认主段时，同样判定为「使用默认」', () => {
        mockSettings.tableFillNativeToolsEnabled = true;
        mockSettings.charCardPrompt = buildTableFillDefaultPromptSegments_ACU(
            DEFAULT_CHAR_CARD_PROMPT_SQL_ACU as any[],
            true,
        );

        const settings = useFormFillSettings();
        expect(settings.promptTemplateMode.value).toBe('default');
    });

    it('开关开启时保存提示词：未改写的主段落盘为正文版默认（不得持久化工具版要求）', () => {
        mockSettings.tableFillNativeToolsEnabled = true;
        mockSettings.charCardPrompt = buildTableFillDefaultPromptSegments_ACU(
            DEFAULT_CHAR_CARD_PROMPT_SQL_ACU as any[],
            true,
        );

        const settings = useFormFillSettings();
        settings.savePrompt();

        expect(mockSetCharCardPrompt).toHaveBeenCalledTimes(1);
        const written = mockSetCharCardPrompt.mock.calls[0][0];
        expect(mainTextOf(written)).toBe(defaultMainText(false));
        expect(mainTextOf(written)).not.toContain('必须调用 table_sql');
        // 落盘是正文版，但编辑器缓冲区必须仍是当前开关下真正发出的工具版，
        // 否则 mode 翻成 custom、切开关不再跟随默认。
        expect(mainTextOf(settings.promptSegments.value)).toContain('必须调用 table_sql');
        expect(settings.promptTemplateMode.value).toBe('default');
    });

    it('开关开启时保存：只改过非主段，落盘保留改写、缓冲区也保留（不得被纯默认覆盖）', () => {
        mockSettings.tableFillNativeToolsEnabled = true;
        mockSettings.charCardPrompt = buildTableFillDefaultPromptSegments_ACU(
            DEFAULT_CHAR_CARD_PROMPT_SQL_ACU as any[],
            true,
        );

        const settings = useFormFillSettings();
        settings.addPromptSegment('bottom');
        const last = settings.promptSegments.value.length - 1;
        settings.updatePromptSegment(last, { content: '用户追加段（只改非主段）' });
        settings.savePrompt();

        const written = mockSetCharCardPrompt.mock.calls[0][0];
        expect(written.map((s: any) => String(s.content))).toContain('用户追加段（只改非主段）');
        // 缓冲区同样必须留着用户的追加段，否则界面与落盘不一致、再存一次就覆盖。
        expect(settings.promptSegments.value.map((s: any) => String(s.content)))
            .toContain('用户追加段（只改非主段）');
        expect(mainTextOf(settings.promptSegments.value)).toContain('必须调用 table_sql');
    });

    it('开关关闭时保存：缓冲区带着工具版主段仍须回落正文版（导出→关开关→导入路径）', async () => {
        // 载入归一只在 useFormFillSettings 构造时跑一次；开关随后被关掉（如从别处改了
        // 设置、或导出的 JSON 被重新导入）时缓冲区仍是工具版，此时保存不得把它落进设置。
        mockSettings.tableFillNativeToolsEnabled = true;
        mockSettings.charCardPrompt = buildTableFillDefaultPromptSegments_ACU(
            DEFAULT_CHAR_CARD_PROMPT_SQL_ACU as any[],
            true,
        );
        const settings = useFormFillSettings();
        expect(mainTextOf(settings.promptSegments.value)).toContain('必须调用 table_sql');

        mockSettings.tableFillNativeToolsEnabled = false;
        settings.savePrompt();

        const written = mockSetCharCardPrompt.mock.calls[0][0];
        expect(mainTextOf(written)).toBe(defaultMainText(false));
        expect(mainTextOf(written)).not.toContain('必须调用 table_sql');
    });

    it('载入归一只在整份等于另一套默认时生效：用户改过 B 段则整份保留', () => {
        // 判据只看主段会吞掉用户对 B 段/新增段的改写：主段未动、B 段被改时也会命中。
        mockSettings.tableFillNativeToolsEnabled = true;
        const stored = buildTableFillDefaultPromptSegments_ACU(
            DEFAULT_CHAR_CARD_PROMPT_SQL_ACU as any[],
            false,
        );
        stored.push({ role: 'user', content: '用户追加段', enabled: true, deletable: true });
        mockSettings.charCardPrompt = stored;

        const settings = useFormFillSettings();
        expect(settings.promptTemplateMode.value).toBe('custom');
        const texts = settings.promptSegments.value.map((segment: any) => String(segment.content));
        expect(texts).toContain('用户追加段');
    });

    it('开关开启时保存提示词：用户改写过的主段原样落盘', () => {
        mockSettings.tableFillNativeToolsEnabled = true;
        mockSettings.charCardPrompt = buildTableFillDefaultPromptSegments_ACU(
            DEFAULT_CHAR_CARD_PROMPT_SQL_ACU as any[],
            true,
        );

        const settings = useFormFillSettings();
        const index = settings.promptSegments.value.findIndex(s => s.mainSlot === 'A' || s.isMain);
        settings.promptSegments.value[index] = {
            ...settings.promptSegments.value[index],
            content: `${settings.promptSegments.value[index].content}\n用户补充要求`,
        };
        settings.savePrompt();

        const written = mockSetCharCardPrompt.mock.calls[0][0];
        expect(mainTextOf(written)).toContain('用户补充要求');
    });

    it('开关从关到开：仍用默认提示词时编辑器跟随切到工具版；用户改写过的原样保留', () => {
        mockSettings.tableFillNativeToolsEnabled = false;
        mockSettings.charCardPrompt = buildTableFillDefaultPromptSegments_ACU(
            DEFAULT_CHAR_CARD_PROMPT_SQL_ACU as any[],
            false,
        );

        const settings = useFormFillSettings();
        expect(settings.promptTemplateMode.value).toBe('default');
        settings.setNativeToolsEnabled(true);
        expect(settings.nativeToolsEnabled.value).toBe(true);
        expect(mainTextOf(settings.promptSegments.value)).toContain('必须调用 table_sql');

        // 用户改写过主段后再切开关：不跟随
        const customized = useFormFillSettings();
        const idx = customized.promptSegments.value.findIndex(s => s.mainSlot === 'A' || s.isMain);
        customized.promptSegments.value[idx] = {
            ...customized.promptSegments.value[idx],
            content: '自定义主段：只按正文输出 SQL。',
        };
        customized.setNativeToolsEnabled(false);
        expect(mainTextOf(customized.promptSegments.value)).toBe('自定义主段：只按正文输出 SQL。');
    });
});