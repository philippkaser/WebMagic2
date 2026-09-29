import type { CSSProperties } from "react";
import { selectIsHost, useNet } from "../../net/netStore";
import { floorsUntilExit } from "../../run/rules";
import { useGame } from "../../state/gameStore";
import { biomeForFloor, getBiomeDef } from "../../world/biomes";
import { palette, styles } from "../theme";

/** Top-left: where you are (floor and depth band, or the village), how far
 * this run is from the way home, and the connection state — the things you
 * glance at before deciding whether to push on. Deliberately NOT a head
 * count: who else walks this floor is the presence sense's business. */
export function LocationPanel() {
  const phase = useGame((s) => s.phase);
  const floor = useGame((s) => s.floor);
  const floorsPlayed = useGame((s) => s.run?.floorsPlayed ?? 0);
  const deepest = useGame((s) => s.deepest);
  const amHost = useNet(selectIsHost);
  const netMode = useNet((s) => s.mode);
  const owed = floorsUntilExit(floorsPlayed);

  return (
    <div style={{ ...styles.panel, top: 14, left: 14 }}>
      {phase === "dungeon" ? (
        <>
          <div style={{ fontSize: 18, color: palette.bright }}>FLOOR {floor}</div>
          <div style={dimStyle}>{getBiomeDef(biomeForFloor(floor)).name}</div>
          <div style={{ ...dimStyle, color: owed === 0 ? palette.gold : palette.runLoot }}>
            {owed === 0
              ? "✦ the way home is open"
              : `${owed} more floor${owed === 1 ? "" : "s"} before the way home`}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 18, color: palette.bright }}>THE VILLAGE</div>
          <div style={dimStyle}>deepest: {deepest > 0 ? `floor ${deepest}` : "—"}</div>
        </>
      )}
      <div style={{ ...dimStyle, color: netMode === "online" ? "#4fd08a" : palette.dim }}>
        {netMode === "online"
          ? `◉ online${amHost && phase === "dungeon" ? " · host" : ""}`
          : netMode === "offline"
            ? "○ offline"
            : "◌ connecting"}
      </div>
    </div>
  );
}

const dimStyle: CSSProperties = { fontSize: 11, color: palette.dim, marginTop: 2 };
