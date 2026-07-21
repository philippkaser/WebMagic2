import type { CSSProperties } from "react";
import { Rng, hashSeed } from "../core/rng";

/** In-universe UI chrome. The DOM HUD is dressed as objects that could exist
 * in the world — riveted iron slabs, cracked leather, bone trim — instead of
 * floating windows. Panel surfaces are tiny procedural noise tiles painted on
 * canvases at first use (same philosophy as render/textures.ts: no binary
 * assets), upscaled with image-rendering: pixelated so the chrome is exactly
 * as chunky as the game behind it. */

export type UiTile = "iron" | "leather";

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
  for (let i = 0; i < TILE * TILE; i++) {
    const n = rng.next();
    let r: number, g: number, b: number;
    if (kind === "iron") {
      // Cold hammered iron with the occasional pit and pale scratch.
      const v = 22 + n * 12 + (n > 0.96 ? 16 : 0) - (n < 0.05 ? 10 : 0);
      r = v * 0.92;
      g = v * 0.88;
      b = v * 1.12;
    } else {
      // Old leather: warm dark hide, worn patches, cracked grain.
      const v = 30 + n * 14 - (n < 0.07 ? 12 : 0) + (n > 0.94 ? 10 : 0);
      r = v * 1.15;
      g = v * 0.78;
      b = v * 0.52;
    }
    const o = i * 4;
    img.data[o] = r;
    img.data[o + 1] = g;
    img.data[o + 2] = b;
    img.data[o + 3] = 255;
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

/** Corner rivets, layered over a tile as CSS gradients. */
function rivets(color = "#5c5268"): string {
  const dot = (x: string, y: string) =>
    `radial-gradient(circle at ${x} ${y}, ${color} 0 2px, rgba(0,0,0,0.65) 2px 3px, transparent 3px)`;
  return [dot("6px", "6px"), dot("calc(100% - 6px)", "6px"), dot("6px", "calc(100% - 6px)"), dot("calc(100% - 6px)", "calc(100% - 6px)")].join(", ");
}

/** A riveted iron slab — the standard HUD surface. */
export function ironSlab(): CSSProperties {
  const tile = uiTile("iron");
  return {
    backgroundColor: "#14101a",
    backgroundImage: `${rivets()}${tile ? `, url(${tile})` : ""}`,
    backgroundSize: `auto, auto, auto, auto${tile ? ", 80px 80px" : ""}`,
    imageRendering: "pixelated",
    border: "2px solid #060409",
    boxShadow:
      "0 0 0 2px #3a3244, 0 0 0 4px #060409, inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -2px 0 rgba(0,0,0,0.5), 0 5px 0 rgba(0,0,0,0.4)",
  };
}

/** A cracked-leather board — the inventory/ledger surface. */
export function leatherBoard(): CSSProperties {
  const tile = uiTile("leather");
  return {
    backgroundColor: "#1c1310",
    backgroundImage: `${rivets("#6a5138")}${tile ? `, url(${tile})` : ""}`,
    backgroundSize: `auto, auto, auto, auto${tile ? ", 80px 80px" : ""}`,
    imageRendering: "pixelated",
    border: "2px solid #060409",
    boxShadow:
      "0 0 0 2px #4a3826, 0 0 0 4px #060409, inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -2px 0 rgba(0,0,0,0.5), 0 6px 0 rgba(0,0,0,0.45)",
  };
}

/** Engraved lettering — chiseled into the surface rather than printed on it. */
export const engraved: CSSProperties = {
  color: "#d8cfb8",
  textShadow: "0 2px 0 #000, 0 -1px 0 rgba(255,255,255,0.07)",
};

/** Pixel-block segmentation laid over any bar fill. */
export const barSegments =
  "repeating-linear-gradient(90deg, rgba(255,255,255,0.13) 0 2px, transparent 2px 8px)";

/** Recessed track a bar fill sits in. */
export const barTrack: CSSProperties = {
  background: "#0a070d",
  border: "1px solid #060409",
  boxShadow: "0 0 0 1px #3a3244, inset 0 2px 2px rgba(0,0,0,0.8)",
};

/** A carved stone button with a physical press. */
export const stoneButton: CSSProperties = {
  fontFamily: "'Courier New', monospace",
  fontSize: 16,
  letterSpacing: 2,
  padding: "12px 26px",
  backgroundColor: "#1a1522",
  color: "#d8cfb8",
  textShadow: "0 2px 0 #000",
  border: "2px solid #060409",
  boxShadow: "0 0 0 1px #4a4256, inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 0 #060409",
  imageRendering: "pixelated",
  cursor: "pointer",
};
