import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, interactionGroups } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import { DoubleSide, MeshStandardMaterial } from "three";
import { GROUPS } from "../../../core/config";
import { type DynamicLightSource, addLightSource, removeLightSource } from "../../../fx/DynamicLights";
import { type FlameHandle, addFlame, removeFlame } from "../../../fx/Flames";
import { getBiomeDef } from "../../../world/biomes";
import { getDecorDef } from "../../../world/decor";
import type { FloorLayout } from "../../../world/types";
import { heightToNormal, scalarToRgba, toTexture } from "../../textures/canvas";
import { DECOR_ATLAS_H, DECOR_ATLAS_W, paintDecorAtlas } from "../../textures/decorAtlas";
import { trimForWall } from "../../textures";
import { shared } from "../shared";
import { dungeonMaterial } from "../wallMaterial";
import { bakeDecor } from "./decorBake";

/** The floor's set dressing (world/gen/dressing.ts): skulls, candles,
 * chains, webs, banners, grates, rubble, niches and each band's own —
 * baked into at most three meshes (render/models/decor/decorBake.ts), the
 * portcullises and broken doors of the doorways with them. Candles and
 * braziers burn with the game's shared pixel flame (fx/Flames: one draw
 * call for every fire on the floor) and flicker; each candle cluster is a
 * soft pooled light ranked under the torches, so it only takes a light
 * slot when it's the closest thing burning (fx/DynamicLights). The two
 * pieces with bulk — anvils and braziers — get a small collider. */

const WORLD_GROUPS = interactionGroups(GROUPS.WORLD, [
  GROUPS.PLAYER,
  GROUPS.ENEMY,
  GROUPS.FRIENDLY_PROJECTILE,
  GROUPS.ENEMY_PROJECTILE,
  GROUPS.PROP,
]);

const CANDLE_COLOR = "#ffb35c";

/** The atlas, uploaded once for the session, and its two materials. */
const atlasMaterials = shared(() => {
  const p = paintDecorAtlas();
  const W = DECOR_ATLAS_W;
  const H = DECOR_ATLAS_H;
  const maps = {
    map: toTexture(p.color, W, H, true),
    normalMap: toTexture(heightToNormal(p, 2.2), W, H, false),
    roughnessMap: toTexture(scalarToRgba(p.rough!), W, H, false),
    emissiveMap: toTexture(p.emit!, W, H, true),
  };
  const base = { ...maps, roughness: 1, metalness: 0.1, emissive: "#ffffff", emissiveIntensity: 1.2 };
  return {
    solid: new MeshStandardMaterial(base),
    sheet: new MeshStandardMaterial({ ...base, alphaTest: 0.5, side: DoubleSide }),
  };
});

export function FloorDecor({ layout }: { layout: FloorLayout }) {
  const biome = getBiomeDef(layout.biome);
  const bake = useMemo(
    () => bakeDecor(layout.dressing, layout.architecture.doorways, layout.biome),
    [layout],
  );
  useEffect(
    () => () => {
      for (const g of Object.values(bake.geometry)) g?.dispose();
    },
    [bake],
  );
  const mats = atlasMaterials();
  const stone = dungeonMaterial(trimForWall(biome.surfaces.wall));
  const colliders = useMemo(
    () =>
      layout.dressing.flatMap((d) => {
        const c = getDecorDef(d.kind).collider;
        return c ? [{ half: c.map((v) => v * d.scale) as [number, number, number], pos: d.pos, yaw: d.yaw }] : [];
      }),
    [layout],
  );

  // Fires: a pixel flame each, a pooled light per cluster.
  const fires = useMemo(() => ({ flames: [] as FlameHandle[], lights: [] as { src: DynamicLightSource; base: number }[] }), [bake]);
  useEffect(() => {
    for (const f of bake.fires) {
      fires.flames.push(
        addFlame({ position: f.pos, color: f.kind === "brazier" ? biome.torchColor : CANDLE_COLOR, scale: f.scale }),
      );
    }
    for (const g of bake.glows) {
      const brazier = g.kind === "brazier";
      const base = brazier ? 6.5 : 1.4 + 0.35 * g.flames;
      fires.lights.push({
        src: addLightSource({
          position: g.pos,
          color: brazier ? biome.torchColor : CANDLE_COLOR,
          intensity: base,
          distance: brazier ? 8 : 4.5,
          // Below a torch (1): a candle only wins a slot when it's close.
          priority: brazier ? 0.9 : 0.5,
        }),
        base,
      });
    }
    return () => {
      for (const f of fires.flames) removeFlame(f);
      for (const l of fires.lights) removeLightSource(l.src);
      fires.flames.length = 0;
      fires.lights.length = 0;
    };
  }, [bake, fires, biome]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (let i = 0; i < fires.flames.length; i++) {
      fires.flames[i].intensity = 0.82 + Math.sin(t * 8.1 + i * 1.7) * 0.1 + Math.sin(t * 19.3 + i * 0.9) * 0.08;
    }
    for (let i = 0; i < fires.lights.length; i++) {
      const l = fires.lights[i];
      l.src.intensity = l.base * (0.86 + Math.sin(t * 7.3 + i * 2.1) * 0.09 + Math.sin(t * 17.7 + i) * 0.05);
    }
  });

  const { solid, sheet, stone: stoneGeo } = bake.geometry;
  return (
    <group>
      {colliders.length > 0 && (
        <RigidBody type="fixed" colliders={false}>
          {colliders.map((c, i) => (
            <CuboidCollider
              key={i}
              args={c.half}
              position={[c.pos[0], c.half[1], c.pos[2]]}
              rotation={[0, c.yaw, 0]}
              collisionGroups={WORLD_GROUPS}
            />
          ))}
        </RigidBody>
      )}
      {solid && <mesh geometry={solid} material={mats.solid} castShadow receiveShadow />}
      {sheet && <mesh geometry={sheet} material={mats.sheet} receiveShadow />}
      {stoneGeo && <mesh geometry={stoneGeo} material={stone} castShadow receiveShadow />}
    </group>
  );
}
