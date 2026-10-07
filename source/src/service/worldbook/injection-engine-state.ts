/**
 * service/worldbook/injection-engine-state.ts — 状态重置、目标获取、隔离前缀、条目清理、聊天历史清理
 * 从 injection-engine.ts 拆出
 */
import {
  getCurrentWorldbookConfig_ACU
} from '../settings/settings-readers';
import {
  CHAT_SHEET_GUIDE_FIELD_ACU
} from '../../data/storage/chat-history';
import {
  currentChatFileIdentifier_ACU,
  currentJsonTableData_ACU,
  generationGate_ACU,
  getCurrentIsolationKey_ACU,
  settings_ACU,
  _set_currentChatFileIdentifier_ACU,
  _set_allChatMessages_ACU,
  _set_currentJsonTableData_ACU,
  _set_independentTableStates_ACU,
  _set_lastTotalAiMessages_ACU
} from '../runtime/state-manager';
import {
  getLorebookEntries_ACU,
  deleteLorebookEntries_ACU,
  getCurrentCharacterWorldbookBinding_ACU,
  getCurrentCharPrimaryLorebook_ACU as gwGetCurrentCharPrimaryLorebook_ACU,
  listLorebooks_ACU,
  resolveLorebookNameFromList_ACU
} from '../../data/gateways/worldbook-gateway';
import {
  getChatArray_ACU,
  saveChatToHost_ACU
} from '../../data/gateways/chat-gateway';
import {
  applyPlotWorldbookSelectionForCurrentCharacter_ACU,
  loadSettings_ACU,
  saveSettings_ACU
} from '../settings/settings-service';
import {
  getSortedSheetKeys_ACU
} from '../template/chat-scope';
import {
  deleteAllGeneratedEntries_ACU,
  loadAllChatMessages_ACU
} from './pipeline';
import {
  cleanChatName_ACU,
  cloneScopedConfigData_ACU,
  getChatFirstLayerMessage_ACU,
  logDebug_ACU,
  logError_ACU,
  logWarn_ACU
} from '../../shared/utils';
import {
  getImportStablePrefix_ACU
} from '../../shared/constants';

