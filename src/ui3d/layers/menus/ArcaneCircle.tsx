import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, Color, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import { uiNow } from "../../clock";
import { useUiShow } from "../../presence";
import { screenUnit } from "./stage";

/** The big faint magic circle that turns behind the menu screens — artpass's
 * ArcaneBackdrop (a 320×180 canvas upscaled pixelated) rebuilt as one quad
 * standing far behind the screen, so it lives in the same space as the
 * tablets in front of it and sways with them.
 *
 * Everything is computed on a grid of "backdrop pixels" — one pixel is a
 * 180th of the view height at the circle's distance, exactly the artpass
 * canvas's pixel — so rings, runes and motes are hard square pixels:
 *
 *   - three thin rings (the middle one dashed) turning at different speeds,
 *   - 24 tiny 3×3 runes riding between the rings,
 *   - the faint hexagram inside,
 *   - pixel motes rising across the whole view and fading as they climb.
 *
 * It doesn't fade in: it DRAWS itself — the rings run around from the top,
 * the hexagram follows, then the runes kindle and the motes begin to rise.
 * Time is stepped at 24 fps like the artpass canvas. Additive with alpha 0:
 * it only ever adds light to the darkness the veil gathered. */

export type CircleMood = "arcane" | "blood" | "gold";

const MOODS: Record<CircleMood, { ring: string; motes: [string, string] }> = {
  arcane: { ring: "#46ffd0", motes: ["#46ffd0", "#ffc46e"] },
  blood: { ring: "#d23232", motes: ["#ff5a3c", "#a01c1c"] },
  gold: { ring: "#ffd44f", motes: ["#ffdc78", "#46ffd0"] },
};

/** Backdrop pixels per view height (the artpass canvas height). */
const ROWS = 180;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec2 uGrid;     // plane size in backdrop pixels
uniform vec2 uCentre;   // circle centre, backdrop pixels from the plane centre
uniform float uTime;
uniform float uDraw;    // 0..1 the circle drawing itself
uniform float uMotes;   // 0..1 motes level
uniform float uFade;    // 1 → 0 on exit
uniform float uIntensity;
uniform vec3 uRing;
uniform vec3 uMoteA;
uniform vec3 uMoteB;
varying vec2 vUv;

const float TAU = 6.2831853;

float hash(float n) { return fract(sin(n * 12.9898 + 4.1) * 43758.5453); }

// Angular position 0..1 clockwise from the top — where the drawing has got to.
float around(vec2 q) {
  return fract(0.25 - atan(q.y, q.x) / TAU);
}

float ring(vec2 c, float r, float rot, bool dashed, float delay) {
  vec2 q = vec2(c.x, c.y / 0.92);
  if (abs(length(q) - r) > 0.55) return 0.0;
  if (around(q) > (uDraw - delay) * 1.25) return 0.0;
  if (dashed) {
    float steps = ceil(r * 7.0);
    float i = floor(fract((atan(q.y, q.x) - rot) / TAU) * steps);
    if (mod(i, 6.0) > 3.0) return 0.0;
  }
  return 1.0;
}

