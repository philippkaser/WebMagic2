import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  RingGeometry,
} from "three";
import { addLightSource, removeLightSource, type DynamicLightSource } from "../../fx/DynamicLights";
import { getModelTextures } from "../../render/models/modelPaint";
import { resonanceOf, useGame } from "../../state/gameStore";
import { loadFaces } from "../../ui3d/font/faces";
import { biomeForFloor, getBiomeDef } from "../../world/biomes";
import { PILLAR, WORLD_GROUPS } from "./layout";

/** The depth stone: a basalt stele the expedition raised beside the rift,
 * which reads what you carry the way the Weighing does and shows, cut in
 * light on its face, the floor the rift would drop you into — FLOOR, and
 * the number large, in the colour of that depth. Change your gear and the
 * numbers flare white and cool into the new floor's colour.
 *
 * The face is drawn for the world's own pixels: 32 × 56 texels across
 * 0.78 × 1.36 m, about a screen pixel each from the lane, so the type stays
 * crisp and legible instead of shimmering below a pixel. */

const FACE_W = 32;
const FACE_H = 56;
const PLATE_W = 0.78;
const PLATE_H = 1.36;
/** Where the face plate sits on the shaft (metres, local). */
const FACE_Y = 2.0;
const SHAFT_H = 3.2;
const BASE_Y = 0.34;
/** The shaft: a square frustum (corner radii 0.75 → 0.62) squashed to a
 * slab 0.38 as deep as it is wide. Its front face's distance at FACE_Y,
 * and how far it leans back. */
const DEPTH = 0.38;
const APO_BASE = 0.75 * Math.SQRT1_2 * DEPTH;
const APO_TOP = 0.62 * Math.SQRT1_2 * DEPTH;
const FACE_Z = APO_BASE + (APO_TOP - APO_BASE) * ((FACE_Y - BASE_Y) / SHAFT_H) + 0.012;
const FACE_LEAN = Math.atan2(APO_BASE - APO_TOP, SHAFT_H);

/** Draw the face: pixel-font text, thresholded to hard pixels. */
function paintFace(ctx: CanvasRenderingContext2D, floor: number): void {
  ctx.clearRect(0, 0, FACE_W, FACE_H);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "8px Silkscreen";
  ctx.fillText("FLOOR", FACE_W / 2, 9);
  ctx.fillRect(4, 12, FACE_W - 8, 1);
  const num = String(floor);
  ctx.font = num.length > 2 ? "16px Silkscreen" : "27px 'Jersey 15'";
  ctx.fillText(num, FACE_W / 2, num.length > 2 ? 38 : 41);
  ctx.fillRect(4, 47, FACE_W - 8, 1);
  // A row of notches under it: one per ten floors down, a tally of depth.
  const tens = Math.min(6, Math.floor(floor / 10));
  for (let i = 0; i < tens; i++) ctx.fillRect(FACE_W / 2 - tens * 2 + i * 4 + 1, 50, 2, 3);
  // Hard pixels: no grey antialiasing at the world's chunky resolution.
  const img = ctx.getImageData(0, 0, FACE_W, FACE_H);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i]! > 96 ? 255 : 0;
  ctx.putImageData(img, 0, 0);
}

