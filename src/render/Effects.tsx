import { useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { Effect } from "postprocessing";
import { useMemo } from "react";
import { Color, Uniform } from "three";
import type { Grade } from "../world/biomes";

/** The gritty-pixel post chain: bloom feeds the emissive magic/torches, a
 * split-tone color grade sets each place's mood, then film grain and a
 * heavy vignette. The pixelation itself is free: the canvas renders at dpr
 * 0.35 and the browser upscales it with image-rendering: pixelated (see
 * GameScene), so every lighting and post pass pays ~1/8th the fragment cost
 * of native resolution. */
export function Effects() {
  const grade = useMemo(() => new GradeEffect(), []);
  useFrame((_, dt) => grade.approach(target, Math.min(dt, 0.1)));
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={1.2} luminanceThreshold={0.5} luminanceSmoothing={0.25} />
      <primitive object={grade} />
      <Noise opacity={0.06} />
      <Vignette eskil={false} offset={0.2} darkness={0.85} />
    </EffectComposer>
  );
}

const NEUTRAL: Grade = { shadows: "#101018", highlights: "#fff4e8", saturation: 1, contrast: 1 };
let target: Grade = NEUTRAL;

/** Scenes call this on mount; the grade eases toward it over ~a second so
 * arriving somewhere new reads as the air changing, not a cut. */
export function setGrade(grade: Grade): void {
  target = grade;
}

const fragment = /* glsl */ `
uniform vec3 uShadows;
uniform vec3 uHighlights;
uniform float uSaturation;
uniform float uContrast;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = luma(c);
  c = mix(vec3(l), c, uSaturation);
  // Split tone: hue-only tints (normalized to unit luma), weighted by the
  // pixel's own brightness, plus a faint colored lift in the blacks.
  float w = smoothstep(0.0, 0.35, l);
  vec3 sh = uShadows / max(luma(uShadows), 1e-3);
  vec3 hi = uHighlights / max(luma(uHighlights), 1e-3);
  c *= mix(mix(vec3(1.0), sh, 0.45), mix(vec3(1.0), hi, 0.3), w);
  c += uShadows * 0.35;
  // Log contrast around middle grey keeps the darks inky without clipping.
  c = 0.18 * pow(max(c, 0.0) / 0.18, vec3(uContrast));
  outputColor = vec4(c, inputColor.a);
}`;

class GradeEffect extends Effect {
  private scratch = new Color();

  constructor() {
    super("GradeEffect", fragment, {
      uniforms: new Map<string, Uniform>([
        ["uShadows", new Uniform(new Color(NEUTRAL.shadows))],
        ["uHighlights", new Uniform(new Color(NEUTRAL.highlights))],
        ["uSaturation", new Uniform(1)],
        ["uContrast", new Uniform(1)],
      ]),
    });
  }

  approach(g: Grade, dt: number) {
    const k = 1 - Math.exp(-dt * 2.5);
    const u = this.uniforms;
    (u.get("uShadows")!.value as Color).lerp(this.scratch.set(g.shadows), k);
    (u.get("uHighlights")!.value as Color).lerp(this.scratch.set(g.highlights), k);
    u.get("uSaturation")!.value += (g.saturation - u.get("uSaturation")!.value) * k;
    u.get("uContrast")!.value += (g.contrast - u.get("uContrast")!.value) * k;
  }
}
