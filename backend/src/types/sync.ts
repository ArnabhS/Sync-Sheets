/**
 * Sync configuration: maps a Google Sheet range to a MySQL table.
 * Column mapping: sheet column index (0-based) -> MySQL column name.
 */
export interface SyncConfig {
  id: string;
  name: string;
  spreadsheetId: string;
  sheetName: string;
  /** A1 notation range (e.g. "A1:E100"). First row = header. */
  range: string;
  /** MySQL connection override (optional; uses default env if not set) */
  mysql?: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  /** MySQL table name */
  tableName: string;
  /**
   * Column mapping: key = sheet column index (0-based), value = MySQL column name.
   * Special: index -1 or "row_index" can map to a synthetic row number for identity.
   */
  columnMapping: Record<string, string>;
  /**
   * Name of the column used as unique row identity in MySQL (e.g. "id").
   * If not set, we use row index (1-based, after header) as identity.
   */
  idColumn?: string;
  /** Whether sync is active */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SyncState {
  configId: string;
  /** Last known sheet content hash (for change detection) */
  lastSheetHash?: string;
  /** Last sheet fetch timestamp (ISO) */
  lastSheetFetchAt?: string;
  /** Last DB poll timestamp (ISO) */
  lastDbPollAt?: string;
  /** Last successful sync direction */
  lastSyncDirection?: 'sheet_to_db' | 'db_to_sheet' | 'both' | null;
  lastSyncAt?: string;
  lastError?: string;
}

/** One row of data: keys = column names (sheet header or DB column) */
export type DataRow = Record<string, unknown>;

/** Normalized row with a stable identity for comparison */
export interface NormalizedRow {
  /** Stable id: from idColumn value or row index */
  id: string;
  data: DataRow;
  /** For conflict resolution */
  updatedAt?: string;
}
