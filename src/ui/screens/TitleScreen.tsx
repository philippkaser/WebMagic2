import { RUN } from "../../core/config";
import { useGame } from "../../state/gameStore";
import { useSettings } from "../../state/settings";
import { ArcaneBackdrop } from "../components/ArcaneBackdrop";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { KeyCap, Panel } from "../components/Panel";
import { color } from "../theme";
import { Records } from "./Records";

/** The splash: logo, a breath of lore, the three laws of the dungeon, your
 * name, and the way in. */
export function TitleScreen() {
  const startGame = useGame((s) => s.startGame);
  const shadows = useSettings((s) => s.shadows);
  const toggleShadows = useSettings((s) => s.toggleShadows);
  const playerName = useSettings((s) => s.playerName);
  const setPlayerName = useSettings((s) => s.setPlayerName);

  return (
    <div className="wm-screen">
      <ArcaneBackdrop mood="arcane" cy={0.26} />
      <div className="wm-screen__content">
        <div className="wm-logo">WebMagic</div>
        <div className="wm-tagline">Dungeon of the Hundred Floors</div>
        <p className="wm-lore-p wm-rise" style={{ animationDelay: "200ms" }}>
          Beneath the village, the rift opens onto a hundred floors of hungry dark. Wizards go down for glory, for
          riches — and for the god said to wait at the bottom. Few come back up.
        </p>

        <div className="wm-tenets wm-rise" style={{ animationDelay: "380ms" }}>
          <Panel frame="iron" className="wm-tenet">
            <div className="wm-tenet__head">
              <Icon name="gem" tint={color.brassLight} scale={2} />
              <b>Gear decides depth</b>
            </div>
            The rift weighs your gear and throws you as deep as it thinks you can bear.
          </Panel>
          <Panel frame="iron" className="wm-tenet">
            <div className="wm-tenet__head">
              <Icon name="hourglass" tint="#ff8e5a" scale={2} />
              <b>Survive {RUN.floorsToExtract} floors</b>
            </div>
            Then a homeward rift opens. Die before it, and the dungeon keeps all you found.
          </Panel>
          <Panel frame="iron" className="wm-tenet">
            <div className="wm-tenet__head">
              <Icon name="pact" tint={color.ally} scale={2} />
              <b>Friend or foe</b>
            </div>
            Other wizards walk these halls. Seal a pact — or take what they carry.
          </Panel>
        </div>

        <div className="wm-rise" style={{ animationDelay: "560ms", marginTop: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span className="wm-label">Your name, wizard</span>
            <input
              className="wm-name"
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
          <Button glyphs onClick={startGame}>
            Become the Wizard
          </Button>
          <Button variant="ghost" small onClick={toggleShadows}>
            Shadows: {shadows ? "on" : "off"}
          </Button>
        </div>

        <div className="wm-controls wm-rise" style={{ animationDelay: "700ms", marginTop: 18 }}>
          <span>
            <KeyCap k="W" />
            <KeyCap k="A" />
            <KeyCap k="S" />
            <KeyCap k="D" /> move
          </span>
          <span>
            <KeyCap k="Space" /> jump
          </span>
          <span>
            <KeyCap k="L" mouse />
            <KeyCap k="R" mouse /> cast
          </span>
          <span>
            <KeyCap k="Shift" /> blink
          </span>
          <span>
            <KeyCap k="E" /> interact
          </span>
          <span>
            <KeyCap k="Tab" /> satchel
          </span>
          <span>
            <KeyCap k="P" /> fps
          </span>
          <span>
            <KeyCap k="O" /> shadows
          </span>
        </div>
        <div className="wm-rise" style={{ animationDelay: "820ms", marginTop: 16 }}>
          <Records />
        </div>
      </div>
    </div>
  );
}
