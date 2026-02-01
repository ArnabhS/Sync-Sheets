import { useState, useEffect, useCallback } from 'react';
import { getConfig, getSheetPreview, getDbPreview, triggerSync } from '../api/client';
import type { SyncConfigWithState } from '../api/client';
import './LiveTestView.css';

interface SyncEventPayload {
  configId?: string;
  direction?: string;
  rowsAffected?: number;
  at?: string;
}

interface LiveTestViewProps {
  configId: string;
  lastSyncMessage?: SyncEventPayload | null;
  onBack: () => void;
}

export function LiveTestView({ configId, lastSyncMessage, onBack }: LiveTestViewProps) {
  const [config, setConfig] = useState<SyncConfigWithState | null>(null);
  const [sheetData, setSheetData] = useState<{ headers: string[]; rows: Record<string, unknown>[] } | null>(null);
  const [dbData, setDbData] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'sheet' | 'db'>('sheet');

  const load = useCallback(async () => {
    setError('');
    try {
      const [configRes, sheetRes, dbRes] = await Promise.all([
        getConfig(configId),
        getSheetPreview(configId).catch(() => ({ headers: [], rows: [] })),
        getDbPreview(configId).catch(() => ({ columns: [], rows: [] })),
      ]);
      setConfig(configRes.config);
      setSheetData({ headers: sheetRes.headers, rows: sheetRes.rows });
      setDbData({ columns: dbRes.columns, rows: dbRes.rows });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [configId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (lastSyncMessage?.configId === configId) load();
  }, [lastSyncMessage, configId, load]);

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    try {
      await triggerSync(configId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="live-test">
        <div className="live-test-header">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
            ← Back
          </button>
        </div>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const sheetHeaders = sheetData?.headers ?? [];
  const sheetRows = sheetData?.rows ?? [];
  const dbColumns = dbData?.columns ?? [];
  const dbRows = dbData?.rows ?? [];

  return (
    <div className="live-test">
      <div className="live-test-header">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          ← Back
        </button>
        <h2>{config.name}</h2>
        <div className="live-test-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={load}
            disabled={loading}
          >
            Refresh data
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? 'Syncing…' : 'Run sync now'}
          </button>
        </div>
      </div>

      {config.state?.lastError && (
        <div className="live-test-error">{config.state.lastError}</div>
      )}
      {error && <div className="live-test-error">{error}</div>}
      {config.state?.lastSyncAt && !config.state?.lastError && (
        <p className="live-test-meta">
          Last sync: {new Date(config.state.lastSyncAt).toLocaleString()}
        </p>
      )}

      <div className="tabs">
        <button
          type="button"
          className={`tab ${activeTab === 'sheet' ? 'active' : ''}`}
          onClick={() => setActiveTab('sheet')}
        >
          Google Sheet
        </button>
        <button
          type="button"
          className={`tab ${activeTab === 'db' ? 'active' : ''}`}
          onClick={() => setActiveTab('db')}
        >
          MySQL
        </button>
      </div>

      <div className="data-panel">
        {activeTab === 'sheet' && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {sheetHeaders.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheetRows.map((row, i) => (
                  <tr key={i}>
                    {sheetHeaders.map((h) => (
                      <td key={h}>{String(row[h] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {sheetRows.length === 0 && (
              <p className="empty-msg">No rows in sheet (or unable to read).</p>
            )}
          </div>
        )}
        {activeTab === 'db' && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {dbColumns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dbRows.map((row, i) => (
                  <tr key={i}>
                    {dbColumns.map((col) => (
                      <td key={col}>{String(row[col] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {dbRows.length === 0 && (
              <p className="empty-msg">No rows in table (or unable to read).</p>
            )}
          </div>
        )}
      </div>

      <p className="live-test-hint">
        Edit the Google Sheet or the MySQL table, then click &quot;Run sync now&quot; or wait for
        the automatic poll. Both sides will stay in sync.
      </p>
    </div>
  );
}
