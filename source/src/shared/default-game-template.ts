/**
 * shared/default-game-template.ts — 第三方游戏初始化内置默认模板
 *
 * 单一来源：shared/table-defaults（默认 8 张表 + mate 的 DDL / 表头 / 填表提示）。
 * 运行时全局默认模板 DEFAULT_TABLE_TEMPLATE_ACU 本身就是 buildDefaultTableTemplateString_ACU()
 * 的产物，因此这里复用同一生成函数 buildDefaultTableTemplateObject_ACU()：
 * 不另抄一份表结构常量，也不请求任何宿主静态资源。
 *
 * 输出形状 = 聊天模板快照的 templateObj（SQL 与非 SQL 模式共用同一份默认定义，SQL 模式取 sourceData.ddl）：
 *   { sheet_xxx: { uid, name, sourceData{note,initNode,deleteNode,updateNode,insertNode,ddl},
 *                  content: [[row_id 表头], ...数据行], updateConfig, exportConfig, orderNo }, ...,
 *     mate: { type: 'chatSheets', version: 1, ... } }
 * 即 resetCurrentChatTableStateFromTemplate_ACU / applyChatTemplateSnapshotWithReconciliation_ACU
 * 直接消费的 templateData 对象形态。
 */

import { buildDefaultTableTemplateObject_ACU } from './table-defaults/index.js';

/**
 * 构造游戏初始化用的内置默认模板。
 * 每次调用从默认表定义现取一份深拷贝（生成函数内部逐表 clone），调用方改动不会回写默认定义。
 *
 * @returns templateData 形状对象（sheet_* 表 + mate）
 * @throws 默认表结构无法产出模板对象或不含任何 Sheet 时抛错，由调用方按「模板注入失败」处理
 */
export function buildDefaultGameTemplate_ACU(): Record<string, any> {
    const templateObj = buildDefaultTableTemplateObject_ACU() as Record<string, any> | null;
    if (!templateObj || typeof templateObj !== 'object' || Array.isArray(templateObj)) {
        throw new Error('内置默认模板不可用：默认表结构未产出模板对象。');
    }
    const sheetKeys = Object.keys(templateObj).filter(key => key.startsWith('sheet_'));
    if (sheetKeys.length === 0) {
        throw new Error('内置默认模板不可用：默认表结构不包含任何 Sheet。');
    }
    return templateObj;
}
