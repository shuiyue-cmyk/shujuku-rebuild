/**
 * service/host/host-state-service.ts — 宿主运行时状态服务
 *
 * 中转 data/gateways/host-state-gateway 的所有方法。
 * presentation 层通过本模块访问宿主运行时状态，不再直接调用 gateway。
 * 后续可在此层统一添加日志、埋点、状态缓存等增值逻辑。
 */

export {
    getUserName_ACU,
    getPersonaDescription_ACU,
    getCurrentCharacterFallback_ACU,
    getCharDescription_ACU,
} from '../../data/gateways/host-state-gateway';
