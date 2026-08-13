/**
 * sql.js TypeScript 类型声明
 * 基于 sql.js v1.14.x（asm.js 版本）
 * @see https://sql.js.org/documentation/
 */

/** sql.js 初始化配置 */
interface SqlJsInitConfig {
  /** 自定义 wasm/asm 文件定位函数（asm 版本不需要） */
  locateFile?: (filename: string) => string;
  /** 内联 wasm 二进制（base64 解码后传入；emscripten 优先使用，避免外部 fetch） */
  wasmBinary?: Uint8Array;
}

/** sql.js 静态工厂对象 */
interface SqlJsStatic {
  /** 创建新的内存数据库（空数据库或从已有数据恢复） */
  Database: new (data?: ArrayLike<number> | Buffer | null) => SqlJsDatabase;
}

/** SQL 查询结果 */
interface SqlJsQueryExecResult {
  /** 列名数组 */
  columns: string[];
  /** 结果行（每行是一个值数组） */
  values: SqlJsValueType[][];
}

/** SQL 列信息（PRAGMA table_info 返回的结构） */
interface SqlJsColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: SqlJsValueType;
  pk: number;
}

/** sql.js 支持的值类型 */
type SqlJsValueType = string | number | Uint8Array | null;

/** sql.js 参数绑定类型 */
type SqlJsBindParams = SqlJsValueType[] | Record<string, SqlJsValueType>;

/** sql.js Database 实例 */
interface SqlJsDatabase {
  /**
   * 执行一条或多条 SQL 语句，返回结果集
   * 适用于 SELECT 查询
   * @param sql SQL 语句（可包含多条，用分号分隔）
   * @param params 参数绑定（可选）
   * @returns 每条 SELECT 语句的结果集数组
   */
  exec(sql: string, params?: SqlJsBindParams): SqlJsQueryExecResult[];

  /**
   * 执行单条 SQL 语句，不返回结果
   * 适用于 INSERT/UPDATE/DELETE/CREATE TABLE 等
   * @param sql SQL 语句
   * @param params 参数绑定（可选）
   * @returns Database 实例（支持链式调用）
   */
  run(sql: string, params?: SqlJsBindParams): SqlJsDatabase;

  /**
   * 创建预编译语句
   * @param sql SQL 语句
   * @returns Statement 实例
   */
  prepare(sql: string): SqlJsStatement;

  /**
   * 迭代执行 SQL 语句（逐条执行回调）
   * @param sql 包含多条 SQL 的字符串
   * @param callback 每条语句执行后的回调
   */
  each(sql: string, callback: (row: Record<string, SqlJsValueType>) => void, done?: () => void): SqlJsDatabase;
  each(sql: string, params: SqlJsBindParams, callback: (row: Record<string, SqlJsValueType>) => void, done?: () => void): SqlJsDatabase;

  /**
   * 获取最近一次 INSERT/UPDATE/DELETE 影响的行数
   */
  getRowsModified(): number;

  /**
   * 将整个数据库导出为二进制数据
   * @returns Uint8Array 格式的 SQLite 数据库文件
   */
  export(): Uint8Array;

  /**
   * 关闭数据库，释放内存
   * 关闭后不能再使用此实例
   */
  close(): void;

  /**
   * 注册自定义 SQL 函数
   * @param name 函数名
   * @param func 函数实现
   */
  create_function(name: string, func: (...args: SqlJsValueType[]) => SqlJsValueType): void;
}

/** sql.js 预编译语句 */
interface SqlJsStatement {
  /**
   * 绑定参数
   * @param params 参数值
   * @returns 是否绑定成功
   */
  bind(params?: SqlJsBindParams): boolean;

  /**
   * 执行语句并移动到下一行结果
   * @returns 是否还有更多行
   */
  step(): boolean;

  /**
   * 获取当前行的值（数组形式）
   */
  get(params?: SqlJsBindParams): SqlJsValueType[];

  /**
   * 获取当前行的值（对象形式）
   */
  getAsObject(params?: SqlJsBindParams): Record<string, SqlJsValueType>;

  /**
   * 获取结果集的列名
   */
  getColumnNames(): string[];

  /**
   * 执行语句（不返回结果，用于 INSERT/UPDATE/DELETE）
   * @param params 参数绑定
   */
  run(params?: SqlJsBindParams): void;

  /**
   * 重置语句（可重新绑定参数执行）
   */
  reset(): void;

  /**
   * 释放语句资源
   */
  free(): boolean;

  /**
   * 释放语句资源（free 的别名）
   */
  freemem(): void;
}

/**
 * sql.js 初始化函数
 * asm 版本通过 UMD 导出为全局 initSqlJs
 * @param config 初始化配置（asm 版本可不传）
 * @returns Promise<SqlJsStatic>
 */
declare function initSqlJs(config?: SqlJsInitConfig): Promise<SqlJsStatic>;

/**
 * 模块声明：支持 import initSqlJs from 'sql.js/dist/sql-asm-memory-growth.js'
 */
declare module 'sql.js/dist/sql-asm-memory-growth.js' {
  export default initSqlJs;
}

declare module 'sql.js/dist/sql-asm.js' {
  export default initSqlJs;
}

declare module 'sql.js' {
  export default initSqlJs;
}
