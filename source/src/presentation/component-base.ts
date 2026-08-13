/**
 * presentation/component-base.ts — UI 组件基础接口
 *
 * 定义 presentation 层组件的统一生命周期契约。
 * 所有可复用的 UI 组件应实现此接口。
 */

/**
 * UI 组件接口
 *
 * 生命周期：
 *   1. 构造 → 传入配置和依赖
 *   2. render() → 生成 HTML 字符串（纯函数，无副作用）
 *   3. mount($container) → 将 HTML 插入 DOM 并绑定事件
 *   4. update(data?) → 用新数据重新渲染（保持挂载状态）
 *   5. unmount() → 清理事件绑定，移除 DOM 内容
 */
export interface UIComponent_ACU {
  /** 生成组件的 HTML 字符串（纯函数，不操作 DOM） */
  render(): string;

  /** 将组件挂载到指定容器（插入 HTML + 绑定事件） */
  mount($container: JQuery<HTMLElement>): void;

  /** 卸载组件（清理事件 + 移除内容） */
  unmount(): void;

  /** 用新数据更新组件（重新渲染并保持挂载状态） */
  update(data?: any): void;
}
