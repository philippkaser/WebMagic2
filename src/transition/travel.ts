import { playerPosition } from "../game/player-state";
import { nearestPortalAnchor } from "./portals";
import { setTravelFreeze, useTravel, type TravelFreeze } from "./store";
import { TRAVEL_STYLES, type TravelKind, type TravelStage } from "./timeline";

/** The journey orchestrator: plays ENTER, runs the scene switch under the
 * TUNNEL, then plays ARRIVE.
 *
 *   await travel("descend", async () => { …request the floor, set phase… });
 *
 * The switch is the caller's own logic, untouched — travel only decides WHEN
 * it runs (once the tunnel covers the view, so a floor mounting or a scene
 * swapping is never seen) and makes the tunnel last at least one beat however
 * fast the switch is. The returned promise settles after ARRIVE, so a caller
 * that awaits an action awaits the whole journey (well under 2 s of overhead;
 * see timeline.ts).
 *
 * Only ENTER and TUNNEL are exclusive: a journey that starts while another is
 * ARRIVING cuts the arrival short and begins its own ENTER (dying moments
 * after stepping out of a portal must still play the death). A switch asked
 * for mid-ENTER/TUNNEL — which the store's guards prevent — is run
 * immediately rather than dropped: game logic always wins over presentation. */

export interface TravelDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Resolves once the switched-to scene has actually been drawn a few
   * times (bounded by a timeout), so ARRIVE never plays over a mount hitch. */
  settle(): Promise<void>;
  setStage(stage: TravelStage, kind: TravelKind, ms: number): void;
}

export interface Traveler {
  travel(kind: TravelKind, doSwitch: () => void | Promise<void>): Promise<void>;
  /** True from the start of ENTER until ARRIVE begins. */
  isTraveling(): boolean;
}

export function createTraveler(deps: TravelDeps): Traveler {
  let inFlight = false;
  let generation = 0;

  return {
    isTraveling: () => inFlight,

    async travel(kind, doSwitch) {
      if (inFlight) {
        await doSwitch();
        return;
      }
      const mine = ++generation;
      const style = TRAVEL_STYLES[kind];
      inFlight = true;
      try {
        deps.setStage("entering", kind, style.enterMs);
        await deps.sleep(style.enterMs);
        deps.setStage("tunnel", kind, style.minTunnelMs);
        const tunnelStart = deps.now();
        await doSwitch();
        await deps.settle();
        const left = style.minTunnelMs - (deps.now() - tunnelStart);
        if (left > 0) await deps.sleep(left);
      } catch (err) {
        // A failed switch shouldn't leave the view sealed in a tunnel.
        if (generation === mine) deps.setStage("idle", kind, 0);
        throw err;
      } finally {
        inFlight = false;
      }
      deps.setStage("arriving", kind, style.arriveMs);
      await deps.sleep(style.arriveMs);
      if (generation === mine) deps.setStage("idle", kind, 0);
    },
  };
}

// ── The game's traveler ──────────────────────────────────────────────────────

/** Rendered-frame counter, ticked by TransitionSystem, so "settled" can mean
 * "the new scene has really been drawn" rather than a guess in ms. */
let frameNo = 0;
const frameWaiters: { at: number; resolve: () => void }[] = [];

/** Called once per rendered frame by TransitionSystem. */
export function markTravelFrame(): void {
  frameNo++;
  for (let i = frameWaiters.length - 1; i >= 0; i--) {
    if (frameWaiters[i].at <= frameNo) {
      frameWaiters[i].resolve();
      frameWaiters.splice(i, 1);
    }
  }
}

/** Wait for `frames` rendered frames — or `timeoutMs`, so a hidden tab (no
 * rAF) or a missing renderer can never strand a journey. */
function waitFrames(frames: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const waiter = { at: frameNo + frames, resolve };
    frameWaiters.push(waiter);
    setTimeout(() => {
      const i = frameWaiters.indexOf(waiter);
      if (i >= 0) frameWaiters.splice(i, 1);
      resolve();
    }, timeoutMs);
  });
}

/** How close (m) the player must be to a portal for the journey to open
 * around it. Portals offer their prompt within ~2.6 m. */
const FOCUS_RANGE = 4.5;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const traveler = createTraveler({
  now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  settle: () => waitFrames(3, 1500),
  setStage(stage, kind, ms) {
    const style = TRAVEL_STYLES[kind];
    let focus = useTravel.getState().focus;
    if (stage === "entering") {
      focus = null;
      // A feather opens its own vortex around you; portals pull you in.
      if (style.look === "portal" && kind !== "feather") {
        const anchor = nearestPortalAnchor(playerPosition.x, playerPosition.z, FOCUS_RANGE);
        if (anchor) {
          focus = [anchor.x, anchor.y, anchor.z];
          anchor.surge();
        }
      }
    } else if (stage === "idle") {
      focus = null;
    }
    useTravel.setState({
      stage,
      kind,
      color: style.color,
      progress: 0,
      stageStart: now(),
      stageMs: ms,
      focus,
    });
  },
});

/** Play a journey of `kind` around `doSwitch` (see the module comment). */
export const travel = traveler.travel;
/** True while a journey's ENTER or TUNNEL is playing — scene-switching
 * actions refuse to start a second one. */
export const isTraveling = traveler.isTraveling;

/** A whole-journey progress (0…1) as the (stage, progress) it falls in. */
export function previewFreeze(kind: TravelKind, progress: number, time?: number): TravelFreeze {
  const s = TRAVEL_STYLES[kind];
  const t = Math.min(Math.max(progress, 0), 1) * (s.enterMs + s.minTunnelMs + s.arriveMs);
  if (t < s.enterMs) return { stage: "entering", kind, progress: t / s.enterMs, time };
  if (t < s.enterMs + s.minTunnelMs) return { stage: "tunnel", kind, progress: (t - s.enterMs) / s.minTunnelMs, time };
  return { stage: "arriving", kind, progress: (t - s.enterMs - s.minTunnelMs) / s.arriveMs, time };
}

// Dev-only hook: freeze/scrub the visuals for screenshots and tuning.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__travel = {
    freeze: (stage: TravelStage, kind: TravelKind, progress: number, time?: number) => {
      const f: TravelFreeze = { stage, kind, progress, time };
      setTravelFreeze(f);
    },
    thaw: () => setTravelFreeze(null),
    /** Freeze at `progress` (0…1) through the WHOLE journey — ENTER, the
     * tunnel's minimum beat, ARRIVE — like the artpass branch's
     * __previewTransition(mode, progress). */
    preview: (kind: TravelKind, progress: number, time?: number) => setTravelFreeze(previewFreeze(kind, progress, time)),
    state: () => useTravel.getState(),
    isTraveling,
  };
  /** Artpass parity: scrub a journey by one 0…1 progress (thaw with
   * __travel.thaw()). Mode 0 was its warp → a descent here, mode 1 its
   * mind-dive → the gate. */
  (window as unknown as Record<string, unknown>).__previewTransition = (
    mode: 0 | 1 | TravelKind,
    progress: number,
  ) => setTravelFreeze(previewFreeze(mode === 0 ? "descend" : mode === 1 ? "gate" : mode, progress));
}
