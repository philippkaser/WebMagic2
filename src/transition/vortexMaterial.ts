import { Color, ShaderMaterial, Vector2 } from "three";
import { PIXEL_NOISE_GLSL } from "./vortexGlsl";

/** The travel overlay: ONE fullscreen quad, ONE draw call, drawn in the world
 * canvas after everything else (renderOrder high, depthTest off) — so it is
 * rendered at the world's own low resolution and upscaled with the same
 * nearest-neighbour pixels, and bloom feeds on its light like any emissive.
 * A pure function of a handful of uniforms that TransitionSystem fills from
 * timeline.ts each frame, in the gritty pixel style of the artpass warp:
 * blocky star squares on a coarse grid, hash-lane streaks, stepped colour.
 *
 * - The WARP (the journey's middle) is a parallel starry world seen in
 *   swirled polar coordinates: three parallax layers of chunky star blocks
 *   and a dark nebula drifting past (sinking or rising — `uDrift`) by an
 *   integrated fall distance (`uFall`). Being SUCKED IN (`uSuck`) spins it
 *   up, zooms it toward its heart, lights it in the rift's colour and sends
 *   spiral streaks screaming past; HOVERING it goes dark with only hints of
 *   colour; being SPAT OUT (`uEject`) kicks it outward past you, surges it
 *   back into the rift's colour and flashes.
 * - ENTER draws that warp inside the rift's own tear (the silhouette the rift
 *   shader draws — vortexGlsl's tearSd) ripping open over the view from the
 *   rift's on-screen position and size, with a ragged burning rim, while
 *   pixel shards of the world spiral into it.
 * - ARRIVE rips a tear open at the screen centre, riding the burning rim,
 *   onto the new place.
 * - Death has no warp: the view burns away in chunky blocks from the edges
 *   in, glowing ember-red along the burn line, leaving smouldering black-red
 *   ash with square embers drifting up.
 *
 * At dpr 0.35 the whole thing is ~70k fragments; nothing here allocates. */

