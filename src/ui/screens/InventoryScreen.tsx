import { useMemo, useState } from "react";
import { getItemDef } from "../../items/catalog";
import { itemTitle, slotOf } from "../../items/inventory";
import { computeStats, gearLevel, itemPower } from "../../items/stats";
import { SLOTS, type ItemInstance, type Slot } from "../../items/types";
import { entryRange } from "../../progression/progression";
import { useGame } from "../../state/gameStore";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { EmptySlot, ItemCard } from "../components/ItemCard";
import { ItemTooltip, useItemTooltip } from "../components/ItemTooltip";
import { KeyCap, Panel, Rule } from "../components/Panel";
import { statSheet } from "../itemStats";
import { color } from "../theme";
import { Records } from "./Records";

type Filter = Slot | "all";
const FILTERS: Filter[] = ["all", ...SLOTS];
const SLOT_NAME: Record<Slot, string> = { staff: "Staff", amulet: "Amulet", cloak: "Cloak", boots: "Boots" };
/** Doll layout around the figure: left column, then right column. */
const DOLL: { slot: Slot; col: 1 | 3; row: 1 | 2 }[] = [
  { slot: "amulet", col: 1, row: 1 },
  { slot: "staff", col: 1, row: 2 },
  { slot: "cloak", col: 3, row: 1 },
  { slot: "boots", col: 3, row: 2 },
];

/** Satchel (dungeon) / stash (village): a paper doll of what you wear and a
 * grid of what you own. Click to equip; worn amulets and cloaks can be taken
 * off; in the village, junk can be cast into the void. In the dungeon the
 * game keeps running behind the page. */
