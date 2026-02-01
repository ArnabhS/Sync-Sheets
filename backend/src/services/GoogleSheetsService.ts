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
 * Service for reading and writing Google Sheets using the Sheets API v4.
 * Uses Service Account credentials (server-side).
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
   * Build A1 range string. Sheet name is always single-quoted (required for API when name has underscore, spaces, etc.).
   * Single quotes inside the name are escaped by doubling.
   */
  private static buildRange(sheetName: string | undefined, rangeA1: string): string {
    if (!sheetName || !sheetName.trim()) return rangeA1;
    const name = sheetName.trim().replace(/'/g, "''");
    return `'${name}'!${rangeA1}`;
  }

  /**
   * Read range from sheet. First row is treated as headers.
   */
  async readRange(config: SyncConfig): Promise<SheetReadResult> {
    const sheets = await this.getClient();
    const spreadsheetId = GoogleSheetsService.parseSpreadsheetId(config.spreadsheetId);
    const range = GoogleSheetsService.buildRange(config.sheetName, config.range);

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });

    const rawValues = (res.data.values ?? []) as string[][];
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
   * Range is computed to match value dimensions so append works.
   */
  async writeRange(
    config: SyncConfig,
    headers: string[],
    rows: Record<string, unknown>[]
  ): Promise<void> {
    const sheets = await this.getClient();
    const spreadsheetId = GoogleSheetsService.parseSpreadsheetId(config.spreadsheetId);
    const numRows = 1 + rows.length;
    const numCols = headers.length;
    const endCol = GoogleSheetsService.columnLetter(numCols - 1);
    const rangeA1 = `A1:${endCol}${numRows}`;
    const range = GoogleSheetsService.buildRange(config.sheetName, rangeA1);

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