const VERTEX = /* glsl */ `
varying vec2 vNdc;
void main() {
  // A 1×1 plane blown up to clip space: camera-attached by construction.
  vNdc = position.xy * 2.0;
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vNdc;
uniform float uTime;
uniform float uAspect;
uniform float uRoll;
uniform vec2 uCenter;
uniform float uIris;
uniform float uIrisR;
uniform float uReveal;
uniform float uRevealR;
uniform float uRing;
uniform float uSwirl;
uniform float uSuck;
uniform float uEject;
uniform float uFall;
uniform float uDrift;
uniform float uDissolve;
uniform float uDark;
uniform float uFlash;
uniform float uFade;
uniform float uLook;
uniform vec3 uColor;
uniform vec3 uHot;
uniform vec3 uDeep;
uniform float uSpinDir;
uniform float uSpin;
uniform float uStreaks;
uniform float uRings;
uniform float uFeathers;

${PIXEL_NOISE_GLSL}

const float TAU = 6.2831853;
const float INV_TAU = 0.1591549;

/** The parallel starry world, around q (screen half-heights from the warp's
 * heart). Ported from the artpass TRANSITION_FRAG warp, with its scripted
 * progress replaced by live phases (suck / hover / eject). */
vec3 warp(vec2 q) {
  // The artpass units: the screen's half-height is 0.5.
  vec2 uv = q * 0.5;
  float cs = cos(uRoll);
  float sn = sin(uRoll);
  uv = vec2(cs * uv.x - sn * uv.y, sn * uv.x + cs * uv.y);
  // (Capped below the artpass extreme: at a full suck the zoom shrinks the
  // stars below a pixel and the void turns to static.)
  float suckIn = uSuck * 0.7;
  float suckOut = uEject;
  float mid = (1.0 - suckIn) * (1.0 - suckOut);
  // Colour arc: saturated in the rift's colour at the ends, a dark void with
  // only hints of it in the middle.
  float colorAmt = max(uSuck, suckOut);

  float r = length(uv);
  float a = atan(uv.y, uv.x);
  // Swirl spikes while being sucked, calms to a slow drift while hovering.
  a += uSpinDir * ((suckIn * 3.6 + suckOut * 4.0 + 0.22) * (1.2 - r) + uTime * 0.12 * uSpin);
  // Radial zoom: rushes toward the heart as you are pulled in, then blasts
  // outward past you as you are ejected — a hard outward kick for force.
  float zoom = 1.0 + suckIn * 4.5 - suckOut * 1.9;
  vec2 sp = vec2(cos(a), sin(a)) * r * zoom;

  // The fall: you sink (or rise) through the parallel world floor by floor.
  float vy = uFall * uDrift;

  vec3 col = vec3(0.0);
  // Three parallax layers of chunky star blocks — bright at the colourful
  // ends, dim in the dark middle.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float depth = 1.0 + fi * 1.7;
    vec2 cell = pix(vec2(sp.x * depth, sp.y * depth - vy * (0.5 + fi * 0.45)), 42.0);
    float h = hash21(floor(cell * 20.0) + fi * 31.0);
    float star = step(0.93 - 0.015 * fi - 0.02 * uStreaks, h);
    float tw = 0.55 + 0.45 * sin(uTime * 3.0 + h * 30.0);
    col += (uColor * 0.7 + 0.3) * star * tw * (0.55 - fi * 0.13) * (0.35 + 0.65 * colorAmt);
  }
  // Feathers (the Feather of Safe Passage): big pale flakes rocking upward.
  if (uFeathers > 0.0) {
    vec2 fp = vec2(sp.x + 0.04 * sin(uTime * 2.3 + sp.y * 6.0), sp.y - vy * 0.35);
    float h = hash21(floor(fp * vec2(30.0, 18.0)) + 7.0);
    col += uHot * 0.7 * step(0.975, h) * uFeathers * (0.55 + 0.45 * sin(uTime * 2.0 + h * 20.0));
  }
  // The dark nebula of the parallel world — only a hint of colour mid-way.
  float neb = pow(fbm(pix(vec2(sp.x * 1.8, sp.y * 1.8 - vy * 0.5), 60.0)), 2.0);
  col += uColor * neb * (0.10 + 0.5 * colorAmt);
  col += mix(vec3(0.006, 0.005, 0.02) + uDeep * 0.08, uColor * 0.05, r) * (0.5 + 0.5 * colorAmt);

  // Rune rings rushing out past you (the Weighing reads you on the way
  // down): broken bands of glyph blocks, only while hovering.
  if (uRings > 0.0) {
    float lr = log(max(r * zoom, 0.02));
    float band = lr * 2.2 - uTime * 1.4;
    float seg = step(0.45, hash21(vec2(floor((a * INV_TAU + 0.5) * 36.0), floor(band))));
    float glyph = step(0.35, hash21(vec2(floor((a * INV_TAU + 0.5) * 144.0), floor(band) + 4.0)));
    col += uColor * 0.6 * step(0.93, fract(band)) * seg * glyph * uRings * mid * smoothstep(0.05, 0.3, r);
  }

  // Spiral streaks screaming past — heavier on the forceful eject.
  float streak = pow(hash21(vec2(floor((a * INV_TAU + 0.5) * 210.0), 3.0)), 20.0);
  col += (uColor + 0.3) * streak * (suckIn + suckOut * 2.0) * smoothstep(0.0, 0.6, r) * 2.6 * (0.5 + 0.5 * uStreaks);

  // Eject: surge back into the rift's colour, then a hard white flash.
  // (Kept nearer 1 than the artpass canvas did: this quad feeds the bloom,
  // and a full-screen surge any hotter would fog the tear opening onto the
  // new place.)
  col = mix(col, uColor * 1.15 + 0.1, suckOut * 0.85);
  col = mix(col, uHot * 0.9 + 0.1, pow(suckOut, 2.5) * 0.8);
  return col;
}

/** Signed distance (screen units, < 0 inside) of a tear centred at c with
 * s screen units per tear-metre, ripping wider as 'open' grows; at open = 1
 * it covers everything. */
float screenTear(vec2 q, vec2 c, float s, float open, float seed, out float spine) {
  vec2 m = (q - c) / max(s, 1e-3);
  m.x /= 1.0 + 2.2 * open * open;   // rips wider than it grows tall
  float d = tearSd(m, uTime, seed, 1.0, spine) * s;
  float o2 = open * open;
  return d - o2 * o2 * 4.0;
}

vec4 vortex(vec2 q) {
  float spine;
  // ── ENTER: the rift's tear rips open over the view ──
  float d = screenTear(q, uCenter, uIrisR, uIris, 3.7, spine);
  float inside = step(d, 0.0);
  // The ragged burning rim — a few world pixels wide whatever the scale.
  float band = clamp(0.24 * uIrisR, 0.02, 0.07);
  float rim = smoothstep(band, 0.0, abs(d)) * uRing * step(0.001, uIrisR);

  vec3 col = vec3(0.0);
  if (inside > 0.5) col = warp(q - uCenter);

  // Outside: shards of the world spiral into the tear over a creeping dark —
  // two layers of chunky blocks whose coordinates keep zooming out, so every
  // block is drawn in toward the tear, shrinking as it goes, and is reborn
  // at the edge of the view (the rift's mote cycle, writ large).
  vec2 qc = q - uCenter;
  vec3 outCol = uDeep * 0.4;
  float outA = uSwirl * 0.45 * smoothstep(0.0, 1.2, d);
  if (uSwirl > 0.0) {
    float r = max(length(qc), 1e-3);
    float shard = 0.0;
    float hot = 0.0;
    for (int k = 0; k < 2; k++) {
      float z = fract(uTime * 0.7 * (0.5 + uSwirl) + float(k) * 0.5);
      float ang = uSpinDir * (uSwirl * 1.2 / (r + 0.3) + z * 1.6);
      float ca = cos(ang);
      float sa = sin(ang);
      vec2 sp = vec2(ca * qc.x - sa * qc.y, sa * qc.x + ca * qc.y) * exp2(z * 2.0);
      float h = hash21(floor(sp * 16.0) + float(k) * 17.0);
      float on = step(0.978 - 0.022 * uSwirl, h) * step(0.15, sin(z * 3.14159));
      shard = max(shard, on);
      hot = max(hot, on * step(0.992, h));
    }
    shard *= smoothstep(0.0, 0.12, d) * (1.0 - smoothstep(1.4, 2.4, r));
    float streak = pow(hash21(vec2(floor((atan(qc.y, qc.x) * INV_TAU + 0.5) * 160.0 + log(r) * 6.0 * uSpinDir), 9.0)), 24.0);
    float streakA = streak * uSwirl * smoothstep(0.0, 0.1, d) * (1.0 - smoothstep(0.3, 1.2, d));
    float lit = max(shard, streakA);
    outCol = mix(outCol, mix(uColor, uHot, hot) * 1.3, lit);
    outA = max(outA, lit * uSwirl);
  }

  col = mix(outCol, col, inside);
  float alpha = mix(outA, 1.0, inside);
  float flick = 0.78 + 0.22 * sin(uTime * 11.0 + q.y * 20.0);
  col += (uColor * 1.6 + uHot * 0.6) * rim * flick;
  alpha = max(alpha, min(rim, 1.0));

  // ── ARRIVE: a tear rips open at the centre onto the new place ──
  if (uRevealR > 0.0) {
    float rd = screenTear(q, vec2(0.0), uRevealR, uReveal, 9.1, spine);
    float hole = step(rd, 0.0);
    float rb = clamp(0.24 * uRevealR, 0.02, 0.07);
    float rrim = smoothstep(rb, 0.0, abs(rd)) * uRing;
    alpha *= 1.0 - hole;
    col += (uHot * 1.2 + uColor) * rrim * flick;
    alpha = max(alpha, min(rrim, 1.0));
  }

  // Respawn: the death screen's black lifts off the void.
  col *= 1.0 - uDark;
  alpha = max(alpha, uDark);
  col += uHot * uFlash * 1.4;
  alpha = max(alpha, uFlash * 0.9);
  return vec4(col, alpha);
}

vec4 dissolve(vec2 q) {
  // The world burns away in chunky blocks, from the edges inward.
  vec2 qb = pix(q, 36.0);
  float maxR = length(vec2(uAspect, 1.0));
  float edgeD = length(qb) / maxR;
  float n = fbm(qb * 2.4 + vec2(0.0, uTime * 0.05));
  float n2 = hash21(floor(qb * 36.0) + 3.0);
  float field = (1.0 - edgeD) * 0.6 + n * 0.32 + n2 * 0.08;
  float th = uDissolve * 1.02;
  float burned = step(field, th);
  float edge = step(abs(field - th), 0.035) * (1.0 - step(0.999, uDissolve));

  // Ash: smouldering black-red, square embers drifting up through it, and a
  // slow pulse — the last of the heartbeat.
  float beat = pow(max(0.0, sin(uTime * 3.2)), 16.0);
  vec3 ash = mix(vec3(0.012, 0.0, 0.003), uDeep * (2.0 + beat * 1.5), n * n);
  vec2 ec = floor(vec2(q.x * 22.0, q.y * 22.0 - uTime * 2.2));
  float eh = hash21(ec + 5.0);
  float ember = step(0.975, eh) * (0.55 + 0.45 * sin(uTime * 5.0 + eh * 50.0));
  ash += uColor * ember * 1.7;

  // (Hot, but not so hot the bloom smears the chunky burn line into a blur.)
  vec3 burnCol = uColor * 1.3 + uHot * 0.5;
  // Before it burns, the world bleeds dark red — at once, so the death reads
  // from the first frame.
  vec3 washCol = uDeep * 0.9 + uColor * 0.08;
  vec3 col = mix(washCol, ash, burned);
  col = mix(col, burnCol, edge);
  float a = max(max(burned, edge), sqrt(uDissolve) * 0.55);
  // The blow that killed you: a red pulse.
  col = mix(col, uColor * 1.4, uFlash);
  a = max(a, uFlash);
  return vec4(col, a);
}

void main() {
  vec2 q = vec2(vNdc.x * uAspect, vNdc.y);
  vec4 c = uLook > 0.5 ? dissolve(q) : vortex(q);
  // Hard stepped palette → deliberate pixel-magic banding.
  vec3 col = floor(c.rgb * 13.0) / 13.0;
  // The palette above is meant as DISPLAY values (the artpass warp drew it
  // on a raw canvas); this quad renders into the linear scene buffer that
  // the composer encodes for display, so decode it first — otherwise every
  // step comes out washed and bright. Steps stay steps.
  col = pow(max(col, 0.0), vec3(2.2));
  gl_FragColor = vec4(col, clamp(c.a, 0.0, 1.0) * uFade);
}
`;

