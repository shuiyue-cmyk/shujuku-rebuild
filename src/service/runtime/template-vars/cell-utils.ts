/**
 * service/runtime/template-vars/cell-utils.ts
 * 表格单元格操作纯函数（getCellValue / normalizeOperators / compareValue / evaluateCellExpression）
 * 从 helpers-template-vars.ts 拆出
 */
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../../shared/utils';

  /**
   * 获取表格中指定单元格的值
   * @param allTablesJson - 完整的表格数据对象
   * @param tableName - 表格名
   * @param rowName - 行标识（在任意列中匹配）
   * @param colName - 列名（在表头中匹配）
   * @returns {{ success: boolean, value: any, rawValue?: string, error?: string }}
   */
  export function getCellValue_ACU(allTablesJson: any, tableName: string, rowName: string, colName: string) {
    try {
      if (!allTablesJson || typeof allTablesJson !== 'object') {
        return { success: false, value: null as any, error: '表格数据为空' };
      }
      
      const sheets: any[] = Object.values(allTablesJson).filter((x: any) => x && typeof x === 'object' && x.name && x.content);
      const targetTable = sheets.find(s => String(s.name || '').trim() === tableName.trim());
      
      if (!targetTable) {
        return { success: false, value: null, error: `未找到表格: ${tableName}` };
      }
      
      if (!Array.isArray(targetTable.content) || targetTable.content.length < 1) {
        return { success: false, value: null, error: `表格 ${tableName} 没有数据` };
      }
      
      const headerRow = targetTable.content[0];
      if (!Array.isArray(headerRow)) {
        return { success: false, value: null, error: `表格 ${tableName} 表头格式错误` };
      }
      
      const colIndex = headerRow.findIndex(h => String(h || '').trim() === colName.trim());
      if (colIndex === -1) {
        return { success: false, value: null, error: `未找到列: ${colName}` };
      }
      
      const normalizedRowName = String(rowName || '').trim();
      const dataRows = targetTable.content.slice(1);
      const targetRow = dataRows.find((row: any) => {
        if (!Array.isArray(row)) return false;
        return row.some((cell: any) => String(cell || '').trim() === normalizedRowName);
      });
      
      if (!targetRow) {
        return { success: false, value: null, error: `未找到行标识: ${rowName}` };
      }
      
      const cellValue = targetRow[colIndex];
      
      const numValue = parseFloat(cellValue);
      if (!isNaN(numValue) && isFinite(numValue)) {
        return { success: true, value: numValue, rawValue: String(cellValue) };
      }
      
      return { success: true, value: String(cellValue || ''), rawValue: String(cellValue || '') };
      
    } catch (e) {
      logError_ACU('[剧情推进] getCellValue_ACU 出错:', e);
      return { success: false, value: null, error: String(e.message || e) };
    }
  }

  /**
   * 规范化运算符表达式（将全角运算符转换为半角）
   */
  export function normalizeOperators_ACU(expression: string) {
    if (!expression || typeof expression !== 'string') return expression;
    return expression
      .replace(/＞/g, '>')
      .replace(/＜/g, '<')
      .replace(/＝/g, '==')
      .replace(/≥/g, '>=')
      .replace(/≦/g, '<=')
      .replace(/≤/g, '<=')
      .replace(/≠/g, '!=');
  }

  /**
   * 执行单个值的比较
   */
  export function compareValue_ACU(cellValue: any, operator: string, compareValue: any) {
    const numCompareValue = parseFloat(compareValue);
    const isNumericComparison = !isNaN(numCompareValue) && isFinite(numCompareValue);
    
    if (isNumericComparison && typeof cellValue === 'number') {
      switch (operator) {
        case '>': return cellValue > numCompareValue;
        case '<': return cellValue < numCompareValue;
        case '>=': return cellValue >= numCompareValue;
        case '<=': return cellValue <= numCompareValue;
        case '==': return cellValue === numCompareValue;
        case '!=': return cellValue !== numCompareValue;
        default: return false;
      }
    } else {
      const strCellValue = String(cellValue);
      const strCompareValue = String(compareValue);
      switch (operator) {
        case '==': return strCellValue === strCompareValue;
        case '!=': return strCellValue !== strCompareValue;
        case '>': return strCellValue > strCompareValue;
        case '<': return strCellValue < strCompareValue;
        case '>=': return strCellValue >= strCompareValue;
        case '<=': return strCellValue <= strCompareValue;
        default: return false;
      }
    }
  }

  /**
   * 解析数值比较表达式（简化版）
   * 支持格式：
   * - 精确匹配：表格名/行标识/列名 > 50
   * - 模糊匹配（某行）：表格名/行名 > 50
   * - 模糊匹配（某列）：表格名/列名 > 50
   */
  export function evaluateCellExpression_ACU(expression: string, allTablesJson: any) {
    if (!expression || typeof expression !== 'string') return false;
    
    const normalizedExpr = normalizeOperators_ACU(expression);
    
    const operators = ['>=', '<=', '!=', '==', '>', '<'];
    
    let matchedOperator = null;
    let cellRef = '';
    let compareValue = '';
    
    for (const op of operators) {
      const opIndex = normalizedExpr.indexOf(op);
      if (opIndex !== -1) {
        cellRef = normalizedExpr.substring(0, opIndex).trim();
        compareValue = normalizedExpr.substring(opIndex + op.length).trim();
        matchedOperator = op;
        break;
      }
    }
    
    if (!matchedOperator) {
      logWarn_ACU('[剧情推进] evaluateCellExpression_ACU: 未找到有效的比较运算符, expression=', expression);
      return false;
    }
    
    const parts = cellRef.split('/').map(p => p.trim()).filter(p => p);
    
    if (parts.length < 2 || parts.length > 3) {
      logWarn_ACU('[剧情推进] evaluateCellExpression_ACU: 单元格引用格式错误, cellRef=', cellRef);
      return false;
    }
    
    const [tableName, name1, name2] = parts;
    
    if (!allTablesJson || typeof allTablesJson !== 'object') {
      return matchedOperator === '!=';
    }
    
    const sheets: any[] = Object.values(allTablesJson).filter((x: any) => x && typeof x === 'object' && x.name && x.content);
    const targetTable = sheets.find(s => String(s.name || '').trim() === tableName.trim());
    
    if (!targetTable || !Array.isArray(targetTable.content) || targetTable.content.length < 1) {
      logDebug_ACU('[剧情推进] evaluateCellExpression_ACU: 未找到表格或表格为空, tableName=', tableName);
      return matchedOperator === '!=';
    }
    
    const headerRow = targetTable.content[0];
    if (!Array.isArray(headerRow)) {
      return false;
    }
    
    const dataRows = targetTable.content.slice(1);
    
    if (parts.length === 3) {
      const rowName = name1;
      const colName = name2;
      let cellResult = getCellValue_ACU(allTablesJson, tableName, rowName, colName);
      
      if (cellResult.success) {
        return compareValue_ACU(cellResult.value, matchedOperator, compareValue);
      }

      cellResult = getCellValue_ACU(allTablesJson, tableName, colName, rowName);
      if (cellResult.success) {
        return compareValue_ACU(cellResult.value, matchedOperator, compareValue);
      }
      
      return matchedOperator === '!=';
      
    } else if (parts.length === 2) {
      const targetName = name1;
      let foundAnyCell = false;
      
      const targetRow = dataRows.find((row: any) => {
        if (!Array.isArray(row)) return false;
        return String(row[0] || '').trim() === targetName.trim();
      });
      
      if (targetRow) {
        foundAnyCell = true;
        for (let colIdx = 1; colIdx < targetRow.length; colIdx++) {
          const cellValue = targetRow[colIdx];
          if (compareValue_ACU(cellValue, matchedOperator, compareValue)) {
            return true;
          }
        }
      }
      
      const colIndex = headerRow.findIndex(h => String(h || '').trim() === targetName.trim());
      
      if (colIndex !== -1) {
        foundAnyCell = true;
        for (const row of dataRows) {
          if (!Array.isArray(row)) continue;
          const cellValue = row[colIndex];
          if (compareValue_ACU(cellValue, matchedOperator, compareValue)) {
            return true;
          }
        }
      }
      
      if (foundAnyCell) {
        return false;
      } else {
        return matchedOperator === '!=';
      }
    }
    
    return false;
  }
