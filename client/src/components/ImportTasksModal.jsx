/**
 * Bulk-import tasks from a filled-in Excel sheet.
 *
 * Two steps in one modal: pick the file and import it, then read the report.
 * A row that failed does not mean the batch failed — the report always shows
 * both lists, because "12 created, 3 held" is the normal outcome of a sheet
 * somebody filled in by hand, not an error state.
 */
import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Modal, ErrorBanner, Badge } from './ui.jsx';
import { fileSize } from '../lib/task.js';

export default function ImportTasksModal({ onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const input = useRef(null);

  const pick = (chosen) => {
    if (chosen?.[0]) setFile(chosen[0]);
  };

  const drop = (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) pick([...e.dataTransfer.files]);
  };

  const downloadTemplate = () =>
    api.download('/task-import/template', 'task-import-template.xlsx').catch(setError);

  const doImport = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api.uploadOne('/task-import', file);
      setResult(d);
      if (d.createdCount > 0) onImported();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
  };

  return (
    <Modal
      title="Import tasks from Excel"
      onClose={onClose}
      wide
      footer={
        result ? (
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={doImport} disabled={!file || busy}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          </>
        )
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <ErrorBanner error={error} />

        {!result && (
          <>
            <div className="notice">
              Need the sheet? <button className="btn sm ghost" onClick={downloadTemplate}>Download the template</button>{' '}
              — one row per task, one owner per row. Sub-tasks aren't part of the sheet; whoever ends
              up owning a task adds those afterwards.
            </div>

            <label
              className="drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={drop}
              style={{ cursor: 'pointer' }}
            >
              <input
                ref={input}
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  pick([...e.target.files]);
                  e.target.value = '';
                }}
              />
              <span>{file ? 'Choose a different file' : 'Choose the filled-in sheet, or drop it here'}</span>
              <span className="small muted">.xlsx, up to 3 MB, 300 rows at a time</span>
            </label>

            {file && (
              <ul className="picked">
                <li>
                  <span className="picked-name">{file.name}</span>
                  <span className="small muted">{fileSize(file.size)}</span>
                </li>
              </ul>
            )}
          </>
        )}

        {result && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 10 }}>
              <Badge tone="accent">{result.createdCount} created</Badge>
              {result.heldCount > 0 && <Badge tone="warning">{result.heldCount} on hold</Badge>}
              <span className="small muted">{result.totalRows} row(s) read</span>
            </div>

            {result.created.length > 0 && (
              <div>
                <div className="strong small" style={{ marginBottom: 6 }}>
                  Assigned
                </div>
                <ul className="problem-list">
                  {result.created.map((c) => (
                    <li key={c.id}>
                      Row {c.row}: <strong>{c.name}</strong> → {c.ownerName}, due {c.completionDate}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.held.length > 0 && (
              <div>
                <div className="strong small" style={{ marginBottom: 6 }}>
                  On hold — not created
                </div>
                <ul className="problem-list">
                  {result.held.map((h) => (
                    <li key={`${h.row}-${h.name}`}>
                      Row {h.row}: <strong>{h.name}</strong> — {h.reason}
                    </li>
                  ))}
                </ul>
                <div className="small muted" style={{ marginTop: 6 }}>
                  Fix these rows in the sheet and import again — only the held rows need
                  to go back in, since everything else is already created.
                </div>
              </div>
            )}

            {result.createdCount === 0 && result.heldCount === 0 && (
              <div className="small muted">Nothing to import — the sheet had no rows in it.</div>
            )}

            <div>
              <button className="btn sm ghost" onClick={reset}>
                Import another file
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
