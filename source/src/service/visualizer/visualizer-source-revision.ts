/**
 * service/visualizer/visualizer-source-revision.ts
 *
 * 可视化器「外部数据源 revision」：一个常数时间、却能唯一回答
 * 「下一次重载读到的东西是不是和上次一样」的令牌。
 *
 * 构成：聊天文件标识 ＋ 隔离键 ＋ 当前内存表数据的对象身份。
 * - 前两项是上下文：切聊 / 切隔离必然是新的 revision。
 * - 末项是数据版本：表数据以 `_set_currentJsonTableData_ACU` 整体替换发布为主，每次发布
 *   都是新构造的对象（SQLite 导出 / 模板提交 / 合并结果 / hydrate），于是「引用相同 ⇒ 内容相同」
 *   在主路径上成立。
 *
 * 已知例外（就地改写，引用键看不到，勿再声称"仓内不存在"）：
 * - `service/template/chat-scope/chat-scope-guide.ts` 的 seedRows 注入：对当前表**直接赋值**
 *   `table[CHAT_SHEET_GUIDE_SEED_ROWS_FIELD_ACU]`，不发布。调用方是每次生成的 prompt prepare
 *   与模板初始化。影响面：seedRows 是辅助字段，可视化器既不展示也不以它为保存来源
 *   （保存时的 seedRows 取自模板/Guide），故最坏结果是运行时 seedRows 偏旧到下一次真重载，
 *   **不会写错用户数据**。若将来可视化器开始展示/保存 seedRows，必须先给这条路径加发布。
 *
 * 刻意不做内容哈希：整库序列化与一次全量重载同量级，做了等于把优化换成另一种开销。
 * 漏检方向是保守的：引用键漏检只会少一次重载（读到与上次相同引用的数据），
 * 不会把旧数据写进草稿；反之 `loadedSourceRevision` 只增不减，切聊/换隔离一定被认作新版本。
 */
import {
  currentChatFileIdentifier_ACU,
  currentJsonTableData_ACU,
  getCurrentIsolationKey_ACU,
} from '../runtime/state-manager';

let nextDataRevisionId_ACU = 1;
const dataRevisionIdByObject_ACU = new WeakMap<object, number>();

function dataRevisionId_ACU(data: unknown): number {
  if (!data || typeof data !== 'object') return 0;
  const cached = dataRevisionIdByObject_ACU.get(data as object);
  if (cached !== undefined) return cached;
  nextDataRevisionId_ACU += 1;
  dataRevisionIdByObject_ACU.set(data as object, nextDataRevisionId_ACU);
  return nextDataRevisionId_ACU;
}

/** 当前外部数据源 revision（`data` 为空时末段恒为 0，仍是合法令牌）。 */
export function readVisualizerSourceRevision_ACU(): string {
  const context = `${String(currentChatFileIdentifier_ACU || '')}::${String(getCurrentIsolationKey_ACU() || '')}`;
  return `${context}#${dataRevisionId_ACU(currentJsonTableData_ACU)}`;
}
