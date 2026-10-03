/** GLSL shared by the rift (render/models/PortalModel) and the travel overlay
 * (TransitionSystem): the two are deliberately drawn in the same gritty pixel
 * language, so the ENTER iris reads as the rift itself tearing open over the
 * view, and the tear you are spat out of on ARRIVE is the same wound.
 *
 * Cheap value noise only (a few hashes per octave, no textures — the
 * zero-binary-asset rule), a grid snap for chunky pixels, and the tear's
 * signed distance. Ported from the artpass branch's rift/transition shaders
 * (render/shaders/noise.ts, rift.ts). */
export const PIXEL_NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * vnoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}
/** Snap to the centres of an n-per-unit grid: whatever is sampled through it
 * comes out as hard-edged blocks. */
vec2 pix(vec2 v, float n) { return (floor(v * n) + 0.5) / n; }

/** The tear, in its own metres (x across, y up, centred): a vertical lens
 * tapering to points (half-height 1.9), its width raggedly frayed by
 * fast-moving noise so the edges writhe, and a wobbling spine. Returns the
 * signed distance across (< 0 inside) and writes the spine's x to 'spine'.
 * 'width' scales the opening (sealed ≈ 0.24 → a thin slit); 't' is the
 * wound's own clock and 'seed' keeps two rifts from writhing in step. */
float tearSd(vec2 m, float t, float seed, float width, out float spine) {
  float y = m.y / 1.9;
  float taper = max(1.0 - y * y, 0.0);
  float halfW = pow(taper, 0.62);
  float fray = fbm(vec2(y * 5.0 + seed, t * 1.1 + seed));
  float jag = fbm(vec2(y * 14.0 - seed, t * 1.9));   // fine ragged notches, fast
  halfW *= (0.48 + 0.5 * fray + 0.28 * (jag - 0.5)) * width;
  spine = 0.22 * (fbm(vec2(y * 2.2 - t * 0.6 + seed, seed)) - 0.5)
        + 0.05 * sin(t * 3.0 + y * 8.0);              // extra live wobble of the crack
  // Capped at the tips, so the crack's line doesn't run on past its points.
  return max(abs(m.x - spine) - halfW, abs(m.y) - 1.9);
}
`;
