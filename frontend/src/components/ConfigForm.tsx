import { useState, useEffect } from 'react';
import { createConfig, updateConfig } from '../api/client';
import type { SyncConfigWithState } from '../api/client';
import './ConfigForm.css';

interface ConfigFormProps {
  onSaved: () => void;
  onCancel: () => void;
  /** When set, form is in edit mode (PATCH). */
  editConfig?: SyncConfigWithState | null;
}

export function ConfigForm({ onSaved, onCancel, editConfig }: ConfigFormProps) {
  const isEdit = Boolean(editConfig?.id);
  const [name, setName] = useState(editConfig?.name ?? '');
  const [spreadsheetId, setSpreadsheetId] = useState(editConfig?.spreadsheetId ?? '');
  const [sheetName, setSheetName] = useState(editConfig?.sheetName ?? 'Sheet1');
  const [range, setRange] = useState(editConfig?.range ?? 'A1:E100');
  const [tableName, setTableName] = useState(editConfig?.tableName ?? '');
  const [idColumn, setIdColumn] = useState(editConfig?.idColumn ?? 'id');
  const [active, setActive] = useState(editConfig?.active ?? true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editConfig) {
      setName(editConfig.name);
      setSpreadsheetId(editConfig.spreadsheetId);
      setSheetName(editConfig.sheetName ?? 'Sheet1');
      setRange(editConfig.range ?? 'A1:E100');
      setTableName(editConfig.tableName);
      setIdColumn(editConfig.idColumn ?? 'id');
      setActive(editConfig.active ?? true);
    }
  }, [editConfig]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!isEdit && (!spreadsheetId.trim() || !range.trim() || !tableName.trim())) {
      setError('Spreadsheet ID, Range, and Table name are required.');
      return;
    }
    setSaving(true);
    try {
      if (isEdit && editConfig) {
        await updateConfig(editConfig.id, {
          name: name.trim(),
          active,
          range: range.trim(),
          sheetName: sheetName.trim() || 'Sheet1',
          idColumn: idColumn.trim() || 'id',
        });
      } else {
        await createConfig({
          name: name.trim(),
          spreadsheetId: spreadsheetId.trim(),
          sheetName: sheetName.trim() || 'Sheet1',
          range: range.trim(),
          tableName: tableName.trim(),
          idColumn: idColumn.trim() || 'id',
        });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="config-form-wrap">
      <h2>{isEdit ? 'Edit connection' : 'New sync connection'}</h2>
      <form className="config-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}
        <label>
          Connection name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sales data"
          />
        </label>
        <label>
          Google Spreadsheet ID or URL
          <input
            type="text"
            value={spreadsheetId}
            onChange={(e) => setSpreadsheetId(e.target.value)}
            placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms or full URL"
            readOnly={isEdit}
            className={isEdit ? 'readonly' : ''}
          />
        </label>
        <label>
          Sheet name
          <input
            type="text"
            value={sheetName}
            onChange={(e) => setSheetName(e.target.value)}
            placeholder="Sheet1"
          />
        </label>
        <label>
          Range (A1 notation)
          <input
            type="text"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            placeholder="A1:E100"
          />
        </label>
        <label>
          MySQL table name
          <input
            type="text"
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="sales_data"
            readOnly={isEdit}
            className={isEdit ? 'readonly' : ''}
          />
        </label>
        <label>
          ID column (unique row identifier)
          <input
            type="text"
            value={idColumn}
            onChange={(e) => setIdColumn(e.target.value)}
            placeholder="id"
          />
        </label>
        {isEdit && (
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <span>Active (sync runs on schedule)</span>
          </label>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? (isEdit ? 'Saving…' : 'Creating…') : isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
