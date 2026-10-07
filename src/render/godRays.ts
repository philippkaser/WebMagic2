import { Effect, EffectAttribute } from "postprocessing";
import { type Camera, Color, Uniform, Vector2, Vector3, type WebGLRenderer, type WebGLRenderTarget } from "three";

/** God rays: light from a bright source in the sky streaming past whatever
 * stands in front of it — the moon over the valley, cut into shafts by the
 * mountains, the forest and the camp.
 *
 * Screen-space light scattering (GPU Gems 3, ch. 13): every pixel marches
 * toward the source's place on screen, gathering the light it passes. Only
 * SKY lights the air — pixels with no depth (the backdrop writes none, see
 * village/Sky) that are bright (the moon, its glow) — so the dark ranges
 * and every tree and tent are holes in the light, and the shafts fan out
 * between them. One pass at the world's low resolution, writing the light
 * alone: the composite (render/post/Composite) lays it over the world
 * upsampled smooth, so the shafts are soft light over crisp pixels.
 *
 * A scene turns it on with `setGodRays` (the village) and off with
 * `clearGodRays`; with no source the pipeline skips the pass. */

interface Source {
  dir: Vector3;
  distance: number;
  color: Color;
  strength: number;
}

let source: Source | null = null;

/** Rays from the sky in direction `dir` (from the eye; the backdrop rides
 * with the camera, so a direction is a place on the sky). */
export function setGodRays(dir: Vector3, color: string, strength = 1, distance = 90): void {
  source = { dir: dir.clone().normalize(), distance, color: new Color(color), strength };
}

/** Whether any scene has a source in its sky right now. */
export function hasGodRays(): boolean {
  return source !== null;
}

export function clearGodRays(): void {
  source = null;
}

const fragment = /* glsl */ `
uniform vec2 uSun;
uniform float uStrength;
uniform vec3 uColor;
#define SAMPLES 48

// Interleaved gradient noise (Jimenez): a march offset per pixel with no
// visible pattern once the light is upsampled smoothly.
float ign(vec2 c) {
  return fract(52.9829189 * fract(dot(c, vec2(0.06711056, 0.00583715))));
}

// How much light the air at uv takes from the sky behind it.
float skyLight(vec2 p) {
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) return 0.0;
  if (readDepth(p) < 0.99999) return 0.0; // something stands here
  vec3 c = texture2D(inputBuffer, p).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Only the moon and the bright air round it — not every star.
  vec2 off = (p - uSun) * vec2(aspect, 1.0);
  return smoothstep(0.42, 0.8, l) * exp(-dot(off, off) * 10.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uStrength <= 0.0) {
    outputColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 delta = (uv - uSun) * (1.0 / float(SAMPLES));
  // Start each march a little way in, differently per pixel, so the shafts
  // don't band.
  float dith = ign(gl_FragCoord.xy);
  vec2 p = uv - delta * dith;
  float illum = 1.0;
  float acc = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    acc += skyLight(p) * illum;
    illum *= 0.978;
    p -= delta;
  }
  acc *= 1.5 / float(SAMPLES);
  // Fainter the further from the source.
  float far = length((uv - uSun) * vec2(aspect, 1.0));
  acc *= 1.0 / (1.0 + far * 1.8);
  // The source itself is already bright: light the air, not the moon (its
  // dark seas included — a lower threshold than the light it gives).
  float self = 0.0;
  if (readDepth(uv) >= 0.99999) {
    float l = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec2 off = (uv - uSun) * vec2(aspect, 1.0);
    self = smoothstep(0.18, 0.4, l) * exp(-dot(off, off) * 10.0);
  }
  // The light alone: the composite lays it over the world, upsampled smooth.
  outputColor = vec4(uColor * acc * uStrength * (1.0 - 0.95 * self), 1.0);
}
`;

const tmp = new Vector3();
const fwd = new Vector3();

export class GodRaysEffect extends Effect {
  constructor(private readonly camera: Camera) {
    super("GodRaysEffect", fragment, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ["uSun", new Uniform(new Vector2(0.5, 0.5))],
        ["uStrength", new Uniform(0)],
        ["uColor", new Uniform(new Color())],
      ]),
    });
  }

  override update(_renderer: WebGLRenderer, _input: WebGLRenderTarget, _dt?: number): void {
    const u = this.uniforms;
    const s = source;
    if (!s) {
      u.get("uStrength")!.value = 0;
      return;
    }
    // Where the source stands on screen, and how squarely we face it: the
    // rays fade out as it swings off the side of the view.
    this.camera.getWorldDirection(fwd);
    const facing = fwd.dot(s.dir);
    tmp.copy(this.camera.position).addScaledVector(s.dir, s.distance).project(this.camera);
    (u.get("uSun")!.value as Vector2).set(tmp.x * 0.5 + 0.5, tmp.y * 0.5 + 0.5);
    const k = Math.min(1, Math.max(0, (facing - 0.15) / 0.45));
    u.get("uStrength")!.value = s.strength * k * k * (3 - 2 * k);
    (u.get("uColor")!.value as Color).copy(s.color);
  }
}
