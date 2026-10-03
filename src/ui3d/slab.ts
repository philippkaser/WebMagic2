import { Color, ExtrudeGeometry, MeshStandardMaterial, Shape } from "three";
import { slabTextures } from "./materials";

/** Soft-edged slabs: the physical shape every small piece of the UI is cut
 * as — a prompt, a message, a tooltip, a button, a key cap. A rounded
 * rectangle extruded to a thickness with a bevel round its face, so its
 * corners are round and its edges catch the UI torch: no frame, no hard
 * square edge, just a worn piece of stone (or parchment) with depth.
 *
 * The geometry's face is at z = 0 (the slab sits behind it), centred on the
 * origin. Cached by size, so a hundred identical key caps share one. */

const cache = new Map<string, ExtrudeGeometry>();

export function slabGeometry(width: number, height: number, depth: number, radius?: number): ExtrudeGeometry {
  const r = Math.min(radius ?? Math.min(Math.min(width, height) * 0.28, Math.max(width, height) * 0.07), width / 2 - 1e-5, height / 2 - 1e-5);
  const bevel = Math.min(depth * 0.45, r * 0.5, Math.min(width, height) * 0.12);
  const key = `${width.toFixed(5)}|${height.toFixed(5)}|${depth.toFixed(5)}|${r.toFixed(5)}`;
  let g = cache.get(key);
  if (!g) {
    // The bevel grows the outline outward: draw it inset by the bevel so
    // the finished slab is exactly width × height.
    const w = width / 2 - bevel;
    const h = height / 2 - bevel;
    const rr = Math.max(1e-5, r - bevel);
    const s = new Shape();
    s.moveTo(-w + rr, -h);
    s.lineTo(w - rr, -h);
    s.quadraticCurveTo(w, -h, w, -h + rr);
    s.lineTo(w, h - rr);
    s.quadraticCurveTo(w, h, w - rr, h);
    s.lineTo(-w + rr, h);
    s.quadraticCurveTo(-w, h, -w, h - rr);
    s.lineTo(-w, -h + rr);
    s.quadraticCurveTo(-w, -h, -w + rr, -h);
    g = new ExtrudeGeometry(s, {
      depth: Math.max(1e-5, depth - bevel * 2),
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 6,
    });
    // Face at z = 0, body behind it.
    g.translate(0, 0, -(depth - bevel));
    // UVs in metres → a slab-sized patch of the stone texture.
    const uv = g.attributes.uv!;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.6 + 0.5, uv.getY(i) * 1.6 + 0.5);
    cache.set(key, g);
  }
  return g;
}

const mats = new Map<string, MeshStandardMaterial>();

/** Dark slate, faintly warmed by an accent colour (an omen's violet, home's
 * gold): the accent tints the stone and glows from within it a little, so
 * a slab says what kind of thing it carries without a coloured frame. */
export function slabMaterial(accent: string | null = null, base = "#221d28"): MeshStandardMaterial {
  const key = `${accent}|${base}`;
  let m = mats.get(key);
  if (!m) {
    const { map, normalMap } = slabTextures();
    const color = new Color(base);
    if (accent) color.lerp(new Color(accent), 0.1);
    m = new MeshStandardMaterial({
      color,
      map,
      normalMap,
      roughness: 0.7,
      metalness: 0.05,
      emissive: accent ? new Color(accent) : new Color("#000000"),
      emissiveIntensity: accent ? 0.035 : 0,
    });
    mats.set(key, m);
  }
  return m;
}

/** Parchment for key caps: pale, matte, a little worn. */
export function parchmentMaterial(): MeshStandardMaterial {
  return slabMaterial(null, "#e6dbbf");
}
