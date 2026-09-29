import type { CSSProperties } from "react";
import { useGame } from "../../state/gameStore";
import { FONT, palette, styles } from "../theme";
import { OverlayShell } from "./OverlayShell";

/** Title screen: the premise, your wizard name, the shadows toggle and the
 * control legend. */
export function MenuOverlay() {
  const startGame = useGame((s) => s.startGame);
  const shadows = useGame((s) => s.shadows);
  const toggleShadows = useGame((s) => s.toggleShadows);
  const playerName = useGame((s) => s.playerName);
  const setPlayerName = useGame((s) => s.setPlayerName);
  return (
    <OverlayShell>
      <div style={styles.title}>WEBMAGIC</div>
      <div style={styles.subtitle}>Dungeon of the Hundred Floors</div>
      <p style={styles.blurb}>
        For glory, fame and riches — and to find god at the bottom — the wizards
        of the village step through the portal. One hundred floors down. Leave
        only every fifth floor. Die, and everything you found goes with you.
      </p>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: palette.dim, marginBottom: 5 }}>
          YOUR NAME
        </div>
        <input
          style={nameInputStyle}
          defaultValue={playerName}
          maxLength={16}
          spellCheck={false}
          onBlur={(e) => setPlayerName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation(); // typing must not trigger game hotkeys
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <button style={styles.button} onClick={startGame}>
        ENTER THE VILLAGE
      </button>
      <button
        style={{ ...styles.button, marginTop: 14, fontSize: 13, borderColor: "#5a5560", color: "#b8afa0" }}
        onClick={toggleShadows}
      >
        SHADOWS: {shadows ? "ON" : "OFF"}
      </button>
      <div style={controlsStyle}>
        WASD move · Space jump · Left/Right click cast · Shift dash (cloak) · E interact
        <br />
        I inventory · Q/E use belt items · P fps overlay · O shadows
      </div>
    </OverlayShell>
  );
}

const nameInputStyle: CSSProperties = {
  fontFamily: FONT,
  fontSize: 16,
  letterSpacing: 2,
  padding: "9px 14px",
  background: palette.buttonBg,
  color: palette.bright,
  border: `1px solid ${palette.borderStrong}`,
  textAlign: "center",
  outline: "none",
  width: 220,
};

const controlsStyle: CSSProperties = { marginTop: 26, fontSize: 12, color: palette.dusk, letterSpacing: 1 };
