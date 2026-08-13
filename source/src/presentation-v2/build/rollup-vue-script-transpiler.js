/**
 * rollup-vue-script-transpiler — 单点处理 unplugin-vue 产出的 SFC 虚拟脚本模块
 *
 * 背景：unplugin-vue 把 `<script setup lang="ts">` 编译为虚拟模块，id 形如
 * `*.vue?vue&type=script&setup=true&lang.ts`。这类 id 在通过 query 字符串后会被
 * @rollup/pluginutils 的 createFilter 剥掉 query 再做 glob 匹配，于是
 * @rollup/plugin-typescript 永远拿不到这些虚拟模块（它的 include 是 `*.ts`）。
 *
 * 现象：在 Vue 编译输出里 `setup(__props: any, ...)` 这类 TS 注解逃过 typescript
 * 插件，rollup 直接以 JS 解析 → "Expected ',', got ':'"。
 *
 * 解法：本插件只匹配这一类虚拟模块，调用 typescript 的 transpileModule 把 TS
 * 注解 / 类型语法剥掉，输出干净的 JS。完全不参与正常 .ts 文件的编译，避免与
 * @rollup/plugin-typescript 冲突。
 */
import ts from 'typescript';

const VUE_TS_VIRTUAL_REGEX = /\.vue\?.*\blang\.ts(?:&|$)/;

export default function vueScriptTranspiler() {
  return {
    name: 'acu-vue-script-transpiler',
    transform(code, id) {
      if (!VUE_TS_VIRTUAL_REGEX.test(id)) return null;
      const out = ts.transpileModule(code, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
          isolatedModules: true,
          esModuleInterop: true,
          experimentalDecorators: true,
          // 避免 transpileModule 默认 emit declaration / sourceMap
          declaration: false,
          sourceMap: false,
        },
        fileName: id,
        reportDiagnostics: false,
      });
      return {
        code: out.outputText,
        map: { mappings: '' },
      };
    },
  };
}
