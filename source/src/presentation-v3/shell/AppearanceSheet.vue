<template>
  <UbSheet :is-open="isOpen" title="外观与界面" subtitle="只影响本机显示，不改动任何数据" width="460px" @close="emit('close')">
    <UbSection title="主题" description="点选即切换。主题文件可导入导出。" padded>
      <div class="ub-themes">
        <div
          v-for="t in themeStore.themes"
          :key="t.id"
          class="ub-theme"
          :class="{ 'is-active': t.id === themeStore.activeId }"
        >
          <button type="button" class="ub-theme__pick" :aria-pressed="t.id === themeStore.activeId ? 'true' : 'false'" @click="themeStore.setTheme(t.id)">
            <span class="ub-theme__swatch" :style="{ background: t.tokens.bg0 }" aria-hidden="true">
              <span class="ub-theme__swatch-card" :style="{ background: t.tokens.bg1, borderColor: t.tokens.border2 }">
                <span class="ub-theme__swatch-line" :style="{ background: t.tokens.text1 }"></span>
                <span class="ub-theme__swatch-line is-short" :style="{ background: t.tokens.text3 }"></span>
                <span class="ub-theme__swatch-dot" :style="{ background: t.tokens.accent }"></span>
              </span>
            </span>
            <span class="ub-theme__name">
              <i v-if="t.id === themeStore.activeId" class="fa-solid fa-check" aria-hidden="true"></i>
              {{ t.name }}
              <UbBadge v-if="isCustomThemeId(t.id)" variant="accent">自定义</UbBadge>
            </span>
          </button>
          <div class="ub-theme__tools">
            <UbIconButton icon="fa-solid fa-upload" size="sm" :title="'导出主题：' + t.name" @click="exportTheme(t.id)" />
            <UbIconButton
              v-if="isCustomThemeId(t.id)"
              icon="fa-solid fa-trash-can"
              size="sm"
              variant="danger"
              :title="'删除自定义主题：' + t.name"
              @click="deleteTheme(t.id)"
            />
          </div>
        </div>
      </div>
      <UbFileButton accept="application/json,.json" icon="fa-solid fa-download" variant="soft" block @file="importThemeFile">导入主题</UbFileButton>
    </UbSection>

    <UbSection title="显示">
      <UbRow label="界面缩放" :hint="`当前 ${appearanceStore.uiScaleLabel}`">
        <UbSegmented
          :options="scaleOptions"
          :model-value="appearanceStore.uiScale"
          aria-label="界面缩放"
          size="sm"
          @update:model-value="appearanceStore.setUiScale($event as AcuUiScale)"
        />
      </UbRow>
      <UbRow label="界面模式" hint="基础模式只保留一页必要设置；高手模式展开全部功能页。">
        <UbSegmented
          :options="modeOptions"
          :model-value="uiMode.mode"
          aria-label="界面模式"
          size="sm"
          @update:model-value="setMode"
        />
      </UbRow>
    </UbSection>

  </UbSheet>
</template>

<script setup lang="ts">
import { getAcuHostDocument } from '../../presentation-v2/bootstrap/host-document';
import { ACU_UI_SCALE_OPTIONS, useAppearanceStore, type AcuUiScale } from '../../presentation-v2/stores/appearance-store';
import { useDialogStore } from '../../presentation-v2/stores/dialog-store';
import { useRouterStore } from '../../presentation-v2/stores/router-store';
import { isCustomThemeId, useThemeStore } from '../../presentation-v2/stores/theme-store';
import { useToastStore } from '../../presentation-v2/stores/toast-store';
import { useUiModeStore, type AcuV2UiMode } from '../../presentation-v2/stores/ui-mode-store';
import type { AcuV2ThemeId } from '../../presentation-v2/theme/theme-types';
import UbBadge from '../ui/UbBadge.vue';
import UbFileButton from '../ui/UbFileButton.vue';
import UbIconButton from '../ui/UbIconButton.vue';
import UbRow from '../ui/UbRow.vue';
import UbSection from '../ui/UbSection.vue';
import UbSegmented from '../ui/UbSegmented.vue';
import UbSheet from '../ui/UbSheet.vue';
import { downloadJsonFile_UB, readFileText_UB, sanitizeFilename_UB } from '../ui/file-helpers';

defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const themeStore = useThemeStore();
const appearanceStore = useAppearanceStore();
const uiMode = useUiModeStore();
const router = useRouterStore();
const dialogStore = useDialogStore();
const toastStore = useToastStore();

const scaleOptions = ACU_UI_SCALE_OPTIONS.map(option => ({ value: option.value, label: option.label }));
const modeOptions = [
  { value: 'basic', label: '基础' },
  { value: 'advanced', label: '高手' },
];

function setMode(value: string): void {
  uiMode.setMode(value as AcuV2UiMode);
  router.ensureActiveVisible();
}

async function importThemeFile(file: File): Promise<void> {
  try {
    themeStore.importCustomThemeFromJsonText(await readFileText_UB(file));
    toastStore.success('主题已导入并启用。');
  } catch (error) {
    toastStore.error(error instanceof Error ? error.message : '主题导入失败。');
  }
}

function exportTheme(id: AcuV2ThemeId): void {
  try {
    const theme = themeStore.themes.find(t => t.id === id);
    downloadJsonFile_UB(
      getAcuHostDocument(),
      `acu-v2-theme-${sanitizeFilename_UB(theme?.name || 'custom-theme', 'custom-theme')}.json`,
      themeStore.buildThemeFile(id),
    );
  } catch {
    toastStore.error('主题导出失败。');
  }
}

async function deleteTheme(id: AcuV2ThemeId): Promise<void> {
  if (!isCustomThemeId(id)) return;
  const theme = themeStore.themes.find(t => t.id === id);
  const confirmed = await dialogStore.confirm({
    title: '删除自定义主题',
    message: `删除"${theme?.name || '自定义主题'}"后会从本浏览器移除；如果正在使用它，界面会切回默认深色主题。`,
    confirmLabel: '删除主题',
    confirmVariant: 'danger',
  });
  if (confirmed) themeStore.deleteCustomTheme(id);
}

</script>

<style scoped>
.ub-themes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ub-s2);
}

.ub-theme {
  position: relative;
  min-width: 0;
  border: 1.5px solid var(--ub-line-soft);
  border-radius: var(--ub-r-control);
  background: var(--ub-bg);
  overflow: hidden;
}

.ub-theme.is-active {
  border-color: var(--ub-accent);
}

.ub-theme__pick {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.ub-theme__swatch {
  display: flex;
  align-items: flex-end;
  height: calc(var(--ub-u) * 64);
  padding: 10px 10px 0;
}

.ub-theme__swatch-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  height: 100%;
  padding: 9px 10px;
  border: 1px solid;
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
}

.ub-theme__swatch-line {
  width: 64%;
  height: 5px;
  border-radius: 3px;
}

.ub-theme__swatch-line.is-short {
  width: 40%;
}

.ub-theme__swatch-dot {
  position: absolute;
  right: 10px;
  top: 9px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
}

.ub-theme__name {
  display: flex;
  align-items: center;
  gap: var(--ub-s1);
  min-width: 0;
  padding: var(--ub-s2) var(--ub-s2) var(--ub-s2) var(--ub-s3);
  border-top: 1px solid var(--ub-line-soft);
  background: var(--ub-panel);
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  font-weight: 600;
}

.ub-theme__name .fa-check {
  color: var(--ub-accent-ink);
}

.ub-theme__tools {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 2px;
  border-radius: var(--ub-r-control);
  background: var(--ub-toast-bg);
  opacity: 0;
  transition: opacity 0.14s ease;
}

.ub-theme:hover .ub-theme__tools,
.ub-theme:focus-within .ub-theme__tools,
.ub-theme.is-active .ub-theme__tools {
  opacity: 1;
}

@media (hover: none) {
  .ub-theme__tools {
    opacity: 1;
  }
}
</style>
