import { ADVANCE } from "../../font/glyphs";

/** Where every HUD piece hangs — in one place so they can't collide.
 *
 * Insets are fractions of the screen HEIGHT from the named edge (frame.ts),
 * distances are metres from the eye; sizes below are screen-height fractions
 * too (multiply by hudUnit(distance) for metres). The centre of the view
 * stays clear: the crosshair is the only thing there. The bottom centre
 * belongs to the interaction prompts (WorldPrompts), the upper centre to the
 * message feed (WorldMessages); the HUD keeps to the corners and the top.
 *
 *   top-left      location plaque (floor, biome, the Tithe, connection)
 *   top-centre    boss bar, and under it the presence eye
 *   bottom-left   row 1: health flask · number · mana flask · number · belt
 *                 row 2: the purse
 *   bottom-right  worn equipment */

/** Cap height of a glyph → width of an n-character number, screen units. */
function textWidth(chars: number, capFraction: number): number {
  return ((chars * ADVANCE - 1) * capFraction) / 7;
}

const EDGE = 0.032;

/** Vitals row geometry (screen-height fractions from the cluster origin). */
export const VITALS = {
  /** Bulb radius of a flask. */
  flaskR: 0.034,
  /** Cap height of the current value / of the "/max" under it. */
  bigText: 0.027,
  smallText: 0.017,
  gap: 0.012,
  /** Widest number the column must hold ("999"). */
  get numW() {
    return textWidth(3, this.bigText);
  },
  get manaX() {
    return this.flaskR * 2 + this.gap + this.numW + this.gap * 1.5 + this.flaskR;
  },
  get width() {
    return this.manaX + this.flaskR + this.gap + this.numW;
  },
};

export const HUD_LAYOUT = {
  vitals: { h: -1, v: -1, inset: [EDGE, EDGE], distance: 1 },
  belt: { h: -1, v: -1, inset: [EDGE + VITALS.width + 0.03, EDGE + 0.028], distance: 1 },
  purse: { h: -1, v: -1, inset: [EDGE, EDGE + 0.118], distance: 1 },
  equipment: { h: 1, v: -1, inset: [EDGE, EDGE + 0.022], distance: 1 },
  plaque: { h: -1, v: 1, inset: [0.03, 0.03], distance: 1.2 },
  boss: { h: 0, v: 1, inset: [0, 0.075], distance: 1.5 },
  presence: { h: 0, v: 1, inset: [0, 0.175], distance: 1.4 },
} as const;
