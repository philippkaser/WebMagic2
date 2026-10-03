/** Portal travel — the pure timeline.
 *
 * Every scene switch (the Weighing Gate, a descent, the way home, a feather,
 * a death, a respawn) plays the same three-beat shape, drawn in the gritty
 * pixel style of the rifts themselves (ported from the artpass warp):
 *
 *   ENTER    the view is pulled in (FOV stretch, roll) while the rift's tear
 *            rips open over the screen and you are SUCKED IN — the starry
 *            void behind it spins up, streaks screaming past
 *   TUNNEL   you HOVER in a dark parallel world of blocky stars drifting past
 *            (sinking on the way down, rising on the way home) while the next
 *            place loads — at least one beat, however fast the switch is
 *   ARRIVE   you are SPAT OUT: the void kicks outward, surges back into the
 *            rift's colour and flashes, and a tear rips open at the centre
 *            onto the new place while the camera settles
 *
 * This module is the math of that shape, and nothing else: per-kind styles,
 * easing, and two samplers that turn (stage, progress) into camera and
 * overlay numbers. No three.js, no React, no clocks — the orchestrator
 * (travel.ts) owns time, the renderer (TransitionSystem.tsx) owns pixels, and
 * this file can be unit-tested exhaustively (timeline.test.ts). The samplers
 * write into caller-owned objects so the frame loop allocates nothing. */

export type TravelKind = "gate" | "descend" | "home" | "feather" | "death" | "respawn";
export type TravelStage = "idle" | "entering" | "tunnel" | "arriving";

/** How ENTER looks. `portal`: the view is sucked into a vortex (centred on
 * the portal when there is one). `dissolve`: death — the world burns away
 * into black-red embers, no vortex. `fromDark`: respawn — ENTER starts from
 * the black of the death screen and brightens into the tunnel. */
export type TravelLook = "portal" | "dissolve" | "fromDark";

export interface TravelStyle {
  /** Base colour of the warp: its stars, streaks and the tear's rim. */
  color: string;
  /** Hot highlight: the rim, streak heads, the light at the tunnel's end. */
  hot: string;
  /** Deep shade between the bands (hue-shifted so the tunnel has depth). */
  deep: string;
  look: TravelLook;
  enterMs: number;
  /** The tunnel lasts at least this long after ENTER, even if the scene
   * switch is instant — one full beat of flight sells the journey. */
  minTunnelMs: number;
  arriveMs: number;
  /** FOV multiplier at the end of ENTER (>1 stretches, <1 is tunnel vision). */
  fovKick: number;
  /** Camera roll (radians) at the end of ENTER; the sign is the swirl's spin. */
  roll: number;
  /** How far (m) the camera is dragged toward the portal during ENTER. */
  pull: number;
  /** Vertical camera travel during ENTER (m): + lifts (feather), − collapses
   * (death). */
  lift: number;
  // Tunnel flavour, passed straight to the shader (all roughly 0…1+).
  /** Swirl twist speed of the tunnel walls. */
  spin: number;
  /** Flight speed down the tunnel. */
  speed: number;
  /** Density of the light streaks rushing past. */
  streaks: number;
  /** Glyph ring bands rushing past (the Weighing reads you on the way down). */
  rings: number;
  /** Soft drifting feathers instead of (some of) the hard streaks. */
  feathers: number;
  /** Which way the starry void drifts past while you hover: +1 you sink
   * (down into the deep), −1 you rise (home, and back from death). */
  drift: 1 | -1;
}

/** One beat of hovering in the starry void is what sells the journey (the
 * artpass warp's middle); the pull-in and the spit-out stay brisk. */
const PORTAL_BEATS = { enterMs: 850, minTunnelMs: 450, arriveMs: 650 } as const;

/** The six journeys. Colours follow the portals themselves: cyan descends,
 * gold walks home; the feather is a paler, softer gold; death is black-red
 * and the way back from it a pale spirit-blue. */
