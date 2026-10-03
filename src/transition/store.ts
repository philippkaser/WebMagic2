import { create } from "zustand";
import { TRAVEL_STYLES, type TravelKind, type TravelStage } from "./timeline";

/** The journey in progress, if any. Written by the orchestrator (travel.ts)
 * at stage boundaries; read by the renderer (TransitionSystem) every frame
 * with getState(). React components may select `stage`/`kind` (they change a
 * handful of times per journey) but should never select `progress`, which is
 * frame-hot. */
export interface TravelState {
  stage: TravelStage;
  kind: TravelKind;
  /** The journey's base colour (TRAVEL_STYLES[kind].color). */
  color: string;
  /** 0…1 through the current stage — refreshed every rendered frame while a
   * journey runs (the timers in travel.ts are the source of truth; this is
   * their visible reading). */
  progress: number;
  /** performance.now() when the stage began, and its planned length (ms).
   * The tunnel's length is its minimum beat; it may run longer while a slow
   * scene switch finishes. */
  stageStart: number;
  stageMs: number;
  /** Ring centre of the portal being entered, when there is one — the view
   * is pulled toward it and the vortex opens around it. */
  focus: [number, number, number] | null;
}

export const useTravel = create<TravelState>(() => ({
  stage: "idle",
  kind: "descend",
  color: TRAVEL_STYLES.descend.color,
  progress: 0,
  stageStart: 0,
  stageMs: 0,
  focus: null,
}));

/** Dev-only: a frozen (stage, kind, progress) the renderer shows instead of
 * the live journey — for screenshots and tuning in slow software GL, where a
 * real 0.9 s ENTER is two or three frames. */
export interface TravelFreeze {
  stage: TravelStage;
  kind: TravelKind;
  progress: number;
  /** Also freeze the shader clock at this time (seconds), for repeatable
   * stills. Omitted = the vortex keeps moving. */
  time?: number;
}

let freeze: TravelFreeze | null = null;

export function setTravelFreeze(f: TravelFreeze | null): void {
  freeze = f;
}

export function getTravelFreeze(): TravelFreeze | null {
  return freeze;
}
