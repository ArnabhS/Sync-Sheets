const BASE =
  (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '') + '/api';

export interface SyncConfigWithState {
  id: string;
  name: string;
  spreadsheetId: string;
  sheetName: string;
  range: string;
  tableName: string;
  idColumn?: string;
  columnMapping: Record<string, string>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  state?: {
    configId: string;
    lastSheetHash?: string;
    lastSheetFetchAt?: string;
    lastDbPollAt?: string;
    lastSyncDirection?: string | null;
    lastSyncAt?: string;
    lastError?: string;
  };
}

export async function listConfigs(): Promise<{ configs: SyncConfigWithState[] }> {
  const r = await fetch(`${BASE}/sync/configs`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getConfig(id: string): Promise<{ config: SyncConfigWithState }> {
  const r = await fetch(`${BASE}/sync/configs/${id}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export interface CreateConfigBody {
  name: string;
  spreadsheetId: string;
  sheetName?: string;
  range: string;
  tableName: string;
  idColumn?: string;
  columnMapping?: Record<string, string>;
}

export async function createConfig(body: CreateConfigBody): Promise<{ config: SyncConfigWithState }> {
  const r = await fetch(`${BASE}/sync/configs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateConfig(
  id: string,
  body: Partial<{ name: string; active: boolean; range: string; sheetName: string; idColumn: string }>
): Promise<{ config: SyncConfigWithState }> {
  const r = await fetch(`${BASE}/sync/configs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function deleteConfig(id: string): Promise<void> {
  const r = await fetch(`${BASE}/sync/configs/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(await r.text());
}

export async function triggerSync(id: string): Promise<{ success: boolean; event?: unknown }> {
  const r = await fetch(`${BASE}/sync/configs/${id}/sync`, { method: 'POST' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getSheetPreview(id: string): Promise<{
  headers: string[];
  rows: Record<string, unknown>[];
  rawValues: string[][];
}> {
  const r = await fetch(`${BASE}/sync/configs/${id}/sheet-preview`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getDbPreview(id: string): Promise<{
  columns: string[];
  rows: Record<string, unknown>[];
}> {
  const r = await fetch(`${BASE}/configs/${id}/db-preview`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
