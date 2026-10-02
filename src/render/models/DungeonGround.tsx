import { BlurPass } from "@react-three/drei/materials/BlurPass";
import { MeshReflectorMaterial } from "@react-three/drei/materials/MeshReflectorMaterial";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  type BufferGeometry,
  DepthFormat,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  type Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  UnsignedShortType,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import { FLOOR_SPAN, getSurface, type FloorSurface } from "../textures";
import { MeshBuilder } from "./architectureMesh";
import { toGeometry } from "./meshGeometry";
import { type SurfaceGlow, dungeonMaterial, useBreathingGlow } from "./wallMaterial";
import { withFloorTint } from "../floorTint";

/** The dungeon floor: one world-mapped plane (the band's painted floor,
 * FLOOR_SPAN metres per repeat, texels square) whose wet texels glint
 * through their roughness map — and, only when the `reflections` quality
 * flag is on (default off: a mirror floor reads smooth and modern next to
 * the painted stone) and the biome's floor shines at all, a real planar
 * reflection.
 *
 * The reflection is drei's MeshReflectorMaterial (its shader: normal-map
 * distortion, roughness-driven blur via its BlurPass), with two changes:
 *
 *  1. We drive the mirror camera and own the render targets ourselves.
 *     drei's <MeshReflectorMaterial> component never disposes its four
 *     targets, and the floor remounts on every descent — that would leak
 *     ~1.5 MB of GPU memory per floor. Here they die with the floor.
 *  2. The reflection is added as LIGHT (to the emitted radiance), weighted
 *     by gloss (from the roughness map) and a Fresnel term. drei multiplies
 *     it into the albedo instead, which only shows where the floor is
 *     already lit — a torch across a dark hall would never appear in the
 *     puddle at your feet. Now it does: that glint is the whole point.
 *
 * Cost: one extra scene render at `resolution`² per frame plus a small blur
 * — at dpr 0.35 that is about the size of the main pass. */

export interface GroundReflection {
  /** How strongly the reflection is added (1 = physically plausible-ish). */
  strength: number;
  /** Blur mix at full roughness (glossy texels stay sharp). */
  blur: number;
}

/** Render-target edge for the mirror pass. The canvas renders at dpr 0.35,
 * so 256² is already about the main pass's own resolution. */
const RESOLUTION = 256;
/** BlurPass kernel footprint (its "width/height": larger = finer). Taller
 * than wide, because glossy reflections smear along the view direction. */
const BLUR: [number, number] = [150, 70];

