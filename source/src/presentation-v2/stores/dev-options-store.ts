/**
 * dev-options-store — 仪表盘"启用开发者选项"总开关 + 各开发者 gated 字段的共享 store
 *
 * 字段：
 * - developerOptionsEnabled：仪表盘"高级设置"中的总开关。**仅**控制 sidebar 是否显示
 *   "开发者"一级页（plan §D24）。不联动任何 gated 字段的真假状态。
 * - plotAdvanced：编辑剧情推进预设抽屉中的"匹配替换"字段（sulv1-4 / zhaohui）
 *   是否显示。开关 UI 在开发者一级页内；与总开关相互独立。
 * - warnLogEnabled：WARN 日志是否输出并写入运行日志，默认关闭。
 *   这是 warn 采集的「常驻来源」，与 Debug 面板的临时采集各占一格（log-buffer 取或），
 *   所以停止 Debug 不会关掉这里显式打开的常驻采集，本 store 也不会被 Debug 改写。
 * - apiReconfirm：API 预设变更后，其他使用 API 预设的位置是否标黄提醒二次确认。
 *   默认打开（保持现有行为）；关闭后全库不再标黄。缺省（老版本存量）视为打开。
 *
 * 新 UI 自有持久化，物理隔离于 settings_ACU。
 */
import { defineStore } from 'pinia';
import { setWarnLogEnabledByDevOption_ACU as applyWarnLogEnabled } from '../../shared/log-buffer';
import { readSection, writeSection } from './persistence';

const SECTION_KEY = 'devOptions';

export interface DevOptionsState {
  /** 总开关：仅控制 sidebar 是否显示"开发者"一级页（plan §D24）。 */
  developerOptionsEnabled: boolean;
  /** 编辑剧情推进预设抽屉中的"匹配替换"字段是否显示。与 developerOptionsEnabled 相互独立。 */
  plotAdvanced: boolean;
  /** WARN 日志是否输出并写入运行日志。默认关闭。 */
  warnLogEnabled: boolean;
  /** API 二次确认：预设变更后他处是否标黄。默认打开；缺省视为打开。 */
  apiReconfirm: boolean;
}

interface PersistedShape {
  developerOptionsEnabled?: unknown;
  plotAdvanced?: unknown;
  warnLogEnabled?: unknown;
  apiReconfirm?: unknown;
}

function loadFromStorage(): DevOptionsState {
  const raw = readSection<PersistedShape>(SECTION_KEY) ?? {};
  return {
    developerOptionsEnabled: raw.developerOptionsEnabled === true,
    plotAdvanced: raw.plotAdvanced === true,
    warnLogEnabled: raw.warnLogEnabled === true,
    apiReconfirm: raw.apiReconfirm !== false,
  };
}

function persist(state: DevOptionsState): void {
  writeSection(SECTION_KEY, {
    developerOptionsEnabled: state.developerOptionsEnabled,
    plotAdvanced: state.plotAdvanced,
    warnLogEnabled: state.warnLogEnabled,
    apiReconfirm: state.apiReconfirm,
  });
}

export const useDevOptionsStore = defineStore('acu-v2-dev-options', {
  state: (): DevOptionsState => {
    const state = loadFromStorage();
    applyWarnLogEnabled(state.warnLogEnabled);
    return state;
  },
  actions: {
    setDeveloperOptionsEnabled(enabled: boolean): void {
      this.developerOptionsEnabled = !!enabled;
      persist(this.$state);
    },
    setPlotAdvanced(enabled: boolean): void {
      this.plotAdvanced = !!enabled;
      persist(this.$state);
    },
    setWarnLogEnabled(enabled: boolean): void {
      this.warnLogEnabled = !!enabled;
      applyWarnLogEnabled(this.warnLogEnabled);
      persist(this.$state);
    },
    setApiReconfirm(enabled: boolean): void {
      this.apiReconfirm = !!enabled;
      persist(this.$state);
    },
    refresh(): void {
      const next = loadFromStorage();
      this.developerOptionsEnabled = next.developerOptionsEnabled;
      this.plotAdvanced = next.plotAdvanced;
      this.warnLogEnabled = next.warnLogEnabled;
      this.apiReconfirm = next.apiReconfirm;
      applyWarnLogEnabled(this.warnLogEnabled);
    },
  },
});
