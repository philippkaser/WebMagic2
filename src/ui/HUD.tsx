import { useEffect, useState } from "react";
import { playSatchel } from "../audio/sound";
import { useNet } from "../net/netStore";
import { useGame } from "../state/gameStore";
import { useSettings } from "../state/settings";
import { UiScaleContext, useUiScale } from "./hooks";
import { PerfOverlay } from "./hud/PerfOverlay";
import { PlayHud } from "./hud/PlayHud";
import { usePresenceOmens } from "./hud/Presence";
import { DeathScreen } from "./screens/DeathScreen";
import { ExtractionSummary } from "./screens/ExtractionSummary";
import { InventoryScreen } from "./screens/InventoryScreen";
import { TitleScreen } from "./screens/TitleScreen";
import { installTheme } from "./setup";
import { TransitionLayer } from "./Transitions";

installTheme();

/** Root of all DOM UI. Picks the screen for the current phase, owns the
 * global hotkeys, and zooms the whole chrome by an integer-ish step for the
 * window size so the pixel art stays crisp. Travel stays in-world: the
 * warp/mind-dive shader layer sits above the chrome, unzoomed. */
export function HUD() {
  const phase = useGame((s) => s.phase);
  const inventoryOpen = useGame((s) => s.inventoryOpen);
  const hasSummary = useGame((s) => s.lastExtraction !== null);
  const [showPerf, setShowPerf] = useState(false);
  const scale = useUiScale();
  const playing = phase === "village" || phase === "dungeon";
  usePresenceOmens();

  // Leaving gameplay always releases the pointer. Warping between floors
  // ("loading") is gameplay: the pointer stays locked through the tunnel.
  useEffect(() => {
    if (!playing && phase !== "loading" && document.pointerLockElement) document.exitPointerLock();
  }, [phase, playing]);

  // Global hotkeys. Letter keys are primary — macOS reserves F-keys
  // (Mission Control, Spotlight) so they often never reach the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return; // typing a name
      const g = useGame.getState();
      if (e.code === "KeyP" || e.code === "F3") {
        e.preventDefault();
        setShowPerf((v) => !v);
      } else if (e.code === "Tab" || e.code === "KeyI") {
        e.preventDefault();
        if (g.phase !== "village" && g.phase !== "dungeon") return;
        const open = !g.inventoryOpen;
        g.setInventoryOpen(open);
        playSatchel(open);
        if (open) document.exitPointerLock();
      } else if (e.code === "Escape" && g.inventoryOpen) {
        g.setInventoryOpen(false);
        playSatchel(false);
      } else if (e.code === "KeyO" || e.code === "F4") {
        e.preventDefault();
        useSettings.getState().toggleShadows();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <UiScaleContext.Provider value={scale}>
      <div className="wm-root" style={{ zoom: scale }}>
        {playing && <PlayHud />}
        {playing && inventoryOpen && <InventoryScreen />}
        {phase === "village" && hasSummary && <ExtractionSummary />}
        {phase === "menu" && <TitleScreen />}
        {phase === "dead" && <DeathScreen />}
        {showPerf && <PerfOverlay />}
        <div className="wm-stamp">{__BUILD_INFO__}</div>
      </div>
      <div className="wm-root" style={{ zIndex: 11 }}>
        <TransitionLayer />
        <div className="wm-scan" />
      </div>
    </UiScaleContext.Provider>
  );
}

// Dev-only hook for end-to-end scripts (presence / pact states).
if (import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__net = useNet;
}
