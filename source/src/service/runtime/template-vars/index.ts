/**
 * service/runtime/template-vars/index.ts
 * 模板变量系统入口 — re-export 所有公共 API
 * 保持与原 helpers-template-vars.ts 完全相同的公共接口
 */

// 变量存储 + Random/Calc/Max/Min 标签
export {
    getTemplateVariableStores_ACU,
    setTemplateVariableStores_ACU,
    parseRandomTags_ACU,
    replaceRandomVariables_ACU,
    parseCalcTags_ACU,
    parseMaxTags_ACU,
    parseMinTags_ACU,
    replaceCalcVariables_ACU,
    replaceMaxVariables_ACU,
    replaceMinVariables_ACU,
} from './var-store-and-tags';

// if 块解析 + 辅助
export {
    parseIfBlockRecursive_ACU,
    parseIfBlocksInContent_ACU,
    getLatestAIMessageContent_ACU,
} from './if-block-parser';

// SQL/ORM 查询模板变量
export {
    replaceDbSqlVariables,
    evaluateOrmExpression,
    evaluateRawSqlExpression,
    evaluateDbCondition,
    evaluateSqlCondition,
    TableQueryBuilder,
    getDbSqlVariable,
    clearDbSqlVariables,
    getDbSqlVariableSnapshot,
    replaceVarReferences,
} from './sql-query-var';

// 中英文名称映射
export {
    getNameMapper,
    disposeGlobalNameMapper,
    NameMapper,
} from './name-mapper';
