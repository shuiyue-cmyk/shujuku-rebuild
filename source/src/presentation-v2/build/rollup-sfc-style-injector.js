/**
 * rollup-sfc-style-injector — 把 unplugin-vue 产出的 `*.vue?vue&type=style&*`
 * 虚拟模块改写为运行时 CSS 注入调用。
 *
 * 为什么不引第三方 CSS 插件：
 * - 我们不需要独立 .css 产物，新 UI 全部通过 SFC 表达样式
 * - 油猴 IIFE / 酒馆扩展 ESM / plus 包装入口 三种产物都要工作
 * - SFC 样式必须能注入 host document（见 D15.1），第三方 CSS 插件默认
 *   只挂当前 document，得自己再叠一层
 *
 * 见 sfc-style-runtime.ts 处理实际 DOM 注入与 host document 迁移。
 */
import path from 'path';

const STYLE_QUERY_REGEX = /\?vue&type=style/;

function toStableKey(id) {
  // 形如 "/abs/path/App.vue?vue&type=style&index=0&scoped=xxx&lang.css"
  // 1. 拆 query：保留 type/index/scoped 这些标识 SFC 内不同 style 块的字段
  // 2. 文件路径相对 cwd 化，并把 Windows 反斜杠转正斜杠
  // 目的：避免把构建机的绝对路径写进产物
  const [filePart, queryPart = ''] = id.split('?');
  const rel = path.relative(process.cwd(), filePart).split(path.sep).join('/');
  const params = new URLSearchParams(queryPart);
  const tag = [
    params.get('type') || '',
    params.get('index') || '',
    params.get('scoped') || '',
  ]
    .filter(Boolean)
    .join('-');
  return tag ? `${rel}#${tag}` : rel;
}

export default function sfcStyleInjector(options = {}) {
  const runtimeImport = options.runtimeImport
    ?? path.resolve(process.cwd(), 'src/presentation-v2/build/sfc-style-runtime.ts');
  return {
    name: 'acu-sfc-style-injector',
    transform(code, id) {
      if (!STYLE_QUERY_REGEX.test(id)) return null;
      const cssLiteral = JSON.stringify(code);
      const keyLiteral = JSON.stringify(toStableKey(id));
      const importPath = JSON.stringify(runtimeImport);
      return {
        code:
          `import { injectSfcStyle as __acuInjectSfcStyle } from ${importPath};\n` +
          `__acuInjectSfcStyle(${cssLiteral}, ${keyLiteral});\n` +
          `export default null;\n`,
        map: { mappings: '' },
      };
    },
  };
}
