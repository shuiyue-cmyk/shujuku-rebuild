// @vitest-environment jsdom
/**
 * tests/presentation/components/update-status-display-history-batch.test.ts
 * P2-3：旧 UI 状态面板的表历史状态改走批量 API。
 *
 * 旧实现对每张表各调一次 resolveTableHistoryStateFromChat_ACU（每表一次全量逆扫），
 * 改成一次 resolveTableHistoryStatesFromChat_ACU 批量解析（单次扫描 chat），
 * 与 v2 仪表页同款接线。
 *
 * 判别点：
 * ① 批量 API 恰好被调用一次、逐表 API 零调用（接线钉住）；
 * ② 面板渲染出的每行「上次更新楼层 / 触发楼层 / 未记录楼层」逐字不变（语义钉住）；
 * ③ 同一 chat 上批量结果与逐表结果逐字段相等（等价性钉住）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chat: [] as any[],
  tableData: null as any,
  batchCalls: 0,
  perTableCalls: 0,
}));

vi.mock('../../../src/service/chat/chat-service', () => ({
  getChatArray_ACU: () => h.chat,
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  get currentJsonTableData_ACU() { return h.tableData; },
  getCurrentIsolationKey_ACU: () => '',
  settings_ACU: { autoUpdateFrequency: 2, skipUpdateFloors: 1, dataIsolationEnabled: false, dataIsolationCode: '' },
}));
vi.mock('../../../src/service/template/chat-scope', () => ({
  getSortedSheetKeys_ACU: (data: any) => Object.keys(data || {}).filter(key => key.startsWith('sheet_')),
}));
vi.mock('../../../src/service/template/template-preset-service', () => ({
  getActiveTemplatePresetMeta_ACU: () => ({ displayName: '测试预设', scopeLabel: '全局' }),
}));
// 真实实现 + 调用计数：语义由 table-history 自己保证，这里只观测接线形状。
vi.mock('../../../src/service/table/table-history', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/service/table/table-history')>();
  return {
    ...actual,
    resolveTableHistoryStatesFromChat_ACU: (chat: any, optionsList: any[]) => {
      h.batchCalls += 1;
      return actual.resolveTableHistoryStatesFromChat_ACU(chat, optionsList);
    },
    resolveTableHistoryStateFromChat_ACU: (chat: any, options: any) => {
      h.perTableCalls += 1;
      return actual.resolveTableHistoryStateFromChat_ACU(chat, options);
    },
  };
});

import { SCRIPT_ID_PREFIX_ACU } from '../../../src/shared/constants';
import { _set_$popupInstance_ACU, _assignUIPlaceholders_ACU } from '../../../src/presentation/state/ui-refs';
import { updateCardUpdateStatusDisplay_ACU } from '../../../src/presentation/components/update-status-display';
import {
  resolveTableHistoryStateFromChat_ACU,
  resolveTableHistoryStatesFromChat_ACU,
} from '../../../src/service/table/table-history';

/** 状态面板只用到 text/html/find/length 的最小 jQuery 替身。 */
function createMiniJQuery() {
  class MiniJQuery {
    constructor(public elements: HTMLElement[] = []) {}
    get length(): number { return this.elements.length; }
    find(selector: string) {
      return new MiniJQuery(this.elements.flatMap(element => Array.from(element.querySelectorAll(selector)) as HTMLElement[]));
    }
    text(value?: unknown) {
      if (typeof value === 'undefined') return this.elements[0]?.textContent || '';
      this.elements.forEach(element => { element.textContent = String(value ?? ''); });
      return this;
    }
    html(value?: unknown) {
      if (typeof value === 'undefined') return this.elements[0]?.innerHTML || '';
      this.elements.forEach(element => { element.innerHTML = String(value ?? ''); });
      return this;
    }
  }
  const factory = ((input: unknown) => {
    if (input instanceof MiniJQuery) return input;
    if (typeof input === 'string') return new MiniJQuery(Array.from(document.querySelectorAll(input)) as HTMLElement[]);
    if (input instanceof HTMLElement) return new MiniJQuery([input]);
    return new MiniJQuery([]);
  }) as any;
  return factory;
}

function setUpPanel(): { body: HTMLElement; card: HTMLElement; next: HTMLElement; total: HTMLElement } {
  document.body.innerHTML = `
    <div id="popup-root">
      <div id="${SCRIPT_ID_PREFIX_ACU}-total-messages-display"></div>
      <table><tbody id="${SCRIPT_ID_PREFIX_ACU}-granular-status-table-body"></tbody></table>
      <div id="${SCRIPT_ID_PREFIX_ACU}-next-update-display"></div>
      <div id="card-status"></div>
    </div>`;
  const $ = createMiniJQuery();
  const root = document.querySelector('#popup-root') as HTMLElement;
  const card = document.querySelector('#card-status') as HTMLElement;
  const next = document.querySelector(`#${SCRIPT_ID_PREFIX_ACU}-next-update-display`) as HTMLElement;
  const total = document.querySelector(`#${SCRIPT_ID_PREFIX_ACU}-total-messages-display`) as HTMLElement;
  const body = document.querySelector(`#${SCRIPT_ID_PREFIX_ACU}-granular-status-table-body`) as HTMLElement;
  _set_$popupInstance_ACU($(root) as any);
  _assignUIPlaceholders_ACU({ $cardUpdateStatusDisplay_ACU: $(card) as any } as any);
  return { body, card, next, total };
}

