import { createContext, useEffect, useRef, useState } from "react";
import { gameEvents, type GameEvents } from "../core/events";
import { uiScaleFor } from "./theme";

/** Subscribe to a game event for the component's lifetime. The latest
 * handler is always called, so callers can close over fresh state. */
export function useGameEvent<K extends keyof GameEvents>(event: K, handler: (payload: GameEvents[K]) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => gameEvents.on(event, (p) => ref.current(p)), [event]);
}

export function usePointerLocked(): boolean {
  const [locked, setLocked] = useState(() => !!document.pointerLockElement);
  useEffect(() => {
    const update = () => setLocked(!!document.pointerLockElement);
    document.addEventListener("pointerlockchange", update);
    return () => document.removeEventListener("pointerlockchange", update);
  }, []);
  return locked;
}

/** The CSS zoom applied to the chrome root: mouse coordinates must be divided
 * by it to position things inside the zoomed tree. */
export const UiScaleContext = createContext(1);

/** Chrome scale for the current window (see theme.uiScaleFor). */
export function useUiScale(): number {
  const [scale, setScale] = useState(() => uiScaleFor(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const update = () => setScale(uiScaleFor(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return scale;
}

/** Re-render every `ms` while `active` — for polled, non-reactive sources
 * (peer positions live in the session, not a store). */
export function useTicker(ms: number, active = true): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms, active]);
  return tick;
}
