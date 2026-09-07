/** Small formatting helpers. Dates read the way an Indian office writes them. */

export function dateLabel(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

export function dateTimeLabel(sql) {
  if (!sql) return '—';
  const d = new Date(`${sql.replace(' ', 'T')}Z`);
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function relativeTime(sql) {
  if (!sql) return '';
  const then = new Date(`${sql.replace(' ', 'T')}Z`);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * The same idea as relativeTime, pointed the other way.
 *
 * It exists because relativeTime on a future stamp reads "just now", which is
 * exactly wrong for a snoozed alert: the one thing the person wants to know is
 * when it comes back.
 */
export function untilTime(sql) {
  if (!sql) return '';
  const then = new Date(`${sql.replace(' ', 'T')}Z`);
  const mins = Math.round((then.getTime() - Date.now()) / 60000);
  if (mins <= 0) return 'any moment';
  if (mins < 60) return `in ${mins}m`;

  const clock = then.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const hours = Math.round(mins / 60);
  if (hours < 12) return `in ${hours}h`;

  // Past half a day, a clock time is more use than a countdown.
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const sleeps = Math.ceil((then.getTime() - midnight.getTime()) / 86400000);
  if (sleeps <= 0) return `at ${clock}`;
  if (sleeps === 1) return `tomorrow at ${clock}`;
  if (sleeps < 7) {
    return `${then.toLocaleDateString('en-IN', { weekday: 'long' })} at ${clock}`;
  }
  return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export const initialsOf = (name) =>
  String(name || '')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');
