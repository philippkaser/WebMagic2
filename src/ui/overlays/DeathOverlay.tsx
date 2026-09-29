import { useGame } from "../../state/gameStore";
import { palette, styles } from "../theme";
import { OverlayShell } from "./OverlayShell";

/** Death screen: where you fell and exactly what the dungeon kept, so the
 * loss is legible rather than a vague "you lost stuff". */
export function DeathOverlay() {
  const lastDeath = useGame((s) => s.lastDeath);
  const respawn = useGame((s) => s.respawn);
  return (
    <OverlayShell>
      <div style={{ ...styles.title, color: "#c23a3a" }}>YOU DIED</div>
      <div style={styles.subtitle}>on floor {lastDeath?.floor ?? "?"}</div>
      {lastDeath && (lastDeath.lostItems.length > 0 || lastDeath.lostGold > 0) ? (
        <p style={styles.blurb}>
          The dungeon keeps what you carried:{" "}
          <span style={{ color: palette.runLoot }}>
            {[
              ...lastDeath.lostItems,
              ...(lastDeath.lostGold > 0 ? [`${lastDeath.lostGold} gold`] : []),
            ].join(", ")}
          </span>
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
