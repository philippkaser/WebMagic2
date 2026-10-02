import { CustomBlending, OneFactor, ZeroFactor } from "three";

/** Blending for pure light on the UI's transparent canvas (the cast map,
 * its sigil and beam): add the colour, leave the canvas's alpha alone.
 * Plain additive blending would also add alpha and turn the light into an
 * opaque sheet over the world; a premultiplied pixel with colour and zero
 * alpha is pure added light when the browser composites the canvas. Light
 * written this way should be computed in display values (no colour-space
 * step). Spread into a material's parameters. */
export const LIGHT_BLENDING = {
  blending: CustomBlending,
  blendSrc: OneFactor,
  blendDst: OneFactor,
  blendSrcAlpha: ZeroFactor,
  blendDstAlpha: OneFactor,
} as const;
