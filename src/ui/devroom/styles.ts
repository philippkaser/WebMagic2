import type { CSSProperties } from "react";
import { FONT, palette } from "../theme";

/** Dev-room building blocks used by more than one section: list rows,
 * button flavors and hint text. The dev room has its own green-tinted frame
 * (see DevRoom.tsx) so it's never mistaken for a player-facing screen. */
export const styles = {
  row: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
  itemList: { display: "flex", flexDirection: "column", gap: 4, marginTop: 4 },
  itemRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 8px",
    background: palette.inset,
    border: "1px solid #201c28",
    fontSize: 12,
  },
  itemName: { color: palette.item, width: 150 },
  itemDesc: { color: palette.dim, flex: 1, fontSize: 11 },
  tier: { color: palette.dusk, fontSize: 11, width: 22, textAlign: "center" },
  btn: {
    fontFamily: FONT,
    fontSize: 12,
    letterSpacing: 1,
    padding: "6px 12px",
    background: palette.buttonBg,
    color: palette.bright,
    border: `1px solid ${palette.borderStrong}`,
    cursor: "pointer",
  },
  btnGhost: {
    fontFamily: FONT,
    fontSize: 11,
    padding: "4px 10px",
    background: "none",
    color: palette.muted,
    border: `1px solid ${palette.border}`,
    cursor: "pointer",
    marginBottom: 4,
  },
  mini: {
    fontFamily: FONT,
    fontSize: 11,
    padding: "3px 10px",
    background: palette.buttonBg,
    color: palette.bright,
    border: `1px solid ${palette.accent}`,
    cursor: "pointer",
  },
  hint: { marginTop: 6, fontSize: 11, color: palette.faint },
} satisfies Record<string, CSSProperties>;
