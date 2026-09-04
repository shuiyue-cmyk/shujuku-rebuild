/**
 * presentation/bootstrap/api-groups/plot-preset-api.ts
 * 剧情推进预设管理 API + 游戏初始化 API
 */

import {
  deriveTemplatePresetNameForImport_ACU
} from '../../../shared/template-preset-utils';
import {
  logDebug_ACU,
  logError_ACU,
  logWarn_ACU
} from '../../../shared/utils';
import {
  buildDefaultGameTemplate_ACU
} from '../../../shared/default-game-template';
import {
  settings_ACU
} from '../../../service/runtime/state-manager';
import {
  getCurrentRuntimePlotPresetName_ACU,
  normalizePlotPresetExcludeRules_ACU,
  switchCurrentChatPlotPreset_ACU
} from '../../../service/plot/plot-logic';
import {
  resetCurrentChatTableStateFromTemplate_ACU
} from '../../../service/table/template-state-reset';
import {
  applyChatTemplateSnapshotWithReconciliation_ACU,
  upsertTemplatePreset_ACU
} from '../../../service/template/template-preset-service';
import {
  sanitizeTemplateSnapshotForChat_ACU
} from '../../../service/template/chat-scope';
import {
  isSqliteMode
} from '../../../service/table/storage-mode';
import {
  didSqliteFallbackAfterReload_ACU,
  reloadStorageProvider
} from '../../../service/table/table-storage-strategy';
import {
  saveSettingsAndNotify_ACU
} from '../../components/settings-ui-helpers';
import {
  refreshPresetUIAfterSwitch_ACU
} from '../../components/pipeline-ui-helpers';
import type {
  ApiGroupContext
} from './callback-api';

