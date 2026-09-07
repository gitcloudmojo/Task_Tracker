/**
 * The buttons that move a task along, wherever it appears.
 *
 * Three decisions worth stating:
 *
 * 1. The happy path is one click. Marking a task done, confirming it, and
 *    approving it all act immediately — no dialogue asking for a note that
 *    nobody was going to write.
 * 2. But evidence matters at exactly those moments, so the two moves that carry
 *    proof — marking done and confirming — get a second, quieter button that
 *    opens a dialogue for a note and files. One click stays one click; the
 *    person with a report to attach has somewhere to put it.
 * 3. A note is genuinely required when work goes *backwards*, and only there.
 *
 * The buttons are drawn from the server's own permission flags, so a person is
 * never offered a move the API would refuse. A false flag means no button at
 * all — never shown-then-disabled, which only invites "why can't I?".
 */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { Modal, Field, ClipIcon } from './ui.jsx';
import FilePicker from './FilePicker.jsx';
import { MOVE } from '../lib/task.js';

/** Moves that must say why. */
const NEEDS_REASON = {
  return: {
    title: 'Send it back',
    label: 'What needs doing?',
    help: 'Required. A task sent back without a reason just stalls.',
    placeholder: 'e.g. The uptime figure is last month’s — please pull it again.',
    cta: 'Send back',
  },
  reopen: {
    title: 'Reopen after approval',
    label: 'Why is it coming back?',
    help: 'The owner sees this, and the task returns to their list.',
    placeholder: 'e.g. The client found a gap in section 3.',
    cta: 'Reopen',
  },
  cancel: {
    title: 'Cancel this task',
    label: 'Why?',
    help: 'It stays on the record as cancelled rather than disappearing.',
    placeholder: 'e.g. Client went with an in-house team.',
    cta: 'Cancel the task',
  },
};

/** Moves where somebody may want to hand over a file at the same time. */
const WITH_EVIDENCE = {
  submit: {
    title: 'Mark it done, with the evidence',
    label: 'Anything your manager should know?',
    help: 'Optional — what you did, where the output is, anything you could not finish.',
    placeholder: 'e.g. Report and the raw export are attached.',
    fileLabel: 'Attach the work',
    fileHelp: 'The report, the screenshot, the signed copy.',
    cta: 'Mark done',
  },
  verify: {
    title: 'Confirm it is done',
    label: 'What did you check?',
    help: 'Optional, but it is what the CEO reads before approving.',
    placeholder: 'e.g. Numbers match the rate card. Scope matches the notes.',
    fileLabel: 'Attach anything you produced',
    fileHelp: 'A marked-up copy, a checklist, a screenshot of the check.',
    cta: 'Confirm done',
  },
};

export default function MoveButtons({ task: t, onDone, full = false, size = 'sm', onError }) {
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(null);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState([]);

  const run = async (move, body) => {
    setBusy(true);
    try {
      // Files first: once a task is approved it stops accepting them, so the
      // evidence goes up while the door is still open.
      if (files.length) await api.upload(`/attachments/task/${t.id}`, files);
      await api.post(`/tasks/${t.id}/${move}`, body);
      close();
      onDone?.();
    } catch (err) {
      onError?.(err);
      setBusy(false);
    }
  };

  const open = (move) => {
    setNote('');
    setFiles([]);
    setAsk(move);
  };
  const close = () => {
    setAsk(null);
    setNote('');
    setFiles([]);
    setBusy(false);
  };

  const cls = `btn${size === 'sm' ? ' sm' : ''}`;
  const moves = [];
  if (t.canSubmit) moves.push(['submit', 'primary', () => run('submit', {})]);
  if (t.canVerify) moves.push(['verify', 'primary', () => run('verify', {})]);
  if (t.canApprove) moves.push(['approve', 'primary', () => run('approve', {})]);
  if (t.canReturn) moves.push(['return', '', () => open('return')]);
  if (full && t.canReopen) moves.push(['reopen', '', () => open('reopen')]);
  if (full && t.canCancel) moves.push(['cancel', 'ghost', () => open('cancel')]);

  // The move this person is here to make, if it is one that carries evidence.
  const evidenceMove = t.canSubmit ? 'submit' : t.canVerify ? 'verify' : null;

  if (!moves.length) return null;

  const reason = ask && NEEDS_REASON[ask];
  const evidence = ask && WITH_EVIDENCE[ask];
  const ready = reason ? note.trim().length >= 5 : true;
  const spec = reason || evidence;

  return (
    <>
      <div className="moves">
        {moves.map(([move, kind, fn]) => (
          <button
            key={move}
            className={`${cls} ${kind}`.trim()}
            disabled={busy}
            onClick={fn}
            title={move === 'submit' ? 'Tells your manager it is ready to check' : undefined}
          >
            {MOVE[move].label}
          </button>
        ))}

        {evidenceMove && (
          <button
            className={`${cls} ghost attach-move`}
            disabled={busy}
            onClick={() => open(evidenceMove)}
            title={`${MOVE[evidenceMove].label} and attach a file or a note`}
          >
            <ClipIcon size={13} />
            <span className="attach-move-text">with a file</span>
          </button>
        )}
      </div>

      {spec && (
        <Modal
          title={spec.title}
          onClose={close}
          footer={
            <>
              <button className="btn" onClick={close} disabled={busy}>
                Never mind
              </button>
              <button
                className="btn primary"
                disabled={busy || !ready}
                onClick={() => run(ask, { note: note.trim() || undefined })}
              >
                {busy ? 'Working…' : spec.cta}
              </button>
            </>
          }
        >
          <div className="stack" style={{ gap: 14 }}>
            <div className="small muted">{t.name}</div>

            <Field label={spec.label} help={spec.help}>
              <textarea
                rows={3}
                value={note}
                placeholder={spec.placeholder}
                onChange={(e) => setNote(e.target.value)}
                autoFocus
              />
            </Field>

            {evidence && (
              <Field label={evidence.fileLabel} help={evidence.fileHelp}>
                <FilePicker files={files} onChange={setFiles} label="Attach files" />
              </Field>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
