/**
 * decision-recall-store — 「决策召回」页的状态：设置读写、模型列表、测试召回。
 *
 * 设置权威源是 settings_ACU.decisionRecallSettings。总开关在仪表盘进阶开关里（setDecisionRecallEnabled_ACU），
 * 这一页只选用法：「单独召回」时剧情推进暂停，「替换剧情推进的任务」时剧情推进照常运行；
 * 是否真的替换由剧情推进页的「由决策召回执行 recall 任务」开关决定（replacePlotRecallTasks，也存在这里）。
 */
import { defineStore } from 'pinia';
import { settings_ACU } from '../../service/runtime/state-manager';
import { saveSettings_ACU } from '../../service/settings/settings-service';
import { normalizePlotTasks_ACU } from '../../service/plot/plot-logic';
import { canPlotTaskUseDecisionRecall_ACU, countEnabledPlotTasks_ACU } from '../../service/decision-recall/decision-recall-plot-task';
import {
  normalizeDecisionRecallSettings_ACU,
  resolveDecisionRecallEndpoint_ACU,
  type DecisionRecallSettings_ACU,
} from '../../service/decision-recall/decision-recall-settings';
import {
  describeDecisionRecallErrors_ACU,
  describeDecisionRecallResult_ACU,
  describeDecisionRecallWarning_ACU,
  runDecisionRecall_ACU,
  type DecisionRecallRunResult_ACU,
} from '../../service/decision-recall/decision-recall-runtime';
import { DECISION_RECALL_LEVELS_ACU } from '../../service/decision-recall/decision-recall-scoring';
import {
  SILICONFLOW_DECISION_MODELS_ACU,
  fetchDecisionModels_ACU,
  type DecisionModelOption_ACU,
} from '../../service/optimization/decision-gate';
import { AIHUBMIX_DECISION_MODELS_ACU } from '../../shared/decision-recall-defaults';
import { logError_ACU } from '../../shared/utils';
import { useToastStore } from './toast-store';

/** 当前剧情推进预设里能交给决策召回的任务（给用户看替换会落在哪些任务上）。 */
export interface DecisionRecallPlotTaskStatus_ACU {
  plotEnabled: boolean;
  /** 启用的任务数（停用的不算）。 */
  taskCount: number;
  /** 自动匹配到的任务名：启用了多个任务的预设里标签恰好是 recall 的启用任务；只启用一个任务时为空。 */
  matchedTaskNames: string[];
}

function readPlotTaskStatus_ACU(): DecisionRecallPlotTaskStatus_ACU {
  const tasks = normalizePlotTasks_ACU(settings_ACU?.plotSettings || {}).filter((task: any) => task.enabled !== false);
  const taskCount = countEnabledPlotTasks_ACU(tasks);
  return {
    plotEnabled: settings_ACU?.plotSettings?.enabled === true,
    taskCount,
    matchedTaskNames: tasks
      .filter((task: any) => canPlotTaskUseDecisionRecall_ACU(task, taskCount))
      .map((task: any) => String(task.name || task.id)),
  };
}

interface DecisionRecallState {
  settings: DecisionRecallSettings_ACU;
  plotTaskStatus: DecisionRecallPlotTaskStatus_ACU;
  openrouterModels: DecisionModelOption_ACU[];
  modelsLoading: boolean;
  testInput: string;
  testOutput: string;
  testBusy: boolean;
}

function readSettings_ACU(): DecisionRecallSettings_ACU {
  return normalizeDecisionRecallSettings_ACU(settings_ACU?.decisionRecallSettings);
}

/** 保存失败时撤销到修改前的设置并提示。 */
function persistOrRollback_ACU(snapshot: unknown, rollback?: () => void): boolean {
  const result = saveSettings_ACU();
  if (!result || result.saved !== false) return true;
  settings_ACU.decisionRecallSettings = snapshot;
  rollback?.();
  useToastStore().error(`决策召回设置保存失败，已撤销本次修改：${result.error || result.warning || '未知错误'}`, { muteable: false });
  return false;
}

function levelLabel_ACU(score: number): string {
  const nearest = DECISION_RECALL_LEVELS_ACU.reduce((best, level) => (Math.abs(level.score - score) < Math.abs(best.score - score) ? level : best));
  return nearest.label;
}

/** 测试结果的可读文本：摘要一行，然后列出带上的纪要（固定 / 分数），再列分数最高的几条落选纪要。 */
export function formatDecisionRecallTestOutput_ACU(result: DecisionRecallRunResult_ACU): string {
  if (result.status !== 'ok') return describeDecisionRecallResult_ACU(result).replace(/^\[决策召回\] /, '');
  const lines: string[] = [];
  const source = result.candidateSource === 'crossfire_index' ? '交火筛过的纪要索引' : '全部纪要';
  const runs = result.judgeRuns > 1 ? `，每组判定 ${result.judgeRuns} 次取平均（失败 ${result.failedRunCount} 次）` : '';
  lines.push(`候选 ${result.candidateCount} 条（来自${source}），分 ${result.batchCount} 组打分${runs}，失败 ${result.failedBatchCount} 组。`);
  const warning = describeDecisionRecallWarning_ACU(result);
  if (warning) lines.push(warning);
  const reasons = describeDecisionRecallErrors_ACU(result);
  if (reasons) lines.push(`失败原因：${reasons}`);
  const scoreByKey = new Map(result.scored.map(entry => [entry.row.rowKey, entry]));
  const fixedKeys = new Set(result.fixed.map(row => row.rowKey));
  lines.push('', `带上 ${result.selected.length} 条（按表号顺序）：`);
  for (const row of result.selected) {
    const entry = scoreByKey.get(row.rowKey);
    const tag = fixedKeys.has(row.rowKey) ? '固定' : entry ? `${entry.score.toFixed(2)} 分 · ${levelLabel_ACU(entry.score)}` : '未打分';
    lines.push(`· ${row.indexCode}［${tag}］${row.summary}`);
  }
  const selectedKeys = new Set(result.selected.map(row => row.rowKey));
  const runnersUp = result.scored.filter(entry => !selectedKeys.has(entry.row.rowKey)).slice(0, 10);
  if (runnersUp.length > 0) {
    lines.push('', '落选里分数最高的几条：');
    for (const entry of runnersUp) lines.push(`· ${entry.row.indexCode}［${entry.score.toFixed(2)} 分 · ${levelLabel_ACU(entry.score)}］${entry.row.summary}`);
  }
  return lines.join('\n');
}

