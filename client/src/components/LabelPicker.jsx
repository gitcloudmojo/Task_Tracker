/**
 * Pick a task's label, or create a new one on the spot.
 *
 * Only ever rendered for somebody who holds `labels.manage` (Manager, Super
 * Admin) — callers check that before mounting this, the same way the rest of
 * the app never shows a control for a move the server would refuse.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const NEW = '__new__';

export default function LabelPicker({ value, onChange, disabled }) {
  const [labels, setLabels] = useState([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () => api.get('/labels').then((d) => setLabels(d.labels)).catch(() => {});
  // Not `useEffect(load, [])`: `load` returns a promise, and React insists an
  // effect return nothing or a clean-up function — a promise crashes the
  // component on mount.
  useEffect(() => {
    load();
  }, []);

  const pick = (e) => {
    const v = e.target.value;
    if (v === NEW) {
      setCreating(true);
      return;
    }
    onChange(v ? Number(v) : null);
  };

  const createLabel = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const { label } = await api.post('/labels', { name: trimmed });
      await load();
      onChange(label.id);
      setCreating(false);
      setName('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (creating) {
    return (
      <div className="row wrap" style={{ gap: 6 }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Website Relaunch"
          autoFocus
          disabled={busy}
          style={{ maxWidth: 220 }}
        />
        <button className="btn sm primary" disabled={busy || name.trim().length < 2} onClick={createLabel}>
          {busy ? 'Adding…' : 'Add label'}
        </button>
        <button
          className="btn sm ghost"
          disabled={busy}
          onClick={() => {
            setCreating(false);
            setName('');
            setError(null);
          }}
        >
          Cancel
        </button>
        {error && (
          <span className="small" style={{ color: 'var(--critical)' }}>
            {error.message}
          </span>
        )}
      </div>
    );
  }

  return (
    <select value={value || ''} onChange={pick} disabled={disabled} style={{ maxWidth: 220 }}>
      <option value="">— no label —</option>
      {labels.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
          {l.taskCount ? ` (${l.taskCount})` : ''}
        </option>
      ))}
      <option value={NEW}>+ New label…</option>
    </select>
  );
}
