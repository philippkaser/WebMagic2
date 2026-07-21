import { useEffect, useState, type CSSProperties } from "react";
import { getAbility } from "../combat/abilities";
import { floorScale, PLAYER } from "../core/config";
import { allAffixDefs } from "../items/affixes";
import { allItemDefs, computeStats } from "../items/catalog";
import { makeItemId } from "../items/itemId";
import type { GearSlot, ItemDef } from "../items/types";
import { ENEMY_DEFS, type EnemyDef } from "../combat/enemyRegistry";
import { TRAP_DEFS, type TrapDef } from "../world/trapCatalog";
import { useDevRoom } from "../game/devRoom";
import { playerPosition } from "../game/player-state";
import { isDevInvuln, setDevInvuln, useGame } from "../state/gameStore";
import { iconOf } from "./itemInfo";
import { boneButton, fleshPanel, woundTrack } from "./theme";

/** The dev test bench — reached from the village dev slab (dev builds only).
 * Equip any staff/gear, hand yourself items and gold, spawn enemies to fight,
 * flip god mode, and watch derived stats update live. Nothing here is wired
 * for production: the slab that opens it is never mounted on a server build. */
export function DevRoom() {
  const equipment = useGame((s) => s.equipment);
  const health = useGame((s) => s.health);
  const mana = useGame((s) => s.mana);
  const gold = useGame((s) => s.gold);
  const spawnFloor = useDevRoom((s) => s.spawnFloor);
  const spawnCount = useDevRoom((s) => s.spawns.length);
  const [affix, setAffix] = useState<string | null>(null);
  const [invuln, setInvuln] = useState(isDevInvuln());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") useGame.getState().setOverlay("none");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const defs = allItemDefs();
  const bySlot = (slot: string) => defs.filter((d) => d.slot === slot);
  const stats = computeStats(equipment);

  const equipGear = (def: ItemDef) => {
    const slot = def.slot as GearSlot;
    const itemId = makeItemId(def.id, def.slot === "consumable" ? null : affix);
    useGame.setState((s) => {
      const next = { ...s.equipment, [slot]: { defId: itemId, runLoot: false } };
      return { equipment: next, health: computeStats(next).maxHealth };
    });
  };

  const unequip = (slot: Exclude<GearSlot, "staff">) => {
    useGame.setState((s) => {
      const next = { ...s.equipment, [slot]: null };
      return { equipment: next, health: Math.min(s.health, computeStats(next).maxHealth) };
    });
  };

  const addItem = (def: ItemDef) => {
    const itemId = makeItemId(def.id, def.slot === "consumable" ? null : affix);
    useGame.getState().acquireItem(itemId);
  };

  const refill = () => {
    useGame.getState().heal(9999);
    useGame.setState({ mana: PLAYER.maxMana });
  };

  const spawn = (def: EnemyDef) => {
    const jitter = () => (Math.random() - 0.5) * 2.2;
    useDevRoom
      .getState()
      .spawn(def.id, [playerPosition.x + jitter() + 2, def.spawnY, playerPosition.z + jitter()]);
  };

  const spawnTrap = (def: TrapDef) => {
    const jitter = () => (Math.random() - 0.5) * 1.6;
    useDevRoom
      .getState()
      .spawnTrap(def.id, [playerPosition.x + jitter() + 2.5, 0, playerPosition.z + jitter()]);
  };

  const toggleInvuln = () => setInvuln(setDevInvuln(!invuln));

  return (
    <div style={styles.backdrop}>
      <div className="wm-breathe" style={styles.panel}>
        <div style={styles.header}>
          <span style={styles.title}>DEV ROOM</span>
          <span style={styles.tag}>test bench · dev build only</span>
          <button style={styles.close} onClick={() => useGame.getState().setOverlay("none")}>
            ✕
          </button>
        </div>

        {/* Live vitals & derived stats */}
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

        {/* Quick actions */}
        <Section label="ACTIONS">
          <div style={styles.row}>
            <button style={styles.btn} onClick={refill}>
              Full heal + mana
            </button>
            <button
              style={{ ...styles.btn, borderColor: invuln ? "#7cff9e" : "#3f3946" }}
              onClick={toggleInvuln}
            >
              God mode: {invuln ? "ON" : "OFF"}
            </button>
            <button style={styles.btn} onClick={() => useGame.getState().addGold(1000)}>
              +1000 gold
            </button>
          </div>
        </Section>

        {/* Affix selector — applied to any gear you equip or add */}
        <Section label="ENCHANT (applies to gear below)">
          <div style={styles.row}>
            <Chip label="none" on={affix === null} onClick={() => setAffix(null)} />
            {allAffixDefs().map((a) => (
              <Chip
                key={a.id}
                label={a.name}
                title={a.desc}
                on={affix === a.id}
                onClick={() => setAffix(a.id)}
              />
            ))}
          </div>
        </Section>

        {/* Gear — equip (with affix) or drop a copy in the bag */}
        {(["staff", "amulet", "cloak", "boots"] as const).map((slot) => (
          <Section key={slot} label={slot.toUpperCase()}>
            {slot !== "staff" && equipment[slot] && (
              <button style={styles.btnGhost} onClick={() => unequip(slot)}>
                unequip current
              </button>
            )}
            <div style={styles.itemList}>
              {bySlot(slot).map((def) => (
                <div key={def.id} style={styles.itemRow}>
                  <span style={{ color: def.color, width: 18, textAlign: "center" }}>{iconOf(def)}</span>
                  <span style={styles.itemName}>{def.name}</span>
                  <span style={styles.itemDesc}>{def.desc}</span>
                  <span style={styles.tier}>T{def.tier}</span>
                  <button style={styles.mini} onClick={() => equipGear(def)}>
                    equip
                  </button>
                  <button style={styles.miniGhost} onClick={() => addItem(def)}>
                    → bag
                  </button>
                </div>
              ))}
            </div>
          </Section>
        ))}

        {/* Consumables & feathers */}
        <Section label="CONSUMABLES">
          <div style={styles.itemList}>
            {bySlot("consumable").map((def) => (
              <div key={def.id} style={styles.itemRow}>
                <span style={{ color: def.color, width: 18, textAlign: "center" }}>{iconOf(def)}</span>
                <span style={styles.itemName}>{def.name}</span>
                <span style={styles.itemDesc}>{def.desc}</span>
                <button style={styles.mini} onClick={() => addItem(def)}>
                  + add
                </button>
              </div>
            ))}
          </div>
        </Section>

        {/* Enemy spawner */}
        <Section label={`ENEMIES  (${spawnCount} spawned)`}>
          <div style={styles.row}>
            <label style={styles.floorLabel}>
              spawn floor
              <input
                type="number"
                min={1}
                max={100}
                value={spawnFloor}
                onChange={(e) => useDevRoom.getState().setSpawnFloor(Number(e.target.value))}
                onKeyDown={(e) => e.stopPropagation()}
                style={styles.floorInput}
              />
            </label>
            {ENEMY_DEFS.map((def) => (
              <button key={def.id} style={styles.btn} onClick={() => spawn(def)}>
                Spawn {def.name}
              </button>
            ))}
            <button style={styles.btnGhost} onClick={() => useDevRoom.getState().clear()}>
              clear all
            </button>
          </div>
          {/* The roster, straight from the enemy table — compare at a glance. */}
          <div style={styles.itemList}>
            {ENEMY_DEFS.map((def) => (
              <div key={def.id} style={styles.itemRow}>
                <span style={styles.itemName}>{def.name}</span>
                <span style={styles.itemDesc}>{def.desc}</span>
                <span
                  style={{ ...styles.tier, width: 60 }}
                  title={`base ${def.baseHealth} HP × floor ${spawnFloor} scaling`}
                >
                  {Math.round(def.baseHealth * floorScale(spawnFloor).enemyHealth)} HP
                </span>
              </div>
            ))}
          </div>
          <div style={styles.hint}>
            HP shown scales to the spawn floor. Enemies spawn beside you and fight here in the
            village — close this panel (Esc / I) and click to take control.
          </div>
        </Section>

        {/* Trap spawner — same table pattern as enemies */}
        <Section label="TRAPS">
          <div style={styles.row}>
            {TRAP_DEFS.map((def) => (
              <button key={def.id} style={styles.btn} onClick={() => spawnTrap(def)}>
                Place {def.name}
              </button>
            ))}
          </div>
          <div style={styles.itemList}>
            {TRAP_DEFS.map((def) => (
              <div key={def.id} style={styles.itemRow}>
                <span style={styles.itemName}>{def.name}</span>
                <span style={styles.itemDesc}>{def.desc}</span>
                <span
                  style={{ ...styles.tier, width: 60 }}
                  title={`base ${def.baseDamage} dmg × floor ${spawnFloor} scaling`}
                >
                  {def.baseDamage > 0
                    ? `${Math.round(def.baseDamage * floorScale(spawnFloor).enemyDamage)} dmg`
                    : "—"}
                </span>
              </div>
            ))}
          </div>
          <div style={styles.hint}>
            Traps trigger on contact (spikes, warp). The warp only descends inside a real
            dungeon — here it just shows a message.
          </div>
        </Section>

        <div style={styles.footer}>Esc or I closes · changes apply instantly</div>
      </div>
    </div>
  );
}

