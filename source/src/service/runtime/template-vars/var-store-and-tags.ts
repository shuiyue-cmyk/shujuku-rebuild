/**
 * service/runtime/template-vars/var-store-and-tags.ts
 * 模板变量存储管理 + Random/Calc/Max/Min 标签解析与替换
 * 从 helpers-template-vars.ts 拆出
 */
import { logDebug_ACU, logWarn_ACU } from '../../../shared/utils';
import { getCellValue_ACU } from './cell-utils';

  let randomVariables_ACU: Record<string, any> = {};
  let calcVariables_ACU: Record<string, any> = {};
  let maxVariables_ACU: Record<string, any> = {};
  let minVariables_ACU: Record<string, any> = {};

  /** 获取模板变量存储的当前快照（供 plot-runtime 跨模块读取） */
  export function getTemplateVariableStores_ACU() {
      return { randomVariables_ACU, calcVariables_ACU, maxVariables_ACU, minVariables_ACU };
  }

  /** 批量设置模板变量存储（供 plot-runtime 跨模块恢复/重置） */
  export function setTemplateVariableStores_ACU(stores: {
      randomVariables_ACU?: Record<string, any>;
      calcVariables_ACU?: Record<string, any>;
      maxVariables_ACU?: Record<string, any>;
      minVariables_ACU?: Record<string, any>;
  } | null) {
      randomVariables_ACU = (stores && typeof stores.randomVariables_ACU === 'object') ? { ...stores.randomVariables_ACU } : {};
      calcVariables_ACU = (stores && typeof stores.calcVariables_ACU === 'object') ? { ...stores.calcVariables_ACU } : {};
      maxVariables_ACU = (stores && typeof stores.maxVariables_ACU === 'object') ? { ...stores.maxVariables_ACU } : {};
      minVariables_ACU = (stores && typeof stores.minVariables_ACU === 'object') ? { ...stores.minVariables_ACU } : {};
  }

  /**
   * 解析随机数标签，生成随机整数
   * 语法：
   * - <random min="1" max="100" /> - 生成随机数并替换标签
   * - <random id="dice" min="1" max="6" /> - 生成随机数并存储为变量
   */
  export function parseRandomTags_ACU(content: string) {
    if (!content || typeof content !== 'string') {
      return content || '';
    }

    randomVariables_ACU = {};

    const randomRegex = /<random\s+([^>]*?)\s*\/?>/gi;

    return content.replace(randomRegex, (match, attrs) => {
      const idMatch = attrs.match(/id\s*=\s*"([^"]*)"/i);
      const minMatch = attrs.match(/min\s*=\s*"(\d+)"/i);
      const maxMatch = attrs.match(/max\s*=\s*"(\d+)"/i);

      if (!minMatch || !maxMatch) {
        logWarn_ACU('[随机函数] 缺少 min 或 max 参数:', attrs);
        return match;
      }

      const id = idMatch ? idMatch[1].trim() : null;
      const min = parseInt(minMatch[1], 10);
      const max = parseInt(maxMatch[1], 10);

      if (isNaN(min) || isNaN(max)) {
        logWarn_ACU('[随机函数] 无效的随机参数:', minMatch[1], maxMatch[1]);
        return match;
      }

      let randomValue;
      if (min > max) {
        logWarn_ACU('[随机函数] 最小值大于最大值，自动交换:', min, max);
        randomValue = Math.floor(Math.random() * (min - max + 1)) + max;
      } else {
        randomValue = Math.floor(Math.random() * (max - min + 1)) + min;
      }

      if (id) {
        randomVariables_ACU[id] = randomValue;
        logDebug_ACU('[随机函数] 生成随机数变量:', id, '=', randomValue, '范围:', min, '-', max);
        return '';
      } else {
        logDebug_ACU('[随机函数] 生成随机数:', randomValue, '范围:', min, '-', max);
        return String(randomValue);
      }
    });
  }

  /**
   * 替换随机数变量引用 $random:id
   */
  export function replaceRandomVariables_ACU(content: string) {
    if (!content || typeof content !== 'string') {
      return content || '';
    }

    return content.replace(/\$random:([a-zA-Z_][a-zA-Z0-9_]*)/gi, (match, id) => {
      if (randomVariables_ACU.hasOwnProperty(id)) {
        return String(randomVariables_ACU[id]);
      }
      logWarn_ACU('[随机函数] 未找到随机数变量:', id);
      return match;
    });
  }

  /**
   * 获取随机数变量值（用于条件判断）
   */
  export function getRandomVariable_ACU(id: string) {
    if (randomVariables_ACU.hasOwnProperty(id)) {
      return randomVariables_ACU[id];
    }
    return null;
  }

  // =========================
  // [剧情推进] 计算变量功能
  // =========================

  /**
   * 解析表达式中的变量引用，返回数值
   * 支持：cell:表名/行名/列名、$random:id、$calc:id、$max:id、$min:id
   */
  export function parseCalcExpressionValue_ACU(expr: string, context: Record<string, any>) {
    if (!expr || typeof expr !== 'string') {
      return { success: false, value: null as number | null, error: '表达式为空' };
    }

    const trimmed = expr.trim();
    
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { success: true, value: parseFloat(trimmed), error: null };
    }

    if (trimmed.startsWith('cell:')) {
      const cellPath = trimmed.substring(5).trim();
      const parts = cellPath.split('/');
      if (parts.length !== 3) {
        return { success: false, value: null, error: `cell 路径格式错误: ${cellPath}` };
      }
    const [tableName, rowName, colName] = parts.map((p: string) => p.trim());
      const cellValue: any = getCellValue_ACU(tableName, rowName, colName, context.allTablesJson);
      if (cellValue === null || cellValue === undefined || cellValue === '') {
        return { success: false, value: null, error: `cell 值不存在: ${cellPath}` };
      }
      const numValue = parseFloat(cellValue);
      if (isNaN(numValue)) {
        return { success: false, value: null, error: `cell 值不是数字: ${cellPath} = ${cellValue}` };
      }
      return { success: true, value: numValue, error: null };
    }

    const randomMatch = trimmed.match(/^\$random:([a-zA-Z_][a-zA-Z0-9_]*)$/i);
    if (randomMatch) {
      const randomId = randomMatch[1];
      const randomValue = getRandomVariable_ACU(randomId);
      if (randomValue === null) {
        return { success: false, value: null, error: `随机数变量不存在: ${randomId}` };
      }
      return { success: true, value: randomValue, error: null as string | null };
    }
    const calcMatch = trimmed.match(/^\$calc:([a-zA-Z_][a-zA-Z0-9_]*)$/i);
    if (calcMatch) {
      const calcId = calcMatch[1];
      if (calcVariables_ACU.hasOwnProperty(calcId)) {
        return { success: true, value: calcVariables_ACU[calcId], error: null };
      }
      return { success: false, value: null, error: `计算变量不存在: ${calcId}` };
    }

    const maxMatch = trimmed.match(/^\$max:([a-zA-Z_][a-zA-Z0-9_]*)$/i);
    if (maxMatch) {
      const maxId = maxMatch[1];
      if (maxVariables_ACU.hasOwnProperty(maxId)) {
        return { success: true, value: maxVariables_ACU[maxId], error: null };
      }
      return { success: false, value: null, error: `最大值变量不存在: ${maxId}` };
    }

    const minMatch = trimmed.match(/^\$min:([a-zA-Z_][a-zA-Z0-9_]*)$/i);
    if (minMatch) {
      const minId = minMatch[1];
      if (minVariables_ACU.hasOwnProperty(minId)) {
        return { success: true, value: minVariables_ACU[minId], error: null };
      }
      return { success: false, value: null, error: `最小值变量不存在: ${minId}` };
    }

    return { success: false, value: null, error: `无法解析表达式: ${trimmed}` };
  }

  /**
   * 计算表达式（支持四则运算和括号）
   */
  function evaluateCalcExpression_ACU(expr: string, context: Record<string, any>) {
    if (!expr || typeof expr !== 'string') {
      return { success: false, value: null as number | null, error: '表达式为空' };
    }

    let processedExpr = expr.trim();
    
    processedExpr = processedExpr.replace(/cell:([^+\-*/%()\s]+)/gi, (match, cellPath) => {
      const parts = cellPath.split('/');
      if (parts.length !== 3) {
        return 'NaN';
      }
    const [tableName, rowName, colName] = parts.map((p: string) => p.trim());
      const cellValue: any = getCellValue_ACU(tableName, rowName, colName, context.allTablesJson);
      if (cellValue === null || cellValue === undefined || cellValue === '') {
        return 'NaN';
      }
      const numValue = parseFloat(cellValue);
      return isNaN(numValue) ? 'NaN' : String(numValue);
    });

    processedExpr = processedExpr.replace(/\$random:([a-zA-Z_][a-zA-Z0-9_]*)/gi, (match, id) => {
      const value = getRandomVariable_ACU(id);
      return value === null ? 'NaN' : String(value);
    });

    processedExpr = processedExpr.replace(/\$calc:([a-zA-Z_][a-zA-Z0-9_]*)/gi, (match, id) => {
      if (calcVariables_ACU.hasOwnProperty(id)) {
        return String(calcVariables_ACU[id]);
      }
      return 'NaN';
    });

    processedExpr = processedExpr.replace(/\$max:([a-zA-Z_][a-zA-Z0-9_]*)/gi, (match, id) => {
      if (maxVariables_ACU.hasOwnProperty(id)) {
        return String(maxVariables_ACU[id]);
      }
      return 'NaN';
    });

    processedExpr = processedExpr.replace(/\$min:([a-zA-Z_][a-zA-Z0-9_]*)/gi, (match, id) => {
      if (minVariables_ACU.hasOwnProperty(id)) {
        return String(minVariables_ACU[id]);
      }
      return 'NaN';
    });

    if (processedExpr.includes('NaN')) {
      return { success: false, value: null, error: `表达式包含无效变量: ${processedExpr}` };
    }

    if (/\/\s*0(?![.\d])/.test(processedExpr)) {
      return { success: false, value: null, error: '除数为零' };
    }

    try {
      if (!/^[\d+\-*/%().\s]+$/.test(processedExpr)) {
        return { success: false, value: null, error: `表达式包含非法字符: ${processedExpr}` };
      }
      
      const result = new Function('return ' + processedExpr)();
      
      if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
        return { success: false, value: null, error: `计算结果无效: ${result}` };
      }

      const intResult = Math.floor(result);
      return { success: true, value: intResult, error: null };
    } catch (e) {
      return { success: false, value: null, error: `计算错误: ${e.message}` };
    }
  }

  /**
   * 解析计算变量标签 <calc id="xxx" expr="表达式" />
   */
  export function parseCalcTags_ACU(content: string, context: Record<string, any>) {
    if (!content || typeof content !== 'string') {
      return content || '';
    }

    calcVariables_ACU = {};

    const calcRegex = /<calc\s+([^>]*?)\s*\/?>/gi;

    return content.replace(calcRegex, (match, attrs) => {
      const idMatch = attrs.match(/id\s*=\s*"([^"]*)"/i);
      const exprMatch = attrs.match(/expr\s*=\s*"([^"]*)"/i);

      if (!idMatch || !exprMatch) {
        logWarn_ACU('[计算变量] 缺少 id 或 expr 参数:', attrs);
        return match;
      }

      const id = idMatch[1].trim();
      const expr = exprMatch[1].trim();

      const result = evaluateCalcExpression_ACU(expr, context);
      
      if (result.success) {
        calcVariables_ACU[id] = result.value;
        logDebug_ACU('[计算变量] 定义成功:', id, '=', result.value, '表达式:', expr);
        return '';
      } else {
        logWarn_ACU('[计算变量] 定义失败:', id, '-', result.error);
        return match;
      }
    });
  }

  /**
   * 解析最大值变量标签 <max id="xxx" values="值1, 值2, ..." />
   */
  export function parseMaxTags_ACU(content: string, context: Record<string, any>) {
    if (!content || typeof content !== 'string') {
      return content || '';
    }

    maxVariables_ACU = {};

    const maxRegex = /<max\s+([^>]*?)\s*\/?>/gi;

    return content.replace(maxRegex, (match, attrs) => {
      const idMatch = attrs.match(/id\s*=\s*"([^"]*)"/i);
      const valuesMatch = attrs.match(/values\s*=\s*"([^"]*)"/i);

      if (!idMatch || !valuesMatch) {
        logWarn_ACU('[最大值变量] 缺少 id 或 values 参数:', attrs);
        return match;
      }

      const id = idMatch[1].trim();
      const valuesStr = valuesMatch[1].trim();

      const valueExprs = valuesStr.split(',').map((v: string) => v.trim()).filter((v: string) => v);
      if (valueExprs.length === 0) {
        logWarn_ACU('[最大值变量] 值列表为空:', id);
        return match;
      }

      const values = [];
      for (const expr of valueExprs) {
        const result = parseCalcExpressionValue_ACU(expr, context);
        if (!result.success) {
          logWarn_ACU('[最大值变量] 解析值失败:', id, '-', result.error, '表达式:', expr);
          return match;
        }
        values.push(result.value);
      }

      const maxValue = Math.max(...values);
      maxVariables_ACU[id] = maxValue;
      logDebug_ACU('[最大值变量] 定义成功:', id, '=', maxValue, '值列表:', values);
      return '';
    });
  }

  /**
   * 解析最小值变量标签 <min id="xxx" values="值1, 值2, ..." />
   */
  export function parseMinTags_ACU(content: string, context: Record<string, any>) {
    if (!content || typeof content !== 'string') {
      return content || '';
    }

    minVariables_ACU = {};

    const minRegex = /<min\s+([^>]*?)\s*\/?>/gi;

    return content.replace(minRegex, (match, attrs) => {
      const idMatch = attrs.match(/id\s*=\s*"([^"]*)"/i);
      const valuesMatch = attrs.match(/values\s*=\s*"([^"]*)"/i);

      if (!idMatch || !valuesMatch) {
        logWarn_ACU('[最小值变量] 缺少 id 或 values 参数:', attrs);
        return match;
      }

      const id = idMatch[1].trim();
      const valuesStr = valuesMatch[1].trim();

      const valueExprs = valuesStr.split(',').map((v: string) => v.trim()).filter((v: string) => v);
      if (valueExprs.length === 0) {
        logWarn_ACU('[最小值变量] 值列表为空:', id);
        return match;
      }

      const values = [];
      for (const expr of valueExprs) {
        const result = parseCalcExpressionValue_ACU(expr, context);
        if (!result.success) {
          logWarn_ACU('[最小值变量] 解析值失败:', id, '-', result.error, '表达式:', expr);
          return match;
        }
        values.push(result.value);
      }

      const minValue = Math.min(...values);
      minVariables_ACU[id] = minValue;
      logDebug_ACU('[最小值变量] 定义成功:', id, '=', minValue, '值列表:', values);
      return '';
    });
  }

  /** 替换计算变量引用 $calc:id */
  export function replaceCalcVariables_ACU(content: string) {
    if (!content || typeof content !== 'string') {
      return content || '';
    }

    return content.replace(/\$calc:([a-zA-Z_][a-zA-Z0-9_]*)/gi, (match, id) => {
      if (calcVariables_ACU.hasOwnProperty(id)) {
        return String(calcVariables_ACU[id]);
      }
      logWarn_ACU('[计算变量] 未找到变量:', id);
      return match;
    });
  }

  /** 替换最大值变量引用 $max:id */
  export function replaceMaxVariables_ACU(content: string) {
    if (!content || typeof content !== 'string') {
      return content || '';
    }

    return content.replace(/\$max:([a-zA-Z_][a-zA-Z0-9_]*)/gi, (match, id) => {
      if (maxVariables_ACU.hasOwnProperty(id)) {
        return String(maxVariables_ACU[id]);
      }
      logWarn_ACU('[最大值变量] 未找到变量:', id);
      return match;
    });
  }

  /** 替换最小值变量引用 $min:id */
  export function replaceMinVariables_ACU(content: string) {
    if (!content || typeof content !== 'string') {
      return content || '';
    }

    return content.replace(/\$min:([a-zA-Z_][a-zA-Z0-9_]*)/gi, (match, id) => {
      if (minVariables_ACU.hasOwnProperty(id)) {
        return String(minVariables_ACU[id]);
      }
      logWarn_ACU('[最小值变量] 未找到变量:', id);
      return match;
    });
  }

  /** 获取计算变量值（用于条件判断） */
  export function getCalcVariable_ACU(id: string) {
    if (calcVariables_ACU.hasOwnProperty(id)) {
      return calcVariables_ACU[id];
    }
    return null;
  }

  /** 获取最大值变量值（用于条件判断） */
  export function getMaxVariable_ACU(id: string) {
    if (maxVariables_ACU.hasOwnProperty(id)) {
      return maxVariables_ACU[id];
    }
    return null;
  }

  /** 获取最小值变量值（用于条件判断） */
  export function getMinVariable_ACU(id: string) {
    if (minVariables_ACU.hasOwnProperty(id)) {
      return minVariables_ACU[id];
    }
    return null;
  }
