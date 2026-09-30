import type { ItemInstance } from "../../items/types";
import { ItemCard } from "../components/ItemCard";
import { ItemTooltip, useItemTooltip } from "../components/ItemTooltip";
import type { RunSummary } from "../../state/gameStore";

/** Stats of a finished run as big numerals. */
export function RunStats({ run, tint }: { run: RunSummary; tint?: string }) {
  const stats: [string, number][] = [
    ["Floors survived", run.floorsVisited],
    ["Last floor", run.floor],
    ["Kills", run.kills],
    ["Wizards slain", run.wizardsSlain],
  ];
  return (
    <div className="wm-stats-row">
      {stats.map(([label, n]) => (
        <div key={label} className="wm-record">
          <span className="wm-record__num" style={tint ? { color: tint } : undefined}>
            {n}
          </span>
          <span className="wm-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

/** A row of item cards with hover tooltips (no comparison: these are gone or
 * already banked). */
export function CardRow({ items }: { items: ItemInstance[] }) {
  const { hover, onHover, onLeave } = useItemTooltip();
  return (
    <>
      <div className="wm-cards">
        {items.map((item, i) => (
          <div key={item.uid} className="wm-rise" style={{ animationDelay: `${600 + i * 90}ms` }}>
            <ItemCard item={item} onHover={onHover} onLeave={onLeave} />
          </div>
        ))}
      </div>
      {hover && <ItemTooltip item={hover.item} x={hover.x} y={hover.y} />}
    </>
  );
}
