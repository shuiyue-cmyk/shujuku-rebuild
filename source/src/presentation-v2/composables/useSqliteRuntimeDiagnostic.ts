import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  getStorageRuntimeHealth_ACU,
  reloadStorageProvider,
} from '../../service/table/table-storage-strategy';
import { isSqliteMode } from '../../service/table/storage-mode';
import { dataMgmtCopy } from '../copy/data-mgmt-copy';
import { useToastStore } from '../stores/toast-store';

const HEALTH_REFRESH_INTERVAL_MS = 1000;

export interface SqliteRuntimeHealthSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'degraded' | 'failed' | 'disposed';
  expectedMode: 'native' | 'sqlite';
  activeMode: 'native' | 'sqlite' | null;
  source?: 'merged' | 'initialized' | 'empty';
  loadToken: number;
  failureCode?: 'provider_fallback' | 'provider_load_failed' | 'provider_init_failed' | 'stale_load_discarded';
}

function toHealthSnapshot(health: ReturnType<typeof getStorageRuntimeHealth_ACU>): SqliteRuntimeHealthSnapshot {
  const { status, expectedMode, activeMode, source, loadToken, failureCode } = health;
  return { status, expectedMode, activeMode, source, loadToken, failureCode };
}

/**
 * 当前聊天 SQLite 内存运行时的只读诊断与受控重载入口。
 * 不读取或持久化聊天、Checkpoint、模板及世界书内容。
 */
export function useSqliteRuntimeDiagnostic() {
  const toast = useToastStore();
  const health = ref<SqliteRuntimeHealthSnapshot>(toHealthSnapshot(getStorageRuntimeHealth_ACU()));
  const busy = ref(false);
  const isSqliteAvailable = ref(isSqliteMode());
  let timer: ReturnType<typeof setInterval> | undefined;

  const isVisible = computed(() => isSqliteAvailable.value);

  function refresh(): void {
    isSqliteAvailable.value = isSqliteMode();
    health.value = toHealthSnapshot(getStorageRuntimeHealth_ACU());
  }

  async function reload(): Promise<void> {
    if (busy.value) return;
    refresh();
    if (!isSqliteAvailable.value) return;

    busy.value = true;
    try {
      const result = await reloadStorageProvider();
      refresh();
      if (result.ok) {
        toast.success(dataMgmtCopy.panels.backup.sqliteRuntime.reloadSuccess);
      } else if (result.degraded) {
        toast.warning(dataMgmtCopy.panels.backup.sqliteRuntime.reloadDegraded);
      } else {
        toast.error(dataMgmtCopy.panels.backup.sqliteRuntime.reloadFailed);
      }
    } catch {
      refresh();
      toast.error(dataMgmtCopy.panels.backup.sqliteRuntime.reloadFailed);
    } finally {
      busy.value = false;
    }
  }

  onMounted(() => {
    timer = setInterval(refresh, HEALTH_REFRESH_INTERVAL_MS);
  });
  onUnmounted(() => {
    if (timer !== undefined) clearInterval(timer);
  });

  return { health, busy, isVisible, refresh, reload };
}
