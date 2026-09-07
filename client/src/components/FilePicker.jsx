/**
 * Choose files, see what you chose, change your mind.
 *
 * Used in four places now — creating a task, marking one done, confirming one,
 * and sending a message — so it lives here rather than being re-typed with
 * small differences each time. It holds nothing but a list of `File` objects;
 * uploading is the caller's business, because *when* the upload happens differs
 * (a new task has no id until it is saved, a message has none until it is sent).
 */
import { useRef } from 'react';
import { fileSize } from '../lib/task.js';
import { ClipIcon } from './ui.jsx';

export const MAX_FILES = 5;

export default function FilePicker({
  files,
  onChange,
  label = 'Attach files',
  help = 'Up to 5 at a time, 20 MB each.',
  compact = false,
}) {
  const input = useRef(null);

  const add = (chosen) => {
    const merged = [...files];
    for (const f of chosen) {
      // Same name and size twice is a double-click, not two files.
      if (!merged.some((x) => x.name === f.name && x.size === f.size)) merged.push(f);
    }
    onChange(merged.slice(0, MAX_FILES));
  };

  const drop = (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) add([...e.dataTransfer.files]);
  };

  return (
    <div className="picker">
      <label
        className={`drop${compact ? ' compact' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={drop}
      >
        <input
          ref={input}
          type="file"
          multiple
          onChange={(e) => {
            add([...e.target.files]);
            e.target.value = '';
          }}
        />
        <span className="drop-icon" aria-hidden="true">
          <ClipIcon />
        </span>
        <span>{files.length ? 'Add another' : label}</span>
        {!compact && <span className="small muted">{help}</span>}
      </label>

      {files.length > 0 && (
        <ul className="picked">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`}>
              <span className="file-icon" aria-hidden="true">
                <ClipIcon size={13} />
              </span>
              <span className="picked-name">{f.name}</span>
              <span className="small muted">{fileSize(f.size)}</span>
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => onChange(files.filter((_, n) => n !== i))}
                aria-label={`Remove ${f.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
