import mysql, { Pool, PoolOptions, RowDataPacket } from 'mysql2/promise';
import { SyncConfig } from '../types/sync';

const SYNC_METADATA_COLUMN = '_sync_updated_at';

export interface MysqlConnectionOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Config for default connection: URL (cloud) or host/port/user/password/database */
export interface MysqlServiceConfig extends MysqlConnectionOptions {
  /** Cloud SQL connection URL (PlanetScale, Railway, Aiven, etc.). Takes precedence. */
  url?: string | null;
  /** Enable SSL when using MYSQL_URL (set true for most cloud providers). */
  ssl?: boolean;
}

const POOL_OPTS = {
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
} as const;

/** Cloud DBs (e.g. Railway) close idle connections; retry once on these errors. */
function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = err && typeof (err as NodeJS.ErrnoException).code === 'string' ? (err as NodeJS.ErrnoException).code : '';
  return (
    /Connection lost|closed the connection|ECONNRESET|PROTOCOL_CONNECTION_LOST|ETIMEDOUT/i.test(msg) ||
    code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'PROTOCOL_CONNECTION_LOST'
  );
}

/**
 * MySQL service: connect, read table, write rows.
 * Supports MYSQL_URL (cloud) or MYSQL_HOST/PORT/USER/PASSWORD/DATABASE.
 * Injects _sync_updated_at for change detection when not present.
 */
export class MysqlService {
  private defaultPool: Pool | null = null;
  private poolByKey = new Map<string, Pool>();
  private defaultOptions: MysqlConnectionOptions;

  constructor(defaultOptions: MysqlServiceConfig) {
    this.defaultOptions = {
      host: defaultOptions.host,
      port: defaultOptions.port,
      user: defaultOptions.user,
      password: defaultOptions.password,
      database: defaultOptions.database,
    };
    if (defaultOptions.url) {
      this.defaultPool = mysql.createPool({
        uri: defaultOptions.url,
        ssl: defaultOptions.ssl ? { rejectUnauthorized: false } : undefined,
        ...POOL_OPTS,
      });
    }
  }

  private getPoolOptions(opts?: MysqlConnectionOptions): PoolOptions {
    const o = opts ?? this.defaultOptions;
    return {
      host: o.host,
      port: o.port,
      user: o.user,
      password: o.password,
      database: o.database,
      ...POOL_OPTS,
    };
  }

  private poolFor(config: SyncConfig): Pool {
    if (!config.mysql) {
      if (!this.defaultPool) {
        this.defaultPool = mysql.createPool(this.getPoolOptions());
      }
      return this.defaultPool;
    }
    const key = `${config.mysql.host}:${config.mysql.port}:${config.mysql.database}`;
    if (!this.poolByKey.has(key)) {
      this.poolByKey.set(key, mysql.createPool(this.getPoolOptions(config.mysql)));
    }
    return this.poolByKey.get(key)!;
  }

  /** Retry once on connection-lost errors (cloud DBs close idle connections). */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isConnectionError(e)) {
        return await fn();
      }
      throw e;
    }
  }

  /**
   * Ensure table exists and has _sync_updated_at column for change detection.
   */
  async ensureSyncMetadataColumn(config: SyncConfig): Promise<void> {
    return this.withRetry(async () => {
      const pool = this.poolFor(config);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [config.mysql?.database ?? this.defaultOptions.database, config.tableName, SYNC_METADATA_COLUMN]
      );
      if (rows.length > 0) return;

      await pool.query(
        `ALTER TABLE ?? ADD COLUMN ?? DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`,
        [config.tableName, SYNC_METADATA_COLUMN]
      );
    });
  }

  /**
   * Get column names for the table (excluding _sync_updated_at from display if needed).
   */
  async getTableColumns(config: SyncConfig): Promise<string[]> {
    return this.withRetry(async () => {
      const pool = this.poolFor(config);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [config.mysql?.database ?? this.defaultOptions.database, config.tableName]
      );
      return rows.map((r) => r.COLUMN_NAME);
    });
  }

  /**
   * Read all rows from the table. Includes _sync_updated_at for change detection.
   */
  async readTable(config: SyncConfig): Promise<Record<string, unknown>[]> {
    return this.withRetry(async () => {
      const pool = this.poolFor(config);
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM ??`, [config.tableName]);
      return rows.map((r) => ({ ...r } as Record<string, unknown>));
    });
  }

  /**
   * Insert a row. Sets _sync_updated_at.
   */
  async insertRow(
    config: SyncConfig,
    row: Record<string, unknown>
  ): Promise<void> {
    const pool = this.poolFor(config);
    const data: Record<string, unknown> = { ...row, [SYNC_METADATA_COLUMN]: new Date() };
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    const cols = keys.map((k) => `\`${k}\``).join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    await pool.query(
      `INSERT INTO ?? (${cols}) VALUES (${placeholders})`,
      [config.tableName, ...keys.map((k) => data[k])]
    );
  }

  /**
   * Update a row by id column. Sets _sync_updated_at.
   */
  async updateRow(
    config: SyncConfig,
    idValue: string | number,
    row: Record<string, unknown>
  ): Promise<void> {
    const pool = this.poolFor(config);
    const idCol = config.idColumn ?? 'id';
    const data: Record<string, unknown> = { ...row, [SYNC_METADATA_COLUMN]: new Date() };
    const keys = Object.keys(data).filter((k) => k !== idCol);
    const setClause = keys.map((k) => `\`${k}\` = ?`).join(', ');
    await pool.query(
      `UPDATE ?? SET ${setClause} WHERE ?? = ?`,
      [config.tableName, ...keys.map((k) => data[k]), idCol, idValue]
    );
  }

  /**
   * Delete row by id column.
   */
  async deleteRow(config: SyncConfig, idValue: string | number): Promise<void> {
    const pool = this.poolFor(config);
    const idCol = config.idColumn ?? 'id';
    await pool.query(`DELETE FROM ?? WHERE ?? = ?`, [config.tableName, idCol, idValue]);
  }

  /**
   * Upsert: insert or update by id. Used for syncing sheet -> DB.
   */
  async upsertRow(
    config: SyncConfig,
    idValue: string | number,
    row: Record<string, unknown>
  ): Promise<void> {
    const pool = this.poolFor(config);
    const idCol = config.idColumn ?? 'id';
    const existing = await pool.query<RowDataPacket[]>(
      `SELECT 1 FROM ?? WHERE ?? = ? LIMIT 1`,
      [config.tableName, idCol, idValue]
    );
    if (Array.isArray(existing[0]) && (existing[0] as RowDataPacket[]).length > 0) {
      await this.updateRow(config, idValue, row);
    } else {
      await this.insertRow(config, { ...row, [idCol]: idValue });
    }
  }

  async close(): Promise<void> {
    if (this.defaultPool) await this.defaultPool.end();
    for (const p of this.poolByKey.values()) await p.end();
    this.defaultPool = null;
    this.poolByKey.clear();
  }
}
