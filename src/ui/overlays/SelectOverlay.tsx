import { entryFloors, useGame } from "../../state/gameStore";
import { palette, styles } from "../theme";
import { OverlayShell } from "./OverlayShell";

/** Portal floor picker: start from floor 1 or any checkpoint you've banked
 * at, or back out into the village. */
export function SelectOverlay() {
  const checkpoint = useGame((s) => s.checkpoint);
  const enterDungeon = useGame((s) => s.enterDungeon);
  const closePortalSelect = useGame((s) => s.closePortalSelect);
  return (
    <OverlayShell>
      <div style={styles.subtitle}>CHOOSE YOUR ENTRY FLOOR</div>
      <p style={{ ...styles.blurb, marginTop: 4 }}>
        You may begin from any checkpoint you have banked at.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", maxWidth: 480 }}>
        {entryFloors(checkpoint).map((f) => (
          <button key={f} style={styles.button} onClick={() => void enterDungeon(f)}>
            FLOOR {f}
          </button>
        ))}
      </div>
      <button style={{ ...styles.button, marginTop: 22, borderColor: "#5a5560", color: palette.muted }} onClick={closePortalSelect}>
        STAY IN THE VILLAGE
      </button>
    </OverlayShell>
  );
}
