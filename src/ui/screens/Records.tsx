import { useGame } from "../../state/gameStore";

/** Lifetime records as a row of big blackletter numerals. */
export function Records() {
  const r = useGame((s) => s.records);
  if (r.runs === 0) return null;
  const items: [string, number][] = [
    ["Deepest", r.deepest],
    ["Runs", r.runs],
    ["Escapes", r.extractions],
    ["Deaths", r.deaths],
    ["Wizards slain", r.wizardsSlain],
  ];
  return (
    <div className="wm-records">
      {items.map(([label, n]) => (
        <div key={label} className="wm-record">
          <span className="wm-record__num">{n}</span>
          <span className="wm-label">{label}</span>
        </div>
      ))}
    </div>
  );
}
