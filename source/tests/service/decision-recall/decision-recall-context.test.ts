/**
 * tests/service/decision-recall/decision-recall-context.test.ts
 * 决策召回的前文：最近两楼 AI 回复，去掉思考 / 状态栏 / MVU 变量块与残留标签，跳过用户楼、隐藏楼与工具楼。
 */
import { describe, expect, it } from 'vitest';
import {
  cleanDecisionRecallFloorText_ACU,
  collectDecisionRecallAiFloors_ACU,
} from '../../../src/service/decision-recall/decision-recall-context';

const ai = (mes: string, extra: Record<string, any> = {}) => ({ is_user: false, mes, ...extra });
const user = (mes: string) => ({ is_user: true, mes });

describe('collectDecisionRecallAiFloors_ACU', () => {
  it('只取最近两楼 AI 回复，按时间先后排列，用户楼不算', () => {
    const chat = [ai('第一楼'), user('问1'), ai('第二楼'), user('问2'), ai('第三楼'), user('最新输入')];
    expect(collectDecisionRecallAiFloors_ACU(chat)).toEqual(['第二楼', '第三楼']);
  });

  it('跳过隐藏楼、工具楼与清洗后为空的楼，继续往前找', () => {
    const chat = [
      ai('更早的回复'),
      ai('被隐藏的回复', { is_system: true }),
      ai('工具结果', { role: 'tool' }),
      ai('<thinking>只有思考</thinking>'),
      ai('最近的回复'),
    ];
    expect(collectDecisionRecallAiFloors_ACU(chat)).toEqual(['更早的回复', '最近的回复']);
  });

  it('AI 回复不足两楼时有几楼取几楼；聊天为空时返回空', () => {
    expect(collectDecisionRecallAiFloors_ACU([user('开场'), ai('唯一的回复')])).toEqual(['唯一的回复']);
    expect(collectDecisionRecallAiFloors_ACU([])).toEqual([]);
    expect(collectDecisionRecallAiFloors_ACU(null)).toEqual([]);
  });
});

describe('cleanDecisionRecallFloorText_ACU', () => {
  it('去掉思考块、MVU 变量更新块，保留剧情正文', () => {
    const text = '<think>先想想</think>她推开了门。\n<UpdateVariable>_.set("hp", 3);</UpdateVariable>\n门外是雨。';
    const cleaned = cleanDecisionRecallFloorText_ACU(text);
    expect(cleaned).toContain('她推开了门。');
    expect(cleaned).toContain('门外是雨。');
    expect(cleaned).not.toContain('先想想');
    expect(cleaned).not.toContain('hp');
  });

  it('其它标签只去掉标签本身，内容保留', () => {
    expect(cleanDecisionRecallFloorText_ACU('<content>正文内容</content>')).toBe('正文内容');
  });
});
