import { create } from "zustand";

/** The floor's one rift forks once the Tithe of Five is paid: stepping in,
 * you hang in the void while it tears two ways open — the way down (cyan)
 * and the way home (gold) — and you go where you look. This is the choice's
 * state, between the store (which asks, during the journey's TUNNEL) and
 * the in-world UI (ui3d/layers/ForkChoice), which shows the two tears and
 * reads where you're looking.
 *
 * Before the tithe is paid the home tear is there but sealed — a thin,
 * cracked slit that won't open — and after a breath the rift takes you
 * down on its own: the rule shown, not told. */

export type ForkWay = "deeper" | "home";

export interface ForkState {
  open: boolean;
  /** May the way home be taken (the tithe is paid)? */
  homeOpen: boolean;
  /** Is there a floor below (not the hundredth)? */
  deeperOpen: boolean;
  /** The floor the way down leads to. */
  nextFloor: number;
  /** Floors still owed before home opens (0 when it's open). */
  owed: number;
  /** What the wizard is facing right now (the UI writes it as you look). */
  facing: ForkWay;
  /** performance.now() past which the facing way is taken on its own. */
  deadline: number;
}

export const useFork = create<ForkState>(() => ({
  open: false,
  homeOpen: false,
  deeperOpen: true,
  nextFloor: 2,
  owed: 0,
  facing: "deeper",
  deadline: 0,
}));

/** How long the fork waits when there's a real choice, and when there isn't. */
export const FORK_WAIT_MS = 14_000;
export const SEALED_GLIMPSE_MS = 1_400;

let settle: ((way: ForkWay) => void) | null = null;

/** Hang in the fork until a way is taken. Resolves at once if only one
 * way exists (sealed home or the bottom of the deep). */
export function askFork(opts: { homeOpen: boolean; deeperOpen: boolean; nextFloor: number; owed: number }): Promise<ForkWay> {
  const only: ForkWay | null = !opts.homeOpen ? "deeper" : !opts.deeperOpen ? "home" : null;
  const wait = only ? SEALED_GLIMPSE_MS : FORK_WAIT_MS;
  useFork.setState({
    open: true,
    ...opts,
    facing: only ?? "deeper",
    deadline: performance.now() + wait,
  });
  return new Promise((resolve) => {
    const done = (way: ForkWay) => {
      if (!settle) return;
      settle = null;
      useFork.setState({ open: false });
      resolve(way);
    };
    settle = done;
    setTimeout(() => done(only ?? useFork.getState().facing), wait);
  });
}

/** Take a way now (click, E, the keys). A sealed way can't be taken. */
export function chooseFork(way: ForkWay): void {
  const s = useFork.getState();
  if (!s.open || !settle) return;
  if (way === "home" && !s.homeOpen) return;
  if (way === "deeper" && !s.deeperOpen) return;
  settle(way);
}

/** The UI reports where the wizard is looking. */
export function faceFork(way: ForkWay): void {
  const s = useFork.getState();
  if (!s.open || s.facing === way) return;
  if (way === "home" && !s.homeOpen) return;
  if (way === "deeper" && !s.deeperOpen) return;
  useFork.setState({ facing: way });
}

// Dev-only hook for scripts: take a way without the mouse.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__fork = { choose: chooseFork, state: () => useFork.getState() };
}
