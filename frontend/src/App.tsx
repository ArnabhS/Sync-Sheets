import { useState, useEffect, useCallback } from 'react';
import { listConfigs, type SyncConfigWithState } from './api/client';
import { useWebSocket } from './hooks/useWebSocket';
import { Dashboard } from './components/Dashboard';
import { ConfigForm } from './components/ConfigForm';
import { LiveTestView, type SyncEventPayload } from './components/LiveTestView';
import './App.css';

type View = 'list' | 'create' | 'edit' | 'test';

function App() {
  const [configs, setConfigs] = useState<SyncConfigWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<SyncConfigWithState | null>(null);

  const { lastMessage, connected } = useWebSocket('/ws');

  const refresh = useCallback(async () => {
    try {
      const { configs: data } = await listConfigs();
      setConfigs(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (lastMessage?.type === 'sync') refresh();
  }, [lastMessage, refresh]);

  const openTest = (id: string) => {
    setSelectedId(id);
    setView('test');
  };

  const openEdit = (config: SyncConfigWithState) => {
    setEditConfig(config);
    setView('edit');
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Sheets ↔ MySQL Sync</h1>
        <div className="header-meta">
          <span className={`ws-indicator ${connected ? 'connected' : ''}`}>
            {connected ? '● Live' : '○ Disconnected'}
          </span>
        </div>
      </header>

      <main className="app-main">
        {view === 'list' && (
          <Dashboard
            configs={configs}
            loading={loading}
            onRefresh={refresh}
            onCreate={() => setView('create')}
            onEdit={openEdit}
            onTest={openTest}
            onDelete={async (id) => {
              await refresh();
              if (selectedId === id) setView('list');
              if (editConfig?.id === id) setEditConfig(null);
            }}
          />
        )}
        {view === 'create' && (
          <ConfigForm
            onSaved={() => {
              refresh();
              setView('list');
            }}
            onCancel={() => setView('list')}
          />
        )}
        {view === 'edit' && editConfig && (
          <ConfigForm
            editConfig={editConfig}
            onSaved={() => {
              refresh();
              setEditConfig(null);
              setView('list');
            }}
            onCancel={() => {
              setEditConfig(null);
              setView('list');
            }}
          />
        )}
        {view === 'test' && selectedId && (
          <LiveTestView
            configId={selectedId}
            lastSyncMessage={lastMessage?.type === 'sync' ? (lastMessage.payload as SyncEventPayload) : null}
            onBack={() => {
              setSelectedId(null);
              setView('list');
            }}
          />
        )}
      </main>
    </div>
  );
}

export default App;
