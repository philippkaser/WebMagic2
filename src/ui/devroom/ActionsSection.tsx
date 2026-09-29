import { useState } from "react";
import { PLAYER } from "../../core/config";
import { isDevInvuln, setDevInvuln, useGame } from "../../state/gameStore";
import { palette } from "../theme";
import { Section } from "./Section";
import { styles } from "./styles";

/** One-click cheats: refill, god mode, pocket money. */
export function ActionsSection() {
  // God mode is a module flag in the store, not store state, so mirror it
  // locally to re-render the button.
  const [invuln, setInvuln] = useState(isDevInvuln());

  const refill = () => {
    useGame.getState().heal(9999);
    useGame.setState({ mana: PLAYER.maxMana });
  };

  const toggleInvuln = () => setInvuln(setDevInvuln(!invuln));

  return (
    <Section label="ACTIONS">
      <div style={styles.row}>
        <button style={styles.btn} onClick={refill}>
          Full heal + mana
        </button>
        <button
          style={{ ...styles.btn, borderColor: invuln ? "#7cff9e" : palette.borderStrong }}
          onClick={toggleInvuln}
        >
          God mode: {invuln ? "ON" : "OFF"}
        </button>
        <button style={styles.btn} onClick={() => useGame.getState().addGold(1000)}>
          +1000 gold
        </button>
      </div>
    </Section>
  );
}
