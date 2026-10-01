import { HUD_SCALE } from "./ap";

/** Where every HUD piece hangs — in one place so they can't collide.
 *
 * The arrangement is artpass's (hud/PlayHud): the centre stays the world.
 *
 *   location panel          presence eye / boss bar
 *                              (arrival banner)
 *                               crosshair
 *   purse
 *   vitals · belt                                  spells / gear slots
 *
 * Insets are fractions of the screen HEIGHT from the named edge (frame.ts),
 * distances are metres from the eye. Panel sizes are artpass CSS pixels
 * (ap.ts); `apFrac` turns them into screen-height fractions. The bottom
 * centre belongs to the interaction prompts (WorldPrompts), the upper
 * centre to the arrival banner, the left edge under the location panel to
 * the message feed (WorldMessages) — nothing hangs over the middle of the
 * view. */

/** Screen-height fraction of `n` artpass pixels. */
export function apFrac(n: number): number {
  return (n * HUD_SCALE) / 800;
}

/** Gap from the screen edges (artpass's 12–14 px). */
const EDGE = apFrac(13);
/** Gap between neighbouring panels. */
const GAP = apFrac(6);

/** The vitals: two pixel flasks, each with its numbers beside it (ap
 * pixels). `texel` is one flask pixel — the world's chunky pixel size. */
export const VITALS = {
  texel: 2.4,
  /** Room for "100" and "/ 100" beside each flask. */
  numW: 40,
  /** Flask → its numbers, and health block → mana block. */
  gap: 3,
  between: 8,
  /** A flask's grid: 26 × 34 flask pixels (PixelFlask FLASK). */
  get flaskW() {
    return 26 * this.texel;
  },
  get flaskH() {
    return 34 * this.texel;
  },
  get blockW() {
    return this.flaskW + this.gap + this.numW;
  },
  /** The whole group's footprint (belt and purse are placed off it). */
  get outerW() {
    return this.blockW * 2 + this.between;
  },
  get outerH() {
    return this.flaskH;
  },
};

/** One item slot (artpass .wm-card--sm: 48 wide, 40 px of art). */
export const SLOT = { w: 48, h: 46, gap: 8 } as const;

/** A strip of `n` slots in an iron panel (artpass .wm-equip: padding 10 10 6). */
export function slotStrip(n: number): { cssW: number; cssH: number; outerW: number; outerH: number } {
  const cssW = n * SLOT.w + (n - 1) * SLOT.gap + 20;
  const cssH = SLOT.h + 16;
  return { cssW, cssH, outerW: cssW + 16, outerH: cssH + 16 };
}

/** The location panel's border-box height on a floor (its tallest form;
 * Location.tsx: 105 content + 8 padding + 12 frame + 4 overhang). */
export const LOCATION_H = 129;

/** The purse panel's padding-box height. */
export const PURSE_H = 22;

export const HUD_LAYOUT = {
  vitals: { h: -1, v: -1, inset: [EDGE, EDGE], distance: 1 },
  belt: { h: -1, v: -1, inset: [EDGE + apFrac(VITALS.outerW) + GAP, EDGE], distance: 1 },
  purse: { h: -1, v: -1, inset: [EDGE, EDGE + apFrac(VITALS.outerH) + GAP], distance: 1 },
  equipment: { h: 1, v: -1, inset: [EDGE, EDGE], distance: 1 },
  plaque: { h: -1, v: 1, inset: [EDGE, EDGE], distance: 1 },
  feed: { h: -1, v: 1, inset: [EDGE, EDGE + apFrac(LOCATION_H) + GAP * 2], distance: 1 },
  presence: { h: 0, v: 1, inset: [0, apFrac(10)], distance: 1.2 },
  boss: { h: 0, v: 1, inset: [0, apFrac(74)], distance: 1.2 },
} as const;
