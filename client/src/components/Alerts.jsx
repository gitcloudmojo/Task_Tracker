/**
 * The bell.
 *
 * An alert is a thing somebody is asking of you, so the panel is built around
 * the three answers a person actually has:
 *
 *   deal with it   → click it, and you land on the task it is about
 *   not now        → snooze it, and it comes back when you said
 *   noted          → mark it read
 *
 * The old version only had the last one, which is why people used it to clear
 * the badge and the badge stopped meaning anything. Snooze is the honest answer
 * to half of these.
 *
 * Alerts are grouped by when they arrived rather than listed flat, because
 * "today" and "last week" want reading differently.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { relativeTime, untilTime } from '../lib/format.js';
import { BellIcon } from './ui.jsx';

const ICON = {
  task_assigned: '→',
  task_reassigned: '⇄',
  task_due_soon: '◔',
  task_overdue: '⏰',
  task_submitted: '◐',
  task_verified: '◕',
  task_approved: '✓',
  task_returned: '↩',
  task_cancelled: '⊘',
  review_stalled: '⚑',
  approval_stalled: '⚑',
  chat_message: '✉',
  // The breakdown. A follow-up gets the repeat mark rather than a clock,
  // because its day arriving is not the same as being late.
  step_assigned: '≡',
  step_done: '✓',
  step_due_soon: '◦',
  step_overdue: '⏰',
  follow_up_due: '↻',
  steps_slipping: '⚑',
};

/** Today, yesterday, then the date. Enough grouping to be useful, no more. */
function bucketOf(iso) {
  const then = new Date(`${String(iso).replace(' ', 'T')}Z`);
  const now = new Date();
  const days = Math.floor((now - then) / 86400000);
  if (days < 1 && then.getDate() === now.getDate()) return 'Today';
  if (days < 2) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}

export default function Alerts() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('inbox');
  const [data, setData] = useState({ notifications: [], unread: 0, snoozed: 0, presets: [] });
  const [snoozing, setSnoozing] = useState(null);
  const [flash, setFlash] = useState(null);
  const popRef = useRef(null);

  const load = (which = tab) =>
    api
      .get(`/notifications?limit=60${which === 'snoozed' ? '&snoozed=true' : ''}`)
      .then(setData)
      .catch(() => {});

  useEffect(() => {
    load();
    // A minute is plenty for deadline work and keeps the server simple.
    const id = setInterval(() => load(), 60_000);
    return () => clearInterval(id);
  }, [tab]);

  useEffect(() => {
    const away = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) {
        setOpen(false);
        setSnoozing(null);
      }
    };
    const escape = (e) => e.key === 'Escape' && (setSnoozing(null), setOpen(false));
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  const go = async (n) => {
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    setOpen(false);
    setSnoozing(null);
    // A chat alert belongs in the conversation, not on the task it mentions.
    if (n.type === 'chat_message') navigate('/chat');
    else if (n.taskId) navigate(`/tasks/${n.taskId}`);
    load();
  };

  const snooze = async (n, preset) => {
    const res = await api.post(`/notifications/${n.id}/snooze`, { preset }).catch(() => null);
    setSnoozing(null);
    if (res) {
      setFlash(`Back ${res.label}.`);
      setTimeout(() => setFlash(null), 2600);
    }
    load();
  };

  const wake = async (n) => {
    await api.post(`/notifications/${n.id}/unsnooze`).catch(() => {});
    load();
  };

  const markAll = async () => {
    await api.post('/notifications/read-all').catch(() => {});
    load();
  };

  const list = data.notifications || [];
  const groups = [];
  for (const n of list) {
    const label = tab === 'snoozed' ? 'Put off until later' : bucketOf(n.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <div className="bell" ref={popRef}>
      <button
        className={`btn sm bell-btn${data.unread > 0 ? ' has-unread' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={data.unread > 0 ? `Alerts — ${data.unread} unread` : 'Alerts'}
        aria-expanded={open}
      >
        <BellIcon ringing={data.unread > 0} />
        {data.unread > 0 && <span className="pip">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>

      {open && (
        <div className="popover alerts" role="dialog" aria-label="Alerts">
          <div className="alerts-head">
            <div className="alerts-tabs">
              <button
                className={`alerts-tab${tab === 'inbox' ? ' active' : ''}`}
                onClick={() => setTab('inbox')}
              >
                Alerts
                {data.unread > 0 && <span className="alerts-count">{data.unread}</span>}
              </button>
              <button
                className={`alerts-tab${tab === 'snoozed' ? ' active' : ''}`}
                onClick={() => setTab('snoozed')}
              >
                Snoozed
                {data.snoozed > 0 && <span className="alerts-count quiet">{data.snoozed}</span>}
              </button>
            </div>
            {tab === 'inbox' && data.unread > 0 && (
              <button className="btn ghost sm" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>

          {flash && <div className="alerts-flash">{flash}</div>}

          <div className="alerts-scroll">
            {list.length === 0 ? (
              <div className="empty">
                {tab === 'snoozed' ? 'Nothing put off.' : 'Nothing needs your attention.'}
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.label}>
                  <div className="alerts-day">{group.label}</div>
                  {group.items.map((n) => (
                    <div key={n.id} className={`alert-item${n.readAt ? '' : ' unread'} ${n.severity}`}>
                      <button className="alert-main" onClick={() => go(n)}>
                        <span className={`alert-icon ${n.severity}`} aria-hidden="true">
                          {ICON[n.type] || '•'}
                        </span>
                        <span className="alert-text">
                          <span className="alert-title">{n.title}</span>
                          {n.body && <span className="alert-body">{n.body}</span>}
                          <span className="alert-meta">
                            {tab === 'snoozed' && n.snoozedUntil
                              ? `back ${untilTime(n.snoozedUntil)}`
                              : relativeTime(n.createdAt)}
                            {n.taskId ? ' · opens the task' : ''}
                          </span>
                        </span>
                        {!n.readAt && <span className="alert-dot" aria-label="unread" />}
                      </button>

                      <div className="alert-actions">
                        {tab === 'snoozed' ? (
                          <button className="btn sm ghost" onClick={() => wake(n)}>
                            Bring back
                          </button>
                        ) : (
                          <button
                            className="btn sm ghost"
                            onClick={() => setSnoozing(snoozing === n.id ? null : n.id)}
                            aria-expanded={snoozing === n.id}
                          >
                            Snooze
                          </button>
                        )}
                      </div>

                      {/* Opens inside the row rather than floating over it: a
                          menu positioned above a scrolling list gets clipped by
                          it, and the last choice is the one that disappears. */}
                      {snoozing === n.id && (
                        <div
                          className="snooze-menu"
                          ref={(el) => el?.scrollIntoView({ block: 'nearest' })}
                        >
                          <span className="snooze-head">Remind me</span>
                          {(data.presets || []).map((p) => (
                            <button key={p.key} onClick={() => snooze(n, p.key)}>
                              {p.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          <div className="alerts-foot">
            Alerts come from the sweep that watches completion dates, and from anything that lands
            on your desk.
          </div>
        </div>
      )}
    </div>
  );
}
