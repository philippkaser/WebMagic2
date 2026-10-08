import { ShaderPass } from "postprocessing";
import {
  type Camera,
  Matrix4,
  type PerspectiveCamera,
  ShaderMaterial,
  type Texture,
  Uniform,
  Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { FX_LIGHT_COUNT, fxUniforms } from "../../fx/fxUniforms";
import { POST_GLSL } from "./glsl";

/** Light in the air: every torch, spell and blast lights the haze around it.
 *
 * The dungeon's air is never empty — dust, damp, smoke, ash — and a light
 * in it isn't just a lit wall: it hangs in a glow of its own, thickest
 * near the flame and fading out into the dark. That glow is what makes a
 * corridor of torches read as a real place.
 *
 * Computed exactly, not marched: for a point light with inverse-square
 * falloff in uniform haze, the light scattered toward the eye along a view
 * ray has a closed form — ∫ ds / |o + s·d − p|² = (atan((t₁−b)/h) −
 * atan((t₀−b)/h)) / h, where b is how far along the ray the light's
 * nearest point lies and h how far the ray passes from it (Íñigo Quílez's
 * fog-glow integral). Each pooled light (fx/DynamicLights — the same 14 that
 * light the walls) is integrated over the stretch of the ray that lies
 * both in front of the surface it hits (from the depth buffer) and inside
 * the light's range, weighted by a forward-leaning phase function (haze
 * glows brightest looking toward a light) and by slow drifting noise, so
 * the haze has body and moves. A light behind the surface the ray ends on
 * fades out, so a torch in the next room doesn't glow through the wall.
 *
 * One pass at the world's low resolution — 14 closed-form integrals a pixel
 * — written to its own layer; the composite lays it over the world
 * upsampled smooth. The staff's own lantern is left out: a light at the eye
 * would only fog the whole view evenly. */

const fragment = /* glsl */ `
#include <packing>
${POST_GLSL}
uniform sampler2D uDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uNear;
uniform float uFar;
uniform float uMist;
uniform float uTime;
uniform vec4 uLightPos[${FX_LIGHT_COUNT}];
uniform vec3 uLightCol[${FX_LIGHT_COUNT}];
varying vec2 vUv;

float n3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(postHash(i), postHash(i + vec3(1.0, 0.0, 0.0)), f.x);
  float b = mix(postHash(i + vec3(0.0, 1.0, 0.0)), postHash(i + vec3(1.0, 1.0, 0.0)), f.x);
  float c = mix(postHash(i + vec3(0.0, 0.0, 1.0)), postHash(i + vec3(1.0, 0.0, 1.0)), f.x);
  float d = mix(postHash(i + vec3(0.0, 1.0, 1.0)), postHash(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}

void main() {
  if (uMist <= 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  // The view ray through this pixel, and how far it runs before it meets
  // something (the sky: as far as the fog lets you see).
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 viewDir = v.xyz / v.w;
  float depth = texture2D(uDepth, vUv).r;
  float viewZ = depth >= 0.99999 ? -uFar : perspectiveDepthToViewZ(depth, uNear, uFar);
  float t = length(viewDir * (viewZ / viewDir.z));
  vec3 d = normalize(mat3(uCamWorld) * normalize(viewDir));
  vec3 o = uCamPos;

  vec3 glow = vec3(0.0);
  for (int i = 0; i < ${FX_LIGHT_COUNT}; i++) {
    vec3 col = uLightCol[i];
    if (col.r + col.g + col.b <= 0.0) continue;
    vec3 L = uLightPos[i].xyz - o;
    float range = uLightPos[i].w;
    float b = dot(L, d);
    float h2 = max(dot(L, L) - b * b, 1e-3);
    if (h2 >= range * range) continue;
    float h = sqrt(h2);
    // Only the stretch of the ray inside the light's reach, and in front
    // of whatever the ray hits.
    float reachHalf = sqrt(range * range - h2);
    float t0 = max(0.0, b - reachHalf);
    float t1 = min(t, b + reachHalf);
    if (t1 <= t0) continue;
    float I = (atan((t1 - b) / h) - atan((t0 - b) / h)) / h;
    // Soft edge at the light's reach, and a light hidden behind the surface
    // this ray ends on fades out (no glow through walls).
    float reach = 1.0 - h / range;
    float behind = 1.0 - smoothstep(0.4, 1.6, b - t);
    // Forward-leaning phase (Henyey–Greenstein, g = 0.35) at the nearest
    // point: haze glows brightest looking toward the light.
    float cosT = b / max(length(L), 1e-3);
    const float g = 0.35;
    float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5);
    // Uneven, drifting haze around each light.
    vec3 near = o + d * clamp(b, t0, t1);
    float body = 0.45 + 1.1 * n3(near * 0.55 + vec3(0.0, -uTime * 0.12, uTime * 0.05));
    glow += col * I * reach * reach * behind * phase * body;
  }
  gl_FragColor = vec4(glow * uMist * (1.0 / 12.566), 1.0);
}
`;

const vertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }
`;

export class Air {
  private pass = new ShaderPass(
    new ShaderMaterial({
      uniforms: {
        inputBuffer: new Uniform(null),
        uDepth: new Uniform(null),
        uInvProj: new Uniform(new Matrix4()),
        uCamWorld: new Uniform(new Matrix4()),
        uCamPos: new Uniform(new Vector3()),
        uNear: new Uniform(0.1),
        uFar: new Uniform(100),
        uMist: new Uniform(0),
        uTime: new Uniform(0),
        uLightPos: fxUniforms.uLightPos,
        uLightCol: fxUniforms.uLightCol,
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      depthTest: false,
      depthWrite: false,
    }),
  );
  private time = 0;

  get uniforms(): ShaderMaterial["uniforms"] {
    return (this.pass.fullscreenMaterial as ShaderMaterial).uniforms;
  }

  /** How thick the haze is (0 = clear air: the pass writes nothing). */
  set mist(v: number) {
    this.uniforms.uMist.value = v;
  }

  render(renderer: WebGLRenderer, camera: Camera, depth: Texture, out: WebGLRenderTarget, dt: number): void {
    const u = this.uniforms;
    const cam = camera as PerspectiveCamera;
    this.time = (this.time + dt) % 1000;
    u.uDepth.value = depth;
    (u.uInvProj.value as Matrix4).copy(cam.projectionMatrixInverse);
    (u.uCamWorld.value as Matrix4).copy(cam.matrixWorld);
    cam.getWorldPosition(u.uCamPos.value as Vector3);
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    u.uTime.value = this.time;
    this.pass.render(renderer, null as unknown as WebGLRenderTarget, out);
  }

  dispose(): void {
    this.pass.dispose();
  }
}
