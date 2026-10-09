import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  collectSubstantialUserTexts_ACU,
  isMechanicalResumeUserText_ACU,
  normalizeUserRequirementLines_ACU,
  seedAgentUserRequirementsIfEmpty_ACU,
} from '../../../../src/service/continuation/agent/agent-user-requirements';
import { buildEmptyAgentModuleSnapshot_ACU, readAgentModuleSnapshot_ACU, writeAgentModuleSnapshot_ACU } from '../../../../src/service/continuation/agent/agent-module-store';
import { _set_SillyTavern_API_ACU } from '../../../../src/shared/host-api';

function userMessage_ACU(id: number, text: string) {
  return { id, kind: 'user' as const, text, digest: text.slice(0, 24), turnKey: 't', at: id };
}

describe('续写用户要求资料区', () => {
  beforeEach(() => {
    _set_SillyTavern_API_ACU(null as any);
  });

  /**
   * 折叠读出的快照，水位会被 delta 推高，而前缀指纹仍属于被采纳的那份基线
   * （applyDelta_ACU 推 settledThroughIndex 却从不改 settledPrefixFingerprint）。
   * 这种「(水位, 指纹) 不成对」的快照一旦直接回写，就会被写盘门以「资料快照引用的聊天前缀已变化」
   * 硬拒——聊天其实一个字没变。所有「折叠读出 → 加工 → 回写」的路径都吃这个亏
   * （播种用户要求、结算 partial/failed 分支、用户要求维护、总纲维护），
   * 所以修在折叠输出处，而不是逐个调用点打补丁。
   */
  it('折叠水位被 delta 推高后，播种用户要求不得被前缀指纹门误拒', async () => {
    const chat: any[] = [{ mes: 'a', is_user: false }, { mes: 'b', is_user: false }];
    _set_SillyTavern_API_ACU({ chat, saveChat: vi.fn().mockResolvedValue(undefined) } as any);
    await writeAgentModuleSnapshot_ACU(chat, 1, { ...buildEmptyAgentModuleSnapshot_ACU(), settledThroughIndex: 1 });

    chat.push({ mes: 'c', is_user: false });
    const second: any = {
      ...buildEmptyAgentModuleSnapshot_ACU(),
      settledThroughIndex: 2,
      hooks: [{ id: 'H1', summary: '伏笔 H1', status: 'planted', importance: 'mid', plantedIndex: 1, updatedIndex: 1, plannedPayoff: '', retired: false, retiredReason: '' }],
    };
    second.revisions = { ...second.revisions, hooks: 1 };
    await writeAgentModuleSnapshot_ACU(chat, 2, second);

    // 前置：水位确实已被 delta 推过基线的水位（否则本用例测不到东西）
    expect(readAgentModuleSnapshot_ACU(chat).settledThroughIndex).toBe(2);

    await expect(seedAgentUserRequirementsIfEmpty_ACU('用户要求：主角不能死')).resolves.toBeUndefined();
    expect(readAgentModuleSnapshot_ACU(chat).userRequirements).toEqual(['用户要求：主角不能死']);
  });

  it('机械继续类关键词整段匹配才过滤，夹带实质要求的句子保留', () => {
    expect(isMechanicalResumeUserText_ACU('')).toBe(true);
    expect(isMechanicalResumeUserText_ACU('  ')).toBe(true);
    expect(isMechanicalResumeUserText_ACU('继续')).toBe(true);
    expect(isMechanicalResumeUserText_ACU('开始')).toBe(true);
    expect(isMechanicalResumeUserText_ACU('恢复任务')).toBe(true);
    expect(isMechanicalResumeUserText_ACU('RESUME')).toBe(true);
    expect(isMechanicalResumeUserText_ACU('continue')).toBe(true);
    expect(isMechanicalResumeUserText_ACU('继续写主角隐瞒身份')).toBe(false);
  });

  it('压缩区间只收集 kind=user 的实质发言，按 id 开闭区间去重空白与继续类', () => {
    const messages = [
      userMessage_ACU(1, '不要提前揭底牌'),
      { id: 2, kind: 'agent' as const, text: '已记下', digest: 'agent', turnKey: 't', at: 2 },
      userMessage_ACU(3, '继续'),
      userMessage_ACU(4, '  用第一人称  '),
      userMessage_ACU(5, '恢复'),
      userMessage_ACU(6, '保持慢热'),
    ];
    expect(collectSubstantialUserTexts_ACU(messages, 1, 5)).toEqual(['用第一人称']);
    expect(collectSubstantialUserTexts_ACU(messages, 0, 6)).toEqual(['不要提前揭底牌', '用第一人称', '保持慢热']);
  });

  it('规范化拒绝非数组、非字符串与空串；按首次出现去重并 trim', () => {
    expect(normalizeUserRequirementLines_ACU('nope')).toBeNull();
    expect(normalizeUserRequirementLines_ACU(['合法', 1])).toBeNull();
    expect(normalizeUserRequirementLines_ACU(['合法', '  '])).toBeNull();
    expect(normalizeUserRequirementLines_ACU(['  第一人称  ', '第一人称', '不要揭底牌'])).toEqual(['第一人称', '不要揭底牌']);
    expect(normalizeUserRequirementLines_ACU([])).toEqual([]);
  });

  it('创建任务无楼层时种子写入静默跳过；有末楼且快照为空时机械写入 originInstruction', async () => {
    await expect(seedAgentUserRequirementsIfEmpty_ACU('推进禁区', [])).resolves.toBeUndefined();

    const chat: any[] = [{ mes: '正文' }];
    const saveChat = vi.fn().mockResolvedValue(undefined);
    _set_SillyTavern_API_ACU({ chat, saveChat } as any);
    await seedAgentUserRequirementsIfEmpty_ACU('  推进禁区  ', chat);
    expect(saveChat).toHaveBeenCalledOnce();
    expect(readAgentModuleSnapshot_ACU(chat).userRequirements).toEqual(['推进禁区']);

    await seedAgentUserRequirementsIfEmpty_ACU('另一条要求', chat);
    expect(saveChat).toHaveBeenCalledOnce();
    // T1 帧存储：楼层字段是 checkpoint/delta 帧而非裸快照，经折叠读取验证首条未被覆盖。
    expect(readAgentModuleSnapshot_ACU(chat).userRequirements).toEqual(['推进禁区']);
  });
});