/**
 * 三张表的历史各不相同：普通表、总结表（走 SummaryData 通道）、无历史表。
 * AI 楼序号：第 1 楼 legacy 更新、第 3 楼 legacy 更新、第 5 楼无数据。
 */
function buildFixture() {
  h.chat = [
    {
      is_user: false,
      TavernDB_ACU_Data: { sheet_role: { name: '角色状态', content: [['row_id', '状态'], ['1', '平静']] } },
      TavernDB_ACU_ModifiedKeys: ['sheet_role'],
      TavernDB_ACU_UpdateGroupKeys: [],
    },
    { is_user: true },
    {
      is_user: false,
      TavernDB_ACU_SummaryData: { sheet_summary: { name: '总结表', content: [['row_id', '事件'], ['1', '初遇']] } },
      TavernDB_ACU_ModifiedKeys: ['sheet_summary'],
      TavernDB_ACU_UpdateGroupKeys: [],
    },
    { is_user: true },
    { is_user: false, mes: '没有表数据的 AI 楼' },
  ];
  h.tableData = {
    mate: { type: 'chatSheets', version: 1 },
    sheet_role: { name: '角色状态', content: [['row_id', '状态'], ['1', '平静']], updateConfig: { updateFrequency: 3, skipFloors: 0 } },
    sheet_summary: { name: '总结表', content: [['row_id', '事件'], ['1', '初遇']], updateConfig: { updateFrequency: 0 } },
    sheet_idle: { name: '事件记录', content: [['row_id', '事项'], ['1', '无痕']], updateConfig: {} },
  };
}

describe('updateCardUpdateStatusDisplay_ACU 表历史批量解析', () => {
  beforeEach(() => {
    h.chat = [];
    h.tableData = null;
    h.batchCalls = 0;
    h.perTableCalls = 0;
    buildFixture();
  });

  it('一次批量解析覆盖全部表，逐表解析零调用', async () => {
    setUpPanel();

    await updateCardUpdateStatusDisplay_ACU();

    expect(h.batchCalls).toBe(1);
    expect(h.perTableCalls).toBe(0);
  });

  it('批量解析与逐表解析对同一 chat 逐字段相等', () => {
    const options = [
      { sheetKey: 'sheet_role', isSummaryTable: false, isolationKey: '', settings: { autoUpdateFrequency: 2, skipUpdateFloors: 1 } },
      { sheetKey: 'sheet_summary', isSummaryTable: true, isolationKey: '', settings: { autoUpdateFrequency: 2, skipUpdateFloors: 1 } },
      { sheetKey: 'sheet_idle', isSummaryTable: false, isolationKey: '', settings: { autoUpdateFrequency: 2, skipUpdateFloors: 1 } },
    ];

    const batch = resolveTableHistoryStatesFromChat_ACU(h.chat, options);
    options.forEach((option) => {
      expect(batch.get(option.sheetKey)).toEqual(resolveTableHistoryStateFromChat_ACU(h.chat, option));
    });
  });

  it('面板渲染的每行楼层读数保持逐字一致', async () => {
    const { body, total, next } = setUpPanel();

    await updateCardUpdateStatusDisplay_ACU();

    // 宽档 AI 楼数：第 1/3/5 楼是 AI 楼（本夹具无工具楼与隐藏楼）。
    expect(total.textContent).toBe('上下文总层数: 3 (仅计算AI回复楼层)');
    // 角色状态：上次更新落在第 1 个 AI 楼，表内频率 3 / 跳层 0 → 触发楼层 4。
    // 当前 AI 楼层（3）不是它的上次更新楼层，因此不套「本层更新」高亮。
    expect(body.innerHTML).toContain(
      '<td style="text-align: left; padding: 5px;">角色状态</td>\n'
      + '                <td style="text-align: center; padding: 5px;">3</td>\n'
      + '                <td style="text-align: center; padding: 5px;" title="有效未记录: 2">2</td>\n'
      + '                <td style="text-align: center; padding: 5px;">1</td>\n'
      + '                <td style="text-align: center; padding: 5px;">4</td>',
    );
    // 总结表：表内频率 0 → 不参与触发预测（触发列「无」），但仍展示上次更新楼层与未记录楼层。
    expect(body.innerHTML).toContain(
      '<td style="text-align: left; padding: 5px;">总结表</td>\n'
      + '                <td style="text-align: center; padding: 5px;">0</td>\n'
      + '                <td style="text-align: center; padding: 5px;" title="有效未记录: —">1</td>\n'
      + '                <td style="text-align: center; padding: 5px;">2</td>\n'
      + '                <td style="text-align: center; padding: 5px;">无</td>',
    );
    // 事件记录：无历史 → 未初始 / N/A，频率沿用全局 2。
    expect(body.innerHTML).toContain(
      '<td style="text-align: left; padding: 5px;">事件记录</td>\n'
      + '                <td style="text-align: center; padding: 5px;">2</td>\n'
      + '                <td style="text-align: center; padding: 5px;" title="有效未记录: N/A">N/A</td>\n'
      + '                <td style="text-align: center; padding: 5px;"><span style="color: grey;">未初始</span></td>\n'
      + '                <td style="text-align: center; padding: 5px;">N/A</td>',
    );
    expect(next.innerHTML).toContain('下一次: <b>角色状态</b> (AI楼层 4)');
  });
});
