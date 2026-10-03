import { useGame } from "../../../state/gameStore";
import { UiPresence, UiShow } from "../../presence";
import { Belt } from "./Belt";
import { BossBar } from "./BossBar";
import { Crosshair } from "./Crosshair";
import "./devHooks";
import { Equipment } from "./Equipment";
import { HurtVignette } from "./HurtVignette";
import { Location } from "./Location";
import { LoreTablet } from "./LoreTablet";
import { PactPrompt } from "./PactPrompt";
import { PresenceEye } from "./PresenceEye";
import { Purse } from "./Purse";
import { Vitals } from "./Vitals";

/** The in-game HUD, rebuilt in the world: every piece is a physical thing
 * carried in front of the eye or hung where it belongs — flasks, coins,
 * stones, runes — lit by the UI torch and sized by the screen's height.
 *
 * Shown while playing (village or dungeon), whether or not the pointer is
 * locked. While an overlay screen is open (inventory, codex…) the HUD steps
 * back: text burns off, objects shrink away, anchors sink toward their edge;
 * it all rebuilds when the screen closes. The hurt vignette stays live
 * underneath a screen — the world doesn't pause, and neither do its blows.
 *
 * Like PlayHud before it, deliberately just a list: each piece is one file
 * in this folder that reads its own state and places itself (layout.ts). */

/** Seconds the HUD needs to finish its exit before it may unmount (a
 * breaking tablet is the slowest part). */
const HUD_EXIT = 1.3;

export function Hud() {
  const phase = useGame((s) => s.phase);
  const overlay = useGame((s) => s.overlay);
  const playing = phase === "village" || phase === "dungeon";
  return (
    <UiPresence show={playing} exit={HUD_EXIT}>
      <HurtVignette />
      <UiShow show={overlay === "none"}>
        <Crosshair />
        <BossBar />
        <Location />
        <Vitals />
        <Purse />
        <Belt />
        <Equipment />
        <PresenceEye />
        <LoreTablet />
        <PactPrompt />
      </UiShow>
    </UiPresence>
  );
}