import {
  purgeSheetKeysFromMessage_ACU
} from '../../data/repositories/chat-message-data-repo';
import {
  runTableWriteTransaction_ACU
} from '../table/table-write-transaction';
import {
  resetPlotAgentWorldbookSessionSnapshot_ACU
} from '../agent/agent-worldbook-takeover';

  async function enforceCleanupOfCharacterWorldbook_ACU() {
      // 延迟一段时间，确保其他操作完成
      await new Promise(resolve => setTimeout(resolve, 1500));

      const worldbookConfig = getCurrentWorldbookConfig_ACU();
      // 如果当前设置明确指定了注入目标不是 'character'（即不是绑定世界书）
      if (worldbookConfig && worldbookConfig.injectionTarget && worldbookConfig.injectionTarget !== 'character') {
          logDebug_ACU('Enforcing cleanup of character bound worldbook...');
          try {
              // 获取当前角色绑定的主世界书
              const charLorebook = await gwGetCurrentCharPrimaryLorebook_ACU();
              if (charLorebook) {
                  // 只有当绑定的世界书与当前配置的目标不同时才清理
                  // (虽然 injectionTarget !== 'character' 已经暗示了这点，但如果用户手动把 injectionTarget 填成了绑定世界书的名字，就要小心了)
                  if (charLorebook !== worldbookConfig.injectionTarget) {
                      logDebug_ACU(`Cleaning up bound worldbook "${charLorebook}" as target is "${worldbookConfig.injectionTarget}"`);
                      await deleteAllGeneratedEntries_ACU(charLorebook);
                  }
              }
          } catch (e) {
              logWarn_ACU('Failed to enforce cleanup of character worldbook:', e);
          }
      }
  }

  export type ScriptStateResetReason_ACU = 'chat_changed' | 'startup_restore';

  export async function resetScriptStateForNewChat_ACU(
    chatFileName: string,
    { reason = 'startup_restore' }: { reason?: ScriptStateResetReason_ACU } = {},
  ) {
    // 修复：当增量更新失败时，chatFileName 可能会暂时变为 null。
    // 之前的逻辑会清除数据库状态，导致"初始化失败"的错误。
    // 新逻辑：如果收到的 chatFileName 无效，则记录一个警告并忽略此事件，
    // 以保留当前的数据库状态，等待一个有效的 CHAT_CHANGED 事件。
    if (!chatFileName || typeof chatFileName !== 'string' || chatFileName.trim() === '' || chatFileName.trim() === 'null') {
        if (!Array.isArray(getChatArray_ACU()) || getChatArray_ACU().length === 0) {
            // [L9] 此处手写清空与 presentation/bootstrap/init.ts 的 clearDerivedRuntimeState_ACU / clearRuntimeForNoActiveChat_ACU 保持同步；
            // 差异：init.ts 是 presentation 层，额外 disposeStorageProvider() 并 notifyRuntimeTableCleared_ACU()；本 service 层刻意不触碰 UI/storage 生命周期。字段变动需两边同步。
            logDebug_ACU(`ACU: Received invalid chat file name "${chatFileName}" with no active chat. Clearing runtime state.`);
            resetPlotAgentWorldbookSessionSnapshot_ACU();
            _set_currentChatFileIdentifier_ACU('');
            _set_currentJsonTableData_ACU(null);
            _set_independentTableStates_ACU({});
            _set_allChatMessages_ACU([]);
            _set_lastTotalAiMessages_ACU(0);
            generationGate_ACU.lastUserMessageId = null;
            generationGate_ACU.lastUserMessageText = '';
            generationGate_ACU.lastUserMessageAt = 0;
            generationGate_ACU.lastUserSendIntentAt = 0;
            generationGate_ACU.lastGeneration = null;
            generationGate_ACU.generationSeq = 0;
            generationGate_ACU.activeGenerations = [];
            return;
        }
        logWarn_ACU(`ACU: Received invalid chat file name: "${chatFileName}". This can happen after an update error. Ignoring event to preserve current state.`);
        // 保持当前状态不变，防止数据库被意外清除
        return;
    }

    logDebug_ACU(`ACU: Resetting script state for new chat: "${chatFileName}"`);
    
    // 直接使用有效的 chatFileName，不再需要调用 /getchatname 或其他回退逻辑。
    _set_currentChatFileIdentifier_ACU(cleanChatName_ACU(chatFileName));

    // [FIX] Reload all settings to ensure template is not stale for new chats.
    // MUST be called AFTER setting currentChatFileIdentifier_ACU so it loads the correct character settings.
    loadSettings_ACU();

    // 填表 / 剧情推进的世界书选择均以角色卡为单位持久化：这里只把当前角色卡的记录
    // 投影到运行时字段，不再在切换聊天时把剧情世界书强制重置为"角色卡绑定世界书"。
    const plotSelection = applyPlotWorldbookSelectionForCurrentCharacter_ACU();
    logDebug_ACU(`ACU: Plot worldbook selection for "${plotSelection.scopeKey || '(deferred)'}" -> ${plotSelection.outcome} (reason: ${reason})`);

    // 当前角色卡绑定在后续读取时重新解析；这里只清除上一会话的内存快照。
    // 不得删除或重写旧世界书中的持久 Agent state。
    resetPlotAgentWorldbookSessionSnapshot_ACU();

    _set_currentJsonTableData_ACU(null);
    _set_independentTableStates_ACU({});
    _set_allChatMessages_ACU([]);
    _set_lastTotalAiMessages_ACU(0); // 重置 AI 消息计数

    // [重构] 切换聊天时重置触发门控状态（从 init.ts CHAT_CHANGED 回调搬入 service 层）
    generationGate_ACU.lastUserMessageId = null;
    generationGate_ACU.lastUserMessageText = '';
    generationGate_ACU.lastUserMessageAt = 0;
    generationGate_ACU.lastUserSendIntentAt = 0;
    generationGate_ACU.lastGeneration = null;
    generationGate_ACU.generationSeq = 0;
    generationGate_ACU.activeGenerations = [];

    logDebug_ACU(
      `ACU: currentChatFileIdentifier FINAL set to: "${currentChatFileIdentifier_ACU}" (Source: CHAT_CHANGED event)`,
    );

    // 持久化聊天数据读取由 presentation/bootstrap/init.ts 的延迟 CHAT_CHANGED 阶段统一执行。
    // 这里绝不从当前内存缓存派生表格/模板，避免在宿主 chatMetadata 尚未切换完成时读到旧上下文。
    
    // updateCardUpdateStatusDisplay 由 presentation 层的 init.ts CHAT_CHANGED 回调执行

  // [核心修复] 切换聊天时，强制刷新可视化编辑器数据
    // 这确保了无论编辑器是否打开（即是否绑定了事件），数据源都被更新，并且如果有监听者则触发
    // [优化] 增加短暂延迟，确保 DOM 渲染完成（尽管是数据层面的刷新）
    setTimeout(() => {
        logDebug_ACU('Triggered visualizer refresh on chat change (with delay).');
    }, 100);

    // [修复] 加载完成后，延迟检查并强制清理角色卡绑定世界书（如果设置了注入到其他目标）
    enforceCleanupOfCharacterWorldbook_ACU();
  }

  // [新增] 获取数据注入目标世界书的函数
  export async function getInjectionTargetLorebook_ACU() {
      const worldbookConfig = getCurrentWorldbookConfig_ACU();
      const target = worldbookConfig.injectionTarget;
      let lorebookName: string | null = null;
      if (target === 'character') {
          // [TT 降级] 角色世界书 API 不可用（compat 整组 missing/冷启动未装配）时按「无注入目标」
          // 静默降级，与下方防御验证同形；gateway 的 throw 保留用于区分系统性故障（有意契约）。
          let binding;
          try {
              binding = await getCurrentCharacterWorldbookBinding_ACU();
          } catch (e) {
              logWarn_ACU('[Worldbook] 角色世界书绑定 API 不可用，注入目标按无绑定降级。', { phase: 'character_worldbook_binding' });
              return null;
          }
          lorebookName = binding.primary;
      } else {
          lorebookName = target || null;
      }

      // [防御] 验证世界书是否真实存在于 SillyTavern 的世界书列表中
      // 防止 SillyTavern API 返回残留/缓存的不存在世界书名称导致报错
      // 验证不通过时静默返回 null，不输出警告（避免用户看到无意义的重复警告）
      if (lorebookName) {
          try {
              const resolvedLorebookName = resolveLorebookNameFromList_ACU(lorebookName, await listLorebooks_ACU());
              if (!resolvedLorebookName) {
                  logDebug_ACU(`[Worldbook] 注入目标世界书 "${lorebookName}" 不存在于可用列表中，静默跳过。`);
                  return null;
              }
              lorebookName = resolvedLorebookName;
          } catch (e) {
              // 验证失败时静默降级，不打扰用户
              return null;
          }
      }

      return lorebookName;
  }


  // [新增] 辅助函数：生成带隔离标识的条目前缀/注释
  export function getIsolationPrefix_ACU() {
      if (settings_ACU.dataIsolationEnabled && settings_ACU.dataIsolationCode) {
          return `ACU-[${settings_ACU.dataIsolationCode}]-`;
      }
      return '';
  }

  // deleteAllGeneratedEntries_ACU 统一用 pipeline 的实现（此前两份逐字复制，修一处漏一处，R6-12）。

  // =========================
  // [可视化删表-硬删除] 追溯整个聊天记录，删除指定 sheetKey 的所有本地表格数据（新版+旧版）
  // 设计目标：即使后续有"按原楼层写回"的流程，也不会把旧表复活
  // =========================
  async function purgeSheetKeysFromChatHistoryHardCore_ACU(keys: string[]) {
      const chat = getChatArray_ACU();
      if (!Array.isArray(chat) || chat.length === 0) return { changed: false, changedCount: 0 };

      const parseMaybeJson = (v: any) => {
          if (!v) return null;
          if (typeof v === 'string') {
              try { return JSON.parse(v); } catch (e) { return null; }
          }
          if (typeof v === 'object') return v;
          return null;
      };

      let changedAny = false;
      let changedCount = 0;

      // [新增] 同步清理：聊天第一层的"空白指导表"
      try {
          const first = getChatFirstLayerMessage_ACU(chat);
          if (first && first[CHAT_SHEET_GUIDE_FIELD_ACU]) {
              const container = parseMaybeJson(first[CHAT_SHEET_GUIDE_FIELD_ACU]);
              if (container && typeof container === 'object' && container.tags && typeof container.tags === 'object') {
                  const nextContainer = cloneScopedConfigData_ACU(container, {}) || {};
                  Object.keys(nextContainer.tags).forEach(tagKey => {
                      const slot = nextContainer.tags[tagKey];
                      if (!slot || typeof slot !== 'object') return;
                      const slotData = parseMaybeJson(slot.data);
                      if (!slotData || typeof slotData !== 'object') return;
                      const nextData = cloneScopedConfigData_ACU(slotData, {}) || {};
                      keys.forEach(k => { if (nextData[k]) delete nextData[k]; });
                      slot.data = nextData;
                  });
                  first[CHAT_SHEET_GUIDE_FIELD_ACU] = nextContainer;
                  changedAny = true;
              }
          }
      } catch (e) {
          // ignore
      }

      for (const msg of chat) {
          if (!msg || msg.is_user) continue;

          // 委托给 data 层的 repository 处理单条消息的字段删除
          const msgChanged = purgeSheetKeysFromMessage_ACU(msg, keys);

          if (msgChanged) {
              changedAny = true;
              changedCount++;
          }
      }

      if (changedAny) {
          await saveChatToHost_ACU();
          try { await loadAllChatMessages_ACU(); } catch (e) {}
      }
      return { changed: changedAny, changedCount };
  }

  export async function purgeSheetKeysFromChatHistoryHard_ACU(sheetKeysToPurge: string[]) {
      const keys = Array.isArray(sheetKeysToPurge)
          ? [...new Set(sheetKeysToPurge.filter(k => typeof k === 'string' && k.startsWith('sheet_')))]
          : [];
      if (keys.length === 0) return { changed: false, changedCount: 0 };

      return runTableWriteTransaction_ACU({
          source: 'system_cleanup',
          reason: 'purgeSheetKeysFromChatHistoryHard',
          isolationKey: getCurrentIsolationKey_ACU(),
          writeSet: keys.map(sheetKey => ({ kind: 'sheet' as const, sheetKey })),
          maintenanceMode: 'exclusive',
      }, () => purgeSheetKeysFromChatHistoryHardCore_ACU(keys));
  }
