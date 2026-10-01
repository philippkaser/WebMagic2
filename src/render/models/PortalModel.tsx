import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  TetrahedronGeometry,
  UniformsLib,
  UniformsUtils,
} from "three";
import { PIXEL_NOISE_GLSL } from "../../transition/vortexGlsl";
import { RIFT_RUNE_GLOW, RiftFrameModel, createRiftRuneMaterial } from "./RiftFrameModel";
import { shared } from "./shared";

/** The portal: a wound torn in space (ported from the artpass branch's rift).
 * Origin is the ground at the rift's centre; the tear hangs at RIFT_Y over a
 * rune dais framed by broken standing stones (RiftFrameModel).
 *
 * The tear is one shader plane, computed entirely on a coarse pixel grid so
 * it reads as blocky torn pixels, not a smooth decal: a hard, stepped
 * silhouette (no anti-aliasing) — a vertical lens whose width frays and whose
 * spine wobbles with fast noise, so the edges writhe — a ragged burning rim,
 * and, seen THROUGH the tear, a blocky star vortex spiralling in, all in a
 * stepped palette. It turns to face you around Y (a rip in space has no flat
 * side to catch) and breathes rather than spins: a wound, not a machine. A
 * swarm of glowing shards spirals in from the rim and is swallowed, over and
 * over (RiftMotes).
 *
 * Behaviour (world/props.tsx Portal) owns the pooled light, the sparks, the
 * prompt and the numbers in `drive`, which the model reads every frame:
 * proximity (the wound quickens, burns brighter and its motes swarm faster as
 * the player nears), the seal (1 = sealed … 0 = open; easing it down tears
 * the wound open), surge (a journey is starting through it) and refusal
 * (someone tried it while sealed).
 *
 * SEALED (the way home before the Tithe is paid, exits while a boss lives):
 * the wound is nearly shut — a dim, thin slit that still writhes, its runes
 * smouldering and its motes barely a sparkle. Touch it and it flinches; break
 * its seal and it rips open, the rim flaring white-hot as it goes. */

/** Height of the tear's centre above the rift's origin (the travel pull aims
 * here). */
export const RIFT_Y = 1.8;
/** The tear plane, in metres. The shader's coordinates are these metres. */
const TEAR_W = 3;
const TEAR_H = 4;
/** How wide a sealed wound stays open (artpass's `uActive` for a sealed rift). */
const SEALED_ACTIVITY = 0.12;

/** Numbers the behaviour writes and the model reads every frame. */
export interface PortalDrive {
  /** 0…1 — how close the player is (1 = on the dais). */
  proximity: number;
  /** 1 = sealed, 0 = open. Easing it from 1 to 0 tears the wound open. */
  seal: number;
  /** 0…1 flare while a journey starts through this rift; decays. */
  surge: number;
  /** 0…1 flare when someone tries a sealed rift; decays. */
  refusal: number;
  /** Written BY the model: the tear's current facing (radians about Y), so
   * the behaviour can throw sparks off its actual rim. */
  yaw: number;
}

export function newPortalDrive(locked: boolean): PortalDrive {
  return { proximity: 0, seal: locked ? 1 : 0, surge: 0, refusal: 0, yaw: 0 };
}

/** Which way a rift of this colour swirls: warm (gold, the way home) turns
 * the other way from cool (cyan, the way down) — up and down should feel
 * like opposites. */
export function portalSpinDir(color: string): 1 | -1 {
  const hsl = { h: 0, s: 0, l: 0 };
  new Color(color).getHSL(hsl);
  return hsl.h > 0.03 && hsl.h < 0.2 ? -1 : 1;
}

/** How open the wound is (artpass `uActive`: 0.12 sealed … 1 open) for a
 * seal value — eased, so it tears open fast and settles rather than sliding. */
export function riftActivity(seal: number): number {
  const open = 1 - seal;
  return SEALED_ACTIVITY + (1 - SEALED_ACTIVITY) * open * open * (3 - 2 * open);
}

const tearGeo = shared(() => new PlaneGeometry(TEAR_W, TEAR_H));
const moteGeo = shared(() => new TetrahedronGeometry(1));

// ── The tear ─────────────────────────────────────────────────────────────────

const TEAR_VERTEX = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const TEAR_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uClock;
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uActive;
uniform float uEnergy;
uniform float uFlare;
uniform float uSeed;
uniform float uSpinDir;
#include <fog_pars_fragment>
${PIXEL_NOISE_GLSL}

