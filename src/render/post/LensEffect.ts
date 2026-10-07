import { Effect, EffectAttribute } from "postprocessing";
import { type Camera, Matrix4, Uniform, Vector3, type WebGLRenderer, type WebGLRenderTarget } from "three";
import { POST_GLSL } from "./glsl";

/** The eye and the lens, in one pass over the world's low-resolution image
 * (it reads the depth, so it needs its own pass; everything else in the
 * chain merges into the final one):
 *
 *  - **Pixel edges.** The look of hand-made 3D pixel art: a one-pixel dark
 *    line where something stands in front of something else, and a lit
 *    pixel on the near lip of every edge and corner — the outline a pixel
 *    artist would draw. Found in the depth alone: 1/depth is flat across any
 *    plane on screen, so its Laplacian is zero on the walls and floors and
 *    fires only at silhouettes and creases, its sign telling the far side
 *    (an outline, an inside corner) from the near (a lip that catches the
 *    light, an outside corner). Fades with distance, into the fog.
 *  - **Motion blur** from the camera's own movement, by reprojection: every
 *    pixel's world point is found from its depth and carried back to where
 *    it was last frame, and the image is smeared along that path — a whipped
 *    turn streaks, a blink-dash pulls the hall past you. Measured as a
 *    shutter (a fixed exposure time), so it doesn't grow with a slow frame.
 *    The staff in your hand rides with the camera and is left sharp.
 *  - **Zoom blur**: a radial rush from the middle of the view — a blast's
 *    punch, a dash, the pull of a rift.
 *  - **Chromatic dispersion**: the colours of the lens part toward its rim
 *    — a whisper at rest (more in the Crystal Deep), a split on a hit.
 *  - **Heat shimmer**: the air over the Ember Forge's magma wavers, more
 *    the further you look through it.
 *  - **Focus pull**: with a tablet up in front of you (the title, the
 *    Weighing, the inventory and its kin, the codex, death) the world
 *    behind it goes soft, so the stone and runes in front stand clear.
 *
 * Every part has its own strength uniform; at rest (no motion, no kick) the
 * blur takes one sample, so the pass costs about a copy plus five depth
 * reads per pixel — at dpr 0.35, nearly nothing. */

const fragment = /* glsl */ `
${POST_GLSL}
uniform mat4 uReproject;
uniform float uShutter;
uniform float uZoom;
uniform float uDispersion;
uniform float uHaze;
uniform float uEdges;
uniform float uSoft;
uniform float uTime;

#define TAPS 8
// Nearer than this is the staff in your hand (it rides with the camera).
#define HELD 0.75
// Blur no further than this (in screen heights), however fast the turn.
#define MAX_BLUR 0.045
// The menu's focus pull: taps, and radius in render pixels.
#define SOFT_TAPS 12
#define SOFT_RADIUS 3.5

float viewDist(float depth) { return -getViewZ(depth); }

// Where this pixel's world point stood on screen last frame, minus where it
// stands now: the camera's motion, seen at this pixel.
vec2 cameraMotion(vec2 uv, float depth) {
  vec4 clip = vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
  vec4 prev = uReproject * clip;
  vec2 was = prev.xy / max(prev.w, 1e-4) * 0.5 + 0.5;
  return uv - was;
}

float hazeNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = postHash(vec3(i, 7.0));
  float b = postHash(vec3(i + vec2(1.0, 0.0), 7.0));
  float c = postHash(vec3(i + vec2(0.0, 1.0), 7.0));
  float d = postHash(vec3(i + vec2(1.0, 1.0), 7.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 lensSample(vec2 uv, vec2 split) {
  return vec3(
    texture2D(inputBuffer, uv + split).r,
    texture2D(inputBuffer, uv).g,
    texture2D(inputBuffer, uv - split).b
  );
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float depth = readDepth(uv);
  bool sky = depth >= 0.99999;
  float dist = sky ? 1e4 : viewDist(depth);
  bool held = dist < HELD;
  vec2 at = uv;

  // Heat shimmer: the air between you and what you see wavers, more the
  // further you look through it (the staff and the sky are left alone).
  if (uHaze > 0.0 && !held) {
    float through = smoothstep(1.5, 14.0, min(dist, 30.0));
    vec2 q = uv * vec2(aspect, 1.0) * vec2(9.0, 5.0) + vec2(0.0, -uTime * 1.3);
    vec2 w = vec2(hazeNoise(q), hazeNoise(q + 17.3)) - 0.5;
    at += w * vec2(0.6, 1.0) * uHaze * 0.0045 * through;
  }

  // The colours of the lens part toward its rim (none in the middle).
  vec2 fromMid = (uv - 0.5) * vec2(aspect, 1.0);
  float rim = dot(fromMid, fromMid);
  vec2 split = (uv - 0.5) * uDispersion * rim * 0.012;

  // Blur along the camera's motion, plus the radial rush of a kick.
  vec2 blur = (uv - 0.5) * uZoom * 0.11;
  if (!held && uShutter > 0.0) {
    vec2 m = cameraMotion(uv, sky ? 1.0 : depth) * uShutter;
    blur += m;
  }
  float len = length(blur * vec2(aspect, 1.0));
  if (len > MAX_BLUR) blur *= MAX_BLUR / len;
  float px = length(blur * resolution);

  vec3 color;
  if (uSoft > 0.01) {
    // Focus pulled to the tablet in front of you: a soft disc (golden-angle
    // taps, turned per pixel by the dither so the blur has no pattern).
    color = lensSample(at, split);
    float a0 = postBayer(gl_FragCoord.xy) * 6.2832;
    for (int i = 0; i < SOFT_TAPS; i++) {
      float r = sqrt((float(i) + 0.5) / float(SOFT_TAPS)) * uSoft * SOFT_RADIUS;
      float a = float(i) * 2.39996 + a0;
      color += lensSample(at + vec2(cos(a), sin(a)) * r * texelSize, split);
    }
    color /= float(SOFT_TAPS + 1);
  } else if (px < 0.75) {
    color = lensSample(at, split);
  } else {
    // Centred on the pixel, each tap a dither-step along, so the streak
    // is grain rather than bands.
    float j = postBayer(gl_FragCoord.xy) - 0.5;
    vec3 sum = vec3(0.0);
    float weight = 0.0;
    for (int i = 0; i < TAPS; i++) {
      float t = (float(i) + 0.5 + j) / float(TAPS) - 0.5;
      vec2 p = at + blur * t;
      // Never smear the staff you hold into the world behind it.
      if (!held && viewDist(readDepth(p)) < HELD) continue;
      sum += lensSample(p, split);
      weight += 1.0;
    }
    color = weight > 0.0 ? sum / weight : lensSample(at, split);
  }

  // Pixel edges, from the Laplacian of 1/depth (flat on any plane).
  float edges = uEdges * (1.0 - uSoft);
  if (edges > 0.0 && !sky) {
    vec2 tx = texelSize;
    float w0 = 1.0 / dist;
    float wl = 1.0 / viewDist(readDepth(uv - vec2(tx.x, 0.0)));
    float wr = 1.0 / viewDist(readDepth(uv + vec2(tx.x, 0.0)));
    float wd = 1.0 / viewDist(readDepth(uv - vec2(0.0, tx.y)));
    float wu = 1.0 / viewDist(readDepth(uv + vec2(0.0, tx.y)));
    float e = (wl + wr + wd + wu - 4.0 * w0) / w0;
    float fade = 1.0 - smoothstep(10.0, 34.0, dist);
    // e > 0: something nearer stands beside this pixel (an outline), or an
    // inside corner; e < 0: the near lip of an edge, an outside corner.
    float outline = smoothstep(0.1, 0.45, e) * fade;
    float lip = smoothstep(0.05, 0.3, -e) * fade;
    color *= 1.0 - outline * 0.6 * edges;
    color *= 1.0 + lip * 0.85 * edges;
  }

  outputColor = vec4(color, inputColor.a);
}
`;

