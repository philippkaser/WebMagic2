import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  type BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { gameEvents } from "../../core/events";
import { withLightGrid } from "../../render/lighting/lightGrid";
import { toTexture } from "../../render/textures/canvas";
import { MARK_KINDS, MARK_VARIANTS, marksDataRgba, paintFloorMarks } from "../../render/textures/marks";
import {
  DECAL_CAPACITY,
  DECAL_FADE_SECONDS,
  DecalPool,
  type DecalSpec,
  type Rgb,
  scorchFor,
  splatFor,
} from "./decalPool";

/** The floor's marks, drawn: every scorch and splat on this floor in ONE
 * instanced draw of flat quads lying on the stone (fx/decals/decalPool.ts
 * keeps the books; render/textures/marks.ts paints them).
 *
 * Each mark is lit like the floor it lies on — the pooled lights, their
 * grid shadows and the bounce (render/lighting/lightGrid.ts), and the fog —
 * so torchlight plays over a scorch, and a goo splat's wet texels glint.
 * The atlas is sampled at the FLOOR's texel grid (the world position
 * snapped to 32 texels a metre), so a mark's pixels sit exactly on the
 * stone's pixels however it's turned. Embers and soul-specks burn out one
 * by one as the mark ages; an old mark erodes in an ordered dither and is
 * gone. No depth write (the edge pass never outlines a mark), polygon
 * offset against the floor.
 *
 * Fed by the event bus (`explosion` from weapons/explosions.ts, `enemyDied`
 * from enemies/useEnemy.ts), which fire on every client — explosions
 * replay everywhere and deaths run on every machine — so everyone's floor
 * wears the same scars. Mounted with the floor, so a new floor is clean. */

const Y = 0.012;

let atlas: { color: CanvasTexture; data: CanvasTexture } | null = null;

/** Painted once per session (a few ms), kept like the surfaces. */
function marksAtlas() {
  if (!atlas) {
    const p = paintFloorMarks();
    const color = toTexture(p.color, p.w, p.h, true);
    const data = toTexture(marksDataRgba(p), p.w, p.h, false);
    for (const t of [color, data]) t.wrapS = t.wrapT = ClampToEdgeWrapping;
    atlas = { color, data };
  }
  return atlas;
}

