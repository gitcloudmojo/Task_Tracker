# A1K design system — handoff

Everything the Task Tracker's look is made of, so a second tool on the A1K
platform can be built to match. Paste the "Brief for another chat" section at
the end into a new conversation and the tool will come out consistent.

There is **no UI framework, no icon library, and no web font**. One stylesheet
of CSS custom properties, plain semantic class names, system fonts and Unicode
glyphs. That is a deliberate choice, explained under each heading.

---

## 1. Type

**Family — system UI stack, no web font:**

```css
--font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
```

Why: it renders instantly, matches the operating system the person already
uses, and survives being emailed around as a single HTML file with no network.
The whole preview works offline because of choices like this.

**Base:** `14px / 1.5`, `-webkit-font-smoothing: antialiased`, colour `--ink`.

**The scale** — sizes are deliberately odd-numbered (12.5, 13.5) because at
this density a whole pixel is a visible jump:

| Role | Size | Weight | Letter-spacing |
|------|------|--------|----------------|
| Page title (`h1` in the top bar) | 19px | 640 | −0.015em |
| Big number (stat tile) | 27px | 620 | −0.025em |
| Modal title | 16px | 620 | — |
| Card title | 14px | 620 | −0.01em |
| Body / rows | 13.5–14px | 400–560 | — |
| Task name in a row | 14px | 560 | — |
| Buttons | 13.5px | 540 | — |
| Secondary line, hints, sub-labels | 12–12.5px | 400 | — |
| Table headers, field labels | 11.5–12px | 540–560 | +0.05em, uppercase |
| Badges | 11.5px | 560 | — |
| Brand product line ("TASK TRACKER") | 10.5px | 640 | +0.14em, uppercase |
| Timestamps, meta | 11–11.5px | 400 | — |

**Rules that make it feel like one system:**

- **Weights between the usual stops** — 540, 560, 580, 620, 640 rather than
  500/600/700. System UI faces are variable, so semi-steps read as emphasis
  without shouting. 700 is never used.
- **Negative tracking on anything large** (−0.01 to −0.03em); **positive
  tracking only on small uppercase** labels (+0.04 to +0.14em). Big text tightens,
  small caps open up.
- **Sentence case everywhere.** No Title Case in buttons, headings or labels.
  Uppercase is reserved for tiny structural labels.
- **`font-variant-numeric: tabular-nums`** on any column of figures, so digits
  line up as values change.
- Three ink levels and never more: `--ink` (what you read), `--ink-secondary`
  (supporting), `--ink-muted` (metadata). If something needs a fourth level, the
  layout is wrong.
- Long text gets `overflow-wrap: anywhere`; single-line names get
  `text-overflow: ellipsis` with `min-width: 0` on the flex parent.

---

## 2. Icons — Unicode glyphs, no library

Every icon in the app is a **text character** in a `<span aria-hidden="true">`.
No SVG sprite sheet, no `lucide`/`heroicons`/Font Awesome, no `<svg>` markup.

Why: they inherit `color` and `font-size` for free, they cost nothing to load,
they work in a single-file HTML build, and there is no icon-set version to keep
in step with a design tool. The cost is that they are drawn by the OS, so pick
only glyphs that exist everywhere.

**Navigation and chrome**

| Glyph | Meaning |
|-------|---------|
| `◱` | Home |
| `☰` | All tasks / a list |
| `✉` | Chat |
| `⚇` | People |
| `⚙` | Settings |
| `⏻` | Sign out |
| `«` `»` | Collapse / expand the sidebar |
| `☀` `☾` | Light / dark theme toggle |
| `→` | Move forward, "see all" |

**State — a filling circle, so progress is legible at a glance**

| Glyph | State |
|-------|-------|
| `○` | to do — nothing done yet |
| `◐` | marked done, waiting to be checked |
| `◕` | checked, waiting for approval |
| `●` | approved |
| `⊘` | cancelled |

**Actions in the history log**

| Glyph | Action |
|-------|--------|
| `+` | created |
| `✓` | approved / step complete |
| `↩` | sent back |
| `⇄` | reassigned |
| `↻` | reopened |
| `✎` | edited |
| `⌫` | file removed |
| `⚑` | stalled / flagged |
| `⏰` | overdue |

**Two exceptions, drawn as SVG** — in `ui.jsx`, sized in `px`, `fill="none"`,
`stroke="currentColor"`, stroke width `1.3`–`1.35`:

