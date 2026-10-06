/**
 * page-catalog — 新版界面的页面目录
 *
 * 页面 id、标题、分组与可见性全部沿用经典界面的 router store（功能开关、基础/高手模式、
 * 开发者选项的显隐逻辑只有一份）；这里只补新版界面自己的组件、图标与一句话说明。
 */
import { markRaw, type Component } from 'vue';
import AdvancedToolsPage from '../pages/AdvancedToolsPage.vue';
import AgentPage from '../pages/AgentPage.vue';
import ApiPage from '../pages/ApiPage.vue';
import BasicConfigPage from '../pages/BasicConfigPage.vue';
import ContentReplacePage from '../pages/ContentReplacePage.vue';
import ContinuationPage from '../pages/ContinuationPage.vue';
import DashboardPage from '../pages/DashboardPage.vue';
import DataMgmtPage from '../pages/DataMgmtPage.vue';
import DeveloperPage from '../pages/DeveloperPage.vue';
import FormFillPage from '../pages/FormFillPage.vue';
import PlotPage from '../pages/PlotPage.vue';
import TablePage from '../pages/TablePage.vue';
import VectorIndexPage from '../pages/VectorIndexPage.vue';

export interface UbPageEntry {
  component: Component;
  icon: string;
  blurb: string;
}

export const UB_PAGE_CATALOG: Readonly<Record<string, UbPageEntry>> = Object.freeze({
  'basic-config': { component: markRaw(BasicConfigPage), icon: 'fa-solid fa-sliders', blurb: '上手只需要这一页：API、更新节奏、表格模板与剧情推进。' },
  dashboard: { component: markRaw(DashboardPage), icon: 'fa-solid fa-house', blurb: '运行状态一眼看完，常用开关就在这里。' },
  'form-fill': { component: markRaw(FormFillPage), icon: 'fa-solid fa-table-list', blurb: '表格进度、自动更新节奏、手动填表与模板。' },
  table: { component: markRaw(TablePage), icon: 'fa-solid fa-book-open', blurb: '填表时参考哪些世界书、写到哪里、提示词与标签筛选。' },
  plot: { component: markRaw(PlotPage), icon: 'fa-solid fa-route', blurb: '剧情推进预设、任务流程与参考世界书。' },
  agent: { component: markRaw(AgentPage), icon: 'fa-solid fa-robot', blurb: '让 Agent 接管世界书条目，按需召回。' },
  api: { component: markRaw(ApiPage), icon: 'fa-solid fa-plug', blurb: '数据库各功能调用的模型连接。' },
  continuation: { component: markRaw(ContinuationPage), icon: 'fa-solid fa-feather-pointed', blurb: '交给 AI 自动续写剧情。' },
  'vector-index': { component: markRaw(VectorIndexPage), icon: 'fa-solid fa-bolt', blurb: '向量召回增强记忆（交火模式）。' },
  'content-replace': { component: markRaw(ContentReplacePage), icon: 'fa-solid fa-wand-magic-sparkles', blurb: '正文生成后自动检查并润色。' },
  'data-mgmt': { component: markRaw(DataMgmtPage), icon: 'fa-solid fa-box-archive', blurb: '导入导出、备份与清理数据。' },
  'advanced-tools': { component: markRaw(AdvancedToolsPage), icon: 'fa-solid fa-screwdriver-wrench', blurb: 'SQL 控制台、运行日志与诊断。' },
  developer: { component: markRaw(DeveloperPage), icon: 'fa-solid fa-flask', blurb: '面向开发与排障的选项。' },
});

export function ubPageEntry(id: string | null | undefined): UbPageEntry | null {
  return (id && UB_PAGE_CATALOG[id]) || null;
}
