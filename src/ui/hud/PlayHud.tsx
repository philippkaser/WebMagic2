import { useGame } from "../../state/gameStore";
import { usePointerLocked } from "../hooks";
import { ArrivalBanner } from "./ArrivalBanner";
import { BossBar } from "./BossBar";
import { Crosshair } from "./Crosshair";
import { EquipStrip } from "./EquipStrip";
import { LocationPanel } from "./LocationPanel";
import { MessageFeed } from "./MessageFeed";
import { Presence } from "./Presence";
import { Prompt } from "./Prompt";
import { Vignettes } from "./Vignettes";
import { Vitals } from "./Vitals";

/** The in-game HUD, laid out around the edges so the centre stays the world:
 *
 *   location · run      presence / boss      messages
 *                         crosshair
 *   vitals               prompt               gear · spells
 */
export function PlayHud() {
  const phase = useGame((s) => s.phase);
  const locked = usePointerLocked();
  return (
    <div className="wm-layer">
      <Vignettes />
      <ArrivalBanner />
      <div className="wm-hud-tl">
        <LocationPanel />
      </div>
      <div className="wm-hud-top">
        {phase === "dungeon" && <Presence />}
        <BossBar />
      </div>
      <MessageFeed />
      {locked && <Crosshair />}
      <Prompt />
      <Vitals />
      <EquipStrip />
    </div>
  );
}