export const TRAVEL_STYLES: Record<TravelKind, TravelStyle> = {
  gate: {
    color: "#46ffd0",
    hot: "#e6fff8",
    deep: "#0b2a5c",
    look: "portal",
    ...PORTAL_BEATS,
    enterMs: 880,
    fovKick: 1.55,
    roll: 0.55,
    pull: 1.6,
    lift: 0,
    spin: 1,
    speed: 1.15,
    streaks: 0.8,
    rings: 1,
    feathers: 0,
    drift: 1,
  },
  descend: {
    color: "#46ffd0",
    hot: "#e6fff8",
    deep: "#140c4a",
    look: "portal",
    ...PORTAL_BEATS,
    fovKick: 1.5,
    roll: 0.6,
    pull: 1.5,
    lift: -0.15,
    spin: 1.2,
    speed: 1.3,
    streaks: 1,
    rings: 0,
    feathers: 0,
    drift: 1,
  },
  home: {
    color: "#ffd44f",
    hot: "#fff6d8",
    deep: "#4a1a06",
    look: "portal",
    ...PORTAL_BEATS,
    fovKick: 1.45,
    roll: -0.5,
    pull: 1.5,
    lift: 0.15,
    spin: 0.8,
    speed: 1,
    streaks: 0.85,
    rings: 0.35,
    feathers: 0,
    drift: -1,
  },
  feather: {
    color: "#ffe6a6",
    hot: "#ffffff",
    deep: "#5a3a1e",
    look: "portal",
    enterMs: 900,
    minTunnelMs: 340,
    arriveMs: 650,
    fovKick: 1.3,
    roll: -0.32,
    pull: 0,
    lift: 1.1,
    spin: 0.45,
    speed: 0.7,
    streaks: 0.35,
    rings: 0,
    feathers: 1,
    drift: -1,
  },
  death: {
    color: "#ff2a12",
    hot: "#ffb07a",
    deep: "#1a0204",
    look: "dissolve",
    enterMs: 1100,
    minTunnelMs: 260,
    arriveMs: 500,
    fovKick: 0.8,
    roll: 0.42,
    pull: 0,
    lift: -0.85,
    spin: 0.15,
    speed: 0.25,
    streaks: 0,
    rings: 0,
    feathers: 0,
    drift: 1,
  },
  respawn: {
    color: "#9ec4ff",
    hot: "#f4f8ff",
    deep: "#1a1040",
    look: "fromDark",
    enterMs: 450,
    minTunnelMs: 380,
    arriveMs: 700,
    fovKick: 1.3,
    roll: -0.25,
    pull: 0,
    lift: 0,
    spin: 0.6,
    speed: 0.9,
    streaks: 0.6,
    rings: 0,
    feathers: 0.3,
    drift: -1,
  },
};

/** Upper bound of the time a journey adds on top of the switch itself. */
export function travelOverheadMs(kind: TravelKind): number {
  const s = TRAVEL_STYLES[kind];
  return s.enterMs + s.minTunnelMs + s.arriveMs;
}

// ── Easing ───────────────────────────────────────────────────────────────────

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Map [a, b] → [0, 1], clamped. */
export const remap01 = (x: number, a: number, b: number): number => clamp01((x - a) / (b - a));
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = remap01(x, a, b);
  return t * t * (3 - 2 * t);
};
export const easeInQuad = (t: number): number => t * t;
export const easeInCubic = (t: number): number => t * t * t;
export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInOutSine = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * t);
/** 0 → 1 → 0 over [0, 1]. */
export const bump = (t: number): number => Math.sin(Math.PI * clamp01(t));

/** Progress of a stage that began at `start` and lasts `ms`, at `now`. */
export function stageProgress(start: number, ms: number, now: number): number {
  return ms <= 0 ? 1 : clamp01((now - start) / ms);
}

// ── Camera ───────────────────────────────────────────────────────────────────

/** What the camera system applies on top of the player controller. */
export interface CameraFx {
  /** Multiplies the camera's base FOV (exactly 1 when idle). */
  fovMult: number;
  /** Roll about the view axis, radians (exactly 0 when idle). */
  roll: number;
  /** Metres toward the portal being entered. */
  pull: number;
  /** Metres up (+) or down (−). */
  lift: number;
  /** 0…1 — how strongly the gaze is being turned toward the portal. */
  aim: number;
}

export function newCameraFx(): CameraFx {
  return { fovMult: 1, roll: 0, pull: 0, lift: 0, aim: 0 };
}

/** Where ARRIVE starts from: still a little stretched and rolled the other
 * way, so the settle reads as the vortex spitting you out. */
