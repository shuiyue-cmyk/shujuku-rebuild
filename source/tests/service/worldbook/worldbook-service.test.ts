/**
 * tests/service/worldbook/worldbook-service.test.ts
 * worldbook-service 是 data/gateways/worldbook-gateway 的中转 barrel：
 * 本测试守卫「re-export 契约」——对外符号必须与 gateway 同名导出是同一引用，
 * 防止 gateway 改名/删除后 barrel 静默失效（presentation 层只经本模块访问世界书）。
 *
 * 注：上游同名测试覆盖的 load/save/deleteImportedJsonDataFromLorebook_ACU 属
 * 「TXT 外部导入」剥离功能，本仓已无这三个函数，故未作为用例移植。
 */
import { describe, it, expect } from 'vitest';
import * as service from '../../../src/service/worldbook/worldbook-service';
import * as gateway from '../../../src/data/gateways/worldbook-gateway';

const RE_EXPORTED_ACU = [
  'isWorldbookApiAvailable_ACU',
  'getLorebookEntries_ACU',
  'setLorebookEntries_ACU',
  'createLorebookEntries_ACU',
  'deleteLorebookEntries_ACU',
  'listLorebooks_ACU',
  'getWorldBooks_ACU',
  'getCurrentCharPrimaryLorebook_ACU',
  'getCurrentCharacterWorldbookBinding_ACU',
  'getCharLorebooks_ACU',
  'getActiveWorldbookNamesForFill_ACU',
] as const;

describe('worldbook-service barrel 契约', () => {
  it.each(RE_EXPORTED_ACU)('%s 与 gateway 同名导出为同一引用', (name) => {
    expect(typeof (service as Record<string, unknown>)[name]).toBe('function');
    expect((service as Record<string, unknown>)[name]).toBe((gateway as Record<string, unknown>)[name]);
  });

  it('对外符号集与声明的 re-export 清单一致（无遗漏、无擅自新增）', () => {
    const serviceKeys = Object.keys(service).sort();
    expect(serviceKeys).toEqual([...RE_EXPORTED_ACU].sort());
  });
});
