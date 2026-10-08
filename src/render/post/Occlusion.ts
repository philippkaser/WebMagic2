import { ShaderPass } from "postprocessing";
import {
  type Camera,
  HalfFloatType,
  Matrix4,
  NearestFilter,
  type PerspectiveCamera,
  ShaderMaterial,
  type Texture,
  Uniform,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import { POST_GLSL } from "./glsl";

/** Ambient occlusion: where surfaces crowd each other — the seam where a
 * wall meets the floor, a corner, the ground under a barrel or an enemy,
 * the niche round a torch — less light gets in, and the crease darkens
 * softly. It's what makes geometry sit in its space instead of floating.
 *
 * Screen-space, from the depth alone, at the world's own resolution (one
 * value per world pixel — the composite multiplies it into the pixel art, so
 * it shades the pixels rather than smearing over them): each pixel's view
 * position and normal are rebuilt from depth (the normal from the smaller of
 * each pair of neighbour differences, so silhouettes don't bend it), and a
 * dozen taps on a golden-angle disc of fixed world radius ask how much of
 * the hemisphere above it is closed in (Alchemy/SAO's estimator, fading
 * with distance so far-off geometry never shadows across a hall). A small
 * depth-aware blur then removes the noise. The staff in your hand and the
 * sky are left open. */

const aoFragment = /* glsl */ `
#include <packing>
${POST_GLSL}
uniform sampler2D uDepth;
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform vec2 uSize;
uniform float uNear;
uniform float uFar;
uniform float uRadius;
uniform float uIntensity;
varying vec2 vUv;

#define TAPS 12

vec3 viewPos(vec2 uv) {
  float d = texture2D(uDepth, uv).r;
  float z = perspectiveDepthToViewZ(d, uNear, uFar);
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  return p.xyz / p.w * (z / (p.z / p.w));
}

void main() {
  float d0 = texture2D(uDepth, vUv).r;
  if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  if (-P.z < 0.75) { gl_FragColor = vec4(1.0); return; }
  vec2 tx = 1.0 / uSize;
  vec3 l = viewPos(vUv - vec2(tx.x, 0.0)), r = viewPos(vUv + vec2(tx.x, 0.0));
  vec3 b = viewPos(vUv - vec2(0.0, tx.y)), t = viewPos(vUv + vec2(0.0, tx.y));
  vec3 dx = abs(r.z - P.z) < abs(P.z - l.z) ? r - P : P - l;
  vec3 dy = abs(t.z - P.z) < abs(P.z - b.z) ? t - P : P - b;
  vec3 n = normalize(cross(dx, dy));
  // The disc's radius on screen (pixels) for a fixed radius in the world.
  float px = uRadius * uProj[1][1] * 0.5 * uSize.y / -P.z;
  px = min(px, 40.0);
  if (px < 1.0) { gl_FragColor = vec4(1.0); return; }
  float a0 = postNoise(gl_FragCoord.xy) * 6.2832;
  float occ = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float k = (float(i) + 0.5) / float(TAPS);
    float a = a0 + float(i) * 2.39996;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * sqrt(k) * px * tx;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
    vec3 v = viewPos(uv) - P;
    float vv = dot(v, v);
    float vn = dot(v, n);
    float falloff = max(0.0, 1.0 - vv / (uRadius * uRadius));
    occ += max(0.0, vn - 0.015 * -P.z) / (vv + 0.01) * falloff;
  }
  float ao = clamp(1.0 - occ * uIntensity * (2.0 / float(TAPS)) * uRadius, 0.0, 1.0);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

const blurFragment = /* glsl */ `
#include <packing>
uniform sampler2D inputBuffer;
uniform sampler2D uDepth;
uniform vec2 uSize;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
float lin(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(uDepth, uv).r, uNear, uFar); }
void main() {
  vec2 tx = 1.0 / uSize;
  float z0 = lin(vUv);
  float sum = 0.0;
  float total = 0.0;
  for (int y = -2; y <= 1; y++) {
    for (int x = -2; x <= 1; x++) {
      vec2 uv = vUv + (vec2(x, y) + 0.5) * tx;
      float w = 1.0 / (1.0 + abs(lin(uv) - z0) * 8.0 / max(z0, 0.5));
      sum += texture2D(inputBuffer, uv).r * w;
      total += w;
    }
  }
  float ao = sum / total;
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

const vertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }
`;

export class Occlusion {
  private raw = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
  private out = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
  private aoPass = new ShaderPass(
    new ShaderMaterial({
      uniforms: {
        inputBuffer: new Uniform(null),
        uDepth: new Uniform(null),
        uProj: new Uniform(new Matrix4()),
        uInvProj: new Uniform(new Matrix4()),
        uSize: new Uniform(new Vector2(1, 1)),
        uNear: new Uniform(0.1),
        uFar: new Uniform(100),
        uRadius: new Uniform(0.7),
        uIntensity: new Uniform(5),
      },
      vertexShader: vertex,
      fragmentShader: aoFragment,
      depthTest: false,
      depthWrite: false,
    }),
  );
  private blurPass = new ShaderPass(
    new ShaderMaterial({
      uniforms: {
        inputBuffer: new Uniform(null),
        uDepth: new Uniform(null),
        uSize: new Uniform(new Vector2(1, 1)),
        uNear: new Uniform(0.1),
        uFar: new Uniform(100),
      },
      vertexShader: vertex,
      fragmentShader: blurFragment,
      depthTest: false,
      depthWrite: false,
    }),
  );

  /** The occlusion, one value per world pixel (red; 1 = open). */
  get texture(): Texture {
    return this.out.texture;
  }

  get uniforms(): ShaderMaterial["uniforms"] {
    return (this.aoPass.fullscreenMaterial as ShaderMaterial).uniforms;
  }

  setSize(width: number, height: number): void {
    this.raw.setSize(width, height);
    this.out.setSize(width, height);
  }

  render(renderer: WebGLRenderer, camera: Camera, depth: Texture, width: number, height: number): void {
    const cam = camera as PerspectiveCamera;
    const a = this.uniforms;
    a.uDepth.value = depth;
    (a.uProj.value as Matrix4).copy(cam.projectionMatrix);
    (a.uInvProj.value as Matrix4).copy(cam.projectionMatrixInverse);
    (a.uSize.value as Vector2).set(width, height);
    a.uNear.value = cam.near;
    a.uFar.value = cam.far;
    this.aoPass.render(renderer, null as unknown as WebGLRenderTarget, this.raw);
    const b = (this.blurPass.fullscreenMaterial as ShaderMaterial).uniforms;
    b.uDepth.value = depth;
    (b.uSize.value as Vector2).set(width, height);
    b.uNear.value = cam.near;
    b.uFar.value = cam.far;
    this.blurPass.render(renderer, this.raw, this.out);
  }

  dispose(): void {
    this.raw.dispose();
    this.out.dispose();
    this.aoPass.dispose();
    this.blurPass.dispose();
  }
}
