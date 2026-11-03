/**
 * tests/presentation/triggers/data-admin-ui-override-guard.test.ts
 * G12-02：「用模板覆盖最新一层」的破坏性确认改异步弹框后，确认期间聊天被程序化切换时必须放弃，
 * 不能把覆盖落到用户没确认过的聊天上（执行核心按执行时刻的聊天定位最新层）。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chatIdentity: 'chat-a',
  chat: [] as any[],
  confirm: vi.fn(),
  overrideCore: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  get currentChatFileIdentifier_ACU() { return h.chatIdentity; },
  getCurrentIsolationKey_ACU: () => '',
}));
vi.mock('../../../src/presentation/theme/custom-confirm', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  showCustomConfirm_ACU: (...args: any[]) => h.confirm(...args),
}));
vi.mock('../../../src/presentation/theme/toast', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  showToastr_ACU: (...args: any[]) => h.toast(...args),
}));
vi.mock('../../../src/service/chat/chat-service', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getChatArray_ACU: () => h.chat,
  overrideLatestLayerWithTemplateCore_ACU: (...args: any[]) => h.overrideCore(...args),
}));
vi.mock('../../../src/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  parseTableTemplateJson_ACU: () => ({ sheet_0: { name: '物品表', headers: ['row_id', '名称'], content: [] } }),
}));

import { overrideLatestLayerWithTemplate_ACU } from '../../../src/presentation/triggers/data-admin-ui';

describe('G12-02：模板覆盖最新一层的确认期间复核聊天身份', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.chatIdentity = 'chat-a';
    h.chat = [
      { is_user: true, mes: '问' },
      { is_user: false, mes: '答', message_id: 2 },
    ];
    h.confirm.mockResolvedValue(true);
    h.overrideCore.mockResolvedValue(0);
  });

  it('确认期间聊天被切换：放弃覆盖并提示，执行核心不被调用', async () => {
    h.confirm.mockImplementationOnce(async () => { h.chatIdentity = 'chat-b'; return true; });

    const ok = await overrideLatestLayerWithTemplate_ACU();

    expect(ok).toBe(false);
    expect(h.overrideCore).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith('warning', expect.stringContaining('已切换'));
  });

  it('用户取消确认：照旧直接返回，不提示切换', async () => {
    h.confirm.mockResolvedValueOnce(false);

    const ok = await overrideLatestLayerWithTemplate_ACU();

    expect(ok).toBe(false);
    expect(h.overrideCore).not.toHaveBeenCalled();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('聊天未切换：确认后照常进入执行核心', async () => {
    const ok = await overrideLatestLayerWithTemplate_ACU();

    expect(h.overrideCore).toHaveBeenCalledTimes(1);
    // modifiedCount=0 走「没有找到需要覆盖的表格数据」分支，不触发刷新链
    expect(ok).toBe(false);
    expect(h.toast).toHaveBeenCalledWith('warning', '没有找到需要覆盖的表格数据。');
  });
});
