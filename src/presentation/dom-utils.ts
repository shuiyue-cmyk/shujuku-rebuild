/**
 * presentation/dom-utils.ts — DOM 操作工具层（jQuery 隔离层）
 *
 * 整个 presentation 层对 jQuery 的唯一引入点。
 * 其他 presentation 文件应从此文件 import jQuery_API_ACU，而非直接从 shared/host-api。
 * 未来替换 jQuery 时，只需修改此文件。
 */

// ─── jQuery 引入（唯一入口）─────────────────────────────
export { jQuery_API_ACU } from '../shared/host-api';
