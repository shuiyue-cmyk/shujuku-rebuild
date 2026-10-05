/**
 * time-recall-prefill 迁移 — 时间召回预设旧 assistant 尾段 → user 预填充。
 *
 * 上游 9bb5b242 同功能本仓适配：我方预设 schema 为 prompts[] + 顶层 promptGroup
 *（无 plotTasks），指纹基准为本仓当前 DEFAULT_TIME_RECALL_PLOT_PRESET_ACU。
 * 只有整组与默认逐字一致（尾段除外，见 isLegacyTail_ACU）的 pristine 默认才升级，
 * 用户自定义一律保留；已是目标形态时返回 null（幂等，不脏写）。
 */
import { describe, expect, it } from 'vitest';
import { upgradeTimeRecallPrefill_ACU } from '../../../src/service/plot/time-recall-prefill';
import { DEFAULT_TIME_RECALL_PLOT_PRESET_ACU } from '../../../src/shared/defaults-json.js';
import { USER_PREFILL_CONTENT_ACU } from '../../../src/shared/user-prefill.js';

function pristineHolder(): any {
    return JSON.parse(JSON.stringify(DEFAULT_TIME_RECALL_PLOT_PRESET_ACU));
}

describe('upgradeTimeRecallPrefill_ACU', () => {
    it('pristine 默认 promptGroup 尾段升级为 user 预填充，其余段逐字保留', () => {
        const upgraded = upgradeTimeRecallPrefill_ACU(pristineHolder());

        expect(upgraded, 'pristine 默认必须升级').not.toBeNull();
        const tail = upgraded.promptGroup[upgraded.promptGroup.length - 1];
        expect(tail.role).toBe('user');
        expect(tail.content).toBe(USER_PREFILL_CONTENT_ACU);
        // 其余段逐字保留；prompts[] 不动（尾段是 system 最终指令，无旧尾）。
        expect(upgraded.promptGroup.slice(0, -1)).toEqual(pristineHolder().promptGroup.slice(0, -1));
        expect(upgraded.prompts).toEqual(pristineHolder().prompts);
    });

    it('不改输入对象（返回新对象）', () => {
        const holder = pristineHolder();
        const before = JSON.stringify(holder);
        upgradeTimeRecallPrefill_ACU(holder);
        expect(JSON.stringify(holder)).toBe(before);
    });

    it('用户改过尾段的一律保留（返回 null）', () => {
        const holder = pristineHolder();
        holder.promptGroup[holder.promptGroup.length - 1] = {
            role: 'assistant',
            content: '用户自己写的结尾',
            deletable: true,
        };

        expect(upgradeTimeRecallPrefill_ACU(holder)).toBeNull();
    });

    it('builtin 下改过中间段：尾段照升（与上游同口径），中间改写保留', () => {
        // builtin 信任整组归属：只看尾段是否为旧尾，不因中间改写拦升级。
        const holder = pristineHolder();
        holder.promptGroup[1] = { ...holder.promptGroup[1], content: '用户改写过的段' };

        const upgraded = upgradeTimeRecallPrefill_ACU(holder);
        expect(upgraded).not.toBeNull();
        expect(upgraded.promptGroup.at(-1).content).toBe(USER_PREFILL_CONTENT_ACU);
        expect(upgraded.promptGroup[1].content).toBe('用户改写过的段');
    });

    it('非 builtin 时间召回 holder 改过中间段的一律保留（返回 null）', () => {
        const holder = pristineHolder();
        delete holder._acuBuiltinPresetId;
        holder.promptGroup[1] = { ...holder.promptGroup[1], content: '用户改写过的段' };

        expect(upgradeTimeRecallPrefill_ACU(holder)).toBeNull();
    });

    it('已是目标形态时返回 null（幂等，不脏写）', () => {
        const once = upgradeTimeRecallPrefill_ACU(pristineHolder());
        expect(once).not.toBeNull();
        expect(upgradeTimeRecallPrefill_ACU(once)).toBeNull();
    });

    it('promptPresets 内 pristine 预设递归升级，非匹配不动', () => {
        const holder = pristineHolder();
        holder.promptPresets = [
            pristineHolder(),
            { name: '用户预设', promptGroup: [{ role: 'user', content: '自定义' }] },
        ];

        const upgraded = upgradeTimeRecallPrefill_ACU(holder);
        expect(upgraded).not.toBeNull();
        const tail = upgraded.promptPresets[0].promptGroup.at(-1);
        expect(tail.role).toBe('user');
        expect(tail.content).toBe(USER_PREFILL_CONTENT_ACU);
        expect(upgraded.promptPresets[1]).toEqual(holder.promptPresets[1]);
    });

    it('非对象/空返回 null', () => {
        expect(upgradeTimeRecallPrefill_ACU(null)).toBeNull();
        expect(upgradeTimeRecallPrefill_ACU([] as any)).toBeNull();
        expect(upgradeTimeRecallPrefill_ACU({ name: '空白' })).toBeNull();
    });
});
