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