| Component | Why it is not a glyph |
|-----------|----------------------|
| `BellIcon` | The emoji bell arrives in whatever colour and weight the OS feels like, which stands out badly beside controls drawn on purpose. It also takes a `ringing` prop that fills it at 16% opacity when something is waiting, so the bell itself carries the news and not only the red pip. |
| `ClipIcon` | `⎘` has patchy font coverage and lands as an empty box on some Windows builds — poor for a button whose whole job is to be recognised. |

The rule this encodes: **a glyph unless the icon must be recognised on its own,
then draw it.** Both still inherit `currentColor`, so nothing about the colour
system changes.

**Rules**

- Always `aria-hidden="true"`; the meaning lives in adjacent text, never in the
  glyph alone.
- Monochrome — the glyph takes the colour of its container.
- A glyph is never a button on its own except in the sidebar rail, where the
  label is in a `title` attribute and reappears when expanded.
- Small round "chip" backgrounds (22px circle, `--surface-sunken`) are used to
  turn a glyph into a marker in lists and step rails.

---

## 3. Theme — tokens, with dark hand-picked

Two themes, switched by `data-theme="dark"` on `<html>`, plus `color-scheme` so
native controls and scrollbars follow. Dark is **not** an inversion: the steps
were chosen individually, which is why the greys are warm in both.

```css
:root {
  color-scheme: light;

  /* surfaces, lightest content on a slightly darker plane */
  --plane:          #f9f9f7;   /* the page behind everything */
  --surface:        #fcfcfb;   /* cards, sidebar, top bar */
  --surface-raised: #ffffff;   /* inputs, popovers, active segment */
  --surface-sunken: #f2f2ee;   /* hover, wells, table zebra */

  /* three ink levels, never four */
  --ink:            #0b0b0b;
  --ink-secondary:  #52514e;
  --ink-muted:      #898781;

  /* borders are alpha, so they work over any surface */
  --grid:           #e1e0d9;
  --axis:           #c3c2b7;
  --border:         rgba(11, 11, 11, 0.10);
  --border-strong:  rgba(11, 11, 11, 0.18);

  /* one accent, used for interaction only */
  --accent:      #2a78d6;
  --accent-ink:  #ffffff;
  --accent-wash: rgba(42, 120, 214, 0.10);

  /* status — semantic, never decorative */
  --good:      #0ca30c;
  --good-text: #006300;   /* the readable version on light surfaces */
  --warning:   #fab219;
  --serious:   #ec835a;
  --critical:  #d03b3b;

  /* an ordinal ramp for charts: ΔL ≥ 0.06 between steps */
  --ord-1: #86b6ef;  --ord-2: #5598e7;  --ord-3: #2a78d6;
  --ord-4: #1c5cab;  --ord-5: #104281;
  --series-1: #2a78d6;  --series-2: #eb6834;

  --radius:    10px;   /* cards, panels */
  --radius-sm: 6px;    /* buttons, inputs, chips */
  --shadow: 0 1px 2px rgba(11,11,11,.05), 0 6px 20px rgba(11,11,11,.04);
}

:root[data-theme='dark'] {
  color-scheme: dark;

  --plane:          #0d0d0d;
  --surface:        #1a1a19;
  --surface-raised: #212120;
  --surface-sunken: #141413;

  --ink:            #ffffff;
  --ink-secondary:  #c3c2b7;
  --ink-muted:      #898781;

  --grid:           #2c2c2a;
  --axis:           #383835;
  --border:         rgba(255, 255, 255, 0.10);
  --border-strong:  rgba(255, 255, 255, 0.20);

  --accent:      #3987e5;         /* lifted, to hold contrast on dark */
  --accent-wash: rgba(57, 135, 229, 0.16);
  --good-text:   #0ca30c;

  --ord-1: #9ec5f4;  --ord-2: #6da7ec;  --ord-3: #3987e5;
  --ord-4: #256abf;  --ord-5: #184f95;
  --series-1: #3987e5;  --series-2: #d95926;

  --shadow: 0 1px 2px rgba(0,0,0,.4), 0 6px 20px rgba(0,0,0,.3);
}
```

**Colour discipline — the rule that keeps it calm:**

- **One accent, and it means "you can act here".** Primary buttons, the active
  nav item, focus rings, links. Nothing decorative is ever accent-coloured.