const ARRIVE_FOV = 1.28;
const ARRIVE_ROLL = -0.32;
const ARRIVE_LIFT = 0.28;

/** Sample the camera effect for a stage at progress `p` (0…1). Writes into
 * `out` and returns it. Continuous across stage boundaries where the world is
 * visible (idle→enter, arrive→idle), and exactly the identity when idle and
 * at the end of ARRIVE, so the base FOV is restored bit-for-bit. */
export function sampleCamera(stage: TravelStage, p: number, s: TravelStyle, out: CameraFx): CameraFx {
  p = clamp01(p);
  switch (stage) {
    case "idle":
      out.fovMult = 1;
      out.roll = 0;
      out.pull = 0;
      out.lift = 0;
      out.aim = 0;
      return out;
    case "entering": {
      if (s.look === "dissolve") {
        // Collapse: knees give, the head lolls, the world narrows.
        const k = easeInCubic(p);
        out.fovMult = 1 + (s.fovKick - 1) * easeOutCubic(p);
        out.roll = s.roll * k;
        out.pull = 0;
        out.lift = s.lift * easeInQuad(p);
        out.aim = 0;
        return out;
      }
      // Anticipation (a small zoom-in as the portal grabs you), then the
      // rush: FOV stretches, roll winds up, the camera is dragged in.
      const rush = easeInCubic(remap01(p, 0.18, 1));
      out.fovMult = 1 - 0.08 * bump(p / 0.32) * (p < 0.32 ? 1 : 0) + (s.fovKick - 1) * rush;
      out.roll = s.roll * easeInQuad(p);
      out.pull = s.pull * easeInCubic(p);
      out.lift = s.lift * easeInOutSine(p);
      out.aim = easeOutCubic(remap01(p, 0, 0.55));
      return out;
    }
    case "tunnel":
      // The world is covered: hold the end-of-ENTER pose so the overlay's
      // FOV (it reads the camera's) doesn't jump.
      out.fovMult = s.fovKick;
      out.roll = s.roll;
      out.pull = s.pull;
      out.lift = s.lift;
      out.aim = 1;
      return out;
    case "arriving": {
      if (s.look === "dissolve") {
        // Death: the death screen is up; ease quietly back to rest.
        const k = 1 - easeOutCubic(p);
        out.fovMult = 1 + (s.fovKick - 1) * k;
        out.roll = s.roll * k;
        out.pull = 0;
        out.lift = s.lift * k;
        out.aim = 0;
        return out;
      }
      // Spat out: stretched → a hair past rest → rest; a little drop onto
      // your feet; the roll unwinds the other way.
      const settle = 1 - easeOutCubic(p);
      const undershoot = -0.035 * bump(remap01(p, 0.35, 1));
      out.fovMult = p >= 1 ? 1 : 1 + (ARRIVE_FOV - 1) * settle * settle + undershoot;
      out.roll = p >= 1 ? 0 : ARRIVE_ROLL * Math.sign(s.roll || 1) * settle * settle * settle;
      out.pull = 0;
      out.lift = p >= 1 ? 0 : (s.look === "portal" && s.lift > 0.5 ? s.lift * 0.5 : ARRIVE_LIFT) * settle * settle;
      out.aim = 0;
      return out;
    }
  }
}

// ── Overlay ──────────────────────────────────────────────────────────────────

/** Numbers for the fullscreen warp overlay (all 0…1 unless noted). */
export interface OverlayFx {
  /** Anything to draw at all (0 = overlay hidden). */
  cover: number;
  /** ENTER: the tear ripping open over the view around the rift, from the
   * rift's own size (0) to past the farthest screen corner (1). */
  iris: number;
  /** ARRIVE: the tear opening at the screen centre onto the new place,
   * 0 (closed) → 1 (past the corners). */
  reveal: number;
  /** Brightness of the burning rim riding the tear's edge. */
  ring: number;
  /** Shards of the world being sucked in over the still-visible view
   * during ENTER. */
  swirl: number;
  /** Being SUCKED IN: the void spins up, zooms toward its heart and streaks
   * scream past. Rises through ENTER, dies away into the hover. */
  suck: number;
  /** How fast the starry void is streaming past (the fall between floors):
   * surges as you are pulled through, eases to a slow drift while hovering. */
  rush: number;
  /** Being SPAT OUT: the void kicks outward past you and surges back into
   * the rift's colour (ARRIVE). */
  eject: number;
  /** Death: how much of the world has burned away (0…1). */
  dissolve: number;
  /** Respawn: a black veil over the tunnel (continues the death screen). */
  dark: number;
  /** Whole-screen hot flash. */
  flash: number;
  /** Global alpha multiplier (death's ARRIVE fades the smoulder out). */
  fade: number;
}

