// ═══════════════════════════════════════════════════════════
// service/settings/feature-preset-reference-service.ts — 功能级 API 预设引用
//
// 管理 API 预设在表格、剧情、正文优化、vector/agent 中的引用字段。
// 引用字段的写入必须走 service（校验预设存在），删除/重命名预设时
// 由 api-preset-service 原子清理，本模块只负责单点写入。
// ═══════════════════════════════════════════════════════════════

import { settings_ACU } from '../runtime/state-manager';
import { getCurrentVectorMemoryConfig_ACU } from '../vector/vector-memory-config';
import { saveSettings_ACU, type SaveSettingsResult_ACU } from './settings-service';
import { findPresetByName_ACU, ensureApiSettingsShape_ACU } from './api-preset-service';
import { logDebug_ACU } from '../../shared/utils';

export interface PresetRefWriteResult_ACU {
  ok: boolean;
  code: 'ok' | 'invalid_input' | 'not_found' | 'save_failed' | 'settings_loading';
  changed: boolean;
  saveResult?: SaveSettingsResult_ACU;
  message?: string;
}

type PresetRefTarget_ACU =
  | 'table'
  | 'plot'
  | 'plot_task'
  | 'optimization'
  | 'vector_keyword';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null));
}

function ensureContentOptimizationShape_ACU(): void {
  if (!settings_ACU.contentOptimizationSettings || typeof settings_ACU.contentOptimizationSettings !== 'object') {
    settings_ACU.contentOptimizationSettings = { apiPreset: '' };
  }
  if (typeof settings_ACU.contentOptimizationSettings.apiPreset !== 'string') {
    settings_ACU.contentOptimizationSettings.apiPreset = '';
  }
}

function snapshotRefFields_ACU(target: PresetRefTarget_ACU, taskId = ''): Record<string, unknown> {
  ensureApiSettingsShape_ACU();
  ensureContentOptimizationShape_ACU();
  switch (target) {
    case 'table':
      return { tableApiPreset: settings_ACU.tableApiPreset };
    case 'plot':
      return { plotApiPreset: settings_ACU.plotApiPreset };
    case 'plot_task':
      return { plotTaskOverride: settings_ACU.plotTaskApiPresetOverridesById?.[taskId] };
    case 'optimization':
      return { contentOptimizationApiPreset: settings_ACU.contentOptimizationSettings.apiPreset };
    case 'vector_keyword':
      return { vectorKeywordApiPreset: clone(getCurrentVectorMemoryConfig_ACU().keywordApiPreset) };
  }
}

function restoreRefFields_ACU(target: PresetRefTarget_ACU, snapshot: Record<string, unknown>, taskId = ''): void {
  switch (target) {
    case 'table':
      settings_ACU.tableApiPreset = String(snapshot.tableApiPreset ?? '');
      break;
    case 'plot':
      settings_ACU.plotApiPreset = String(snapshot.plotApiPreset ?? '');
      break;
    case 'plot_task':
      if (snapshot.plotTaskOverride) {
        settings_ACU.plotTaskApiPresetOverridesById[taskId] = String(snapshot.plotTaskOverride);
      } else {
        delete settings_ACU.plotTaskApiPresetOverridesById[taskId];
      }
      break;
    case 'optimization':
      settings_ACU.contentOptimizationSettings.apiPreset = String(snapshot.contentOptimizationApiPreset ?? '');
      break;
    case 'vector_keyword':
      getCurrentVectorMemoryConfig_ACU().keywordApiPreset = String(snapshot.vectorKeywordApiPreset ?? '');
      break;
  }
}

/** 设置某功能的 API 预设引用；空串表示使用当前配置 */
export function setFeatureApiPreset_ACU(
  target: PresetRefTarget_ACU,
  presetName: string,
  options: { taskId?: string } = {},
): PresetRefWriteResult_ACU {
  const normalized = String(presetName || '').trim();
  ensureApiSettingsShape_ACU();
  if (normalized) {
    const preset = findPresetByName_ACU(settings_ACU.apiPresets, normalized);
    if (!preset) {
      return { ok: false, code: 'not_found', changed: false, message: `API 预设 "${normalized}" 不存在。` };
    }
  }

  const snapshot = snapshotRefFields_ACU(target, options.taskId || '');
  switch (target) {
    case 'table':
      settings_ACU.tableApiPreset = normalized;
      break;
    case 'plot':
      settings_ACU.plotApiPreset = normalized;
      break;
    case 'plot_task': {
      const taskId = String(options.taskId || '').trim();
      if (!taskId) {
        return { ok: false, code: 'invalid_input', changed: false, message: '任务 ID 不能为空。' };
      }
      if (normalized) {
        settings_ACU.plotTaskApiPresetOverridesById[taskId] = normalized;
      } else {
        delete settings_ACU.plotTaskApiPresetOverridesById[taskId];
      }
      break;
    }
    case 'optimization':
      ensureContentOptimizationShape_ACU();
      settings_ACU.contentOptimizationSettings.apiPreset = normalized;
      break;
    case 'vector_keyword':
      getCurrentVectorMemoryConfig_ACU().keywordApiPreset = normalized;
      break;
  }

  const saveResult = saveSettings_ACU();
  if (!saveResult.saved) {
    restoreRefFields_ACU(target, snapshot, options.taskId || '');
    return {
      ok: false,
      code: saveResult.code === 'settings_loading' ? 'settings_loading' : 'save_failed',
      changed: true,
      saveResult,
      message: saveResult.warning || saveResult.error || '保存失败，已回滚。',
    };
  }
  logDebug_ACU(`[预设引用] ${target} 的 API 预设已更新: ${normalized || '(当前配置)'}`);
  return { ok: true, code: 'ok', changed: true, saveResult };
}
