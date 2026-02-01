import mysql, { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { SyncConfig } from '../types/sync';
import type { MysqlServiceConfig } from '../services/MysqlService';

const TABLE = 'sync_configs';

/** Convert ISO date string to MySQL datetime (YYYY-MM-DD HH:MM:SS.fff). */
function toMysqlDatetime(iso: string | undefined): string {
  if (!iso) return new Date().toISOString().replace('T', ' ').replace('Z', '');
  return iso.replace('T', ' ').replace('Z', '');
}

const POOL_OPTS = {
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
} as const;

/**
 * Persists sync configs to MySQL so they survive server restarts.
 * Uses the same MYSQL_URL / env as the rest of the app.
 */
export class ConfigRepository {
  private pool: Pool;

  constructor(mysqlConfig: MysqlServiceConfig) {
    if (mysqlConfig.url) {
      this.pool = mysql.createPool({
        uri: mysqlConfig.url,
        ssl: mysqlConfig.ssl ? { rejectUnauthorized: false } : undefined,
        ...POOL_OPTS,
      });
    } else {
      this.pool = mysql.createPool({
        host: mysqlConfig.host,
        port: mysqlConfig.port,
        user: mysqlConfig.user,
        password: mysqlConfig.password,
        database: mysqlConfig.database,
        ...POOL_OPTS,
      });
    }
  }

  async ensureTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        spreadsheet_id VARCHAR(512) NOT NULL,
        sheet_name VARCHAR(255) NOT NULL DEFAULT 'Sheet1',
        \`range\` VARCHAR(100) NOT NULL DEFAULT 'A1:E100',
        table_name VARCHAR(255) NOT NULL,
        id_column VARCHAR(100) NOT NULL DEFAULT 'id',
        column_mapping JSON,
        mysql_override JSON,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
      )
    `);
  }

  async findAll(): Promise<SyncConfig[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT * FROM ?? ORDER BY created_at DESC`, [TABLE]);
    return rows.map((r) => this.rowToConfig(r));
  }

  async findById(id: string): Promise<SyncConfig | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT * FROM ?? WHERE id = ? LIMIT 1`, [TABLE, id]);
    if (rows.length === 0) return null;
    return this.rowToConfig(rows[0]);
  }

  async save(config: SyncConfig): Promise<void> {
    const mysqlOverride = config.mysql ? JSON.stringify(config.mysql) : null;
    const columnMapping = config.columnMapping && Object.keys(config.columnMapping).length > 0
      ? JSON.stringify(config.columnMapping)
      : null;
    await this.pool.query(
      `INSERT INTO ?? (id, name, spreadsheet_id, sheet_name, \`range\`, table_name, id_column, column_mapping, mysql_override, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         spreadsheet_id = VALUES(spreadsheet_id),
         sheet_name = VALUES(sheet_name),
         \`range\` = VALUES(\`range\`),
         table_name = VALUES(table_name),
         id_column = VALUES(id_column),
         column_mapping = VALUES(column_mapping),
         mysql_override = VALUES(mysql_override),
         active = VALUES(active),
         updated_at = VALUES(updated_at)`,
      [
        TABLE,
        config.id,
        config.name,
        config.spreadsheetId,
        config.sheetName ?? 'Sheet1',
        config.range ?? 'A1:E100',
        config.tableName,
        config.idColumn ?? 'id',
        columnMapping,
        mysqlOverride,
        config.active ? 1 : 0,
        toMysqlDatetime(config.createdAt),
        toMysqlDatetime(config.updatedAt),
      ]
    );
  }

  async delete(id: string): Promise<boolean> {
    const [result] = await this.pool.query<ResultSetHeader>(`DELETE FROM ?? WHERE id = ?`, [TABLE, id]);
    return (result as ResultSetHeader).affectedRows > 0;
  }

  private rowToConfig(r: RowDataPacket): SyncConfig {
    let mysqlOverride: SyncConfig['mysql'];
    try {
      if (r.mysql_override != null) mysqlOverride = typeof r.mysql_override === 'string' ? JSON.parse(r.mysql_override) : r.mysql_override;
    } catch {
      // ignore
    }
    let columnMapping: Record<string, string> = {};
    try {
      if (r.column_mapping != null) columnMapping = typeof r.column_mapping === 'string' ? JSON.parse(r.column_mapping) : r.column_mapping;
    } catch {
      // ignore
    }
    return {
      id: r.id,
      name: r.name,
      spreadsheetId: r.spreadsheet_id,
      sheetName: r.sheet_name ?? 'Sheet1',
      range: r.range ?? 'A1:E100',
      tableName: r.table_name,
      idColumn: r.id_column ?? 'id',
      columnMapping: columnMapping ?? {},
      mysql: mysqlOverride,
      active: Boolean(r.active),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
