/**
 * usePlotTaskEditing — D23.3 抽屉内任务列表 + 当前任务编辑器
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function setup() {
  vi.resetModules();
  // shared/defaults-json.js + plot-state 是真实模块，不 mock。
  const [{ usePlotTaskEditing }] = await Promise.all([
    import('../../../src/presentation-v2/composables/usePlotTaskEditing'),
  ]);
  return { usePlotTaskEditing };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('usePlotTaskEditing', () => {

  it('R10A-23：同一毫秒连续新增任务不会撞 id', async () => {
    const { usePlotTaskEditing } = await setup();
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const e = usePlotTaskEditing();
    e.loadFromRaw([], '');
    e.addTask();
    e.addTask();
    const ids = e.tasks.value.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('R10A-23：删除任务时清理其它任务对它的依赖/阻塞引用', async () => {
    const { usePlotTaskEditing } = await setup();
    const e = usePlotTaskEditing();
    e.loadFromRaw([
      { id: 'a', name: 'A', agentControl: { dependsOnTaskIds: ['b'], blocksTaskIds: ['b', 'c'] } },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C', agentControl: { dependsOnTaskIds: ['b', 'a'] } },
    ], '');
    e.selectTask('b');
    e.deleteCurrentTask();
    const a = e.tasks.value.find(t => t.id === 'a')!;
    const c = e.tasks.value.find(t => t.id === 'c')!;
    expect(a.agentControl.dependsOnTaskIds).toEqual([]);
    expect(a.agentControl.blocksTaskIds).toEqual(['c']);
    expect(c.agentControl.dependsOnTaskIds).toEqual(['a']);
  });

  it('moveCurrent 上下移动当前任务的位置', async () => {
    const { usePlotTaskEditing } = await setup();
    const e = usePlotTaskEditing();
    e.loadFromRaw(
      [
        { id: 'a', name: 'A', stage: 1, order: 0 },
        { id: 'b', name: 'B', stage: 1, order: 1 },
        { id: 'c', name: 'C', stage: 1, order: 2 },
      ],
      '',
    );
    e.selectTask('b');
    e.moveCurrent(-1);
    expect(e.tasks.value.map(t => t.id)).toEqual(['b', 'a', 'c']);
    e.moveCurrent(1);
    expect(e.tasks.value.map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('addSegment + updateSegment + moveSegment + deleteSegment 操作 promptGroup', async () => {
    const { usePlotTaskEditing } = await setup();
    const e = usePlotTaskEditing();
    e.loadFromRaw([{ id: 'x', name: 'X', stage: 1, order: 0 }], '');
    const startLen = e.currentTask.value!.promptGroup.length;

    e.addSegment('top');
    expect(e.currentTask.value!.promptGroup.length).toBe(startLen + 1);

    e.updateSegment(0, { content: 'hello world', role: 'SYSTEM' });
    expect(e.currentTask.value!.promptGroup[0].content).toBe('hello world');
    expect(e.currentTask.value!.promptGroup[0].role).toBe('SYSTEM');

    // mainSlot 唯一性：把第 0 段标 A，再把第 1 段标 A，第 0 段会被清空
    e.updateSegment(0, { mainSlot: 'A' });
    expect(e.currentTask.value!.promptGroup[0].mainSlot).toBe('A');
    e.updateSegment(1, { mainSlot: 'A' });
    expect(e.currentTask.value!.promptGroup[1].mainSlot).toBe('A');
    expect(e.currentTask.value!.promptGroup[0].mainSlot).toBe('');

    e.updateSegment(0, { content: 'first' });
    e.updateSegment(1, { content: 'second' });
    e.moveSegment(1, -1);
    expect(e.currentTask.value!.promptGroup[0].content).toBe('second');
    expect(e.currentTask.value!.promptGroup[1].content).toBe('first');
    e.moveSegment(0, -1);
    expect(e.currentTask.value!.promptGroup[0].content).toBe('second');
    e.moveSegment(0, 1);
    expect(e.currentTask.value!.promptGroup[0].content).toBe('first');
    expect(e.currentTask.value!.promptGroup[1].content).toBe('second');

    e.deleteSegment(0);
    expect(e.currentTask.value!.promptGroup.length).toBe(startLen);
  });

  it('serializeIntoPresetRaw 将 tasks + finalDirective 写回 raw', async () => {
    const { usePlotTaskEditing } = await setup();
    const e = usePlotTaskEditing();
    e.loadFromRaw(
      [
        { id: 'a', name: 'A', stage: 1, order: 0, promptGroup: [{ role: 'SYSTEM', content: 'hi' }] },
        { id: 'b', name: 'B', stage: 2, order: 1, promptGroup: [{ role: 'USER', content: 'go' }] },
      ],
      '我是注入指令',
    );
    const raw = e.serializeIntoPresetRaw({ name: '预设 A' });
    expect(raw.name).toBe('预设 A');
    expect(raw.plotTasks).toHaveLength(2);
    expect(raw.plotTasks[0].id).toBe('a');
    expect(raw.plotTasks[1].stage).toBe(2);
    expect(raw.finalSystemDirective).toBe('我是注入指令');
  });
});
