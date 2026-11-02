import { describe, expect, it } from 'vitest';

import { hostMessageFingerprint_ACU, resolveHostRetryMode_ACU } from '../../../src/service/continuation/host-retry-mode';

function fingerprint(message: Record<string, unknown>): string {
  return hostMessageFingerprint_ACU(message);
}

const capture = { capturedAt: 1, capturedChatLength: 2, capturedAiFloorCount: 1, generationSeq: null, instructionIndex: 1, instructionFingerprint: fingerprint({ is_user: true, mes: '主 Agent 的指令' }) };
const opening = { is_user: false, mes: '开场' };
const instruction = { is_user: true, mes: '主 Agent 的指令' };
const reply = { is_user: false, mes: '本轮正文' };

describe('resolveHostRetryMode_ACU', () => {
  it('本轮正文已在末楼时 regenerate；正文尚未产出时对指令楼 generate', () => {
    expect(resolveHostRetryMode_ACU([opening, instruction, reply], capture)).toBe('regenerate');
    expect(resolveHostRetryMode_ACU([opening, instruction], capture)).toBe('generate');
  });

  it('用户删掉指令楼或更早正文后不再给出重试模式', () => {
    // 指令楼被删：末楼是上一轮正文，regenerate 会误删它。
    expect(resolveHostRetryMode_ACU([opening], capture)).toBeNull();
    // 连上一轮正文也被删。
    expect(resolveHostRetryMode_ACU([], capture)).toBeNull();
    // 正文之后用户又手动发了消息：本轮正文已不是末楼。
    expect(resolveHostRetryMode_ACU([opening, instruction, reply, { is_user: true, mes: '用户插话' }], capture)).toBeNull();
    // 只删除指令楼但保留坏正文：AI 数仍为基数+1，不能把坏正文当成当前轮。
    expect(resolveHostRetryMode_ACU([opening, reply], capture)).toBeNull();
    // 没有正文时用户又发送了另一条消息：generate 不能改投新用户楼。
    expect(resolveHostRetryMode_ACU([opening, instruction, { is_user: true, mes: '用户插话' }], capture)).toBeNull();
  });

  it('发送时按指令文本合成的指纹，能认出宿主带上用户名（persona）建出的真实指令楼', () => {
    // send() 在宿主建楼前只能按 { is_user, mes } 合成指纹；宿主真实楼带 name（如「用户」）
    const syntheticCapture = { ...capture, instructionFingerprint: hostMessageFingerprint_ACU({ is_user: true, mes: '主 Agent 的指令' }) };
    const hostInstruction = { is_user: true, mes: '主 Agent 的指令', name: '用户' };
    expect(resolveHostRetryMode_ACU([opening, hostInstruction, reply], syntheticCapture)).toBe('regenerate');
    expect(resolveHostRetryMode_ACU([opening, hostInstruction], syntheticCapture)).toBe('generate');
    expect(resolveHostRetryMode_ACU([opening, { ...hostInstruction, mes: '别的话' }], syntheticCapture)).toBeNull();
  });

  it('regenerate 重试预减过的快照同样适用', () => {
    // 桥在 regenerate 前把将被删的正文楼预减掉：基数仍是 1 层 AI。
    const predecremented = { ...capture, capturedChatLength: 2, capturedAiFloorCount: 1 };
    expect(resolveHostRetryMode_ACU([opening, instruction, reply], predecremented)).toBe('regenerate');
    // regenerate 自身失败没有新正文：对指令楼 generate。
    expect(resolveHostRetryMode_ACU([opening, instruction], predecremented)).toBe('generate');
  });
});
