import { useEffect, useState } from 'react';
import { storage } from '../lib/storage.js';

/** Chevron that rotates to point at what will happen next. */
export function Chevron({ open }) {
  return (
    <svg
      className={`chevron${open ? ' open' : ''}`}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <path
        d="M4 5.5 7 8.5l3-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The alerts bell.
 *
 * Drawn rather than borrowed from the emoji set: an emoji bell arrives in
 * whatever colour and weight the operating system feels like, which stood out
 * badly next to controls that were drawn on purpose. This one inherits the
 * colour of its button like every other icon in the app.
 */
/**
 * A paperclip.
 *
 * It was ⎘ until it was tested on three machines: that character has patchy
 * font coverage and lands as an empty box on some Windows builds, which is a
 * poor advertisement for a button whose whole job is to be recognised.
 */
export function ClipIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M10.8 4.6 5.9 9.5a1.7 1.7 0 0 0 2.4 2.4l5.1-5.1a3.1 3.1 0 0 0-4.4-4.4L3.6 8a4.5 4.5 0 0 0 6.4 6.4l4.3-4.3"
        fill="none" stroke="currentColor" strokeWidth="1.35"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

export function BellIcon({ size = 16, ringing = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {/* Filled faintly when something is waiting, so the bell itself carries
          the news and not only the red pip beside it. */}
      <path
        d="M8 2.2a3.6 3.6 0 0 0-3.6 3.6c0 2.5-.6 3.6-1.2 4.3-.3.3-.1.8.3.8h9c.4 0 .6-.5.3-.8-.6-.7-1.2-1.8-1.2-4.3A3.6 3.6 0 0 0 8 2.2Z"
        fill="currentColor" fillOpacity={ringing ? 0.16 : 0}
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
      />
      <path d="M6.6 12.4a1.5 1.5 0 0 0 2.8 0" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A panel. Pass `collapsible` to give it a header that folds the body away,
 * and `id` to have that choice remembered between visits — a CEO who never
 * opens the budget block should not have to close it every morning.
 */
export function Card({
  title,
  hint,
  action,
  children,
  className = '',
  bodyClass = '',
  collapsible = false,
  defaultCollapsed = false,
  id,
}) {
  const key = id ? `cloudmojo.tracker.panel.${id}` : null;
  const [open, setOpen] = useState(() => {
    if (!collapsible) return true;
    const saved = key ? storage.get(key) : null;
    if (saved === 'open') return true;
    if (saved === 'closed') return false;
    return !defaultCollapsed;
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (key) storage.set(key, next ? 'open' : 'closed');
  };

  const head = (title || action) && (
    <div className={`card-head${collapsible ? ' collapsible' : ''}`}>
      {collapsible ? (
        <button className="card-toggle" onClick={toggle} aria-expanded={open}>
          <Chevron open={open} />
          <h3>{title}</h3>
        </button>
      ) : (
        title && <h3>{title}</h3>
      )}
      {hint && <span className="hint">{hint}</span>}
      {action && <span style={{ marginLeft: hint ? 10 : 'auto' }}>{action}</span>}
    </div>
  );

  return (
    <section className={`card ${className}`}>
      {head}
      {open && <div className={`card-body ${bodyClass}`}>{children}</div>}
    </section>
  );
}

/** Status is never colour alone — every badge carries an icon and a word. */
export function Badge({ tone = '', icon, children }) {
  return (
    <span className={`badge ${tone}`}>
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}

export function Field({ label, help, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {help && <span className="help">{help}</span>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function ErrorBanner({ error }) {
  if (!error) return null;
  return <div className="error-banner">{String(error.message || error)}</div>;
}

/**
 * Segmented control.
 *
 * The selected state is a single thumb that slides between equal-width cells,
 * rather than each button colouring itself in. Two reasons: the movement tells
 * you which way you went, and one moving element cannot get out of step with
 * the others the way five independent backgrounds can.
 *
 * Arrow keys move between options, because a control that looks like a physical
 * switch should behave like one.
 */
export function Segmented({ value, onChange, options, ariaLabel }) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );

  const onKeyDown = (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
  };

  return (
    <div
      className="seg"
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      style={{ '--seg-count': options.length, '--seg-index': index }}
    >
      <span className="seg-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A two-state switch, for settings that take effect the moment you flip them.
 * Built as a track and a knob rather than an icon that swaps, so the state is
 * legible before you read the icon — and it animates, so a mis-click is
 * obvious.
 */
export function Switch({ on, onChange, label, onIcon, offIcon }) {
  return (
    <button
      type="button"
      className={`switch${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
    >
      <span className="switch-track" aria-hidden="true">
        <span className="switch-knob">{on ? onIcon : offIcon}</span>
      </span>
    </button>
  );
}

/**
 * Where a group of live tasks is sitting, as one proportional bar.
 *
 * Segments in workflow order, so the eye reads left-to-right as "being done →
 * waiting to be checked → waiting for approval". Every non-zero segment gets a
 * minimum width, because a bar that hides the one task stuck at the last gate
 * is worse than no bar.
 */
export function StageBar({ live, toCheck, toApprove, title }) {
  const total = live || 0;
  if (!total) return <span className="small muted">nothing live</span>;
  const working = Math.max(0, total - toCheck - toApprove);
  const seg = (n, cls, what) =>
    n > 0 ? (
      <span
        className={`bar-seg ${cls}`}
        style={{ flexGrow: n, minWidth: 4 }}
        title={`${n} ${what}`}
      />
    ) : null;

  return (
    <span className="bar" title={title} aria-label={`${total} live`}>
      {seg(working, 'working', 'being worked on')}
      {seg(toCheck, 'checking', 'waiting to be checked')}
      {seg(toApprove, 'approving', 'waiting for approval')}
    </span>
  );
}
