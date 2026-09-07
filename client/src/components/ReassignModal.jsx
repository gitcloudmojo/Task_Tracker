/**
 * Hand a task to somebody else.
 *
 * Its own dialogue rather than a field on the edit form, because reassigning
 * is not like changing a date: two people's lists change, both of them get
 * told, and the history keeps a line saying who moved it, to whom, and when.
 * A reason is optional but asked for plainly — "why did this move?" is the
 * question somebody will have in a month.
 */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { Modal, Field, ErrorBanner } from './ui.jsx';

export default function ReassignModal({ task, people, onClose, onSaved }) {
  const [ownerId, setOwnerId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const others = people.filter((p) => p.isActive && p.id !== task.ownerId);
  const picked = others.find((p) => String(p.id) === String(ownerId));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/tasks/${task.id}`, {
        ownerId: Number(ownerId),
        reassignReason: reason.trim() || undefined,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Reassign this task"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Never mind
          </button>
          <button className="btn primary" onClick={save} disabled={busy || !ownerId}>
            {busy ? 'Moving…' : picked ? `Hand to ${picked.name.split(' ')[0]}` : 'Reassign'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <ErrorBanner error={error} />
        <div className="small muted">
          {task.name} — currently with <strong>{task.ownerName}</strong>
        </div>

        <Field label="Hand it to *">
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} autoFocus>
            <option value="">— choose somebody —</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.team ? ` · ${p.team}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Why is it moving?"
          help="Optional, but it is what the history will show alongside the date."
        >
          <textarea
            rows={3}
            value={reason}
            placeholder="e.g. Cloud Engineer is on leave until the 4th."
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        {task.status === 'submitted' && (
          <div className="notice">
            This task is marked done and waiting to be checked. Handing it over puts it back on the
            new owner's list — they have not done the work, so they cannot inherit somebody else's
            “done”.
          </div>
        )}
      </div>
    </Modal>
  );
}
