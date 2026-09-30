import { Stars } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import { Color, Fog } from "three";
import { startAmbient, stopAmbient } from "../audio/sound";
import { resetRegistries } from "../game/registry";
import { gearLevel } from "../items/stats";
import { COLLISION } from "../physics/groups";
import { PlayerController } from "../player/PlayerController";
import { entryRange } from "../progression/progression";
import { setGrade } from "../render/Effects";
import { getTextures } from "../render/textures";
import { useGame } from "../state/gameStore";
import { useSettings } from "../state/settings";
import type { Grade } from "../world/biomes";
import { Motes } from "../world/decor/Motes";
import { Cottages, type Cottage } from "../world/decor/village/Cottages";
import { Grounds } from "../world/decor/village/Grounds";
import { HORIZON, MOON_DIR, Sky } from "../world/decor/village/Sky";
import { Breakable, Portal, Torch, Waystone } from "../world/props";
import type { Vec3 } from "../world/types";

const WORLD_GROUPS = COLLISION.world;

const COTTAGES: Cottage[] = [
  { pos: [-11, 0, -6], rot: 0.5, size: 4 },
  { pos: [11, 0, -7], rot: -0.6, size: 4.6 },
  { pos: [-13, 0, 5], rot: 1.4, size: 3.6 },
  { pos: [13, 0, 6], rot: -1.9, size: 4.2 },
  { pos: [-3, 0, -14], rot: 0.1, size: 5 },
];

const SPAWN: Vec3 = [0, 1.2, 10];
/** Moonlit blue night, warm windows kept warm. */
const VILLAGE_GRADE: Grade = { shadows: "#0c1438", highlights: "#ffe0b0", saturation: 0.9, contrast: 1.06 };

/** The wizards' village: a moonlit hamlet in a ring of pines, standing
 * stones around the rift at its heart. The rift is the way down. */
export function Village() {
  const scene = useThree((s) => s.scene);
  const shadows = useSettings((s) => s.shadows);
  const gear = useGame((s) => gearLevel(s.equipment));
  const range = useMemo(() => entryRange(gear), [gear]);
  // Ground reaches past the playfield so the treeline stands on something.
  const groundTex = useMemo(() => getTextures("dirt", 60, 60), []);
  const moonLight = useMemo(() => MOON_DIR.clone().multiplyScalar(30).toArray(), []);

  useEffect(() => {
    scene.fog = new Fog(HORIZON, 20, 80);
    scene.background = new Color(HORIZON);
    setGrade(VILLAGE_GRADE);
    startAmbient("village");
    return () => {
      scene.fog = null;
      stopAmbient();
      resetRegistries();
    };
  }, [scene]);

  // Stepping through is diegetic: the rift reads your gear and throws you
  // as deep as it says you belong — no menu in between.
  const stepThrough = () => void useGame.getState().enterDungeon();

  return (
    <group>
      <ambientLight intensity={0.26} color="#6a78b8" />
      <directionalLight
        position={moonLight}
        intensity={0.65}
        color="#a8b8f0"
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
      />
      <Sky />
      <Stars radius={100} depth={20} count={2000} factor={4} saturation={0} fade speed={0.6} />
      <Motes kind="firefly" color="#c8ff7a" height={3.2} />

      {/* Ground + invisible perimeter */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[26, 0.5, 26]} position={[0, -0.5, 0]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[26, 3, 0.5]} position={[0, 3, -25]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[26, 3, 0.5]} position={[0, 3, 25]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[0.5, 3, 26]} position={[-25, 3, 0]} collisionGroups={WORLD_GROUPS} />
        <CuboidCollider args={[0.5, 3, 26]} position={[25, 3, 0]} collisionGroups={WORLD_GROUPS} />
      </RigidBody>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[140, 140]} />
        <meshStandardMaterial map={groundTex.map} normalMap={groundTex.normalMap} roughness={0.95} />
      </mesh>

      <Cottages cottages={COTTAGES} />
      <Grounds cottages={COTTAGES} />

      {/* A few crates to kick around — the sandbox starts at home. */}
      <Breakable kind="crate" position={[4, 1, 6]} floor={1} entityId="v0" />
      <Breakable kind="crate" position={[4.4, 2, 6.2]} floor={1} entityId="v1" />
      <Breakable kind="barrel" position={[-5, 1, 7]} floor={1} entityId="v2" />
      <Breakable kind="pot" position={[-4.2, 1, 6.2]} floor={1} entityId="v3" />

      {/* Torch posts flanking the portal */}
      {([[-2.6, 0, 2.8], [2.6, 0, 2.8]] as Vec3[]).map((p, i) => (
        <group key={i} position={p}>
          <mesh position={[0, 0.9, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, 1.8, 6]} />
            <meshStandardMaterial color="#3d2c1c" roughness={0.9} />
          </mesh>
          <Torch position={[0, 1.9, 0]} />
        </group>
      ))}

      <Portal
        position={[0, 0, 0]}
        color="#46ffd0"
        prompt={`E — Step through the rift (it will cast you to floor ${range[0]}–${range[1]})`}
        onUse={stepThrough}
      />

      {/* The waystone reads your gear and foretells your depth. */}
      <Waystone position={[-4.2, 0, 1.8]} rotation={0.7} gear={gear} range={range} />

      <PlayerController spawn={SPAWN} />
    </group>
  );
}
