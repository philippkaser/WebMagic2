import type { CSSProperties } from "react";
import { Rng, hashSeed } from "../core/rng";

/** Arcane conjuration UI. Nothing here is a "window" or a scrap of matter —
 * every panel is a projection the wizard summons into the air: a plate of
 * dark void-glass with a jagged sigil edge that glows in the cast's colors,
 * conjured in with a flicker and left breathing. Surfaces carry a tiny
 * procedural grain (same no-binary-assets philosophy as render/textures.ts),
 * upscaled with image-rendering: pixelated so the magic stays as chunky as the
 * game behind it.
 *
 * The living parts (conjure-in flicker, float, rune-ring spin) live in the
 * `themeCss` string — mount it once from the HUD's <style> tag. */

const ACCENT = "#46ffd0"; // the tear's teal — the default conjuring color

// ── Procedural grain tile ─────────────────────────────────────────────────────

const TILE = 48;
let grainUrl: string | null = null;

function grainTile(): string {
  if (grainUrl !== null) return grainUrl;
  if (typeof document === "undefined") return (grainUrl = ""); // tests / SSR
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return (grainUrl = "");
  const img = ctx.createImageData(TILE, TILE);
  const rng = new Rng(hashSeed("ui:void-grain"));
  for (let i = 0; i < TILE * TILE; i++) {
    const n = rng.next();
    // Near-black void with the odd dim ember of arcane static and rare motes.
    const star = n > 0.985;
    const v = star ? 60 + n * 40 : 5 + n * 8;
    const o = i * 4;
    img.data[o] = v * 0.7;
    img.data[o + 1] = v * 0.95;
    img.data[o + 2] = v * 1.2;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (grainUrl = canvas.toDataURL());
}

// ── Sigil silhouette ──────────────────────────────────────────────────────────

/** A jagged sigil outline: pixel-stepped bites and points around every edge,
 * seeded so each panel keeps its own silhouette across renders. Sharper and
 * more angular than a rounded frame — a rune scratched in one stroke. */
export function sigilClip(seed: string): string {
  const rng = new Rng(hashSeed(`sigil:${seed}`));
  const step = () => 4 + Math.floor(rng.next() * 3) * 4; // 4|8|12 px
  const p: string[] = [];
  const c1 = step();
  const c2 = step();
  const c3 = step();
  const c4 = step();
  // Top edge with a notched point in the middle.
  p.push(`0 ${c1}px`, `${c1}px 0`);
  p.push(`${34 + Math.floor(rng.next() * 12)}% 0`, `50% ${step()}px`, `${54 + Math.floor(rng.next() * 12)}% 0`);
  p.push(`calc(100% - ${c2}px) 0`, `100% ${c2}px`);
  // Right edge with an outward tooth.
  p.push(`calc(100% - ${step() - 2}px) ${40 + Math.floor(rng.next() * 8)}%`, `100% 50%`, `calc(100% - ${step() - 2}px) ${56 + Math.floor(rng.next() * 8)}%`);
  p.push(`100% calc(100% - ${c3}px)`, `calc(100% - ${c3}px) 100%`);
  // Bottom edge.
  p.push(`${56 + Math.floor(rng.next() * 12)}% 100%`, `50% calc(100% - ${step()}px)`, `${34 + Math.floor(rng.next() * 12)}% 100%`);
  p.push(`${c4}px 100%`, `0 calc(100% - ${c4}px)`);
  // Left edge tooth.
  p.push(`${step() - 2}px ${56 + Math.floor(rng.next() * 8)}%`, `0 50%`, `${step() - 2}px ${40 + Math.floor(rng.next() * 8)}%`);
  return `polygon(${p.join(", ")})`;
}

// ── Conjured surfaces ─────────────────────────────────────────────────────────

/** A summoned projection — the standard panel surface. Void-glass interior,
 * a jagged sigil silhouette, and an outer glow (via drop-shadow, which follows
 * the clipped shape) in the conjuring color. Give each panel its own `seed`;
 * pass `accent` to recolor the glow (dev bench uses its green). */
export function conjuredPanel(seed: string, accent: string = ACCENT): CSSProperties {
  const grain = grainTile();
  return {
    backgroundColor: "rgba(9,7,18,0.9)",
    backgroundImage: [
      `linear-gradient(180deg, ${hexA(accent, 0.09)} 0%, transparent 22%, transparent 78%, ${hexA(accent, 0.06)} 100%)`,
      grain ? `url(${grain})` : "",
    ]
      .filter(Boolean)
      .join(", "),
    backgroundSize: "auto, 96px 96px",
    imageRendering: "pixelated",
    clipPath: sigilClip(seed),
    // Outer glow follows the sigil silhouette; inner rim + vignette fake depth.
    filter: `drop-shadow(0 0 2px ${accent}) drop-shadow(0 0 9px ${hexA(accent, 0.55)})`,
    boxShadow: `inset 0 0 0 1px ${hexA(accent, 0.5)}, inset 0 0 22px ${hexA(accent, 0.16)}, inset 0 0 60px rgba(0,0,0,0.7)`,
  };
}

/** A rune struck to press — a button as a small conjured glyph. */
export function runeButton(seed: string, accent: string = ACCENT): CSSProperties {
  return {
    fontFamily: "'Courier New', monospace",
    fontSize: 15,
    letterSpacing: 2,
    padding: "11px 24px",
    backgroundColor: "rgba(12,10,22,0.92)",
    clipPath: sigilClip(`btn:${seed}`),
    border: "none",
    color: "#e6f7f0",
    textShadow: `0 0 6px ${hexA(accent, 0.7)}, 0 2px 0 #000`,
    filter: `drop-shadow(0 0 2px ${hexA(accent, 0.8)})`,
    boxShadow: `inset 0 0 0 1px ${hexA(accent, 0.6)}, inset 0 0 14px ${hexA(accent, 0.2)}`,
    cursor: "pointer",
  };
}

/** Lettering etched in glowing glyphs (pale, haloed). */
export const scarred: CSSProperties = {
  color: "#e6f7f0",
  textShadow: "0 0 8px rgba(70,255,208,0.45), 0 2px 0 rgba(0,0,0,0.85)",
};

/** A recessed well the mana/health/charge liquid sits in. */
export const manaWell: CSSProperties = {
  background: "#06040d",
  boxShadow: "inset 0 0 0 1px #000, inset 0 2px 4px rgba(0,0,0,0.9), 0 0 0 1px rgba(70,255,208,0.28), 0 0 6px rgba(70,255,208,0.18)",
};

/** Pixel-block segmentation laid over any bar fill. */
export const barSegments =
  "repeating-linear-gradient(90deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 8px)";

// ── helpers ───────────────────────────────────────────────────────────────────

/** `#rrggbb` + alpha → `rgba(...)`, so callers pass one accent hex around. */
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── Living chrome ─────────────────────────────────────────────────────────────

/** Global keyframes + classes. Mounted once from the HUD's <style> tag. */
export const themeCss = `
/* A projection flickers into being, then drifts. Conjure-in animates ONLY
   opacity (so it never clobbers the panel's inline drop-shadow glow), while
   the float owns transform — the two never touch the same property. The
   anchored transform is composed via the --wm-anchor var. */
.wm-conjure { animation: wm-conjure-in 320ms steps(1, end) 1 both, wm-float 5s ease-in-out infinite alternate; }
@keyframes wm-conjure-in {
  0% { opacity: 0; }
  20% { opacity: 0.6; }
  35% { opacity: 0.12; }
  55% { opacity: 1; }
  70% { opacity: 0.55; }
  100% { opacity: 1; }
}
@keyframes wm-float { from { transform: var(--wm-anchor, none) translateY(0); } to { transform: var(--wm-anchor, none) translateY(-3px); } }

/* Rune ring behind a conjured projection — two counter-spinning glyph bands. */
.wm-rune-ring { animation: wm-spin 18s linear infinite; }
.wm-rune-ring-2 { animation: wm-spin-rev 26s linear infinite; }
@keyframes wm-spin { to { transform: rotate(360deg); } }
@keyframes wm-spin-rev { to { transform: rotate(-360deg); } }

/* Crossing the tear: the veil fades up over the warp canvas. */
.wm-tear-veil { animation: wm-veil-in 260ms ease-out forwards; }
@keyframes wm-veil-in { from { opacity: 0; } to { opacity: 1; } }
.wm-tear-text { animation: wm-text-pulse 1.2s ease-in-out infinite alternate; }
@keyframes wm-text-pulse { from { opacity: 0.45; } to { opacity: 1; } }

/* Arriving on the far side: the teal afterimage drains away. */
.wm-arrive { animation: wm-arrive 750ms ease-out forwards; }
@keyframes wm-arrive { 0% { opacity: 1; } 100% { opacity: 0; } }
`;

/** Accent color for a conjured surface, exported so callers can match the glow
 * to context (e.g. the dev bench's green). */
export const CONJURE_ACCENT = ACCENT;
