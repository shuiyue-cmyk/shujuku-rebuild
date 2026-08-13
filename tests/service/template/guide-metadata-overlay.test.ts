/**
 * tests/service/template/guide-metadata-overlay.test.ts
 * applyGuideMetadataToSheet_ACU / isSameSheetHeader_ACU 纯函数单测
 */
import { describe, it, expect } from 'vitest';
import { applyGuideMetadataToSheet_ACU, isSameSheetHeader_ACU } from '../../../src/service/template/guide-metadata-overlay';

describe('isSameSheetHeader_ACU', () => {
  it('长度与内容完全一致返回 true', () => {
    expect(isSameSheetHeader_ACU(['row_id', '名称'], ['row_id', '名称'])).toBe(true);
  });

  it('长度不同返回 false', () => {
    expect(isSameSheetHeader_ACU(['row_id', '名称'], ['row_id', '名称', '数量'])).toBe(false);
  });

  it('内容不同返回 false', () => {
    expect(isSameSheetHeader_ACU(['row_id', '名称'], ['row_id', '物品名'])).toBe(false);
  });

  it('null/undefined 单元格按空串比较', () => {
    expect(isSameSheetHeader_ACU(['row_id', null], ['row_id', ''])).toBe(true);
  });

  it('非数组返回 false', () => {
    expect(isSameSheetHeader_ACU('row_id', ['row_id'])).toBe(false);
    expect(isSameSheetHeader_ACU(null, ['row_id'])).toBe(false);
  });
});

describe('applyGuideMetadataToSheet_ACU', () => {
  it('字段白名单：name/updateConfig/exportConfig/orderNo 覆盖，content/seedRows/uid 不触碰', () => {
    const target = {
      uid: 'sheet_x',
      name: '旧名',
      updateConfig: { uiSentinel: 0 },
      exportConfig: { enabled: false },
      orderNo: 9,
      content: [['row_id', '列']],
      seedRows: [['1', '旧种子']],
    };
    const guide = {
      name: '新名',
      updateConfig: { uiSentinel: -1 },
      exportConfig: { enabled: true },
      orderNo: 2.9,
      content: [['row_id', '新列']],
      seedRows: [['2', '新种子']],
    };
    const result = applyGuideMetadataToSheet_ACU(target, guide, { inheritDdl: false });
    expect(result.changed).toBe(true);
    expect(target.name).toBe('新名');
    expect(target.updateConfig).toEqual({ uiSentinel: -1 });
    expect(target.exportConfig).toEqual({ enabled: true });
    expect(target.orderNo).toBe(2); // Math.trunc
    expect(target.content).toEqual([['row_id', '列']]); // 不触碰 content
    expect(target.seedRows).toEqual([['1', '旧种子']]); // 不触碰 seedRows
    expect(target.uid).toBe('sheet_x'); // 不触碰 uid
  });

  it('sourceData 排除 ddl：inheritDdl=false 时保留 target ddl，其余字段以 guide 为准', () => {
    const target = {
      sourceData: { ddl: 'create table t (row_id text, a text);', note: '旧说明', weight: 1 },
    };
    const guide = {
      sourceData: { ddl: 'create table t (row_id text, a text, b int);', note: '新说明' },
    };
    applyGuideMetadataToSheet_ACU(target, guide, { inheritDdl: false });
    // ddl 保留 target（checkpoint 权威），note 以 guide 为准，weight 保留 target 额外字段
    expect(target.sourceData.ddl).toContain('a text);');
    expect(target.sourceData.note).toBe('新说明');
    expect(target.sourceData.weight).toBe(1);
  });

  it('sourceData 排除 ddl：inheritDdl=true 且 guide 有 ddl 时采用 guide ddl', () => {
    const target = {
      sourceData: { ddl: 'create table t (row_id text, a text);' },
    };
    const guide = {
      sourceData: { ddl: 'create table t (row_id text, a text, b int);', note: '说明' },
    };
    applyGuideMetadataToSheet_ACU(target, guide, { inheritDdl: true });
    expect(target.sourceData.ddl).toContain('b int');
    expect(target.sourceData.note).toBe('说明');
  });

  it('guide 无 sourceData 时 target.sourceData 保持不变', () => {
    const target = { sourceData: { ddl: 'x', note: '旧' } };
    applyGuideMetadataToSheet_ACU(target, { name: '仅改名' } as any, { inheritDdl: false });
    expect(target.sourceData).toEqual({ ddl: 'x', note: '旧' });
  });

  it('guide 为 null/undefined 或 target 非法时返回 changed=false 且不改 target', () => {
    const target = { name: 'a' };
    expect(applyGuideMetadataToSheet_ACU(target, null, { inheritDdl: false }).changed).toBe(false);
    expect(applyGuideMetadataToSheet_ACU(target, undefined, { inheritDdl: false }).changed).toBe(false);
    expect(applyGuideMetadataToSheet_ACU(null as any, { name: 'b' }, { inheritDdl: false }).changed).toBe(false);
    expect(target.name).toBe('a');
  });

  it('输入不可变：不修改传入的 guide 对象', () => {
    const target = { name: 'a', sourceData: { ddl: 'x' } };
    const guide = { name: 'b', sourceData: { ddl: 'y', note: 'n' } };
    const guideSnapshot = JSON.stringify(guide);
    applyGuideMetadataToSheet_ACU(target, guide, { inheritDdl: true });
    expect(JSON.stringify(guide)).toBe(guideSnapshot);
  });
});