void main() {
  float t = floor(uTime * 24.0) / 24.0;
  vec2 p = (vUv - 0.5) * uGrid;
  vec2 pix = floor(p);
  vec2 c = pix + 0.5 - uCentre;
  float rr = length(vec2(c.x, c.y / 0.92));
  vec3 col = vec3(0.0);

  // The circle (most of the view is outside it: skip the work there).
  if (rr < 75.0) {
    float breathe = 0.5 + 0.5 * sin(t * 0.8);
    float a = ring(c, 74.0, t * 0.05, false, 0.0) * (0.16 + breathe * 0.06);
    a += ring(c, 68.0, -t * 0.08, true, 0.08) * 0.22;
    a += ring(c, 50.0, t * 0.12, false, 0.16) * 0.10;

    // Runes riding between the rings: 3×3 glyphs from a 4-bit mask.
    float kindle = clamp((uDraw - 0.55) / 0.35, 0.0, 1.0);
    if (kindle > 0.0 && abs(rr - 59.0) < 3.0) {
      float ang = atan(c.y / 0.92, c.x);
      float i = mod(floor((ang + t * 0.08) / TAU * 24.0 + 0.5), 24.0);
      float ga = i / 24.0 * TAU - t * 0.08;
      vec2 g = floor(vec2(cos(ga) * 59.0, sin(ga) * 59.0 * 0.92) + uCentre + 0.5);
      vec2 d = pix - g;
      float bits = floor(hash(i) * 16.0);
      float on = 0.0;
      if (d == vec2(0.0, 1.0)) on = 1.0;
      if (d == vec2(0.0, 0.0)) on = 0.7;
      if (d == vec2(-1.0, 0.0) && mod(bits, 2.0) >= 1.0) on = 1.0;
      if (d == vec2(1.0, 0.0) && mod(floor(bits / 2.0), 2.0) >= 1.0) on = 1.0;
      if (d == vec2(0.0, -1.0) && mod(floor(bits / 4.0), 2.0) >= 1.0) on = 1.0;
      if (d == vec2(-1.0, -1.0) && mod(floor(bits / 8.0), 2.0) >= 1.0) on = 1.0;
      // Each rune lights in its turn around the circle.
      float lit = step(i / 24.0, kindle * 1.05);
      a += on * lit * (0.25 + 0.25 * sin(t * 2.0 + i));
    }

    // The hexagram, very faint, drawn after the rings.
    float spokes = clamp((uDraw - 0.35) / 0.4, 0.0, 1.0);
    if (spokes > 0.0 && rr < 51.0) {
      for (int k = 0; k < 6; k++) {
        float a1 = float(k) / 6.0 * TAU + t * 0.05;
        float a2 = a1 + TAU / 3.0;
        vec2 p1 = vec2(cos(a1), sin(a1) * 0.92) * 50.0;
        vec2 p2 = vec2(cos(a2), sin(a2) * 0.92) * 50.0;
        vec2 e = p2 - p1;
        float s = clamp(dot(c - p1, e) / dot(e, e), 0.0, spokes);
        vec2 n = c - (p1 + e * s);
        if (max(abs(n.x), abs(n.y)) < 0.5) { a += 0.07; break; }
      }
    }
    // Alpha as artpass blends it — in sRGB: this pass is encoded on output,
    // so a fraction a of the colour there is a^2.2 of it here.
    col += uRing * pow(a, 2.2);
  }

  // Motes: a few columns each carry one, rising and fading as it climbs;
  // a mote sways a pixel either way, so look at the neighbours too.
  if (uMotes > 0.0) {
    for (int dx = -1; dx <= 1; dx++) {
      float x = pix.x + float(dx);
      float n = x * 1.37;
      if (hash(n) > 0.17) continue;
      float phase = hash(n + 3.0) * TAU;
      float sway = floor(sin(t * 0.7 + phase) * 1.5 + 0.5);
      if (x + sway != pix.x) continue;
      float vy = 4.0 + hash(n + 1.0) * 10.0;
      float rise = mod(hash(n + 2.0) * uGrid.y + t * vy, uGrid.y + 4.0) - 2.0;
      if (floor(-uGrid.y * 0.5 + rise) != pix.y) continue;
      float flick = 0.35 + 0.45 * abs(sin(t * 2.2 + phase));
      float low = 1.0 - rise / uGrid.y;
      vec3 mc = hash(n + 4.0) < 0.3 ? uMoteB : uMoteA;
      col += mc * pow(flick * low * uMotes, 2.2);
    }
  }

  gl_FragColor = vec4(col * uIntensity * pow(uFade, 2.2), 0.0);
  #include <colorspace_fragment>
  gl_FragColor.a = 0.0;
}
`;

let quad: PlaneGeometry | null = null;

/** The circle at `distance` metres from the eye, placed inside a Stage at
 * `stageDistance`; `cy` is the circle centre as a fraction of the view
 * height above the middle (artpass: 0.24 on the title). */
export function ArcaneCircle({
  mood = "arcane",
  distance,
  stageDistance,
  cy = 0.24,
  intensity = 1.35,
  delay = 0,
}: {
  mood?: CircleMood;
  distance: number;
  stageDistance: number;
  cy?: number;
  intensity?: number;
  delay?: number;
}) {
  const show = useUiShow();
  const unit = screenUnit(distance);
  const cell = unit / ROWS;
  // Wide enough for any landscape view; motes rise across all of it.
  const gridW = Math.ceil(ROWS * 2.4);
  const gridH = Math.ceil(ROWS * 1.06);
  const m = MOODS[mood];
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uGrid: { value: [gridW, gridH] },
          uCentre: { value: [0, Math.round(cy * ROWS)] },
          uTime: { value: 0 },
          uDraw: { value: 0 },
          uMotes: { value: 0 },
          uFade: { value: 1 },
          uIntensity: { value: intensity },
          uRing: { value: new Color(m.ring) },
          uMoteA: { value: new Color(m.motes[0]) },
          uMoteB: { value: new Color(m.motes[1]) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        premultipliedAlpha: true,
      }),
    [gridW, gridH, cy, intensity, m],
  );
  useEffect(() => () => material.dispose(), [material]);
  const since = useRef(uiNow());
  useEffect(() => {
    since.current = uiNow();
  }, [show]);
  const mesh = useRef<Mesh>(null);
  useFrame(() => {
    const now = uiNow();
    const t = now - since.current;
    const u = material.uniforms;
    u.uTime!.value = now;
    if (show) {
      u.uDraw!.value = Math.min(1, Math.max(0, (t - delay) / 1.8));
      u.uMotes!.value = Math.min(1, Math.max(0, (t - delay - 0.6) / 1.2));
      u.uFade!.value = 1;
    } else {
      // Gutters out in four steps.
      u.uFade!.value = Math.max(0, Math.ceil((1 - t / 0.5) * 4) / 4);
    }
    if (mesh.current) mesh.current.visible = u.uFade!.value > 0 && u.uDraw!.value > 0;
  });
  return (
    <mesh
      ref={mesh}
      geometry={(quad ??= new PlaneGeometry(1, 1))}
      material={material}
      scale={[gridW * cell, gridH * cell, 1]}
      position={[0, 0, stageDistance - distance]}
      renderOrder={0}
    />
  );
}
