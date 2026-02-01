import { createHash } from 'crypto';
import { SyncConfig, SyncState, DataRow, NormalizedRow } from '../types/sync';
import { GoogleSheetsService } from './GoogleSheetsService';
import { MysqlService } from './MysqlService';

const SYNC_METADATA_COLUMN = '_sync_updated_at';

export type SyncEvent = {
  configId: string;
  direction: 'sheet_to_db' | 'db_to_sheet' | 'both';
  rowsAffected: number;
  at: string;
  error?: string;
};

export interface SyncEngineDeps {
  sheets: GoogleSheetsService;
  mysql: MysqlService;
  getState: (configId: string) => SyncState | undefined;
  setState: (configId: string, state: Partial<SyncState>) => void;
  onEvent?: (event: SyncEvent) => void;
}

function sheetRowToNormalized(
  sheetRow: Record<string, unknown>,
  sheetHeaders: string[],
  config: SyncConfig,
  rowIndex: number
): NormalizedRow {
  const idCol = config.idColumn ?? 'id';
  const mapping = config.columnMapping;
  const data: DataRow = {};
  let id: string = String(rowIndex);

  sheetHeaders.forEach((header, colIndex) => {
    const dbCol = mapping[String(colIndex)] ?? mapping[header] ?? header;
    if (dbCol === '_row_index' || dbCol === 'row_index') return;
    const val = sheetRow[header];
    data[dbCol] = val === '' ? null : val;
    if (dbCol === idCol && val != null) id = String(val);
  });

  return { id, data };
}

function dbRowToNormalized(row: Record<string, unknown>, config: SyncConfig): NormalizedRow {
  const idCol = config.idColumn ?? 'id';
  const id = row[idCol] != null ? String(row[idCol]) : '';
  const data = { ...row };
  return { id, data, updatedAt: String(row[SYNC_METADATA_COLUMN] ?? '') };
}

function hashRows(rows: NormalizedRow[]): string {
  const str = JSON.stringify(rows.map((r) => ({ id: r.id, data: r.data })));
  return createHash('sha256').update(str).digest('hex');
}

/**
 * Two-way sync: (1) Apply sheet changes to DB; (2) Write full DB state to sheet.
 * Result: both sides match. Conflict: last-write-wins (sheet wins on sheet->db pass, then DB is written to sheet).
 */
export class SyncEngine {
  constructor(private deps: SyncEngineDeps) {}

  async runSync(config: SyncConfig): Promise<SyncEvent | null> {
    const state = this.deps.getState(config.id) ?? {
      configId: config.id,
      lastSheetHash: undefined,
      lastSheetFetchAt: undefined,
      lastDbPollAt: undefined,
      lastSyncDirection: null,
      lastSyncAt: undefined,
      lastError: undefined,
    };

    try {
      await this.deps.mysql.ensureSyncMetadataColumn(config);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      this.deps.setState(config.id, { ...state, lastError: err });
      this.deps.onEvent?.({
        configId: config.id,
        direction: 'sheet_to_db',
        rowsAffected: 0,
        at: new Date().toISOString(),
        error: err,
      });
      return null;
    }

    let sheetResult: Awaited<ReturnType<GoogleSheetsService['readRange']>>;
    let dbRows: Record<string, unknown>[];

    try {
      [sheetResult, dbRows] = await Promise.all([
        this.deps.sheets.readRange(config),
        this.deps.mysql.readTable(config),
      ]);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      this.deps.setState(config.id, { ...state, lastError: err });
      this.deps.onEvent?.({
        configId: config.id,
        direction: 'sheet_to_db',
        rowsAffected: 0,
        at: new Date().toISOString(),
        error: err,
      });
      return null;
    }

    const now = new Date().toISOString();
    this.deps.setState(config.id, {
      ...state,
      lastSheetFetchAt: now,
      lastDbPollAt: now,
      lastError: undefined,
    });

    const sheetHeaders = sheetResult.headers;
    const sheetNormalized: NormalizedRow[] = sheetResult.rows.map((row, i) =>
      sheetRowToNormalized(row, sheetHeaders, config, i + 1)
    );
    const sheetHash = hashRows(sheetNormalized);
    const dbNormalized: NormalizedRow[] = dbRows.map((r) => dbRowToNormalized(r, config));
    const dbById = new Map(dbNormalized.map((r) => [r.id, r]));

    // Only write columns that exist in the MySQL table (avoids "Unknown column 'X'" when sheet headers differ)
    const tableColumns = await this.deps.mysql.getTableColumns(config);
    const validColumns = new Set(tableColumns.filter((c) => c !== SYNC_METADATA_COLUMN));

    let sheetToDbCount = 0;
    for (const row of sheetNormalized) {
      if (!row.id) continue;
      const dataOnly: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row.data)) {
        if (k !== SYNC_METADATA_COLUMN && validColumns.has(k)) dataOnly[k] = v;
      }
      const existing = dbById.get(row.id);
      const same =
        existing &&
        Object.keys(dataOnly).every(
          (k) => String(existing.data[k] ?? '') === String(dataOnly[k] ?? '')
        );
      if (!same) {
        await this.deps.mysql.upsertRow(config, row.id, dataOnly);
        sheetToDbCount++;
      }
    }

    if (sheetToDbCount > 0) {
      dbRows = await this.deps.mysql.readTable(config);
      dbNormalized.length = 0;
      dbRows.forEach((r) => dbNormalized.push(dbRowToNormalized(r, config)));
    }

    const idCol = config.idColumn ?? 'id';
    const columns = await this.deps.mysql.getTableColumns(config);
    const headers = columns.filter((c) => c !== SYNC_METADATA_COLUMN);
    const rowsToWrite = dbRows.map((r) => {
      const row: Record<string, unknown> = {};
      headers.forEach((h) => (row[h] = r[h]));
      return row;
    });

    await this.deps.sheets.clearAndWrite(config, headers, rowsToWrite);

    const rowsAffected = sheetToDbCount + (rowsToWrite.length > 0 ? 1 : 0);
    this.deps.setState(config.id, {
      ...state,
      lastSheetHash: hashRows(dbNormalized),
      lastSyncDirection: 'both',
      lastSyncAt: now,
    });

    if (rowsAffected > 0 || sheetToDbCount > 0) {
      this.deps.onEvent?.({
        configId: config.id,
        direction: sheetToDbCount > 0 ? 'both' : 'db_to_sheet',
        rowsAffected: sheetToDbCount + rowsToWrite.length,
        at: now,
      });
    }

    return {
      configId: config.id,
      direction: sheetToDbCount > 0 ? 'both' : 'db_to_sheet',
      rowsAffected: sheetToDbCount + rowsToWrite.length,
      at: now,
    };
  }
}