const VERT_HEAD = /* glsl */ `
attribute vec4 aDecal;
attribute vec4 aDecalTint;
attribute vec3 aDecalGlow;
varying vec2 vDecalW;
flat varying vec2 vDecalC;
flat varying vec4 vDecalAxes;
flat varying vec4 vDecalA;
flat varying vec4 vDecalTint;
flat varying vec3 vDecalGlow;
`;
const VERT_BODY = /* glsl */ `
{
  mat4 dm = modelMatrix * instanceMatrix;
  vDecalW = (dm * vec4(transformed, 1.0)).xz;
  vDecalC = dm[3].xz;
  vec2 ax = dm[0].xz;
  vec2 az = dm[2].xz;
  vDecalAxes = vec4(ax / max(dot(ax, ax), 1e-6), az / max(dot(az, az), 1e-6));
  vDecalA = aDecal;
  vDecalTint = aDecalTint;
  vDecalGlow = aDecalGlow;
}
`;
const FRAG_HEAD = /* glsl */ `
uniform sampler2D uMarkColor;
uniform sampler2D uMarkData;
uniform float uMarkTime;
uniform float uMarkFade;
varying vec2 vDecalW;
flat varying vec2 vDecalC;
flat varying vec4 vDecalAxes;
flat varying vec4 vDecalA;
flat varying vec4 vDecalTint;
flat varying vec3 vDecalGlow;
float markBayer2(vec2 a) { return mod(3.0 * a.y + 2.0 * a.x, 4.0); }
float markBayer4(vec2 q) {
  return (4.0 * markBayer2(mod(q, 2.0)) + markBayer2(mod(floor(q * 0.5), 2.0)) + 0.5) / 16.0;
}
`;
/** Replaces the map stage: the mark's texel at the floor's texel. */
const FRAG_MAP = /* glsl */ `
vec2 markTexel = floor(vDecalW * 32.0);
vec2 markS = (markTexel + 0.5) / 32.0 - vDecalC;
vec2 markL = vec2(dot(markS, vDecalAxes.xy), dot(markS, vDecalAxes.zw)) + 0.5;
if (markL.x < 0.0 || markL.y < 0.0 || markL.x > 1.0 || markL.y > 1.0) discard;
float markRow = floor(vDecalA.x / ${MARK_VARIANTS.toFixed(1)});
float markCol = vDecalA.x - markRow * ${MARK_VARIANTS.toFixed(1)};
vec2 markUv = vec2(
  (markCol + clamp(markL.x, 0.004, 0.996)) / ${MARK_VARIANTS.toFixed(1)},
  1.0 - (markRow + 1.0 - clamp(markL.y, 0.004, 0.996)) / ${MARK_KINDS.toFixed(1)}
);
vec4 markColor = texture2D(uMarkColor, markUv);
if (markColor.a < 0.5) discard;
// An old mark erodes away in an ordered dither, on the stone's own texels.
float markFade = vDecalA.z < 0.0 ? 1.0 : 1.0 - (uMarkTime - vDecalA.z) / uMarkFade;
if (markBayer4(markTexel) >= markFade) discard;
vec4 markData = texture2D(uMarkData, markUv);
diffuseColor.rgb = markColor.rgb * vDecalTint.rgb;
`;
const FRAG_ROUGH = /* glsl */ `
float roughnessFactor = markData.r;
`;
/** How much sheen a texel keeps (data B): soot drinks the light — at the
 * floor's grazing angles its Fresnel sheen alone would lift a black scorch
 * to the stone's own brightness — while goo and crystal glint. */
const FRAG_SHEEN = /* glsl */ `
reflectedLight.directSpecular *= markData.b;
reflectedLight.indirectSpecular *= markData.b;
`;
/** Embers and soul-specks: each lit while the mark is younger than its own
 * share of the glow time, dimming in three steps as it goes. */
const FRAG_GLOW = /* glsl */ `
{
  float markAge = (uMarkTime - vDecalA.y) / max(vDecalTint.a, 0.1);
  float markK = markData.g > 0.0 ? clamp(1.0 - markAge / markData.g, 0.0, 1.0) : 0.0;
  markK = ceil(markK * 3.0) / 3.0;
  totalEmissiveRadiance += vDecalGlow * vDecalA.w * markK * markK;
}
`;

