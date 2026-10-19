/**
 * The few numbers that say how things stand, set as a quiet strip rather than
 * as coloured blocks: a small caps label over a figure, hairline dividers.
 * Colour sits only on the two figures that ask for action — late (red) and
 * to check (blue).
 */
export default function KpiStrip({ items }) {
  return (
    <div className="kpis" role="list">
      {items.map((i) => (
        <div key={i.label} role="listitem" className={`kpi${i.tone ? ` ${i.tone}` : ''}`}>
          <span className="k">{i.label}</span>
          <b>{i.value}</b>
        </div>
      ))}
    </div>
  );
}

/** Total / Live / Late / To check, from the dashboard's own numbers. */
export function kpiItems(dash) {
  const t = dash.totals;
  return [
    { label: 'Total', value: t.all },
    { label: 'Live', value: t.live },
    { label: 'Late', value: t.overdue, tone: t.overdue > 0 ? 'late' : '' },
    { label: 'To check', value: dash.stalls.withVerifier + dash.stalls.withApprover, tone: 'check' },
  ];
}