function getStaffAbility(
  equipment: ReturnType<typeof useGame.getState>["equipment"],
  which: "primary" | "secondary",
): string {
  const staff = allItemDefs().find((d) => d.id === equipment.staff.defId.split("+")[0]);
  return (which === "primary" ? staff?.primary : staff?.secondary) ?? "";
}

function AbilityLine({ label, id, mult }: { label: string; id: string; mult: number }) {
  if (!id) return null;
  const a = getAbility(id);
  const scaled = mult !== 1 ? `  (×${mult.toFixed(2)} dmg)` : "";
  return (
    <div style={styles.abilityLine}>
      <span style={{ color: "#7d7566" }}>{label}</span> {a.name} — {a.info} · {a.mana} MP ·{" "}
      {a.cooldown}s cd{scaled}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionLabel}>{label}</div>
      {children}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div style={styles.stat}>
      <span style={{ color: "#7d7566" }}>{k}</span>
      <span style={{ color: "#ded5c2" }}>{v}</span>
    </div>
  );
}

function Chip({
  label,
  title,
  on,
  onClick,
}: {
  label: string;
  title?: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        ...styles.chip,
        borderColor: on ? "#c9a5ff" : "#4a3830",
        color: on ? "#e8dfc8" : "#b09a90",
        background: on ? "#2a1433" : "#0c0508",
      }}
    >
      {label}
    </button>
  );
}

