import type { CSSProperties } from "react";
import { ENEMY_DEFS, type EnemyDef } from "../../combat/enemyRegistry";
import { floorScale } from "../../core/config";
import { useDevRoom } from "../../game/devRoom";
import { playerPosition } from "../../game/player-state";
import { TRAP_DEFS, type TrapDef } from "../../world/trapCatalog";
import { FONT, palette } from "../theme";
import { Section } from "./Section";
import { styles } from "./styles";

/** Enemy spawner: pick the floor level they scale to, drop any enemy beside
 * you, and compare the roster's scaled health at a glance. */
export function EnemySection() {
  const spawnFloor = useDevRoom((s) => s.spawnFloor);
  const spawnCount = useDevRoom((s) => s.spawns.length);

  const spawn = (def: EnemyDef) => {
    const jitter = () => (Math.random() - 0.5) * 2.2;
    useDevRoom
      .getState()
      .spawn(def.id, [playerPosition.x + jitter() + 2, def.spawnY, playerPosition.z + jitter()]);
  };

  return (
    <Section label={`ENEMIES  (${spawnCount} spawned)`}>
      <div style={styles.row}>
        <label style={floorLabelStyle}>
          spawn floor
          <input
            type="number"
            min={1}
            max={100}
            value={spawnFloor}
            onChange={(e) => useDevRoom.getState().setSpawnFloor(Number(e.target.value))}
            onKeyDown={(e) => e.stopPropagation()}
            style={floorInputStyle}
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
  );
}

/** Trap spawner — same table pattern as enemies, sharing the spawn floor. */
export function TrapSection() {
  const spawnFloor = useDevRoom((s) => s.spawnFloor);

  const spawnTrap = (def: TrapDef) => {
    const jitter = () => (Math.random() - 0.5) * 1.6;
    useDevRoom
      .getState()
      .spawnTrap(def.id, [playerPosition.x + jitter() + 2.5, 0, playerPosition.z + jitter()]);
  };

  return (
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
        Traps trigger on contact (spikes, warp) or fire at you (dart). The warp only descends
        inside a real dungeon — here it just shows a message.
      </div>
    </Section>
  );
}

const floorLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  color: palette.dim,
};

const floorInputStyle: CSSProperties = {
  fontFamily: FONT,
  width: 56,
  fontSize: 12,
  padding: "4px 6px",
  background: palette.buttonBg,
  color: palette.bright,
  border: `1px solid ${palette.borderStrong}`,
  textAlign: "center",
};
