/**
 * useFormFillInjectionTarget — 填表"注入目标世界书"（Component A，§4.2）
 *
 * 管理 worldbookConfig.injectionTarget。值为：
 *   - 'character'（写入角色卡主世界书；默认）
 *   - 一个具体的世界书名（写入指定世界书）
 *
 * 这个 target 是写入侧（填好的表内容会写到这本书的条目里），
 * 与 Component B 的 source/enabledEntries（提示词附带条目）相互独立。
 */
import { computed, ref } from 'vue';
import {
  currentChatFileIdentifier_ACU,
  currentJsonTableData_ACU,
} from '../../service/runtime/state-manager';
import { getCurrentWorldbookConfig_ACU } from '../../service/settings/settings-readers';
import { saveSettings_ACU } from '../../service/settings/settings-service';
import {
  deleteAllGeneratedEntries_ACU,
  updateReadableLorebookEntry_ACU,
} from '../../service/worldbook/pipeline';
import {
  getCharLorebooks_ACU,
  getCurrentCharPrimaryLorebook_ACU,
} from '../../service/worldbook/worldbook-service';
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../shared/utils';
import { useToastStore } from '../stores/toast-store';

const CLEANUP_SETTLE_DELAY_MS = 300;

function normalizeTarget(value: unknown): string {
  const trimmed = String(value || '').trim();
  return trimmed || 'character';
}

async function waitForCleanupSettle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, CLEANUP_SETTLE_DELAY_MS));
}

async function resolveLorebookName(targetSetting: string): Promise<string | null> {
  if (targetSetting === 'character') {
    return await getCurrentCharPrimaryLorebook_ACU();
  }
  return targetSetting || null;
}

export function useFormFillInjectionTarget() {
  const target = ref<string>('character');
  const switching = ref(false);
  const toast = useToastStore();

  function refreshFromSettings(): void {
    const cfg = getCurrentWorldbookConfig_ACU();
    target.value = normalizeTarget(cfg?.injectionTarget);
  }

  function setTarget(value: string): void {
    const cfg = getCurrentWorldbookConfig_ACU();
    cfg.injectionTarget = normalizeTarget(value);
    target.value = cfg.injectionTarget;
    saveSettings_ACU();
  }

  async function switchTarget(value: string): Promise<void> {
    const cfg = getCurrentWorldbookConfig_ACU();
    const oldTargetSetting = normalizeTarget(cfg.injectionTarget);
    const newTargetSetting = normalizeTarget(value);
    if (oldTargetSetting === newTargetSetting) return;

    switching.value = true;
    try {
      const oldLorebookName = await resolveLorebookName(oldTargetSetting);
      if (oldLorebookName) {
        toast.info(`正在从旧目标 [${oldLorebookName}] 中清除条目...`, { muteable: false });
        try {
          await deleteAllGeneratedEntries_ACU(oldLorebookName);
          await waitForCleanupSettle();
        } catch (e) {
          logError_ACU(`Failed to clean up old target ${oldLorebookName}:`, e);
        }
      } else {
        logWarn_ACU('Old lorebook name could not be determined, skipping cleanup.');
      }

      cfg.injectionTarget = newTargetSetting;
      target.value = newTargetSetting;
      saveSettings_ACU();
      logDebug_ACU(
        `Injection target changed from "${oldTargetSetting}" to "${newTargetSetting}" for char ${currentChatFileIdentifier_ACU}.`,
      );

      if (currentJsonTableData_ACU) {
        toast.info('正在向新目标注入条目...', { muteable: false });
        await updateReadableLorebookEntry_ACU(true);
        toast.success('数据注入目标已成功切换！', { muteable: false });
      } else {
        toast.warning('数据注入目标已更新，但当前无数据可注入。', { muteable: false });
      }
    } finally {
      switching.value = false;
    }
  }

  /** WorldbookSelector 用的 modelValue：'character' 或 bookName。 */
  const selectorValue = computed<string>(() => target.value || 'character');

  async function onSelectorChange(value: string): Promise<void> {
    await switchTarget(value);
  }

  /** 文案：当前注入目标的人类可读名。 */
  async function describeTarget(): Promise<string> {
    if (target.value === 'character') {
      try {
        const charLorebooks = await getCharLorebooks_ACU({ type: 'all' });
        return charLorebooks.primary
          ? `角色卡绑定世界书 · ${charLorebooks.primary}`
          : '角色卡绑定世界书（当前未解析到角色卡）';
      } catch {
        return '角色卡绑定世界书';
      }
    }
    return target.value || '（未选择）';
  }

  return {
    target,
    switching,
    selectorValue,
    refreshFromSettings,
    setTarget,
    switchTarget,
    onSelectorChange,
    describeTarget,
  };
}
