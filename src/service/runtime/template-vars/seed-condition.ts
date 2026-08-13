/**
 * service/runtime/template-vars/seed-condition.ts
 * Seed 关键词表达式求值 + 统一条件表达式求值 + 条件模板解析
 * 从 helpers-template-vars.ts 拆出
 */
import { logDebug_ACU, logError_ACU, logWarn_ACU } from '../../../shared/utils';
import { evaluateCellExpression_ACU, normalizeOperators_ACU, compareValue_ACU } from './cell-utils';
import { getRandomVariable_ACU, getCalcVariable_ACU, getMaxVariable_ACU, getMinVariable_ACU } from './var-store-and-tags';
import { evaluateDbCondition, evaluateSqlCondition, getDbSqlVariable } from './sql-query-var';

  /**
   * 解析关键词表达式并判断是否匹配
   * 支持的语法：
   * - 简单匹配：战斗
   * - 或逻辑：战斗,打架
   * - 与逻辑：战斗&主角
   * - 非逻辑：!战斗
   * - 组合逻辑：(战斗&主角),感情
   * @param expression - 关键词表达式
   * @param content - 待检测的内容（最新一层的AI回复正文）
   * @param plotContent - 最新一层的推进数据（$6），可选
   * @returns 是否匹配
   */
  export function evaluateSeedExpression_ACU(expression: string, content: string, plotContent: string = '') {
    if (!expression || typeof expression !== 'string') return false;
    if (!content || typeof content !== 'string') return false;
    if (!plotContent || typeof plotContent !== 'string') {
      plotContent = '';
    }
    
    const expr = expression.trim();
    if (!expr) return false;
    
    const combinedContent = content + '\n' + plotContent;
    const lowerContent = combinedContent.toLowerCase();
    
    const checkKeyword = (keyword: string) => {
      const kw = keyword.trim();
      if (!kw) return false;
      
      if (kw.startsWith('!')) {
        const actualKw = kw.slice(1).trim();
        if (!actualKw) return true;
        return !lowerContent.includes(actualKw.toLowerCase());
      }
      
      return lowerContent.includes(kw.toLowerCase());
    };
    
    const checkAndGroup = (group: string) => {
      const keywords = group.split('&').map((k: string) => k.trim()).filter((k: string) => k);
      if (keywords.length === 0) return false;
      return keywords.every(kw => checkKeyword(kw));
    };
    
    const _parenResults: Record<string, boolean> = {};
    
    const processExpression = (expr: string): boolean => {
      let processed = expr;
      const parenRegex = /\(([^()]+)\)/g;
      let match;
      let idx = 0;
      
      while ((match = parenRegex.exec(expr)) !== null) {
        const innerExpr = match[1];
        const innerResult = processExpression(innerExpr);
        processed = processed.replace(match[0], `__PAREN_${idx}__`);
        _parenResults[`__PAREN_${idx}__`] = innerResult;
        idx++;
      }
      
      const orParts = processed.split(',').map((p: string) => p.trim()).filter((p: string) => p);
      
      if (orParts.length > 1) {
        return orParts.some(part => {
          if (_parenResults[part] !== undefined) {
            return _parenResults[part];
          }
          if (part.includes('&')) {
            return checkAndGroup(part);
          }
          return checkKeyword(part);
        });
      }
      
      const singlePart = orParts[0] || '';
      if (_parenResults[singlePart] !== undefined) {
        return _parenResults[singlePart];
      }
      if (singlePart.includes('&')) {
        return checkAndGroup(singlePart);
      }
      return checkKeyword(singlePart);
    };
    
    return processExpression(expr);
  }

  // =========================
  // 条件表达式求值
  // =========================

  /**
   * 解析单个子条件（seed:、cell:、random:、calc:、max:、min:）
   */
  function evaluateSubCondition_ACU(subCondition: string, context: Record<string, any>) {
    if (!subCondition || typeof subCondition !== 'string') return false;
    
    const trimmed = subCondition.trim();
    if (!trimmed) return false;
    
    let isNegated = false;
    let actualCondition = trimmed;
    
    if (trimmed.startsWith('!')) {
      isNegated = true;
      actualCondition = trimmed.slice(1).trim();
    }
    
    if (actualCondition.startsWith('seed:')) {
      const keywordExpr = actualCondition.slice(5).trim();
      let result = evaluateSeedExpression_ACU(keywordExpr, context.seedContent || '', context.plotContent || '');
      return isNegated ? !result : result;
      
    } else if (actualCondition.startsWith('cell:')) {
      const cellExpr = actualCondition.slice(5).trim();
      let result = evaluateCellExpression_ACU(cellExpr, context.allTablesJson);
      return isNegated ? !result : result;
      
    } else if (actualCondition.startsWith('random:')) {
      const randomExpr = actualCondition.slice(7).trim();
      let result = evaluateRandomExpression_ACU(randomExpr);
      return isNegated ? !result : result;
      
    } else if (actualCondition.startsWith('calc:')) {
      const calcExpr = actualCondition.slice(5).trim();
      let result = evaluateCalcCondition_ACU(calcExpr);
      return isNegated ? !result : result;
      
    } else if (actualCondition.startsWith('max:')) {
      const maxExpr = actualCondition.slice(4).trim();
      let result = evaluateMaxCondition_ACU(maxExpr);
      return isNegated ? !result : result;
      
    } else if (actualCondition.startsWith('min:')) {
      const minExpr = actualCondition.slice(4).trim();
      let result = evaluateMinCondition_ACU(minExpr);
      return isNegated ? !result : result;
      
    } else if (actualCondition.startsWith('db:')) {
      const dbExpr = actualCondition.slice(3).trim();
      let result = evaluateDbCondition(dbExpr);
      return isNegated ? !result : result;
      
    } else if (actualCondition.startsWith('sql:')) {
      const sqlExpr = actualCondition.slice(4).trim();
      let result = evaluateSqlCondition(sqlExpr);
      return isNegated ? !result : result;
      
    } else if (actualCondition.startsWith('v:')) {
      // 变量条件：v:变量名 运算符 值
      const varExpr = actualCondition.slice(2).trim();
      let result = evaluateVarCondition_ACU(varExpr);
      return isNegated ? !result : result;
      
    } else {
      logWarn_ACU('[条件模板] 子条件缺少前缀，默认作为关键词匹配:', actualCondition);
      let result = evaluateSeedExpression_ACU(actualCondition, context.seedContent || '', context.plotContent || '');
      return isNegated ? !result : result;
    }
  }

  /** 解析计算变量条件表达式 */
  function evaluateCalcCondition_ACU(expression: string) {
    if (!expression || typeof expression !== 'string') return false;
    
    const expr = normalizeOperators_ACU(expression).trim();
    if (!expr) return false;
    
    const operators = ['>=', '<=', '!=', '==', '>', '<'];
    
    let matchedOperator = null;
    let varRef = '';
    let compareVal = '';
    
    for (const op of operators) {
      const opIndex = expr.indexOf(op);
      if (opIndex !== -1) {
        varRef = expr.substring(0, opIndex).trim();
        compareVal = expr.substring(opIndex + op.length).trim();
        matchedOperator = op;
        break;
      }
    }
    
    if (!matchedOperator) {
      logWarn_ACU('[条件模板] evaluateCalcCondition_ACU: 未找到有效的比较运算符, expression=', expression);
      return false;
    }
    
    const calcValue = getCalcVariable_ACU(varRef);
    if (calcValue === null) {
      logWarn_ACU('[条件模板] evaluateCalcCondition_ACU: 未找到计算变量:', varRef);
      return false;
    }
    
    const numCompareValue = parseFloat(compareVal);
    if (isNaN(numCompareValue)) {
      logWarn_ACU('[条件模板] evaluateCalcCondition_ACU: 无效的比较值:', compareVal);
      return false;
    }
    
    return compareValue_ACU(calcValue, matchedOperator, numCompareValue);
  }

  /** 解析最大值变量条件表达式 */
  function evaluateMaxCondition_ACU(expression: string) {
    if (!expression || typeof expression !== 'string') return false;
    
    const expr = normalizeOperators_ACU(expression).trim();
    if (!expr) return false;
    
    const operators = ['>=', '<=', '!=', '==', '>', '<'];
    
    let matchedOperator = null;
    let varRef = '';
    let compareVal = '';
    
    for (const op of operators) {
      const opIndex = expr.indexOf(op);
      if (opIndex !== -1) {
        varRef = expr.substring(0, opIndex).trim();
        compareVal = expr.substring(opIndex + op.length).trim();
        matchedOperator = op;
        break;
      }
    }
    
    if (!matchedOperator) {
      logWarn_ACU('[条件模板] evaluateMaxCondition_ACU: 未找到有效的比较运算符, expression=', expression);
      return false;
    }
    
    const maxValue = getMaxVariable_ACU(varRef);
    if (maxValue === null) {
      logWarn_ACU('[条件模板] evaluateMaxCondition_ACU: 未找到最大值变量:', varRef);
      return false;
    }
    
    const numCompareValue = parseFloat(compareVal);
    if (isNaN(numCompareValue)) {
      logWarn_ACU('[条件模板] evaluateMaxCondition_ACU: 无效的比较值:', compareVal);
      return false;
    }
    
    return compareValue_ACU(maxValue, matchedOperator, numCompareValue);
  }

  /** 解析最小值变量条件表达式 */
  function evaluateMinCondition_ACU(expression: string) {
    if (!expression || typeof expression !== 'string') return false;
    
    const expr = normalizeOperators_ACU(expression).trim();
    if (!expr) return false;
    
    const operators = ['>=', '<=', '!=', '==', '>', '<'];
    
    let matchedOperator = null;
    let varRef = '';
    let compareVal = '';
    
    for (const op of operators) {
      const opIndex = expr.indexOf(op);
      if (opIndex !== -1) {
        varRef = expr.substring(0, opIndex).trim();
        compareVal = expr.substring(opIndex + op.length).trim();
        matchedOperator = op;
        break;
      }
    }
    
    if (!matchedOperator) {
      logWarn_ACU('[条件模板] evaluateMinCondition_ACU: 未找到有效的比较运算符, expression=', expression);
      return false;
    }
    
    const minValue = getMinVariable_ACU(varRef);
    if (minValue === null) {
      logWarn_ACU('[条件模板] evaluateMinCondition_ACU: 未找到最小值变量:', varRef);
      return false;
    }
    
    const numCompareValue = parseFloat(compareVal);
    if (isNaN(numCompareValue)) {
      logWarn_ACU('[条件模板] evaluateMinCondition_ACU: 无效的比较值:', compareVal);
      return false;
    }
    
    return compareValue_ACU(minValue, matchedOperator, numCompareValue);
  }

  /** 解析随机数条件表达式 */
  function evaluateRandomExpression_ACU(expression: string) {
    if (!expression || typeof expression !== 'string') return false;
    
    const expr = normalizeOperators_ACU(expression).trim();
    if (!expr) return false;
    
    const operators = ['>=', '<=', '!=', '==', '>', '<'];
    
    let matchedOperator = null;
    let randomRef = '';
    let compareVal = '';
    
    for (const op of operators) {
      const opIndex = expr.indexOf(op);
      if (opIndex !== -1) {
        randomRef = expr.substring(0, opIndex).trim();
        compareVal = expr.substring(opIndex + op.length).trim();
        matchedOperator = op;
        break;
      }
    }
    
    if (!matchedOperator) {
      logWarn_ACU('[条件模板] evaluateRandomExpression_ACU: 未找到有效的比较运算符, expression=', expression);
      return false;
    }
    
    let randomValue: number | null = null;
    
    const inlineMatch = randomRef.match(/^(\d+)-(\d+)$/);
    if (inlineMatch) {
      const min = parseInt(inlineMatch[1], 10);
      const max = parseInt(inlineMatch[2], 10);
      if (!isNaN(min) && !isNaN(max)) {
        randomValue = Math.floor(Math.random() * (Math.abs(max - min) + 1)) + Math.min(min, max);
        logDebug_ACU('[条件模板] 内联随机数生成:', randomValue, '范围:', min, '-', max);
      }
    } else {
      randomValue = getRandomVariable_ACU(randomRef);
      if (randomValue === null) {
        logWarn_ACU('[条件模板] evaluateRandomExpression_ACU: 未找到随机数变量:', randomRef);
        return false;
      }
    }
    
    const numCompareValue = parseFloat(compareVal);
    if (isNaN(numCompareValue)) {
      logWarn_ACU('[条件模板] evaluateRandomExpression_ACU: 无效的比较值:', compareVal);
      return false;
    }
    
    return compareValue_ACU(randomValue, matchedOperator, numCompareValue);
  }

  /**
   * 解析统一条件表达式（支持括号分组、& 和 , 运算符）
   * 运算优先级：括号 > & (AND) > , (OR)
   */
  export function evaluateCondExpression_ACU(expression: string, context: Record<string, any>) {
    if (!expression || typeof expression !== 'string') return false;
    
    const expr = expression.trim();
    if (!expr) return false;
    
    let pos = 0;
    
    const skipWhitespace = () => {
      while (pos < expr.length && /\s/.test(expr[pos])) {
        pos++;
      }
    };
    
    const parseOrExpr = (): boolean => {
      skipWhitespace();
      let result: boolean = parseAndExpr();
      
      while (pos < expr.length) {
        skipWhitespace();
        if (expr[pos] === ',') {
          pos++;
          skipWhitespace();
          const right = parseAndExpr();
          result = result || right;
        } else {
          break;
        }
      }
      
      return result;
    };
    
    const parseAndExpr = (): boolean => {
      skipWhitespace();
      let result: boolean = parsePrimary();
      
      while (pos < expr.length) {
        skipWhitespace();
        if (expr[pos] === '&') {
          pos++;
          skipWhitespace();
          const right = parsePrimary();
          result = result && right;
        } else {
          break;
        }
      }
      
      return result;
    };
    
    const parsePrimary = (): boolean => {
      skipWhitespace();
      
      if (pos >= expr.length) return false;
      
      let isNegated = false;
      if (expr[pos] === '!') {
        isNegated = true;
        pos++;
        skipWhitespace();
      }
      
      if (expr[pos] === '(') {
        pos++;
        skipWhitespace();
        const result: boolean = parseOrExpr();
        skipWhitespace();
        if (pos < expr.length && expr[pos] === ')') {
          pos++;
        }
        return isNegated ? !result : result;
      }
      
      let subCond = '';
      let parenDepth = 0;
      while (pos < expr.length) {
        const ch = expr[pos];
        if (ch === '(') {
          parenDepth++;
          subCond += ch;
          pos++;
        } else if (ch === ')') {
          if (parenDepth > 0) {
            parenDepth--;
            subCond += ch;
            pos++;
          } else {
            // 深度为 0 的 ) 是外层分组括号的闭合，终止提取
            break;
          }
        } else if ((ch === '&' || ch === ',') && parenDepth === 0) {
          // 只有在括号深度为 0 时，& 和 , 才是逻辑运算符
          break;
        } else {
          subCond += ch;
          pos++;
        }
      }
      
      const result = evaluateSubCondition_ACU(subCond, context);
      return isNegated ? !result : result;
    };
    
    try {
      const result = parseOrExpr();
      skipWhitespace();
      return result;
    } catch (e) {
      logError_ACU('[条件模板] evaluateCondExpression_ACU 解析出错:', e, 'expression:', expression);
      return false;
    }
  }

  /**
   * 解析变量条件表达式
   * 语法：v:变量名 运算符 值
   * 示例：v:sword_count > 3、v:total == 100
   * 无运算符时做 truthy 判断
   */
  function evaluateVarCondition_ACU(expression: string) {
    if (!expression || typeof expression !== 'string') return false;
    
    const expr = normalizeOperators_ACU(expression).trim();
    if (!expr) return false;
    
    const operators = ['>=', '<=', '!=', '==', '>', '<'];
    
    let matchedOperator: string | null = null;
    let varRef = '';
    let compareVal = '';
    
    for (const op of operators) {
      const opIndex = expr.indexOf(op);
      if (opIndex !== -1) {
        varRef = expr.substring(0, opIndex).trim();
        compareVal = expr.substring(opIndex + op.length).trim();
        matchedOperator = op;
        break;
      }
    }
    
    if (!matchedOperator) {
      // 无运算符：做 truthy 判断
      const value = getDbSqlVariable(expr.trim());
      if (value === null) {
        logWarn_ACU('[条件模板] evaluateVarCondition_ACU: 未找到变量:', expr);
        return false;
      }
      // 非零/非空/非false = true
      if (typeof value === 'number') return value !== 0;
      if (typeof value === 'string') return value !== '' && value !== '0' && value !== 'false';
      return !!value;
    }
    
    const varValue = getDbSqlVariable(varRef);
    if (varValue === null) {
      logWarn_ACU('[条件模板] evaluateVarCondition_ACU: 未找到变量:', varRef);
      return false;
    }
    
    const numCompareValue = parseFloat(compareVal);
    if (!isNaN(numCompareValue) && typeof varValue === 'number') {
      return compareValue_ACU(varValue, matchedOperator, numCompareValue);
    }
    
    // 字符串比较
    return compareValue_ACU(varValue, matchedOperator, compareVal);
  }


