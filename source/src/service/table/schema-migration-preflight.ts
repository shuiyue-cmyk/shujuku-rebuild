import type { TableDataObject_ACU, Sheet_ACU } from '../../shared/models/table-data';
import { parseDDLColumnInfos_ACU } from '../../shared/ddl-utils';
import type { TableSheetSchemaMigrateOperation_ACU, TableSheetSchemaMigrateOperationV2Contract_ACU } from './storage-frame-v2-types';
import {
  buildSheetSchemaMigrationOperation_ACU,
  buildSheetSchemaMigrationOperationV2_ACU,
  applySheetSchemaMigrationOperation_ACU,
} from './table-schema-migration';
import { planSheetSchemaMigration_ACU, type SchemaMigrationPlannerChoice_ACU } from './schema-migration-planner';
import { hydrateTableDataStrict_ACU } from './sqlite-template-validation';
import { SqliteRuntimeUnavailableError_ACU } from '../../data/sqlite/sqlite-engine';

export type SchemaMigrationPreflightIntent_ACU = Omit<
  TableSheetSchemaMigrateOperationV2Contract_ACU,
  'kind' | 'contractVersion' | 'sheetKey' | 'beforeSchema' | 'targetSchema'
  | 'beforeSchemaDigest' | 'targetSchemaDigest' | 'dryRun'
>;

export const DESTRUCTIVE_COLUMN_DROP_CONFIRMATION_REQUIRED_ACU = 'DESTRUCTIVE_COLUMN_DROP_CONFIRMATION_REQUIRED';

export interface SchemaMigrationPreflightIssue_ACU {
  code: typeof DESTRUCTIVE_COLUMN_DROP_CONFIRMATION_REQUIRED_ACU;
  sheetKey: string;
  tableName: string;
  droppedColumns: Array<{
    physicalName: string;
    displayHeader: string;
    index: number;
  }>;
  affectedRowCount: number;
  message: string;
}

export interface SchemaMigrationPreflightDecision_ACU {
  sheetKey: string;
  status: 'auto_apply' | 'needs_choice' | 'needs_confirmation' | 'invalid';
  code: string;
  message?: string;
  choices?: SchemaMigrationPlannerChoice_ACU[];
}

/**
 * 每个 schema-changed Sheet 的可持久化执行模式。
 * `migration`：生成精确的 sheet_schema_migrate operation，保留历史列值。
 * `rebase`：候选本身合法，但无法安全构造精确 migration 时，以编辑器候选整表作为新边界快照。
 */
export type SchemaMigrationApplyMode_ACU = 'migration' | 'rebase';

export interface SchemaMigrationPreflightResult_ACU {
  changedSheetKeys: string[];
  blockers: string[];
  /**
   * 非阻断性诊断（可选，旧调用方可忽略）。
   * 例如：hydrate 过程中记录到运行时 fallback 时用于说明降级原因。
   * 兼容范式参考 useVisualizerSave.ts:823-827（旧返回值缺字段仍可工作）。
   */
  warnings?: string[];
  issues: SchemaMigrationPreflightIssue_ACU[];
  operations: TableSheetSchemaMigrateOperation_ACU[];
  decisions: SchemaMigrationPreflightDecision_ACU[];
  /**
   * 逐 Sheet 执行模式；只有 status 为 auto_apply 的 Sheet 才有对应 action。
   * migration 的 action 在 operations 中按 sheetKey 一一对应；
   * rebase 的 action 由调用方以候选 Sheet 整表构造，不伪造空 migration operation。
   */
  applyModes?: Record<string, SchemaMigrationApplyMode_ACU>;
}

