/** The in-world UI's clock, in seconds since the module loaded.
 *
 * Glyph timelines run on the GPU from birth times written into instance
 * attributes, compared against a time uniform — both must come from the same
 * clock. Starting near zero keeps float32 precision on the GPU well under a
 * millisecond for hours of play. */
const t0 = typeof performance !== "undefined" ? performance.now() : 0;

export function uiNow(): number {
  return (performance.now() - t0) / 1000;
}
