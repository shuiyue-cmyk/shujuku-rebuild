/**
 * tests/service/table/auto-fill-echo-guard-single-scan.test.ts
 * P2-2：GENERATION_ENDED 的多趟全量扫描收敛成开头一次。
 *
 * 旧实现对同一条 chat 数组重复扫描：宽档签名（正序计数 + 一次逆扫找末楼 + 再一次逆扫取 mes）
 * ＋窄档 AI 楼数（两次 filter 拷贝）＋同步 sha256，合计 4~5 趟。
 * 这里用「朴素参考实现」（与旧实现同口径的独立写法）做差分：
 * 一次扫描的产物必须与旧的多趟调用逐字相等。
 */
import { describe, expect, it } from 'vitest';
import {
  resolveAiFloorSignature_ACU,
  resolveAiFloorSignatureEx_ACU,
  scanAiFloorSignature_ACU,
  toAiFloorSignatureEx_ACU,
} from '../../../src/service/table/auto-fill-echo-guard';
import { isAiFloor_ACU, isAiModelOutputFloor_ACU } from '../../../src/shared/ai-floor';

/**
 * 朴素参考：把旧 GENERATION_ENDED 里那几次调用原样摆出来。
 * 三个量分别来自宽档签名、扩展签名（自带同步 sha256）与窄档计数。
 */
function naiveOldSequence(chat: any) {
  const signature = resolveAiFloorSignature_ACU(chat);
  const signatureEx = resolveAiFloorSignatureEx_ACU(chat);
  const list = Array.isArray(chat) ? chat : [];
  const aiModelOutputCount = list.filter(isAiModelOutputFloor_ACU).length;
  return { signature, signatureEx, aiModelOutputCount };
}

const FIXTURES: Array<[string, any]> = [
  ['空数组', []],
  ['非数组', null],
  ['非数组对象', { length: 2 }],
  ['只有用户楼', [{ is_user: true, message_id: 1 }]],
  ['null 元素', [null, { is_user: false, message_id: 2 }]],
  ['单 AI 楼无 message_id', [{ is_user: false, mes: '正文' }]],
  ['末楼 mes 缺失', [
    { is_user: false, message_id: 1, mes: '开场' },
    { is_user: true, message_id: 2 },
    { is_user: false, message_id: 3 },
  ]],
  ['末楼 mes 非字符串', [
    { is_user: false, message_id: 1, mes: '开场' },
    { is_user: false, message_id: 4, mes: 12345 },
  ]],
  ['narrator 旁白计入宽档不计入窄档', [
    { is_user: false, message_id: 1, mes: '开场' },
    { is_user: false, message_id: 2, extra: { type: 'narrator' }, mes: '旁白' },
    { is_user: false, message_id: 3, mes: '正文' },
  ]],
  ['工具楼与隐藏楼都排除', [
    { is_user: false, message_id: 1, mes: '开场' },
    { role: 'tool', is_system: true, is_user: false, message_id: 2, mes: '工具结果' },
    { is_user: false, is_system: true, message_id: 3, mes: '隐藏楼' },
    { role: 'tool', is_system: false, is_user: false, message_id: 4, mes: '被 unhide 的工具楼' },
    { is_user: false, message_id: 5, mes: '正文' },
  ]],
  ['末楼是用户楼', [
    { is_user: false, message_id: 1, mes: '开场' },
    { is_user: true, message_id: 2, mes: '用户' },
  ]],
  ['稀疏数组', (() => {
    const sparse = new Array(5);
    sparse[0] = { is_user: false, message_id: 1, mes: '开场' };
    sparse[4] = { is_user: false, message_id: 9, mes: '末楼' };
    return sparse;
  })()],
  ['长链混合', Array.from({ length: 60 }, (_, index) => {
    if (index % 5 === 0) return { is_user: true, message_id: index, mes: `用户 ${index}` };
    if (index % 11 === 0) return { role: 'tool', is_system: true, is_user: false, message_id: index, mes: '工具' };
    if (index % 13 === 0) return { is_user: false, extra: { type: 'narrator' }, message_id: index, mes: '旁白' };
    return { is_user: false, message_id: index, mes: `正文 ${index}` };
  })],
];

describe('scanAiFloorSignature_ACU 单次扫描与旧多趟扫描差分', () => {
  it.each(FIXTURES)('%s：宽档签名 / 扩展签名 / 窄档计数三者逐字相等', (_name, chat) => {
    const expected = naiveOldSequence(chat);
    const scan = scanAiFloorSignature_ACU(chat);

    expect(scan.signature).toEqual(expected.signature);
    expect(scan.aiModelOutputCount).toBe(expected.aiModelOutputCount);
    expect(toAiFloorSignatureEx_ACU(scan)).toEqual(expected.signatureEx);
  });

  it('末楼 mes 原样透出（非字符串时扩展签名的 hash 为 null）', () => {
    expect(scanAiFloorSignature_ACU([
      { is_user: false, message_id: 1, mes: '开场' },
      { is_user: true, message_id: 2 },
    ]).latestMes).toBe('开场');
    expect(scanAiFloorSignature_ACU([{ is_user: true }]).latestMes).toBeUndefined();
    expect(toAiFloorSignatureEx_ACU(scanAiFloorSignature_ACU([{ is_user: false, mes: 42 }])).latestContentHash).toBeNull();
  });

  it('AI 楼判定口径仍只有一处：宽档签名与 resolveLatestAiFloor_ACU 同源', () => {
    const chat = [
      { is_user: false, message_id: 1, mes: '开场' },
      { is_user: true, message_id: 2 },
      { is_user: false, message_id: 3, mes: '正文' },
    ];
    const scan = scanAiFloorSignature_ACU(chat);
    expect(scan.signature.aiFloorCount).toBe(chat.filter(isAiFloor_ACU).length);
    expect(scan.signature.latestAiMessageId).toBe(3);
  });
});