- **Status colours are semantic only.** Red means late or refused, amber means
  waiting on somebody, green means signed off. Never used to brighten a chart or
  a heading.
- **Everything else is greyscale.** A screen with nothing wrong on it has
  exactly one colour on it — the accent on the button you are meant to press.
- Status washes are mixed live rather than hard-coded:
  `color-mix(in srgb, var(--critical) 10%, transparent)` — one hue, three
  intensities (text / border / background), automatically right in both themes.
- Dark mode lifts the accent and the greens rather than reusing the light values,
  and `--good-text` exists precisely because `--good` is not readable on white.

---

## 4. Layout

```
┌──────────┬────────────────────────────────────┐
│ sidebar  │ topbar  (sticky, title + actions)  │
│ 232px    ├────────────────────────────────────┤
│ (66px    │ content  padding: 24px 28px 56px   │
│ collapsed)│  .stack — 16px vertical rhythm    │
└──────────┴────────────────────────────────────┘
```

- `display: grid; grid-template-columns: 232px 1fr` — 66px when collapsed.
- Sidebar and top bar are `position: sticky`, so navigation and the page title
  never scroll away.
- **`.stack`** (flex column, `gap: 16px`) is the only vertical rhythm. **`.grid.cols-2…5`**
  (`gap: 16px`, `minmax(0, 1fr)` tracks — never bare `1fr`, which floors at
  min-content and causes sideways scroll) for anything side by side.
- Breakpoints: 1400 (5→3 columns), 1100 (4→2, 2/3→1), 900 (two-pane → one),
  860 (task row stacks its buttons under the name).
- Wide content — tables, diagrams — scrolls inside its own
  `overflow-x: auto` container. The page body never scrolls sideways.

---

## 5. Components

| Component | Recipe |
|-----------|--------|
| **Card** | `--surface`, 1px `--border`, `--radius`, `--shadow`. Head `14px 16px 0`, body `14px 16px 16px`. Optional right-aligned `hint` in `--ink-muted`, optional collapsible head with a rotating `chevron` (`transform: rotate(-90deg)` → `0`, 0.14s). |
| **Button** | `padding: 8px 13px`, `--radius-sm`, 1px `--border-strong`, `--surface-raised`, 13.5px/540. `.primary` = accent fill + `filter: brightness(1.06)` on hover. `.ghost` = transparent, no border, `--ink-secondary`. `.danger` = critical text and a 40% critical border. `.sm` = `5px 9px`, 12.5px. Disabled = `opacity: .5`. |
| **Badge** | pill, `border-radius: 20px`, `2px 8px`, 11.5px/560. Tones `good / warning / serious / critical / accent`, each built from one hue via `color-mix` at 10–16% background and 35–45% border. |
| **Segmented control** | `--surface-sunken` trough, 2px padding, 1px border; the active button gets `--surface-raised` + `--shadow`. For 2–4 mutually exclusive views. |
| **Tabs (pill row)** | transparent 999px pills, `7px 13px`, 13px/560; active gets `--surface-raised` + border + shadow. Each carries a count chip that turns accent when it is the active tab and non-zero. |
| **Table** | 13px body; `th` 11.5px uppercase +0.05em `--ink-muted`; 1px `--border` under the head; `.num` right-aligned with tabular figures. |
| **Input / select / textarea** | full width, `8px 10px`, 13.5px, `--surface-raised`, 1px `--border-strong`, `--radius-sm`. Focus: `border-color: --accent` **plus** `box-shadow: 0 0 0 3px var(--accent-wash)` — a ring, not a glow. Label 12px/540 above, 11.5px muted help below. |
| **Modal** | fixed `.scrim` `rgba(11,11,11,.35)`, content aligned to the top with `48px 16px` padding (so a tall dialogue scrolls), panel `min(680px, 100%)`, `border-radius: 12px`, heavy shadow. Head / body / foot; the foot is right-aligned with cancel first, primary last. |
| **Callout** | full-width bar inside the stack, `12px 14px`, tinted with a 6–9% status wash and a 40–45% status border. Used for "sent back" and "late" — things that must not be scrolled past. |
| **Empty state** | centred, `40px 20px`, 13.5px `--ink-muted`, one plain sentence. Never an illustration. |
| **List row** | grid `minmax(0,1fr) auto auto auto`: name + meta, then date, then status, then actions. Only the predictable-width things get fixed columns. Late rows get a 4% critical tint. |
| **Step rail** | four items across; a 22px circle showing `✓` when passed and the step number when not, plus a two-line label (what happened / who and when). Current step gets a 3px accent-wash ring. |
| **Chat bubble** | `max-width: min(560px, 78%)`, `border-radius: 13px`; mine = accent fill with white text, theirs = `--surface-sunken` with a border. Author and relative time in an 11px foot. |
| **Avatar** | initials in a circle, 26px small / 34px default. No photographs. |
| **Count pip** | 16–17px circle, `--critical` fill, white, 10.5px/640. Only for things a person must act on. |

