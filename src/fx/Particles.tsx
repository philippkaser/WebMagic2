import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, Mesh, Vector3 } from "three";
import { clamp01, randomInCone, randomUnit, type MutVec3 } from "./curves";
import { FlameSprites, markRange } from "./Flames";
import { fxUniforms } from "./fxUniforms";
import { createParticleGeometry, createParticleMaterial } from "./particleMaterial";
import {
  createInstanceArrays,
  createParticleInit,
  ParticleSim,
  SHAPE,
  styleDef,
  styleId,
  type ParticleInit,
  type ParticleStyle,
} from "./particleSim";

export type { ParticleStyle } from "./particleSim";

/** The particle renderer: a CPU simulation (particleSim.ts) streaming into
 * one instanced mesh drawn with a single shader (particleMaterial.ts). Every
 * style — pixel sparks and embers, stepped glows, dithered smoke, tumbling
 * debris cubes, pixel rings and star flares — is one draw call; the torch
 * flames are one more. The look is pixel-magic: whole pixels on the render
 * target's grid, stepped colour, dithered fades, glow from bloom.
 *
 * Gameplay code calls the effect functions in effects.ts, or spawnBurst()
 * (the original API, still supported with its original defaults). Nothing
 * here allocates per particle or per frame. */

/** Pool size. A barrel chain reaction in a crowded room peaks around 3–4k;
 * the effects thin themselves out above 60% (curves.budgetCount). */
export const PARTICLE_CAPACITY = 8192;

const sim = new ParticleSim(PARTICLE_CAPACITY);
const arrays = createInstanceArrays(PARTICLE_CAPACITY);
let mounted = false;

/** Particle-clock scale (dev: slow motion for screenshots). */
let timeScale = 1;

/** Floor height the bouncing styles collide with. Dungeon floors and the
 * village ground both sit at y = 0. */
export const GROUND_Y = 0;

// ── Colours ──────────────────────────────────────────────────────────────────

/** Hex → linear RGB, cached. Colours come from a small closed set (staff,
 * enemy, biome and robe colours), so the cache stays small; it's bounded
 * anyway in case something feeds it arbitrary strings. */
const rgbCache = new Map<string, Float32Array>();
const tmpColor = new Color();

export function rgbOf(hex: string): Float32Array {
  let c = rgbCache.get(hex);
  if (!c) {
    if (rgbCache.size > 512) rgbCache.clear();
    tmpColor.set(hex);
    c = new Float32Array([tmpColor.r, tmpColor.g, tmpColor.b]);
    rgbCache.set(hex, c);
  }
  return c;
}

// ── Low-level emission ───────────────────────────────────────────────────────

const scratch = createParticleInit();

/** Start describing one particle of `style`: returns the shared scratch
 * record reset to the style's defaults. Fill in what matters, then call
 * commitParticle(). (A scratch object instead of an options bag keeps the
 * hottest path — trails emit hundreds a second — allocation-free.) */
export function beginParticle(style: ParticleStyle): ParticleInit {
  const def = styleDef(style);
  const p = scratch;
  p.style = styleId(style);
  p.x = p.y = p.z = 0;
  p.vx = p.vy = p.vz = 0;
  p.life = 1;
  p.size0 = 0.1;
  p.size1 = 0.1 * def.endSize;
  p.alpha = 1;
  p.r0 = p.g0 = p.b0 = 1;
  p.r1 = p.g1 = p.b1 = 1;
  p.gravity = def.gravity;
  p.drag = def.drag;
  p.rotation = def.shape === SHAPE.ring ? 0.12 : Math.random() * Math.PI * 2;
  p.spin = def.spin > 0 ? (Math.random() * 2 - 1) * def.spin : 0;
  p.stretch = NaN;
  p.ax = p.ay = p.az = 0;
  p.attract = 0;
  p.nx = p.ny = p.nz = 0;
  p.floorY = GROUND_Y + 0.03;
  return p;
}

/** Spawn the scratch particle. No-op until the renderer is mounted. */
export function commitParticle(): void {
  if (mounted) sim.spawn(scratch);
}

/** Colour-over-life from hex strings with an HDR multiplier (values past 1
 * bloom). `end` defaults to `start`. */
