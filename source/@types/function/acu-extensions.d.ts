/**
 * ACU 项目对 SillyTavern 类型定义的扩展
 *
 * 注意：由于 TS 不支持对 `declare const` 做 declaration merging，
 * 也不支持用 `interface` 扩展 `type alias`，
 * ACU 的类型扩展已移至 src/shared/host-api.ts 中：
 *   - SillyTavernACUExtensions：扩展 SillyTavern 全局常量的属性
 *   - ChatMessageACUExtensions：扩展 ChatMessage 的 ACU 自定义属性
 *   - ACUMessage：SillyTavern.ChatMessage & ChatMessageACUExtensions 的类型别名
 *
 * 本文件保留为空，避免与 iframe/exported.sillytavern.d.ts 产生无效的 declaration merging。
 */