---

## 6. Copy — part of the design, not an afterthought

The tone did as much work as the CSS, so it belongs in the handoff:

- **Name buttons after what the person is doing**, not after the state
  transition: "Mark done", not "Submit for completion".
- **A status says who is holding it**: "With manager" beats "Submitted".
- **The happy path is one click.** Only ask for typing when work goes
  *backwards* — and then require it (a rejection with no reason just stalls).
- **Refusals explain the rule**, in a sentence: "Only the person who owns a task
  can mark it done. That is the point of the two checks that follow."
- **A false affordance is worse than a missing one.** If the API would refuse
  it, the button does not exist — never shown-then-disabled.
- Sentence case, no exclamation marks, no emoji in the interface, numerals for
  numbers, days rather than dates for anything urgent ("9d late", not "15 Aug").

---

## 7. Brief for another chat

> Build the UI to match the A1K design system: no UI framework, no icon library
> and no web font. One CSS file of custom properties; class names are plain and
> semantic.
>
> **Type:** `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`, base
> 14px/1.5. Page title 19px/640 at −0.015em, card title 14px/620, body 13.5px,
> labels and table headers 11.5px/560 uppercase at +0.05em, metadata 12px.
> Weights are 540/560/620/640 — never 700. Negative tracking on large text,
> positive only on small uppercase. Sentence case everywhere. Tabular figures in
> any column of numbers.
>
> **Icons:** Unicode glyphs in `aria-hidden` spans, monochrome, inheriting
> colour and size — `◱` home, `☰` list, `✉` chat, `⚇` people, `⚙` settings,
> `⏻` sign out, `○ ◐ ◕ ●` a filling circle for progress, `⊘` cancelled, `↩`
> sent back, `⇄` reassigned, `↻` reopened, `✎` edited, `✓` done, `⚑` flagged,
> `⏰` overdue. Two are drawn as inline SVG instead — the bell and the
> paperclip — because they must be recognised without a label and the glyphs
> for them render badly or not at all on some systems. Same rule everywhere:
> `stroke="currentColor"`, no fills, so they still take the theme.
>
> **Theme:** light and dark via `data-theme` on `<html>`, dark hand-picked
> rather than inverted. Warm-grey surfaces (`#f9f9f7` plane, `#fcfcfb` card,
> `#f2f2ee` sunken; dark `#0d0d0d` / `#1a1a19` / `#141413`), three ink levels
> (`#0b0b0b`, `#52514e`, `#898781`), alpha borders (`rgba(11,11,11,.10)` and
> `.18`). One accent — `#2a78d6` light, `#3987e5` dark — used only where the
> person can act. Status colours are semantic only: `#0ca30c` good (text
> `#006300`), `#fab219` waiting, `#d03b3b` late or refused, mixed into
> backgrounds with `color-mix(in srgb, var(--x) 10%, transparent)`. Radii 10px
> for cards, 6px for controls. Two-layer soft shadow. A screen with nothing
> wrong on it shows exactly one colour: the accent on the button you should
> press.
>
> **Layout:** CSS grid — 232px sticky sidebar (66px collapsed) plus content at
> `24px 28px 56px`; a 16px flex-column `.stack` is the only vertical rhythm;
> `minmax(0, 1fr)` grid tracks, never bare `1fr`; wide content scrolls in its own
> container, never the page.
>
> **Components:** card, pill badge with five semantic tones, primary/ghost/
> danger buttons, segmented control, pill tabs with count chips, quiet table,
> inputs with a 3px accent-wash focus ring, top-aligned modal over a
> `rgba(11,11,11,.35)` scrim, tinted callouts for anything wrong, one-sentence
> empty states.
>
> **Copy:** name buttons after what the person is doing; a status says who is
> holding the work; the happy path is one click and only backwards moves ask for
> a reason; refusals explain the rule; if the API would refuse it, the button
> does not exist.
