/**
 * The side rail on Home: small panels that show how the work is spread, next
 * to the task list rather than under it.
 *
 * Everybody starts with the same three. Up to four of the available panels can
 * be chosen under "Customize", each panel can be folded away, and the whole
 * rail can be hidden — all remembered per person, in this browser, so it is
 * still how they left it tomorrow. Nothing here changes any data.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { storage } from '../lib/storage.js';

const MAX = 4;
const DEFAULT = ['live', 'person', 'label'];
// A team member only ever sees their own work, so the by-person / label /
// client breakdowns do not exist for them.
const OWN_DEFAULT = ['live', 'soon', 'done'];
const CEO_DEFAULT = ['label', 'live', 'person'];

/** Which panels exist for this person: the by-person / label / client
 *  breakdowns only exist for somebody who can see everyone's tasks. */
function catalogue(dash, isCeo) {
  const all = !dash.ownOnly;
  const maxOf = (rows, f) => Math.max(1, ...rows.map(f));
  const bars = (rows, f, cls, link) => (
    <div>
      {rows.map((r) => {
        const n = f(r);
        const label = link ? (
          <Link to={link(r)} className="nmx" title={r.key}>
            {r.key}
          </Link>
        ) : (
          <span className="nmx" title={r.key}>
            {r.key}
          </span>
        );
        return (
          <div key={r.id ?? r.key} className="hb">
            {label}
            <div className="tr">
              <i className={cls} style={{ width: `${Math.round((n / maxOf(rows, f)) * 100)}%` }} />
            </div>
            <span className="n">{n}</span>
          </div>
        );
      })}
    </div>
  );
  const none = <div className="rail-none">Nothing here right now.</div>;

  const sp = dash.split;
  const liveTotal = sp.lateWithOwner + sp.onTimeWithOwner + sp.toCheck;
  const list = [
    {
      id: 'live',
      title: 'Live tasks',
      desc: 'Where the live tasks sit',
      hint: String(liveTotal),
      body:
        liveTotal === 0 ? (
          none
        ) : (
          <>
            <div
              className="sbar"
              role="img"
              aria-label={`${liveTotal} live: ${sp.lateWithOwner} late, ${sp.onTimeWithOwner} on time, ${sp.toCheck} to check`}
            >
              {sp.lateWithOwner > 0 && <i className="s-late" style={{ flex: sp.lateWithOwner }} />}
              {sp.onTimeWithOwner > 0 && <i className="s-ok" style={{ flex: sp.onTimeWithOwner }} />}
              {sp.toCheck > 0 && <i className="s-chk" style={{ flex: sp.toCheck }} />}
            </div>
            <div className="lg">
              <span style={{ '--c': 'var(--critical)' }}>
                Late <b>{sp.lateWithOwner}</b>
              </span>
              <span style={{ '--c': 'var(--ink-muted)' }}>
                On time <b>{sp.onTimeWithOwner}</b>
              </span>
              <span style={{ '--c': 'var(--accent)' }}>
                To check <b>{sp.toCheck}</b>
              </span>
            </div>
          </>
        ),
    },
  ];

  if (all) {
    const people = dash.byPerson.filter((p) => p.overdue > 0).slice().sort((a, b) => b.overdue - a.overdue).slice(0, 4);
    list.push({
      id: 'person',
      title: 'Late by person',
      desc: 'Who is carrying the late tasks',
      hint: 'top 4',
      body: people.length ? bars(people, (r) => r.overdue, 's-late') : <div className="rail-none">Nobody has anything late.</div>,
    });
    list.push({
      id: 'label',
      title: 'By label',
      desc: 'Live tasks per project label',
      hint: 'live',
      body: dash.byLabel?.length
        ? bars(dash.byLabel.slice(0, 5), (r) => r.live, 's-chk', (r) => `/tasks?label=${r.id ?? 'none'}`)
        : none,
    });
    list.push({
      id: 'client',
      title: 'By client',
      desc: 'Clients with the most live work',
      hint: 'live',
      body: dash.byClient?.length ? bars(dash.byClient.filter((c) => c.live > 0).slice(0, 4), (r) => r.live, 's-chk') : none,
    });
  }

  const d = dash.dueSoon;
  const dueTotal = d.today + d.tomorrow + d.later;
  list.push({
    id: 'soon',
    title: 'Due this week',
    desc: 'What is coming up next',
    hint: String(dueTotal),
    body:
      dueTotal === 0 ? (
        <div className="rail-none">Nothing falls due in the next seven days.</div>
      ) : (
        <>
          <div className="li"><span className="l">Due today</span><span className={`r${d.today ? ' c' : ''}`}>{d.today}</span></div>
          <div className="li"><span className="l">Due tomorrow</span><span className="r">{d.tomorrow}</span></div>
          <div className="li"><span className="l">In 2–7 days</span><span className="r g">{d.later}</span></div>
        </>
      ),
  });

  list.push({
    id: 'wait',
    title: 'Waiting longest',
    desc: 'Oldest tasks still awaiting a check',
    hint: String(dash.waitingCount),
    body: dash.waitingLongest.length ? (
      dash.waitingLongest.map((t) => (
        <div key={t.id} className="li">
          <Link to={`/tasks/${t.id}`} className="l">
            {t.name}
            <span className="sm"> · {t.ownerName}</span>
          </Link>
          <span className={`r ${t.days >= 7 ? 'c' : 'b'}`}>{t.days === 0 ? 'today' : `${t.days}d`}</span>
        </div>
      ))
    ) : (
      <div className="rail-none">Nothing is waiting for a check.</div>
    ),
  });

  const ap = dash.approvedRecently;
  list.push({
    id: 'done',
    title: 'Approved this week',
    desc: 'Recently signed off',
    hint: String(ap.count),
    body: ap.items.length ? (
      ap.items.map((t) => (
        <div key={t.id} className="li">
          <Link to={`/tasks/${t.id}`} className="l">
            {t.name}
          </Link>
          <span className="r g">{new Date(`${String(t.approvedAt).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
        </div>
      ))
    ) : (
      <div className="rail-none">Nothing signed off in the last seven days.</div>
    ),
  });

  return { list, defaults: all ? (isCeo ? CEO_DEFAULT : DEFAULT) : OWN_DEFAULT };
}

/** The three things remembered per person: chosen panels, folded panels, rail shown. */
export function useRailPrefs(userId) {
  const base = `cloudmojo.tracker.home.${userId}`;
  const read = (k, fallback) => {
    try {
      const v = JSON.parse(storage.get(`${base}.${k}`));
      return v ?? fallback;
    } catch {
      return fallback;
    }
  };
  const [chosen, setChosenState] = useState(() => read('panels', null));
  const [closed, setClosedState] = useState(() => read('closed', []));
  const [shown, setShownState] = useState(() => read('shown', true));
  const save = (k, v) => storage.set(`${base}.${k}`, JSON.stringify(v));
  return {
    chosen,
    closed,
    shown,
    setChosen: (v) => { setChosenState(v); save('panels', v); },
    setClosed: (v) => { setClosedState(v); save('closed', v); },
    setShown: (v) => { setShownState(v); save('shown', v); },
    reset: () => {
      setChosenState(null); setClosedState([]);
      storage.remove(`${base}.panels`); storage.remove(`${base}.closed`);
    },
  };
}

const Chev = () => (
  <svg className="chev" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function HomeRail({ dash, isCeo, prefs }) {
  const [customizing, setCustomizing] = useState(false);
  const { list, defaults } = catalogue(dash, isCeo);
  const ids = list.map((p) => p.id);
  // A saved choice can name a panel this person can no longer see (a role
  // change, say); drop those rather than show nothing.
  const chosen = (prefs.chosen || defaults).filter((id) => ids.includes(id)).slice(0, MAX);
  const shownPanels = chosen.map((id) => list.find((p) => p.id === id));
  const allClosed = chosen.length > 0 && chosen.every((id) => prefs.closed.includes(id));
  const full = chosen.length >= MAX;

  const toggleOpen = (id) =>
    prefs.setClosed(prefs.closed.includes(id) ? prefs.closed.filter((x) => x !== id) : [...prefs.closed, id]);
  const toggleChoice = (id) => {
    if (chosen.includes(id)) prefs.setChosen(chosen.filter((x) => x !== id));
    else if (!full) prefs.setChosen([...chosen, id]);
  };

  return (
    <aside className="rail" aria-label="Side panels">
      <div className="rail-head">
        <span className="t">Panels</span>
        <span className="sp">
          {chosen.length > 0 && (
            <button className="btn sm ghost" onClick={() => prefs.setClosed(allClosed ? [] : chosen)}>
              {allClosed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
          <button
            className="btn sm ghost"
            aria-expanded={customizing}
            onClick={() => setCustomizing((o) => !o)}
          >
            Customize
          </button>
          <button className="btn sm ghost" onClick={() => prefs.setShown(false)}>
            Hide ▸
          </button>
        </span>

        {customizing && (
          <div className="rail-pop" role="dialog" aria-label="Choose panels">
            <h4>Choose up to {MAX} panels</h4>
            <div className="help">Saved for you on this device.</div>
            {list.map((p) => {
              const on = chosen.includes(p.id);
              const dis = full && !on;
              return (
                <label key={p.id} className={`opt${dis ? ' dis' : ''}`}>
                  <input type="checkbox" checked={on} disabled={dis} onChange={() => toggleChoice(p.id)} />
                  <span>
                    <div className="o1">{p.title}</div>
                    <div className="o2">{p.desc}</div>
                  </span>
                </label>
              );
            })}
            <div className="pop-foot">
              <span className="small muted">{chosen.length} of {MAX} chosen</span>
              <span>
                <button className="btn sm ghost" onClick={prefs.reset}>Reset</button>
                <button className="btn sm" onClick={() => setCustomizing(false)}>Done</button>
              </span>
            </div>
          </div>
        )}
      </div>

      {shownPanels.length === 0 && (
        <div className="rail-none">No panels chosen. Use Customize to add some.</div>
      )}
      {shownPanels.map((p) => {
        const isClosed = prefs.closed.includes(p.id);
        return (
          <section key={p.id} className={`card pan${isClosed ? ' closed' : ''}`}>
            <button className="pan-h" aria-expanded={!isClosed} onClick={() => toggleOpen(p.id)}>
              <Chev />
              <h3>{p.title}</h3>
              <span className="hint">{p.hint}</span>
            </button>
            {!isClosed && <div className="pan-b">{p.body}</div>}
          </section>
        );
      })}
    </aside>
  );
}
