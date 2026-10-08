import { useFrame, useThree } from "@react-three/fiber";
import { BloomEffect, EffectPass } from "postprocessing";
import { useEffect, useMemo } from "react";
import {
  BasicDepthPacking,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  type PerspectiveCamera,
  UnsignedIntType,
  WebGLRenderTarget,
} from "three";
import { gameEvents } from "../core/events";
import { getStats, useGame, type Overlay, type Phase } from "../state/gameStore";
import type { Air, Grade } from "../world/biomes";
import { GodRaysEffect, hasGodRays } from "./godRays";
import type { PixelGrid } from "./pixelGrid";
import { Air as AirPass } from "./post/Air";
import { Composite } from "./post/Composite";
import { Eye } from "./post/Eye";
import { LensEffect } from "./post/LensEffect";
import { Occlusion } from "./post/Occlusion";
import { makeLensDirt } from "./post/lensDirt";
import { kickHurt, kickImpact, newFeel, stepFeel } from "./post/feel";

/** The render pipeline: crisp pixel art seen through a camera.
 *
 * The world renders at ~340 lines into an offscreen target (the pixel art,
 * and the reason the game is cheap: every light, normal map and pass pays a
 * fraction of native resolution's fragments). Everything that is LIGHT or
 * BLUR is worked out at that low resolution too —
 *
 *  - god rays where a scene has a source in its sky (./godRays),
 *  - depth of field with bokeh (post/LensEffect: the eye focuses on what you
 *    look at, out-of-focus lights open into round discs, the whole world
 *    drops out of focus behind a tablet),
 *  - light hanging in the air round every torch, spell and blast
 *    (post/Air: each pooled light's glow integrated in closed form along
 *    every view ray),
 *  - the lens's glare (a thresholdless mipmap bloom: every light spreads a
 *    little of itself, so what is truly bright wraps its light round edges
 *    and over what stands in front of it),
 *  - ambient occlusion, one value per world pixel (post/Occlusion),
 *  - the eye's meter (post/Eye),
 *
 * — and the canvas, at the screen's full resolution, gets one composite
 * (post/Composite): each world pixel drawn as an exact block, and the light
 * and blur upsampled bicubically over it, so the glare, the haze, the
 * shafts and the bokeh are smooth and continuous while the world stays
 * pixel-sharp. Then faint lens dirt in the glare, the eye and the place's
 * grade through ACES (film's tone curve), a heavy smooth vignette
 * and fine grain.
 *
 * Runs at useFrame priority 1, which takes the frame over from R3F's own
 * render. Each place sets its grade and its air (setGrade); the body's
 * kicks — a blast, a blow, nearing death — come from the game's events
 * (post/feel). */
