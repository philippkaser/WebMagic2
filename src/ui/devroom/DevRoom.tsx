import { useState, type CSSProperties } from "react";
import { useGame } from "../../state/gameStore";
import { useEscapeClosesOverlay } from "../hooks";
import { FONT, palette, styles as theme } from "../theme";
import { ActionsSection } from "./ActionsSection";
import { ConsumablesSection, EnchantSection, GearSection } from "./ItemSections";
import { EnemySection, TrapSection } from "./SpawnSections";
import { StatsSection } from "./StatsSection";

/** The dev test bench — reached from the village dev slab (dev builds only).
 * Equip any staff/gear, hand yourself items and gold, spawn enemies to fight,
 * flip god mode, and watch derived stats update live. Nothing here is wired
 * for production: the slab that opens it is never mounted on a server build.
 * Each section is its own component reading its own state; only the chosen
 * enchant is shared, so it lives here. */
export function DevRoom() {
  const [affix, setAffix] = useState<string | null>(null);
  useEscapeClosesOverlay();

  return (
    <div style={backdropStyle}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <span style={styles.title}>DEV ROOM</span>
          <span style={styles.tag}>test bench · dev build only</span>
          <button style={theme.closeButton} onClick={() => useGame.getState().setOverlay("none")}>
            ✕
          </button>
        </div>

        <StatsSection />
        <ActionsSection />
        <EnchantSection affix={affix} onChange={setAffix} />
        {(["staff", "amulet", "cloak", "boots"] as const).map((slot) => (
          <GearSection key={slot} slot={slot} affix={affix} />
        ))}
        <ConsumablesSection />
        <EnemySection />
        <TrapSection />

        <div style={styles.footer}>Esc or I closes · changes apply instantly</div>
      </div>
    </div>
  );
}

const backdropStyle: CSSProperties = { ...theme.modalBackdrop, fontFamily: FONT };

/** Green-tinted frame, so the bench never passes for a player-facing screen. */
const styles: Record<string, CSSProperties> = {
  panel: {
    width: "min(94vw, 720px)",
    maxHeight: "92vh",
    overflowY: "auto",
    background: "rgba(12,9,18,0.97)",
    border: "1px solid #3a5a44",
    padding: "16px 20px 12px",
    letterSpacing: 1,
    color: palette.text,
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    gap: 14,
    borderBottom: "1px solid #2f3a34",
    paddingBottom: 10,
    marginBottom: 12,
  },
  title: { fontSize: 18, letterSpacing: 4, color: "#7cff9e", flex: 1 },
  tag: { fontSize: 11, color: palette.dusk },
  footer: { marginTop: 8, fontSize: 10, color: palette.faint, textAlign: "center", letterSpacing: 2 },
};