export function createPlotPresetApi(ctx: ApiGroupContext): Record<string, Function> {
    return {
        getPlotPresets: function() {
            try {
                const presets = settings_ACU.plotSettings?.promptPresets || [];
                return presets.map((p: any) => normalizePlotPresetExcludeRules_ACU(p));
            } catch (e) {
                logError_ACU('getPlotPresets failed:', e);
                return [];
            }
        },

        getCurrentPlotPreset: function() {
            try {
                return getCurrentRuntimePlotPresetName_ACU({ fallbackToGlobal: true });
            } catch (e) {
                logError_ACU('getCurrentPlotPreset failed:', e);
                return '';
            }
        },

        switchPlotPreset: function(presetName: any) {
            try {
                if (presetName === undefined || presetName === null) {
                    logWarn_ACU('switchPlotPreset: Invalid preset name provided.');
                    return false;
                }

                const result = switchCurrentChatPlotPreset_ACU(presetName, {
                    source: 'api',
                    save: true,
                });

                if (!result) {
                    logWarn_ACU(`switchPlotPreset: Preset "${presetName}" not found.`);
                    return false;
                }

                logDebug_ACU(`Successfully switched current chat to plot preset: "${result.followsGlobal ? '跟随全局' : result.presetName}"`);
                refreshPresetUIAfterSwitch_ACU();
                return true;
            } catch (e) {
                logError_ACU('switchPlotPreset failed:', e);
                return false;
            }
        },

        injectPlotPresetToCurrentChat: function(presetName: any) {
            try {
                if (presetName === undefined || presetName === null) {
                    logWarn_ACU('injectPlotPresetToCurrentChat: Invalid preset name provided.');
                    return false;
                }

                const result = switchCurrentChatPlotPreset_ACU(presetName, {
                    source: 'api',
                    save: true,
                });

                if (!result) {
                    logWarn_ACU(`injectPlotPresetToCurrentChat: Preset "${presetName}" not found.`);
                    return false;
                }

                logDebug_ACU(`Injected global plot preset into current chat: "${result.followsGlobal ? '跟随全局' : result.presetName}"`);
                refreshPresetUIAfterSwitch_ACU();
                return true;
            } catch (e) {
                logError_ACU('injectPlotPresetToCurrentChat failed:', e);
                return false;
            }
        },

        getPlotPresetDetails: function(presetName: any) {
            try {
                if (!presetName || typeof presetName !== 'string') {
                    return null;
                }
                const presets = settings_ACU.plotSettings?.promptPresets || [];
                const preset = presets.find((p: any) => p.name === presetName);
                return preset ? normalizePlotPresetExcludeRules_ACU(preset) : null;
            } catch (e) {
                logError_ACU('getPlotPresetDetails failed:', e);
                return null;
            }
        },

        getPlotPresetNames: function() {
            try {
                const presets = settings_ACU.plotSettings?.promptPresets || [];
                return presets.map((p: any) => p.name);
            } catch (e) {
                logError_ACU('getPlotPresetNames failed:', e);
                return [];
            }
        },

        importPlotPresetFromData: async function(presetData: any, options: any = {}) {
            try {
                const { overwrite = false, switchTo = false } = options;
                let preset;

                if (typeof presetData === 'string') {
                    try {
                        preset = JSON.parse(presetData);
                    } catch (parseError) {
                        return { success: false, message: `JSON解析错误: ${parseError.message}` };
                    }
                } else if (typeof presetData === 'object' && presetData !== null) {
                    preset = JSON.parse(JSON.stringify(presetData));
                } else {
                    return { success: false, message: '无效的预设数据：必须是 JSON 对象或 JSON 字符串' };
                }

                if (!preset.name || typeof preset.name !== 'string' || preset.name.trim() === '') {
                    return { success: false, message: '预设数据无效：缺少 "name" 字段或名称为空' };
                }

                const presetName = preset.name.trim();
                const presets = settings_ACU.plotSettings?.promptPresets || [];
                const existingIndex = presets.findIndex((p: any) => p.name === presetName);
                const normalizedPreset = normalizePlotPresetExcludeRules_ACU(preset);
                normalizedPreset.name = presetName;

                let finalName = presetName;

                if (existingIndex !== -1) {
                    if (overwrite) {
                        presets[existingIndex] = normalizedPreset;
                        logDebug_ACU(`[API] importPlotPresetFromData: 覆盖已存在的预设 "${presetName}"`);
                    } else {
                        let counter = 1;
                        while (presets.some((p: any) => p.name === finalName)) {
                            finalName = `${presetName} (${counter})`;
                            counter++;
                        }
                        normalizedPreset.name = finalName;
                        presets.push(normalizedPreset);
                        logDebug_ACU(`[API] importPlotPresetFromData: 预设已存在，重命名为 "${finalName}"`);
                    }
                } else {
                    presets.push(normalizedPreset);
                    logDebug_ACU(`[API] importPlotPresetFromData: 新增预设 "${presetName}"`);
                }

                settings_ACU.plotSettings.promptPresets = presets;
                saveSettingsAndNotify_ACU();

                let switchedCurrentChat = false;
                if (switchTo) {
                    switchedCurrentChat = ctx.getApi().injectPlotPresetToCurrentChat(finalName) === true;
                } else {
                    // 导入预设后刷新 UI 下拉框与状态显示
                    refreshPresetUIAfterSwitch_ACU();
                }

                return {
                    success: true,
                    message: switchedCurrentChat
                        ? `预设 "${finalName}" 已成功导入到全局预设库，并已切换当前聊天使用该预设。`
                        : `预设 "${finalName}" 已成功导入到全局预设库！`,
                    presetName: finalName,
                };

            } catch (e) {
                logError_ACU('importPlotPresetFromData failed:', e);
                return { success: false, message: `导入失败: ${e.message}` };
            }
        },

        importPlotPresetsFromData: async function(presetsArray: any[], options: any = {}) {
            try {
                if (!Array.isArray(presetsArray)) {
                    return { success: false, message: '输入必须是数组', imported: 0, failed: 0, details: [] };
                }

                const details = [];
                let imported = 0;
                let failed = 0;

                for (const presetData of presetsArray) {
                    const result = await ctx.getApi().importPlotPresetFromData(presetData, { ...options, switchTo: false });
                    details.push(result);
                    if (result.success) {
                        imported++;
                    } else {
                        failed++;
                    }
                }

                // 批量导入结束后统一刷新一次 UI
                refreshPresetUIAfterSwitch_ACU();

                return {
                    success: failed === 0,
                    message: `批量导入完成：成功 ${imported} 个，失败 ${failed} 个`,
                    imported,
                    failed,
                    details
                };

            } catch (e) {
                logError_ACU('importPlotPresetsFromData failed:', e);
                return { success: false, message: `批量导入失败: ${e.message}`, imported: 0, failed: 0, details: [] };
            }
        },

        exportAllPlotPresets: function() {
            try {
                const presets = settings_ACU.plotSettings?.promptPresets || [];
                return presets.map((p: any) => normalizePlotPresetExcludeRules_ACU(p));
            } catch (e) {
                logError_ACU('exportAllPlotPresets failed:', e);
                return [];
            }
        },

        // =========================
        // 游戏初始化 API
        // =========================

        initGameSession: async function(characterData: any, options: any = {}) {
            // fix8 登记性弃用提示（不改语义）：options.presetName 在本库已无任何读取点
            // （剧情引导预设只能由 options.presetData 自备导入，见下方步骤2）。旧调用方
            // 传了 presetName 又未携带 presetData 时提示一次；presetName 仍被忽略，
            // 初始化结果不受影响。
            if (options?.presetName && !options?.presetData) {
                logWarn_ACU('[游戏初始化] options.presetName 已弃用：本库不读取该参数，剧情引导预设请改用 options.presetData 传入。本次调用将忽略 presetName。');
            }
            const result: any = {
                success: false,
                templateInjected: false,
                presetLoaded: false,
                // fix8 历史行为登记（只登记不修）：protagonistInitialized / equipmentInitialized
                // 自「主角与装备初始化职责剥离出初始化 API」起恒为 false，仅为兼容旧调用方的
                // 字段形状保留。下游不得基于这两个字段做逻辑分支。
                protagonistInitialized: false,
                equipmentInitialized: false,
                runtimeReady: true,
                warning: '',
                message: ''
            };

            try {
                // 步骤1: 注入数据库模板到首楼
                if (options.injectTemplate !== false) {
                    logDebug_ACU('[游戏初始化] 开始注入数据库模板...');
                    try {
                        let templateData;

                        if (options.templateData) {
                            logDebug_ACU('[游戏初始化] 使用传入的模板数据');
                            templateData = options.templateData;
                        } else {
                            // 内置默认模板：从库内默认表结构（shared/table-defaults 单一来源）运行时构造；
                            // 旧实现 fetch('/TavernDB_template_默认模板.json') 的静态资源在本库/上游/磁盘均不存在，任何宿主必 404。
                            logDebug_ACU('[游戏初始化] 使用库内默认表结构构造内置模板');
                            templateData = buildDefaultGameTemplate_ACU();
                        }

                        const templateObj = typeof templateData === 'string' ? JSON.parse(templateData) : templateData;
                        const templatePresetName = deriveTemplatePresetNameForImport_ACU({
                            presetName: options.templatePresetName || characterData?.name || characterData?.data?.name || '',
                        });
                        const resetExistingTableData = options.resetExistingTableData !== false;
                        const templateResult = resetExistingTableData
                            ? await resetCurrentChatTableStateFromTemplate_ACU(templateObj, {
                                reason: 'game_init',
                                presetName: templatePresetName,
                                source: 'game_init',
                                resetExistingTableData: true,
                            })
                            : await applyChatTemplateSnapshotWithReconciliation_ACU(templateObj, {
                                source: 'game_init',
                                presetName: templatePresetName,
                                destructiveChangeConfirmed: false,
                            });
                        if (!templateResult?.saved) throw new Error(templateResult?.error || '模板原子提交失败');
                        result.templateInjected = true;
                        const committedTemplateData = (
                            'normalizedTemplateData' in templateResult && templateResult.normalizedTemplateData
                        ) || templateObj;
                        // 预设库不是聊天状态的一部分，不能先于严格聊天保存；失败只报告警告，不能回滚已提交 checkpoint。
                        if (templatePresetName) {
                            try {
                                const snapshot = sanitizeTemplateSnapshotForChat_ACU(committedTemplateData);
                                if (!snapshot?.templateStr || !upsertTemplatePreset_ACU(templatePresetName, snapshot.templateStr)) {
                                    throw new Error('模板预设存储拒绝写入。');
                                }
                            } catch (error: any) {
                                result.warning = `模板已保存，但模板预设注册失败：${error?.message || String(error)}`;
                                logWarn_ACU('[游戏初始化] 模板预设注册失败:', error);
                            }
                        }
                        const runtimeStatus = templateResult as { runtimeReady?: boolean; postCommitWarning?: string };
                        if (runtimeStatus.runtimeReady === false) {
                            result.runtimeReady = false;
                            result.warning = runtimeStatus.postCommitWarning || '模板已保存，但运行时尚未就绪。';
                        }
                        const messageIndex = (templateResult as { messageIndex?: number }).messageIndex;
                        if (isSqliteMode() && resetExistingTableData) {
                            try {
                                await reloadStorageProvider();
                                if (didSqliteFallbackAfterReload_ACU('sqlite')) {
                                    throw new Error('SQLite 运行时重载后已回退到原生模式。');
                                }
                            } catch (error: any) {
                                result.runtimeReady = false;
                                result.warning = `模板已保存，但 SQLite 运行时重建失败：${error?.message || String(error)}`;
                                logWarn_ACU('[游戏初始化] SQLite 运行时重建失败:', error);
                            }
                        }
                        // 模板已由严格保存路径写入聊天。这里若同步触发 MESSAGE_UPDATED 或表格
                        // 回调，会销毁正在 await initGameSession() 的第三方 iframe，使其后续
                        // insertRow 永远没有机会执行。初始化 API 只保证持久化和 runtime 就绪；
                        // 宿主重渲染仍由正常消息生命周期或调用方后续写入的既有通知路径处理。
                        logDebug_ACU('[游戏初始化] 数据库模板已原子提交');
                    } catch (templateError) {
                        logError_ACU('[游戏初始化] 模板注入失败:', templateError);
                        throw new Error(`数据库模板注入失败: ${templateError.message}`);
                    }
                }

                // 步骤2: 加载剧情引导预设
                if (options.loadPreset !== false) {
                    // 本库不内置任何剧情引导预设：旧实现 fetch('/西幻剧情引导.json') 的静态资源在本库/上游/磁盘均不存在，
                    // 任何宿主必 404。预设由内容方自备——只有调用方显式传入 options.presetData 才走导入链；
                    // 未提供时记录跳过并补一句 warning，不 throw、不中断初始化。
                    if (!options.presetData) {
                        logDebug_ACU('[游戏初始化] 未提供 presetData，跳过剧情推进预设加载');
                        const skipPresetWarning = '未提供 presetData，跳过剧情推进预设加载（预设由内容方自备）';
                        result.warning = result.warning ? result.warning + '；' + skipPresetWarning : skipPresetWarning;
                    } else {
                        logDebug_ACU('[游戏初始化] 开始加载剧情引导预设...');
                        try {
                            const importResult = await ctx.getApi().importPlotPresetFromData(options.presetData, {
                                overwrite: true,
                                switchTo: true
                            });
                            if (!importResult.success) {
                                throw new Error(importResult.message || '预设导入失败');
                            }
                            result.presetLoaded = true;
                            logDebug_ACU('[游戏初始化] 剧情引导预设加载成功');
                        } catch (presetError) {
                            logError_ACU('[游戏初始化] 预设加载失败:', presetError);
                            logWarn_ACU('[游戏初始化] 剧情引导预设加载失败，但继续游戏初始化');
                        }
                    }
                }

                // 步骤3: 保存设置。不得在异步初始化链中刷新消息/iframe，见上方模板提交说明。
                try {
                    saveSettingsAndNotify_ACU();
                } catch (saveError) {
                    logWarn_ACU('[游戏初始化] 保存设置时出错:', saveError);
                }

                result.success = true;
                result.message = '游戏初始化成功';
                logDebug_ACU('[游戏初始化] 游戏初始化流程完成');

            } catch (error) {
                result.message = `初始化失败: ${error.message}`;
                logError_ACU('initGameSession failed:', error);
            }

            return result;
        },
    };
}
