import { currentJsonTableData_ACU } from './state-manager';
import { getNameMapper } from './template-vars/name-mapper';
import { resolveReadQuerySql_ACU, type ReadQueryResolveResult_ACU } from '../../shared/sql-read-resolver';
import type { TableDataObject_ACU } from '../../shared/models/table-data';

/**
 * Resolves user-facing read SQL against the published runtime schema.
 *
 * ITableStorageProvider#getCurrentData() is intentionally not called here: the
 * SQLite implementation exports the engine and writes currentJsonTableData_ACU
 * as a side effect. Calling it from a read resolver would both mutate global
 * state and erase the very mismatch this boundary is meant to diagnose. Runtime
 * publication validates schema before marking the provider ready, so the
 * published snapshot is the only side-effect-free canonical source available to
 * synchronous read callers.
 */
export function resolveCurrentRuntimeReadSql_ACU(sql: string): ReadQueryResolveResult_ACU {
  const mapper = getNameMapper();
  return resolveReadQuerySql_ACU(sql, currentJsonTableData_ACU as TableDataObject_ACU | null, mapper.translateSql.bind(mapper));
}
