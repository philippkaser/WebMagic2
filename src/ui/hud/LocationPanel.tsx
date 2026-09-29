import type { CSSProperties } from "react";
import { floorPlayerCount, selectIsHost, useNet } from "../../net/netStore";
import { useGame } from "../../state/gameStore";
import { palette, styles } from "../theme";

/** Top-left: where you are (floor + instance, or the village), your deepest
 * checkpoint, and the connection state — the three things you glance at
 * before deciding whether to push on. */
export function LocationPanel() {
  const phase = useGame((s) => s.phase);
  const floor = useGame((s) => s.floor);
  const instanceId = useGame((s) => s.instanceId);
  const checkpoint = useGame((s) => s.checkpoint);
  const floorPlayers = useNet(floorPlayerCount);
  const amHost = useNet(selectIsHost);
  const netMode = useNet((s) => s.mode);

  return (
    <div style={{ ...styles.panel, top: 14, left: 14 }}>
      {phase === "dungeon" ? (
        <>
          <div style={{ fontSize: 18, color: palette.bright }}>FLOOR {floor}</div>
          <div style={dimStyle}>
            instance {instanceId || "—"}
            {netMode === "online" &&
              ` · ${floorPlayers} wizard${floorPlayers === 1 ? "" : "s"}`}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 18, color: palette.bright }}>THE VILLAGE</div>
      )}
      <div style={dimStyle}>checkpoint: floor {checkpoint}</div>
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