export const useDecisionRecallStore = defineStore('acu-v2-decision-recall', {
  state: (): DecisionRecallState => ({
    settings: readSettings_ACU(),
    plotTaskStatus: readPlotTaskStatus_ACU(),
    openrouterModels: [],
    modelsLoading: false,
    testInput: '',
    testOutput: '',
    testBusy: false,
  }),
  getters: {
    endpoint: state => resolveDecisionRecallEndpoint_ACU(state.settings),
    /** 「单独召回」生效中：剧情推进暂停。 */
    standaloneActive: state => state.settings.enabled && state.settings.mode === 'standalone',
    /** 「替换剧情推进的任务」用法生效中：剧情推进照常运行，剧情推进页显示替换开关。 */
    taskModeActive: state => state.settings.enabled && state.settings.mode === 'plot_task',
    /** 剧情推进页的替换开关也开着：标签只有 recall 的任务改由决策召回执行。 */
    replacingPlotTasks: state => state.settings.enabled && state.settings.mode === 'plot_task' && state.settings.replacePlotRecallTasks,
    /** 替换会不会生效、落在哪些任务上（决策召回页与剧情推进页共用）。 */
    replaceStatus(state): { kind: 'success' | 'info' | 'warning'; text: string } {
      const status = state.plotTaskStatus;
      if (!status.plotEnabled) return { kind: 'warning', text: '剧情推进当前关着：在仪表盘打开剧情推进后才会替换。' };
      if (!state.settings.replacePlotRecallTasks) {
        return { kind: 'info', text: '剧情推进页的「由决策召回执行 recall 任务」没开：照常由剧情推进调模型召回。' };
      }
      if (status.taskCount < 2) return { kind: 'warning', text: '当前剧情推进预设只启用了一个任务，不替换：照常由剧情推进调模型召回。' };
      if (status.matchedTaskNames.length) return { kind: 'success', text: `当前预设里由决策召回执行的任务：${status.matchedTaskNames.join('、')}。` };
      return { kind: 'info', text: '当前预设里没有「标签摘取」只有 recall 的任务，不替换：照常由剧情推进调模型召回。' };
    },
    activeModels(state): readonly DecisionModelOption_ACU[] {
      if (state.settings.provider === 'siliconflow') return SILICONFLOW_DECISION_MODELS_ACU;
      if (state.settings.provider === 'aihubmix') return AIHUBMIX_DECISION_MODELS_ACU;
      if (state.settings.provider === 'custom') return [];
      return state.openrouterModels;
    },
  },
  actions: {
    refreshFromSettings(): void {
      this.settings = readSettings_ACU();
      this.plotTaskStatus = readPlotTaskStatus_ACU();
    },
    /** 规整后写回并保存；返回是否保存成功。 */
    patch(patch: Partial<Record<keyof DecisionRecallSettings_ACU, unknown>>): boolean {
      const snapshot = settings_ACU.decisionRecallSettings;
      const next = normalizeDecisionRecallSettings_ACU({ ...this.settings, ...patch });
      settings_ACU.decisionRecallSettings = { ...next };
      const saved = persistOrRollback_ACU(snapshot);
      this.refreshFromSettings();
      return saved;
    },
    /** OpenRouter 的决策模型列表（公开接口）；硅基流动与 AIHubMix 用内置列表。 */
    async loadModels(): Promise<void> {
      if (this.settings.provider !== 'openrouter' || this.modelsLoading) return;
      this.modelsLoading = true;
      try {
        this.openrouterModels = await fetchDecisionModels_ACU();
      } catch (error: any) {
        logError_ACU('[ACU-V2] load decision recall models failed', error);
        useToastStore().warning(`读取决策模型列表失败（${error?.message || '未知错误'}），可稍后重试；当前所选模型不受影响。`);
      } finally {
        this.modelsLoading = false;
      }
    },
    setTestInput(value: string): void {
      this.testInput = String(value ?? '');
    },
    /** 用测试输入和当前聊天的前文跑一次完整选取，只显示结果，不写进聊天。 */
    async runTest(): Promise<void> {
      if (this.testBusy) return;
      const userInput = this.testInput.trim();
      if (!userInput) {
        this.testOutput = '请先填一句模拟的用户输入。';
        return;
      }
      this.testBusy = true;
      this.testOutput = '正在打分…';
      try {
        const result = await runDecisionRecall_ACU({ userInput, settings: this.settings });
        this.testOutput = formatDecisionRecallTestOutput_ACU(result);
      } catch (error: any) {
        logError_ACU('[ACU-V2] decision recall test failed', error);
        this.testOutput = `测试失败：${error?.message || error}`;
      } finally {
        this.testBusy = false;
      }
    },
  },
});