export function InventoryScreen() {
  const phase = useGame((s) => s.phase);
  const equipment = useGame((s) => s.equipment);
  const satchel = useGame((s) => s.satchel);
  const stash = useGame((s) => s.stash);
  const equip = useGame((s) => s.equip);
  const unequip = useGame((s) => s.unequip);
  const discard = useGame((s) => s.discard);
  const [filter, setFilter] = useState<Filter>("all");
  const [confirm, setConfirm] = useState<ItemInstance | null>(null);
  const { hover, onHover, onLeave } = useItemTooltip();

  const inVillage = phase === "village";
  const source = inVillage ? "stash" : "satchel";
  const items = inVillage ? stash : satchel;
  const shown = useMemo(
    () =>
      items
        .filter((i) => filter === "all" || slotOf(i) === filter)
        .sort((a, b) => SLOTS.indexOf(slotOf(a)) - SLOTS.indexOf(slotOf(b)) || itemPower(b) - itemPower(a)),
    [items, filter],
  );
  const gear = gearLevel(equipment);
  const [lo, hi] = entryRange(gear);
  const atRisk = [...SLOTS.map((s) => equipment[s]), ...satchel].filter((i) => i?.runLoot).length;

  const hoverWorn = hover && equipment[slotOf(hover.item)]?.uid === hover.item.uid;
  const hint = hover
    ? hoverWorn
      ? slotOf(hover.item) === "amulet" || slotOf(hover.item) === "cloak"
        ? "Click to take it off"
        : undefined
      : "Click to equip"
    : undefined;

  return (
    <div
      className="wm-inv"
      onContextMenu={(e) => e.preventDefault()}
      // Clicking the dimmed world around the book closes it.
      onClick={(e) => e.target === e.currentTarget && useGame.getState().setInventoryOpen(false)}
    >
      <div className="wm-inv__book">
        <Panel solid className="wm-inv__doll" title="Worn">
          <div className="wm-inv__head">
            <span className="wm-inv__h">The Wizard</span>
          </div>
          <div className="wm-doll">
            <div className="wm-doll__fig">
              <Icon name="wizard" tint="#4a3f63" scale={5} />
            </div>
            {DOLL.map(({ slot, col, row }) => {
              const item = equipment[slot];
              const removable = slot === "amulet" || slot === "cloak";
              return (
                <div key={slot} className="wm-doll__slot" style={{ gridColumn: col, gridRow: row }}>
                  {item ? (
                    <ItemCard
                      item={item}
                      onHover={onHover}
                      onLeave={onLeave}
                      onClick={
                        removable
                          ? () => {
                              onLeave();
                              unequip(slot);
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <EmptySlot slot={slot} />
                  )}
                  <span className="wm-label">{SLOT_NAME[slot]}</span>
                </div>
              );
            })}
          </div>
          <Rule />
          <div className="wm-gear">
            <div>
              <div className="wm-label">Gear level</div>
              <div className="wm-dim" style={{ fontSize: 11 }}>
                mean power of all four slots
              </div>
            </div>
            <span className="wm-gear__num">{gear}</span>
          </div>
          {inVillage && (
            <div className="wm-range">
              The rift will cast you to floors{" "}
              <b>
                {lo}–{hi}
              </b>
            </div>
          )}
          <div className="wm-sheet">
            {statSheet(computeStats(equipment)).map((l) => (
              <FragmentPair key={l.label} a={l.label} b={l.value} />
            ))}
          </div>
        </Panel>

        <Panel solid className="wm-inv__grid-panel" title={inVillage ? "Stash" : "Satchel"}>
          <div className="wm-inv__head">
            <span className="wm-inv__h">{inVillage ? "The Stash" : "Satchel"}</span>
            <span className="wm-label">
              {items.length} item{items.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="wm-dim" style={{ fontSize: 12 }}>
            {inVillage
              ? "Everything you have carried home. Safe here, and only here."
              : "What you found this run. Escape to keep it — die, and it stays below."}
          </div>
          <div className="wm-filters">
            {FILTERS.map((f) => (
              <span
                key={f}
                className={`wm-chip${filter === f ? " wm-chip--on" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f !== "all" && <Icon name={f} tint={filter === f ? color.ink : color.parchmentDim} scale={1} />}
                {f === "all" ? "All" : SLOT_NAME[f]}
              </span>
            ))}
          </div>
          <div className="wm-grid">
            {shown.length === 0 && (
              <div className="wm-empty">
                {items.length === 0
                  ? inVillage
                    ? "Your stash is bare. The dungeon is not."
                    : "Nothing yet. Break things; open chests."
                  : "Nothing of that kind."}
              </div>
            )}
            {shown.map((item) => (
              <ItemCard
                key={item.uid}
                item={item}
                onHover={onHover}
                onLeave={onLeave}
                onClick={() => {
                  onLeave();
                  equip(item.uid, source);
                }}
                onDiscard={inVillage ? () => setConfirm(item) : undefined}
              />
            ))}
          </div>
          <div className="wm-inv__foot">
            <span>
              <KeyCap k="Tab" /> <KeyCap k="Esc" /> close · click the world to take control
            </span>
            {inVillage ? (
              <span className="wm-dim">✕ on a card discards it</span>
            ) : (
              <span className="wm-inv__warn">⌛ The dungeon does not wait</span>
            )}
          </div>
          {!inVillage && atRisk > 0 && (
            <div className="wm-label" style={{ color: "#ff9a7a", marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
              <Icon name="hourglass" tint="#ff8e5a" scale={1} /> {atRisk} item{atRisk === 1 ? "" : "s"} at risk until
              you escape
            </div>
          )}
          {inVillage && (
            <div style={{ marginTop: 10 }}>
              <Records />
            </div>
          )}
        </Panel>
      </div>

      {hover && (
        <ItemTooltip item={hover.item} x={hover.x} y={hover.y} equipment={equipment} hint={hint} />
      )}

      {confirm && (
        <div className="wm-modal" onClick={() => setConfirm(null)}>
          <Panel solid frame="blood" className="wm-modal__box">
            <div onClick={(e) => e.stopPropagation()}>
              <div className="wm-inv__h" style={{ fontSize: 30, marginTop: 4 }}>
                Cast into the void?
              </div>
              <div style={{ margin: "10px 0 12px", color: getItemDef(confirm.defId).color }}>
                {itemTitle(confirm)} · Lv {confirm.level}
              </div>
              <div className="wm-dim" style={{ marginBottom: 14 }}>
                It will be gone for good.
              </div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <Button variant="ghost" onClick={() => setConfirm(null)}>
                  Keep it
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    discard(confirm.uid);
                    setConfirm(null);
                  }}
                >
                  Discard
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function FragmentPair({ a, b }: { a: string; b: string }) {
  return (
    <>
      <span>{a}</span>
      <span>{b}</span>
    </>
  );
}
