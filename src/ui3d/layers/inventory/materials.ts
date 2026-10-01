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

const RECESS_FRAG = /* glsl */ `
uniform vec2 uSize;
uniform float uTexel;
uniform vec3 uEdge;
uniform vec3 uLit;
varying vec2 vUv;
void main() {
  vec2 t = floor(vUv * uSize / uTexel);
  vec2 n = floor(uSize / uTexel);
  // Darkened soot, a hard 2-texel shadow under the top lip, a 1-texel
  // inset edge, and a lit bottom lip (light comes from above).
  vec4 col = vec4(0.0, 0.0, 0.0, 0.42);
  if (t.y >= n.y - 3.0) col = vec4(0.0, 0.0, 0.0, 0.7);
  if (t.x < 1.0 || t.x >= n.x - 1.0 || t.y >= n.y - 1.0) col = vec4(uEdge, 1.0);
  if (t.y < 1.0) col = vec4(uLit, 1.0);
  gl_FragColor = vec4(col.rgb * col.a, col.a);
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
