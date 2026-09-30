import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  ShaderMaterial,
  TorusGeometry,
  UniformsLib,
  UniformsUtils,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { VORTEX_NOISE_GLSL } from "../../transition/vortexGlsl";
import { SEAL_GLYPHS, getSealGlyphAtlas } from "../textures";
import { shared, surfaceMaterial } from "./shared";

/** The portal: stone steps, a dark metal ring, and inside it a living vortex.
 * Origin is the ground at the portal's centre; the ring stands at
 * PORTAL_RING_Y.
 *
 * The vortex is a shader, not a texture (zero binary assets): a tunnel seen
 * head-on in log-polar coordinates. Three layers of periodic fbm flow inward
 * and spin — the deeper a layer, the slower, darker and finer it is — so the
 * core seems to recede while the rim burns; spiral arms, hot filaments and
 * twinkling flecks ride on top, and the event horizon's edge wobbles and
 * shimmers against the ring. An additive corona licks flames over the ring
 * (its silhouette seems to waver in the heat) and a swarm of motes spirals in.
 * Everything glowing is written far above 1.0 for the bloom pass.
 *
 * Behaviour (world/props.tsx Portal) owns the pooled light, the sparks, the
 * prompt and the numbers in `drive`, which the model reads every frame:
 * proximity (the vortex quickens and brightens as the player nears), the seal
 * (1 = sealed … 0 = open; animating it down BREAKS the seal) and surge (a
 * journey is starting through this portal).
 *
 * SEALED (the way home before the Tithe is paid, exits while a boss lives):
 * the vortex stops dead and drains to a dim, frosted glass cracked in a
 * spiderweb whose cracks glow in the seal's colour — and pulse brighter when
 * someone comes close — while the ring of carved glyph plates slowly
 * counter-rotates over it: "this opens, just not yet". */

/** Height of the ring's centre above the portal origin. */
export const PORTAL_RING_Y = 1.5;

/** Numbers the behaviour writes and the model reads every frame. */
export interface PortalDrive {
  /** 0…1 — how close the player is (1 = at the steps). */
  proximity: number;
  /** 1 = sealed, 0 = open. Easing it from 1 to 0 plays the seal breaking. */
  seal: number;
  /** 0…1 flare while a journey starts through this portal; decays. */
  surge: number;
  /** 0…1 flare when someone tries a sealed portal; decays. */
  refusal: number;
}

export function newPortalDrive(locked: boolean): PortalDrive {
  return { proximity: 0, seal: locked ? 1 : 0, surge: 0, refusal: 0 };
}

/** Which way a portal of this colour swirls: warm (gold, the way home) turns
 * the other way from cool (cyan, the way down) — up and down should feel
 * like opposites. */
export function portalSpinDir(color: string): 1 | -1 {
  const hsl = { h: 0, s: 0, l: 0 };
  new Color(color).getHSL(hsl);
  return hsl.h > 0.03 && hsl.h < 0.2 ? -1 : 1;
}

const stepGeo = shared(() => new BoxGeometry(3.4, 0.24, 1.6));
const stepMat = shared(() =>
  surfaceMaterial("slab", { roughness: 0.85, metalness: 0.05, envMapIntensity: 0.5 }),
);
const ringGeo = shared(() => new TorusGeometry(1.15, 0.13, 8, 24));
const ringMat = shared(
  () => new MeshStandardMaterial({ color: "#2c2836", metalness: 0.6, roughness: 0.35 }),
);
/** The vortex fills r ≤ ~1.0 and its burning rim runs under the ring. */
const discGeo = shared(() => new PlaneGeometry(2.2, 2.2));
/** Two quads, just in front of and behind the ring, for the flame corona. */
const coronaGeo = shared(() => {
  const front = new PlaneGeometry(3.6, 3.6);
  front.translate(0, 0, 0.16);
  const back = new PlaneGeometry(3.6, 3.6);
  back.rotateY(Math.PI);
  back.translate(0, 0, -0.16);
  const merged = mergeGeometries([front, back]);
  front.dispose();
  back.dispose();
  return merged;
});

