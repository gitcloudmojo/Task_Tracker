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
  verified: {
    label: 'Checked — waiting for approval',
    tone: 'warning',
    icon: '◕',
    waiting: 'the CEO',
    short: 'With CEO',
    heldBy: 'with the CEO to approve',
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
  verify: { label: 'Confirm done', kind: 'primary' },
  approve: { label: 'Approve', kind: 'primary' },
  return: { label: 'Send back', kind: '' },
  reopen: { label: 'Reopen', kind: '' },
  cancel: { label: 'Cancel task', kind: 'ghost' },
};

/** What each activity row says, in plain words. */
export const ACTION_LABEL = {
  created: 'created and assigned',
  submitted: 'marked it done',
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
 */
export function dueLabel(days, status) {
  if (status === 'approved' || status === 'cancelled') return null;
  if (days === null || days === undefined) return null;
  if (days < 0) return { text: `${Math.abs(days)}d late`, tone: 'critical' };
  if (days === 0) return { text: 'due today', tone: 'warning' };
  if (days === 1) return { text: 'due tomorrow', tone: 'warning' };
  if (days <= 7) return { text: `in ${days}d`, tone: '' };
  return { text: `in ${days}d`, tone: 'muted' };
}
