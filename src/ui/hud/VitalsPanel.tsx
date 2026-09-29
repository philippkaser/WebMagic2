import { PLAYER } from "../../core/config";
import { computeStats, resolveItem } from "../../items/catalog";
import type { ItemStack } from "../../items/types";
import { useGame } from "../../state/gameStore";
import { iconOf } from "../itemInfo";
import { palette, styles } from "../theme";

/** Bottom-left: health and mana bars, the purse, and the two belt slots —
 * everything that changes mid-fight, clustered where the eye can flick to it. */
export function VitalsPanel() {
  const health = useGame((s) => s.health);
  const mana = useGame((s) => s.mana);
  const equipment = useGame((s) => s.equipment);
  const belt = useGame((s) => s.belt);
  const gold = useGame((s) => s.gold);
  const runGold = useGame((s) => s.runGold);
  // Max health is derived from worn gear, so it tracks equipment swaps live.
  const stats = computeStats(equipment);

  return (
    <div style={{ ...styles.panel, bottom: 16, left: 14, width: 240 }}>
      <Bar label="HP" value={health} max={stats.maxHealth} color="#d84a4a" />
      <Bar label="MP" value={mana} max={PLAYER.maxMana} color="#4a86d8" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
        <Purse gold={gold} runGold={runGold} />
        <span style={{ display: "flex", gap: 6 }}>
          <BeltSlot hotkey="Q" stack={belt[0]} />
          <BeltSlot hotkey="E" stack={belt[1]} />
        </span>
      </div>
    </div>
  );
}

/** Labeled resource bar with a "current / max" readout. */
export function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: palette.body }}>
        <span>{label}</span>
        <span>
          {Math.ceil(value)} / {Math.round(max)}
        </span>
      </div>
      <div style={{ height: 10, background: palette.well, border: "1px solid #3a333d" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`,
            background: color,
            transition: "width 120ms linear",
          }}
        />
      </div>
    </div>
  );
}

/** Banked gold, plus this run's unbanked haul when there is one — shown
 * apart because death takes it. */
function Purse({ gold, runGold }: { gold: number; runGold: number }) {
  return (
    <span style={{ fontSize: 13, color: palette.gold }}>
      ◈ {gold}
      {runGold > 0 && (
        <span style={{ color: palette.runLoot }} title="Unbanked — lost on death">
          {" "}+{runGold}◦
        </span>
      )}
    </span>
  );
}

/** One belt quick-slot chip: hotkey, item glyph, stack count. */
export function BeltSlot({ hotkey, stack }: { hotkey: string; stack: ItemStack | null }) {
  const item = stack ? resolveItem(stack.defId) : null;
  const def = item?.def ?? null;
  return (
    <span
      title={item ? `${hotkey} — ${item.name}` : `${hotkey} — empty (assign in inventory)`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "1px 5px",
        border: "1px solid #3a333d",
        background: palette.well,
        fontSize: 11,
        color: def ? palette.item : palette.faint,
      }}
    >
      <span style={{ color: palette.dim }}>{hotkey}</span>
      {def ? (
        <>
          <span style={{ color: def.color }}>{iconOf(def)}</span>
          {stack!.qty > 1 && <span>{stack!.qty}</span>}
        </>
      ) : (
        <span>·</span>
      )}
    </span>
  );
}
