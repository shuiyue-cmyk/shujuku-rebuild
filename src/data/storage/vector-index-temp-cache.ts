import type { SummaryVectorIndexShard_ACU } from '../../service/vector/summary-vector-index-types';

const DB_NAME_ACU = 'TavernDB_ACU_VectorTempCache';
const DB_VERSION_ACU = 1;
const STORE_NAME_ACU = 'shards';

interface CachedShardRecord_ACU {
    key: string;
    indexId: string;
    shardId: string;
    shard: SummaryVectorIndexShard_ACU;
    byteSize: number;
    checksum: string;
    lastAccessAt: number;
    createdAt: number;
}

function isIdbAvailable_ACU(): boolean {
    return typeof indexedDB !== 'undefined';
}

function openDb_ACU(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (!isIdbAvailable_ACU()) {
            reject(new Error('IndexedDB 不可用'));
            return;
        }
        const request = indexedDB.open(DB_NAME_ACU, DB_VERSION_ACU);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME_ACU)) {
                const store = db.createObjectStore(STORE_NAME_ACU, { keyPath: 'key' });
                store.createIndex('indexId', 'indexId', { unique: false });
                store.createIndex('lastAccessAt', 'lastAccessAt', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('打开向量临时缓存失败'));
    });
}

function makeKey_ACU(indexId: string, shardId: string): string {
    return `${indexId}::${shardId}`;
}

function runStore_ACU<T>(mode: IDBTransactionMode, runner: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return openDb_ACU().then((db) => new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME_ACU, mode);
        const store = tx.objectStore(STORE_NAME_ACU);
        const request = runner(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('向量临时缓存操作失败'));
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
            db.close();
            reject(tx.error || new Error('向量临时缓存事务失败'));
        };
    }));
}

export async function getVectorIndexCachedShard_ACU(indexId: string, shardId: string, expectedChecksum = ''): Promise<SummaryVectorIndexShard_ACU | null> {
    try {
        const key = makeKey_ACU(indexId, shardId);
        const record = await runStore_ACU<CachedShardRecord_ACU | undefined>('readonly', (store): IDBRequest<CachedShardRecord_ACU | undefined> => store.get(key));
        if (!record?.shard) return null;
        const normalizedExpectedChecksum = String(expectedChecksum || '').trim();
        if (normalizedExpectedChecksum && String(record.checksum || '') !== normalizedExpectedChecksum) {
            return null;
        }
        void putVectorIndexCachedShard_ACU(indexId, shardId, record.shard, record.checksum).catch((): undefined => undefined);
        return record.shard;
    } catch {
        return null;
    }
}

export async function putVectorIndexCachedShard_ACU(
    indexId: string,
    shardId: string,
    shard: SummaryVectorIndexShard_ACU,
    checksum = '',
): Promise<void> {
    try {
        const json = JSON.stringify(shard || {});
        const now = Date.now();
        const record: CachedShardRecord_ACU = {
            key: makeKey_ACU(indexId, shardId),
            indexId,
            shardId,
            shard,
            byteSize: new Blob([json]).size,
            checksum,
            lastAccessAt: now,
            createdAt: now,
        };
        await runStore_ACU<IDBValidKey>('readwrite', (store) => store.put(record));
    } catch {
        // 临时缓存失败不应影响权威外置文件链路。
    }
}

export async function deleteVectorIndexCachedShard_ACU(indexId: string, shardId: string): Promise<void> {
    try {
        await runStore_ACU<undefined>('readwrite', (store) => store.delete(makeKey_ACU(indexId, shardId)) as IDBRequest<undefined>);
    } catch {}
}

export async function deleteVectorIndexCacheByIndex_ACU(indexId: string): Promise<void> {
    try {
        const db = await openDb_ACU();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME_ACU, 'readwrite');
            const store = tx.objectStore(STORE_NAME_ACU);
            const index = store.index('indexId');
            const request = index.openCursor(IDBKeyRange.only(indexId));
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
            request.onerror = () => reject(request.error || new Error('清理向量临时缓存失败'));
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error || new Error('清理向量临时缓存事务失败'));
            };
        });
    } catch {}
}

export async function clearVectorIndexTempCache_ACU(): Promise<void> {
    try {
        await runStore_ACU<undefined>('readwrite', (store) => store.clear() as IDBRequest<undefined>);
    } catch {}
}

export async function estimateVectorIndexTempCache_ACU(indexId?: string): Promise<{ bytes: number; count: number }> {
    try {
        const targetIndexId = String(indexId || '').trim();
        const db = await openDb_ACU();
        return await new Promise((resolve, reject) => {
            let bytes = 0;
            let count = 0;
            const tx = db.transaction(STORE_NAME_ACU, 'readonly');
            const store = tx.objectStore(STORE_NAME_ACU);
            const source = targetIndexId ? store.index('indexId') : store;
            const request = targetIndexId
                ? source.openCursor(IDBKeyRange.only(targetIndexId))
                : source.openCursor();
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    const record = cursor.value as CachedShardRecord_ACU;
                    bytes += Math.max(0, Number(record.byteSize) || 0);
                    count += 1;
                    cursor.continue();
                }
            };
            request.onerror = () => reject(request.error || new Error('估算向量临时缓存失败'));
            tx.oncomplete = () => {
                db.close();
                resolve({ bytes, count });
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error || new Error('估算向量临时缓存事务失败'));
            };
        });
    } catch {
        return { bytes: 0, count: 0 };
    }
}
