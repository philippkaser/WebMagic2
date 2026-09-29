/** DOM UI root — everything drawn over the R3F canvas.
 *
 * Layout of src/ui/:
 *   HUD.tsx        this file: global hotkeys + which layers are mounted when
 *   theme.ts       FONT, palette, shared style objects, the one global stylesheet
 *   hooks.ts       small DOM hooks (pointer lock state, Escape-closes-screen)
 *   itemInfo.ts    item glyphs + stat lines (also used outside ui/)
 *   hud/           in-game widgets; hud/PlayHud.tsx lists them (PerfOverlay
 *                  is mounted here instead, since it works in menus too)
 *   overlays/      fullscreen phase screens (menu, portal select, death,
 *                  loading), each wrapped in overlays/OverlayShell
 *   inventory/     inventory / chest / merchant screen (entry: InventoryScreen.tsx)
 *   devroom/       dev-build test bench (entry: DevRoom.tsx)
 *
 * Adding a HUD widget: create hud/MyWidget.tsx as a self-contained component
 * — it reads its own state (useGame / useNet selectors, or a gameEvents
 * subscription), positions itself absolutely (spread `styles.panel` from
 * theme.ts for the standard framed box) — then add one `<MyWidget />` line to
 * hud/PlayHud.tsx. No props flow down from here, on purpose.
 *
 * Adding an overlay: create overlays/MyOverlay.tsx rendering its content
 * inside `<OverlayShell>` (reuse `styles.title/subtitle/blurb/button`), then
 * add one `{condition && <MyOverlay />}` line in the JSX below. The condition
 * is a `phase` for fullscreen phases, or an `overlay` kind (add it to the
 * store's Overlay union) for in-game screens that keep the world running;
 * those screens release the pointer automatically, and can close on Escape
 * with useEscapeClosesOverlay() from hooks.ts. */

import { useEffect, useState, type CSSProperties } from "react";
import { useGame } from "../state/gameStore";
import { DevRoom } from "./DevRoom";
import { PerfOverlay } from "./hud/PerfOverlay";
import { PlayHud } from "./hud/PlayHud";
import { InventoryScreen, isInventoryMode } from "./InventoryScreen";
import { DeathOverlay } from "./overlays/DeathOverlay";
import { LoadingOverlay } from "./overlays/LoadingOverlay";
import { MenuOverlay } from "./overlays/MenuOverlay";
import { SelectOverlay } from "./overlays/SelectOverlay";
import { globalCss, styles } from "./theme";

/** All DOM UI: the in-game HUD, the inventory-family screens, and the
 * fullscreen overlays for menu / portal select / death / loading. */
export function HUD() {
  const phase = useGame((s) => s.phase);
  const overlay = useGame((s) => s.overlay);
  const [showPerf, setShowPerf] = useState(false);

  // Leaving gameplay or opening an overlay always releases the pointer.
  useEffect(() => {
    const playing = phase === "village" || phase === "dungeon";
    if ((!playing || overlay !== "none") && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [phase, overlay]);

  // Global quality/debug hotkeys. Letter keys are primary — macOS reserves
  // F-keys (Mission Control, Spotlight) so they often never reach the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return; // typing a name
      if (e.code === "KeyP" || e.code === "F3") {
        e.preventDefault();
        setShowPerf((v) => !v);
      } else if (e.code === "KeyO" || e.code === "F4") {
        e.preventDefault();
        useGame.getState().toggleShadows();
      } else if (e.code === "KeyI" || e.code === "Tab") {
        const state = useGame.getState();
        if (state.phase !== "village" && state.phase !== "dungeon") return;
        e.preventDefault();
        if (state.overlay === "none") {
          document.exitPointerLock();
          state.setOverlay("inventory");
        } else {
          state.setOverlay("none");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const playing = phase === "village" || phase === "dungeon";
  return (
    <div style={styles.root}>
      <style>{globalCss}</style>
      <div style={buildStampStyle}>{__BUILD_INFO__}</div>
      {showPerf && <PerfOverlay />}
      {playing && <PlayHud />}
      {playing && overlay === "devroom" && import.meta.env.DEV && <DevRoom />}
      {playing && isInventoryMode(overlay) && <InventoryScreen mode={overlay} />}
      {phase === "menu" && <MenuOverlay />}
      {phase === "select" && <SelectOverlay />}
      {phase === "dead" && <DeathOverlay />}
      {phase === "loading" && <LoadingOverlay />}
    </div>
  );
}

/** Which build is this? Bottom-right corner, always visible, barely there. */
const buildStampStyle: CSSProperties = {
  position: "absolute",
  bottom: 2,
  right: 8,
  fontSize: 10,
  letterSpacing: 1,
  color: "#4d4756",
  textShadow: "1px 1px 0 #000",
};
