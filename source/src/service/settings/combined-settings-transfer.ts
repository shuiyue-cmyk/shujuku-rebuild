/**
 * 合并配置（提示词 + 全局模板 + 删除范围）的导出与原子导入（R9-07）。
 * 合并总结已停用：导出不再写 merge / autoMerge 字段（R9-12）；导入仍接受旧文件里的这些字段。
 *
 * 旧公开 API 与 V2 数据管理页共用这一份实现：
 * - 导出读设置里的提示词（旧实现读已停用弹窗的 DOM，恒为空）；
 * - 导入先写设置再应用模板，模板失败时整体回滚设置，不留半截导入。
 */
import { ensureSheetOrderNumbers_ACU, parseTableTemplateJson_ACU } from '../../shared/utils';
import { settings_ACU } from '../runtime/state-manager';
import { sanitizeChatSheetsObject_ACU } from '../template/chat-scope';
import { applyTemplateSnapshotToScope_ACU } from '../template/template-preset-service';
import { applyCombinedSettingsImport_ACU, saveSettings_ACU } from './settings-service';

export function cloneSettingsSnapshot_ACU(settings: any): any {
  try {
    return JSON.parse(JSON.stringify(settings));
  } catch {
    return null;
  }
}

function restoreSettingsSnapshot_ACU(settings: any, snapshot: any): void {
  if (!snapshot || !settings || typeof settings !== 'object') return;
  for (const key of Object.keys(settings)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) delete settings[key];
  }
  Object.assign(settings, snapshot);
}

/** 按快照整体还原设置并落盘；返回错误文本，成功返回 null。 */
export function rollbackSettingsSnapshot_ACU(settings: any, snapshot: any): string | null {
  if (!snapshot) return '无法创建 settings 回滚快照。';
  restoreSettingsSnapshot_ACU(settings, snapshot);
  try {
    const result = saveSettings_ACU();
    if (result && result.saved === false) return result.error || 'settings 回滚保存失败。';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
}

function currentCharCardPromptSegments_ACU(): any[] {
  const value = (settings_ACU as any).charCardPrompt;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [{ role: 'USER', content: value }];
  return [];
}

export function buildCombinedSettingsExportPayload_ACU(): Record<string, unknown> {
  const templateObj = parseTableTemplateJson_ACU({ stripSeedRows: false });
  if (!templateObj || typeof templateObj !== 'object') {
    throw new Error('无法解析当前模板。');
  }

  const sheetKeys = Object.keys(templateObj).filter(k => k.startsWith('sheet_'));
  ensureSheetOrderNumbers_ACU(templateObj, { baseOrderKeys: sheetKeys, forceRebuild: false });
  const templateData = sanitizeChatSheetsObject_ACU(templateObj, { ensureMate: true });
  const settings = settings_ACU as any;

  return {
    prompt: currentCharCardPromptSegments_ACU(),
    template: templateData,
    deleteStartFloor: settings.deleteStartFloor || null,
    deleteEndFloor: settings.deleteEndFloor || null,
  };
}

/**
 * 校验 → 写设置 → 应用全局模板；任一步失败都按导入前的快照回滚设置后抛错，
 * 错误文本里说明回滚是否成功。
 */
export async function importCombinedSettingsWithRollback_ACU(
  combinedData: any,
  options: { source: string; presetName: string },
): Promise<void> {
  if (!Array.isArray(combinedData?.prompt)) throw new Error('"prompt" 的值必须是数组。');
  if (!combinedData?.template || typeof combinedData.template !== 'object') throw new Error('缺少有效的 "template" 对象。');

  const settingsSnapshot = cloneSettingsSnapshot_ACU(settings_ACU);
  if (!settingsSnapshot) throw new Error('无法创建 settings 回滚快照，未导入任何内容。');

  try {
    applyCombinedSettingsImport_ACU(combinedData);
    // [瘦身] 导入时清洗模板（兼容旧模板带冗余字段或缺顺序编号）
    const sheetKeys = Object.keys(combinedData.template).filter(k => k.startsWith('sheet_'));
    ensureSheetOrderNumbers_ACU(combinedData.template, { baseOrderKeys: sheetKeys, forceRebuild: false });
    const sanitizedTemplate = sanitizeChatSheetsObject_ACU(combinedData.template, { ensureMate: true });
    const applied = await applyTemplateSnapshotToScope_ACU(sanitizedTemplate, {
      scope: 'global',
      source: options.source,
      presetName: options.presetName,
      save: true,
      persistChatScope: false,
    });
    if (!applied) throw new Error('模板结构无效，无法应用到当前全局模板。');
    if (typeof applied === 'object' && 'saved' in applied && (applied as any).saved === false) {
      throw new Error((applied as any).error || '模板已解析，但应用到当前全局模板失败（当前聊天协调提交被拒绝）。');
    }
  } catch (error) {
    const rollbackError = rollbackSettingsSnapshot_ACU(settings_ACU, settingsSnapshot);
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason}${rollbackError ? `；settings 回滚失败：${rollbackError}` : '；已回滚已保存的 settings'}`);
  }
}
