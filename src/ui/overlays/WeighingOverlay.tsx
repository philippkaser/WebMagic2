import type { CSSProperties } from "react";
import { resolveItem } from "../../items/catalog";
import type { GearSlot } from "../../items/types";
import { RUN } from "../../run/rules";
import { resonanceOf, useGame } from "../../state/gameStore";
import { ITEM_ICONS } from "../itemInfo";
import { palette, styles } from "../theme";
import { OverlayShell } from "./OverlayShell";

const SLOTS: GearSlot[] = ["staff", "amulet", "cloak", "boots"];

/** The Weighing Gate: the village portal reads the resonance of the gear you
 * wear and names the depth it will cast you to. There is no floor to pick —
 * dress deeper to go deeper (or strip down to go shallower). */
export function WeighingOverlay() {
  const equipment = useGame((s) => s.equipment);
  const deepest = useGame((s) => s.deepest);
  const enterDungeon = useGame((s) => s.enterDungeon);
  const closeWeighing = useGame((s) => s.closeWeighing);
  const { gearLevel, entryFloor } = resonanceOf(equipment);

  return (
    <OverlayShell>
      <div style={styles.subtitle}>THE WEIGHING GATE</div>
      <p style={{ ...styles.blurb, marginTop: 6 }}>
        The portal hums and reads what you carry. It does not ask where you wish
        to go — it casts you where your weight belongs.
      </p>
      <div style={gearRowStyle}>
        {SLOTS.map((slot) => {
          const inst = equipment[slot];
          const item = inst ? resolveItem(inst.defId) : null;
          return (
            <div key={slot} style={gearCellStyle} title={item ? item.name : `no ${slot}`}>
              <span style={{ fontSize: 20, color: item ? item.def.color : palette.faint }}>
                {ITEM_ICONS[slot]}
              </span>
              <span style={{ fontSize: 11, color: item ? palette.item : palette.faint }}>
                {item ? `Lv ${item.level}` : "—"}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 13, color: palette.body, letterSpacing: 1 }}>
        resonance {gearLevel.toFixed(1)}
      </div>
      <div style={{ ...styles.title, fontSize: 34, marginTop: 10 }}>FLOOR {entryFloor}</div>
      <p style={{ ...styles.blurb, margin: "10px 0 18px", fontSize: 13 }}>
        The deep lets go only after {RUN.floorsBeforeExit} floors. Die before you find
        the way home, and everything you found stays below.
        {deepest > 0 && (
          <>
            <br />
            <span style={{ color: palette.dim }}>
              Deepest you have walked home from: floor {deepest}.
            </span>
          </>
        )}
      </p>
      <button style={styles.button} onClick={() => void enterDungeon()}>
        STEP THROUGH
      </button>
      <button
        style={{ ...styles.button, marginTop: 14, borderColor: "#5a5560", color: palette.muted }}
        onClick={closeWeighing}
      >
        STAY IN THE VILLAGE
      </button>
    </OverlayShell>
  );
}

const gearRowStyle: CSSProperties = { display: "flex", gap: 10, marginBottom: 10 };

const gearCellStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  width: 58,
  padding: "8px 0",
  background: palette.well,
  border: `1px solid ${palette.borderStrong}`,
};
