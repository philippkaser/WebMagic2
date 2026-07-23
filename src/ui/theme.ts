import type { CSSProperties } from "react";
import { Rng, hashSeed } from "../core/rng";

/** In-universe UI, cut from the same cloth as the dungeon: aged, dim, warm —
 * slabs of dark scrying-stone and enchanted vellum the wizard reads by
 * candle, not glowing sci-fi glass. Surfaces carry a faint procedural ash
 * texture (same no-binary-assets philosophy as render/textures.ts), upscaled
 * with image-rendering: pixelated so the chrome stays as chunky as the game
 * behind it. Edges are torn by hand, the light is low, the color is warm.
 *
 * The gentle living parts (fade-in, float, transition veils) live in the
 * `themeCss` string — mount it once from the HUD's <style> tag. */

const RIM = "rgba(150,120,148,0.30)"; // dim dusty-violet enchantment on an edge
const RIM_SOFT = "rgba(150,120,148,0.20)";

// ── Procedural ash texture ────────────────────────────────────────────────────

const TILE = 48;
let ashUrl: string | null = null;

function ashTexture(): string {
  if (ashUrl !== null) return ashUrl;
  if (typeof document === "undefined") return (ashUrl = ""); // tests / SSR
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return (ashUrl = "");
  const img = ctx.createImageData(TILE, TILE);
  const rng = new Rng(hashSeed("ui:ash"));
  for (let i = 0; i < TILE * TILE; i++) {
    const n = rng.next();
    // Warm near-black vellum: low-contrast mottling, the odd darker fleck of
    // char, and very rarely a dim ember — nothing bright enough to read as
    // static or a screen.
    const char = n < 0.06;
    const ember = n > 0.992;
    const v = char ? 10 : 22 + n * 12;
    const o = i * 4;
    img.data[o] = ember ? 120 : v * 1.15;
    img.data[o + 1] = ember ? 70 : v * 0.86;
    img.data[o + 2] = ember ? 42 : v * 0.98;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (ashUrl = canvas.toDataURL());
}

// ── Torn silhouette ───────────────────────────────────────────────────────────

/** A hand-torn edge: the rectangle's border nibbled inward by small pixel
 * steps, seeded so each panel keeps its own ragged outline. No outward spikes
 * or geometric teeth — just the frayed edge of an old page. */
export function tornClip(seed: string): string {
  const rng = new Rng(hashSeed(`torn:${seed}`));
  const jit = () => Math.floor(rng.next() * 3) * 3; // 0 | 3 | 6 px inward
  const n = 7;
  const p: string[] = [];
  for (let i = 0; i <= n; i++) p.push(`${((i / n) * 100).toFixed(1)}% ${jit()}px`); // top L→R
  for (let i = 1; i <= n; i++) p.push(`calc(100% - ${jit()}px) ${((i / n) * 100).toFixed(1)}%`); // right
  for (let i = 1; i <= n; i++) p.push(`${(100 - (i / n) * 100).toFixed(1)}% calc(100% - ${jit()}px)`); // bottom
  for (let i = 1; i < n; i++) p.push(`${jit()}px ${(100 - (i / n) * 100).toFixed(1)}%`); // left
  return `polygon(${p.join(", ")})`;
}

// ── Surfaces ──────────────────────────────────────────────────────────────────

/** The standard panel: a dim slab of scrying-stone. Torn silhouette, warm ash
 * grain, a faint enchantment glowing along the inner edge, deep inner shadow.
 * `accent` tints that inner enchantment (the dev bench passes its green). */
export function conjuredPanel(seed: string, accent?: string): CSSProperties {
  const ash = ashTexture();
  const edge = accent ? hexA(accent, 0.3) : RIM;
  return {
    backgroundColor: "rgba(18,13,22,0.95)",
    backgroundImage: [
      "radial-gradient(120% 80% at 50% -10%, rgba(120,96,120,0.10), transparent 60%)",
      ash ? `url(${ash})` : "",
    ]
      .filter(Boolean)
      .join(", "),
    backgroundSize: "auto, 96px 96px",
    imageRendering: "pixelated",
    clipPath: tornClip(seed),
    boxShadow: [
      `inset 0 0 0 1px ${edge}`,
      "inset 0 1px 0 rgba(210,180,150,0.06)",
      "inset 0 0 34px rgba(0,0,0,0.75)",
      `0 0 22px ${accent ? hexA(accent, 0.14) : "rgba(70,50,80,0.22)"}`, // a soft, dim aura — not a neon halo
      "0 8px 20px rgba(0,0,0,0.5)",
    ].join(", "),
  };
}

/** A rune tablet you press — carved dark stone, dim edge, warm lettering. */
export function runeButton(seed: string, accent?: string): CSSProperties {
  const edge = accent ? hexA(accent, 0.38) : RIM;
  return {
    fontFamily: "'Courier New', monospace",
    fontSize: 15,
    letterSpacing: 2,
    padding: "11px 24px",
    backgroundColor: "rgba(30,22,32,0.96)",
    clipPath: tornClip(`btn:${seed}`),
    border: "none",
    color: "#e6d8bc",
    textShadow: "0 1px 0 #000, 0 0 8px rgba(120,90,130,0.3)",
    boxShadow: `inset 0 0 0 1px ${edge}, inset 0 -5px 9px rgba(0,0,0,0.5), 0 2px 0 rgba(0,0,0,0.6)`,
    cursor: "pointer",
  };
}

/** Lettering etched into the stone — warm parchment with a low candle-halo. */
export const scarred: CSSProperties = {
  color: "#e6d8bc",
  textShadow: "0 2px 0 rgba(0,0,0,0.85), 0 0 10px rgba(120,90,130,0.28)",
};

/** A recessed well the mana/health/charge liquid sits in. */
export const manaWell: CSSProperties = {
  background: "#0b0710",
  boxShadow: `inset 0 0 0 1px #000, inset 0 2px 4px rgba(0,0,0,0.9), 0 0 0 1px ${RIM_SOFT}`,
};

/** Pixel-block segmentation laid over any bar fill. */
export const barSegments =
  "repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0 2px, transparent 2px 8px)";

// ── helpers ───────────────────────────────────────────────────────────────────

/** `#rrggbb` + alpha → `rgba(...)`, so callers pass one accent hex around. */
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── Living chrome ─────────────────────────────────────────────────────────────

/** Global keyframes + classes. Mounted once from the HUD's <style> tag. A
 * panel simply eases in and drifts — no flicker, no stutter. The anchored
 * transform is composed via the --wm-anchor var so corner HUD panels can sit
 * at a slight perspective and still float. */
export const themeCss = `
.wm-conjure { animation: wm-appear 260ms ease-out both, wm-float 6.5s ease-in-out infinite alternate; }
@keyframes wm-appear { from { opacity: 0; } to { opacity: 1; } }
@keyframes wm-float { from { transform: var(--wm-anchor, none) translateY(0); } to { transform: var(--wm-anchor, none) translateY(-2.5px); } }

/* Summoning-circle glyph bands behind the inventory mage — slow, dim. */
.wm-rune-ring { animation: wm-spin 26s linear infinite; }
.wm-rune-ring-2 { animation: wm-spin-rev 38s linear infinite; }
@keyframes wm-spin { to { transform: rotate(360deg); } }
@keyframes wm-spin-rev { to { transform: rotate(-360deg); } }

/* Crossing the tear: the veil fades up over the warp. */
.wm-tear-veil { animation: wm-veil-in 320ms ease-out forwards; }
@keyframes wm-veil-in { from { opacity: 0; } to { opacity: 1; } }
.wm-tear-text { animation: wm-text-pulse 1.6s ease-in-out infinite alternate; }
@keyframes wm-text-pulse { from { opacity: 0.4; } to { opacity: 0.9; } }
`;