const MOTE_COUNT = 56;
/** Point motes: positions are computed in the vertex shader from a per-mote
 * seed, so the swarm costs one draw call and zero CPU per frame. */
const motesPointsGeo = shared(() => {
  const g = new BufferGeometry();
  const seeds = new Float32Array(MOTE_COUNT * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  g.setAttribute("position", new BufferAttribute(new Float32Array(MOTE_COUNT * 3), 3));
  g.setAttribute("aSeed", new BufferAttribute(seeds, 3));
  return g;
});

// ── Shaders ──────────────────────────────────────────────────────────────────

const LOCAL_VERTEX = /* glsl */ `
varying vec2 vP;
#include <fog_pars_vertex>
void main() {
  vP = position.xy;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const COMMON_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform float uClock;
uniform float uProx;
uniform float uSeal;
uniform float uSurge;
uniform float uRefusal;
uniform float uSeed;
uniform float uSpinDir;
uniform vec3 uColor;
uniform vec3 uHot;
uniform vec3 uDeep;
uniform vec3 uSealColor;
const float TAU = 6.2831853;
`;

const DISC_FRAGMENT = /* glsl */ `
varying vec2 vP;
${COMMON_UNIFORMS}
#include <fog_pars_fragment>
${VORTEX_NOISE_GLSL}

/** Distance from p to a straight crack through o at angle th, if p lies
 * within len of o along it (else a large number). */
float crackLine(vec2 p, vec2 o, float th, float len) {
  vec2 d = vec2(cos(th), sin(th));
  vec2 q = p - o;
  float along = dot(q, d);
  float perp = abs(q.x * d.y - q.y * d.x);
  return along > 0.0 && along < len ? perp : 9.0;
}

void main() {
  vec2 p = vP;
  // Seen from behind, mirror so it still swirls the same way.
  if (!gl_FrontFacing) p.x = -p.x;
  float r = length(p);
  if (r > 1.09) discard;
  float a = atan(p.y, p.x);
  float open = 1.0 - uSeal;
  float energy = 1.0 + uProx * 0.45 + uSurge * 0.7;
  float tc = uClock;
  float dir = uSpinDir;

  // The event horizon: its edge wobbles (more when you're close).
  float wob = (vxNoiseP(vec2(a / TAU * 12.0, uTime * 1.7), 12.0) - 0.5) * (0.07 + 0.05 * uProx) * open;
  float edge = 0.97 + wob;
  float rn = clamp(r / edge, 0.0, 1.0);
  float lr = log(max(rn, 0.015));

  // Three layers, back to front — deeper = slower, darker, finer. Most of
  // the disc stays under the bloom threshold so the bright filaments and the
  // rim are what glow: structure, not a white blob.
  vec3 col = uDeep * 0.25;
  {
    float u = a / TAU + dir * (tc * 0.18 + lr * 0.16);
    float v = lr * 1.1 + tc * 0.25;
    float n = vxFbmP(vec2(u * 6.0, v), 6.0);
    col += uDeep * 1.4 * n + uColor * 0.1 * n * n;
  }
  float arms;
  {
    float u = a / TAU + dir * (tc * 0.36 + lr * 0.3);
    float v = lr * 1.9 + tc * 0.55;
    float n = vxFbmP(vec2(u * 8.0, v), 8.0);
    float s = sin((a + dir * (lr * 2.4 + tc * 1.2)) * 3.0) * 0.5 + 0.5;
    arms = smoothstep(0.42, 0.92, n * 0.7 + s * 0.45);
    col = mix(col, uColor * (0.42 + 0.22 * energy), arms * 0.9);
  }
  {
    float u = a / TAU + dir * (tc * 0.6 + lr * 0.45);
    float v = lr * 3.0 + tc * 1.1;
    float n = vxFbmP(vec2(u * 14.0, v), 14.0);
    col += mix(uColor, uHot, 0.6) * pow(n, 4.0) * 1.6 * energy * (0.35 + arms);
  }
  // The core recedes: dark at the heart, with a pinprick of far light.
  col *= mix(0.1, 1.0, smoothstep(0.0, 0.55, rn));
  col += uHot * exp(-rn * 16.0) * 1.1 * energy;
  // The rim burns.
  float rim = smoothstep(0.62, 1.0, rn);
  col += uColor * rim * rim * rim * 1.3 * energy;
  // Sparkle flecks riding the spiral (faded near the core, where the cells
  // shrink below a pixel and would only shimmer).
  {
    float u = a / TAU * 36.0 + dir * tc * 3.0;
    float v = lr * 5.0 + tc * 1.4;
    vec2 cell = vec2(mod(floor(u), 36.0), floor(v));
    float h = vxHash21(cell + uSeed);
    vec2 f = vec2(fract(u), fract(v)) - 0.5;
    float tw = pow(max(0.0, sin(uTime * (2.0 + h * 5.0) + h * 40.0)), 14.0);
    float dotMask = 1.0 - smoothstep(0.15, 0.4, length(f));
    col += uHot * 3.0 * tw * dotMask * step(0.8 - uProx * 0.1, h) * smoothstep(0.3, 0.6, rn);
  }
  // The shimmering horizon band itself, bright enough to bloom.
  float band = smoothstep(edge - 0.055, edge, r);
  float shimmer = 0.5 + 0.5 * sin(a * 22.0 * dir + uTime * 9.0) * (vxNoiseP(vec2(a / TAU * 20.0, uTime * 4.0), 20.0) * 2.0 - 0.6);
  vec3 rimCol = mix(uColor * 1.6, uHot * 2.1, clamp(shimmer, 0.0, 1.0)) * energy;
  vec3 openCol = mix(col, rimCol, band);

  // ── Sealed: the vortex stopped dead, frosted, cracked ──
  // (uSeal is a uniform, so this branch is coherent: open portals skip the
  // glass entirely.)
  if (uSeal < 0.001) {
    gl_FragColor = vec4(openCol, 1.0);
    #include <fog_fragment>
    return;
  }
  float lum = dot(col, vec3(0.3, 0.5, 0.2));
  vec3 frozen = mix(vec3(lum), uSealColor * lum, 0.3) * 0.22 + uDeep * 0.1;
  frozen *= 0.8 + 0.4 * vxNoise(p * 14.0 + uSeed); // frost grain
  float sheen = smoothstep(0.86, 1.0, sin((p.x * 0.8 + p.y) * 2.4 + 0.7));
  frozen += vec3(0.5, 0.6, 0.75) * sheen * 0.06;
  // Cracked like struck glass: straight spokes from an off-centre impact,
  // and broken chords between them.
  vec2 o = vec2(0.24, -0.18) * (0.5 + fract(uSeed * 0.37));
  float d = 9.0;
  for (int k = 0; k < 9; k++) {
    float fk = float(k);
    float th = (fk + 0.5 + (vxHash11(fk + uSeed) - 0.5) * 0.7) * TAU / 9.0;
    d = min(d, crackLine(p, o, th, 0.55 + vxHash11(fk * 3.1 + uSeed) * 0.9));
  }
  vec2 ip = p - o;
  float ir = length(ip);
  float ia = atan(ip.y, ip.x);
  float si = floor(ia / TAU * 9.0);
  float sc = (si + 0.5) * TAU / 9.0;
  float proj = ir * cos(ia - sc);
  for (int k = 0; k < 3; k++) {
    float rho = 0.2 + float(k) * 0.24 + (vxHash21(vec2(si, float(k)) + uSeed) - 0.5) * 0.1;
    float on = step(0.4, vxHash21(vec2(si + 17.0, float(k)) + uSeed));
    d = min(d, on > 0.5 ? abs(proj - rho) : 9.0);
  }
  float crack = (1.0 - smoothstep(0.012, 0.03, d)) * (1.0 - smoothstep(0.92, 0.99, r));
  float impact = exp(-ir * 26.0);
  float pulse = pow(0.5 + 0.5 * sin(ir * 8.0 - uTime * 2.6), 6.0);
  // Breaking: the cracks flare white-hot halfway through.
  float breaking = 4.0 * uSeal * (1.0 - uSeal);
  float crackGlow = 0.55 + pulse * (0.4 + 1.4 * uProx) + uRefusal * 3.0 + breaking * 5.0;
  frozen += uSealColor * (crack * crackGlow + impact * (0.8 + uRefusal * 2.0));
  // A thin, cold, steady rim.
  frozen = mix(frozen, uSealColor * 0.7, smoothstep(edge - 0.03, edge, r));

  vec3 outCol = mix(openCol, frozen, uSeal);
  gl_FragColor = vec4(outCol, 1.0);
  #include <fog_fragment>
}
`;

const CORONA_FRAGMENT = /* glsl */ `
varying vec2 vP;
${COMMON_UNIFORMS}
${VORTEX_NOISE_GLSL}

void main() {
  float r = length(vP);
  // Nothing to draw inside the ring or past the longest tongue.
  if (r < 0.98 || r > 1.75) discard;
  float a = atan(vP.y, vP.x);
  float open = 1.0 - uSeal;
  float energy = 1.0 + uProx * 0.7 + uSurge * 1.2;
  // Flame tongues licking outward over the ring: its silhouette seems to
  // waver in the heat.
  float n = vxFbmP(vec2(a / TAU * 18.0 + uSpinDir * uTime * 0.15, r * 3.4 - uTime * 1.5), 18.0);
  float tongues = smoothstep(0.5, 0.9, n);
  float reach = 1.22 + 0.12 * energy + tongues * 0.3;
  float glow = smoothstep(1.0, 1.1, r) * (1.0 - smoothstep(1.1, reach, r)) * (0.08 + tongues * 0.9);
  // Soft outer halo.
  glow += smoothstep(1.0, 1.15, r) * exp(-max(r - 1.15, 0.0) * 5.0) * 0.05;
  vec3 col = mix(uColor, uHot, tongues * 0.5) * glow * energy * mix(0.1, 1.0, open);
  gl_FragColor = vec4(col, 1.0);
}
`;

const MOTES_VERTEX = /* glsl */ `
attribute vec3 aSeed;
uniform float uClock;
uniform float uProx;
uniform float uSeal;
uniform float uSurge;
uniform float uSpinDir;
uniform float uPx;
varying float vAlpha;
varying float vHeat;
void main() {
  float life = fract(uClock * (0.1 + aSeed.z * 0.07) + aSeed.x);
  float e = life * life;
  float rad = mix(2.3, 0.06, e);
  float side = aSeed.z > 0.5 ? 1.0 : -1.0;
  float ang = aSeed.y * 6.2831853 + uSpinDir * e * 5.0;
  vec3 pos = vec3(cos(ang) * rad, sin(ang) * rad, side * mix(0.35 + aSeed.x * 0.9, 0.0, e));
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, 0.075 * (1.0 - e * 0.5) * projectionMatrix[1][1] * uPx / -mv.z);
  vAlpha = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.86, 1.0, life))
    * (1.0 - uSeal) * (0.35 + 0.65 * uProx + uSurge);
  vHeat = e;
}
`;

const MOTES_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
varying float vAlpha;
varying float vHeat;
void main() {
  // Square points on purpose: they're pixels, like everything else.
  vec3 col = mix(uColor * 1.8, uHot * 2.8, vHeat);
  gl_FragColor = vec4(col * vAlpha, 1.0);
}
`;

interface PortalUniforms {
  uTime: { value: number };
  uClock: { value: number };
  uProx: { value: number };
  uSeal: { value: number };
  uSurge: { value: number };
  uRefusal: { value: number };
  uSeed: { value: number };
  uSpinDir: { value: number };
  uPx: { value: number };
  uColor: { value: Color };
  uHot: { value: Color };
  uDeep: { value: Color };
  uSealColor: { value: Color };
}

/** Per-portal materials sharing one uniform set (so one write per frame
 * drives disc, corona and motes alike). */
function buildMaterials(color: string, sealColor: string) {
  const base = new Color(color);
  const hot = base.clone().lerp(new Color("#ffffff"), 0.72);
  // The deep shade: darker, and nudged round the hue wheel so the vortex has
  // depth instead of being one flat colour.
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const deep = new Color().setHSL((hsl.h + 0.08) % 1, Math.min(1, hsl.s * 0.9 + 0.1), 0.07);
  const uniforms: PortalUniforms = {
    uTime: { value: 0 },
    uClock: { value: Math.random() * 100 },
    uProx: { value: 0 },
    uSeal: { value: 0 },
    uSurge: { value: 0 },
    uRefusal: { value: 0 },
    uSeed: { value: Math.floor(Math.random() * 1000) },
    uSpinDir: { value: portalSpinDir(color) },
    uPx: { value: 100 },
    uColor: { value: base },
    uHot: { value: hot },
    uDeep: { value: deep },
    uSealColor: { value: new Color(sealColor) },
  };
  const disc = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog]) as Record<string, { value: unknown }>,
    vertexShader: LOCAL_VERTEX,
    fragmentShader: DISC_FRAGMENT,
    side: DoubleSide,
    fog: true,
  });
  // Merge keeps fog's own uniforms; ours are shared by reference.
  Object.assign(disc.uniforms, uniforms);
  const corona = new ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    vertexShader: LOCAL_VERTEX.replace("#include <fog_pars_vertex>", "").replace("#include <fog_vertex>", ""),
    fragmentShader: CORONA_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const motes = new ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    vertexShader: MOTES_VERTEX,
    fragmentShader: MOTES_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  return { uniforms, disc, corona, motes };
}

// ── The seal ─────────────────────────────────────────────────────────────────

const SEAL_RADIUS = 0.74;
const PLATE = 0.26;
const MOTES = 6;

/** Every glyph plate, both faces of the disc, merged into ONE geometry (one
 * draw call). Each plate's UVs are remapped onto its own atlas slot, and
 * plates are turned so each glyph's "up" points away from the centre. */
const sealPlatesGeo = shared(() => {
  const parts: BufferGeometry[] = [];
  for (const side of [1, -1]) {
    for (let k = 0; k < SEAL_GLYPHS; k++) {
      const g = new PlaneGeometry(PLATE, PLATE);
      const uv = g.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setX(i, (k + uv.getX(i)) / SEAL_GLYPHS);
      // Back-face plates sit half a slot round so the two faces interleave.
      const a = ((k + (side < 0 ? 0.5 : 0)) / SEAL_GLYPHS) * Math.PI * 2;
      // Flip back plates to face −Z FIRST, so the Z turn still points their
      // glyph's up (+Y) outward and they read unmirrored from behind.
      if (side < 0) g.rotateY(Math.PI);
      g.rotateZ(a - Math.PI / 2);
      g.translate(Math.cos(a) * SEAL_RADIUS, Math.sin(a) * SEAL_RADIUS, 0.05 * side);
      parts.push(g);
    }
  }
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return merged;
});

const bindingGeo = shared(() => new TorusGeometry(SEAL_RADIUS - 0.2, 0.012, 4, 48));

const motesGeo = shared(() => {
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < MOTES; k++) {
    const a = (k / MOTES) * Math.PI * 2;
    const g = new OctahedronGeometry(0.05);
    g.translate(Math.cos(a) * 1.38, Math.sin(a) * 1.38, k % 2 ? 0.06 : -0.06);
    parts.push(g);
  }
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return merged;
});

/** The rune seal. While the portal is sealed the plates slowly
 * counter-rotate and breathe, flaring when someone comes close or tries the
 * portal. When the seal breaks (drive.seal easing to 0) the plates are flung
 * outward, spinning, flaring white-hot, and gone. */
function PortalSeal({ color, drive }: { color: string; drive: PortalDrive }) {
  const root = useRef<Group>(null);
  const plates = useRef<Group>(null);
  const motes = useRef<Group>(null);
  const spin = useRef(0);
  const mats = useMemo(() => {
    const atlas = getSealGlyphAtlas();
    return {
      glyph: new MeshStandardMaterial({
        color: "#000000",
        emissive: color,
        emissiveIntensity: 1.8,
        emissiveMap: atlas,
        alphaMap: atlas,
        // Hard cut, no blending: crisp pixel glyphs and no sort order issues.
        alphaTest: 0.5,
        toneMapped: false,
      }),
      mote: new MeshStandardMaterial({
        color: "#000000",
        emissive: color,
        emissiveIntensity: 2.2,
        toneMapped: false,
      }),
    };
  }, [color]);
  useEffect(
    () => () => {
      mats.glyph.dispose();
      mats.mote.dispose();
    },
    [mats],
  );

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const broken = 1 - drive.seal; // 0 while sealed … 1 once gone
    if (root.current) root.current.visible = drive.seal > 0.02;
    spin.current += dt * (0.22 + broken * broken * 9);
    if (plates.current) {
      plates.current.rotation.z = -spin.current;
      // Breathing while sealed; flung outward as it breaks.
      plates.current.scale.setScalar(1 + Math.sin(t * 0.9) * 0.025 + drive.proximity * 0.03 + broken * broken * 1.6);
    }
    if (motes.current) {
      motes.current.rotation.z = t * 0.45 + spin.current * 0.5;
      motes.current.scale.setScalar(1 + broken * 0.8);
    }
    // A white-hot flare peaking halfway through the break.
    const flare = 1 + drive.refusal * 2.2 + 12 * broken * (1 - broken);
    mats.glyph.emissiveIntensity =
      (1.7 + Math.sin(t * 1.9) * 0.5 + drive.proximity * 0.9) * flare;
    mats.mote.emissiveIntensity = (2.2 + drive.proximity) * flare;
  });

  return (
    <group ref={root} position={[0, PORTAL_RING_Y, 0]}>
      <group ref={plates}>
        <mesh geometry={sealPlatesGeo()} material={mats.glyph} />
        <mesh geometry={bindingGeo()} material={mats.mote} />
      </group>
      <group ref={motes}>
        <mesh geometry={motesGeo()} material={mats.mote} />
      </group>
    </group>
  );
}

/** How long the seal stays mounted after unlocking, to play its breaking. */
const SEAL_BREAK_MS = 1800;

export function PortalModel({
  color,
  locked = false,
  sealColor,
  drive,
}: {
  /** The vortex's colour (and, by default, the seal's). */
  color: string;
  /** Show the rune seal (the vortex's frozen look follows drive.seal). */
  locked?: boolean;
  /** Seal rune colour, if it should differ from the vortex. */
  sealColor?: string;
  drive: PortalDrive;
}) {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const mats = useMemo(() => buildMaterials(color, sealColor ?? color), [color, sealColor]);
  useEffect(
    () => () => {
      mats.disc.dispose();
      mats.corona.dispose();
      mats.motes.dispose();
    },
    [mats],
  );

  // Keep the seal mounted a moment after unlocking, so it can shatter.
  const [sealMounted, setSealMounted] = useState(locked);
  useEffect(() => {
    if (locked) {
      setSealMounted(true);
      return;
    }
    const id = setTimeout(() => setSealMounted(false), SEAL_BREAK_MS);
    return () => clearTimeout(id);
  }, [locked]);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const u = mats.uniforms;
    u.uTime.value = clock.elapsedTime;
    // The vortex's own clock: integrated, so proximity can quicken it (and a
    // seal stop it dead) without the pattern ever jumping.
    u.uClock.value += dt * (1 - drive.seal) * (1 + drive.proximity * 0.9 + drive.surge * 2.5);
    u.uProx.value = drive.proximity;
    u.uSeal.value = drive.seal;
    u.uSurge.value = drive.surge;
    u.uRefusal.value = drive.refusal;
    u.uPx.value = (size.height * dpr) / 2;
  });

  return (
    <group>
      {/* Steps */}
      <mesh geometry={stepGeo()} material={stepMat()} position={[0, 0.12, 0]} receiveShadow />
      <group position={[0, PORTAL_RING_Y, 0]}>
        <mesh geometry={ringGeo()} material={ringMat()} castShadow />
        <mesh geometry={discGeo()} material={mats.disc} />
        <mesh geometry={coronaGeo()} material={mats.corona} />
        {/* Positions come from the shader, so the (zeroed) bounds lie. */}
        <points geometry={motesPointsGeo()} material={mats.motes} frustumCulled={false} />
      </group>
      {sealMounted && <PortalSeal color={sealColor ?? color} drive={drive} />}
    </group>
  );
}