void main() {
  // Plane-local metres: x in [-1.5, 1.5], y in [-2, 2]. Everything below is
  // sampled on a 26-per-metre grid — at play distance about one world pixel
  // per cell, chunkier as you come close.
  vec2 raw = (vUv - 0.5) * vec2(${TEAR_W.toFixed(1)}, ${TEAR_H.toFixed(1)});
  vec2 p = pix(raw, 26.0);
  // The wound's own clock: slower while sealed, quicker near the player.
  float t = uClock;

  // ---- Silhouette: a sealed wound is a thin slit; a touch or a breaking
  //      seal makes it flinch wider. ----
  float spine;
  float width = mix(0.24, 1.0, uActive) + 0.16 * uFlare;
  float d = tearSd(p, t, uSeed, width, spine);
  float inside = step(d, 0.0);                  // hard, gritty edge (no AA)
  float edge = smoothstep(0.24, 0.0, abs(d));   // ragged burning rim band

  // ---- The void through the tear: blocky stars + nebula spiralling in. ----
  vec2 c = vec2(p.x - spine, p.y * 0.55);
  float rr = length(c);
  float aa = atan(c.y, c.x) * uSpinDir;
  float swirl = aa + (1.3 - rr) * 2.8 + t * 0.55;

  vec2 g0 = vec2(swirl * 2.3, pow(max(rr, 0.03), 0.5) * 6.0 - t * 1.5);
  float sh0 = hash21(floor(g0));
  float star0 = step(0.86, sh0) * (0.4 + 0.6 * fract(sh0 * 71.3 + uTime));
  vec2 g1 = vec2(swirl * 4.6 + 9.0, pow(max(rr, 0.03), 0.6) * 11.0 - t * 1.4);
  float star1 = step(0.90, hash21(floor(g1))) * 0.5;
  float neb = pow(fbm(vec2(swirl * 1.2, rr * 2.4 - t * 0.5)), 1.6);

  vec3 deep = mix(uColor * 0.12, vec3(0.04, 0.015, 0.09), smoothstep(0.0, 0.9, rr));
  vec3 voidCol = deep;
  voidCol += uColor * neb * 0.6 * (1.0 - rr * 0.6);
  voidCol += (vec3(0.9) + uColor * 0.6) * star0 * (0.5 + 0.8 * uActive) * uEnergy;
  voidCol += uColor * star1 * (0.4 + 0.6 * uActive);

  // ---- Ragged burning rim: white-hot while a seal breaks. ----
  float flick = 0.78 + 0.22 * sin(uTime * 11.0 + p.y * 7.0 + uSeed);
  vec3 rim = mix(uColor, uHot, clamp(uFlare, 0.0, 1.0) * 0.85);
  // (A sealed wound's rim smoulders rather than burns: a dim slit.)
  vec3 edgeCol = rim * edge * (1.25 + 1.5 * uActive) * mix(0.5, 1.0, uActive) * flick * uEnergy * (1.0 + 1.5 * uFlare);

  vec3 col = voidCol * inside + edgeCol;
  // Hard stepped palette → deliberate pixel-magic banding.
  col = floor(col * 14.0) / 14.0;

  float halo = smoothstep(0.34, 0.0, abs(d)) * edge * (0.35 + 0.5 * uActive);
  float alpha = clamp(max(inside, halo), 0.0, 1.0);
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}
`;

interface TearUniforms {
  uTime: { value: number };
  uClock: { value: number };
  uColor: { value: Color };
  uHot: { value: Color };
  uActive: { value: number };
  uEnergy: { value: number };
  uFlare: { value: number };
  uSeed: { value: number };
  uSpinDir: { value: number };
}

function buildTearMaterial(color: string): ShaderMaterial & { uniforms: TearUniforms } {
  const base = new Color(color);
  const own: TearUniforms = {
    uTime: { value: 0 },
    uClock: { value: Math.random() * 100 },
    uColor: { value: base },
    uHot: { value: base.clone().lerp(new Color("#ffffff"), 0.75) },
    uActive: { value: 1 },
    uEnergy: { value: 1 },
    uFlare: { value: 0 },
    // Two rifts never writhe in step.
    uSeed: { value: Math.random() * 10 },
    uSpinDir: { value: portalSpinDir(color) },
  };
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog]) as Record<string, { value: unknown }>,
    vertexShader: TEAR_VERTEX,
    fragmentShader: TEAR_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
  });
  // Merge cloned fog's uniforms; ours are assigned by reference.
  Object.assign(material.uniforms, own);
  return material as ShaderMaterial & { uniforms: TearUniforms };
}

// ── The mote swarm ───────────────────────────────────────────────────────────

const MOTE_COUNT = 34;
/** Beyond this (m) from the camera the swarm isn't updated — a few pixels in
 * the fog. */
const MOTE_RANGE = 36;

interface Mote {
  a0: number;
  /** Turns over one life. */
  spin: number;
  base: number;
  /** Lives per second. */
  speed: number;
  ph: number;
  z: number;
  wob: number;
}

function newMote(): Mote {
  return {
    a0: Math.random() * Math.PI * 2,
    spin: 1 + Math.random() * 2.2,
    base: 0.55 + Math.random() * 0.6,
    speed: 0.12 + Math.random() * 0.24,
    ph: Math.random(),
    z: (Math.random() - 0.5) * 0.6,
    wob: Math.random() * Math.PI * 2,
  };
}

/** Glowing shards swirling around the tear: each spirals in from the rim as
 * if pulled through, growing then shrinking over its life, and is reborn at
 * the rim somewhere else — the rift's endless cycle. One instanced draw
 * call, hard-edged tetrahedra (pixels, like everything else). Gated by the
 * wound's activity so a sealed rift barely sparkles; proximity and a surge
 * quicken the swarm. */
function RiftMotes({ color, drive }: { color: string; drive: PortalDrive }) {
  const mesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const motes = useMemo(() => Array.from({ length: MOTE_COUNT }, newMote), []);
  const material = useMemo(() => new MeshBasicMaterial({ color, toneMapped: false }), [color]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock, camera }, rawDt) => {
    const m = mesh.current;
    if (!m) return;
    const e = m.matrixWorld.elements;
    const cx = camera.position.x - e[12];
    const cz = camera.position.z - e[14];
    if (cx * cx + cz * cz > MOTE_RANGE * MOTE_RANGE) return;
    const dt = Math.min(rawDt, 0.1);
    const t = clock.elapsedTime;
    const act = riftActivity(drive.seal);
    const quick = 1 + drive.proximity * 0.8 + drive.surge * 2.5;
    const size = act * (1 + drive.proximity * 0.25 + drive.surge * 0.6);
    for (let i = 0; i < MOTE_COUNT; i++) {
      const p = motes[i];
      p.ph += p.speed * quick * dt;
      if (p.ph >= 1) {
        p.ph -= 1;
        p.a0 = Math.random() * Math.PI * 2;
        p.base = 0.55 + Math.random() * 0.6;
      }
      const ph = p.ph;
      const R = (1.75 * (1 - ph) + 0.12) * p.base; // spiral from the rim to the heart
      const a = p.a0 + ph * p.spin * Math.PI * 2 + t * 0.3;
      dummy.position.set(
        Math.cos(a) * R * 0.7,
        Math.sin(a) * R * 1.05,
        Math.sin(ph * Math.PI) * p.z + Math.sin(t * 2 + p.wob) * 0.05,
      );
      // Fade in and out over the life.
      dummy.scale.setScalar(Math.max((0.018 + 0.05 * Math.sin(ph * Math.PI)) * size, 0.0001));
      dummy.rotation.set(t + p.wob, t * 1.3, 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[moteGeo(), material, MOTE_COUNT]}
      // Positions are rewritten every frame; the (unit) bounds would lie.
      frustumCulled={false}
    />
  );
}

// ── The rift ─────────────────────────────────────────────────────────────────

export function PortalModel({ color, drive }: { color: string; drive: PortalDrive }) {
  const tear = useRef<Group>(null);
  const material = useMemo(() => buildTearMaterial(color), [color]);
  const runes = useMemo(() => createRiftRuneMaterial(color), [color]);
  useEffect(
    () => () => {
      material.dispose();
      runes.dispose();
    },
    [material, runes],
  );

  useFrame(({ clock, camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const t = clock.elapsedTime;
    const u = material.uniforms;
    const act = riftActivity(drive.seal);
    // The seal breaking: 0 at both ends, peaking as the wound rips open.
    const breaking = 4 * drive.seal * (1 - drive.seal);
    const flare = breaking * 1.2 + drive.refusal * 0.9;
    const energy = 1 + drive.proximity * 0.25 + drive.surge * 0.9;
    u.uTime.value = t;
    // Integrated, so proximity can quicken the wound without it ever jumping.
    u.uClock.value += dt * (0.4 + 0.6 * act) * (1 + drive.proximity * 0.6 + drive.surge * 2.5);
    u.uActive.value = act;
    u.uEnergy.value = energy;
    u.uFlare.value = flare;
    runes.emissiveIntensity =
      RIFT_RUNE_GLOW * (0.3 + 0.7 * act) * (0.9 + 0.1 * Math.sin(t * 1.9)) * (energy + flare * 2.5);

    const g = tear.current;
    if (!g) return;
    // Billboard around Y so the tear always presents its face — a rip in
    // space has no flat side to catch. (The parent's world position: the
    // rift never moves or rotates, so its matrix is enough.)
    const e = g.parent ? g.parent.matrixWorld.elements : g.matrixWorld.elements;
    drive.yaw = Math.atan2(camera.position.x - e[12], camera.position.z - e[14]);
    g.rotation.y = drive.yaw;
    // Breathe, don't spin — a rip is a wound, not a machine. A journey
    // starting through it makes it gasp open.
    const swell = 1 + drive.surge * 0.1;
    g.scale.set(
      (1 + Math.sin(t * 1.7) * 0.02 * act) * swell,
      (1 + Math.sin(t * 1.7 + 1.2) * 0.015 * act) * swell,
      1,
    );
  });

  return (
    <group>
      <RiftFrameModel runes={runes} />
      <group ref={tear} position={[0, RIFT_Y, 0]}>
        <mesh geometry={tearGeo()} material={material} />
        <RiftMotes color={color} drive={drive} />
      </group>
    </group>
  );
}
