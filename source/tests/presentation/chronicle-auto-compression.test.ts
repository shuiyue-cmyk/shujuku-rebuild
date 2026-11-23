import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  settings: { tokenSavings: { enabled: true, autoChronicle: false, concurrency: 3 } },
  filling: false,
  signal: undefined as AbortSignal | undefined,
  end: undefined as (() => void) | undefined,
  read: vi.fn(),
  replace: vi.fn(),
  preview: vi.fn(),
}));

vi.mock('../../src/service/runtime/state-manager', () => ({
  settings_ACU: harness.settings,
  get isAutoUpdatingCard_ACU() { return harness.filling; },
  getChatMutationAbortSignal_ACU: () => harness.signal,
  onTableFillRunEnded_ACU: (listener: () => void) => { harness.end = listener; },
}));
vi.mock('../../src/presentation/bootstrap/api-groups/table-crud-api', () => ({
  listChronicleCompressionItems_ACU: harness.read,
  replaceChronicleContentsIfUnchanged_ACU: harness.replace,
}));
vi.mock('../../src/service/optimization/token-savings', () => ({
  previewTokenSavingsBatch_ACU: harness.preview,
  resolveTokenSavingsPresets_ACU: () => ({ compression: { presetName: 'test' }, audit: { presetName: 'review' } }),
}));

import { installChronicleAutoCompression_ACU, stopChronicleAutoCompression_ACU } from '../../src/presentation/bootstrap/chronicle-auto-compression';
import { notifyTableFillCommitted_ACU } from '../../src/service/table/table-fill-committed';

const scope = { chatKey: 'chat-a', isolationKey: '', sheetKey: 'sheet_chronicle', column: '纪要' };
const old = { id: '1', label: '1', original: '原有纪要，保持原样。' };
const added = { id: '2', label: '2', original: '新写入的这段纪要已经保存。' };
const locked = { id: '3', label: '3', original: '受保护的纪要。', blocked: '纪要已锁定' };
const prior = { sheet_chronicle: {} } as any;
const written = { sheet_chronicle: {} } as any;
const live = { scope, items: [old, added, locked] };
let chatController: AbortController;

beforeEach(() => {
  stopChronicleAutoCompression_ACU();
  installChronicleAutoCompression_ACU();
  vi.resetAllMocks();
  harness.settings.tokenSavings.autoChronicle = true;
  harness.filling = false;
  chatController = new AbortController();
  harness.signal = chatController.signal;
  harness.read.mockImplementation(data => data === prior ? { scope, items: [old] } : live);
  harness.preview.mockResolvedValue([{ item: added, candidate: { text: '新纪要已保存。', before: 12, after: 7 } }]);
});

function publish(): void {
  notifyTableFillCommitted_ACU({ before: prior, after: written, sheetKeys: [scope.sheetKey] });
}

describe('纪要自动压缩', () => {
  it('关闭时不发送请求', async () => {
    harness.settings.tokenSavings.autoChronicle = false;
    publish();
    await Promise.resolve();
    expect(harness.preview).not.toHaveBeenCalled();
  });

  it('等填表结束后只压缩刚写入的未锁定纪要，并使用设置的并发数', async () => {
    harness.filling = true;
    publish();
    expect(harness.preview).not.toHaveBeenCalled();
    harness.filling = false;
    harness.end?.();
    await vi.waitFor(() => expect(harness.replace).toHaveBeenCalledExactlyOnceWith(scope, [
      { id: added.id, original: added.original, replacement: '新纪要已保存。' },
    ], expect.any(Function)));
    expect(harness.preview).toHaveBeenCalledExactlyOnceWith(
      [added], 'chronicle', { compression: { presetName: 'test' }, audit: { presetName: 'review' } }, expect.any(AbortSignal), 3,
    );
  });

  it('切聊天后丢弃在途压缩结果', async () => {
    let finish: (result: unknown) => void;
    harness.preview.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    publish();
    await vi.waitFor(() => expect(harness.preview).toHaveBeenCalled());
    const signal = harness.preview.mock.calls[0][3] as AbortSignal;
    chatController.abort();
    expect(signal.aborted).toBe(true);
    finish!([{ item: added, candidate: { text: '新纪要已保存。' } }]);
    await Promise.resolve();
    expect(harness.replace).not.toHaveBeenCalled();
  });
});
