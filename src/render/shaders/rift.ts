import { GLSL_NOISE } from "./noise";

export const RIP_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** A wound torn in space, rendered chunky and gritty: everything is computed on
 * a coarse pixel grid so the rip reads as blocky torn pixels, not a smooth
 * decal. A hard jagged silhouette (stepped, not anti-aliased), a raggedly
 * torn burning edge, and a blocky star-vortex void seen THROUGH the tear.
 * SDF + noise in one shader — no geometry to author. */
export const RIP_FRAG =
  /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform float uActive; // 1 open … ~0.12 sealed
uniform float uSeed;
varying vec2 vUv;
` +
  GLSL_NOISE +
  /* glsl */ `
// Snap to a coarse grid — the whole rip lives on chunky pixels.
vec2 pix(vec2 v, float n) { return (floor(v * n) + 0.5) / n; }

void main() {
  // Plane-local coords: p.x in [-1.5,1.5], p.y in [-2,2].
  vec2 raw = (vUv - 0.5) * vec2(3.0, 4.0);
  float sd = uSeed;

  // Finer pixel grid so the rip's pixels sit closer to the game's own — still
  // clearly pixelated, but no longer coarse mush.
  vec2 p = pix(raw, 26.0);

  // ---- Tear silhouette: a vertical lens tapering to points, spine wobbling,
  //      width raggedly frayed by fast-moving noise so the edges writhe. ----
  float y = p.y / 1.9;                        // -1..1
  float taper = max(1.0 - y * y, 0.0);
  float halfW = pow(taper, 0.62) * 1.0;
  float fray = fbm(vec2(y * 5.0 + sd, uTime * 1.1 + sd));
  float jag = fbm(vec2(y * 14.0 - sd, uTime * 1.9));   // fine ragged notches, fast
  halfW *= 0.48 + 0.5 * fray + 0.28 * (jag - 0.5);
  halfW *= mix(0.24, 1.0, uActive);           // sealed → a thin slit
  float spine = 0.22 * (fbm(vec2(y * 2.2 - uTime * 0.6 + sd, sd)) - 0.5)
              + 0.05 * sin(uTime * 3.0 + y * 8.0); // extra live wobble of the crack
  float d = abs(p.x - spine) - halfW;         // <0 inside the tear

  float inside = step(d, 0.0);                 // hard, gritty edge (no AA)
  float edge = smoothstep(0.24, 0.0, abs(d));  // ragged burning rim band

  // ---- Void vortex on the chunky grid: blocky stars + nebula spiralling in. ----
  vec2 c = vec2(p.x - spine, p.y * 0.55);
  float rr = length(c);
  float aa = atan(c.y, c.x);
  float swirl = aa + (1.3 - rr) * 2.8 + uTime * (0.30 + 0.5 * uActive);

  vec2 g0 = vec2(swirl * 2.3, pow(max(rr, 0.03), 0.5) * 6.0 - uTime * (0.8 + 0.8 * uActive));
  float sh0 = hash21(floor(g0));
  float star0 = step(0.86, sh0) * (0.4 + 0.6 * fract(sh0 * 71.3 + uTime));
  vec2 g1 = vec2(swirl * 4.6 + 9.0, pow(max(rr, 0.03), 0.6) * 11.0 - uTime * 1.4);
  float star1 = step(0.90, hash21(floor(g1))) * 0.5;

  float neb = pow(fbm(vec2(swirl * 1.2, rr * 2.4 - uTime * 0.5)), 1.6);

  vec3 deep = mix(uColor * 0.12, vec3(0.04, 0.015, 0.09), smoothstep(0.0, 0.9, rr));
  vec3 voidCol = deep;
  voidCol += uColor * neb * 0.6 * (1.0 - rr * 0.6);
  voidCol += (vec3(0.9) + uColor * 0.6) * star0 * (0.5 + 0.8 * uActive);
  voidCol += uColor * star1 * (0.4 + 0.6 * uActive);

  // ---- Ragged burning edge ----
  float flick = 0.78 + 0.22 * sin(uTime * 11.0 + p.y * 7.0 + sd);
  vec3 edgeCol = uColor * edge * (1.25 + 1.5 * uActive) * flick;

  vec3 col = voidCol * inside + edgeCol;

  // Hard stepped palette → deliberate pixel-magic banding.
  col = floor(col * 14.0) / 14.0;

  float halo = smoothstep(0.34, 0.0, abs(d)) * edge * (0.35 + 0.5 * uActive);
  float alpha = clamp(max(inside, halo), 0.0, 1.0);
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(col, alpha);
}`;
