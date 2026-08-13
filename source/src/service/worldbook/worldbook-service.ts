/**
 * service/worldbook/worldbook-service.ts — 世界书操作服务
 *
 * 中转 data/gateways/worldbook-gateway 的所有方法。
 * presentation 层通过本模块访问世界书，不再直接调用 gateway。
 * 后续可在此层统一添加日志、埋点、操作审计等增值逻辑。
 */

export {
    isWorldbookApiAvailable_ACU,
    getLorebookEntries_ACU,
    setLorebookEntries_ACU,
    createLorebookEntries_ACU,
    deleteLorebookEntries_ACU,
    listLorebooks_ACU,
    getWorldBooks_ACU,
    getCurrentCharPrimaryLorebook_ACU,
    getCurrentCharacterWorldbookBinding_ACU,
    getCharLorebooks_ACU,
} from '../../data/gateways/worldbook-gateway';

import { isWorldbookApiAvailable_ACU, getLorebookEntries_ACU, setLorebookEntries_ACU, createLorebookEntries_ACU, deleteLorebookEntries_ACU } from '../../data/gateways/worldbook-gateway';
import { getImportJsonStorageComment_ACU } from '../../shared/constants';
import { allocOrder_ACU, buildUsedOrderSet_ACU } from './injection-engine-order';
import { logDebug_ACU, logError_ACU } from '../../shared/utils';

// ─── 业务逻辑函数（从 presentation 层搬迁） ───

/**
 * 从世界书条目中加载导入的 JSON 数据
 * 从 presentation/triggers/import-process.ts 搬迁
 */
export async function loadImportedJsonDataFromLorebook_ACU(targetLorebook: string, modeSuffix = '-Selected') {
    if (!isWorldbookApiAvailable_ACU() || !targetLorebook) return null;
    const jsonStorageComment = getImportJsonStorageComment_ACU(modeSuffix);
    const allEntries = await getLorebookEntries_ACU(targetLorebook);
    const existingEntry = allEntries.find(entry => entry.comment === jsonStorageComment);
    if (!existingEntry || !existingEntry.content) return null;
    try {
        return JSON.parse(existingEntry.content);
    } catch (error) {
        logError_ACU('[外部导入] Failed to parse ImportedJsonData source entry:', error);
        return null;
    }
}

/**
 * 将导入的 JSON 数据保存到世界书条目
 * 从 presentation/triggers/import-process.ts 搬迁
 */
export async function saveImportedJsonDataToLorebook_ACU(targetLorebook: string, jsonData: any, modeSuffix = '-Selected') {
    if (!isWorldbookApiAvailable_ACU() || !targetLorebook || !jsonData) return false;
    const jsonStorageComment = getImportJsonStorageComment_ACU(modeSuffix);
    const allEntries = await getLorebookEntries_ACU(targetLorebook);
    const usedOrders = buildUsedOrderSet_ACU(allEntries) as Set<number>;
    const existingEntry = allEntries.find(entry => entry.comment === jsonStorageComment);
    const finalJsonString = JSON.stringify(jsonData, null, 2);
    const newEntryData = {
        comment: jsonStorageComment,
        content: finalJsonString,
        keys: [`TavernDB-ACU-ImportedJson-Key${modeSuffix}`],
        enabled: false,
        type: 'keyword',
        order: existingEntry?.order ?? allocOrder_ACU(usedOrders, 10000, 1, 99999),
        prevent_recursion: true,
    };

    if (existingEntry) {
        await setLorebookEntries_ACU(targetLorebook, [{ ...newEntryData, uid: existingEntry.uid }]);
        logDebug_ACU('[外部导入] Updated ImportedJsonData source entry in target lorebook.');
    } else {
        await createLorebookEntries_ACU(targetLorebook, [newEntryData]);
        logDebug_ACU('[外部导入] Created ImportedJsonData source entry in target lorebook.');
    }
    return true;
}

/**
 * 从世界书中删除导入的 JSON 数据条目
 * 从 presentation/triggers/import-process.ts 搬迁
 */
export async function deleteImportedJsonDataFromLorebook_ACU(targetLorebook: string, modeSuffix = '-Selected') {
    if (!isWorldbookApiAvailable_ACU() || !targetLorebook) return false;
    const jsonStorageComment = getImportJsonStorageComment_ACU(modeSuffix);
    const entriesNow = await getLorebookEntries_ACU(targetLorebook);
    const jsonEntry = entriesNow.find(e => e.comment === jsonStorageComment);
    if (!jsonEntry) return false;
    await deleteLorebookEntries_ACU(targetLorebook, [jsonEntry.uid]);
    return true;
}
