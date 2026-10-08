import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatState = vi.hoisted(() => ({ id: 'chat-a', isolation: 'iso' }));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentChatFileIdentifier_ACU() { return chatState.id; },
  getCurrentIsolationKey_ACU: () => chatState.isolation,
}));

import { applyTemplateWithDestructiveConfirm_ACU } from '../../../src/presentation-v2/composables/template-destructive-confirm';

const DESTRUCTIVE = '删除表「背包」需要显式确认';

beforeEach(() => {
  chatState.id = 'chat-a';
  chatState.isolation = 'iso';
});

describe('applyTemplateWithDestructiveConfirm_ACU（R10A-04 / R10A-23）', () => {
  it('无破坏性 blockers 时直接返回首次结果，不弹确认', async () => {
    const apply = vi.fn(async () => ({ saved: true }));
    const confirm = vi.fn(async () => true);
    await expect(applyTemplateWithDestructiveConfirm_ACU(apply, { confirm })).resolves.toEqual({ saved: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('确认后核对待删表/列与确认时一致才带确认标志提交', async () => {
    const apply = vi.fn(async (confirmed: boolean) => (confirmed ? { saved: true } : { saved: false, blockers: [DESTRUCTIVE] }));
    const confirm = vi.fn(async () => true);

    await expect(applyTemplateWithDestructiveConfirm_ACU(apply, { confirm })).resolves.toEqual({ saved: true });
    expect(confirm).toHaveBeenCalledWith([DESTRUCTIVE]);
    expect(apply.mock.calls.map(call => call[0])).toEqual([false, false, true]);
  });

  it('确认期间切换聊天时不带确认标志重提', async () => {
    const apply = vi.fn(async (confirmed: boolean) => (confirmed ? { saved: true } : { saved: false, blockers: [DESTRUCTIVE] }));
    const confirm = vi.fn(async () => { chatState.id = 'chat-b'; return true; });

    const result = await applyTemplateWithDestructiveConfirm_ACU(apply, { confirm });

    expect(result).toMatchObject({ saved: false });
    expect(String(result.error)).toContain('切换');
    expect(apply.mock.calls.map(call => call[0])).toEqual([false]);
  });

  it('确认期间待删除的表或列变了时不执行删除', async () => {
    let round = 0;
    const apply = vi.fn(async (confirmed: boolean) => {
      if (confirmed) return { saved: true };
      round += 1;
      return { saved: false, blockers: [round === 1 ? DESTRUCTIVE : '删除列「金币」需要显式确认'] };
    });

    const result = await applyTemplateWithDestructiveConfirm_ACU(apply, { confirm: vi.fn(async () => true) });

    expect(result).toMatchObject({ saved: false });
    expect(String(result.error)).toContain('发生变化');
    expect(apply.mock.calls.map(call => call[0])).toEqual([false, false]);
  });

  it('用户取消时返回首次的 blockers 结果', async () => {
    const first = { saved: false, blockers: [DESTRUCTIVE] };
    const apply = vi.fn(async () => first);
    await expect(applyTemplateWithDestructiveConfirm_ACU(apply, { confirm: vi.fn(async () => false) })).resolves.toBe(first);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('stale revision 冲突时同一档位重试一次', async () => {
    const apply = vi.fn()
      .mockResolvedValueOnce({ saved: false, error: 'V2 stale_revision_conflict: base moved' })
      .mockResolvedValueOnce({ saved: true });
    await expect(applyTemplateWithDestructiveConfirm_ACU(apply, { confirm: vi.fn() })).resolves.toEqual({ saved: true });
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
