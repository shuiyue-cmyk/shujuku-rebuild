/**
 * shared/post-commit-warnings.ts — 填表「表格已提交、派生刷新失败」告警（叶子模块，无依赖）。
 * service 层产出、presentation 层展示共用这一份类型与文案拼接。
 */

/** 表格提交后的派生刷新告警；不得作为重新执行表格变更的依据。 */
export interface TableUpdatePostCommitWarning_ACU {
    code: 'worldbook_sync_failed';
    message: string;
}

/** 告警去重后拼成一条提示文案；没有告警返回空串。 */
export function formatPostCommitWarnings_ACU(warnings?: readonly TableUpdatePostCommitWarning_ACU[] | null): string {
    return [...new Set((warnings || []).map(warning => warning.message))].join('\n');
}
