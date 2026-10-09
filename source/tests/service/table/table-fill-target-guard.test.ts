import { describe, expect, it } from 'vitest';
import { captureTableFillTargetGuard_ACU } from '../../../src/service/table/table-fill-target-guard';

function chat() {
  return [
    { is_user: false, mes: '开场白', send_date: 'd0' },
    { is_user: true, mes: '你好', send_date: 'd1' },
    { is_user: false, mes: '第一版回复', swipe_id: 0, swipes: ['第一版回复'], send_date: 'd2', gen_started: '2026-10-09T12:00:00.000Z' },
  ];
}

describe('填表目标楼层守卫', () => {
  it('滑动到另一条回复后判为已变化', () => {
    const live = chat();
    const guard = captureTableFillTargetGuard_ACU(live);
    live[2].swipe_id = 1;
    live[2].mes = '第二版回复';
    live[2].gen_started = '2026-10-09T12:01:00.000Z';
    expect(guard.isCurrent(2, live)).toBe(false);
  });

  it('删掉重新生成（同位置换了一条回复）判为已变化', () => {
    const live = chat();
    const guard = captureTableFillTargetGuard_ACU(live);
    live[2] = { ...live[2], mes: '重生成', gen_started: '2026-10-09T12:02:00.000Z' };
    expect(guard.isCurrent(2, live)).toBe(false);
  });

  it('前面删楼导致目标位置错位、或目标楼被删，判为已变化', () => {
    const live = chat();
    const guard = captureTableFillTargetGuard_ACU(live);
    live.splice(1, 1);
    expect(guard.isCurrent(2, live)).toBe(false);
  });

  it('同一条回复的正文被原地改写（正文替换 / MVU 追加 / 续写）不算变化', () => {
    const live = chat();
    const guard = captureTableFillTargetGuard_ACU(live);
    live[2].mes = '第一版回复（已优化）\n\n<UpdateVariable>…</UpdateVariable>';
    live[2].swipes[0] = live[2].mes;
    expect(guard.isCurrent(2, live)).toBe(true);
  });

  it('宿主「继续」续写原地改写了发送时间与生成开始时间：仍是同一条回复，不算变化', () => {
    const live = chat();
    const guard = captureTableFillTargetGuard_ACU(live);
    live[2].mes = '第一版回复，续写的后半段';
    live[2].send_date = 'd2-continued';
    live[2].gen_started = '2026-10-09T12:05:00.000Z';
    expect(guard.isCurrent(2, live)).toBe(true);
  });

  it('目标为 -1 时与写回层同口径：末尾的隐藏楼 / 工具楼不算最新 AI 楼', () => {
    const live: any[] = [...chat(), { is_user: false, is_system: true, mes: '/comment 备注', send_date: 'd3' }];
    const guard = captureTableFillTargetGuard_ACU(live);
    // 真正的最新 AI 楼（#2）被滑动：必须判为已变化
    live[2].swipe_id = 1;
    expect(guard.isCurrent(-1, live)).toBe(false);
    // 反方向：填表期间追加了工具楼，最新 AI 楼没变，不能误判
    const live2: any[] = chat();
    const guard2 = captureTableFillTargetGuard_ACU(live2);
    live2.push({ is_user: false, role: 'tool', mes: '工具结果', send_date: 'd4' });
    expect(guard2.isCurrent(-1, live2)).toBe(true);
  });

  it('消息对象被整体重建（JSON 往返）不算变化', () => {
    const live = chat();
    const guard = captureTableFillTargetGuard_ACU(live);
    const rebuilt = JSON.parse(JSON.stringify(live));
    expect(guard.isCurrent(2, rebuilt)).toBe(true);
  });

  it('目标为 -1（最新 AI 楼）时，期间又生成了新 AI 楼判为已变化', () => {
    const live = chat();
    const guard = captureTableFillTargetGuard_ACU(live);
    expect(guard.isCurrent(-1, live)).toBe(true);
    live.push({ is_user: true, mes: '继续', send_date: 'd3' } as any, { is_user: false, mes: '新回复', send_date: 'd4' } as any);
    expect(guard.isCurrent(-1, live)).toBe(false);
  });
});