export function DungeonGround({
  extent,
  surface,
  reflection,
  glow,
}: {
  /** World half-extent of the floor square. */
  extent: number;
  surface: FloorSurface;
  /** null = a matte floor: no mirror pass at all. */
  reflection: GroundReflection | null;
  /** The band's painted glow (magma seams, veins) and its breathing. */
  glow: SurfaceGlow;
}) {
  const geometry = useMemo(() => groundGeometry(extent), [extent]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return reflection ? (
    <ReflectiveGround geometry={geometry} surface={surface} reflection={reflection} glow={glow} />
  ) : (
    <MatteGround geometry={geometry} surface={surface} glow={glow} />
  );
}

function MatteGround({ geometry, surface, glow }: { geometry: BufferGeometry; surface: FloorSurface; glow: SurfaceGlow }) {
  const material = dungeonMaterial(surface);
  const mats = useMemo(() => [material], [material]);
  useBreathingGlow(mats, glow);
  return <mesh geometry={geometry} material={material} receiveShadow />;
}

/** A flat, up-facing square at y = 0 with world-mapped UVs. */
export function groundGeometry(extent: number): BufferGeometry {
  const b = new MeshBuilder(FLOOR_SPAN);
  b.quad([-extent, 0, -extent], [extent, 0, -extent], [extent, 0, extent], [-extent, 0, extent], [0, 1, 0]);
  return toGeometry(b.build());
}

/** drei's final mix line, replaced by our additive version. Kept as a
 * literal so a drei upgrade that changes it is caught (dev warning) rather
 * than silently producing a different look. */
const DREI_MIX =
  "diffuseColor.rgb = diffuseColor.rgb * ((1.0 - min(1.0, mirror)) + newMerge.rgb * mixStrength);";
const ADDITIVE_MIX = `
  // WebMagic: reflection as light — glossier and more grazing = stronger.
  float reflGloss = 1.0 - clamp(reflectorRoughnessFactor, 0.0, 1.0);
  reflGloss *= reflGloss;
  float reflNdV = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float reflFresnel = mix(0.3, 1.0, pow(1.0 - reflNdV, 3.0));
  totalEmissiveRadiance += max(newMerge.rgb, 0.0) * mixStrength * reflGloss * reflFresnel;
  diffuseColor.rgb *= 1.0 - 0.2 * reflGloss;`;

interface Mirror {
  material: MeshReflectorMaterial;
  fbo: WebGLRenderTarget;
  blurred: WebGLRenderTarget;
  blur: BlurPass;
  textureMatrix: Matrix4;
}

function createMirror(gl: WebGLRenderer, kind: FloorSurface, reflection: GroundReflection): Mirror {
  const params = { minFilter: LinearFilter, magFilter: LinearFilter, type: HalfFloatType };
  const fbo = new WebGLRenderTarget(RESOLUTION, RESOLUTION, params);
  fbo.depthBuffer = true;
  fbo.depthTexture = new DepthTexture(RESOLUTION, RESOLUTION);
  fbo.depthTexture.format = DepthFormat;
  fbo.depthTexture.type = UnsignedShortType;
  const blurred = new WebGLRenderTarget(RESOLUTION, RESOLUTION, { ...params, depthBuffer: false });
  const blur = new BlurPass({ gl, resolution: RESOLUTION, width: BLUR[0], height: BLUR[1] });
  const textureMatrix = new Matrix4();

  const material = new MeshReflectorMaterial({ ...getSurface(kind).material });
  material.textureMatrix = textureMatrix;
  material.tDiffuse = fbo.texture;
  material.tDepth = fbo.depthTexture;
  material.tDiffuseBlur = blurred.texture;
  material.hasBlur = true;
  material.mixBlur = reflection.blur;
  material.mixStrength = reflection.strength;
  material.mirror = 0;
  material.mixContrast = 1;
  material.defines = { ...material.defines, USE_BLUR: "" };
  const driven = MeshReflectorMaterial.prototype.onBeforeCompile;
  material.onBeforeCompile = function (shader: WebGLProgramParametersWithUniforms) {
    driven.call(this, shader);
    if (shader.fragmentShader.includes(DREI_MIX)) {
      shader.fragmentShader = shader.fragmentShader.replace(DREI_MIX, ADDITIVE_MIX);
    } else if (import.meta.env?.DEV) {
      console.warn("DungeonGround: drei's reflector shader changed; using its own mix.");
    }
  };
  material.customProgramCacheKey = () => "webmagic-reflector";
  withFloorTint(material);
  return { material, fbo, blurred, blur, textureMatrix };
}

function disposeMirror(m: Mirror): void {
  m.fbo.depthTexture?.dispose();
  m.fbo.dispose();
  m.blurred.dispose();
  m.blur.renderTargetA.dispose();
  m.blur.renderTargetB.dispose();
  m.blur.convolutionMaterial.dispose();
  m.blur.screen.geometry.dispose();
  m.material.dispose();
}

// Scratch objects for the mirror camera — reused every frame.
const UP = new Vector3(0, 1, 0);
const _mirrorPos = new Vector3();
const _camPos = new Vector3();
const _rot = new Matrix4();
const _lookAt = new Vector3();
const _view = new Vector3();
const _target = new Vector3();
const _plane = new Plane();
const _clip = new Vector4();
const _q = new Vector4();

function ReflectiveGround({
  geometry,
  surface,
  reflection,
  glow,
}: {
  geometry: BufferGeometry;
  surface: FloorSurface;
  reflection: GroundReflection;
  glow: SurfaceGlow;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const mesh = useRef<Mesh>(null);
  const mirror = useMemo(() => createMirror(gl, surface, reflection), [gl, surface, reflection]);
  const virtualCamera = useMemo(() => new PerspectiveCamera(), []);
  useEffect(() => () => disposeMirror(mirror), [mirror]);
  const glowing = useMemo(() => [mirror.material as unknown as MeshStandardMaterial], [mirror]);
  useBreathingGlow(glowing, glow);

  useFrame(() => {
    const floor = mesh.current;
    if (!floor) return;
    // Mirror the camera in the floor plane (y = 0, normal +Y) — adapted from
    // drei's MeshReflectorMaterial, with the plane known up front.
    _mirrorPos.setFromMatrixPosition(floor.matrixWorld);
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    _view.subVectors(_mirrorPos, _camPos);
    if (_view.dot(UP) > 0) return; // below the floor: nothing to reflect
    _view.reflect(UP).negate().add(_mirrorPos);
    _rot.extractRotation(camera.matrixWorld);
    _lookAt.set(0, 0, -1).applyMatrix4(_rot).add(_camPos);
    _target.subVectors(_mirrorPos, _lookAt).reflect(UP).negate().add(_mirrorPos);
    virtualCamera.position.copy(_view);
    virtualCamera.up.set(0, 1, 0).applyMatrix4(_rot).reflect(UP);
    virtualCamera.lookAt(_target);
    virtualCamera.far = (camera as PerspectiveCamera).far;
    virtualCamera.updateMatrixWorld();
    virtualCamera.projectionMatrix.copy(camera.projectionMatrix);

    const tm = mirror.textureMatrix;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(virtualCamera.projectionMatrix).multiply(virtualCamera.matrixWorldInverse).multiply(floor.matrixWorld);

    // Oblique near plane = the floor, so nothing below it leaks into the
    // reflection (Lengyel, "Oblique View Frustum Depth Projection").
    _plane.setFromNormalAndCoplanarPoint(UP, _mirrorPos).applyMatrix4(virtualCamera.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const p = virtualCamera.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + p[8]) / p[0];
    _q.y = (Math.sign(_clip.y) + p[9]) / p[5];
    _q.z = -1;
    _q.w = (1 + p[10]) / p[14];
    _clip.multiplyScalar(2 / _clip.dot(_q));
    p[2] = _clip.x;
    p[6] = _clip.y;
    p[10] = _clip.z + 1;
    p[14] = _clip.w;

    floor.visible = false;
    const shadowAuto = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;
    gl.setRenderTarget(mirror.fbo);
    gl.state.buffers.depth.setMask(true);
    if (!gl.autoClear) gl.clear();
    gl.render(scene, virtualCamera);
    mirror.blur.render(gl, mirror.fbo, mirror.blurred);
    gl.shadowMap.autoUpdate = shadowAuto;
    gl.setRenderTarget(null);
    floor.visible = true;
  });

  return <mesh ref={mesh} geometry={geometry} material={mirror.material} receiveShadow />;
}
