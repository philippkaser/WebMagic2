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
 * centre to the message feed (WorldMessages). */

/** Screen-height fraction of `n` artpass pixels. */
export function apFrac(n: number): number {
  return (n * HUD_SCALE) / 800;
}

/** Gap from the screen edges (artpass's 12–14 px). */
const EDGE = apFrac(13);
/** Gap between neighbouring panels. */
const GAP = apFrac(6);

/** The vitals panel (artpass .wm-vitals: 280 wide, padding 6 10 8, rows
 * gap 6): padding-box sizes in ap pixels. */
export const VITALS = {
  cssW: 264,
  padX: 10,
  padTop: 6,
  gap: 6,
  /** Two rows: head 16 + 2 + track 14, gap, head 18 + 2 + track 10. */
  get contentW() {
    return this.cssW - this.padX * 2;
  },
  get cssH() {
    return this.padTop + 16 + 2 + 14 + this.gap + 18 + 2 + 10 + 8;
  },
  /** Border-box size (the 8 px frame on both sides). */
  get outerW() {
    return this.cssW + 16;
  },
  get outerH() {
    return this.cssH + 16;
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

/** The purse panel's padding-box height. */
export const PURSE_H = 22;

export const HUD_LAYOUT = {
  vitals: { h: -1, v: -1, inset: [EDGE, EDGE], distance: 1 },
  belt: { h: -1, v: -1, inset: [EDGE + apFrac(VITALS.outerW) + GAP, EDGE], distance: 1 },
  purse: { h: -1, v: -1, inset: [EDGE, EDGE + apFrac(VITALS.outerH) + GAP], distance: 1 },
  equipment: { h: 1, v: -1, inset: [EDGE, EDGE], distance: 1 },
  plaque: { h: -1, v: 1, inset: [EDGE, EDGE], distance: 1 },
  presence: { h: 0, v: 1, inset: [0, apFrac(10)], distance: 1.2 },
  boss: { h: 0, v: 1, inset: [0, apFrac(74)], distance: 1.2 },
} as const;
