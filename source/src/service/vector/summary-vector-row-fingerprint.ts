/**
 * service/vector/summary-vector-row-fingerprint.ts — 纪要向量「源文本哈希」（vectorSourceHash）的单一来源
 *
 * 本模块只负责 vectorSourceHash 公式与源文本格式版本常量：镜像 V2 主链路的
 * 内容变化判定（mirror-writer / mirror-rebuild / runtime / archive 的 delta 诊断）
 * 全部经由 `hashSummaryVectorSourceText_ACU`，不得另起内联公式。
 * 版本号参与镜像行的 sourceTextVersion 标记：版本升级即全部旧行 mismatch → 自动全量重建。
 *
 * 源文本进入哈希的方式是原文本身；行落盘时不再保存原文，只保存哈希，
 * 调用方可以只给 vectorSourceText（现算哈希）或只给 vectorSourceHash（已落盘的行）。
 *
 * 历史注记（G10-02）：本模块曾额外导出一个「行指纹」公式（rowId/timeSpan/location/
 * summary/indexCode + 版本标签 + 源文本哈希），意图收编 legacy 归档链的行复用判定，
 * 但 legacy 链从未接入（其私有公式已把指纹值持久化进 manifest，换公式会让存量行
 * 全部误判为已变更），该导出零调用方，已删除。legacy 归档链现存两套自洽公式：
 * - archive-service 私有 `buildSummaryRowFingerprint_ACU`：原文直拼、无版本标签，
 *   行复用比较两侧同源（manifest 存量值即该公式产物）；
 * - storage-service `buildRowIndex_ACU` 的内联兜底：比 archive 版多 rowOrder 字段，
 *   仅用于落盘行缺 sourceFingerprint 时补写 legacy manifest 的 rowIndex，无等值比较消费方。
 * 两套公式只在各自链内自洽、互不可换用，改动前必读上述持久化约束。
 */

import { hashUserInput_ACU } from '../../shared/utils';

/** 源文本格式版本，参与镜像行的 sourceTextVersion 标记：版本变化即全部旧行 mismatch → 自动全量重建。 */
export const SUMMARY_VECTOR_SOURCE_TEXT_VERSION_ACU = 2;

export function hashSummaryVectorSourceText_ACU(vectorSourceText: string): string {
    return hashUserInput_ACU(String(vectorSourceText ?? ''));
}
