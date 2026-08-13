/**
 * iframe 类型包入口文件
 *
 * tsconfig.json 中 `types: ["function", "iframe", ...]` 要求每个类型包目录下存在 index.d.ts 作为入口。
 * 本文件通过 triple-slash reference 聚合 iframe 目录下所有声明文件，使其可作为合法类型包被加载。
 *
 * 与 @types/function/index.d.ts 的角色一致：都是将同目录下的 .d.ts 汇总暴露给 TS 类型系统。
 */

/// <reference path="./event.d.ts" />
/// <reference path="./exported.ejstemplate.d.ts" />
/// <reference path="./exported.mvu.d.ts" />
/// <reference path="./exported.sillytavern.d.ts" />
/// <reference path="./exported.tavernhelper.d.ts" />
/// <reference path="./script.d.ts" />
/// <reference path="./util.d.ts" />
/// <reference path="./variables.d.ts" />
