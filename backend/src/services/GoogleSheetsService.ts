import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { SyncConfig } from '../types/sync';

export interface SheetReadResult {
  headers: string[];
  rows: Record<string, unknown>[];
  rawValues: string[][];
}

/**
 * Service for reading and writing Google Sheets using the Sheets API 
 */
export class GoogleSheetsService {
  private auth: sheets_v4.Sheets | null = null;
  private credentialsPath: string;

  constructor(credentialsPath: string) {
    this.credentialsPath = path.resolve(credentialsPath);
  }

  private async getClient(): Promise<sheets_v4.Sheets> {
    if (this.auth) return this.auth;
    if (!fs.existsSync(this.credentialsPath)) {
      throw new Error(
        `Google credentials file not found at ${this.credentialsPath}. ` +
          'Set GOOGLE_APPLICATION_CREDENTIALS or add service-account.json.'
      );
    }
    const keyFile = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf-8'));
    const auth = new google.auth.GoogleAuth({
      credentials: keyFile,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    this.auth = sheets;
    return sheets;
  }

  /**
   * Extract spreadsheet ID from URL or raw ID.
   * Handles: "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit" or "SPREADSHEET_ID"
   */
  static parseSpreadsheetId(input: string): string {
    const match = input.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : input.trim();
  }

  /**
   * Build A1 range string. Sheet name is always single-quoted (API accepts this for all names including underscore).
   * Single quotes inside the name are escaped by doubling.
   */
  private static buildRange(sheetName: string | undefined, rangeA1: string): string {
    if (!sheetName || !sheetName.trim()) return rangeA1;
    const name = sheetName.trim().replace(/'/g, "''");
    return `'${name}'!${rangeA1}`;
  }

  /**
   * Fetch sheet titles from the spreadsheet (for error messages).
   */
  async getSheetTitles(spreadsheetId: string): Promise<string[]> {
    const sheets = await this.getClient();
    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title',
    });
    const titles = (res.data.sheets ?? []).map((s) => s.properties?.title ?? '').filter(Boolean);
    console.log('[Sheets API] getSheetTitles', { spreadsheetId, titles });
    return titles;
  }

  /**
   * Resolve requested sheet name to an actual sheet title from the spreadsheet.
   * - If only one sheet exists, use it (so any name like "sheet" or "sales_data" works).
   * - Else case-insensitive match against API titles.
   */
  private static resolveSheetTitle(requested: string, apiTitles: string[]): string | null {
    if (apiTitles.length === 0) return null;
    if (apiTitles.length === 1) return apiTitles[0];
    const lower = requested.trim().toLowerCase();
    const found = apiTitles.find((t) => t.toLowerCase() === lower);
    return found ?? null;
  }

  /**
   * Get the actual sheet title to use for this config (for read and write).
   * Fetches sheet titles from the API and resolves config.sheetName.
   */
  async getResolvedSheetName(config: SyncConfig): Promise<string> {
    const spreadsheetId = GoogleSheetsService.parseSpreadsheetId(config.spreadsheetId);
    const titles = await this.getSheetTitles(spreadsheetId);
    const requested = config.sheetName?.trim() || 'Sheet1';
    const resolved = GoogleSheetsService.resolveSheetTitle(requested, titles);
    return resolved ?? requested;
  }

  /**
   * Read range from sheet. First row is treated as headers.
   * If the requested sheet name fails (e.g. you put "sales_data" but the tab is "Sheet1"),
   * we fetch actual sheet titles and retry with the only sheet or a case-insensitive match.
   */
  async readRange(config: SyncConfig): Promise<SheetReadResult> {
    const sheets = await this.getClient();
    const spreadsheetId = GoogleSheetsService.parseSpreadsheetId(config.spreadsheetId);
    let sheetNameToUse = config.sheetName?.trim() || 'Sheet1';
    let range = GoogleSheetsService.buildRange(sheetNameToUse, config.range);

    console.log('[Sheets API] request', { spreadsheetId, range, sheetName: sheetNameToUse });

    let res;
    try {
      res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Unable to parse range/i.test(msg)) {
        const titles = await this.getSheetTitles(spreadsheetId);
        const resolved = GoogleSheetsService.resolveSheetTitle(sheetNameToUse, titles);
        if (resolved) {
          sheetNameToUse = resolved;
          range = GoogleSheetsService.buildRange(resolved, config.range);
          console.log('[Sheets API] resolved sheet name', { requested: config.sheetName, resolved });
          res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
            valueRenderOption: 'UNFORMATTED_VALUE',
            dateTimeRenderOption: 'SERIAL_NUMBER',
          });
        } else {
          const hint =
            titles.length > 0
              ? `Available sheet names: ${titles.map((t) => `"${t}"`).join(', ')}. Use one of these in "Sheet name".`
              : 'This spreadsheet has no sheets.';
          throw new Error(`Sheet name "${config.sheetName}" not found. ${hint}`);
        }
      } else {
        throw e;
      }
    }

    const rawValues = (res.data.values ?? []) as string[][];
    console.log('[Sheets API] response', {
      range: res.data.range ?? range,
      rowCount: rawValues.length,
      headers: rawValues[0],
      sampleRows: rawValues.slice(1, 4),
      ...(rawValues.length <= 20 ? { fullRawValues: rawValues } : {}),
    });

    if (rawValues.length === 0) {
      return { headers: [], rows: [], rawValues: [] };
    }

    const headers = rawValues[0].map((h) => String(h ?? '').trim() || `col_${rawValues[0].indexOf(h)}`);
    const rows: Record<string, unknown>[] = [];

    for (let i = 1; i < rawValues.length; i++) {
      const row: Record<string, unknown> = {};
      rawValues[i].forEach((cell, j) => {
        const key = headers[j] ?? `col_${j}`;
        row[key] = cell === '' || cell === undefined ? null : cell;
      });
      rows.push(row);
    }

    return { headers, rows, rawValues };
  }

  /** Column index to A1 letter (0 -> A, 25 -> Z, 26 -> AA) */
  private static columnLetter(index: number): string {
    let s = '';
    let n = index;
    do {
      s = String.fromCharCode((n % 26) + 65) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  }

  /**
   * Write rows to sheet. Replaces the data range (header + data).
   * Range is computed to match value dimensions. Uses resolved sheet name (same as read).
   */
  async writeRange(
    config: SyncConfig,
    headers: string[],
    rows: Record<string, unknown>[]
  ): Promise<void> {
    const sheets = await this.getClient();
    const spreadsheetId = GoogleSheetsService.parseSpreadsheetId(config.spreadsheetId);
    const sheetName = await this.getResolvedSheetName(config);
    const numRows = 1 + rows.length;
    const numCols = headers.length;
    const endCol = GoogleSheetsService.columnLetter(numCols - 1);
    const rangeA1 = `A1:${endCol}${numRows}`;
    const range = GoogleSheetsService.buildRange(sheetName, rangeA1);

    const values: unknown[][] = [headers];
    for (const row of rows) {
      values.push(headers.map((h) => row[h] ?? ''));
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  /**
   * Clear range and write new data (for full replace).
   */
  async clearAndWrite(
    config: SyncConfig,
    headers: string[],
    rows: Record<string, unknown>[]
  ): Promise<void> {
    await this.writeRange(config, headers, rows);
  }
}
