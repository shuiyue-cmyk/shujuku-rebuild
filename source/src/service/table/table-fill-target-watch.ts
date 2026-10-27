import type { TableFillTargetGuard_ACU } from './table-fill-target-guard';

/**
 * 在途填表请求的目标楼层登记。
 *
 * 删楼、滑动、重新生成之后，目标楼层已经换成另一条回复的填表请求，结果回来也会在提交阶段被
 * 目标楼层守卫拒掉，但那时 token 已经花完了。宿主派发删楼 / 滑动事件时按同一个守卫逐个复核，
 * 判定失效的当场中止；提交时会被接受的请求不会被中止。
 */
interface TableFillTargetWatch_ACU {
  guard: Pick<TableFillTargetGuard_ACU, 'isCurrent'>;
  targetIndex: number;
  controller: AbortController;
}

const activeWatches_ACU = new Set<TableFillTargetWatch_ACU>();

/** 登记一个在途填表请求；返回注销函数，请求结束（无论成败）时必须调用。 */
export function watchTableFillTarget_ACU(
  guard: Pick<TableFillTargetGuard_ACU, 'isCurrent'>,
  targetIndex: number,
  controller: AbortController,
): () => void {
  const watch: TableFillTargetWatch_ACU = { guard, targetIndex, controller };
  activeWatches_ACU.add(watch);
  return () => { activeWatches_ACU.delete(watch); };
}

/** 中止目标楼层已失效的在途填表请求，返回本次中止的请求数（共用同一个中止信号的只计一次）。 */
export function abortTableFillRequestsWithStaleTarget_ACU(): number {
  const aborted = new Set<AbortController>();
  for (const watch of activeWatches_ACU) {
    if (watch.controller.signal.aborted) continue;
    let current = true;
    try {
      current = watch.guard.isCurrent(watch.targetIndex);
    } catch {
      // 判定不了就不动它，交给提交阶段的守卫
    }
    if (current) continue;
    watch.controller.abort();
    aborted.add(watch.controller);
  }
  return aborted.size;
}