/** A camera step faster than this (m/s) is a cut — a teleport, a portal,
 * a respawn — not motion: that frame is left unblurred. */
const CUT_SPEED = 45;

const vp = new Matrix4();
const inv = new Matrix4();
const was = new Vector3();

export class LensEffect extends Effect {
  /** Camera blur's exposure time, seconds (0 = off). */
  shutter = 1 / 90;
  private prevVP = new Matrix4();
  private prevPos = new Vector3();
  private primed = false;

  constructor(private readonly camera: Camera) {
    super("LensEffect", fragment, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ["uReproject", new Uniform(new Matrix4())],
        ["uShutter", new Uniform(0)],
        ["uZoom", new Uniform(0)],
        ["uDispersion", new Uniform(0.5)],
        ["uHaze", new Uniform(0)],
        ["uEdges", new Uniform(1)],
        ["uSoft", new Uniform(0)],
        ["uTime", new Uniform(0)],
      ]),
    });
  }

  set zoom(v: number) {
    this.uniforms.get("uZoom")!.value = v;
  }
  set dispersion(v: number) {
    this.uniforms.get("uDispersion")!.value = v;
  }
  set haze(v: number) {
    this.uniforms.get("uHaze")!.value = v;
  }
  set edges(v: number) {
    this.uniforms.get("uEdges")!.value = v;
  }
  /** The focus pulled off the world (0 = sharp, 1 = soft behind a menu). */
  get soft(): number {
    return this.uniforms.get("uSoft")!.value;
  }
  set soft(v: number) {
    this.uniforms.get("uSoft")!.value = v;
  }

  override update(_renderer: WebGLRenderer, _input: WebGLRenderTarget, dt = 1 / 60): void {
    const u = this.uniforms;
    u.get("uTime")!.value = (u.get("uTime")!.value + dt) % 1000;
    const cam = this.camera;
    cam.updateMatrixWorld();
    vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    was.copy(this.prevPos);
    cam.getWorldPosition(this.prevPos);
    const moved = was.distanceTo(this.prevPos);
    const cut = !this.primed || dt <= 0 || moved / Math.max(dt, 1e-3) > CUT_SPEED || dt > 0.25;
    if (cut || this.shutter <= 0) {
      u.get("uShutter")!.value = 0;
    } else {
      // Clip now → world → clip last frame, in one matrix.
      inv.copy(vp).invert();
      (u.get("uReproject")!.value as Matrix4).multiplyMatrices(this.prevVP, inv);
      // The fraction of this frame's motion the shutter saw (never more
      // than the whole frame, however slow it ran).
      u.get("uShutter")!.value = Math.min(1, this.shutter / dt);
    }
    this.prevVP.copy(vp);
    this.primed = true;
  }
}
