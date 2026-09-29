import type { CSSProperties } from "react";
import { getAbility } from "../../combat/abilities";
import { PLAYER } from "../../core/config";
import { allItemDefs, computeStats } from "../../items/catalog";
import { useGame } from "../../state/gameStore";
import { palette } from "../theme";
import { Section } from "./Section";

/** Live vitals and every derived stat, recomputed from the worn gear on each
 * render — so equipping something above shows its effect immediately. */
export function StatsSection() {
  const equipment = useGame((s) => s.equipment);
  const health = useGame((s) => s.health);
  const mana = useGame((s) => s.mana);
  const gold = useGame((s) => s.gold);
  const stats = computeStats(equipment);
  return (
    <Section label="STATS">
      <div style={styles.statGrid}>
        <Stat k="HP" v={`${Math.ceil(health)} / ${Math.round(stats.maxHealth)}`} />
        <Stat k="MP" v={`${Math.ceil(mana)} / ${PLAYER.maxMana}`} />
        <Stat k="Gold" v={`${gold}`} />
        <Stat k="Move speed" v={`${(stats.speedMult * 100).toFixed(0)}%`} />
        <Stat k="Spell dmg" v={`${(stats.damageMult * 100).toFixed(0)}%`} />
        <Stat k="Dmg taken" v={`${(stats.damageTakenMult * 100).toFixed(0)}%`} />
        <Stat k="Mana regen" v={`${(stats.manaRegenMult * 100).toFixed(0)}%`} />
        <Stat k="Notice range" v={`${(stats.aggroMult * 100).toFixed(0)}%`} />
        <Stat k="Jump" v={stats.jump} />
        <Stat k="Dash" v={stats.dash ? "yes" : "no"} />
      </div>
      <div style={styles.abilities}>
        <AbilityLine label="LMB" id={getStaffAbility(equipment, "primary")} mult={stats.damageMult} />
        <AbilityLine label="RMB" id={getStaffAbility(equipment, "secondary")} mult={stats.damageMult} />
      </div>
    </Section>
  );
}

function getStaffAbility(
  equipment: ReturnType<typeof useGame.getState>["equipment"],
  which: "primary" | "secondary",
): string {
  const staff = allItemDefs().find((d) => d.id === equipment.staff.defId.split("+")[0]);
  return (which === "primary" ? staff?.primary : staff?.secondary) ?? "";
}

/** One staff ability with its numbers, noting the gear damage multiplier. */
export function AbilityLine({ label, id, mult }: { label: string; id: string; mult: number }) {
  if (!id) return null;
  const a = getAbility(id);
  const scaled = mult !== 1 ? `  (×${mult.toFixed(2)} dmg)` : "";
  return (
    <div style={styles.abilityLine}>
      <span style={{ color: palette.dim }}>{label}</span> {a.name} — {a.info} · {a.mana} MP ·{" "}
      {a.cooldown}s cd{scaled}
    </div>
  );
}

export function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div style={styles.stat}>
      <span style={{ color: palette.dim }}>{k}</span>
      <span style={{ color: palette.item }}>{v}</span>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: "3px 16px",
    fontSize: 12,
  },
  stat: { display: "flex", justifyContent: "space-between", gap: 8 },
  abilities: { marginTop: 8, paddingTop: 8, borderTop: "1px solid #201c28" },
  abilityLine: { fontSize: 12, color: palette.body, marginBottom: 3 },
};