export function setParticleColor(
  p: ParticleInit,
  start: string,
  end: string = start,
  intensity = 1,
  endIntensity = intensity,
): void {
  const a = rgbOf(start);
  const b = rgbOf(end);
  p.r0 = a[0] * intensity;
  p.g0 = a[1] * intensity;
  p.b0 = a[2] * intensity;
  p.r1 = b[0] * endIntensity;
  p.g1 = b[1] * endIntensity;
  p.b1 = b[2] * endIntensity;
}

/** How full the pool is (0..1) — effects scale their counts by it. */
export function particleOccupancy(): number {
  return sim.occupancy;
}

/** Live particle count (perf overlay / tests). */
export function particleCount(): number {
  return sim.count;
}

// ── The original burst API ───────────────────────────────────────────────────

export type Vec3Like = Vector3 | readonly [number, number, number] | { x: number; y: number; z: number };

export interface BurstOptions {
  position: Vec3Like;
  count?: number;
  /** One or more hex colors, picked per particle. */
  color?: string | string[];
  speed?: number;
  /** Extra upward bias. */
  upward?: number;
  ttl?: number;
  /** Visual diameter-ish, as before (a legacy "pixel" was a box this wide). */
  size?: number;
  gravity?: number;
  drag?: number;
  /** How the particles look and behave (default "pixel": the original
   * opaque chunky squares). */
  style?: ParticleStyle;
  /** Colour at death (colour-over-life), one per `color` entry or a single
   * colour for all. Defaults to the start colour. */
  endColor?: string | string[];
  /** HDR brightness multiplier (> 1 blooms). Default 1 (light styles 1.6). */
  intensity?: number;
  /** End size as a multiple of the start size (default: the style's). */
  endSize?: number;
  /** Peak coverage (fades dissolve by dither, not by blending). */
  alpha?: number;
  /** Random spawn offset radius around `position`. */
  spread?: number;
  /** Emit in a cone around this direction instead of a sphere. */
  direction?: Vec3Like;
  /** Cone half-angle, radians (with `direction`; default 0.6). */
  cone?: number;
  /** Extra velocity every particle inherits (e.g. the emitter's own). */
  inherit?: Vec3Like;
  /** Floor height for bouncing styles (default the ground). */
  floorY?: number;
}

const dirTmp: MutVec3 = { x: 0, y: 0, z: 0 };
const vecTmp: MutVec3 = { x: 0, y: 0, z: 0 };

/** Read any Vec3Like into a scratch vector (no allocation). */
export function readVec(v: Vec3Like, out: MutVec3): MutVec3 {
  if (v instanceof Vector3 || !Array.isArray(v)) {
    const o = v as { x: number; y: number; z: number };
    out.x = o.x;
    out.y = o.y;
    out.z = o.z;
  } else {
    out.x = v[0];
    out.y = v[1];
    out.z = v[2];
  }
  return out;
}

/** Shape-specific scale from the legacy "size" (a visual width) to the
 * sprite half-extent the shader uses. */
function halfExtentFor(shape: number, size: number): number {
  switch (shape) {
    case SHAPE.chunk:
    case SHAPE.streak:
      return size * 0.5;
    case SHAPE.glow:
    case SHAPE.flare:
      return size * 0.9;
    default:
      return size * 0.7;
  }
}

const inheritTmp: MutVec3 = { x: 0, y: 0, z: 0 };

