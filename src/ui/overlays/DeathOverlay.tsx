import { useGame } from "../../state/gameStore";
import { palette, styles } from "../theme";
import { OverlayShell } from "./OverlayShell";

/** Death screen: where you fell, who (if anyone) killed you, and exactly
 * what you lost — and whether it's gone for good or waiting in a grave that
 * someone else may plunder. The loss should be legible, not a vague shrug. */
export function DeathOverlay() {
  const lastDeath = useGame((s) => s.lastDeath);
  const respawn = useGame((s) => s.respawn);
  const lost = lastDeath
    ? [...lastDeath.lostItems, ...(lastDeath.lostGold > 0 ? [`${lastDeath.lostGold} gold`] : [])]
    : [];
  return (
    <OverlayShell>
      <div style={{ ...styles.title, color: "#c23a3a" }}>YOU DIED</div>
      <div style={styles.subtitle}>
        on floor {lastDeath?.floor ?? "?"}
        {lastDeath?.killer && <> · slain by {lastDeath.killer}</>}
      </div>
      {lost.length > 0 ? (
        <p style={styles.blurb}>
          {lastDeath?.grave
            ? "Other wizards stood witness, and the dungeon could not swallow it all. Your grave holds "
            : "The dungeon keeps what you carried: "}
          <span style={{ color: palette.runLoot }}>{lost.join(", ")}</span>
          {lastDeath?.grave && " — for whoever reaches it first."}
        </p>
      ) : (
        <p style={styles.blurb}>You carried nothing the dungeon could take.</p>
      )}
      <button style={styles.button} onClick={respawn}>
        RETURN TO THE VILLAGE
      </button>
    </OverlayShell>
  );
}