/** Same grotesque chrome as the player-facing UI (the bench is excepted from
 * nothing) — a slab of hide, wound-cut rows, bone knuckles to press. The dev
 * green stays as the accent so the bench still reads as the bench. */
const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background:
      "radial-gradient(ellipse at 50% 45%, rgba(6,3,8,0.5) 0%, rgba(2,1,4,0.85) 85%)",
    pointerEvents: "auto",
    fontFamily: "'Courier New', monospace",
  },
  panel: {
    width: "min(94vw, 720px)",
    maxHeight: "92vh",
    overflowY: "auto",
    padding: "20px 24px 16px",
    letterSpacing: 1,
    color: "#cfc6b4",
    ...fleshPanel("devbench"),
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    gap: 14,
    borderBottom: "2px solid rgba(0,0,0,0.55)",
    boxShadow: "0 1px 0 rgba(224,212,184,0.08)",
    paddingBottom: 10,
    marginBottom: 12,
  },
  title: { fontSize: 18, letterSpacing: 4, color: "#7cff9e", flex: 1, textShadow: "0 2px 0 rgba(0,0,0,0.85)" },
  tag: { fontSize: 11, color: "#8a7568" },
  close: {
    fontFamily: "'Courier New', monospace",
    fontSize: 14,
    background: "#0c0508",
    color: "#b09a90",
    border: "none",
    boxShadow: "inset 0 0 0 1px #000, 0 0 0 1px rgba(200,180,150,0.25)",
    cursor: "pointer",
    padding: "2px 8px",
  },
  section: { marginBottom: 14 },
  sectionLabel: { fontSize: 11, letterSpacing: 2, color: "#6d8a76", marginBottom: 6, textShadow: "0 1px 0 #000" },
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: "3px 16px",
    fontSize: 12,
  },
  stat: { display: "flex", justifyContent: "space-between", gap: 8 },
  abilities: { marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(0,0,0,0.6)" },
  abilityLine: { fontSize: 12, color: "#c8b8a0", marginBottom: 3 },
  row: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
  itemList: { display: "flex", flexDirection: "column", gap: 4, marginTop: 4 },
  itemRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 8px",
    background: "#0c0508",
    boxShadow: "inset 0 0 0 1px #000, inset 0 2px 4px rgba(0,0,0,0.7), 0 0 0 1px rgba(200,180,150,0.14)",
    fontSize: 12,
  },
  itemName: { color: "#ded5c2", width: 150 },
  itemDesc: { color: "#9a8578", flex: 1, fontSize: 11 },
  tier: { color: "#8a7568", fontSize: 11, width: 22, textAlign: "center" },
  btn: {
    ...boneButton("dev"),
    fontSize: 12,
    padding: "6px 12px",
  },
  btnGhost: {
    fontFamily: "'Courier New', monospace",
    fontSize: 11,
    padding: "4px 10px",
    background: "#0c0508",
    color: "#b09a90",
    border: "none",
    boxShadow: "inset 0 0 0 1px #000, 0 0 0 1px rgba(200,180,150,0.2)",
    cursor: "pointer",
    marginBottom: 4,
  },
  mini: {
    ...boneButton("devmini"),
    fontSize: 11,
    padding: "3px 10px",
    letterSpacing: 1,
  },
  miniGhost: {
    fontFamily: "'Courier New', monospace",
    fontSize: 11,
    padding: "3px 8px",
    background: "#0c0508",
    color: "#b09a90",
    border: "none",
    boxShadow: "inset 0 0 0 1px #000, 0 0 0 1px rgba(200,180,150,0.2)",
    cursor: "pointer",
  },
  chip: {
    fontFamily: "'Courier New', monospace",
    fontSize: 11,
    padding: "4px 10px",
    border: "1px solid #4a3830",
    cursor: "pointer",
  },
  floorLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "#9a8578",
  },
  floorInput: {
    fontFamily: "'Courier New', monospace",
    width: 56,
    fontSize: 12,
    padding: "4px 6px",
    color: "#e8dfc8",
    border: "none",
    ...woundTrack,
    textAlign: "center",
  },
  hint: { marginTop: 6, fontSize: 11, color: "#8a7568" },
  footer: { marginTop: 8, fontSize: 10, color: "#8a7568", textAlign: "center", letterSpacing: 2 },
};
