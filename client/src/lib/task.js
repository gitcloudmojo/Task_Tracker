/**
 * The tracker's vocabulary, defined once.
 *
 * The words were chosen so that nobody has to learn the state machine to use
 * the app. A status says *who is holding the task*, not what internal state it
 * is in: "with the manager" tells you more than "submitted", and it tells the
 * right thing to all three roles at once.
 */

export const STATUS = {
  open: {
    label: 'To do',
    tone: '',
    icon: '○',
    waiting: 'the owner',
    short: 'To do',
    // What the row says on the right-hand side, in the second person where the
    // reader is the one holding it.
    heldBy: 'with the person doing it',
  },
  submitted: {
    label: 'Done — waiting to be checked',
    tone: 'accent',
    icon: '◐',
    waiting: 'the manager',
    short: 'With manager',
    heldBy: 'with the manager to check',
  },
  // Kept only for a task a pre-migration database still had sitting here —
  // see the note atop server/src/services/workflow.js. Checking a task now
  // signs it off in the same move, so nothing written after that change ever
  // leaves a task at this status.
  verified: {
    label: 'Checked — finishing sign-off',
    tone: 'warning',
    icon: '◕',
    waiting: 'the manager',
    short: 'With manager',
    heldBy: 'with the manager to finish signing off',
  },
  approved: {
    label: 'Approved',
    tone: 'good',
    icon: '●',
    waiting: 'nobody',
    short: 'Approved',
    heldBy: 'signed off',
  },
  cancelled: {
    label: 'Cancelled',
    tone: '',
    icon: '⊘',
    waiting: 'nobody',
    short: 'Cancelled',
    heldBy: 'closed without doing it',
  },
};

export const PRIORITY = {
  high: { label: 'High', tone: 'critical' },
  normal: { label: 'Normal', tone: '' },
};

/** The three live states, in the order work moves through them. */
export const PIPELINE = ['open', 'submitted', 'verified'];

/**
 * The buttons, named after what the person is actually doing rather than after
 * the transition. "Mark done" is what an engineer thinks they are doing;
 * "submit for completion" is what the spec calls it.
 */
export const MOVE = {
  submit: { label: 'Mark done', kind: 'primary' },
  // This is the final word now — checking a submitted task signs it off in
  // the same move, so the button says what it actually does rather than
  // naming a step that used to come after it.
  verify: { label: 'Approve', kind: 'primary' },
  // Only ever shown on the rare task a pre-migration database left sitting
  // at "verified" — see server/src/services/workflow.js.
  approve: { label: 'Give final sign-off', kind: 'primary' },
  return: { label: 'Send back', kind: '' },
  reopen: { label: 'Reopen', kind: '' },
  cancel: { label: 'Cancel task', kind: 'ghost' },
};

/** What each activity row says, in plain words. */
export const ACTION_LABEL = {
  created: 'created and assigned',
  submitted: 'marked it done',
  // Kept for a history row written before checking and signing off became
  // one move — a task approved the old way still reads "checked it" and
  // then, later, "approved it" as two separate lines, exactly as it happened.
  verified: 'checked it',
  approved: 'approved it',
  returned: 'sent it back',
  reassigned: 'reassigned it',
  cancelled: 'cancelled it',
  reopened: 'reopened it',
  edited: 'edited it',
  attached: 'attached a file',
  removed_attachment: 'removed a file',
  step_added: 'added a step',
  step_done: 'ticked off a step',
  step_undone: 'reopened a step',
  step_changed: 'changed a step',
  step_removed: 'removed a step',
  submitted_with_open_steps: 'marked it done with steps still open',
  note_added: 'logged an update',
  commented: 'left a comment',
};

export const ACTION_ICON = {
  created: '+',
  submitted: '◐',
  verified: '◕',
  approved: '✓',
  returned: '↩',
  reassigned: '⇄',
  cancelled: '⊘',
  reopened: '↻',
  edited: '✎',
  attached: '⎘',
  removed_attachment: '⌫',
  step_added: '≡',
  step_done: '✓',
  step_undone: '↻',
  step_changed: '✎',
  step_removed: '⌫',
  submitted_with_open_steps: '⚑',
  note_added: '✎',
  commented: '✎',
};

/** Human file size. */
export const fileSize = (b) => {
  if (b === null || b === undefined) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
};

/**
 * A step, or a follow-up.
 *
 * The distinction is not cosmetic and it is kept all the way out to the words:
 * a step past its date is *late*, a follow-up past its date is *your turn*.
 * Calling a check-back overdue would be a small lie the reader notices.
 */
export const STEP_KIND = {
  step: {
    label: 'Step',
    plural: 'steps',
    icon: '◦',
    hint: 'A piece of the work. Late once its date has passed.',
  },
  follow_up: {
    label: 'Follow-up',
    plural: 'follow-ups',
    icon: '↻',
    hint: 'A check-back — when the day comes it is your turn, not a missed deadline.',
  },
};

/** Where a step stands, in the words the reader should see. */
export const STEP_STATE = {
  done: { text: 'done', tone: 'good' },
  late: { text: 'late', tone: 'critical' },
  waiting: { text: 'your turn', tone: 'warning' },
  soon: { text: 'soon', tone: 'warning' },
  open: { text: '', tone: '' },
};

/**
 * How a step's date reads. Same arithmetic as `dueLabel`, different vocabulary
 * where the item is a follow-up rather than a piece of work.
 */
export function stepDueLabel(step) {
  if (step.doneAt) return null;
  const days = step.daysToDue;
  if (days === null || days === undefined) return null;
  if (step.kind === 'follow_up') {
    if (days < 0) return { text: 'your turn', tone: 'warning' };
    if (days === 0) return { text: 'today', tone: 'warning' };
    if (days === 1) return { text: 'tomorrow', tone: '' };
    return { text: `in ${days}d`, tone: days <= 7 ? '' : 'muted' };
  }
  if (days < 0) return { text: `${Math.abs(days)}d late`, tone: 'critical' };
  if (days === 0) return { text: 'due today', tone: 'warning' };
  if (days === 1) return { text: 'due tomorrow', tone: 'warning' };
  return { text: `in ${days}d`, tone: days <= 7 ? '' : 'muted' };
}

/**
 * How a due date reads. Overdue is stated in days late rather than as a date,
 * because "9 days late" lands and "due 15 Aug" needs arithmetic.
 *
 * `lateSide` (from the server's `overdueState()`) is what keeps a task the
 * owner already finished from reading as if the owner were the one running
 * late: once it is submitted, the days past the date belong to whoever has
 * not checked it yet, not to the person who turned it in. Same arithmetic,
 * a different word and a different colour — "critical" red is reserved for
 * work nobody has done yet.
 */
export function dueLabel(days, status, lateSide) {
  if (status === 'approved' || status === 'cancelled') return null;
  if (days === null || days === undefined) return null;
  if (days < 0) {
    if (lateSide && lateSide !== 'owner') {
      return { text: `done — ${Math.abs(days)}d awaiting sign-off`, tone: 'pending' };
    }
    return { text: `${Math.abs(days)}d late`, tone: 'critical' };
  }
  if (days === 0) return { text: 'due today', tone: 'warning' };
  if (days === 1) return { text: 'due tomorrow', tone: 'warning' };
  if (days <= 7) return { text: `in ${days}d`, tone: '' };
  return { text: `in ${days}d`, tone: 'muted' };
}