export function newOverlayFx(): OverlayFx {
  return {
    cover: 0,
    iris: 0,
    reveal: 0,
    ring: 0,
    swirl: 0,
    suck: 0,
    rush: 0,
    eject: 0,
    dissolve: 0,
    dark: 0,
    flash: 0,
    fade: 1,
  };
}

function zeroOverlay(out: OverlayFx): OverlayFx {
  out.cover = 0;
  out.iris = 0;
  out.reveal = 0;
  out.ring = 0;
  out.swirl = 0;
  out.suck = 0;
  out.rush = 0;
  out.eject = 0;
  out.dissolve = 0;
  out.dark = 0;
  out.flash = 0;
  out.fade = 1;
  return out;
}

/** Sample the overlay for a stage at progress `p`. In the TUNNEL, `p` is
 * progress through its minimum beat (it may sit at 1 while a slow switch
 * finishes — everything there is steady-state by then). */
export function sampleOverlay(stage: TravelStage, p: number, s: TravelStyle, out: OverlayFx): OverlayFx {
  p = clamp01(p);
  zeroOverlay(out);
  if (stage === "idle") return out;

  if (s.look === "dissolve") {
    switch (stage) {
      case "entering":
        out.dissolve = easeInQuad(p) * 0.92 + 0.08 * p;
        out.cover = 1;
        out.flash = 0.35 * (1 - remap01(p, 0, 0.12)) * (p < 0.12 ? 1 : 0);
        return out;
      case "tunnel":
        out.dissolve = 1;
        out.cover = 1;
        return out;
      case "arriving":
        out.dissolve = 1;
        out.cover = 1;
        out.fade = 1 - easeOutCubic(p);
        if (p >= 1) out.cover = 0;
        return out;
    }
  }

  switch (stage) {
    case "entering":
      out.cover = 1;
      if (s.look === "fromDark") {
        // Straight into the hover from the death screen's black: a calm
        // starry void brightening as you rise out of it.
        out.iris = 1;
        out.dark = 1 - smoothstep(0.05, 1, p);
        out.rush = 0.25 * p;
        return out;
      }
      out.iris = easeInCubic(remap01(p, 0.08, 0.94));
      out.swirl = smoothstep(0.12, 0.65, p);
      out.ring = 0.55 + 0.9 * easeInQuad(p);
      out.suck = smoothstep(0.1, 0.85, p);
      out.rush = easeInQuad(p);
      out.flash = 0.55 * smoothstep(0.82, 1, p);
      return out;
    case "tunnel": {
      // The suck-in dies away into the hover; the fall eases to a drift.
      const settle = smoothstep(0, 1, p);
      const pulled = s.look === "fromDark" ? 0 : 1;
      out.cover = 1;
      out.iris = 1;
      out.suck = pulled * (1 - settle);
      out.rush = (s.look === "fromDark" ? 0.25 : 1) * (1 - settle);
      out.flash = pulled * 0.55 * (1 - smoothstep(0, 0.45, p));
      return out;
    }
    case "arriving": {
      // Spat out: the void kicks outward and surges into colour with a
      // flash, and a tear rips open at the centre onto the new place.
      // (The surge peaks early and falls back toward the dark, so the tear
      // opening onto the new place reads against it instead of drowning in
      // a white-out.)
      out.eject = smoothstep(0, 0.1, p) * (1 - 0.7 * smoothstep(0.1, 0.4, p));
      out.rush = out.eject;
      // The tear holds narrow long enough to read as a tear, then rips wide.
      out.reveal = smoothstep(0.08, 0.85, p);
      out.iris = 1;
      out.ring = 1.6 * (1 - easeInQuad(p));
      out.flash = 0.6 * bump(remap01(p, 0, 0.24));
      out.cover = p >= 1 ? 0 : 1;
      return out;
    }
  }
  return out;
}
