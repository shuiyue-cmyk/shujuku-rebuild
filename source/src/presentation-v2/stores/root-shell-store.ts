/**
 * root-shell-store — 顶层外壳状态
 *
 * - isOpen：新 UI 当前是否可见（mount 模块统一通过 setOpen() 写入）
 * - openRefreshTick：复用根 Vue app 重开 UI 时，驱动 MainArea remount 当前页面
 *
 * 路由 store / 主题 store 各自独立（批次 C/D 落地）。
 */
import { defineStore } from 'pinia';

export const useRootShellStore = defineStore('acu-v2-root-shell', {
  state: () => ({
    isOpen: false,
    /** 后续打开 UI 时递增；MainArea 用它 remount 当前页，首次打开由页面 onMounted 自己刷新。 */
    openRefreshTick: 0,
    /** 计数器形式的滚动重置信号；MainArea / 各页 scroll 容器订阅它在关闭后重置滚动位置（P0-6）。 */
    scrollResetTick: 0,
  }),
  actions: {
    setOpen(open: boolean) {
      this.isOpen = open;
    },
    requestOpenRefresh() {
      this.openRefreshTick += 1;
    },
    requestScrollReset() {
      this.scrollResetTick += 1;
    },
  },
});