function isSheet_ACU(value: unknown): value is Sheet_ACU {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function schemaProjection_ACU(sheet: Sheet_ACU): string {
  return JSON.stringify({
    uid: sheet.uid,
    headers: Array.isArray(sheet.content?.[0]) ? sheet.content[0] : [],
    ddl: sheet.sourceData?.ddl || '',
  });
}

function getDestructiveDropIssue_ACU(sheetKey: string, before: Sheet_ACU, after: Sheet_ACU): SchemaMigrationPreflightIssue_ACU | null {
  const beforeColumns = parseDDLColumnInfos_ACU(String(before.sourceData?.ddl || ''));
  const afterNames = new Set(parseDDLColumnInfos_ACU(String(after.sourceData?.ddl || '')).map(column => column.sqlName));
  const headers = Array.isArray(before.content?.[0]) ? before.content[0] : [];
  const droppedColumns = beforeColumns
    .filter(column => column.sqlName.toLowerCase() !== 'row_id' && !afterNames.has(column.sqlName))
    .map(column => ({
      physicalName: column.sqlName,
      displayHeader: String(headers[column.index] ?? column.comment ?? column.sqlName),
      index: column.index,
    }));
  if (droppedColumns.length === 0) return null;
  const tableName = String(before.name || before.uid || sheetKey);
  return {
    code: DESTRUCTIVE_COLUMN_DROP_CONFIRMATION_REQUIRED_ACU,
    sheetKey,
    tableName,
    droppedColumns,
    affectedRowCount: Math.max(0, (Array.isArray(before.content) ? before.content.length : 0) - 1),
    message: `表「${tableName}」删除 ${droppedColumns.map(column => `「${column.displayHeader}」`).join('、')}需要显式确认。`,
  };
}

/**
 * Read-only validation for editor candidates. It never creates frame entry or
 * mutates either input.
 *
 * 每个 schema-changed Sheet 只允许三种结局：
 *  1. migration：V1/V2 精确迁移 operation（保留历史列值）。
 *  2. rebase：候选本身合法， planner 无法或无需构造精确 migration 时，
 *     以编辑器候选整表作为新边界快照（不伪造空 migration operation）。
 *  3. invalid：候选不合法、身份协议损坏、strict hydrate 失败或提交上下文已陈旧。
 *
 * `UNSUPPORTED_SCHEMA_CHANGE` 不再是最终 blocker；它只作为选择 rebase 的原因。
 */
export async function preflightSchemaMigrations_ACU(input: {
  baselineData: TableDataObject_ACU;
  candidateData: TableDataObject_ACU;
  intents?: Record<string, SchemaMigrationPreflightIntent_ACU | undefined>;
  /** Sheets explicitly selected by the user for candidate-authoritative full rebase. */
  rebaseSheetKeys?: readonly string[];
  /** Authorizes only this preflight invocation to construct destructive drop operations. */
  destructiveChangeConfirmed?: boolean;
}): Promise<SchemaMigrationPreflightResult_ACU> {
  const changedSheetKeys = Object.keys(input.candidateData || {}).filter(sheetKey => {
    if (!sheetKey.startsWith('sheet_')) return false;
    const before = input.baselineData?.[sheetKey];
    const after = input.candidateData?.[sheetKey];
    return isSheet_ACU(before) && isSheet_ACU(after) && schemaProjection_ACU(before) !== schemaProjection_ACU(after);
  });
  if (changedSheetKeys.length === 0) return { changedSheetKeys, blockers: [], issues: [], operations: [], decisions: [] };

  const blockers: string[] = [];
  const issues: SchemaMigrationPreflightIssue_ACU[] = [];
  const operations: SchemaMigrationPreflightResult_ACU['operations'] = [];
  const decisions: SchemaMigrationPreflightDecision_ACU[] = [];
  const applyModes: Record<string, SchemaMigrationApplyMode_ACU> = {};
  const requestedRebaseSheetKeys = new Set(input.rebaseSheetKeys || []);
  for (const sheetKey of changedSheetKeys) {
    const before = input.baselineData[sheetKey] as Sheet_ACU;
    const after = input.candidateData[sheetKey] as Sheet_ACU;
    try {
      operations.push(await buildSheetSchemaMigrationOperation_ACU(sheetKey, before, after, {
        destructiveChangeConfirmed: input.destructiveChangeConfirmed === true,
      }));
      decisions.push({ sheetKey, status: 'auto_apply', code: 'V1_SAFE_SUBSET' });
      applyModes[sheetKey] = 'migration';
      continue;
    } catch (v1Error: any) {
      // 运行时不可用不是 schema 语义问题：不得降级为 planner/rebase，
      // 否则环境故障会伪装成「schema 不支持」并污染 applyMode 决策。
      if (v1Error instanceof SqliteRuntimeUnavailableError_ACU) throw v1Error;
      const explicitIntent = input.intents?.[sheetKey];
      const planned = explicitIntent ? null : planSheetSchemaMigration_ACU(before, after);
      const inferredIntent = planned?.status === 'auto_apply' ? planned.intent : undefined;
      const inferredReason = planned && planned.status !== 'auto_apply' ? planned.message : undefined;
      const intent = explicitIntent || inferredIntent;
      if (!intent) {
        // 真实 schema 无效（DDL/表头/身份）是最终 blocker，不得降级为删列确认或 rebase。
        if (planned?.status === 'invalid') {
          decisions.push({
            sheetKey,
            status: 'invalid',
            code: planned.code,
            message: planned.message,
          });
          blockers.push(`${sheetKey}: ${planned.message || v1Error?.message || 'schema 无效。'}`);
          continue;
        }
        const issue = input.destructiveChangeConfirmed === true ? null : getDestructiveDropIssue_ACU(sheetKey, before, after);
        const isNeedsChoice = planned?.status === 'needs_choice';
        if (requestedRebaseSheetKeys.has(sheetKey)) {
          if (issue) {
            // 存在实际删除列：即使用户明确选择 rebase，也必须先确认数据丢弃。
            issues.push(issue);
            decisions.push({ sheetKey, status: 'needs_confirmation', code: issue.code, message: issue.message });
            blockers.push(`${sheetKey}: ${issue.message}`);
            continue;
          }
          decisions.push({ sheetKey, status: 'auto_apply', code: 'USER_REQUESTED_REBASE', message: '用户选择按候选整表 rebase。' });
          applyModes[sheetKey] = 'rebase';
          continue;
        }
        if (isNeedsChoice && Array.isArray(planned.choices) && planned.choices.length > 0) {
          // 可精确保留历史值的 mapping 仍交由用户确认；若不存在候选 mapping，
          // 也可由调用方显式要求按候选整表 rebase，而不是永久阻断模板保存。
          decisions.push({
            sheetKey,
            status: 'needs_choice',
            code: planned.code,
            message: planned.message,
            choices: planned.choices,
          });
          blockers.push(`${sheetKey}: ${planned.message}`);
          continue;
        }
        if (issue) {
          // 不存在可选 mapping 时，删除列仍必须显式确认。
          issues.push(issue);
          decisions.push({ sheetKey, status: 'needs_confirmation', code: issue.code, message: issue.message });
          blockers.push(`${sheetKey}: ${issue.message}`);
          continue;
        }
        if (planned?.status === 'rebase_available' || isNeedsChoice) {
          // 无可选 mapping 时，候选 Sheet 本身就是用户明确给出的新边界，按整表 rebase。
          decisions.push({ sheetKey, status: 'auto_apply', code: 'REBASE_AVAILABLE', message: planned?.message });
          applyModes[sheetKey] = 'rebase';
        } else {
          decisions.push({
            sheetKey,
            status: 'invalid',
            code: planned?.code || 'V1_AND_V2_UNRESOLVED',
            message: inferredReason || v1Error?.message,
          });
          blockers.push(`${sheetKey}: ${inferredReason || v1Error?.message || 'schema migration 缺少显式 V2 intent。'}`);
        }
        continue;
      }
      try {
        const hasDestructiveDrop = getDestructiveDropIssue_ACU(sheetKey, before, after) !== null;
        const v2Intent: SchemaMigrationPreflightIntent_ACU = {
          ...intent,
          migrationPolicy: {
            ...intent.migrationPolicy,
            destructiveChangeConfirmed: input.destructiveChangeConfirmed === true && hasDestructiveDrop
              ? true
              : intent.migrationPolicy.destructiveChangeConfirmed,
          },
        };
        operations.push(await buildSheetSchemaMigrationOperationV2_ACU(sheetKey, before, after, v2Intent));
        decisions.push({ sheetKey, status: 'auto_apply', code: explicitIntent ? 'EXPLICIT_V2_INTENT' : 'UNIQUE_V2_INTENT' });
        applyModes[sheetKey] = 'migration';
      } catch (v2Error: any) {
        // 同上：运行时不可用直接上抛，绝不降级为 V2_CONTRACT_INVALID 之类的语义判定。
        if (v2Error instanceof SqliteRuntimeUnavailableError_ACU) throw v2Error;
        const issue = input.destructiveChangeConfirmed === true ? null : getDestructiveDropIssue_ACU(sheetKey, before, after);
        if (issue) {
          issues.push(issue);
          decisions.push({ sheetKey, status: 'needs_confirmation', code: issue.code, message: issue.message });
          blockers.push(`${sheetKey}: ${issue.message}`);
        } else {
          decisions.push({ sheetKey, status: 'invalid', code: 'V2_CONTRACT_INVALID', message: v2Error?.message || 'schema migration V2 preflight 失败。' });
          blockers.push(`${sheetKey}: ${v2Error?.message || 'schema migration V2 preflight 失败。'}`);
        }
      }
    }
  }
  if (blockers.length > 0) return { changedSheetKeys, blockers, issues, operations: [], decisions, applyModes };

  // 先严格校验完整 candidate，再决定 migration/rebase，避免用“无法规划”掩盖真实 SQLite 错误。
  try {
    await hydrateTableDataStrict_ACU(input.candidateData);
  } catch (error: any) {
    // 完整 candidate hydrate 失败需区分环境类与语义类：
    // 环境类（引擎起不来）→ 独立 code，不得伪装成「candidate schema 不支持」；
    // 语义类（DDL/数据非法）→ 既有 CANDIDATE_SQLITE_HYDRATE_FAILED。
    if (error instanceof SqliteRuntimeUnavailableError_ACU) {
      throw error;
    }
    return { changedSheetKeys, operations: [], issues: [], blockers: [`完整 candidate SQLite hydrate 失败: ${error?.message || String(error)}`], decisions: decisions.map(decision => ({ ...decision, status: 'invalid', code: 'CANDIDATE_SQLITE_HYDRATE_FAILED', message: error?.message || String(error) })) };
  }

  try {
    let appliedState = input.baselineData;
    for (const operation of operations) {
      appliedState = await applySheetSchemaMigrationOperation_ACU(appliedState, operation);
    }
    for (const sheetKey of changedSheetKeys) {
      if (applyModes[sheetKey] !== 'migration') continue;
      const applied = appliedState[sheetKey] as Sheet_ACU | undefined;
      const candidate = input.candidateData[sheetKey] as Sheet_ACU | undefined;
      const appliedProjection = applied ? JSON.stringify({
        uid: applied.uid, content: applied.content, ddl: applied.sourceData?.ddl || '',
      }) : '';
      const candidateProjection = candidate ? JSON.stringify({
        uid: candidate.uid, content: candidate.content, ddl: candidate.sourceData?.ddl || '',
      }) : '';
      if (appliedProjection !== candidateProjection) {
        throw new Error(`${sheetKey}: migration operation 应用结果与 candidate 不一致。`);
      }
    }
  } catch (error: any) {
    return { changedSheetKeys, operations: [], issues: [], blockers: [error?.message || String(error)], decisions: decisions.map(decision => ({ ...decision, status: 'invalid', code: 'OPERATION_CANDIDATE_MISMATCH', message: error?.message || String(error) })) };
  }
  return { changedSheetKeys, blockers: [], issues: [], operations, decisions, applyModes };
}
