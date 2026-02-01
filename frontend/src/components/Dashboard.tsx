import { SyncConfigWithState } from '../api/client';
import { deleteConfig, updateConfig } from '../api/client';
import './Dashboard.css';

interface DashboardProps {
  configs: SyncConfigWithState[];
  loading: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onEdit: (config: SyncConfigWithState) => void;
  onTest: (id: string) => void;
  onDelete: (id: string) => void;
}

export function Dashboard({ configs, loading, onRefresh, onCreate, onEdit, onTest, onDelete }: DashboardProps) {
  const handleToggleActive = async (c: SyncConfigWithState) => {
    try {
      await updateConfig(c.id, { active: !c.active });
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete sync "${name}"?`)) return;
    try {
      await deleteConfig(id);
      onDelete(id);
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <p>Loading sync configs…</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-toolbar">
        <h2>Sync connections</h2>
        <div className="toolbar-actions">
          <button type="button" className="btn btn-secondary" onClick={onRefresh}>
            Refresh
          </button>
          <button type="button" className="btn btn-primary" onClick={onCreate}>
            New connection
          </button>
        </div>
      </div>

      {configs.length === 0 ? (
        <div className="dashboard-empty">
          <p>No sync connections yet.</p>
          <p className="muted">Create one to link a Google Sheet with a MySQL table.</p>
          <button type="button" className="btn btn-primary" onClick={onCreate}>
            Create connection
          </button>
        </div>
      ) : (
        <ul className="config-list">
          {configs.map((c) => (
            <li key={c.id} className="config-card">
              <div className="config-info">
                <span className="config-name">{c.name}</span>
                <span className="config-meta">
                  {c.sheetName} → {c.tableName}
                </span>
                {c.state?.lastError && (
                  <span className="config-error">{c.state.lastError}</span>
                )}
                {c.state?.lastSyncAt && !c.state?.lastError && (
                  <span className="config-sync-time">
                    Last sync: {new Date(c.state.lastSyncAt).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="config-actions">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={c.active}
                    onChange={() => handleToggleActive(c)}
                  />
                  <span>{c.active ? 'On' : 'Off'}</span>
                </label>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onEdit(c)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onTest(c.id)}
                >
                  Test
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleDelete(c.id, c.name)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