export interface VortexUniforms {
  uTime: { value: number };
  uAspect: { value: number };
  uRoll: { value: number };
  uCenter: { value: Vector2 };
  uIris: { value: number };
  uIrisR: { value: number };
  uReveal: { value: number };
  uRevealR: { value: number };
  uRing: { value: number };
  uSwirl: { value: number };
  uSuck: { value: number };
  uEject: { value: number };
  uFall: { value: number };
  uDrift: { value: number };
  uDissolve: { value: number };
  uDark: { value: number };
  uFlash: { value: number };
  uFade: { value: number };
  uLook: { value: number };
  uColor: { value: Color };
  uHot: { value: Color };
  uDeep: { value: Color };
  uSpinDir: { value: number };
  uSpin: { value: number };
  uStreaks: { value: number };
  uRings: { value: number };
  uFeathers: { value: number };
}

export function createVortexMaterial(): ShaderMaterial & { uniforms: VortexUniforms } {
  const uniforms: VortexUniforms = {
    uTime: { value: 0 },
    uAspect: { value: 1.6 },
    uRoll: { value: 0 },
    uCenter: { value: new Vector2() },
    uIris: { value: 0 },
    uIrisR: { value: 0 },
    uReveal: { value: 0 },
    uRevealR: { value: 0 },
    uRing: { value: 0 },
    uSwirl: { value: 0 },
    uSuck: { value: 0 },
    uEject: { value: 0 },
    uFall: { value: 0 },
    uDrift: { value: 1 },
    uDissolve: { value: 0 },
    uDark: { value: 0 },
    uFlash: { value: 0 },
    uFade: { value: 1 },
    uLook: { value: 0 },
    uColor: { value: new Color() },
    uHot: { value: new Color() },
    uDeep: { value: new Color() },
    uSpinDir: { value: 1 },
    uSpin: { value: 1 },
    uStreaks: { value: 1 },
    uRings: { value: 0 },
    uFeathers: { value: 0 },
  };
  const material = new ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  return material as ShaderMaterial & { uniforms: VortexUniforms };
}
