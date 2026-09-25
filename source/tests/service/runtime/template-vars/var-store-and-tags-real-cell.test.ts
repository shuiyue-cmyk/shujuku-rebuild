import { describe, expect, it } from 'vitest';
import {
  getCalcVariable_ACU,
  parseCalcTags_ACU,
} from '../../../../src/service/runtime/template-vars/var-store-and-tags';
import { getCellValue_ACU } from '../../../../src/service/runtime/template-vars/cell-utils';

describe('var-store-and-tags real cell calculation contract', () => {
  it('reads a real cell using the production getCellValue contract', () => {
    const allTablesJson = {
      sheet_0: {
        name: '属性表',
        content: [
          ['row_id', '属性', '数值'],
          ['row-1', '攻击力', '25'],
        ],
      },
    };

    expect(getCellValue_ACU(allTablesJson, '属性表', 'row-1', '数值')).toMatchObject({ success: true, value: 25 });

    const rendered = parseCalcTags_ACU(
      '<calc id="power" expr="cell:属性表/row-1/数值+1" />',
      { allTablesJson },
    );

    expect(rendered).toBe('');
    expect(getCalcVariable_ACU('power')).toBe(26);
  });
});
