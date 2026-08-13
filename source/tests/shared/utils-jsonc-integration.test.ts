import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSharedDependencies_ACU = () => {
  vi.doMock('../../src/shared/constants', () => ({
    DEBUG_MODE_ACU: false,
    SCRIPT_ID_PREFIX_ACU: 'ACU',
    TABLE_ORDER_FIELD_ACU: '_acu_order_',
  }));

  vi.doMock('../../src/shared/log-buffer', () => ({
    pushLog: vi.fn(),
    isDebugLogEnabled: () => false,
    isWarnLogEnabled: () => false,
  }));
};

describe('parseTableTemplateJson_ACU JSONC 集成解析', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('使用真实 json-helpers 剥离字符串外 JSONC 注释，同时保留字符串内 URL 与注释标记', async () => {
    mockSharedDependencies_ACU();
    vi.doMock('../../src/shared/defaults-json.js', () => ({
      TABLE_TEMPLATE_ACU: `{
        // 字符串外行注释应被剥离
        "sheet_0": {
          "name": "JSONC模板",
          /* 字符串外块注释应被剥离 */
          "content": [
            ["row_id", "链接", "说明"],
            ["1", "https://example.com/a//b?x=1#hash", "包含 /* 不是注释 */ 与 // 文本"]
          ]
        }
      }`,
    }));

    const { parseTableTemplateJson_ACU } = await import('../../src/shared/utils');

    const fullTemplate = parseTableTemplateJson_ACU({ stripSeedRows: false });
    expect(fullTemplate.sheet_0.content[1][1]).toBe('https://example.com/a//b?x=1#hash');
    expect(fullTemplate.sheet_0.content[1][2]).toBe('包含 /* 不是注释 */ 与 // 文本');

    const headerOnlyTemplate = parseTableTemplateJson_ACU({ stripSeedRows: true });
    expect(headerOnlyTemplate.sheet_0.content).toEqual([['row_id', '链接', '说明']]);
  });

  it('双重 JSON 编码模板内的 JSONC 注释可剥离，字符串值不被截断', async () => {
    mockSharedDependencies_ACU();
    const innerJsoncTemplate = `{
      "sheet_0": {
        // 内层 JSONC 注释
        "name": "双重编码模板",
        "content": [
          ["row_id", "链接"],
          ["1", "https://double.example/a//b"]
        ]
      }
    }`;

    vi.doMock('../../src/shared/defaults-json.js', () => ({
      TABLE_TEMPLATE_ACU: JSON.stringify(innerJsoncTemplate),
    }));

    const { parseTableTemplateJson_ACU } = await import('../../src/shared/utils');

    const parsed = parseTableTemplateJson_ACU({ stripSeedRows: false });
    expect(parsed.sheet_0.name).toBe('双重编码模板');
    expect(parsed.sheet_0.content[1][1]).toBe('https://double.example/a//b');
  });
});
