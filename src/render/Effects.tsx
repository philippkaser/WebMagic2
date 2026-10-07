import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer } from "@react-three/postprocessing";
import { useEffect, useMemo } from "react";
import { gameEvents } from "../core/events";
import { getStats, useGame, type Overlay, type Phase } from "../state/gameStore";
import type { Air, Grade } from "../world/biomes";
import { GodRaysEffect } from "./godRays";
import { FilmEffect } from "./post/FilmEffect";
import { GradeEffect } from "./post/GradeEffect";
import { LensEffect } from "./post/LensEffect";
import { kickHurt, kickImpact, newFeel, stepFeel } from "./post/feel";

/** The post chain: an old dungeon crawler's pixels and colour, with modern
 * light. Three passes over the world's low-resolution image (it renders at
 * ~340 lines and the browser upscales it by a whole number with
 * image-rendering: pixelated — see render/pixelGrid — so every pass here
 * pays a fraction of the fragment cost of native resolution):
 *
 *  1. god rays where a scene has a source in its sky (the village's moon;
 *     ./godRays): marched light, stepped and dithered;
 *  2. the lens (post/LensEffect): depth of field with bokeh — the eye
 *     focuses on what you look at, out-of-focus lights open into discs, the
 *     whole world goes soft behind a tablet — and the forge's heat shimmer;
 *  3. one merged pass: the light wrap (bloom, laid down in dithered steps
 *     like the god rays) → the eye and the grade (post/GradeEffect:
 *     adaptation, the place's split tone, a filmic shoulder so bright
 *     things keep their shape, the colour draining from a hurt wizard) →
 *     film (post/FilmEffect: a heavy tinted vignette that breathes, and
 *     15-bit colour through the 4×4 ordered dither).
 *
 * The dither is one look across all of it: the same 4×4 Bayer matrix steps
 * the god rays, the glow, the colour and the dithered particles.
 *
 * Each place sets its grade and its air (setGrade); the body's kicks — a
 * blast, a blow, nearing death — come from the game's events (post/feel). */
export function Effects() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const depthOfField = useGame((s) => s.depthOfField);
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
    ];
    return () => offs.forEach((off) => off());
  }, [feel]);

  useEffect(() => {
    lens.depthOfField = depthOfField ? 1 : 0;
  }, [lens, depthOfField]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__post = { eye: () => grade.readEye(gl), feel, air, grade, lens, film };
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

    grade.key = air.eye;
    // Focus pulled to a tablet in front of you; the world behind dims a touch.
    lens.soft += ((wantsFocus(s.phase, s.overlay) ? 1 : 0) - lens.soft) * (1 - Math.exp(-dt * 5));
    if (lens.soft < 0.005) lens.soft = 0;
    lens.haze = air.haze;
    grade.exposure = (1 + Math.max(0, feel.impact - 0.2) * 0.45) * (1 - lens.soft * 0.2);
    grade.drain = Math.min(0.85, feel.hurt * 0.4 + feel.low * 0.6);
    film.vignette = air.vignette;
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
      <primitive object={grade} dispose={null} />
      <primitive object={film} dispose={null} />
    </EffectComposer>
  );
}

/** Screens where a tablet stands in front of the world (the dev room is a
 * DOM panel for watching the world, so it keeps it sharp). */
function wantsFocus(phase: Phase, overlay: Overlay): boolean {
  if (phase === "menu" || phase === "weighing" || phase === "dead") return true;
  return overlay !== "none" && overlay !== "devroom";
}

/** Moonlit blue in the darks, warm lamplight in the lights: the village
 * above, and the grade the game starts in. */
export const VILLAGE_GRADE: Grade = { shadows: "#0c1438", highlights: "#ffe0b0", saturation: 0.9, contrast: 1.06 };
/** The village's air: clear and still. */
export const VILLAGE_AIR: Air = { haze: 0, breath: 0, vignette: 0.9, eye: -4.6 };
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