export function FloorPillar() {
  const equipment = useGame((s) => s.equipment);
  const floor = resonanceOf(equipment).entryFloor;
  const biome = getBiomeDef(biomeForFloor(floor));

  const res = useMemo(() => {
    const stone = getModelTextures("runestone");
    const canvas = document.createElement("canvas");
    canvas.width = FACE_W;
    canvas.height = FACE_H;
    const ctx = canvas.getContext("2d")!;
    const tex = new CanvasTexture(canvas);
    tex.magFilter = NearestFilter;
    tex.minFilter = NearestFilter;
    tex.generateMipmaps = false;
    return {
      ctx,
      tex,
      shaft: new CylinderGeometry(0.62, 0.75, SHAFT_H, 4, 1).rotateY(Math.PI / 4).scale(1, 1, DEPTH).translate(0, SHAFT_H / 2 + BASE_Y, 0),
      cap: new ConeGeometry(0.62, 0.5, 4).rotateY(Math.PI / 4).scale(1, 1, DEPTH).translate(0, SHAFT_H + BASE_Y + 0.25, 0),
      plinth: new BoxGeometry(1.6, 0.2, 0.9).translate(0, 0.1, 0),
      step: new BoxGeometry(1.3, 0.16, 0.65).translate(0, 0.27, 0),
      face: new PlaneGeometry(PLATE_W, PLATE_H),
      ring: new RingGeometry(1.05, 1.18, 32).rotateX(-Math.PI / 2),
      stoneMat: new MeshStandardMaterial({ map: stone.map, normalMap: stone.normalMap, color: "#6a6670", roughness: 0.85, flatShading: true }),
      faceMat: new MeshBasicMaterial({ map: tex, alphaTest: 0.5, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      ringMat: new MeshBasicMaterial({ transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    };
  }, []);
  useEffect(
    () => () => {
      res.tex.dispose();
      for (const k of ["shaft", "cap", "plinth", "step", "face", "ring", "stoneMat", "faceMat", "ringMat"] as const) res[k].dispose();
    },
    [res],
  );

  // Re-cut the face when the floor changes (and once the fonts are in).
  const flash = useRef(0);
  const glow = useMemo(() => new Color(), []);
  useEffect(() => {
    let live = true;
    const draw = () => {
      if (!live) return;
      paintFace(res.ctx, floor);
      res.tex.needsUpdate = true;
      flash.current = 1;
    };
    draw();
    void loadFaces().then(draw);
    return () => {
      live = false;
    };
  }, [floor, res]);

  const light = useRef<DynamicLightSource | null>(null);
  useEffect(() => {
    const [x, , z] = PILLAR.pos;
    const src = addLightSource({
      position: [x + Math.sin(PILLAR.rot) * 0.7, FACE_Y, z + Math.cos(PILLAR.rot) * 0.7],
      color: biome.accent,
      intensity: 3,
      distance: 5,
      priority: 1,
    });
    light.current = src;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
  }, [biome.accent]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    flash.current = Math.max(0, flash.current - dt * 1.4);
    const f = flash.current;
    // Breathing; on a re-cut, a white-hot flare that cools into the colour.
    const breathe = 1.6 + 0.25 * Math.sin(t * 1.7);
    glow.set(biome.accent).multiplyScalar(breathe).lerp(new Color(4, 4, 4), f * f);
    res.faceMat.color.copy(glow);
    res.ringMat.color.set(biome.accent).multiplyScalar(0.6 + 0.3 * Math.sin(t * 1.7) + f * 2);
    if (light.current) light.current.intensity = 3 * (0.85 + 0.15 * Math.sin(t * 1.7)) + f * 8;
  });

  return (
    <group position={PILLAR.pos} rotation={[0, PILLAR.rot, 0]}>
      <mesh geometry={res.plinth} material={res.stoneMat} castShadow receiveShadow />
      <mesh geometry={res.step} material={res.stoneMat} castShadow receiveShadow />
      <mesh geometry={res.shaft} material={res.stoneMat} castShadow receiveShadow />
      <mesh geometry={res.cap} material={res.stoneMat} castShadow />
      {/* The face: on the shaft's front, leaning back with its taper. */}
      <mesh geometry={res.face} material={res.faceMat} position={[0, FACE_Y, FACE_Z]} rotation={[-FACE_LEAN, 0, 0]} />
      <mesh geometry={res.ring} material={res.ringMat} position={[0, 0.02, 0]} />
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.8, 1.9, 0.45]} position={[0, 1.9, 0]} collisionGroups={WORLD_GROUPS} />
      </RigidBody>
    </group>
  );
}