function markMaterial(): MeshStandardMaterial {
  const { color, data } = marksAtlas();
  const m = new MeshStandardMaterial({
    color: "#ffffff",
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, markUniforms, { uMarkColor: { value: color }, uMarkData: { value: data } });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_HEAD}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_HEAD}`)
      .replace("#include <map_fragment>", FRAG_MAP)
      .replace("#include <roughnessmap_fragment>", FRAG_ROUGH)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${FRAG_GLOW}`)
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${FRAG_SHEEN}`);
  };
  m.customProgramCacheKey = () => "floor-marks";
  return withLightGrid(m);
}

const markUniforms = {
  uMarkTime: { value: 0 },
  uMarkFade: { value: DECAL_FADE_SECONDS },
};

function markGeometry(): BufferGeometry {
  // A unit square lying on the floor, facing up.
  return new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const UP = new Vector3(0, 1, 0);
const ZERO = new Matrix4().makeScale(0, 0, 0);
const _c = new Color();

function linear(hex: string | undefined, fallback: string): Rgb {
  _c.set(hex ?? fallback);
  return [_c.r, _c.g, _c.b];
}

export function FloorDecals() {
  const res = useMemo(() => {
    const geometry = markGeometry();
    const material = markMaterial();
    const mesh = new InstancedMesh(geometry, material, DECAL_CAPACITY);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
    const decal = new InstancedBufferAttribute(new Float32Array(DECAL_CAPACITY * 4), 4);
    const tint = new InstancedBufferAttribute(new Float32Array(DECAL_CAPACITY * 4), 4);
    const glow = new InstancedBufferAttribute(new Float32Array(DECAL_CAPACITY * 3), 3);
    for (const a of [decal, tint, glow]) a.setUsage(DynamicDrawUsage);
    geometry.setAttribute("aDecal", decal);
    geometry.setAttribute("aDecalTint", tint);
    geometry.setAttribute("aDecalGlow", glow);
    for (let i = 0; i < DECAL_CAPACITY; i++) mesh.setMatrixAt(i, ZERO);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    return { mesh, geometry, material, decal, tint, glow, pool: new DecalPool(), freed: [] as number[], now: 0 };
  }, []);

  useEffect(() => {
    const { mesh, decal, tint, glow, pool } = res;
    const place = (spec: DecalSpec | null) => {
      if (!spec) return;
      const slot = pool.add(spec, res.now);
      _q.setFromAxisAngle(UP, spec.rot);
      _p.set(spec.x, Y, spec.z);
      _s.set(spec.size, 1, spec.size);
      mesh.setMatrixAt(slot, _m.compose(_p, _q, _s));
      decal.setXYZW(slot, spec.kind * MARK_VARIANTS + spec.variant, res.now, -1, spec.glowStrength);
      tint.setXYZW(slot, spec.tint[0], spec.tint[1], spec.tint[2], spec.glowSeconds);
      glow.setXYZ(slot, spec.glow[0], spec.glow[1], spec.glow[2]);
      // Marks the add pushed into fading.
      for (let i = 0; i < pool.capacity; i++) {
        const d = pool.slots[i];
        if (d && d.fadeStart !== Infinity && decal.getZ(i) < 0) decal.setZ(i, d.fadeStart);
      }
      mesh.instanceMatrix.needsUpdate = true;
      decal.needsUpdate = true;
      tint.needsUpdate = true;
      glow.needsUpdate = true;
    };
    const offs = [
      gameEvents.on("explosion", (e) =>
        place(
          scorchFor({
            x: e.x,
            y: e.y,
            z: e.z,
            radius: e.radius,
            color: linear(e.color, "#ffb367"),
            power: e.power,
            vfx: e.vfx,
          }),
        ),
      ),
      gameEvents.on("enemyDied", (e) =>
        place(
          splatFor({
            x: e.x,
            y: e.y,
            z: e.z,
            body: linear(e.body, "#8a8a8a"),
            soul: linear(e.soul, "#c89cff"),
            style: e.style,
            scale: e.scale,
          }),
        ),
      ),
    ];
    // Dev: how many marks lie on this floor (end-to-end scripts).
    const w = window as unknown as Record<string, unknown>;
    if (import.meta.env.DEV) w.__floorMarks = () => ({ count: pool.count, live: pool.liveCount });
    return () => {
      for (const off of offs) off();
      pool.clear();
      if (import.meta.env.DEV) delete w.__floorMarks;
    };
  }, [res]);

  useEffect(
    () => () => {
      res.geometry.dispose();
      res.material.dispose();
      res.mesh.dispose();
    },
    [res],
  );

  useFrame(({ clock }) => {
    res.now = clock.elapsedTime;
    markUniforms.uMarkTime.value = res.now;
    const freed = res.pool.update(res.now, res.freed);
    if (freed.length) {
      for (const i of freed) {
        res.mesh.setMatrixAt(i, ZERO);
        res.decal.setZ(i, -1);
      }
      res.mesh.instanceMatrix.needsUpdate = true;
      res.decal.needsUpdate = true;
    }
  });

  return <primitive object={res.mesh} />;
}