export function spawnBurst(opts: BurstOptions): void {
  if (!mounted) return;
  const style = opts.style ?? "pixel";
  const def = styleDef(style);
  const legacy = style === "pixel";
  const {
    count = 16,
    color = "#ffcf7a",
    speed = 6,
    upward = legacy ? 2 : 0,
    ttl = 0.8,
    size = 0.09,
    gravity = def.gravity,
    drag = def.drag,
    alpha = 1,
    spread = 0,
    cone = 0.6,
  } = opts;
  // Light (everything but chunks and smoke) glows past 1 so bloom takes it.
  const light = def.shape !== SHAPE.chunk && def.shape !== SHAPE.smoke;
  const intensity = opts.intensity ?? (light ? 1.6 : 1);
  const endMult = opts.endSize ?? def.endSize;
  const colors = Array.isArray(color) ? color : [color];
  const endColors = opts.endColor === undefined ? null : Array.isArray(opts.endColor) ? opts.endColor : [opts.endColor];
  const pos = readVec(opts.position, vecTmp);
  const px = pos.x;
  const py = pos.y;
  const pz = pos.z;
  let dx = 0;
  let dy = 1;
  let dz = 0;
  const directed = opts.direction !== undefined;
  if (directed) {
    readVec(opts.direction!, dirTmp);
    const l = Math.hypot(dirTmp.x, dirTmp.y, dirTmp.z) || 1;
    dx = dirTmp.x / l;
    dy = dirTmp.y / l;
    dz = dirTmp.z / l;
  }
  let ix = 0;
  let iy = 0;
  let iz = 0;
  if (opts.inherit) {
    readVec(opts.inherit, inheritTmp);
    ix = inheritTmp.x;
    iy = inheritTmp.y;
    iz = inheritTmp.z;
  }
  for (let i = 0; i < count; i++) {
    const p = beginParticle(style);
    if (directed) randomInCone(dx, dy, dz, cone, dirTmp);
    else randomUnit(dirTmp);
    const s = speed * (0.35 + Math.random() * 0.65);
    if (spread > 0) {
      randomUnit(vecTmp);
      const r = spread * Math.cbrt(Math.random());
      p.x = px + vecTmp.x * r;
      p.y = py + vecTmp.y * r;
      p.z = pz + vecTmp.z * r;
    } else {
      p.x = px;
      p.y = py;
      p.z = pz;
    }
    p.vx = dirTmp.x * s + ix;
    p.vy = dirTmp.y * s + upward + iy;
    p.vz = dirTmp.z * s + iz;
    p.life = ttl * (0.6 + Math.random() * 0.8);
    const sz = halfExtentFor(def.shape, size * (0.6 + Math.random() * 0.9));
    p.size0 = sz;
    p.size1 = sz * endMult;
    p.alpha = clamp01(alpha);
    p.gravity = gravity;
    p.drag = drag;
    if (opts.floorY !== undefined) p.floorY = opts.floorY + 0.03;
    const ci = (Math.random() * colors.length) | 0;
    const start = colors[ci];
    const end = endColors ? endColors[Math.min(ci, endColors.length - 1)] : start;
    setParticleColor(p, start, end, intensity, light && endColors ? intensity * 0.6 : intensity);
    commitParticle();
  }
}

// ── Renderer ─────────────────────────────────────────────────────────────────

/** Dev-only counters (see __fxStats). */
const stats = { peak: 0, stepMs: 0 };

/** Mounted once in GameScene: the particle mesh and the torch flames. */
export function FxSystems() {
  const mesh = useRef<Mesh>(null);
  const gl = useThree((s) => s.gl);
  const parts = useMemo(() => createParticleGeometry(arrays), []);
  const material = useMemo(() => createParticleMaterial(), []);

  useEffect(() => {
    mounted = true;
    return () => {
      mounted = false;
      sim.clear();
      parts.geometry.dispose();
      material.dispose();
    };
  }, [parts, material]);

  // Dev hooks for screenshot scripts: slow the particle clock, count.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__fxTimeScale = (s: number) => {
      timeScale = Math.max(0, s);
    };
    w.__fxCount = () => sim.count;
    w.__fxStats = () => ({ count: sim.count, peak: stats.peak, stepMs: stats.stepMs });
    return () => {
      delete w.__fxTimeScale;
      delete w.__fxCount;
      delete w.__fxStats;
    };
  }, []);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20) * timeScale;
    // Wrapped so shader noise keeps float precision on long sessions.
    fxUniforms.uTime.value = state.clock.elapsedTime % 3600;
    // The pixel grid every sprite snaps to (glsl.ts#PIXEL_GLSL).
    gl.getDrawingBufferSize(fxUniforms.uViewport.value);

    const t0 = import.meta.env.DEV ? performance.now() : 0;
    const count = sim.step(dt, arrays);
    if (import.meta.env.DEV) {
      // Smoothed CPU cost of the simulation + peak live count (dev stats).
      stats.stepMs = stats.stepMs * 0.9 + (performance.now() - t0) * 0.1;
      stats.peak = Math.max(stats.peak, count);
    }
    const n = count * 4;
    markRange(parts.posSize, n);
    markRange(parts.color, n);
    markRange(parts.axis, n);
    markRange(parts.misc, n);
    parts.geometry.instanceCount = count;
    if (mesh.current) mesh.current.visible = count > 0;
  });

  return (
    <>
      <mesh
        ref={mesh}
        geometry={parts.geometry}
        material={material}
        frustumCulled={false}
        renderOrder={3}
      />
      <FlameSprites />
    </>
  );
}
