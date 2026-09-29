import type { CSSProperties } from "react";
import { useCodex } from "../../state/codex";
import { useGame } from "../../state/gameStore";
import { biomeForFloor, getBiomeDef } from "../../world/biomes";
import { allLoreFragments, getLoreFragment } from "../../world/lore";
import { useEscapeClosesOverlay } from "../hooks";
import { FONT, palette, styles } from "../theme";

/** The codex (C): every carving you've read, in the order you found them,
 * each tagged with the depth band it speaks from. Unread fragments are only
 * a count — the rest of the story has to be walked to. */
export function CodexScreen() {
  const read = useCodex((s) => s.read);
  const setOverlay = useGame((s) => s.setOverlay);
  useEscapeClosesOverlay();
  const total = allLoreFragments().length;

  return (
    <div style={styles.modalBackdrop} onClick={() => setOverlay("none")}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={{ letterSpacing: 4, color: "#b89cff" }}>THE CODEX</span>
          <span style={{ fontSize: 12, color: palette.dim }}>
            {read.length} / {total} carvings read
          </span>
          <button style={styles.closeButton} onClick={() => setOverlay("none")}>
            ✕
          </button>
        </div>
        <div style={listStyle}>
          {read.length === 0 && (
            <p style={{ ...styles.blurb, margin: "30px auto" }}>
              You have read nothing yet. The walls down there are not silent — look for the
              faint violet glow of a carving, and press E.
            </p>
          )}
          {read.map((id) => {
            const f = getLoreFragment(id);
            return (
              <div key={id} style={entryStyle}>
                <div style={entryTitleStyle}>
                  {f.title}
                  <span style={{ color: palette.faint }}> · {getBiomeDef(biomeForFloor(f.minFloor)).name}</span>
                </div>
                <div style={entryTextStyle}>{f.text}</div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: palette.faint, marginTop: 8 }}>C or Esc — close</div>
      </div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  width: "min(640px, 90vw)",
  maxHeight: "80vh",
  display: "flex",
  flexDirection: "column",
  padding: "14px 18px",
  background: "rgba(12,8,20,0.96)",
  border: "1px solid #4a3a6a",
  fontFamily: FONT,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 10,
};

const listStyle: CSSProperties = { overflowY: "auto", paddingRight: 6 };

const entryStyle: CSSProperties = {
  padding: "10px 12px",
  marginBottom: 8,
  background: palette.inset,
  borderLeft: "2px solid #6a52a0",
};

const entryTitleStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: 2,
  color: "#b89cff",
  marginBottom: 5,
  textTransform: "uppercase",
};

const entryTextStyle: CSSProperties = {
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontStyle: "italic",
  fontSize: 14,
  lineHeight: 1.55,
  color: palette.item,
};
