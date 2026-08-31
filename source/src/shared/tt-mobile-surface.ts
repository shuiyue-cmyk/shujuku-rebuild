/**
 * shared/tt-mobile-surface.ts — TauriTavern Layout ABI（data-tt-mobile-surface）打标工具
 *
 * 契约来源（TauriTavern dev 分支）：
 * - ExtensionDEV.md §5「移动端布局适配」：推荐接入 = 硬 ABI `data-tt-mobile-surface` + `--tt-inset-*`
 * - docs/API/Layout.md §1.2：surface taxonomy 稳定枚举（backdrop / fullscreen-window /
 *   free-window / viewport-host / edge-window / none）
 * - src/tauri/main/bootstrap.js：installTauriMobileCompat 仅在 android/iphone/ipad/ipod UA 下安装
 *   （overlay classifier / geometry firewall / IME surface controller 都只在移动端 TT 生效），
 *   因此本模块写入的属性在桌面 TT / 原版 SillyTavern 中是纯惰性数据，零影响。
 *
 * 宿主语义速记：
 * - fullscreen-window：全屏交互面板根。宿主 geometry firewall 会把该元素钳制到 safe-area，
 *   Android IME 焦点进入该子树时把 --tt-ime-bottom 注入到该元素（surface-local）。
 * - backdrop：full-bleed 遮罩，不收 safe-area（宿主对其无几何规则）。
 * - free-window：可拖拽小窗/悬浮窗，宿主不长期钳制 top/left。
 *
 * 文档明确要求框架型扩展「显式写入 data-tt-mobile-surface，不要赌宿主 classifier 扫到结构」，
 * 本库所有 fixed 浮层因此显式打标。
 */

/** 宿主识别的属性名（layout-kit.js SURFACE_ATTR 同值）。 */
export const TT_MOBILE_SURFACE_ATTR_ACU = 'data-tt-mobile-surface';

/** 宿主 taxonomy 稳定枚举（docs/API/Layout.md §1.2，与 layout-kit.js SURFACE 一一对应）。 */
export const TT_MOBILE_SURFACE_ACU = {
  Backdrop: 'backdrop',
  FullscreenWindow: 'fullscreen-window',
  FreeWindow: 'free-window',
  ViewportHost: 'viewport-host',
  EdgeWindow: 'edge-window',
  None: 'none',
} as const;

export type TtMobileSurfaceKind_ACU =
  (typeof TT_MOBILE_SURFACE_ACU)[keyof typeof TT_MOBILE_SURFACE_ACU];

const VALID_SURFACES_ACU: ReadonlySet<string> = new Set(
  Object.values(TT_MOBILE_SURFACE_ACU),
);

/**
 * 给元素打 surface 标；element 为空或 surface 不在宿主枚举内时静默跳过（不打脏属性）。
 * @returns 是否实际写入了属性
 */
export function applyTtMobileSurface_ACU(
  element: Element | null | undefined,
  surface: TtMobileSurfaceKind_ACU,
): boolean {
  if (!element) return false;
  if (!VALID_SURFACES_ACU.has(surface)) return false;
  element.setAttribute(TT_MOBILE_SURFACE_ATTR_ACU, surface);
  return true;
}
