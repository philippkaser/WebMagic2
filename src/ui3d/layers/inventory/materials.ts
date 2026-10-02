import { Color, MeshBasicMaterial, PlaneGeometry, ShaderMaterial } from "three";
import { ink } from "../../theme";

/** Shared colours, geometry and flat materials of the inventory scene.
 *
 * Everything here is the grimoire's (ui3d/theme.ts) — soot, brass,
 * parchment, arcane — plus the few colours only items need: the green/red
 * of a stat comparison and the orange of loot the dungeon can still take
 * back (artpass's tooltip and card colours). */

export const INK = {
  accent: ink.arcane,
  gold: ink.gold,
  /** Unbanked run loot: lost if you fall (artpass's hourglass orange). */
  runLoot: "#ff9a7a",
  bright: ink.parchment,
  body: ink.parchment,
  dim: ink.parchmentDim,
  faint: ink.faded,
  better: "#7bea8d",
  worse: "#ff7066",
  danger: "#ff6a5a",
} as const;

let unitPlane: PlaneGeometry | null = null;
export function plane(): PlaneGeometry {
  return (unitPlane ??= new PlaneGeometry(1, 1));
}

const flats = new Map<string, MeshBasicMaterial>();

/** An unlit flat colour (pixel UI is never shaded), shared per colour. */
export function flat(color: string, opacity = 1): MeshBasicMaterial {
  const key = `${color}|${opacity}`;
  let m = flats.get(key);
  if (!m) {
    m = new MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, toneMapped: false });
    flats.set(key, m);
  }
  return m;
}

// ── The recess: a well sunk into a panel (artpass `.wm-grid`) ────────────────

const RECESS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** A shallow hollow worn into the stone, round-cornered: darker inside,
 * the shadow of its upper lip falling softly into it (dithered in texels,
 * no line), its lower lip catching the torch. No hard edge anywhere. */
const RECESS_FRAG = /* glsl */ `
uniform vec2 uSize;
uniform float uTexel;
uniform vec3 uEdge;
uniform vec3 uLit;
varying vec2 vUv;
float bayer4(vec2 c) {
  vec2 m = mod(c, 4.0);
  int i = int(m.x) + int(m.y) * 4;
  float b[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (b[i] + 0.5) / 16.0;
}
void main() {
  vec2 n = floor(uSize / uTexel);
  vec2 t = floor(vUv * uSize / uTexel);
  vec2 c = t + 0.5 - n * 0.5;
  float r = min(6.0, min(n.x, n.y) * 0.3);
  vec2 q = abs(c) - (n * 0.5 - r);
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  if (sd > 0.0) discard;
  float inside = clamp(-sd / 3.0, 0.0, 1.0);
  float a = 0.34 * step(bayer4(t), inside * 1.1 + 0.05);
  // The upper lip's shadow, fading over four texels.
  float fromTop = n.y - 1.0 - t.y;
  if (fromTop < 4.0) a = max(a, 0.5 * step(bayer4(t), 1.0 - fromTop / 4.0));
  vec3 col = vec3(0.0);
  // The lower lip, lit.
  if (t.y < 1.5 && -sd < 1.5) { col = uLit * 0.8; a = 0.6; }
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`;

const recesses = new Map<string, ShaderMaterial>();

/** A recess `w`×`h` (world) with `texel`-sized edges; shared per size. */
export function recessMaterial(w: number, h: number, texel: number): ShaderMaterial {
  const key = `${w.toFixed(4)}:${h.toFixed(4)}:${texel.toFixed(4)}`;
  let m = recesses.get(key);
  if (!m) {
    m = new ShaderMaterial({
      uniforms: {
        uSize: { value: [w, h] },
        uTexel: { value: texel },
        uEdge: { value: new Color("#05040a") },
        uLit: { value: new Color("#2e2735") },
      },
      vertexShader: RECESS_VERT,
      fragmentShader: RECESS_FRAG,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    });
    recesses.set(key, m);
  }
  return m;
}
