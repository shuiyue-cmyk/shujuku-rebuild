/**
 * service/biotracker/panel/panel-entry.ts
 * biotracker 前端面板入口：静态 import 纯渲染面板（bootstrap 顶层自动运行，弹窗默认打开）。
 * 追踪核心由适配层单实例驱动——面板只渲染 + 桥接触发。
 */
import './biotracker-panel.js';

/** 确保面板已挂载（模块 import 即自动 bootstrap；幂等） */
export function ensureBiotrackerPanelLoaded_ACU(): void {
  // 模块顶层 scheduleBootstrapFallback 已负责初始化；此处仅为显式调用点
}
