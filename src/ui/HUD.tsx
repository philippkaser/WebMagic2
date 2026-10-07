/** DOM UI root — everything drawn over the R3F canvas.
 *
 * Layout of src/ui/:
 *   HUD.tsx        this file: global hotkeys + which layers are mounted when
 *   theme.ts       FONT, palette, shared style objects, the one global stylesheet
 *   hooks.ts       small DOM hooks (pointer lock state, Escape-closes-screen)
 *   itemInfo.ts    item glyphs + stat lines (also used outside ui/)
 *   hud/           the perf overlay (mounted here: it works in menus too). The
 *                  in-game HUD itself lives in the world — ui3d/layers/hud/
 *   (the menu, the Weighing, death, the codex, the inventory family and
 *    loading are in-world now — see ui3d/layers/ and transition/)
 *   devroom/       dev-build test bench (entry: DevRoom.tsx)
 *
 * Adding a HUD widget: the HUD is in-world now — see ui3d/layers/hud/Hud.tsx
 * (one file per piece in that folder, one line in its list).
 *
 * Adding a screen: screens are in-world now — see ui3d/layers/menus/ (a
 * file per screen, listed in Menus.tsx). The condition is a `phase` for
 * fullscreen phases, or an `overlay` kind (add it to the store's Overlay
 * union) for in-game screens that keep the world running; those screens
 * release the pointer automatically (below), and can close on Escape with
 * useEscapeClosesOverlay() from hooks.ts. */

import { useEffect, useState, type CSSProperties } from "react";
import { useMapCast } from "../ui3d/layers/map/mapStore";
import { useGame } from "../state/gameStore";
import { DevRoom } from "./DevRoom";
import { PerfOverlay } from "./hud/PerfOverlay";
import { globalCss, styles } from "./theme";

/** All DOM UI that isn't part of the fiction yet: the
 * inventory-family screens, the dev room, the perf overlay and the build
 * stamp. (The menu, the Weighing, death and the codex live in the world —
 * ui3d/layers/menus/ — and loading is the portal tunnel, transition/.) */
export function HUD() {
  const phase = useGame((s) => s.phase);
  const overlay = useGame((s) => s.overlay);
  const [showPerf, setShowPerf] = useState(false);

  // Leaving gameplay or opening an overlay always releases the pointer.
  useEffect(() => {
    // A portal journey ("loading": the vortex tunnel) keeps the lock — you
    // fly through the tunnel still looking around, and land in control.
    const holdsLock = phase === "village" || phase === "dungeon" || phase === "loading";
    if ((!holdsLock || overlay !== "none") && document.pointerLockElement) {
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
      } else if (e.code === "KeyB") {
        e.preventDefault();
        useGame.getState().toggleMotionBlur();
      } else if (e.code === "KeyC") {
        const state = useGame.getState();
        if (state.phase !== "village" && state.phase !== "dungeon") return;
        e.preventDefault();
        if (state.overlay === "none") {
          document.exitPointerLock();
          state.setOverlay("codex");
        } else if (state.overlay === "codex") {
          state.setOverlay("none");
        }
      } else if (e.code === "KeyM") {
        const state = useGame.getState();
        if ((state.phase !== "dungeon" && state.phase !== "village") || state.overlay !== "none") return;
        e.preventDefault();
        useMapCast.getState().toggle();
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
      {playing && overlay === "devroom" && import.meta.env.DEV && <DevRoom />}
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