export function Effects({ grid }: { grid: PixelGrid }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const depthOfField = useGame((s) => s.depthOfField);

  const chain = useMemo(() => {
    const depth = new DepthTexture(1, 1, UnsignedIntType);
    const scene = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthTexture: depth,
    });
    const layer = () => new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
    const lens = new LensEffect(camera);
    const rays = new GodRaysEffect(camera);
    const lensPass = new EffectPass(camera, lens);
    const raysPass = new EffectPass(camera, rays);
    // Thresholdless: the glare is a blur of everything, blended in a little
    // (the composite's uBloomMix), so brightness alone decides what glows.
    const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0, luminanceSmoothing: 0, radius: 0.85, levels: 8 });
    for (const pass of [lensPass, raysPass]) {
      pass.initialize(gl, false, HalfFloatType);
      pass.setDepthTexture(depth, BasicDepthPacking);
    }
    bloom.initialize(gl, false, HalfFloatType);
    return {
      scene,
      depth,
      dof: layer(),
      rays: layer(),
      air: layer(),
      haze: new AirPass(),
      ao: new Occlusion(),
      lens,
      lensPass,
      raysPass,
      bloom,
      eye: new Eye(),
      composite: new Composite(VILLAGE_GRADE),
      dirt: makeLensDirt(),
      size: { w: 0, h: 0 },
    };
  }, [camera, gl]);

  useEffect(
    () => () => {
      for (const t of [chain.scene, chain.dof, chain.rays, chain.air]) t.dispose();
      chain.haze.dispose();
      chain.ao.dispose();
      chain.depth.dispose();
      chain.lensPass.dispose();
      chain.raysPass.dispose();
      chain.bloom.dispose();
      chain.eye.dispose();
      chain.composite.dispose();
      chain.dirt.dispose();
    },
    [chain],
  );

  const feel = useMemo(newFeel, []);
  const air = useMemo(() => ({ ...VILLAGE_AIR }), []);
  const clock = useMemo(() => ({ t: 0, soft: 0 }), []);

  useEffect(() => {
    const offs = [
      gameEvents.on("shake", (v) => kickImpact(feel, v)),
      gameEvents.on("playerHurt", ({ amount }) => kickHurt(feel, amount)),
    ];
    return () => offs.forEach((off) => off());
  }, [feel]);

  useEffect(() => {
    chain.lens.depthOfField = depthOfField ? 1 : 0;
  }, [chain, depthOfField]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__post = {
      eye: () => chain.eye.read(gl),
      feel,
      air,
      chain,
      uniforms: chain.composite.uniforms,
      ao: chain.ao.uniforms,
      gl,
    };
  }, [gl, chain, feel, air]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const { scene } = state;
    const cam = camera as PerspectiveCamera;
    const c = chain;

    // Keep every low-resolution layer on the world's grid.
    if (c.size.w !== grid.width || c.size.h !== grid.height) {
      c.size.w = grid.width;
      c.size.h = grid.height;
      for (const t of [c.scene, c.dof, c.rays, c.air]) t.setSize(grid.width, grid.height);
      c.lensPass.setSize(grid.width, grid.height);
      c.raysPass.setSize(grid.width, grid.height);
      c.bloom.setSize(grid.width, grid.height);
      c.ao.setSize(grid.width, grid.height);
    }

    // The place: grade and air ease toward the target over ~a second.
    clock.t += dt;
    const k = 1 - Math.exp(-dt * 2.5);
    c.composite.approach(target.grade, k);
    for (const key of AIR_KEYS) air[key] += (target.air[key] - air[key]) * k;

    // The body.
    const s = useGame.getState();
    stepFeel(feel, dt, s.health / Math.max(1, getStats().maxHealth));
    clock.soft += ((wantsFocus(s.phase, s.overlay) ? 1 : 0) - clock.soft) * (1 - Math.exp(-dt * 5));
    if (clock.soft < 0.005) clock.soft = 0;
    c.lens.soft = clock.soft;

    const u = c.composite.uniforms;
    u.uKey.value = air.eye;
    u.uHaze.value = air.haze;
    c.haze.mist = air.mist * MIST;
    u.uExposure.value = (1 + Math.max(0, feel.impact - 0.2) * 0.45) * (1 - clock.soft * 0.2);
    u.uDrain.value = Math.min(0.85, feel.hurt * 0.4 + feel.low * 0.6);
    u.uVignette.value = air.vignette;
    const breath = 0.5 + 0.5 * Math.sin(clock.t * 1.1) * Math.sin(clock.t * 0.37 + 1);
    u.uClose.value = feel.low * (0.4 + 0.6 * feel.beat) + air.breath * 0.12 * breath + feel.hurt * 0.12;
    // The rim takes the place's own darks (as a hue: strongest channel 1).
    const sh = c.composite.shadows;
    u.uVignetteTint.value.copy(sh).multiplyScalar(1 / Math.max(sh.r, sh.g, sh.b, 1e-3));
    u.uDofOn.value = depthOfField || clock.soft > 0 ? 1 : 0;

    // 1. The world, at its own resolution (linear HDR: three applies no
    //    tone mapping or output encoding when drawing into a target).
    gl.setRenderTarget(c.scene);
    gl.clear();
    gl.render(scene, camera);
    // 2. Light and blur, at the same resolution.
    const rays = hasGodRays();
    if (rays) c.raysPass.render(gl, c.scene, c.rays, dt);
    if (depthOfField || clock.soft > 0) c.lensPass.render(gl, c.scene, c.dof, dt);
    c.ao.render(gl, camera, c.depth, grid.width, grid.height);
    c.haze.render(gl, camera, c.depth, c.air, dt);
    c.bloom.update(gl, c.scene, dt);
    c.eye.update(gl, c.scene, dt);
    // 3. The picture, at full resolution.
    c.composite.render(
      gl,
      {
        scene: c.scene,
        depth: c.depth,
        dof: c.dof.texture,
        bloom: c.bloom.texture,
        rays: rays ? c.rays.texture : null,
        air: c.air.texture,
        ao: c.ao.texture,
        eye: c.eye.texture,
        dirt: c.dirt,
      },
      grid.scale,
      cam.near,
      cam.far,
      dt,
    );
  }, 1);

  return null;
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
export const VILLAGE_AIR: Air = { haze: 0, breath: 0, mist: 0.2, vignette: 0.9, eye: -5.2 };
/** Scattering density of "the usual dungeon air" (a biome's mist 1). */
const MIST = 0.03;
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
