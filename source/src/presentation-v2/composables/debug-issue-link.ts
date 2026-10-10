/**
 * presentation-v2/composables/debug-issue-link.ts — Debug 面板「前往 GitHub 提交 issue」链接
 *
 * 为什么是普通链接（target=_blank）而不是自己 window.open：
 * - 桌面 TauriTavern 的 `on_new_window` 对 http/https/mailto/tel 外链调 `opener().open_url` 交系统
 *   浏览器并 Deny 新窗（src-tauri/crates/tauritavern/src/app/host/window.rs:110-113）；
 * - 移动端 TT 另有 window.open 兼容层，把外链转成 `plugin:opener|open_url`
 *   （src/tauri/main/compat/mobile/mobile-window-open-compat.js:40-47）；
 * - 原版 SillyTavern / 普通浏览器里 target=_blank 就是常规行为。
 * 三条路径都不需要我们写点击处理；真链接还能中键新开、长按复制。
 *
 * 预填正文的原则：只引导用户把「导出的 Debug JSON」带上来，环境项留空位。
 * 日志有两条送达路径：拖进 issue 当附件，或传到网盘后把分享链接贴进 issue——部分环境
 * （手机端 GitHub 等）选不了 .json 附件，网盘是兜底。插件不代传：上传与分享由用户在网盘里自己完成，
 * 用哪个网盘由用户自己定，我们只在文案里提示，不给入口、不碰网盘账号，也不把日志发到第三方。
 * 宿主版本、平台、复现步骤都由用户填——我们在页面里无法证实用户跑的是哪个 TT 版本，
 * 代填等于替用户下结论，也会把 issue 引向错误方向。
 */

import { readAcuBuildVersion_ACU } from '../../shared/build-info';

/** 本插件仓库的 issue 新建入口（与 manifest.json 的 homePage 同源，页面里不得再硬编码第二份）。 */
export const ACU_GITHUB_ISSUE_URL_ACU = 'https://github.com/shuiyue-cmyk/shujuku-rebuild/issues/new';

/**
 * issue 正文模板（Markdown）。
 * @param version 插件版本；默认取构建期注入值，读不到为 'unknown'
 */
export function buildDebugIssueBody_ACU(version: string = readAcuBuildVersion_ACU()): string {
  return [
    '> **先带上日志**：在插件「高级工具 → Debug 问题上报」点「开始 Debug」→ 复现问题 → 点「导出 Debug 数据」，',
    '> 把得到的 `acu-debug-*.json` 拖进本 issue 当附件（导出已对密钥全掩码）。没有这个文件基本无法定位。',
    '> 传不上附件时：把文件上传到你常用的网盘，把分享链接（有提取码一并写上）贴到下面。',
    '',
    '### Debug 日志',
    '- 附件或网盘分享链接：',
    '',
    '### 环境',
    `- 插件版本：${version}`,
    '- 宿主与版本：（请填写，例如 TauriTavern 2.3.0 / SillyTavern 1.18.x）',
    '- 平台：（请填写，Windows / macOS / Linux / Android / iOS）',
    '- 运行形态：（扩展 / 油猴脚本）',
    '',
    '### 复现步骤',
    '1. ',
    '2. ',
    '',
    '### 期望行为',
    '',
    '',
    '### 实际行为',
    '',
    '',
    '### 补充（可选）',
    '（截图、相关聊天/表格规模、是否只在某个预设下出现等）',
    '',
  ].join('\n');
}

/**
 * 组装带预填标题与正文的 issue 链接。
 * @param version 插件版本；默认取构建期注入值
 */
export function buildDebugIssueUrl_ACU(version: string = readAcuBuildVersion_ACU()): string {
  const params = new URLSearchParams({
    title: `[Debug 上报] v${version}`,
    body: buildDebugIssueBody_ACU(version),
  });
  return `${ACU_GITHUB_ISSUE_URL_ACU}?${params.toString()}`;
}
