import type { CSSProperties } from "react";
import { Rng, hashSeed } from "../core/rng";

/** Grotesque in-universe UI. Nothing here should read as a "window": every
 * panel is a graft — a scrap of hide or slab of bone stitched over the
 * wizard's vision, with chewed edges and a slow breath. Surfaces are tiny
 * procedural noise tiles painted on canvases at first use (same philosophy as
 * render/textures.ts: no binary assets), upscaled with image-rendering:
 * pixelated so the chrome is exactly as chunky as the game behind it.
 *
 * The moving parts (breathing, transitions) live in the `themeCss` string —
 * mount it once from the HUD's <style> tag. */

export type UiTile = "flesh" | "bone" | "void";

const TILE = 40;
const tileCache = new Map<UiTile, string>();

function paintTile(kind: UiTile): string {
  if (typeof document === "undefined") return ""; // tests / SSR
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(TILE, TILE);
  const rng = new Rng(hashSeed(`ui:${kind}`));
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const n = rng.next();
      let r: number, g: number, b: number;
      if (kind === "flesh") {
        // Old meat: dark sinew, paler gristle flecks, sparse near-black veins.
        const vein = (x * 5 + y * 11) % 37 < 2 && n < 0.55;
        const gristle = n > 0.93;
        const v = vein ? 14 : 26 + n * 16 + (gristle ? 22 : 0);
        r = v * 1.45;
        g = v * 0.62;
        b = v * 0.66;
      } else if (kind === "bone") {
        // Weathered bone: pale plates, hairline cracks, brown marrow stains.
        const crack = n < 0.045;
        const stain = n > 0.9;
        const v = crack ? 78 : 168 + n * 26 - (stain ? 46 : 0);
        r = v;
        g = v * 0.93;
        b = v * 0.78;
      } else {
        // The far side of the tear: near-black with dead stars.
        const star = n > 0.985;
        const v = star ? 200 : 5 + n * 9;
        r = v * 0.85;
        g = v * 0.8;
        b = v * 1.1;
      }
      const o = (y * TILE + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

export function uiTile(kind: UiTile): string {
  const hit = tileCache.get(kind);
  if (hit !== undefined) return hit;
  const url = paintTile(kind);
  tileCache.set(kind, url);
  return url;
}

/** A chewed rectangle: pixel-stepped bites out of every edge, seeded so each
 * panel keeps its own silhouette across renders. Corners are gnawed hardest. */
export function chewedClip(seed: string): string {
  const rng = new Rng(hashSeed(`chew:${seed}`));
  const bite = () => 3 + Math.floor(rng.next() * 3) * 3; // 3|6|9 px steps
  const pts: string[] = [];
  // Top edge, left → right.
  pts.push(`0 ${bite()}px`, `${bite()}px ${bite()}px`, `${bite()}px 0`);
  pts.push(`${28 + Math.floor(rng.next() * 20)}% 0`, `${30 + Math.floor(rng.next() * 20)}% ${bite() - 2}px`, `${52 + Math.floor(rng.next() * 20)}% ${bite() - 2}px`, `${54 + Math.floor(rng.next() * 20)}% 0`);
  pts.push(`calc(100% - ${bite()}px) 0`, `calc(100% - ${bite()}px) ${bite()}px`, `100% ${bite()}px`);
  // Right edge, downward.
  pts.push(`100% ${25 + Math.floor(rng.next() * 20)}%`, `calc(100% - ${bite() - 2}px) ${28 + Math.floor(rng.next() * 20)}%`, `calc(100% - ${bite() - 2}px) ${55 + Math.floor(rng.next() * 15)}%`, `100% ${58 + Math.floor(rng.next() * 15)}%`);
  pts.push(`100% calc(100% - ${bite()}px)`, `calc(100% - ${bite()}px) calc(100% - ${bite()}px)`, `calc(100% - ${bite()}px) 100%`);
  // Bottom edge, right → left.
  pts.push(`${55 + Math.floor(rng.next() * 20)}% 100%`, `${52 + Math.floor(rng.next() * 20)}% calc(100% - ${bite() - 2}px)`, `${30 + Math.floor(rng.next() * 15)}% calc(100% - ${bite() - 2}px)`, `${27 + Math.floor(rng.next() * 15)}% 100%`);
  pts.push(`${bite()}px 100%`, `${bite()}px calc(100% - ${bite()}px)`, `0 calc(100% - ${bite()}px)`);
  // Left edge, upward.
  pts.push(`0 ${58 + Math.floor(rng.next() * 15)}%`, `${bite() - 2}px ${55 + Math.floor(rng.next() * 15)}%`, `${bite() - 2}px ${28 + Math.floor(rng.next() * 20)}%`, `0 ${25 + Math.floor(rng.next() * 20)}%`);
  return `polygon(${pts.join(", ")})`;
}

/** A graft of hide — the standard HUD surface. Chewed silhouette, stitched
 * seam inside, veins in the tile. Give each panel its own `seed`. */
export function fleshPanel(seed: string): CSSProperties {
  const tile = uiTile("flesh");
  return {
    backgroundColor: "#241014",
    backgroundImage: tile ? `url(${tile})` : undefined,
    backgroundSize: "80px 80px",
    imageRendering: "pixelated",
    clipPath: chewedClip(seed),
    boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.7), inset 0 0 24px rgba(0,0,0,0.65)",
    outline: "2px dashed rgba(216,200,168,0.28)", // the stitches holding it on
    outlineOffset: -7,
  };
}

/** A slab of carved bone — for the big overlays (menu, death, dev bench). */
export function bonePanel(seed: string): CSSProperties {
  const tile = uiTile("bone");
  return {
    backgroundColor: "#c8b898",
    backgroundImage: tile ? `url(${tile})` : undefined,
    backgroundSize: "96px 96px",
    imageRendering: "pixelated",
    clipPath: chewedClip(seed),
    boxShadow: "inset 0 0 0 3px rgba(40,24,16,0.55), inset 0 0 34px rgba(60,30,20,0.5)",
    color: "#3a2418",
  };
}

/** Lettering carved into bone (dark on pale). */
export const carved: CSSProperties = {
  color: "#3a2418",
  textShadow: "0 1px 0 rgba(255,250,230,0.5), 0 -1px 0 rgba(0,0,0,0.45)",
};

/** Lettering scarred into flesh (pale on dark). */
export const scarred: CSSProperties = {
  color: "#e0d4b8",
  textShadow: "0 2px 0 rgba(0,0,0,0.85)",
};

/** Pixel-block segmentation laid over any bar fill. */
export const barSegments =
  "repeating-linear-gradient(90deg, rgba(255,255,255,0.13) 0 2px, transparent 2px 8px)";

/** An open wound a bar fill sits in. */
export const woundTrack: CSSProperties = {
  background: "#0c0508",
  boxShadow: "inset 0 0 0 1px #000, inset 0 3px 4px rgba(0,0,0,0.9), 0 0 0 1px rgba(200,180,150,0.18)",
};

/** A knuckle of bone you press. */
export function boneButton(seed: string): CSSProperties {
  const tile = uiTile("bone");
  return {
    fontFamily: "'Courier New', monospace",
    fontSize: 15,
    letterSpacing: 2,
    padding: "11px 24px",
    backgroundColor: "#c0b090",
    backgroundImage: tile ? `url(${tile})` : undefined,
    backgroundSize: "80px 80px",
    imageRendering: "pixelated",
    clipPath: chewedClip(`btn:${seed}`),
    border: "none",
    boxShadow: "inset 0 0 0 2px rgba(40,24,16,0.5), inset 0 -6px 10px rgba(60,30,20,0.5)",
    ...carved,
    cursor: "pointer",
  };
}

/** Global keyframes + classes for the living parts of the chrome. Mounted
 * once from the HUD's <style> tag. */
export const themeCss = `
/* Grafts breathe. Slowly. */
.wm-breathe { animation: wm-breathe 3.4s ease-in-out infinite alternate; }
@keyframes wm-breathe { from { transform: var(--wm-anchor, none) scale(1); } to { transform: var(--wm-anchor, none) scale(1.012); } }

/* Crossing the tear: the slit rips open over the whole eye. */
.wm-tear-veil { animation: wm-veil-in 260ms ease-out forwards; }
@keyframes wm-veil-in { from { opacity: 0; } to { opacity: 1; } }
.wm-tear-slit { animation: wm-slit-open 1.4s cubic-bezier(.7,0,.3,1) infinite alternate; }
@keyframes wm-slit-open {
  0% { transform: scaleX(0.05) scaleY(0.9); filter: brightness(1); }
  100% { transform: scaleX(1) scaleY(1.05); filter: brightness(1.35); }
}
.wm-tear-text { animation: wm-text-pulse 1.2s ease-in-out infinite alternate; }
@keyframes wm-text-pulse { from { opacity: 0.45; } to { opacity: 1; } }

/* Arriving on the far side: the teal afterimage drains away. */
.wm-arrive { animation: wm-arrive 750ms ease-out forwards; }
@keyframes wm-arrive {
  0% { opacity: 1; }
  100% { opacity: 0; }
}
`;
