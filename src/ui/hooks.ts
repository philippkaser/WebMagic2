import { useEffect, useState } from "react";
import { useGame } from "../state/gameStore";

/** Small DOM-side hooks shared by HUD widgets and screens. */

/** Whether the game canvas currently holds the pointer lock. The browser
 * only reports this through `pointerlockchange`, not through any store, so
 * widgets that behave differently in "mouse-look" vs "cursor" mode subscribe
 * here. */
export function usePointerLocked(): boolean {
  const [locked, setLocked] = useState(!!document.pointerLockElement);
  useEffect(() => {
    const update = () => setLocked(!!document.pointerLockElement);
    document.addEventListener("pointerlockchange", update);
    return () => document.removeEventListener("pointerlockchange", update);
  }, []);
  return locked;
}

/** Escape closes the current in-game screen. The browser already spends
 * Escape on releasing the pointer lock, so by the time a screen is open the
 * key is free — and players reach for it to back out of any panel. */
export function useEscapeClosesOverlay(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") useGame.getState().setOverlay("none");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
