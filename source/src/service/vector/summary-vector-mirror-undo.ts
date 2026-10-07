/**
 * 向量镜像写入的字段级撤销日志（R5-01）。
 *
 * 镜像 flush / 重建失败时，过去在事务外深拷贝整个 TavernDB_ACU_IsolatedData，失败后整块覆盖回去，
 * 会把等锁期间并发写入方已提交的表格 entry（以及其他隔离槽的写入）一起抹掉。
 * 这里改为只记录本次亲手改过的字段：写入时记下旧值与写入值，回滚时仅当字段仍是自己写入的那份
 * 才恢复旧值；已被别人改过的字段原样保留，交给 resolver / rebuild_repair 收敛。
 *
 * 约定：调用方不得原地修改旧值对象（需要改就先浅拷贝再整体赋值），否则旧值无法恢复。
 */

type UndoEntry_ACU = {
    target: Record<string, any>;
    key: string;
    had: boolean;
    previous: unknown;
    removed: boolean;
    written: unknown;
};

export interface SummaryVectorMirrorUndoLog_ACU {
    /** 给 target[key] 赋值并登记撤销信息。 */
    set(target: Record<string, any>, key: string, value: unknown): void;
    /** 删除 target[key]（不存在时不登记）并登记撤销信息。 */
    remove(target: Record<string, any>, key: string): void;
    /** 逆序撤销仍保持本次写入状态的字段；返回被跳过（已被他人改动）的字段数。 */
    rollback(): number;
}

export function createSummaryVectorMirrorUndoLog_ACU(): SummaryVectorMirrorUndoLog_ACU {
    const entries: UndoEntry_ACU[] = [];
    const has = (target: Record<string, any>, key: string) => Object.prototype.hasOwnProperty.call(target, key);
    return {
        set(target, key, value) {
            entries.push({ target, key, had: has(target, key), previous: target[key], removed: false, written: value });
            target[key] = value;
        },
        remove(target, key) {
            if (!has(target, key)) return;
            entries.push({ target, key, had: true, previous: target[key], removed: true, written: undefined });
            delete target[key];
        },
        rollback() {
            let skipped = 0;
            for (let index = entries.length - 1; index >= 0; index -= 1) {
                const entry = entries[index];
                const untouched = entry.removed
                    ? !has(entry.target, entry.key)
                    : has(entry.target, entry.key) && entry.target[entry.key] === entry.written;
                if (!untouched) {
                    skipped += 1;
                    continue;
                }
                if (entry.had) entry.target[entry.key] = entry.previous;
                else delete entry.target[entry.key];
            }
            entries.length = 0;
            return skipped;
        },
    };
}
