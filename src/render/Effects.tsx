import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useEffect, useMemo } from "react";
import { gameEvents } from "../core/events";
import { getStats, useGame, type Overlay, type Phase } from "../state/gameStore";
import { useTravel } from "../transition/store";
import type { Air, Grade } from "../world/biomes";
import { GodRaysEffect } from "./godRays";
import { FilmEffect } from "./post/FilmEffect";
import { GradeEffect } from "./post/GradeEffect";
import { LensEffect } from "./post/LensEffect";
import { kickDash, kickHurt, kickImpact, newFeel, stepFeel } from "./post/feel";

/** The gritty-pixel post chain. Three passes over the world's low-resolution
 * image (the canvas renders at dpr 0.35 and the browser upscales it with
 * image-rendering: pixelated — see GameScene — so every pass here pays
 * ~1/8th the fragment cost of native resolution):
 *
 *  1. god rays where a scene has a source in its sky (the village's moon;
 *     ./godRays);
 *  2. the lens (post/LensEffect): pixel-art edges found in the depth, motion
 *     blur from the camera's own movement, the zoom rush of a blast or a
 *     dash, the lens's colour fringe, the forge's heat shimmer, the soft
 *     focus behind a menu;
 *  3. one merged pass: bloom for the emissive magic, torches and painted
 *     specks → the eye and the grade (post/GradeEffect: adaptation, the
 *     place's split tone, a filmic shoulder for the lights, the colour
 *     draining from a hurt wizard) → film (post/FilmEffect: a tinted,
 *     breathing vignette, grain on the pixel grid, ordered dither).
 *
 * Each place sets its grade and its air (setGrade); the body's kicks — a
 * blast, a blow, a dash, nearing death, a rift's pull — come from the game's
 * events and the travel store (post/feel). */
export function Effects() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const motionBlur = useGame((s) => s.motionBlur);
  const grade = useMemo(() => new GradeEffect(VILLAGE_GRADE), []);
  const film = useMemo(() => new FilmEffect(), []);
  const lens = useMemo(() => new LensEffect(camera), [camera]);
  const rays = useMemo(() => new GodRaysEffect(camera), [camera]);
  const feel = useMemo(newFeel, []);
  const air = useMemo(() => ({ ...VILLAGE_AIR }), []);
  const clock = useMemo(() => ({ t: 0 }), []);

  useEffect(() => {
    const offs = [
      gameEvents.on("shake", (v) => kickImpact(feel, v)),
      gameEvents.on("playerHurt", ({ amount }) => kickHurt(feel, amount)),
      gameEvents.on("dash", () => kickDash(feel)),
    ];
    return () => offs.forEach((off) => off());
  }, [feel]);

  useEffect(() => {
    lens.shutter = motionBlur ? SHUTTER : 0;
  }, [lens, motionBlur]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__post = {
      eye: () => grade.readEye(gl),
      feel,
      air,
      grade,
      lens,
      film,
    };
  }, [gl, grade, lens, film, feel, air]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    clock.t += dt;
    // The place: grade and air ease toward the target over ~a second.
    const k = 1 - Math.exp(-dt * 2.5);
    grade.approach(target.grade, k);
    for (const key of AIR_KEYS) air[key] += (target.air[key] - air[key]) * k;

    // The body.
    const s = useGame.getState();
    const frac = s.health / Math.max(1, getStats().maxHealth);
    stepFeel(feel, dt, frac);
    const rush = travelRush();

    grade.key = air.eye;
    // Focus pulled to a tablet in front of you; the world behind dims a touch.
    lens.soft += ((wantsFocus(s.phase, s.overlay) ? 1 : 0) - lens.soft) * (1 - Math.exp(-dt * 6));
    if (lens.soft < 0.005) lens.soft = 0;
    lens.haze = air.haze;
    lens.zoom = feel.impact * 0.5 + feel.dash * 0.55 + feel.hurt * 0.2 + rush;
    lens.dispersion =
      air.dispersion + feel.impact * 2.5 + feel.hurt * 3 + feel.dash * 1.5 + feel.low * feel.beat * 2 + rush * 3;
    grade.exposure = (1 + Math.max(0, feel.impact - 0.2) * 0.45) * (1 - lens.soft * 0.2);
    grade.drain = Math.min(0.85, feel.hurt * 0.4 + feel.low * 0.6);
    film.vignette = air.vignette;
    film.grain = air.grain * (1 + feel.low * 0.6);
    const breath = 0.5 + 0.5 * Math.sin(clock.t * 1.1) * Math.sin(clock.t * 0.37 + 1);
    film.close = feel.low * (0.4 + 0.6 * feel.beat) + air.breath * 0.12 * breath + feel.hurt * 0.12;
    // The rim takes the place's own darks (as a hue: strongest channel 1).
    const sh = grade.shadows;
    film.tint.copy(sh).multiplyScalar(1 / Math.max(sh.r, sh.g, sh.b, 1e-3));
  });

  return (
    <EffectComposer multisampling={0}>
      <primitive object={rays} dispose={null} />
      <primitive object={lens} dispose={null} />
      <Bloom mipmapBlur intensity={1.1} luminanceThreshold={0.55} luminanceSmoothing={0.3} radius={0.72} levels={6} />
      <primitive object={grade} dispose={null} />
      <primitive object={film} dispose={null} />
    </EffectComposer>
  );
}

/** Camera blur's exposure time (s): about a 180° shutter at 45 fps — a
 * whipped turn streaks, an ordinary walk stays crisp. */
const SHUTTER = 1 / 90;

/** Screens where a tablet stands in front of the world (the dev room is a
 * DOM panel for watching the world, so it keeps it sharp). */
function wantsFocus(phase: Phase, overlay: Overlay): boolean {
  if (phase === "menu" || phase === "weighing" || phase === "dead") return true;
  return overlay !== "none" && overlay !== "devroom";
}

/** A rift's pull: the view rushes inward as you're drawn into the tear,
 * holds a little through the tunnel, and lets go as you're spat out. */
function travelRush(): number {
  const { stage, progress: p } = useTravel.getState();
  if (stage === "entering") return 0.9 * p * p;
  if (stage === "tunnel") return 0.25;
  if (stage === "arriving") return 0.6 * (1 - p) * (1 - p);
  return 0;
}

/** Moonlit blue in the darks, warm lamplight in the lights: the village
 * above, and the grade the game starts in. */
export const VILLAGE_GRADE: Grade = { shadows: "#0c1438", highlights: "#ffe0b0", saturation: 0.9, contrast: 1.06 };
/** The village's air: clear and still, a light lens. */
export const VILLAGE_AIR: Air = { haze: 0, dispersion: 0.4, breath: 0, grain: 0.9, vignette: 0.9, eye: -4.6 };
const AIR_KEYS = Object.keys(VILLAGE_AIR) as (keyof Air)[];

let target: { grade: Grade; air: Air } = { grade: VILLAGE_GRADE, air: VILLAGE_AIR };

/** Scenes call this on mount; grade and air ease toward it over ~a second
 * so arriving somewhere new reads as the air changing, not a cut. */
export function setGrade(grade: Grade, air: Air = VILLAGE_AIR): void {
  target = { grade, air };
}

/** Back to the village (a dungeon floor calls this on unmount, so walking
 * home never keeps the deep's colour). */
export function resetGrade(): void {
  target = { grade: VILLAGE_GRADE, air: VILLAGE_AIR };
}
