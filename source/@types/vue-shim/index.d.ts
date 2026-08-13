// 让 TypeScript 把 .vue SFC 当成 Vue 组件模块来识别。
// 实际编译由 unplugin-vue 在 Rollup 阶段完成；这里只解决 IDE / tsc 的类型检查。
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
