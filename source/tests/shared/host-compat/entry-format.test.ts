/**
 * tests/shared/host-compat/entry-format.test.ts
 * 世界书条目三种格式转换 单元测试
 */
import { describe, it, expect } from 'vitest';

import {
  newToOldEntry_ACU,
  oldPatchToNewPatch_ACU,
  nativeToOldEntry_ACU,
  oldPatchToNativePatch_ACU,
  buildNativeEntryDefaults_ACU,
} from '../../../src/shared/host-compat/entry-format';

describe('newToOldEntry_ACU（新版嵌套 → 旧版扁平）', () => {
  it('at_depth 位置结合 role 映射为 at_depth_as_*，并保留 depth', () => {
    const old = newToOldEntry_ACU({
      uid: 7,
      name: '条目A',
      enabled: true,
      strategy: { type: 'selective', keys: ['k1'], keys_secondary: { logic: 'not_any', keys: ['f1'] }, scan_depth: 3 },
      position: { type: 'at_depth', role: 'user', depth: 5, order: 42 },
      content: '正文',
      probability: 80,
      recursion: { prevent_incoming: true, prevent_outgoing: false, delay_until: 2 },
      effect: { sticky: 1, cooldown: null, delay: null },
    }, 0);
    expect(old.position).toBe('at_depth_as_user');
    expect(old.depth).toBe(5);
    expect(old.order).toBe(42);
    expect(old.comment).toBe('条目A');
    expect(old.keys).toEqual(['k1']);
    expect(old.logic).toBe('not_any');
    expect(old.filters).toEqual(['f1']);
    expect(old.scan_depth).toBe(3);
    expect(old.exclude_recursion).toBe(true);
    expect(old.prevent_recursion).toBe(false);
    expect(old.delay_until_recursion).toBe(2);
    expect(old.sticky).toBe(1);
    expect(old.probability).toBe(80);
  });

  it('非 at_depth 位置直映，depth 为 null', () => {
    const old = newToOldEntry_ACU({
      uid: 1,
      name: 'x',
      enabled: false,
      strategy: { type: 'constant', keys: [], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
      position: { type: 'after_author_note', role: 'system', depth: 4, order: 100 },
      content: '',
      probability: 100,
      recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
      effect: { sticky: null, cooldown: null, delay: null },
    }, 3);
    expect(old.position).toBe('after_author_note');
    expect(old.depth).toBeNull();
    expect(old.enabled).toBe(false);
    expect(old.type).toBe('constant');
    expect(old.display_index).toBe(3);
    expect(old.scan_depth).toBe('same_as_global');
    expect(old.delay_until_recursion).toBe(false);
  });

  it('RegExp 关键字序列化为字符串', () => {
    const old = newToOldEntry_ACU({
      uid: 2,
      strategy: { keys: [/夜晚/gi, 'plain'], keys_secondary: { logic: 'and_all', keys: [/x/] } },
      position: { type: 'before_character_definition' },
    }, 0);
    expect(old.keys).toEqual(['/夜晚/gi', 'plain']);
    expect(old.filters).toEqual(['/x/']);
    expect(old.logic).toBe('and_all');
  });

  it('残缺条目使用安全默认值', () => {
    const old = newToOldEntry_ACU({ uid: 9 }, 1);
    expect(old.uid).toBe(9);
    expect(old.enabled).toBe(true);
    expect(old.type).toBe('selective');
    expect(old.position).toBe('before_character_definition');
    expect(old.order).toBe(100);
    expect(old.probability).toBe(100);
    expect(old.keys).toEqual([]);
  });
});

describe('oldPatchToNewPatch_ACU（旧版 partial → 新版 partial）', () => {
  it('仅映射存在字段，不注入未指定字段', () => {
    const patch = oldPatchToNewPatch_ACU({ uid: 3, comment: '标题', content: '正文' });
    expect(patch).toEqual({ uid: 3, name: '标题', content: '正文' });
    expect(patch).not.toHaveProperty('strategy');
    expect(patch).not.toHaveProperty('position');
  });

  it('at_depth_as_assistant 拆解为 type+role', () => {
    const patch = oldPatchToNewPatch_ACU({ position: 'at_depth_as_assistant', depth: 6, order: 10 });
    expect(patch.position).toEqual({ type: 'at_depth', role: 'assistant', depth: 6, order: 10 });
  });

  it('delay_until_recursion 三态：false→null、true→1、数字原样', () => {
    expect(oldPatchToNewPatch_ACU({ delay_until_recursion: false }).recursion).toEqual({ delay_until: null });
    expect(oldPatchToNewPatch_ACU({ delay_until_recursion: true }).recursion).toEqual({ delay_until: 1 });
    expect(oldPatchToNewPatch_ACU({ delay_until_recursion: 4 }).recursion).toEqual({ delay_until: 4 });
  });

  it('logic 与 filters 归入 keys_secondary', () => {
    const patch = oldPatchToNewPatch_ACU({ type: 'constant', keys: ['a'], logic: 'not_all', filters: ['b'] });
    expect(patch.strategy).toEqual({ type: 'constant', keys: ['a'], keys_secondary: { logic: 'not_all', keys: ['b'] } });
  });
});

describe('nativeToOldEntry_ACU（ST 原生 → 旧版扁平）', () => {
  it('disable 取反为 enabled，constant/vectorized 推导 type', () => {
    expect(nativeToOldEntry_ACU({ uid: 1, disable: true, constant: true }).enabled).toBe(false);
    expect(nativeToOldEntry_ACU({ uid: 1, constant: true }).type).toBe('constant');
    expect(nativeToOldEntry_ACU({ uid: 1, vectorized: true }).type).toBe('vectorized');
    expect(nativeToOldEntry_ACU({ uid: 1, selective: true }).type).toBe('selective');
  });

  it('position=4 结合 role 数字映射为 at_depth_as_*', () => {
    const old = nativeToOldEntry_ACU({ uid: 1, position: 4, role: 2, depth: 7 });
    expect(old.position).toBe('at_depth_as_assistant');
    expect(old.depth).toBe(7);
  });

  it('position 数字枚举映射与 depth 归零', () => {
    expect(nativeToOldEntry_ACU({ uid: 1, position: 0 }).position).toBe('before_character_definition');
    expect(nativeToOldEntry_ACU({ uid: 1, position: 1 }).position).toBe('after_character_definition');
    expect(nativeToOldEntry_ACU({ uid: 1, position: 2 }).position).toBe('before_author_note');
    expect(nativeToOldEntry_ACU({ uid: 1, position: 3 }).position).toBe('after_author_note');
    expect(nativeToOldEntry_ACU({ uid: 1, position: 5 }).position).toBe('before_example_messages');
    expect(nativeToOldEntry_ACU({ uid: 1, position: 6 }).position).toBe('after_example_messages');
    expect(nativeToOldEntry_ACU({ uid: 1, position: 3, depth: 9 }).depth).toBeNull();
  });

  it('selectiveLogic 数字映射为旧版 logic 字符串', () => {
    expect(nativeToOldEntry_ACU({ uid: 1, selectiveLogic: 0 }).logic).toBe('and_any');
    expect(nativeToOldEntry_ACU({ uid: 1, selectiveLogic: 1 }).logic).toBe('not_all');
    expect(nativeToOldEntry_ACU({ uid: 1, selectiveLogic: 2 }).logic).toBe('not_any');
    expect(nativeToOldEntry_ACU({ uid: 1, selectiveLogic: 3 }).logic).toBe('and_all');
  });

  it('可空全局项 null→same_as_global，automationId 空串→null', () => {
    const old = nativeToOldEntry_ACU({ uid: 1, scanDepth: null, caseSensitive: null, matchWholeWords: true, automationId: '' });
    expect(old.scan_depth).toBe('same_as_global');
    expect(old.case_sensitive).toBe('same_as_global');
    expect(old.match_whole_words).toBe(true);
    expect(old.automation_id).toBeNull();
  });

  it('delayUntilRecursion 0→false，正数原样', () => {
    expect(nativeToOldEntry_ACU({ uid: 1, delayUntilRecursion: 0 }).delay_until_recursion).toBe(false);
    expect(nativeToOldEntry_ACU({ uid: 1, delayUntilRecursion: 2 }).delay_until_recursion).toBe(2);
  });
});

describe('oldPatchToNativePatch_ACU（旧版 partial → ST 原生 patch）', () => {
  it('enabled 取反为 disable，type 展开为三布尔', () => {
    expect(oldPatchToNativePatch_ACU({ enabled: false })).toEqual({ disable: true });
    expect(oldPatchToNativePatch_ACU({ type: 'constant' })).toEqual({ constant: true, vectorized: false, selective: false });
    expect(oldPatchToNativePatch_ACU({ type: 'selective' })).toEqual({ constant: false, vectorized: false, selective: true });
  });

  it('position 字符串映射为数字并携带 role', () => {
    expect(oldPatchToNativePatch_ACU({ position: 'at_depth_as_user', depth: 3 })).toEqual({ position: 4, role: 1, depth: 3 });
    expect(oldPatchToNativePatch_ACU({ position: 'after_author_note' })).toEqual({ position: 3 });
  });

  it('same_as_global 转为 null', () => {
    expect(oldPatchToNativePatch_ACU({ scan_depth: 'same_as_global' })).toEqual({ scanDepth: null });
    expect(oldPatchToNativePatch_ACU({ scan_depth: 5 })).toEqual({ scanDepth: 5 });
  });

  it('keys/filters/logic 映射为 key/keysecondary/selectiveLogic', () => {
    expect(oldPatchToNativePatch_ACU({ keys: ['a'], filters: ['b'], logic: 'not_any' }))
      .toEqual({ key: ['a'], keysecondary: ['b'], selectiveLogic: 2 });
  });
});

describe('往返一致性（旧 patch → 原生 → 旧）', () => {
  it('核心消费字段（uid/comment/order/enabled/type/keys/content/prevent_recursion/position/depth/logic）经原生格式往返后保持', () => {
    const oldPatch = {
      comment: '往返条目',
      enabled: false,
      type: 'constant' as const,
      keys: ['关键字'],
      content: '内容体',
      prevent_recursion: true,
      position: 'at_depth_as_system' as const,
      depth: 2,
      order: 55,
      logic: 'and_all' as const,
    };
    const defaults = buildNativeEntryDefaults_ACU();
    // 直接断言默认值输出：原往返断言里各字段都被 patch 覆盖，该函数改坏不会被发现
    expect(defaults).toMatchObject({
      constant: false,
      vectorized: false,
      selective: true,
      order: 100,
      position: 0,
      disable: false,
    });
    const nativeEntry = { uid: 11, ...defaults, ...oldPatchToNativePatch_ACU(oldPatch) };
    const roundTripped = nativeToOldEntry_ACU(nativeEntry);
    expect(roundTripped.uid).toBe(11);
    expect(roundTripped.comment).toBe('往返条目');
    expect(roundTripped.enabled).toBe(false);
    expect(roundTripped.type).toBe('constant');
    expect(roundTripped.keys).toEqual(['关键字']);
    expect(roundTripped.content).toBe('内容体');
    expect(roundTripped.prevent_recursion).toBe(true);
    expect(roundTripped.position).toBe('at_depth_as_system');
    expect(roundTripped.depth).toBe(2);
    expect(roundTripped.order).toBe(55);
    expect(roundTripped.logic).toBe('and_all');
  });
});
